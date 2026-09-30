import { tavily } from "@tavily/core";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

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
  const initialMessages = [
    new SystemMessage(
      "You are a research agent. Use the web_search tool as many times as needed " +
        "to gather enough information to answer the user's research goal thoroughly. " +
        "Once you have enough information, stop searching and give a clear, well-organized " +
        "final summary with the key facts and sources.",
    ),
    new HumanMessage(goal),
  ];

  let fullReply = "";

  try {
    const result = await graph.stream(
      { messages: initialMessages },
      { recursionLimit: 12, streamMode: "messages" },
    );

    for await(const[messageChunk, metadata] of result){
      if (metadata.langgraph_node === "agent" && messageChunk.content){
        const piece = messageChunk.content as string;
        process.stdout.write(piece);
        fullReply = fullReply + piece;
      }
    }
    console.log("\n👻 Agent finished.\n");

    return fullReply ?? "(no final answer produced)";
  } catch (error: any) {
    console.log("\n🦿 Hit step limit, forcing a final answer...\n");

    const fallbackResponse = await model.stream([
      ...initialMessages,
      new HumanMessage(
        "You have reached the maximum research steps. " +
          "Do not search again. Using only the information gathered so far, " +
          "provide the best possible final answer to the original research goal. " +
          "Clearly mention any limitations or missing information.",
      ),
    ]);
    let fallbackReply = "";
    for await(const chunk of fallbackResponse) {
      const piece = (chunk.content as string) ?? "";
      process.stdout.write(piece);
      fallbackReply = fallbackReply + piece;
    }
    console.log("\n");
    return fallbackReply || "(no final answer produced)";
  }
}

async function main() {
  const r1 = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const goal = await r1.question("What should the research agent look into?\n");

  r1.close();

  const result = await runResearchAgent(goal);

  console.log("\n=== FINAL SUMMARY ===\n");
  console.log(result);
}

main();

