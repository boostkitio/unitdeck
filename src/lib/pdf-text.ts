/**
 * Reading the text out of a PDF.
 *
 * A PDF has no lines — it has glyphs at coordinates — so the work is putting
 * them back into lines. Items are grouped by how far down the page they sit,
 * then ordered left to right, and a wide gap between two of them is treated as
 * a column boundary. A schedule laid out as a table therefore comes back with
 * its columns intact, which is what the schedule reader needs.
 */

export type PdfTextItem = {
  text: string;
  /** Distance down the page. Higher is further up, as PDF measures it. */
  y: number;
  x: number;
  width: number;
};

/** Roughly a line's height: items closer together than this are on one line. */
const LINE_TOLERANCE = 3;
/** A gap wider than this many points reads as a new column, not a space. */
const COLUMN_GAP = 12;

/**
 * Positioned glyph runs, back into lines of text.
 *
 * Exported on its own because this is the part worth being sure of: the PDF
 * library's job is to hand over items, and this is the judgement about what
 * those items mean.
 */
export function groupTextItems(items: PdfTextItem[]): string {
  const usable = items.filter((item) => item.text.trim().length > 0);
  if (usable.length === 0) return "";

  const lines: PdfTextItem[][] = [];
  for (const item of [...usable].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= LINE_TOLERANCE) last.push(item);
    else lines.push([item]);
  }

  return lines
    .map((line) => {
      const ordered = [...line].sort((a, b) => a.x - b.x);
      let text = "";
      let previousEnd: number | null = null;
      for (const item of ordered) {
        if (previousEnd !== null) {
          const gap = item.x - previousEnd;
          // A tab, so a table keeps its columns; otherwise the space the
          // layout implies, if the run does not already carry one.
          if (gap > COLUMN_GAP) text += "\t";
          else if (gap > 0.5 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += " ";
        }
        text += item.text;
        previousEnd = item.x + item.width;
      }
      return text.replace(/[ \t]+$/, "");
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/** The readable text of a PDF, page by page. */
export async function pdfToText(file: Uint8Array): Promise<string> {
  // Imported here rather than at the top: it is a large library, wanted only
  // when somebody actually hands over a PDF.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: file,
    // Nothing here is drawn, so there is no reason to go looking for fonts on
    // the machine to draw it with.
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        items.push({
          text: item.str,
          x: item.transform[4] as number,
          y: item.transform[5] as number,
          width: item.width,
        });
      }
      pages.push(groupTextItems(items));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return pages.filter((page) => page.trim().length > 0).join("\n");
}
