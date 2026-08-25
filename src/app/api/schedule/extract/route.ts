import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { docxToText } from "@/lib/docx-text";
import { pdfToText } from "@/lib/pdf-text";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A schedule is a few pages. Anything larger is not one. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * The text inside a schedule somebody was sent.
 *
 * Producers are sent PDFs and Word files, not text, and asking them to
 * retype one defeats the point of importing it. Reading these needs libraries
 * too heavy to ship to the browser, so the file comes here, the text goes
 * back, and the parsing and preview happen on the page as before — nothing is
 * stored either way.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is too big to read" }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  try {
    let text: string;
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      text = await pdfToText(bytes);
    } else if (
      name.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      text = await docxToText(bytes);
    } else {
      return NextResponse.json(
        { error: "That is not a PDF or a Word document" },
        { status: 415 },
      );
    }

    if (text.trim().length === 0) {
      return NextResponse.json(
        {
          error:
            "No text in that file — a scanned or photographed schedule is a picture, so it has none to read. Type or paste it instead.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that file" },
      { status: 400 },
    );
  }
}
