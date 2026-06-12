/**
 * Single configuration point for all AI features (Brief Parser, Call Sheet
 * Checker, Message Drafter, and anything later). Decision 2026-06-12: all AI
 * runs through OpenRouter on deepseek/deepseek-v4-flash. Change provider or
 * model here, nowhere else.
 *
 * The key lives in the Convex deployment env (OPENROUTER_API_KEY) and in
 * .env.local for any Next.js-side use. Never hardcode it.
 *
 * Note: deepseek-v4-flash is a reasoning model. Completions spend reasoning
 * tokens before output, so set max_tokens with generous headroom and never
 * assume the first tokens are the answer.
 */
export const AI_MODEL = "deepseek/deepseek-v4-flash";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function openRouterHeaders(): Record<string, string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set in the Convex environment");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // OpenRouter attribution headers (optional but recommended)
    "HTTP-Referer": "https://unitdeck.app",
    "X-Title": "UnitDeck",
  };
}
