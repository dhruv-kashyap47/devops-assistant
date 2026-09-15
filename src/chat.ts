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


const toolFunctions: Record<string,(...args: any[]) => Promise<string> | string> = {
  get_weather: get_weather,
  calculate: calculate,
};

async function askAI(messages: Message[]): Promise<string> {

  const response = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    messages: messages as any,
    tools: tools,
  });

  const choice = response.choices[0];
  const responseMessage = choice.message;

  const toolCalls = responseMessage.tool_calls

  if(!toolCalls || toolCalls.length === 0){
    const reply = responseMessage.content ?? "(no reply)";
    messages.push({ role: "assistant", content: reply });
    return reply;
  }

  messages.push({
    role: "assistant",
    content: responseMessage.content ?? "",
    tool_calls: toolCalls
  });

  





