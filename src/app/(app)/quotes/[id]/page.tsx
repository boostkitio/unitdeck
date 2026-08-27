"use client";

import { use, useCallback, useState } from "react";
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
import { saveStateLabel, useSyncedField } from "@/lib/use-debounced-save";
import { AddLineDialog } from "@/components/quotes/add-line-dialog";
import { QuoteStatusChip } from "../page";
import { formatPence, bpInput, parsePercent, parsePounds, poundsInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { NEW_CLIENT, NewClientDialog } from "@/components/clients/new-client-dialog";
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
  const newVersion = useMutation(api.quotes.newVersion);
  const saveName = useCallback(
    async (value: string) => {
      await update({ id: quoteId, title: value });
    },
    [update, quoteId]
  );
  // Follows the stored title while nobody is typing, so a colleague's rename
  // shows rather than being masked by a stale box.
  const {
    value: name,
    setValue: setName,
    state: nameState,
  } = useSyncedField(data.quote.title ?? "", saveName);
  const [adding, setAdding] = useState<QuoteCategory | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);
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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* The name is the title field, edited where it is read — the same
                as a production's. */}
            <label htmlFor="quote-name" className="sr-only">
              Quote name
            </label>
            <input
              id="quote-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={quote.number}
              className="w-full max-w-xl rounded-md border border-transparent bg-transparent px-2 py-1 font-heading text-2xl font-semibold tracking-tight outline-none transition-colors hover:border-border focus:border-border focus:bg-background sm:text-3xl"
            />
            <QuoteStatusChip status={quote.status} />
          </div>
          <p className="mt-1 px-2 text-sm text-muted-foreground">
            {saveStateLabel(nameState) && (
              <span className="mr-2 text-xs">{saveStateLabel(nameState)}</span>
            )}
            <span className="font-mono text-xs">{quote.number}</span>
            {" · "}
            {data.project ? (
              <Link href={`/projects/${data.project._id}`} className="hover:underline">
                {data.project.name}
              </Link>
            ) : (
              // Not an error: a quote is usually written before there is a job
              // to hang it on. It is put on one from the production itself.
              "Not on a production yet"
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
            variant="secondary"
            size="sm"
            disabled={busy}
            title="Copies this quote as the next version, leaving what was sent exactly as it went out."
            onClick={() =>
              void run(
                newVersion({ id: quoteId }).then((id) => router.push(`/quotes/${id}`)),
                "Could not start a new version."
              )
            }
          >
            New version
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
          <QuoteDetails quoteId={quoteId} data={data} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !data.project}
              title={
                data.project
                  ? undefined
                  : "Put this quote on a production first, from the production's Quotes section."
              }
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
              disabled={busy || !data.project}
              title={
                data.project
                  ? undefined
                  : "Put this quote on a production first, from the production's Quotes section."
              }
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
            {!data.project && (
              <p className="text-xs text-muted-foreground">
                Put this quote on a production — from that production&apos;s Quotes section —
                to pull its crew and kit in.
              </p>
            )}
            {/* Everything chargeable is listed so nothing is forgotten. Once
                it is priced, the empty lines are just in the way. */}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setHideEmpty((on) => !on)}
            >
              {hideEmpty ? "Show every line" : "Hide unpriced lines"}
            </Button>
          </div>

          {QUOTE_CATEGORIES.map((category) => {
            const lines = data.lines.filter((l) => l.category === category.value);
            const cat = data.byCategory.find((c) => c.category === category.value)!;
            const override = data.overrides.find((o) => o.category === category.value);
            if (lines.length === 0) {
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
                hideEmpty={hideEmpty}
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
                Every line moves, including any rate you set by hand.
              </p>
            </CardContent>
          </Card>

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
      <Button size="sm" onClick={onAdd}>
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
  hideEmpty,
  onAdd,
}: {
  quoteId: Id<"quotes">;
  category: QuoteCategory;
  label: string;
  lines: QuoteData["lines"];
  subtotal: number;
  overrideTotal: number | null;
  hideEmpty: boolean;
  onAdd: () => void;
}) {
  const updateLine = useMutation(api.quotes.updateLine);
  const removeLine = useMutation(api.quotes.removeLine);
  const setCategoryTotal = useMutation(api.quotes.setCategoryTotal);
  const [confirming, setConfirming] = useState<Id<"quoteLines"> | null>(null);

  const priced = lines.filter((l) => l.pax > 0 && l.unitAmount > 0);
  const shown = hideEmpty ? priced : lines;

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
        <CardTitle className="flex items-baseline gap-2 text-base">
          {label}
          <span className="text-xs font-normal text-muted-foreground">
            {priced.length} of {lines.length} priced
          </span>
        </CardTitle>
        <Button size="sm" onClick={onAdd}>
          Add
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium">Line</th>
                <th className="px-1 py-1.5 text-left font-medium">Notes</th>
                <th className="px-1 py-1.5 text-right font-medium">Pax</th>
                <th className="px-1 py-1.5 text-right font-medium">Units</th>
                <th className="px-1 py-1.5 text-left font-medium">Per</th>
                <th className="px-1 py-1.5 text-right font-medium">Cost</th>
                <th className="px-1 py-1.5 text-right font-medium">Rate</th>
                <th className="px-1 py-1.5 text-right font-medium">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => {
                // Nothing against it means it is not on the quote — the same
                // as an empty row on the sheet this replaces. It stays visible
                // so it can be priced, but it reads as what it is.
                const priced = line.pax > 0 && line.unitAmount > 0;
                return (
                <tr
                  key={line._id}
                  className={cn(
                    "border-b border-border last:border-0",
                    !priced && "text-muted-foreground"
                  )}
                >
                  <td className="min-w-40 px-2 py-0.5">
                    <CellInput
                      value={line.name}
                      onCommit={(name) =>
                        save(updateLine({ id: line._id, name }), "Could not rename it.")
                      }
                    />
                    {line.notes && (
                      <p className="truncate px-1.5 pb-1 text-xs text-muted-foreground">
                        {line.notes}
                      </p>
                    )}
                  </td>
                  <td className="min-w-32 px-1 py-0.5">
                    <CellInput
                      value={line.clientNotes ?? ""}
                      placeholder="—"
                      title="Printed against this line on the client's copy."
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
                      placeholder="—"
                      value={line.pax === 0 ? "" : String(line.pax)}
                      onCommit={(raw) => {
                        const pax = raw.trim() === "" ? 0 : Number(raw);
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
                      placeholder="—"
                      value={line.unitAmount === 0 ? "" : String(line.unitAmount)}
                      onCommit={(raw) => {
                        const unitAmount = raw.trim() === "" ? 0 : Number(raw);
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
                      title="What it costs us. The rate follows it."
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
                          ? "Set by hand, so the cost was worked out backwards from it and a margin change leaves it alone. Clear it to go back to the rate the card gives."
                          : "Worked out from the cost and the margins. Type over it and the cost follows backwards."
                      }
                      className={
                        line.rateOverridden ? "font-medium underline decoration-dotted" : undefined
                      }
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
                    {priced
                      ? formatPence(Math.round(line.ratePence * line.pax * line.unitAmount))
                      : "—"}
                  </td>
                  <td className="w-14 px-1 py-0.5 text-right">
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
                );
              })}
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

const NOBODY = "nobody";

function QuoteDetails({ quoteId, data }: { quoteId: Id<"quotes">; data: QuoteData }) {
  const update = useMutation(api.quotes.update);
  const clients = useQuery(api.clients.list, {});
  const [addingClient, setAddingClient] = useState(false);
  const { quote } = data;
  const contacts = (clients ?? []).find((c) => c._id === quote.clientId)?.contacts ?? [];

  function save(patch: Record<string, unknown>) {
    void update({ id: quoteId, ...patch }).catch((err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save it.")
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Details</CardTitle>
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
          <Label className="text-xs text-muted-foreground">Client</Label>
          <Select
            value={quote.clientId ?? NOBODY}
            onValueChange={(value) => {
              if (!value) return;
              if (value === NEW_CLIENT) {
                setAddingClient(true);
                return;
              }
              save({ clientId: value === NOBODY ? null : (value as Id<"clients">) });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{quote.clientName ?? "Nobody yet"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>Nobody yet</SelectItem>
              {(clients ?? []).map((client) => (
                <SelectItem key={client._id} value={client._id}>
                  {client.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW_CLIENT}>+ Add a new client…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-contact" className="text-xs text-muted-foreground">
            Client contact
          </Label>
          {contacts.length > 0 ? (
            <Select
              value={quote.clientContact ?? NOBODY}
              onValueChange={(value) =>
                value && save({ clientContact: value === NOBODY ? null : value })
              }
            >
              <SelectTrigger id="quote-contact" className="w-full">
                <SelectValue>{quote.clientContact ?? "Nobody named"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOBODY}>Nobody named</SelectItem>
                {contacts.map((contact, i) => (
                  <SelectItem key={i} value={contact.name}>
                    {contact.role ? `${contact.name} — ${contact.role}` : contact.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="quote-contact"
              defaultValue={quote.clientContact ?? ""}
              placeholder={
                quote.clientId ? "No contacts on that client yet" : "Who it is going to"
              }
              onBlur={(e) => save({ clientContact: e.target.value })}
            />
          )}
        </div>

        {addingClient && (
          <NewClientDialog
            onClose={() => setAddingClient(false)}
            onCreated={(clientId) => save({ clientId })}
          />
        )}
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
