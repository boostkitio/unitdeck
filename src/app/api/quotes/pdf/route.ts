import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { launchBrowser } from "@/lib/pdf-browser";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The quote as a PDF.
 *
 * Rendered rather than printed by the browser: the client's copy is a laid-out
 * document, and leaving it to whatever a printer thinks a margin is meant the
 * same quote looked different every time it went out. The page it renders is
 * the same component the app shows, addressed by a short-lived token because
 * the renderer has no login of its own.
 */
export async function POST(req: NextRequest) {
  const { getToken } = await auth();
  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as { quoteId?: string };
  if (!body.quoteId) {
    return NextResponse.json({ error: "quoteId required" }, { status: 400 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  // Org membership is enforced inside createRenderToken.
  const { token } = await convex.mutation(api.quotes.createRenderToken, {
    id: body.quoteId as Id<"quotes">,
  });

  const printUrl = `${req.nextUrl.origin}/print/quote/${token}`;
  const browser = await launchBrowser();
  let pdf: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.goto(printUrl, { waitUntil: "networkidle0", timeout: 30000 });
    pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      // The document sets its own padding, so the page gets none of its own.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="quote.pdf"',
    },
  });
}
