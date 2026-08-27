"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CellInput } from "@/components/quotes/cell-input";
import { AddLineDialog } from "@/components/quotes/add-line-dialog";
import { QuoteStatusChip } from "../page";
import { formatPence, bpInput, parsePercent, parsePounds, poundsInput } from "@/lib/money";
import {
  QUOTE_CATEGORIES,
  QUOTE_STATUSES,
  QUOTE_UNITS,
  unitLabel,
  type QuoteCategory,
} from "@/lib/quote-labels";

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const quoteId = id as Id<"quotes">;
  const data = useQuery(api.quotes.get, { id: quoteId });

  if (data === undefined) return <Skeleton className="h-96 w-full" />;
  if (data === null) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">That quote is not here any more.</p>
        <Button variant="secondary" size="sm" className="mt-4" render={<Link href="/quotes" />}>
          Back to quotes
        </Button>
      </div>
    );
  }
  return <QuoteEditor quoteId={quoteId} data={data} />;
}

type QuoteData = NonNullable<typeof api.quotes.get._returnType>;

function QuoteEditor({ quoteId, data }: { quoteId: Id<"quotes">; data: QuoteData }) {
  const router = useRouter();
  const update = useMutation(api.quotes.update);
  const remove = useMutation(api.quotes.remove);
  const repriceLines = useMutation(api.quotes.repriceLines);
  const addCrew = useMutation(api.quotes.addCrewFromProject);
  const addKit = useMutation(api.quotes.addKitFromProject);
  const [adding, setAdding] = useState<QuoteCategory | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const { quote, totals } = data;

  async function run(work: Promise<unknown>, failure: string, success?: string) {
    setBusy(true);
    try {
      await work;
      if (success) toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const multiplier =
    1 + (quote.contingencyBp + quote.profitBp + quote.insuranceBp) / 10_000;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {quote.number}
            </h1>
            <QuoteStatusChip status={quote.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.project ? (
              <Link href={`/projects/${data.project._id}`} className="hover:underline">
                {data.project.name}
              </Link>
            ) : (
              "A production since removed"
            )}
            {quote.clientName ? ` · ${quote.clientName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={quote.status}
            onValueChange={(v) =>
              v &&
              void run(
                update({
                  id: quoteId,
                  status: v as (typeof QUOTE_STATUSES)[number]["value"],
                }),
                "Could not change the status."
              )
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue>
                {QUOTE_STATUSES.find((s) => s.value === quote.status)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {QUOTE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="secondary" size="sm" render={<Link href={`/quotes/${quoteId}/view`} />}>
            Client copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={confirmingDelete ? "text-destructive" : undefined}
            onBlur={() => setConfirmingDelete(false)}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              void remove({ id: quoteId }).then(() => router.push("/quotes"));
            }}
          >
            {confirmingDelete ? "Sure?" : "Delete"}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Lines, by category */}
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(
                  addCrew({ quoteId }).then((r) =>
                    toast.success(
                      r.added === 0
                        ? "No crew booked on the job yet."
                        : `${r.added} booked crew added.`
                    )
                  ),
                  "Could not pull in the crew."
                )
              }
            >
              Pull in booked crew
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(
                  addKit({ quoteId }).then((r) =>
                    toast.success(
                      r.added === 0 ? "No kit listed on the job yet." : `${r.added} kit lines added.`
                    )
                  ),
                  "Could not pull in the kit."
                )
              }
            >
              Pull in the kit list
            </Button>
          </div>

          {QUOTE_CATEGORIES.map((category) => {
            const lines = data.lines.filter((l) => l.category === category.value);
            const cat = data.byCategory.find((c) => c.category === category.value)!;
            const override = data.overrides.find((o) => o.category === category.value);
            if (lines.length === 0 && !override) {
              return (
                <EmptyCategory
                  key={category.value}
                  label={category.label}
                  onAdd={() => setAdding(category.value)}
                />
              );
            }
            return (
              <CategoryCard
                key={category.value}
                quoteId={quoteId}
                category={category.value}
                label={category.label}
                lines={lines}
                subtotal={cat.totals.total}
                overrideTotal={override?.totalPence ?? null}
                onAdd={() => setAdding(category.value)}
              />
            );
          })}
        </div>

        {/* Totals and the terms that go with them */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <dl className="space-y-1.5">
                {data.byCategory.map((c) => (
                  <div key={c.category} className="flex justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{c.label}</dt>
                    <dd className="shrink-0 tabular-nums">{formatPence(c.totals.total)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="w-24">
                    <CellInput
                      align="right"
                      inputMode="decimal"
                      value={poundsInput(quote.discountPence ?? 0)}
                      onCommit={(raw) => {
                        const discountPence = parsePounds(raw) ?? 0;
                        return run(
                          update({ id: quoteId, discountPence }),
                          "Could not save the discount."
                        );
                      }}
                    />
                  </span>
                </div>
                <div className="flex justify-between gap-2 font-medium">
                  <span>Total (exc VAT)</span>
                  <span className="tabular-nums">{formatPence(totals.netTotal)}</span>
                </div>
                <div className="flex justify-between gap-2 text-muted-foreground">
                  <span>VAT at {bpInput(quote.vatBp)}%</span>
                  <span className="tabular-nums">{formatPence(totals.vat)}</span>
                </div>
                <div className="flex justify-between gap-2 text-base font-semibold">
                  <span>Total (inc VAT)</span>
                  <span className="tabular-nums">{formatPence(totals.grossTotal)}</span>
                </div>
              </div>
              {/* What the job makes, which never goes near the client's copy. */}
              <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <span>Cost to us</span>
                  <span className="tabular-nums">{formatPence(totals.cost)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Contingency</span>
                  <span className="tabular-nums">{formatPence(totals.contingency)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Profit</span>
                  <span className="tabular-nums">{formatPence(totals.profit)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Margins</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(
                [
                  ["Contingency", "contingencyBp"],
                  ["Profit", "profitBp"],
                  ["Insurance", "insuranceBp"],
                  ["VAT", "vatBp"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex w-20 items-center gap-1">
                    <CellInput
                      align="right"
                      inputMode="decimal"
                      value={bpInput(quote[key])}
                      onCommit={(raw) => {
                        const bp = parsePercent(raw);
                        if (bp === null) {
                          toast.error("That is not a percentage.");
                          return;
                        }
                        return run(update({ id: quoteId, [key]: bp }), "Could not save it.");
                      }}
                    />
                    <span className="text-muted-foreground">%</span>
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Rates are the cost ×{multiplier.toFixed(3)}, rounded up to the nearest £5.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  void run(
                    repriceLines({ quoteId }).then((r) =>
                      toast.success(
                        r.repriced === 0
                          ? "Everything is already at these margins."
                          : `${r.repriced} line${r.repriced === 1 ? "" : "s"} re-priced.`
                      )
                    ),
                    "Could not re-price."
                  )
                }
              >
                Re-price the quote
              </Button>
              <p className="text-xs text-muted-foreground">
                Lines with a rate you set by hand are left alone.
              </p>
            </CardContent>
          </Card>

          <QuoteDetails quoteId={quoteId} data={data} />
        </div>
      </div>

      {adding && (
        <AddLineDialog quoteId={quoteId} category={adding} onClose={() => setAdding(null)} />
      )}
    </div>
  );
}

function EmptyCategory({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Button variant="ghost" size="sm" onClick={onAdd}>
        Add
      </Button>
    </div>
  );
}

function CategoryCard({
  quoteId,
  category,
  label,
  lines,
  subtotal,
  overrideTotal,
  onAdd,
}: {
  quoteId: Id<"quotes">;
  category: QuoteCategory;
  label: string;
  lines: QuoteData["lines"];
  subtotal: number;
  overrideTotal: number | null;
  onAdd: () => void;
}) {
  const updateLine = useMutation(api.quotes.updateLine);
  const removeLine = useMutation(api.quotes.removeLine);
  const setCategoryTotal = useMutation(api.quotes.setCategoryTotal);
  const [confirming, setConfirming] = useState<Id<"quoteLines"> | null>(null);

  async function save(work: Promise<unknown>, failure: string) {
    try {
      await work;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{label}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          Add
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium">Line</th>
                <th className="px-1 py-1.5 text-left font-medium">On the client&apos;s copy</th>
                <th className="px-1 py-1.5 text-right font-medium">How many</th>
                <th className="px-1 py-1.5 text-right font-medium">Units</th>
                <th className="px-1 py-1.5 text-left font-medium">Per</th>
                <th className="px-1 py-1.5 text-right font-medium">Cost</th>
                <th className="px-1 py-1.5 text-right font-medium">Rate</th>
                <th className="px-1 py-1.5 text-right font-medium">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line._id} className="border-b border-border last:border-0">
                  <td className="min-w-40 px-2 py-0.5">
                    <CellInput
                      value={line.name}
                      onCommit={(name) =>
                        save(updateLine({ id: line._id, name }), "Could not rename it.")
                      }
                    />
                    {line.notes && (
                      <p className="px-1.5 pb-1 text-xs text-muted-foreground">{line.notes}</p>
                    )}
                  </td>
                  <td className="min-w-32 px-1 py-0.5">
                    <CellInput
                      value={line.clientNotes ?? ""}
                      placeholder="—"
                      onCommit={(clientNotes) =>
                        save(
                          updateLine({ id: line._id, clientNotes }),
                          "Could not save the note."
                        )
                      }
                    />
                  </td>
                  <td className="w-20 px-1 py-0.5">
                    <CellInput
                      align="right"
                      inputMode="decimal"
                      value={String(line.pax)}
                      onCommit={(raw) => {
                        const pax = Number(raw);
                        if (!Number.isFinite(pax) || pax < 0) {
                          toast.error("That is not a number.");
                          return;
                        }
                        return save(updateLine({ id: line._id, pax }), "Could not save it.");
                      }}
                    />
                  </td>
                  <td className="w-20 px-1 py-0.5">
                    <CellInput
                      align="right"
                      inputMode="decimal"
                      value={String(line.unitAmount)}
                      onCommit={(raw) => {
                        const unitAmount = Number(raw);
                        if (!Number.isFinite(unitAmount) || unitAmount < 0) {
                          toast.error("That is not a number.");
                          return;
                        }
                        return save(
                          updateLine({ id: line._id, unitAmount }),
                          "Could not save it."
                        );
                      }}
                    />
                  </td>
                  <td className="w-24 px-1 py-0.5">
                    <Select
                      value={line.unit}
                      onValueChange={(v) =>
                        v &&
                        void save(
                          updateLine({
                            id: line._id,
                            unit: v as (typeof QUOTE_UNITS)[number]["value"],
                          }),
                          "Could not change the unit."
                        )
                      }
                    >
                      <SelectTrigger className="h-7 w-full border-0 bg-transparent px-1.5 text-xs shadow-none hover:bg-muted/60">
                        <SelectValue>{unitLabel(line.unit)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {QUOTE_UNITS.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="w-24 px-1 py-0.5">
                    <CellInput
                      align="right"
                      inputMode="decimal"
                      value={poundsInput(line.costPence)}
                      onCommit={(raw) => {
                        const costPence = parsePounds(raw);
                        if (costPence === null) {
                          toast.error("That is not a number.");
                          return;
                        }
                        return save(
                          updateLine({ id: line._id, costPence }),
                          "Could not save the cost."
                        );
                      }}
                    />
                  </td>
                  <td className="w-24 px-1 py-0.5">
                    <CellInput
                      align="right"
                      inputMode="decimal"
                      title={
                        line.rateOverridden
                          ? "Set by hand — a margin change leaves it alone. Clear it to go back to the derived rate."
                          : "Worked out from the cost and the margins."
                      }
                      className={line.rateOverridden ? "font-medium underline decoration-dotted" : undefined}
                      value={poundsInput(line.ratePence)}
                      onCommit={(raw) => {
                        if (raw.trim() === "") {
                          return save(
                            updateLine({ id: line._id, ratePence: null }),
                            "Could not reset it."
                          );
                        }
                        const ratePence = parsePounds(raw);
                        if (ratePence === null) {
                          toast.error("That is not a number.");
                          return;
                        }
                        return save(
                          updateLine({ id: line._id, ratePence }),
                          "Could not save the rate."
                        );
                      }}
                    />
                  </td>
                  <td className="w-28 px-2 py-0.5 text-right tabular-nums">
                    {formatPence(Math.round(line.ratePence * line.pax * line.unitAmount))}
                  </td>
                  <td className="w-16 px-1 py-0.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={confirming === line._id ? "text-destructive" : undefined}
                      onBlur={() => setConfirming(null)}
                      onClick={() => {
                        if (confirming !== line._id) {
                          setConfirming(line._id);
                          return;
                        }
                        setConfirming(null);
                        void save(removeLine({ id: line._id }), "Could not remove it.");
                      }}
                    >
                      {confirming === line._id ? "Sure?" : "×"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-3 pt-2 text-sm">
          <span className="text-muted-foreground">
            {overrideTotal === null ? "Subtotal" : "Set by hand"}
          </span>
          <span className="w-28">
            <CellInput
              align="right"
              inputMode="decimal"
              className={overrideTotal !== null ? "font-medium underline decoration-dotted" : "font-medium"}
              title="Type a total to land the category on a round number. The difference goes into the contingency. Clear it to go back to the sum of the lines."
              value={poundsInput(subtotal)}
              onCommit={(raw) => {
                if (raw.trim() === "") {
                  return save(
                    setCategoryTotal({ quoteId, category, totalPence: null }),
                    "Could not reset it."
                  );
                }
                const totalPence = parsePounds(raw);
                if (totalPence === null) {
                  toast.error("That is not a number.");
                  return;
                }
                return save(
                  setCategoryTotal({ quoteId, category, totalPence }),
                  "Could not set the total."
                );
              }}
            />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function QuoteDetails({ quoteId, data }: { quoteId: Id<"quotes">; data: QuoteData }) {
  const update = useMutation(api.quotes.update);
  const { quote } = data;

  function save(patch: Record<string, unknown>) {
    void update({ id: quoteId, ...patch }).catch((err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save it.")
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">The quote itself</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="quote-number" className="text-xs text-muted-foreground">
            Number
          </Label>
          <Input
            id="quote-number"
            defaultValue={quote.number}
            onBlur={(e) =>
              e.target.value !== quote.number && save({ number: e.target.value })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-type" className="text-xs text-muted-foreground">
            Type
          </Label>
          <Select
            value={quote.quoteType ?? "Ballpark"}
            onValueChange={(v) => v && save({ quoteType: v })}
          >
            <SelectTrigger id="quote-type" className="w-full">
              <SelectValue>{quote.quoteType ?? "Ballpark"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Ballpark">Ballpark</SelectItem>
              <SelectItem value="Firm">Firm</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-contact" className="text-xs text-muted-foreground">
            Client contact
          </Label>
          <Input
            id="quote-contact"
            defaultValue={quote.clientContact ?? ""}
            placeholder="Who it is going to"
            onBlur={(e) => save({ clientContact: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-deliverables" className="text-xs text-muted-foreground">
            Deliverables
          </Label>
          <Textarea
            id="quote-deliverables"
            rows={3}
            defaultValue={quote.deliverables ?? ""}
            placeholder="3x ~10min episodes, 9x social cutdowns…"
            onBlur={(e) => save({ deliverables: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Printed on the client&apos;s copy. Anything not listed is not quoted for.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-caveats" className="text-xs text-muted-foreground">
            Assumptions and caveats
          </Label>
          <Textarea
            id="quote-caveats"
            rows={6}
            defaultValue={(quote.caveats ?? []).join("\n")}
            placeholder={"- This quote is valid for 30 days.\n- Three edit amends are included per deliverable."}
            onBlur={(e) =>
              save({
                caveats: e.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0),
              })
            }
          />
          <p className="text-xs text-muted-foreground">One per line, in the order they print.</p>
        </div>
      </CardContent>
    </Card>
  );
}
