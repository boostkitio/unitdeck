import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { launchBrowser } from "@/lib/pdf-browser";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Public PDF endpoint for the free call sheet maker. The token is minted by
 * convex tools.createRender, expires after 15 minutes and resolves to
 * ephemeral, tenant-free data, so no auth is required here.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string };
  if (!body.token || !/^[a-f0-9]{48}$/.test(body.token)) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  // Fail fast on unknown/expired tokens before paying for a browser launch
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const render = await convex.query(api.tools.getRender, { token: body.token });
  if (!render) {
    return NextResponse.json({ error: "Render link expired" }, { status: 410 });
  }

  const printUrl = `${req.nextUrl.origin}/print/tool/${body.token}`;
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

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="call-sheet.pdf"`,
    },
  });
}
