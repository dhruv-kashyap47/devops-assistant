import "dotenv/config";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import { tavily } from "@tavily/core";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

type Message = {
    role: "system" | "user" | "assistant" | "tool";
    content: string,
    tool_call?: any,
    tool_call_id?: string,
    name?: string,
}
