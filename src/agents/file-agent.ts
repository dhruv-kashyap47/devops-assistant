import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";

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

  if (!target.startsWith(WORKSPACE_DIR)) {
    throw new Error("Access Denied: path is outside the allowed workspace.");
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

const toolFunctions: Record<string, (args: any) => Promise<string>> = {
  list_files: async () => list_files(),
  read_file: async (args) => read_file(args.filename),
  write_file: async (args) => write_file(args.filename, args.content),
};

async function runFileAgent(goal: string): Promise<string> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a file operations agent. You can list, read, and write files, " +
        "but ONLY inside the workspace folder. Use tools as needed to accomplish " +
        "the user's goal, then give a clear final summary of what you did.",
    },
    {
      role: "user",
      content: goal,
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

      console.log(`📂 ${fnName}(${JSON.stringify(args)})`);

      const fn = toolFunctions[fnName];

      const result = fn ? await fn(args) : `Unknown tool: ${fnName}`; //ternary operator

      console.log(
        `✅ Result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}\n`,
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
          "You have reached the maximum number of steps. " +
          "Do not call any more tools. Using only what you've already done and observed so far, " +
          "give the best possible final summary of what was accomplished. " +
          "Clearly mention anything left incomplete.",
      },
    ] as any,
  });

  return (
    finalResponse.choices[0]?.message?.content ?? "(no final answer produced)"
  );
}

async function main() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const goal = await rl.question("What should the file agent do?\n");
  rl.close();

  const result = await runFileAgent(goal);
  console.log("\n=== FINAL SUMMARY ===\n");
  console.log(result);
}

main();
