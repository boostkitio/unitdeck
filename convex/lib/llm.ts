import { AI_MODEL, OPENROUTER_BASE_URL, openRouterHeaders } from "./ai";

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
 * One JSON-producing chat completion. Reasoning models spend tokens thinking
 * before they answer, so maxTokens is a hard floor of 4000. One automatic
 * retry on unparseable output, with the parse error fed back to the model.
 */
export async function chatJson(args: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<unknown> {
  const maxTokens = Math.max(args.maxTokens ?? 4000, 4000);

  async function once(messages: Array<{ role: string; content: string }>) {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices[0]?.message?.content ?? "";
    if (content.trim() === "") throw new Error("Model returned an empty response");
    return content;
  }

  const messages = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];
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
