import Anthropic from "@anthropic-ai/sdk";

/**
 * Single configuration point for all AI features (Brief Parser, Call Sheet
 * Checker, Message Drafter, location lookup, and anything later). Decision
 * 2026-11-12: all AI runs on Claude Haiku 5.5 through the Anthropic API.
 * Change provider or model here, nowhere else.
 *
 * The key lives in the Convex deployment env (ANTHROPIC_API_KEY). Never
 * hardcode it.
 *
 * Note: Haiku 5.5 thinks before answering and thinking counts towards
 * max_tokens, so leave generous headroom and read only the text blocks.
 */
export const AI_MODEL = "claude-haiku-5-5";

/**
 * Effort per kind of call: "medium" for the agents that read a whole brief or
 * call sheet, "low" for quick lookups (e.g. location address autofill) where
 * latency matters more.
 */
export type AiEffort = "low" | "medium";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in the Convex environment");
  }
  client ??= new Anthropic();
  return client;
}
