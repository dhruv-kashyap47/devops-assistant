import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { tavily } from "@tavily/core";

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

const webSearchTool = tool(
  async ({ query }) => {
    const response = await tvly.search(query, { maxResults: 4 });
    return response.results
      .map((r) => `- ${r.title}\n ${r.content}\n Source: ${r.url}`)
      .join("\n\n");
  },
  {
    name: "web_search",
    description: "Search the web for current information on a topic.",
    schema: z.object({
        query: z.string().describe("The search query"),
    })
  },
);

const model = new ChatOpenAI({
  apikey: process.env.OPENROUTER_API_KEY,
  model: "openrouter/free",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

const availableTools = model.bindTools([webSearchTool]);

async function callModel(memory_state: typeof MessagesAnnotation.State){
    const response = await availableTools.invoke(memory_state.messages);
    return { messages: [response] };
}


