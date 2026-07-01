import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string; typedName?: string; drawnImage?: string };
  if (!body.token || !/^[a-f0-9]{48}$/.test(body.token)) return NextResponse.json({ error: "token required" }, { status: 400 });
  if (!body.typedName || body.typedName.trim().length === 0) return NextResponse.json({ error: "typed name required" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    await convex.mutation(api.documents.sign, { token: body.token, typedName: body.typedName, drawnImage: body.drawnImage, ip, userAgent });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not sign" }, { status: 400 });
  }
  // Generate and store the signed PDF (best-effort; the signature is already captured)
  try {
    await fetch(`${req.nextUrl.origin}/api/documents/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.token }),
    });
  } catch {}
  return NextResponse.json({ ok: true });
}
