import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docxToText, docxXmlToText, unzipEntry } from "./docx-text";

const wrap = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe("docxXmlToText", () => {
  it("makes a line of each paragraph", () => {
    expect(docxXmlToText(wrap(p("Crew call") + p("Wrap")))).toBe("Crew call\nWrap");
  });

  it("joins runs Word split mid-sentence", () => {
    // Word breaks a line into runs wherever formatting changes, often mid-word.
    const split = `<w:p><w:r><w:t xml:space="preserve">First </w:t></w:r><w:r><w:t>setup</w:t></w:r></w:p>`;
    expect(docxXmlToText(wrap(split))).toBe("First setup");
  });

  it("keeps table columns as columns", () => {
    const row = `<w:tr><w:tc>${p("07:00")}</w:tc><w:tc>${p("Crew call")}</w:tc><w:tc>${p("Unit base")}</w:tc></w:tr>`;
    expect(docxXmlToText(wrap(`<w:tbl>${row}</w:tbl>`))).toBe("07:00\tCrew call\tUnit base");
  });

  it("reads a tab as a tab and a break as a line", () => {
    const line = `<w:p><w:r><w:t>07:00</w:t><w:tab/><w:t>Crew call</w:t><w:br/><w:t>Unit base</w:t></w:r></w:p>`;
    expect(docxXmlToText(wrap(line))).toBe("07:00\tCrew call\nUnit base");
  });

  it("decodes the entities Word writes", () => {
    expect(docxXmlToText(wrap(p("Lunch &amp; wrap &#8212; 13:00")))).toBe(
      "Lunch & wrap — 13:00",
    );
  });

  it("ignores everything that is not text", () => {
    const noisy = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Wrap</w:t></w:r></w:p>`;
    expect(docxXmlToText(wrap(noisy))).toBe("Wrap");
  });

  it("does not leave a run of blank lines where empty paragraphs were", () => {
    expect(docxXmlToText(wrap(p("Crew call") + "<w:p/><w:p/><w:p/>" + p("Wrap")))).toBe(
      "Crew call\n\nWrap",
    );
  });
});

describe("unzipEntry", () => {
  it("refuses something that is not a zip at all", async () => {
    await expect(unzipEntry(new Uint8Array([1, 2, 3, 4]), "word/document.xml")).rejects.toThrow(
      /not a Word document/,
    );
  });

  it("says nothing when the entry is not in there", async () => {
    const path = fileURLToPath(new URL("./__fixtures__/schedule.docx", import.meta.url));
    const zip = new Uint8Array(readFileSync(path));
    expect(await unzipEntry(zip, "word/missing.xml")).toBeNull();
  });
});

describe("docxToText", () => {
  it("reads a schedule out of a real Word file", async () => {
    const path = fileURLToPath(new URL("./__fixtures__/schedule.docx", import.meta.url));
    const text = await docxToText(new Uint8Array(readFileSync(path)));

    expect(text).toContain("Brand film — shooting schedule");
    expect(text).toContain("Day 1 — Monday 12 May 2026");
    expect(text).toContain("07:00\tCrew call\tUnit base, Curtain Road");
    expect(text).toContain("18:00\tWrap");
  });
});
