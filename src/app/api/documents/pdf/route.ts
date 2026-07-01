import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { launchBrowser } from "@/lib/pdf-browser";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Public PDF endpoint for a signed talent release. The token is the
 * document's signToken, so no auth is required here. Renders the print
 * page to PDF, stores the bytes on the document via Convex storage, then
 * returns the PDF to the caller.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string };
  if (!body.token || !/^[a-f0-9]{48}$/.test(body.token)) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  // Fail fast on unknown/expired tokens before paying for a browser launch
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const render = await convex.query(api.documents.getForPrint, { token: body.token });
  if (!render) {
    return NextResponse.json({ error: "Document link expired" }, { status: 410 });
  }

  const printUrl = `${req.nextUrl.origin}/print/document/${body.token}`;
  const browser = await launchBrowser();
  let pdf: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.goto(printUrl, { waitUntil: "networkidle0", timeout: 30000 });
    pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  try {
    const uploadUrl = await convex.mutation(api.documents.generateSignedUploadUrl, { token: body.token });
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: Buffer.from(pdf),
    });
    const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
    await convex.mutation(api.documents.attachSignedPdf, { token: body.token, fileId: storageId });
  } catch (err) {
    console.error("Signed talent release PDF storage failed", err);
  }

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="talent-release.pdf"`,
    },
  });
}
