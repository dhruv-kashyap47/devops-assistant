import "dotenv/config";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import mini = require("zod/mini");
import required = require("zod/mini");

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const WORKSPACE_DIR = path.resolve("workspace");

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
};

function resolveSafePath(userPath: string): string {
    const target = path.resolve(WORKSPACE_DIR, userPath);

    if (!target.startsWith(WORKSPACE_DIR)){
        throw new Error("Access Denied: path is outside the allowed workspace.")
    }

    return target;
}
// Tool 1 - list files in the workspace
async function list_files(): Promise<string> {
    const files = await fs.readdir(WORKSPACE_DIR);
    if (files.length === 0) return "The workspace is empty.";
    return files.join("\n");
}

// Tool 2 - read a file's content
async function read_file(filename: string): Promise<string> {
    try {
        const safePath = resolveSafePath(filename);
        const content = await fs.readFile(safePath, "utf-8");
        return content;
    } catch (error: any) {
        return `Error reading file "${filename}": ${error.message}`;
    }
}

// Tool 3 - write/create a file
async function write_file(filename: string, content: string): Promise<string> {
    try {
        const safePath = resolveSafePath(filename);
        await fs.writeFile(safePath, content, "utf-8");
        return `Successfully wrote to "${filename}".`;
    } catch (error: any) {
        return `Error writing file "${filename}": ${error.message}`;
    }
}


const tools = [
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List all files currently in the workspace.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the full text xontents of a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The file name, e.g. 'notes.txt'.",
          },
        },
        required: ["filename"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file in the workspace with given text content",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The file name to write, e.g. 'summary.txt'.",
            content: {
              type: "string",
              description: "The full text content to write into the file.",
            },
          },
        },
        required: ["filename", "content"],
      },
    },
  },
];
