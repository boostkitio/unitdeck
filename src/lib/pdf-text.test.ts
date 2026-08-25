import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupTextItems, pdfToText, type PdfTextItem } from "./pdf-text";

const item = (text: string, x: number, y: number, width = text.length * 5): PdfTextItem => ({
  text,
  x,
  y,
  width,
});

describe("groupTextItems", () => {
  it("puts glyphs at the same height back on one line", () => {
    expect(
      groupTextItems([item("Crew call", 100, 700), item("07:00", 40, 700)]),
    ).toBe("07:00\tCrew call");
  });

  it("reads down the page, which is upwards in a PDF's own measure", () => {
    expect(
      groupTextItems([item("Wrap", 40, 600), item("Crew call", 40, 700)]),
    ).toBe("Crew call\nWrap");
  });

  it("treats a wide gap as a column and a small one as a space", () => {
    const line = groupTextItems([
      item("07:00", 40, 700, 30),
      // 5pt on: still the same phrase.
      item("Crew", 75, 700, 25),
      // 40pt on: another column.
      item("Unit base", 140, 700, 45),
    ]);
    expect(line).toBe("07:00 Crew\tUnit base");
  });

  it("tolerates a baseline that wobbles by a point or two", () => {
    expect(groupTextItems([item("a", 40, 700), item("b", 60, 701.5)])).toBe("a\tb");
  });

  it("drops runs that are only whitespace", () => {
    expect(groupTextItems([item("   ", 40, 700), item("Wrap", 60, 700)])).toBe("Wrap");
  });

  it("has nothing to say about an empty page", () => {
    expect(groupTextItems([])).toBe("");
  });
});

describe("pdfToText", () => {
  it("reads a schedule laid out as a table in a real PDF", async () => {
    const path = fileURLToPath(new URL("./__fixtures__/schedule.pdf", import.meta.url));
    const text = await pdfToText(new Uint8Array(readFileSync(path)));

    expect(text).toContain("Brand film");
    expect(text).toContain("Day 1");
    // The columns survive, which is what lets the schedule reader find notes.
    expect(text).toMatch(/07:00\s+Crew call\s+Unit base/);
    expect(text).toMatch(/18:00\s+Wrap/);
  });
});
