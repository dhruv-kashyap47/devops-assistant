import "dotenv/config";
import { createInterface } from "node:readline/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
  MemorySaver,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tavily } from "@tavily/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
const WORKSPACE_DIR = path.resolve("workspace");

const mcpTransport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-server.ts"],
});
const mcpClient = new Client({
  name: "triage-agent-graph-client",
  version: "1.0.0",
});

async function connectMcp() {
  await mcpClient.connect(mcpTransport);
}

const model = new ChatOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: "apodex/apodex-1.1-mini:free",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

const webSearchTool = tool(
  async ({ query }) => {
    const response = await tvly.search(query, { maxResults: 4 });
    return response.results
      .map((r) => `- ${r.title}\n  ${r.content}\n  Source: ${r.url}`)
      .join("\n\n");
  },
  {
    name: "web_search",
    description:
      "Search the web for information about an error, technology, or incident pattern.",
    schema: z.object({
      query: z.string().describe("Search query."),
    }),
  },
);

const calculateTool = tool(
  async ({ expression }) => {
    const result = await mcpClient.callTool({
      name: "calculate",
      arguments: { expression },
    });
    return (
      (result.content as any[])?.map((c) => c.text).join("\n") ?? "No result"
    );
  },
  {
    name: "calculate",
    description:
      "Evaluate a math expression (e.g. for error rate or latency calculations).",
    schema: z.object({
      expression: z.string().describe("A math expression."),
    }),
  },
);

const writeIncidentReportTool = tool(
  async ({ filename, content }) => {
    const safePath = path.resolve(WORKSPACE_DIR, filename);
    if (!safePath.startsWith(WORKSPACE_DIR)) {
      return "Access denied: path outside workspace.";
    }
    await fs.writeFile(safePath, content, "utf-8");
    return `Incident report saved as "${filename}".`;
  },
  {
    name: "write_incident_report",
    description:
      "Save a final incident report as a text file in the workspace.",
    schema: z.object({
      filename: z
        .string()
        .describe("Report file name, e.g. 'incident-report.md'."),
      content: z.string().describe("Full report content."),
    }),
  },
);

const allTools = [webSearchTool, calculateTool, writeIncidentReportTool];

const modelWithTools = model.bindTools(allTools);

async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
}

const toolNode = new ToolNode(allTools);

function routeAfterAgent(state: typeof MessagesAnnotation.State,): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    console.log(`\n🔧 Routing to tools: ${lastMessage.tool_calls.map((c) => c.name).join(", ")}`);
    return "tools";
  }
  console.log("\n➡️ No tool calls — going straight to END.");
  return END;
}

const checkpointer = new MemorySaver();

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent)
  .addEdge("tools", "agent")
  .compile({ checkpointer });

async function runTriageAgent(incident: string, threadId: string,): Promise<string> {
  type InputMessage = SystemMessage | HumanMessage;

  const newMessages: InputMessage[] = [];

  const existingState = await graph.getState({
    configurable: { thread_id: threadId },
  });

  if (!existingState.values.messages || existingState.values.messages.length === 0) {
    newMessages.push(
      new SystemMessage(
        "You are a DevOps incident triage agent. Given a description of a system incident, " +
          "research likely causes using web_search, perform any relevant calculations with " +
          "calculate, and produce a clear incident report (summary, likely cause, recommended " +
          "next steps) saved via write_incident_report. Decide yourself when you have enough " +
          "information.",
      ),
    );
  }

  newMessages.push(new HumanMessage(incident));

  let fullReply = "";

  try {
    const result = await graph.stream(
      { messages: newMessages },
      {
        recursionLimit: 12,
        streamMode: "messages",
        configurable: { thread_id: threadId },
      },
    );

    for await (const [messageChunk, metadata] of result) {
      if (metadata.langgraph_node === "agent" && messageChunk.content) {
        const piece = messageChunk.content as string;
        process.stdout.write(piece);
        fullReply += piece;
      }
    }

    console.log("\n\n✅ Agent finished.\n");
    return fullReply || "(no final answer produced)";
  } catch (error: any) {
    console.log("\n⚠️ Hit step limit, forcing a final answer...\n");

    const fullState = await graph.getState({
      configurable: { thread_id: threadId },
    });
    const fullHistory = fullState.values.messages ?? [];

    const fallbackResponse = await model.stream([
      ...fullHistory,
      new HumanMessage(
        "You have reached the maximum number of steps. Do not call any more tools. " +
          "Using only what you've gathered so far, produce the best possible final incident report.",
      ),
    ]);

    let fallbackReply = "";
    for await (const chunk of fallbackResponse) {
      const piece = (chunk.content as string) ?? "";
      process.stdout.write(piece);
      fallbackReply += piece;
    }
    console.log("\n");
    return fallbackReply || "(no final answer produced)";
  }
}

async function main() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  await connectMcp();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const threadId = "triage-agent-thread-1";

  console.log("Triage agent (LangGraph, with memory). Type 'exit' to quit.\n");

  while (true) {
    let incident;

    try {
      incident = await rl.question("Describe the incident: ");
    } catch {
      console.log("\nExiting...");
      rl.close();
      break;
    }

    if (incident.trim().toLowerCase() === "exit") {
      rl.close();
      break;
    }

    const result = await runTriageAgent(incident, threadId);

    console.log("\n=== SUMMARY ===\n");
    console.log(result, "\n");
  }
}

main();
