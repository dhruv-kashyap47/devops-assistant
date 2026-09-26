import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {END, MessagesAnnotation, START, StateGraph,} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tavily } from "@tavily/core";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { z } from "zod";

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
    }),
  },
);

const model = new ChatOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: "openrouter/free",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

const modelWithTools = model.bindTools([webSearchTool]);

async function callModel(memory_state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke(memory_state.messages);
  return { messages: [response] };
}

const toolnode = new ToolNode([webSearchTool]);

async function routeAfterAgent(state: typeof MessagesAnnotation.State,): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];

  if ("tool_calls" in lastMessage &&(lastMessage as any).tool_calls?.length > 0) {
    return "tools";
  }
  return END;
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolnode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent)
  .addEdge("tools", "agent")
  .compile();

async function runResearchAgentGraph(goal: string): Promise<string> {
  const result = await graph.invoke(
    {
      messages: [
        new SystemMessage(
          "You are a research agent. Use web_search as many times as needed, " +
            "then give a clear final summary with sources.",
        ),

        new HumanMessage(goal),
      ],
    },
    {
      recursionLimit: 10,
    },
  );
  const finalMessage = result.messages[result.messages.length - 1];
  return finalMessage.content as string;
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const goal = await rl.question("What should the research agent look into? ");
  rl.close();

  const answer = await runResearchAgentGraph(goal);
  console.log("\n=== FINAL SUMMARY ===\n");
  console.log(answer);
}

main();
