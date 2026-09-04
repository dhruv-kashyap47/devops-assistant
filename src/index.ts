import "dotenv/config";
import console = require("node:console");
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});


async function main() {
    const response = await client.chat.completions.create({
      model: "openrouter/free",
      messages: [
        {
          role: "user",
          content: "How many r's are in the word 'strawberry'?",
        },
      ],
    });

    console.log(response.choices[0]?.message.content)
}

main();

