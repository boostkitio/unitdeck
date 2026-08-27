"use client";

import { Fragment } from "react";
import { api } from "../../../convex/_generated/api";
import { formatPence, bpInput } from "@/lib/money";
import { unitLabel } from "@/lib/quote-labels";

type QuoteData = NonNullable<typeof api.quotes.get._returnType>;

/**
 * The quote as the client gets it.
 *
 * Costs, margins and what the job makes are all on the builder. Nothing here
 * is internal: an overview by heading, the breakdown under the rate card's own
 * section headings, what was assumed, and somewhere to sign — the document the
 * spreadsheet was printing, laid out as a document rather than as a tab.
 *
 * Its own component because two things render it: the page inside the app, and
 * the token-addressed page a headless browser prints to PDF. One layout, so a
 * downloaded quote is the quote that was on screen.
 */
/** One labelled block of the document's header. */
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

export function QuoteDocument({
  data,
  ownerName,
  ownerEmail,
}: {
  data: QuoteData;
  ownerName: string | null;
  ownerEmail: string | null;
}) {
  const { quote, totals, company } = data;
  const issued = new Date(quote.issuedAt ?? quote._creationTime).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const filled = data.byCategory.filter((c) => c.totals.total !== 0);

  return (
    <article
      // A4, like every other document this app makes: 210mm across with its
      // own 14mm margin, running to as many pages as it needs.
      className="mx-auto w-[210mm] min-h-[297mm] bg-white p-[14mm] text-[10pt] text-neutral-900"
    >
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
                  {lines.map((line, i) => (
                    <Fragment key={line._id}>
                    {/* The sheet's own headings, kept on the client's copy:
                        a long Equipment list reads as kit lists, not as one
                        run of forty lines. Only where the section changes,
                        and never above the first line of a category that
                        has just one. */}
                    {line.section && line.section !== lines[i - 1]?.section && (
                      <tr className="border-b border-neutral-300">
                        <td
                          colSpan={7}
                          className="pt-2 pb-1 text-[8.5pt] font-semibold uppercase tracking-wide text-neutral-700"
                        >
                          {line.section}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-neutral-200 align-top">
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
                    </Fragment>
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
  );
}
