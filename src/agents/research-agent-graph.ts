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

