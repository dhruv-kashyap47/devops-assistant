import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const WORKSPACE_DIR = path.resolve("workspace"); // Ensure this is an absolute path

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
};

function resolveSafePath(userPath: string): string { // Ensure the path is resolved within the workspace
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

const toolFunctions: Record<string, (args: any) => Promise<string>> = { // Map tool names to their corresponding functions
  list_files: async () => list_files(), // This is a function that calls the list_files function and returns its result
  read_file: async (args) => read_file(args.filename), // This is a function that calls the read_file function with the filename argument and returns its result
  write_file: async (args) => write_file(args.filename, args.content), // This is a function that calls the write_file function with the filename and content arguments and returns its result
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

    if (!msg?.tool_calls || msg.tool_calls.length === 0) { // If there are no tool calls, the agent has finished its task
      console.log("\n✅ Agent finished.\n");
      return msg?.content ?? "(no final answer produced)";
    }

    messages.push({ // Add the agent's response to the messages array, including any tool calls it made
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    for (const call of msg.tool_calls) { // For each tool call, extract the function name and arguments, then execute the corresponding function
      const fnName = call.function.name;
      const args = JSON.parse(call.function.arguments);

      console.log(`📂 ${fnName}(${JSON.stringify(args)})`);

      const fn = toolFunctions[fnName];

      const result = fn ? await fn(args) : `Unknown tool: ${fnName}`; //This is a ternary operator that checks if the function exists in the toolFunctions object. If it does, it calls the function with the provided arguments and awaits its result. If it doesn't, it returns a string indicating that the tool is unknown.

      console.log(
        `✅ Result: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}\n`,
      );

      messages.push({ // Add the result of the tool call to the messages array, so the agent can see it in the next step
        role: "tool",
        tool_call_id: call.id,
        name: fnName,
        content: result,
      });
    }
    /*
    Keep in mind that we push two times one as assistant and one as tool, this is because the assistant is the one that calls the tool and the tool is the one that returns the result, so we need to keep track of both. The assistant message will have the tool_calls property, while the tool message will have the tool_call_id property. This way we can match the tool call with its result in the next step. We push assistant first because we want the assistant to see its own message in the next step, so it can decide what to do next based on the result of the tool call. The tool message is pushed second because we want the assistant to see the result of the tool call in the next step, so it can decide what to do next based on the result of the tool call.
    */
  }

  const finalResponse = await client.chat.completions.create({ // After reaching the maximum number of steps, we ask the agent to give a final summary of what it accomplished, using only the information it has gathered so far.
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
