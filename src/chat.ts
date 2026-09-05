import "dotenv/config";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

const messages_memory: Message[] = [
  {
    role: "system",
    content: "You are a concise, helpful assistant.",
  },
];

const read_terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function askAI(messages: Message[]) {
  const stream = client.chat.completions.stream({
    model: "openrouter/free",
    messages, //shorthand for messages: messages,
  });

  let fullReply = "";

  stream.on("content", (delta) => {
    process.stdout.write(delta);
    fullReply += delta;
  });

  await stream.finalChatCompletion();

  return fullReply;
}

async function chatLoop() {
  console.log("Chat started. Type 'exit' to quit.\n");

  while (true) {
    const userInput = await read_terminal.question("You: ");

    if (userInput.trim().toLowerCase() === "exit") {
      console.log("Thank you! Visit Us Again :)");
      read_terminal.close();
      break;
    }

    messages_memory.push({
      role: "user",
      content: userInput,
    });

    process.stdout.write("🤖 ~ ");

    const fullReply = await askAI(messages_memory);

    process.stdout.write("\n\n");

    messages_memory.push({
      role: "assistant",
      content: fullReply,
    });
  }
}

chatLoop();
