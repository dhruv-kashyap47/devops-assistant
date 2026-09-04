import "dotenv/config";
import OpenAI from "openai";
import readline from "node:readline";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

type Message = {
    role: "system" | "user" | "assistant";
    content: string;
};
