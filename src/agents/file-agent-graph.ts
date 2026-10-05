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
    configurable: { thread_id: threadId},
  });
}
