import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

import { launchBrowser } from "@/lib/pdf-browser";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { getToken } = await auth();
  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as { callSheetId?: string };
  if (!body.callSheetId) {
    return NextResponse.json({ error: "callSheetId required" }, { status: 400 });
  }
  const callSheetId = body.callSheetId as Id<"callSheets">;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  // Org membership is enforced inside createRenderToken
  const { token } = await convex.mutation(api.callSheets.createRenderToken, {
    id: callSheetId,
  });

  const printUrl = `${req.nextUrl.origin}/print/call-sheet/${token}`;
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

  // Store the PDF in Convex storage so distribution (phase 3) can reuse it.
  // Awaited and verified: a failed store fails the request loudly.
  const uploadUrl = await convex.mutation(api.callSheets.generateUploadUrl, {});
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: Buffer.from(pdf),
  });
  if (!uploadRes.ok) {
    return NextResponse.json({ error: "Failed to store PDF" }, { status: 500 });
  }
  const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
  await convex.mutation(api.callSheets.attachPdf, { id: callSheetId, fileId: storageId });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="call-sheet.pdf"`,
    },
  });
}
