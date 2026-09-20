import { tavily } from "@tavily/core";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
};

async function web_search(query: string): Promise<string> {
  const response = await tvly.search(query, { maxResults: 5 });

  return response.results
    .map((r) => `- ${r.title}\n  ${r.content}\n  Source: ${r.url}`)
    .join("\n\n");
}

const tools = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the web for current information on a topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

async function runResearchAgent(goal: string): Promise<string> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a research agent. Use the web_search tool as many times as needed " +
        "to gather enough information to answer the user's research goal thoroughly. " +
        "Once you have enough information, stop searching and give a clear, well-organized " +
        "final summary with the key facts and sources.",
    },
    {
      role: "user",
      content: goal,
    },
  ];

  const MAX_STEPS = 6;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n--- Agent step ${step} ---`);

    const response = await client.chat.completions.create({
      model: "openrouter/free",
      messages: messages as any,
      tools,
    });

    const msg = response.choices[0]?.message;

    if (!msg?.tool_calls || msg.tool_calls.length === 0) {
      console.log("\n✅ Agent finished.\n");
      return msg?.content ?? "(no final answer produced)";
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);

      console.log(`🔎 Searching: "${args.query}"`);

      const result = await web_search(args.query);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
    }
  }

  const finalResponse = await client.chat.completions.create({
    model: "openrouter/free",
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "You have reached the maximum research steps. " +
          "Do not search again. Using only the information gathered so far, " +
          "provide the best possible final answer to the original research goal. " +
          "Clearly mention any limitations or missing information.",
      },
    ] as any,
  });

  return (
    finalResponse.choices[0]?.message?.content ?? "(no final answer produced)"
  );
}

async function main() {
  const r1 = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const goal = await r1.question("What should the research agent look into? ");

  r1.close();

  const result = await runResearchAgent(goal);

  console.log("\n=== FINAL SUMMARY ===\n");
  console.log(result);
}

main();
