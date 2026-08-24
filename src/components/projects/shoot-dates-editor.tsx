"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";

/**
 * The project's shoot dates, shown prominently and edited as a range.
 *
 * A range is stored as one shootDay row per date, because call sheets, crew
 * recipients, weather and wrap notes all hang off individual days.
 */
export function ShootDatesEditor({ projectId }: { projectId: Id<"projects"> }) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const setRange = useMutation(api.shootDays.setRange);

  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);

  const dates = useMemo(() => (days ?? []).map((d) => d.date).sort(), [days]);
  const first = dates[0] ?? null;
  const last = dates.length > 0 ? dates[dates.length - 1] : null;

  function startEditing() {
    setFrom(first ?? "");
    setTo(last ?? first ?? "");
    setEditing(true);
  }

  async function handleSave() {
    if (!from || !to) {
      toast.error("Give the shoot a start and end date.");
      return;
    }
    if (from > to) {
      toast.error("The start date must not be after the end date.");
      return;
    }
    setSaving(true);
    try {
      const result = await setRange({ projectId, from, to });
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} day${result.created === 1 ? "" : "s"} added`);
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      toast.success(parts.length > 0 ? `Shoot dates updated: ${parts.join(", ")}.` : "Shoot dates unchanged.");

      // Days carrying a call sheet, crew or wrap notes are never deleted.
      if (result.kept.length > 0) {
        toast.warning(
          `Kept ${result.kept.map(formatShootDate).join(", ")} — ${
            result.kept.length === 1 ? "it has" : "they have"
          } a call sheet, crew or wrap notes. Remove those first if you really want the day gone.`,
          { duration: 10000 },
        );
      }
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the shoot dates.");
    } finally {
      setSaving(false);
    }
  }

  if (days === undefined) {
    return <Skeleton className="h-24 w-64" />;
  }

  return (
    <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 sm:min-w-64">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Shoot dates
      </p>

      {editing ? (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="space-y-1">
              <Label htmlFor="shoot-from" className="text-xs">
                From
              </Label>
              <Input
                id="shoot-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shoot-to" className="text-xs">
                To
              </Label>
              <Input
                id="shoot-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save dates"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {first === null ? (
            <p className="mt-1 font-heading text-xl font-semibold text-muted-foreground">
              Not scheduled
            </p>
          ) : (
            <>
              <p className="mt-1 font-heading text-xl font-semibold leading-tight">
                {first === last ? (
                  formatShootDate(first)
                ) : (
                  <>
                    {formatShootDate(first)}
                    <span className="text-muted-foreground"> – </span>
                    {formatShootDate(last!)}
                  </>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {dates.length} shoot day{dates.length === 1 ? "" : "s"}
              </p>
            </>
          )}
          <Button size="sm" variant="secondary" className="mt-2" onClick={startEditing}>
            {first === null ? "Set dates" : "Edit dates"}
          </Button>
        </>
      )}
    </div>
  );
}
