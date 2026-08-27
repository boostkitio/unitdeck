"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPence, bpInput } from "@/lib/money";
import { unitLabel } from "@/lib/quote-labels";

/**
 * The quote as the client gets it.
 *
 * Costs, margins and what the job makes are all on the other page. Nothing on
 * this one is internal: an overview by heading, the breakdown, what was
 * assumed, and somewhere to sign — which is the document the spreadsheet was
 * printing, laid out as a document rather than as a tab.
 */
function Fields({
  heading,
  rows,
}: {
  heading: string;
  rows: [string, string | null | undefined][];
}) {
  const filled = rows.filter(([, value]) => value);
  if (filled.length === 0) return null;
  return (
    <div>
      <h2 className="text-[8.5pt] font-bold uppercase tracking-widest text-neutral-600">
        {heading}
      </h2>
      <dl className="mt-1 space-y-0.5 text-[9.5pt]">
        {filled.map(([label, value], i) => (
          <div key={`${label}-${i}`} className="flex gap-2">
            <dt className="w-24 shrink-0 text-neutral-600">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function QuoteViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useQuery(api.quotes.get, { id: id as Id<"quotes"> });
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const members = memberships?.data ?? [];

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

  const { quote, totals, company } = data;

  // The owner's own details. The name is resolved on the backend from what
  // they set in UnitDeck; the address comes off their login, which only the
  // browser can see.
  const owner = members.find((m) => m.publicUserData?.userId === quote.ownerId)?.publicUserData;
  const ownerName =
    quote.producerName ??
    ([owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim() || null);
  const ownerEmail = quote.producerEmail ?? owner?.identifier ?? null;
  const issued = new Date(quote.issuedAt ?? quote._creationTime).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const filled = data.byCategory.filter((c) => c.totals.total !== 0);

  return (
    <div>
      {/* Screen only: the page below is what prints. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" render={<Link href={`/quotes/${id}`} />}>
          ← Back to the quote
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="mx-auto max-w-4xl bg-white p-8 text-[10pt] text-neutral-900 print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-900 pb-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Quote</h1>
            <p className="mt-0.5 text-neutral-700">
              {quote.number}
              {quote.quoteType && ` · ${quote.quoteType}`}
            </p>
          </div>
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoUrl}
              alt={company.name}
              className="max-h-16 w-auto object-contain"
            />
          ) : (
            <p className="text-right font-heading text-lg font-semibold">{company.name}</p>
          )}
        </header>

        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fields
            heading="Quote"
            rows={[
              ["Client", quote.clientName],
              ["Contact", quote.clientContact],
              ["Project", data.project?.name ?? quote.title],
              ["Quote number", quote.number],
              ["Date", issued],
            ]}
          />
          {/* Who wrote it and how to reach them — the first thing a client
              looks for when they want to say yes or ask a question. */}
          <div>
            <h2 className="text-[8.5pt] font-bold uppercase tracking-widest text-neutral-600">
              Prepared by
            </h2>
            <p className="mt-1 text-[11pt] font-semibold">{ownerName ?? company.name}</p>
            <dl className="mt-0.5 space-y-0.5 text-[9.5pt]">
              {(
                [
                  ["Company", ownerName ? company.name : null],
                  ["Email", ownerEmail],
                  ["Phone", quote.producerPhone],
                ] as [string, string | null | undefined][]
              )
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-neutral-600">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </div>

        {quote.deliverables && (
          <section className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-3 text-[9.5pt]">
            <h2 className="text-[8.5pt] font-bold uppercase tracking-widest text-neutral-600">
              Deliverables
            </h2>
            <p className="mt-1 whitespace-pre-wrap">{quote.deliverables}</p>
          </section>
        )}

        {/* Overview */}
        <section className="mt-6">
          <h2 className="text-[9pt] font-bold uppercase tracking-widest text-neutral-700">
            Overview
          </h2>
          <table className="mt-2 w-full border-collapse">
            <tbody>
              {filled.map((c) => (
                <tr key={c.category} className="border-b border-neutral-200">
                  <td className="py-1.5">{c.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatPence(c.totals.total)}
                  </td>
                </tr>
              ))}
              {(quote.discountPence ?? 0) > 0 && (
                <tr className="border-b border-neutral-200">
                  <td className="py-1.5">Discount</td>
                  <td className="py-1.5 text-right tabular-nums">
                    -{formatPence(quote.discountPence ?? 0)}
                  </td>
                </tr>
              )}
              <tr className="border-b border-neutral-300">
                <td className="py-1.5 font-semibold">Total (exc VAT)</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatPence(totals.netTotal)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 font-semibold">
                  Total (inc VAT at {bpInput(quote.vatBp)}%)
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatPence(totals.grossTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Assumptions */}
        {(quote.caveats ?? []).length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <h2 className="text-[9pt] font-bold uppercase tracking-widest text-neutral-700">
              Assumptions and caveats
            </h2>
            <ul className="mt-2 space-y-0.5 text-[9.5pt]">
              {(quote.caveats ?? []).map((caveat, i) => (
                <li key={i}>{caveat}</li>
              ))}
            </ul>
          </section>
        )}

        {/* The breakdown, by heading */}
        <section className="mt-6">
          <h2 className="text-[9pt] font-bold uppercase tracking-widest text-neutral-700">
            Quote breakdown
          </h2>
          {filled.map((c) => {
            const lines = data.lines.filter(
              (l) => l.category === c.category && l.pax > 0 && l.unitAmount > 0
            );
            if (lines.length === 0) return null;
            return (
              <div key={c.category} className="mt-4 break-inside-avoid">
                <h3 className="text-[9pt] font-bold uppercase tracking-wide text-neutral-800">
                  {c.label}
                </h3>
                <table className="mt-1 w-full table-fixed border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-400 text-left text-[8.5pt] uppercase tracking-wide text-neutral-600">
                      <th className="w-[32%] py-1 font-semibold">Job</th>
                      <th className="w-[24%] py-1 font-semibold">Notes</th>
                      <th className="w-[8%] py-1 text-right font-semibold">Pax</th>
                      <th className="w-[10%] py-1 text-right font-semibold">Amount</th>
                      <th className="w-[8%] py-1 font-semibold">Unit</th>
                      <th className="w-[9%] py-1 text-right font-semibold">Rate</th>
                      <th className="w-[9%] py-1 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line._id} className="border-b border-neutral-200 align-top">
                        <td className="py-1.5 font-medium">{line.name}</td>
                        <td className="py-1.5 text-neutral-600">{line.clientNotes ?? ""}</td>
                        <td className="py-1.5 text-right tabular-nums">{line.pax}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {line.unitAmount.toFixed(line.unit === "mile" ? 0 : 1)}
                        </td>
                        <td className="py-1.5 text-neutral-600">{unitLabel(line.unit)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatPence(line.ratePence)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatPence(Math.round(line.ratePence * line.pax * line.unitAmount))}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={5} />
                      <td className="py-1.5 text-right text-[8.5pt] font-semibold uppercase tracking-wide text-neutral-600">
                        Subtotal
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">
                        {formatPence(c.totals.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>

        {/* Signature */}
        <footer className="mt-10 break-inside-avoid border-t border-neutral-300 pt-6 text-[9pt]">
          <p className="text-neutral-700">
            If you would like to proceed with the above quote, please sign and date this and
            return it to your point of contact. In doing so you agree to our terms, the
            assumptions above, and the price quoted.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-8">
            {["Print name", "Signature", "Date"].map((label) => (
              <div key={label}>
                <div className="border-b border-neutral-400" />
                <p className="mt-1 text-[8pt] uppercase tracking-wide text-neutral-600">
                  {label}
                </p>
              </div>
            ))}
          </div>
          {company.invoicing?.legalName && (
            <p className="mt-8 text-[8pt] text-neutral-500">
              {company.invoicing.legalName}
              {company.invoicing.companyNumber && ` · Company no. ${company.invoicing.companyNumber}`}
              {company.invoicing.vatNumber && ` · VAT no. ${company.invoicing.vatNumber}`}
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
