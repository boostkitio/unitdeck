/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { extractJson } from "./lib/llm";

describe("extractJson", () => {
  test("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  test("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("recovers JSON embedded in prose", () => {
    expect(
      extractJson('Here is the result you asked for:\n{"a": {"b": [1, 2]}}\nLet me know!')
    ).toEqual({ a: { b: [1, 2] } });
  });

  test("throws a useful error on garbage", () => {
    expect(() => extractJson("no json here at all")).toThrow("No JSON object found");
  });
});
