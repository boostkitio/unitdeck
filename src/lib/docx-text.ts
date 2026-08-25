/**
 * Reading the text out of a Word file.
 *
 * A .docx is a zip with the document in `word/document.xml`, so this is two
 * small jobs: get that one entry out, and walk its markup keeping the shape
 * that matters — a paragraph is a line, a table row is a line, and the cells
 * across it are separated the way a pasted table would be. Everything the
 * schedule reader understands about tabs and lines then applies unchanged.
 */

function u16(view: DataView, at: number): number {
  return view.getUint16(at, true);
}
function u32(view: DataView, at: number): number {
  return view.getUint32(at, true);
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * One named entry out of a zip, or null when it is not in there.
 *
 * Only the two storage methods a Word file actually uses are handled —
 * deflated and stored — and anything else is reported rather than guessed at.
 */
export async function unzipEntry(zip: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // The end-of-central-directory record is last, after a comment of unknown
  // length, so it is found by searching backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (u32(view, i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("That file is not a Word document");

  const entries = u16(view, eocd + 10);
  let at = u32(view, eocd + 16);
  const decoder = new TextDecoder();

  for (let i = 0; i < entries; i++) {
    if (at + 46 > zip.length || u32(view, at) !== CENTRAL_SIGNATURE) break;
    const method = u16(view, at + 10);
    const compressedSize = u32(view, at + 20);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    const localAt = u32(view, at + 42);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));

    if (name === wanted) {
      // The local header repeats the name and extra fields, at its own
      // lengths — the central directory's are not interchangeable.
      const localNameLength = u16(view, localAt + 26);
      const localExtraLength = u16(view, localAt + 28);
      const from = localAt + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(from, from + compressedSize);
      if (method === 0) return data;
      if (method === 8) return await inflateRaw(data);
      throw new Error("That Word document is compressed in a way this cannot read");
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

const TAG = /<(\/?)([a-zA-Z0-9:]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>([^<]*)/g;

/**
 * `word/document.xml` as plain lines.
 *
 * Word wraps every run of characters in its own element, often mid-word, so
 * the text is whatever sits inside `w:t` and nothing else. The structural
 * tags decide where the line breaks go.
 */
export function docxXmlToText(xml: string): string {
  let out = "";
  let inText = false;

  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(xml)) !== null) {
    const closing = match[1] === "/";
    const name = match[2];
    const selfClosing = match[4] === "/";
    const between = match[5];
    // An empty paragraph is written `<w:p/>`, and it is still a paragraph.
    const ends = closing || selfClosing;

    if (name === "w:t") {
      inText = !closing && !selfClosing;
    } else if (name === "w:tab" || name === "w:ptab") {
      out += "\t";
    } else if (name === "w:br" || name === "w:cr") {
      out += "\n";
    } else if (ends && name === "w:p") {
      out += "\n";
    } else if (ends && name === "w:tc") {
      // A cell boundary reads as a column, which is how a pasted table reads.
      out += "\t";
    } else if (ends && name === "w:tr") {
      out += "\n";
    }

    if (inText && between.length > 0) out += decodeEntities(between);
  }

  return out
    // A cell's own paragraph already ended the line; do not end it twice.
    .replace(/\n\t/g, "\t")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The readable text of a Word document. */
export async function docxToText(file: Uint8Array): Promise<string> {
  const document = await unzipEntry(file, "word/document.xml");
  if (!document) throw new Error("That file has no Word document inside it");
  return docxXmlToText(new TextDecoder().decode(document));
}
