import * as dotenv from "dotenv";
dotenv.config();
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { Telegraf } from "telegraf";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const model = openai("gpt-4o-mini");

export const generateNewPost = async (newText) => {
  const { text } = await generateText({
    model: model,
    messages: [
      {
        role: "system",
        content: `You are a specialized financial translator. Your task is to accurately translate a piece of finance-related news into a specified target language, maintaining the integrity of all financial terminology, figures, and nuances.

Parameters:
- [input_content]: The original finance news text that needs to be translated.
- [output_lang]: The language in which the translation should be provided.

Instructions:
1. Read and understand the finance news text in [input_content].
2. Translate the text into [output_lang].
3. Ensure that all financial terms and concepts remain accurate and clear in the translation.
4. Do not add, remove, or alter any critical information.
5. Headline should start with 🔺/🔸/🔹 reflects assessed crypto market impact level.
6. Keep your response concise within 250 characters.`,
      },
      {
        role: "user",
        content: `[input_content]
${newText}

[output_lang]
English`,
      },
    ],
  });

  return text.replace(/\*\*/gim, "").trim();
};

export const generateEconomicUpdatePost = async (newText) => {
  const { text } = await generateText({
    model: model,
    messages: [
      {
        role: "system",
        content: `You are a specialized financial translator. Your task is to accurately translate a piece of finance-related news into a specified target language, maintaining the integrity of all financial terminology, figures, and nuances.
  
  Parameters:
  - [input_content]: The original finance news text that needs to be translated.
  - [output_lang]: The language in which the translation should be provided.
  
  Instructions:
  1. Read and understand the finance news text in [input_content].
  2. Translate the text into [output_lang].
  3. Ensure that all financial terms and concepts remain accurate and clear in the translation.`,
      },
      {
        role: "user",
        content: `[input_content]
  ${newText}
  
  [output_lang]
  English`,
      },
    ],
  });

  return text.replace(/\*\*/gim, "").trim();
};
