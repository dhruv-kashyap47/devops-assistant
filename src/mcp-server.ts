import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { get_weather, calculate } from "./tools.js"

const mcp_server = new McpServer({
    name: "devops-tools-server",
    version: "1.0.0",
});

mcp_server.tool(
    "get_weather",
    "Get the current realtime weather for a given city",
    {
        city: z.string().describe("The city name, e.g. 'Tokyo' or 'London'."),
    },
    async ({ city }) => {
        const result = await get_weather(city);

        return {
            content: [{ type: "text", text: result }],
        };
    }
);

mcp_server.tool(
  "calculate",
  "Evaluate a mathematical expression and return the numeric result.",
  {
    expression: z.string().describe("A math expression, e.g. '12 * (3 + 4)'."),
  },
  async ({ expression }) => {
    const result = calculate(expression);

    return {
      content: [{ type: "text", text: result }],
    };
  }
);

async function main() {
    const transport = new StdioServerTransport();
    await mcp_server.connect(transport);
}

main();
