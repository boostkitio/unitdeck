import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, anthropic, type AiEffort } from "./ai";

/**
 * Pull the first JSON object out of a model response: handles bare JSON,
 * ```json fences, and JSON embedded in prose. Throws if nothing parses.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * One JSON-producing completion. Thinking counts towards max_tokens, so the
 * agents keep a floor of 4000 and quick lookups a floor of 2000. One
 * automatic retry on unparseable output, with the parse error fed back to the
 * model.
 */
export async function chatJson(args: {
  system: string;
  user: string;
  maxTokens?: number;
  /** Quick lookup: low effort and a smaller budget. */
  fast?: boolean;
}): Promise<unknown> {
  const maxTokens = args.fast
    ? Math.max(args.maxTokens ?? 2000, 2000)
    : Math.max(args.maxTokens ?? 4000, 4000);
  const effort: AiEffort = args.fast ? "low" : "medium";

  async function once(messages: Anthropic.MessageParam[]) {
    let message: Anthropic.Message;
    try {
      message = await anthropic().messages.create({
        model: AI_MODEL,
        max_tokens: maxTokens,
        output_config: { effort },
        system: args.system,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new Error(`Anthropic ${err.status ?? "error"}: ${err.message.slice(0, 300)}`);
      }
      throw err;
    }
    if (message.stop_reason === "refusal") {
      throw new Error("The model declined to answer this request");
    }
    const content = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (content.trim() === "") throw new Error("Model returned an empty response");
    return content;
  }

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.user }];
  const first = await once(messages);
  try {
    return extractJson(first);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unparseable";
    const retry = await once([
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content: `That response could not be parsed as JSON (${reason}). Reply again with ONLY the JSON object, no prose, no code fences.`,
      },
    ]);
    return extractJson(retry);
  }
}

/** Truncate agent input before storing it on the run row. */
export function truncateInput(text: string, max = 20000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}
