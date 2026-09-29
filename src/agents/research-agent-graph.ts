import { tavily } from "@tavily/core";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import process = require("node:process");
import { log } from "node:console";

const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

const model = new ChatOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: "openrouter/free",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

const webSearchTool = tool(
  async ({ query }) => {
    const response = await tvly.search(query, { maxResults: 5 });

    return response.results.map((r) => `- ${r.title}\n  ${r.content}\n  Source: ${r.url}`).join("\n\n");
  },
  {
    name: "web_search",
    description: "Search the web for current realtime information on a topic.",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  },
);

const modelWithTools = model.bindTools([webSearchTool]);

async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke(state.messages);

  return { messages: [response] };
}

const toolNode = new ToolNode([webSearchTool]);

function routeAfterAgent(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0){
    return "tools";
  }

  return END;
}

const graph = new StateGraph(MessagesAnnotation)
.addNode("agent", callModel)
.addNode("tools", toolNode)
.addEdge(START, "agent")
.addConditionalEdges("agent", routeAfterAgent)
.addEdge("tools", "agent")
.compile();

async function runResearchAgent(goal: string): Promise<string> {
  const intialMessages = [
    new SystemMessage(
      "You are a research agent. Use the web_search tool as many times as needed " +
        "to gather enough information to answer the user's research goal thoroughly. " +
        "Once you have enough information, stop searching and give a clear, well-organized " +
        "final summary with the key facts and sources.",
    ),
    new HumanMessage(goal),
  ];

  try {
    const result = await graph.invoke(
      { messages: intialMessages },
      { recursionLimit: 12 }
    );

    const finalMessage = result.messages[result.messages.length - 1];
    console.log("\n👻 Agent finished.\n");

    return (finalMessage?.content as string) ?? ("no final answer produced");
  } catch (error: any) {
    console.log("\n🦿 Hit step limit, forcing a final answer...\n");
  }
}

