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
  
)

