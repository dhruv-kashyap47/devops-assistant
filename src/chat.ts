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
  tool_calls?: any; // Tool calls made by the model (only for assistant messages)
  tool_call_id?: string; // ID of the tool call that produced this message (only for tool messages)
  name?: string; // Name of the tool that produced this message (only for tool messages)
};

/*
system = The system message sets the behavior of the assistant. It is usually a single message at the start of the conversation.
user = The user message is the input from the user. It can be multiple messages in a conversation.
assistant = The assistant message is the output from the model. It can be multiple messages in a conversation.
tool = The tool message is the output from a tool that was called by the model. It can be multiple messages in a conversation.
*/

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
  // Map tool names to their corresponding functions
  get_weather,
  calculate,
  // since the name of the function is the same as the name of the tool, we can use a computed property name to create the mapping
};

async function askAI(messages: Message[]): Promise<string> {
  // Send the conversation and available tools to the model.
  const response = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    messages: messages as any,
    tools: tools, // Pass the tools to the model so it can use them, imported from tools.ts
  });

  const responseMessage = response.choices[0].message;
  const toolCalls = responseMessage.tool_calls;

  // If no tool is needed, return the model's normal response.
  if (!toolCalls || toolCalls.length === 0) {
    const reply = responseMessage.content ?? "(no reply)"; // .content basically contains the model's text response
    messages.push({ role: "assistant", content: reply });
    return reply;
  }

  // Save the model's tool request in conversation history, if any tool calls were made.
  messages.push({
    role: "assistant",
    content: responseMessage.content ?? "",
    tool_calls: toolCalls,
  });

  // Run every tool requested by the model.
  for (const call of toolCalls) {
    const fnName = call.function.name; // Get the name of the tool function requested by the model.
    const fnArgs = JSON.parse(call.function.arguments); // Get the arguments for the tool function requested by the model, which are passed as a JSON string, so we need to parse it into an object.

    console.log(`\n🪐 Calling tool: ${fnName}(${JSON.stringify(fnArgs)})`);

    const fn = toolFunctions[fnName]; // Get the actual function to call based on the tool name requested by the model.

    let result: string;

    if (!fn) {
      // If the tool name is not found in the mapping, return an error message.
      result = `Unknown tool: ${fnName}`;
    } else {
      const arg = Object.values(fnArgs)[0]; // Get the first argument value from the parsed arguments object. This assumes that the tool function takes a single argument, which is the case for both get_weather and calculate.
      result = await fn(arg as any); // Call the tool function with the argument and await its result. The result is expected to be a string, as both get_weather and calculate return strings.
    }

    console.log(`✅ Tool result: ${result}\n`);

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
    const userInput = await read_terminal.question("🦍 ~ ");

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
