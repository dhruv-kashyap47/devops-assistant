import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tavily } from "@tavily/core";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { z } from "zod";

const tvly = tavily({
  // Initialize Tavily client
  apiKey: process.env.TAVILY_API_KEY,
});

const model = new ChatOpenAI({
  // Initialize OpenAI model
  apiKey: process.env.OPENROUTER_API_KEY,
  model: "apodex/apodex-1.1-mini:free",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

const webSearchTool = tool(
  // Define a web search tool
  async ({ query }) => {
    const response = await tvly.search(query, { maxResults: 5 });

    return response.results
      .map((r) => `- ${r.title}\n  ${r.content}\n  Source: ${r.url}`)
      .join("\n\n"); // Format the search results
  },
  {
    name: "web_search", // Name of the tool
    description: "Search the web for current realtime information on a topic.",
    schema: z.object({
      query: z.string().describe("The search query"), // Define the schema for the tool's input
    }),
  },
);

const modelWithTools = model.bindTools([webSearchTool]); // Bind the web search tool to the model

async function callModel(state: typeof MessagesAnnotation.State) {
  // Function to call the model with the current state
  const response = await modelWithTools.invoke(state.messages); // Invoke the model with the current messages

  return { messages: [response] }; // Return the model's response as a new message
}

const toolNode = new ToolNode([webSearchTool]); // Create a tool node for the web search tool

async function retryHintNode(state: typeof MessagesAnnotation.State) {
  return {
    messages: [
      new SystemMessage(
        "The last search returned little or no useful information. " +
          "Try a more specific, differently worded, or narrower search query.",
      ),
    ],
  };
}

function routeAfterAgent(
  state: typeof MessagesAnnotation.State,
): "tools" | typeof END {
  // Function to determine the next node in the state graph after the agent node
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage; // Get the last message from the state, which should be an AIMessage

  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  // state.messages[state.messages.length - 1] means the last message in the conversation, which is expected to be an AIMessage. The code checks if this last message contains any tool calls (i.e., if the AI model has requested to use a tool like web_search). If there are tool calls present, it returns "tools", indicating that the next node in the state graph should be the tools node. If there are no tool calls, it returns END, indicating that the conversation can end without needing to invoke any tools.
  return END;
}

function routeAfterTools(
  state: typeof MessagesAnnotation.State,
): "retry_hint" | "agent" {
  const lastMessage = state.messages[state.messages.length - 1];
  const content = (lastMessage?.content as string) ?? "";
  if (content.trim().length < 60) {
    return "retry_hint";
  }
  return "agent";
}

const checkpointer = new MemorySaver();

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addNode("retry_hint", retryHintNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent)
  .addConditionalEdges("tools", routeAfterTools)
  .addEdge("retry_hint", "agent")
  .compile({ checkpointer });

/*
Complete guide to create a StateGraph -
1. Create a StateGraph instance with the appropriate annotation type (e.g., MessagesAnnotation).
2. Add nodes to the graph using the addNode method, specifying the node name and the function to be executed at that node.
3. Add edges between nodes using the addEdge method, specifying the source and target nodes.
4. If needed, add conditional edges using the addConditionalEdges method, specifying the source node and a function that determines the next node based on the current state.
5. Compile the graph using the compile method to finalize its structure.

In simple terms nodes is basically a function that takes in the current state and returns the next state. Edges are the connections between nodes, and conditional edges allow for branching based on the current state.

state is basically a snapshot of the current conversation, including all messages exchanged so far. It allows the graph to keep track of the conversation's context and make decisions based on that context.

and edge is basically a connection between two nodes in the graph, indicating the flow of execution from one node to another. Edges can be unconditional (always follow the edge) or conditional (follow the edge based on certain conditions in the state).

"agent" and "tools" are the names of the nodes in the graph. The "agent" node represents the AI model that processes the conversation and generates responses, while the "tools" node represents the web search tool that can be used to gather information from the web. "agent" will call the model and "tools" will call the web search tool. The graph will flow between these nodes based on the conversation's context and the conditions defined in the edges.

so in general the workflow is like this - the graph starts at the START node, which leads to the "agent" node. The "agent" node processes the conversation and generates a response. If the response indicates that a tool call is needed (e.g., a web search), the graph will transition to the "tools" node, where the web search tool is invoked. After the tool call, the graph returns to the "agent" node to continue processing the conversation. This cycle continues until the conversation reaches a conclusion or a predefined limit is reached.
*/

async function runResearchAgent(
  goal: string,
  threadId: string,
): Promise<string> {
  const newMessages = [];

  const existingState = await graph.getState({
    configurable: { thread_id: threadId },
  }); // basically this is fetching the current state of the conversation for the given threadId. The state includes all messages exchanged so far in that thread, allowing the agent to maintain context and continuity in the conversation.

  if (
    !existingState.values.messages ||
    existingState.values.messages.length === 0
  ) {
    newMessages.push(
      new SystemMessage(
        "You are a research agent. Use the web_search tool as many times as needed " +
          "to gather enough information to answer the user's research goal thoroughly. " +
          "Once you have enough information, stop searching and give a clear, well-organized " +
          "final summary with the key facts and sources.",
      ),
    );
  }

  newMessages.push(new HumanMessage(goal));

  let fullReply = "";

  try {
    const result = await graph.stream(
      { messages: newMessages },

      {
        recursionLimit: 12,
        streamMode: "messages",
        configurable: { thread_id: threadId },
      },
    );

    for await (const [messageChunk, metadata] of result) {
      if (metadata.langgraph_node === "agent" && messageChunk.content) {
        const piece = messageChunk.content as string;
        process.stdout.write(piece);
        fullReply = fullReply + piece;
      }
    }
    console.log("\n👻 Agent finished.\n");

    return fullReply || "(no final answer produced)";
  } catch (error: any) {
    console.log("\n🦿 Hit step limit, forcing a final answer...\n");

    const fullState = await graph.getState({
      configurable: { thread_id: threadId },
    });
    const fullHistory = fullState.values.messages ?? [];

    const fallbackResponse = await model.stream([
      ...newMessages,
      new HumanMessage(
        "You have reached the maximum research steps. " +
          "Do not search again. Using only the information gathered so far, " +
          "provide the best possible final answer to the original research goal. " +
          "Clearly mention any limitations or missing information.",
      ),
    ]);
    let fallbackReply = "";
    for await (const chunk of fallbackResponse) {
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

  const threadId = "demo-thread-1";
  console.log("Research agent with memory. Type 'exit' to quit.\n");

  while (true) {
    const goal = await r1.question("You: ");

    if (goal.trim().toLowerCase() === "exit") {
      r1.close();
      break;
    }

    const result = await runResearchAgent(goal, threadId);
    console.log("\n=== SUMMARY ===\n");
    console.log(result, "\n");
  }
}

main();
