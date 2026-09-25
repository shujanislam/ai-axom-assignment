import OpenAI from "openai";

// NVIDIA's API is OpenAI-compatible, so the openai client just points at it.
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
/** NVIDIA's free tier can stall for minutes; give up on a call rather than hang. */
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 120_000);

export const aiModel = () => process.env.NVIDIA_MODEL ?? DEFAULT_MODEL;

/** A client with a hard timeout and no retries, or null when NVIDIA_API_KEY is not set. */
export function aiClient() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
}

/** Some models wrap JSON in ```json fences or add text around it; take the outermost object. */
export function parseJsonObject<T>(content: string): T {
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`Model did not return valid JSON:\n${content}`);
  }
}
