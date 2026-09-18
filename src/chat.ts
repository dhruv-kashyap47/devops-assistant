import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";

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
  {
    role: "system",
    content: "You are a concise, helpful assistant.",
  },
];

const read_terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// MCP transport
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-server.ts"],
});

// MCP client
const mcp_client = new Client({
  name: "devops-chat-client",
  version: "1.0.0",
});

// Tools discovered from MCP server
let toolsForAgent: any[] = []; // this will hold the tools discovered from the MCP server

async function connectToMcpServer() {
  await mcp_client.connect(transport);

  const tool_list = await mcp_client.listTools(); // Get the list of tools from the MCP server

  toolsForAgent = tool_list.tools.map((tool) => ({ // Convert the tool to the format expected by the OpenAI API
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  console.log(
    `Connected to MCP server. Available tools: ${tool_list.tools.map((tool) => tool.name).join(", ")}\n`,
  );
}

async function askAI(messages: Message[]): Promise<string> { // Function to ask the AI model for a response
  try {
    const response = await client.chat.completions.create({ // Create a chat completion request to the OpenAI API
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      messages: messages as any,
      tools: toolsForAgent,
      // we send messages and tools to the model, and it will decide if it needs to call a tool or just respond directly
    });

    const choice = response.choices?.[0]; // Get the first choice from the response

    if (!choice) {
      console.error("\n❌ No choices returned.");
      return "The model returned no response.";
    }

    const responseMessage = choice.message; // Get the message from the choice
    const toolCalls = responseMessage.tool_calls; // Get any tool calls from the message

    if (!toolCalls || toolCalls.length === 0) {
      const reply = responseMessage.content ?? "(no reply)";

      messages.push({
        role: "assistant",
        content: reply,
      });

      return reply;
    }

    messages.push({
      role: "assistant",
      content: responseMessage.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const fnName = call.function.name;
      const fnArgs = JSON.parse(call.function.arguments);

      console.log(`\n🔧 MCP tool: ${fnName}(${JSON.stringify(fnArgs)})`);

      const result = await mcp_client.callTool({
        name: fnName,
        arguments: fnArgs,
      });

      const resultText =
        (result.content as any[])?.map((content) => content.text).join("\n") ??
        "No result";

      console.log(`✅ Tool result: ${resultText}\n`);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: fnName,
        content: resultText,
      });
    }

    return askAI(messages);
  } catch (error) {
    console.error("\n❌ AI ERROR:");
    console.error(error);

    return "Something went wrong while processing your request.";
  }
}

async function chatLoop() {
  await connectToMcpServer();

  console.log("Chat started. Type 'exit' to quit.\n");

  while (true) {
    const userInput = await read_terminal.question("🦍 ~ ");

    if (userInput.trim().toLowerCase() === "exit") {
      console.log("Thank you! Visit Us Again :)");
      read_terminal.close();
      break;
    }

    messages_memory.push({
      role: "user",
      content: userInput,
    });

    const fullReply = await askAI(messages_memory);

    console.log(`🤖 ~ ${fullReply}\n`);
  }
}

chatLoop();
