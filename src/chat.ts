import "dotenv/config";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import { calculate, get_weather, tools } from "./tools.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
};

const messages_memory: Message[] = [
  { role: "system", content: "You are a concise, helpful assistant." },
];

const read_terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Connect tool names from the model to the actual functions.
const toolFunctions: Record<
  string,
  (...args: any[]) => Promise<string> | string
> = {
  get_weather,
  calculate,
};

async function askAI(messages: Message[]): Promise<string> {
  // Send the conversation and available tools to the model.
  const response = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    messages: messages as any,
    tools: tools,
  });

  const responseMessage = response.choices[0].message;
  const toolCalls = responseMessage.tool_calls;

  // If no tool is needed, return the model's normal response.
  if (!toolCalls || toolCalls.length === 0) {
    const reply = responseMessage.content ?? "(no reply)";
    messages.push({ role: "assistant", content: reply });
    return reply;
  }

  // Save the model's tool request in conversation history.
  messages.push({
    role: "assistant",
    content: responseMessage.content ?? "",
    tool_calls: toolCalls,
  });

  // Run every tool requested by the model.
  for (const call of toolCalls) {
    const fnName = call.function.name;

    // Tool arguments come as a JSON string, so convert them into an object.
    const fnArgs = JSON.parse(call.function.arguments);

    console.log(`\n🦾 Calling tool ~ ${fnName}(${JSON.stringify(fnArgs)})`);

    // Find the actual function using the tool name.
    const fn = toolFunctions[fnName];

    let result: string;

    if (!fn) {
      result = `Unknown tool: ${fnName}`;
    } else {
      // Get the argument and pass it to the actual tool function.
      const arg = Object.values(fnArgs)[0];
      result = await fn(arg as any);
    }

    console.log(`🌐 Tool result ~ ${result}\n`);

    // Send the tool result back to the model.
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      name: fnName,
      content: result,
    });
  }

  // Ask the model again so it can use the tool results to answer the user.
  return askAI(messages);
}

async function chatLoop() {
  console.log("Chat started. Type 'exit' to quit.\n");

  while (true) {
    const userInput = await read_terminal.question("💁 ~ ");

    if (userInput.trim().toLowerCase() === "exit") {
      console.log("Thank you! Visit Us Again :)");
      read_terminal.close();
      break;
    }

    // Add the user's message to conversation history.
    messages_memory.push({
      role: "user",
      content: userInput,
    });

    // Send the conversation to the model.
    const fullReply = await askAI(messages_memory);

    console.log(`🤖 ~ ${fullReply}\n`);
  }
}

chatLoop();
