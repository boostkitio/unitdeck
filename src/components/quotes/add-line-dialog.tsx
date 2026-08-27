"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/search-input";
import { matchesSearch } from "@/lib/search";
import { formatPence, parsePounds } from "@/lib/money";
import { QUOTE_UNITS, categoryLabel, unitLabel } from "@/lib/quote-labels";
import type { QuoteCategory } from "@/lib/quote-labels";

/**
 * Putting a line on a quote.
 *
 * Off the rate card by default, because that is where the price already is and
 * typing one again is how a quote goes out wrong. Typing one is still there for
 * the thing that has never been quoted before.
 *
 * The picker stays open after each pick: kit and crew are added in handfuls,
 * and a dialog that shuts after one is a dialog you open eleven times.
 */
export function AddLineDialog({
  quoteId,
  category,
  onClose,
}: {
  quoteId: Id<"quotes">;
  category: QuoteCategory;
  onClose: () => void;
}) {
  const items = useQuery(api.rateCard.list, {});
  const addFromRateCard = useMutation(api.quotes.addFromRateCard);
  const addLine = useMutation(api.quotes.addLine);

  const [mode, setMode] = useState<"card" | "own">("card");
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState(0);
  const [busy, setBusy] = useState(false);

  // Own line
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("day");
  const [cost, setCost] = useState("");
  const [rate, setRate] = useState("");
  const [pax, setPax] = useState("1");
  const [amount, setAmount] = useState("1");

  // Only this section's lines. Scrolling past 200 rows of kit to find a
  // producer is how the wrong line ends up under the wrong heading — and the
  // heading you clicked Add under has already said which part of the card you
  // meant.
  const forSection = (items ?? []).filter((item) => item.category === category);
  const shown = forSection.filter((item) =>
    matchesSearch(search, [item.name, item.notes, item.section])
  );

  async function pick(itemId: Id<"rateCardItems">) {
    setBusy(true);
    try {
      await addFromRateCard({ quoteId, itemIds: [itemId] });
      setAdded((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  async function saveOwn() {
    if (name.trim().length === 0) {
      toast.error("Name the line.");
      return;
    }
    const costPence = cost.trim() === "" ? 0 : parsePounds(cost);
    if (costPence === null) {
      toast.error("The cost is not a number.");
      return;
    }
    const ratePence = rate.trim() === "" ? undefined : parsePounds(rate);
    if (rate.trim() !== "" && ratePence === null) {
      toast.error("The rate is not a number.");
      return;
    }
    setBusy(true);
    try {
      await addLine({
        quoteId,
        category,
        name,
        unit: unit as (typeof QUOTE_UNITS)[number]["value"],
        pax: Number(pax) || 1,
        unitAmount: Number(amount) || 1,
        costPence,
        ratePence: ratePence ?? undefined,
      });
      toast.success(`${name.trim()} added.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-full max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add to {categoryLabel(category)}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border pb-3">
          <Button
            size="sm"
            variant={mode === "card" ? "secondary" : "ghost"}
            onClick={() => setMode("card")}
          >
            From the rate card
          </Button>
          <Button
            size="sm"
            variant={mode === "own" ? "secondary" : "ghost"}
            onClick={() => setMode("own")}
          >
            Something else
          </Button>
        </div>

        {mode === "card" ? (
          <div className="space-y-3 py-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={`Search ${categoryLabel(category).toLowerCase()}…`}
            />
            {items === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : shown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? "The rate card is empty — fill it in first."
                  : forSection.length === 0
                    ? `Nothing on the rate card is filed under ${categoryLabel(category)}.`
                    : `Nothing here matches “${search}”.`}
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {shown.map((item) => (
                  <li key={item._id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void pick(item._id)}
                      className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{item.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.section}
                          {item.notes ? ` — ${item.notes}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        <span className="block tabular-nums">{formatPence(item.costPence)}</span>
                        <span className="block">per {unitLabel(item.unit).toLowerCase()}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="line-name">Line</Label>
              <Input
                id="line-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stock licensing, studio hire, courier…"
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="line-cost">Cost (what we pay)</Label>
                <Input
                  id="line-cost"
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="£"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line-rate">Client rate</Label>
                <Input
                  id="line-rate"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="Leave blank to add the margins"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line-pax">How many</Label>
                <Input
                  id="line-pax"
                  inputMode="numeric"
                  value={pax}
                  onChange={(e) => setPax(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line-amount">Units each</Label>
                <Input
                  id="line-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Per</Label>
              <Select value={unit} onValueChange={(v) => v && setUnit(v)}>
                <SelectTrigger className="w-40">
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
              <p className="text-xs text-muted-foreground">
                Setting a client rate pins the line, so a margin change leaves it alone.
                That is how a pass-through such as stock licensing is quoted at cost.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {added > 0 && `${added} added`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {added > 0 ? "Done" : "Cancel"}
            </Button>
            {mode === "own" && (
              <Button onClick={() => void saveOwn()} disabled={busy}>
                {busy ? "Adding…" : "Add"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
