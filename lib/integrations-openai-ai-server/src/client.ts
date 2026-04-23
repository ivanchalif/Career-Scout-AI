import OpenAI from "openai";

const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

if (!baseURL || !apiKey) {
  console.warn(
    "[integrations-openai] AI_INTEGRATIONS_OPENAI_BASE_URL or AI_INTEGRATIONS_OPENAI_API_KEY is not set. " +
    "AI scoring features will be unavailable. " +
    "Provision the OpenAI AI integration to enable them.",
  );
}

export const openai = new OpenAI({
  apiKey: apiKey ?? "missing",
  baseURL: baseURL ?? "https://missing.invalid",
});
