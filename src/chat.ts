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
  // this is a readline interface that allows us to read user input from the terminal
  input: process.stdin, // input stream from the terminal
  output: process.stdout, // output stream to the terminal
});

async function askAI(messages: Message[]) {
  const stream = client.chat.completions.stream({
    // client = sdk ka main connection/object, .chat = sdk ke ander chat related api/functionality, .completions = Mujhe conversation dekar model se response generate karwana hai, .stream = Response ko ek saath mat do. Stream karo
    model: "minimax/minimax-m3:free",
    messages, //shorthand for messages: messages can be written only messages, because dono key and value same hai
  });

  let fullReply = ""; // this variable will hold the complete response from the AI model

  stream.on("content", (delta) => {
    // stream event listner, content is predefined event name
    process.stdout.write(delta);
    fullReply = fullReply + delta; // delta is a callback parameter, jo chote-chote pieces aa rahe hai unhe delta naam se bulao aur sath me hie chunks ko fullReply me jodte raho
  });
  // content = event ka naam , delta = Us event ke saath aane wala actual new text

  await stream.finalChatCompletion(); // wait till streaming ends and provide the final full reply

  return fullReply;
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

    messages_memory.push({
      role: "user",
      content: userInput,
    });

    process.stdout.write("🤖 ~ ");

    const fullReply = await askAI(messages_memory);

    process.stdout.write("\n\n"); // Add a newline after the AI's response for better readability

    messages_memory.push({
      role: "assistant",
      content: fullReply,
    });
  }
}

chatLoop();
