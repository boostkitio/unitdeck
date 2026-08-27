"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchInput } from "@/components/search-input";
import { NewQuoteDialog } from "@/components/quotes/new-quote-dialog";
import { matchesSearch } from "@/lib/search";
import { formatPence } from "@/lib/money";
import { statusLabel } from "@/lib/quote-labels";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  accepted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  declined: "bg-destructive/10 text-destructive",
};

export function QuoteStatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? STATUS_STYLES.draft
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export default function QuotesPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const [showArchived, setShowArchived] = useState(false);
  const quotes = useQuery(
    api.quotes.list,
    organization ? (showArchived ? { archivedOnly: true } : {}) : "skip"
  );
  const archived = useQuery(api.quotes.list, organization ? { archivedOnly: true } : "skip");
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);

  const shown = (quotes ?? []).filter((q) =>
    matchesSearch(search, [
      q.number,
      q.clientName,
      q.projectName,
      q.title,
      statusLabel(q.status),
    ])
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {showArchived ? "Archived quotes" : "Quotes"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {showArchived
              ? "Kept for reference — every line and figure is still there."
              : "What each job was priced at, and what it was priced on."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" render={<Link href="/quotes/rate-card" />}>
            Rate card
          </Button>
          <Button size="sm" onClick={() => setStarting(true)}>
            New quote
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {quotes === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : quotes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No quotes yet. Start one here — it does not need a production, so you can
              price an enquiry before the job exists.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setStarting(true)}>
              New quote
            </Button>
          </div>
        ) : (
          <>
            {quotes.length > 5 && (
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search by number, client, production or status…"
                className="mb-3 max-w-md"
              />
            )}
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableCell className="font-medium">Quote</TableCell>
                    <TableCell className="font-medium">Production</TableCell>
                    <TableCell className="font-medium">Client</TableCell>
                    <TableCell className="font-medium">Status</TableCell>
                    <TableCell className="text-right font-medium">Net</TableCell>
                    <TableCell className="text-right font-medium">Gross</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((quote) => (
                    <TableRow
                      key={quote._id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/quotes/${quote._id}`)}
                    >
                      <TableCell>
                        <span className="font-medium">{quote.number}</span>
                        {quote.quoteType && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {quote.quoteType}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {quote.projectId ? (
                          <Link
                            href={`/projects/${quote.projectId}`}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {quote.projectName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {quote.title ?? "Not on a production yet"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {quote.clientName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <QuoteStatusChip status={quote.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPence(quote.totals.netTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatPence(quote.totals.grossTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        Nothing matches “{search}”.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}


        <div className="mt-6 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived
              ? "← Back to active quotes"
              : `View archived${archived !== undefined && archived.length > 0 ? ` (${archived.length})` : ""}`}
          </Button>
        </div>
      </div>

      {starting && <NewQuoteDialog onClose={() => setStarting(false)} />}
    </div>
  );
}
