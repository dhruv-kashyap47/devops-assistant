import "dotenv/config";
import { createInterface } from "node:readline/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {StateGraph, MessagesAnnotation, START, END, MemorySaver,} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import console = require("node:console");
import nodeWorker_threads = require("node:worker_threads");

const WORKSPACE_DIR = path.resolve("workspace");

function resolveSafePath(userPath : string): string {
  const target = path.resolve(WORKSPACE_DIR, userPath);
  if (!target.startsWith(WORKSPACE_DIR)) {
    throw new Error("Access denied: path is outside the allowed workspace.");
  }
  return target;
}

const model = new ChatOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: "stealth/space-bunny-alpha",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

const listFilesTool = tool(
  async () => {
    const files = await fs.readdir(WORKSPACE_DIR);
    return files.length === 0 ? "The workspace is empty." : files.join("\n");
  },
  {
    name: "list_files",
    description: "List all files in the workspace directory.",
    schema: z.object({}),
  }
)

const readFileTool = tool(
  async ({ filename }) => {
    try {
      const safePath = resolveSafePath(filename);
      return await fs.readFile(safePath, "utf-8");
    } catch (error: any) {
      return `Error reading file "${filename}": ${error.message}`;
    }
  },
  {
    name: "read_file",
    description: "Read the full text contents of a file in the workspace.",
    schema: z.object({
      filename: z.string().describe("The file name, e.g. 'notes.txt'."),
    }),
  },
);

const writeFileTool = tool(
  async ({ filename, content }) => {
    try {
      const safePath = resolveSafePath(filename);
      await fs.writeFile(safePath, content, "utf-8");
      return `Successfully wrote to "${filename}".`;
    } catch (error: any) {
      return `Error writing file "${filename}": ${error.message}`;
    }
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file in the workspace with given text content.",
    schema: z.object({
      filename: z.string().describe("The file name to write, e.g. 'summary.txt'."),
      content: z.string().describe("The full text content to write into the file."),
    }),
  },
);

const allTools = [listFilesTool, readFileTool, writeFileTool]

const modelWithTools = model.bindTools(allTools);

async function callModel(state: typeof MessagesAnnotation.State){
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
}

const toolNode = new ToolNode(allTools);

function routeAgentStep(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0){
    return "tools";
  }
  return END;
}

const checkpointer = new MemorySaver();

const graph = new StateGraph(MessagesAnnotation)
.addNode("agent", callModel)
.addNode("tools", toolNode)
.addEdge(START, "agent")
.addConditionalEdges("agent", routeAgentStep)
.addEdge("tools", "agent")
.compile({ checkpointer });

async function runFileAgent(goal: string, threadId: string): Promise<string> {
  type InputMessage = SystemMessage | HumanMessage;

  const newMessages: InputMessage[] = []; // start it off empty

  const existingState = await graph.getState({
    configurable: { thread_id: threadId }, // IDcard of a specific conversation
  });

  if (!existingState.values.messages || existingState.values.messages.length === 0){
    newMessages.push(
      new SystemMessage(
        "You are a file operations agent. You can list, read, and write files, " +
          "but ONLY inside the workspace folder. Use tools as needed to accomplish " +
          "the user's goal, then give a clear final summary of what you did.",
      ),
    );
  }

  newMessages.push(new HumanMessage(goal));

  let fullReply = "";

  try{
    const result = await graph.stream( // feed into graph
      { messages: newMessages }, // input
      {
        recursionLimit:12,
        streamMode: "messages",
        configurable: { thread_id: threadId } // Loads + saves the right conversation's state
      } // options
    );

    for await (const [messageChunck, metadata] of result) {
      if (metadata.langgraph_node === "agent" && messageChunck.content){
        const piece = messageChunck.content as string;
        process.stdout.write(piece);
        fullReply += piece;
      }
    }
    console.log("\n\n🦾 Agent finished.\n");
    return fullReply || "(no final answer produced)";
  }catch (error: any){
  console.log("\n 🦾 Hit step limit, forcing a final answer...\n");
  }
  const fullState = await graph.getState({configurable: { thread_id: threadId }, });
  const fullHistory = fullState.values.messages ?? [];

  const fallbackResponse = await model.stream([
    ...fullHistory,
    new HumanMessage(
      "You have reached the maximum number of steps. Do not call any more tools. " +
        "Using only what you've already done and observed so far, give the best " +
        "possible final summary. Clearly mention anything left incomplete.",
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

async function main() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const threadId = "file-agent-thread-1";

  console.log(
    "File ops agent (LangGraph, with memory). Type 'exit' to quit.\n",
  );

  while (true) {
    const goal = await rl.question("You: ");

    if (goal.trim().toLowerCase() === "exit") {
      rl.close();
      break;
    }

    const result = await runFileAgent(goal, threadId);
    console.log("\n=== SUMMARY ===\n");
    console.log(result, "\n");
  }
}

main();
