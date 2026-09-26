import OpenAI from "openai";

// Google Gemini has an OpenAI-compatible endpoint, so the openai client just points at it.
// GEMINI_BASE_URL can point elsewhere, e.g. at a local stub when testing.
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_MODEL = "gemini-3.8-flash";
/** Give up on a call rather than hang. */
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 60_000);
/** The free tier rate-limits per minute; the client backs off and retries 429s and 5xxs. */
const AI_RETRIES = 2;

export const aiModel = () => process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

/** A client with a hard timeout, or null when GEMINI_API_KEY is not set. */
export function aiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL, timeout: AI_TIMEOUT_MS, maxRetries: AI_RETRIES });
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
