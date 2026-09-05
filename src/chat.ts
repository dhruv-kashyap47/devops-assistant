import "dotenv/config";
import OpenAI from "openai";
import readline from "node:readline";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

type Message = {
    role: "system" | "user" | "assistant";
    content: string;
};

const messages_memory: Message[] = [
    { role: "system",content: "You are a concise, helpul assistant." }
]


const read_terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});


function ask_question(user_question: string): Promise<string> {
    return new Promise((resolve) => {
        read_terminal.question(user_question, (answer) => {
            resolve(answer);
        })
    })
}

async function chatLoop() {
    console.log(`Chat started. Type 'exit' to quit. \n`);

    while(true) {
        const userInput = await ask_question("You: ");

        if(userInput.trim().toLowerCase() == "exit"){
            console.log("Thankyou! Visit Us Again :)");
            read_terminal.close();
            break;
        }

        messages_memory.push({ role: "user", content: userInput })

        const response = await client.chat.completions.create({
          model: "openrouter/free",
          messages : messages_memory,
        });

        const reply = response.choices[0]?.message.content ?? "(no reply)";

        console.log(`🤖~ ${reply}\n`);

        messages_memory.push({ role: "assistant", content: reply });



    }
}

chatLoop();
