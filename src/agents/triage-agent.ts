import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tavily } from "@tavily/core";
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

const WORKSPACE_DIR = path.resolve("workspace");

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
};

async function web_search(query: string): Promise<string> {
  // Perform a web search using Tavily and return formatted results
  const response = await tvly.search(query, { maxResults: 4 });
  return response.results
    .map((r) => `- ${r.title}\n  ${r.content}\n  Source: ${r.url}`)
    .join("\n\n");
}

const mcpTransport = new StdioClientTransport({
  // Start the MCP server as a child process
  command: "npx",
  args: ["tsx", "src/mcp-server.ts"],
});

const mcpClient = new Client({
  // MCP client configuration for connecting to the MCP server
  name: "triage-agent-client",
  version: "1.0.0",
});

async function connectMcp() {
  // Connect to the MCP server and wait for it to be ready
  await mcpClient.connect(mcpTransport);
}

async function calculate_via_mcp(expression: string): Promise<string> {
  // Use the MCP client to call the calculate tool and return the result
  const result = await mcpClient.callTool({
    name: "calculate",
    arguments: { expression },
  });

  return (
    (result.content as any[])?.map((c) => c.text).join("\n") ?? "No result"
  );
}

async function write_incident_report(filename:string, content:string): Promise<string> {
  // Save the incident report to a file in the workspace, ensuring the path is safe
  const safePath = path.resolve(WORKSPACE_DIR, filename);

  if (!safePath.startsWith(WORKSPACE_DIR)) {
    return "Access denied: path outside workspace.";
  }

  await fs.writeFile(safePath, content, "utf-8");

  return `Incident report saved as "${filename}".`;
}

const tools = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web for information about an error, technology, or incident pattern.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "calculate",
      description:
        "Evaluate a math expression (e.g. for error rate or latency calculations).",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "A math expression.",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_incident_report",
      description:
        "Save a final incident report as a text file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Report file name, e.g. 'incident-report.md'.",
          },
          content: {
            type: "string",
            description: "Full report content.",
          },
        },
        required: ["filename", "content"],
      },
    },
  },
];

const toolFunctions: Record<string, (args: any) => Promise<string>> = {
  // Map tool names to their corresponding functions
  web_search: (args) => web_search(args.query),
  calculate: (args) => calculate_via_mcp(args.expression),
  write_incident_report: (args) => write_incident_report(args.filename, args.content),
};

async function runTriageAgent(incidentDescription: string): Promise<string> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a DevOps incident triage agent. Given a description of a system incident, " +
        "research likely causes using web_search, perform any relevant calculations with calculate, " +
        "and produce a clear incident report (summary, likely cause, recommended next steps) " +
        "saved via write_incident_report. Decide yourself when you have enough information.",
    },
    {
      role: "user",
      content: incidentDescription,
    },
  ];

  const MAX_STEPS = 6;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n--- Agent step ${step} ---`);

    const response = await client.chat.completions.create({
      model: "openrouter/free",
      messages: messages as any,
      tools,
    });

    const msg = response.choices[0]?.message;

    if (!msg?.tool_calls || msg.tool_calls.length === 0) {
      console.log("\n✅ Agent finished.\n");
      return msg?.content ?? "(no final answer produced)";
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    for (const call of msg.tool_calls) {
      const fnName = call.function.name;
      const args = JSON.parse(call.function.arguments);

      console.log(`🛠️  ${fnName}(${JSON.stringify(args)})`);

      const fn = toolFunctions[fnName];
      const result = fn ? await fn(args) : `Unknown tool: ${fnName}`;

      console.log(
        `✅ ${result.slice(0, 150)}${result.length > 150 ? "..." : ""}\n`,
      );

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: fnName,
        content: result,
      });
    }
  }

  const finalResponse = await client.chat.completions.create({
    model: "openrouter/free",
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "You have reached the maximum number of steps. Do not call any more tools. " +
          "Using only what you've gathered so far, produce the best possible final incident report.",
      },
    ] as any,
  });

  return (
    finalResponse.choices[0]?.message?.content ?? "(no final answer produced)"
  );
}

async function main() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  await connectMcp();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const incident = await rl.question("Describe the incident:\n");
  rl.close();

  const result = await runTriageAgent(incident);

  console.log("\n=== FINAL REPORT ===\n");
  console.log(result);
}

main();
