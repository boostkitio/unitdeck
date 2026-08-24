import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  const fields = ["Sam Reed", "Sound recordist", "sam@example.test", null, undefined];

  it("matches everything on an empty or whitespace search", () => {
    expect(matchesSearch("", fields)).toBe(true);
    expect(matchesSearch("   ", fields)).toBe(true);
  });

  it("matches a single term in any field, case-insensitively", () => {
    expect(matchesSearch("reed", fields)).toBe(true);
    expect(matchesSearch("SOUND", fields)).toBe(true);
    expect(matchesSearch("example.test", fields)).toBe(true);
  });

  it("requires every term, but not in order or in one field", () => {
    expect(matchesSearch("sam sound", fields)).toBe(true);
    expect(matchesSearch("sound sam", fields)).toBe(true);
    expect(matchesSearch("sam director", fields)).toBe(false);
  });

  it("ignores null and undefined fields rather than throwing", () => {
    expect(matchesSearch("sam", [null, undefined, "Sam"])).toBe(true);
    expect(matchesSearch("sam", [null, undefined])).toBe(false);
  });
});
