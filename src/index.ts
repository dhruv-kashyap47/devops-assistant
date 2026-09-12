import "dotenv/config";
import OpenAI from "openai";
import console = require("node:console");

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

async function main() {
  const response = await client.chat.completions.create({
    model: "thinkingmachines/inkling:free",
    messages: [
      {
        role: "user",
        content: "How many r's are in the word 'strawberry'?",
      },
    ],
  });

  console.log(response.choices[0]?.message.content); // response.choices[0]? iska matlab hai ki agar response.choices[0] exist karta hai to hi uske andar ke message.content ko access karo, warna undefined return karo. Ye optional chaining ka use hai jo ki TypeScript me available hai. aur .message.content = response ke andar ke choices array ke first element ke andar ke message object ke content property ko access kar raha hai. Ye content property me model ka response text hoga.
}

main();
