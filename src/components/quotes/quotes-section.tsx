"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPence } from "@/lib/money";
import { statusLabel } from "@/lib/quote-labels";

/**
 * What this job has been quoted at.
 *
 * On the production rather than only on the Quotes tab, because the question
 * "what did we say this would cost" is asked while looking at the job.
 */
export function QuotesSection({ projectId }: { projectId: Id<"projects"> }) {
  const quotes = useQuery(api.quotes.listForProject, { projectId });
  const create = useMutation(api.quotes.create);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const id = await create({ projectId });
      router.push(`/quotes/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start a quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Quotes</CardTitle>
        <CardAction>
          <Button size="sm" disabled={busy} onClick={() => void start()}>
            {busy ? "Starting…" : "New quote"}
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
            Nothing quoted yet. A new quote picks up the client, and can pull in the crew
            and kit already on this job.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {quotes.map((quote) => (
              <li key={quote._id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
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
                <div className="shrink-0 text-right">
                  <p className="font-medium tabular-nums">
                    {formatPence(quote.totals.netTotal)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPence(quote.totals.grossTotal)} inc VAT
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
