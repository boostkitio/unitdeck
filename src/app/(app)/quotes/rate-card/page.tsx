"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "@/components/search-input";
import { CellInput } from "@/components/quotes/cell-input";
import { matchesSearch } from "@/lib/search";
import { formatPence, parsePercent, parsePounds, poundsInput } from "@/lib/money";
import {
  QUOTE_CATEGORIES,
  QUOTE_UNITS,
  categoryLabel,
  unitLabel,
  type QuoteCategory,
} from "@/lib/quote-labels";
import { rateFromCost } from "../../../../../convex/lib/quoteMath";

/**
 * The rate card.
 *
 * Costs are the thing that is maintained; the client rate beside each one is
 * worked out, not stored, so you can see what a margin change does to the
 * whole card before you put it on a quote. The margins at the top are a
 * preview — they belong to a quote, not to the card.
 */
export default function RateCardPage() {
  const { organization } = useOrganization();
  const items = useQuery(api.rateCard.list, organization ? {} : "skip");
  // The headings each category already uses, so a new line joins one rather
  // than inventing a heading of its own that nothing else shares.
  const sectionsByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of items ?? []) {
      const held = map.get(item.category) ?? [];
      if (!held.includes(item.section)) held.push(item.section);
      map.set(item.category, held);
    }
    return map;
  }, [items]);
  const add = useMutation(api.rateCard.add);
  const update = useMutation(api.rateCard.update);
  const remove = useMutation(api.rateCard.remove);
  const seed = useMutation(api.rateCard.seed);
  const rebuild = useMutation(api.rateCard.rebuild);
  const audit = useQuery(api.rateCard.audit, organization ? {} : "skip");
  const removeNonStandard = useMutation(api.rateCard.removeNonStandard);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [contingency, setContingency] = useState("10");
  const [profit, setProfit] = useState("10");
  const [insurance, setInsurance] = useState("0.3");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Id<"rateCardItems"> | null>(null);

  const margins = useMemo(
    () => ({
      contingencyBp: parsePercent(contingency) ?? 0,
      profitBp: parsePercent(profit) ?? 0,
      insuranceBp: parsePercent(insurance) ?? 0,
    }),
    [contingency, profit, insurance]
  );
  const multiplier = 1 + (margins.contingencyBp + margins.profitBp + margins.insuranceBp) / 10_000;

  const shown = (items ?? []).filter(
    (item) =>
      (category === "all" || item.category === category) &&
      matchesSearch(search, [item.name, item.notes, item.section, categoryLabel(item.category)])
  );

  // Grouped the way the card is laid out, so it reads like the sheet it came
  // from rather than like a database table.
  const bySection = useMemo(() => {
    const map = new Map<string, typeof shown>();
    for (const item of shown) {
      const bucket = map.get(item.section) ?? [];
      bucket.push(item);
      map.set(item.section, bucket);
    }
    return [...map.entries()];
  }, [shown]);

  async function run(work: Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await work;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Rate card</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What everything costs. What a client is charged is worked out from it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" render={<Link href="/quotes" />}>
            Back to quotes
          </Button>
          <RebuildDialog
            onRebuild={async () => {
              const result = await rebuild({});
              toast.success(`Rebuilt: ${result.added} lines, exactly as the sheet has them.`, {
                description: `${result.removed} replaced.`,
              });
            }}
          />
          <AddLineDialog
            sections={sectionsByCategory}
            onAdd={async (line) => {
              await add(line);
              toast.success("Line added — set the cost on it.");
            }}
          />
        </div>
      </div>

      {audit && (audit.extra.length > 0 || audit.missing.length > 0) && (
        <div className="mt-6 rounded-lg border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">
            This card has {audit.total} lines. The standard one has {audit.standardTotal}.
          </p>
          {audit.extra.length > 0 && (
            <p className="mt-1 text-xs">
              {audit.extra.length} are not on it —{" "}
              {audit.extra
                .slice(0, 4)
                .map((row) => `${row.name} (${row.section})`)
                .join(", ")}
              {audit.extra.length > 4 ? ", and others" : ""}. These are rows left over from an
              older version of the card, under headings it no longer uses.
            </p>
          )}
          {audit.missing.length > 0 && (
            <p className="mt-1 text-xs">{audit.missing.length} standard lines are missing.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {audit.extra.length > 0 && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    removeNonStandard({}).then((r) =>
                      toast.success(`${r.removed} line${r.removed === 1 ? "" : "s"} removed.`)
                    ),
                    "Could not remove them."
                  )
                }
              >
                Remove the {audit.extra.length} that do not belong
              </Button>
            )}
            {audit.missing.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    seed({}).then((r) =>
                      toast.success(`${r.added} line${r.added === 1 ? "" : "s"} added.`)
                    ),
                    "Could not add them."
                  )
                }
              >
                Add the {audit.missing.length} missing
              </Button>
            )}
          </div>
        </div>
      )}

      {/* The margins are a preview: they live on a quote, not on the card. */}
      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">
          Showing rates at
        </p>
        {[
          { label: "Contingency", value: contingency, set: setContingency },
          { label: "Profit", value: profit, set: setProfit },
          { label: "Insurance", value: insurance, set: setInsurance },
        ].map((field) => (
          <label key={field.label} className="text-xs">
            <span className="mb-1 block text-muted-foreground">{field.label}</span>
            <span className="flex items-center gap-1">
              <input
                value={field.value}
                onChange={(e) => field.set(e.target.value)}
                inputMode="decimal"
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
              />
              <span className="text-muted-foreground">%</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          — a ×{multiplier.toFixed(3)} multiplier, rounded up to the nearest £5.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search the card…"
          className="max-w-sm"
        />
        <Select value={category} onValueChange={(v) => v && setCategory(v)}>
          <SelectTrigger className="w-56">
            <SelectValue>
              {category === "all" ? "Every category" : categoryLabel(category)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every category</SelectItem>
            {QUOTE_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {shown.length} line{shown.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="mt-4">
        {items === undefined ? (
          <Skeleton className="h-96 w-full" />
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted-foreground">
              The rate card is empty. Start it from the one this replaces, then edit
              anything that has moved on.
            </p>
            <Button
              size="sm"
              className="mt-4"
              disabled={busy}
              onClick={() =>
                void run(
                  seed({}).then((r) => toast.success(`${r.added} lines added.`)),
                  "Could not fill the card."
                )
              }
            >
              Fill from the standard card
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {bySection.map(([section, rows]) => (
              <div key={section} className="overflow-x-auto rounded-lg border border-border">
                <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  {section}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableCell className="font-medium">Line</TableCell>
                      <TableCell className="font-medium">Notes</TableCell>
                      <TableCell className="font-medium">Category</TableCell>
                      <TableCell className="font-medium">Per</TableCell>
                      <TableCell className="text-right font-medium">Cost</TableCell>
                      <TableCell className="text-right font-medium">Client rate</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((item) => (
                      <TableRow key={item._id}>
                        <TableCell className="min-w-48 p-1">
                          <CellInput
                            value={item.name}
                            onCommit={(name) =>
                              run(update({ id: item._id, name }), "Could not rename it.")
                            }
                          />
                        </TableCell>
                        <TableCell className="min-w-40 p-1">
                          <CellInput
                            value={item.notes ?? ""}
                            placeholder="—"
                            onCommit={(notes) =>
                              run(update({ id: item._id, notes }), "Could not save the note.")
                            }
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Select
                            value={item.category}
                            onValueChange={(v) =>
                              v &&
                              void run(
                                update({
                                  id: item._id,
                                  category: v as (typeof QUOTE_CATEGORIES)[number]["value"],
                                }),
                                "Could not move it."
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-44 text-xs">
                              <SelectValue>{categoryLabel(item.category)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {QUOTE_CATEGORIES.map((c) => (
                                <SelectItem key={c.value} value={c.value}>
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Select
                            value={item.unit}
                            onValueChange={(v) =>
                              v &&
                              void run(
                                update({
                                  id: item._id,
                                  unit: v as (typeof QUOTE_UNITS)[number]["value"],
                                }),
                                "Could not change the unit."
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-28 text-xs">
                              <SelectValue>{unitLabel(item.unit)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {QUOTE_UNITS.map((u) => (
                                <SelectItem key={u.value} value={u.value}>
                                  {u.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="w-28 p-1">
                          <CellInput
                            align="right"
                            inputMode="decimal"
                            value={poundsInput(item.costPence)}
                            onCommit={(raw) => {
                              const costPence = parsePounds(raw);
                              if (costPence === null) {
                                toast.error("That is not a number.");
                                return;
                              }
                              return run(
                                update({ id: item._id, costPence }),
                                "Could not save the cost."
                              );
                            }}
                          />
                        </TableCell>
                        <TableCell className="w-28 text-right tabular-nums text-muted-foreground">
                          {item.costPence === 0
                            ? "—"
                            : formatPence(rateFromCost(item.costPence, margins))}
                        </TableCell>
                        <TableCell className="w-20 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={confirming === item._id ? "text-destructive" : undefined}
                            onBlur={() => setConfirming(null)}
                            onClick={() => {
                              if (confirming !== item._id) {
                                setConfirming(item._id);
                                return;
                              }
                              setConfirming(null);
                              void run(remove({ id: item._id }), "Could not remove it.");
                            }}
                          >
                            {confirming === item._id ? "Sure?" : "Remove"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/**
 * Putting the card back to the standard one.
 *
 * Behind a confirmation because it is not an undo: a cost somebody has edited
 * goes with everything else. It is here for the card that has drifted — rows
 * from an older version of the standard list that nothing matches any more,
 * which is the one mess that cannot be tidied line by line.
 */
function RebuildDialog({ onRebuild }: { onRebuild: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  async function run() {
    setWorking(true);
    try {
      await onRebuild();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rebuild it.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Rebuild from the standard card
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => (!next ? setOpen(false) : undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rebuild the rate card?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm text-muted-foreground">
              <p>
                Every line goes and the standard card is written out again — the same 279 lines
                the quote sheet has, in its order, under its headings.
              </p>
              <p>
                Any cost you have edited here goes with it. Quotes are not touched: their lines
                are copies with their own figures, so a quote already sent still says what it
                said.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={working} onClick={() => void run()}>
                {working ? "Rebuilding…" : "Rebuild"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}


/**
 * Adding a line, which means saying where it goes.
 *
 * The old button dropped everything into Production Crew and left you to
 * move it, which for a card of eighteen headings is a guess followed by a
 * correction. Category and heading are asked for up front, and the headings
 * offered are the ones that category already uses.
 */
function AddLineDialog({
  sections,
  onAdd,
}: {
  sections: Map<string, string[]>;
  onAdd: (line: {
    category: QuoteCategory;
    section: string;
    name: string;
    unit: (typeof QUOTE_UNITS)[number]["value"];
    costPence: number;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<QuoteCategory>("production");
  const [section, setSection] = useState<string>("");
  const [newSection, setNewSection] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<(typeof QUOTE_UNITS)[number]["value"]>("day");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const available = sections.get(category) ?? [];
  const chosen = section === NEW_SECTION ? newSection.trim() : section || available[0] || "";
  const ready = name.trim().length > 0 && chosen.length > 0;

  async function submit() {
    setSaving(true);
    try {
      await onAdd({
        category,
        section: chosen,
        name: name.trim(),
        unit,
        costPence: Math.round((Number(cost) || 0) * 100),
      });
      setName("");
      setCost("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add line
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => (!next ? setOpen(false) : undefined)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add a line to the rate card</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(value) => {
                    if (!value) return;
                    setCategory(value as QuoteCategory);
                    setSection("");
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{categoryLabel(category)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {QUOTE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Heading</Label>
                <Select
                  value={section || available[0] || NEW_SECTION}
                  onValueChange={(value) => value && setSection(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {section === NEW_SECTION ? "A new heading…" : section || available[0] || "A new heading…"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SECTION}>A new heading…</SelectItem>
                  </SelectContent>
                </Select>
                {section === NEW_SECTION && (
                  <Input
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value.toUpperCase())}
                    placeholder="DRONE"
                    autoFocus
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-line-name">Line</Label>
                <Input
                  id="new-line-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sound Op (with kit)"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Per</Label>
                  <Select
                    value={unit}
                    onValueChange={(value) =>
                      value && setUnit(value as (typeof QUOTE_UNITS)[number]["value"])
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{unitLabel(unit)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {QUOTE_UNITS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-line-cost">Cost to us</Label>
                  <Input
                    id="new-line-cost"
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!ready || saving} onClick={() => void submit()}>
                {saving ? "Adding…" : "Add line"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Sentinel for "not one of the headings already there". */
const NEW_SECTION = "__new__";
