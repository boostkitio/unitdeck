"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuoteDocument } from "@/components/quotes/quote-document";

/**
 * The client's copy, on screen.
 *
 * The document itself is a component shared with the page a headless browser
 * prints, so what downloads is what is on this screen. The browser's own print
 * dialog is deliberately not offered any more: it re-flows the page against
 * whatever the printer thinks a margin is, and a quote leaving here should
 * look the same every time.
 */
export default function QuoteViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const quoteId = id as Id<"quotes">;
  const data = useQuery(api.quotes.get, { id: quoteId });
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const members = memberships?.data ?? [];
  const [downloading, setDownloading] = useState(false);

  if (data === undefined) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (data === null) {
    return <p className="p-6 text-sm text-muted-foreground">That quote could not be found.</p>;
  }

  const { quote } = data;

  // The owner's own details. The name is resolved on the backend from what
  // they set in UnitDeck; the address comes off their login, which only the
  // browser can see.
  const owner = members.find((m) => m.publicUserData?.userId === quote.ownerId)?.publicUserData;
  const ownerName =
    quote.producerName ??
    ([owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim() || null);
  const ownerEmail = quote.producerEmail ?? owner?.identifier ?? null;

  const fileName = `${quote.number}${quote.title ? ` ${quote.title}` : ""}.pdf`.replace(
    /[\\/:*?"<>|]/g,
    "-"
  );

  /** The PDF, rendered on the server from this same layout. */
  async function fetchPdf(): Promise<Blob> {
    const res = await fetch("/api/quotes/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId }),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(problem?.error ?? "Could not make the PDF.");
    }
    return await res.blob();
  }

  async function download() {
    setDownloading(true);
    try {
      const blob = await fetchPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download it.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" render={<Link href={`/quotes/${id}`} />}>
          ← Back to the quote
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={downloading}
            onClick={() => void download()}
          >
            {downloading ? "Making the PDF…" : "Download"}
          </Button>
          <SendDialog
            quoteId={quoteId}
            clientEmail={quote.clientContact ?? null}
            fileName={fileName}
            fetchPdf={fetchPdf}
          />
        </div>
      </div>

      <QuoteDocument data={data} ownerName={ownerName} ownerEmail={ownerEmail} />
    </div>
  );
}

/**
 * Sending the quote to the client, with the PDF attached.
 *
 * The PDF is made by the same request the download button makes and handed to
 * the server to attach, so there is one renderer and the client's copy is the
 * copy that was on screen.
 */
function SendDialog({
  quoteId,
  clientEmail,
  fileName,
  fetchPdf,
}: {
  quoteId: Id<"quotes">;
  clientEmail: string | null;
  fileName: string;
  fetchPdf: () => Promise<Blob>;
}) {
  const uploadUrl = useMutation(api.quotes.generateAttachmentUploadUrl);
  const send = useMutation(api.quotes.sendToClient);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(clientEmail?.includes("@") ? clientEmail : "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      const blob = await fetchPdf();
      const url = await uploadUrl({});
      const upload = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: blob,
      });
      if (!upload.ok) throw new Error("Could not upload the PDF.");
      const { storageId } = (await upload.json()) as { storageId: Id<"_storage"> };

      await send({
        id: quoteId,
        to: to.trim(),
        message: message.trim() || undefined,
        fileId: storageId,
        fileName,
      });
      toast.success(`Sent to ${to.trim()}.`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send it.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Send by email
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => (!next ? setOpen(false) : undefined)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Send this quote</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="send-to">To</Label>
                <Input
                  id="send-to"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="name@client.com"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send-message">Message</Label>
                <Textarea
                  id="send-message"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Anything you want to say alongside it. The quote goes attached as a PDF."
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sending marks the quote as sent, the same as emailing it yourself would.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={sending || !to.includes("@")} onClick={() => void handleSend()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
