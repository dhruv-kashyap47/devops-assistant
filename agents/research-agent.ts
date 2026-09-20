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

async function web_search(query: string): Promise<string> {
    const response = await tvly.search(query, { maxResults: 5 });

    return response.results.map((r) => `- ${r.title}\n  ${r.content}\n  Source: ${r.url}`).join("\n\n")
};

const tools = [
  {
    type: "function" as const,
    function: {
      name: "web_serach",
      description: "Search the web for the current information on a topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
      },
    },
  },
];


