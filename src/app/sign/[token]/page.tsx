"use client";

import { use, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TalentReleaseDocument } from "@/components/documents/talent-release-document";

export default function SignDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const result = useQuery(api.documents.getBySignToken, { token });
  const markViewed = useMutation(api.documents.markViewed);
  const declineDoc = useMutation(api.documents.decline);

  const [typedName, setTypedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (result) void markViewed({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result === undefined, token]);

  if (result === undefined) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading the release…</p>
      </Shell>
    );
  }
  if (result === null) {
    return (
      <Shell>
        <p className="text-sm text-foreground">This link isn&apos;t valid. Check with your producer.</p>
      </Shell>
    );
  }

  const productionTitle = result.data.productionTitle;

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { x, y } = pointerPos(e);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn) setHasDrawn(true);
  }

  function handlePointerUp() {
    drawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSign() {
    await act(async () => {
      const drawnImage = hasDrawn ? canvasRef.current?.toDataURL("image/png") : undefined;
      const res = await fetch("/api/documents/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, typedName, drawnImage }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Could not sign");
      // Convex reactivity flips result.status to "signed" once this lands, no local state to update.
    });
  }

  async function downloadPdf() {
    await act(async () => {
      const res = await fetch("/api/documents/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(`The signed PDF isn't ready yet (${res.status}).`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${productionTitle.replace(/[^\w\- ]/g, "") || "talent release"} signed release.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const canSign = typedName.trim().length > 0 && consent;

  return (
    <Shell>
      <p className="text-[11px] tracking-widest text-muted-foreground">{result.data.productionCompany}</p>
      <h1 className="mt-1 font-heading text-xl font-semibold text-foreground">Talent release</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{result.data.productionTitle}</p>

      <div className="mt-4 max-h-[65vh] overflow-auto rounded-xl border border-border bg-neutral-800/40 p-3">
        <TalentReleaseDocument data={result.data} />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {result.status === "signed" ? (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
          <p className="text-sm font-medium text-emerald-300">
            Signed
            {result.signedAt
              ? ` on ${new Date(result.signedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}`
              : ""}
            .
          </p>
          <p className="mt-1 text-xs text-emerald-400/80">Thanks, this release is complete.</p>
          <Button className="mt-3 w-full" disabled={busy} onClick={downloadPdf}>
            Download signed PDF
          </Button>
        </div>
      ) : result.status === "declined" ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
          <p className="text-sm font-medium text-red-300">You&apos;ve declined this release.</p>
          <p className="mt-1 text-xs text-red-400/80">Get in touch with the producer if that was a mistake.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4 rounded-xl border border-border bg-card p-4">
          <div>
            <Label htmlFor="typedName">Type your full name to sign</Label>
            <Input
              id="typedName"
              className="mt-1.5 h-10"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Full name"
              autoComplete="name"
            />
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">Signature (optional)</p>
            <canvas
              ref={canvasRef}
              width={600}
              height={180}
              className="h-[160px] w-full touch-none rounded-lg border border-input bg-white"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            <button
              type="button"
              className="mt-1.5 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
              disabled={!hasDrawn}
              onClick={clearSignature}
            >
              Clear
            </button>
          </div>

          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 rounded border-input"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree this is my electronic signature.
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Button className="h-11" disabled={busy || !canSign} onClick={submitSign}>
              Sign
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => act(() => declineDoc({ token }))}
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      <p className="pb-4 pt-6 text-center text-[10px] text-muted-foreground/40">Sent with UnitDeck</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </main>
  );
}
