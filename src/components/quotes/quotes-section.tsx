"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPence } from "@/lib/money";
import { statusLabel } from "@/lib/quote-labels";

/**
 * What this job has been quoted at.
 *
 * Quotes are written on the Quotes tab, because one usually exists before the
 * production does — it is often what won the work. What happens here is
 * putting one against the job, which is the moment an enquiry becomes a
 * production with a price on it.
 */
export function QuotesSection({ projectId }: { projectId: Id<"projects"> }) {
  const quotes = useQuery(api.quotes.listForProject, { projectId });
  const setProject = useMutation(api.quotes.setProject);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState<Id<"quotes"> | null>(null);

  async function detach(id: Id<"quotes">) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    try {
      await setProject({ id, projectId: null });
      toast.success("Taken off this production. It is still on the Quotes tab.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not take it off.");
    }
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Quotes</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setPicking(true)}>
            Add a quote
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">
        {quotes === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : quotes.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing quoted against this job yet. Add a quote you have already written, or
            start one on the{" "}
            <Link href="/quotes" className="text-foreground underline underline-offset-2">
              Quotes
            </Link>{" "}
            tab.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {quotes.map((quote) => (
              <li
                key={quote._id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <Link href={`/quotes/${quote._id}`} className="font-medium hover:underline">
                    {quote.number}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {statusLabel(quote.status)}
                    {quote.quoteType ? ` · ${quote.quoteType}` : ""} · {quote.lineCount} line
                    {quote.lineCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="font-medium tabular-nums">
                      {formatPence(quote.totals.netTotal)}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatPence(quote.totals.grossTotal)} inc VAT
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={confirming === quote._id ? "text-destructive" : undefined}
                    onBlur={() => setConfirming(null)}
                    onClick={() => void detach(quote._id)}
                  >
                    {confirming === quote._id ? "Sure?" : "Take off"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {picking && <PickQuoteDialog projectId={projectId} onClose={() => setPicking(false)} />}
    </Card>
  );
}

function PickQuoteDialog({
  projectId,
  onClose,
}: {
  projectId: Id<"projects">;
  onClose: () => void;
}) {
  const loose = useQuery(api.quotes.listUnattached, {});
  const setProject = useMutation(api.quotes.setProject);
  const [busy, setBusy] = useState(false);

  async function attach(id: Id<"quotes">, number: string) {
    setBusy(true);
    try {
      await setProject({ id, projectId });
      toast.success(`${number} is on this production.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a quote to this production</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {loose === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : loose.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Every quote is already on a production. Write a new one on the{" "}
              <Link href="/quotes" className="text-foreground underline underline-offset-2">
                Quotes
              </Link>{" "}
              tab and it will show up here.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {loose.map((quote) => (
                <li key={quote._id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void attach(quote._id, quote.number)}
                    className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{quote.number}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[quote.title, quote.clientName, statusLabel(quote.status)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">
                      {formatPence(quote.totals.netTotal)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
