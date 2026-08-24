"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthCalendar, useToday, type DayState } from "@/components/ui/month-calendar";
import { monthOf, type Month } from "@/lib/calendar";
import { formatShootDate } from "@/lib/format-date";

/**
 * The project's shoot dates, shown prominently and picked on a calendar.
 *
 * One click sets the start, a second sets the end — the same day twice is a
 * single day. A range is stored as one shootDay row per date, because call
 * sheets, crew recipients, weather and wrap notes all hang off individual days.
 */
export function ShootDatesEditor({ projectId }: { projectId: Id<"projects"> }) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const setRange = useMutation(api.shootDays.setRange);
  const today = useToday();

  const [editing, setEditing] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [monthOverride, setMonthOverride] = useState<Month | null>(null);
  const [saving, setSaving] = useState(false);

  const dates = useMemo(() => (days ?? []).map((d) => d.date).sort(), [days]);
  const first = dates[0] ?? null;
  const last = dates.length > 0 ? dates[dates.length - 1] : null;
  const existing = useMemo(() => new Set(dates), [dates]);

  // Open on the shoot's own month when there is one, otherwise this month.
  const anchor = first ?? today;
  const month = monthOverride ?? (anchor ? monthOf(anchor) : null);

  function startEditing() {
    setPendingStart(null);
    setMonthOverride(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setPendingStart(null);
  }

  async function commit(from: string, to: string) {
    setSaving(true);
    try {
      const result = await setRange({ projectId, from, to });
      const parts: string[] = [];
      if (result.created > 0) {
        parts.push(`${result.created} day${result.created === 1 ? "" : "s"} added`);
      }
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      toast.success(
        parts.length > 0 ? `Shoot dates updated: ${parts.join(", ")}.` : "Shoot dates unchanged.",
      );

      // Days carrying a call sheet, crew or wrap notes are never deleted.
      if (result.kept.length > 0) {
        toast.warning(
          `Kept ${result.kept.map(formatShootDate).join(", ")} — ${
            result.kept.length === 1 ? "it has" : "they have"
          } a call sheet, crew or wrap notes. Remove those first if you really want the day gone.`,
          { duration: 10000 },
        );
      }
      cancel();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the shoot dates.");
    } finally {
      setSaving(false);
    }
  }

  function handleDayClick(key: string) {
    if (saving) return;
    if (pendingStart === null) {
      setPendingStart(key);
      return;
    }
    // Second click closes the range. Clicking earlier than the start is read
    // as picking a new range end-first rather than as a mistake.
    const from = key < pendingStart ? key : pendingStart;
    const to = key < pendingStart ? pendingStart : key;
    void commit(from, to);
  }

  const dayState = (key: string): DayState => {
    if (pendingStart !== null) {
      return { selected: key === pendingStart, dots: existing.has(key) ? 1 : 0 };
    }
    const isEndpoint = key === first || key === last;
    const between = first !== null && last !== null && key > first && key < last;
    return {
      selected: isEndpoint,
      inRange: between || (isEndpoint && first !== last),
      dots: existing.has(key) ? 1 : 0,
    };
  };

  if (days === undefined) {
    return <Skeleton className="h-28 w-64" />;
  }

  return (
    <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 sm:w-80">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Shoot dates
      </p>

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

      {editing && month ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-2">
          <MonthCalendar
            month={month}
            onMonthChange={setMonthOverride}
            today={today}
            dayState={dayState}
            onDayClick={handleDayClick}
            onTodayClick={() => setMonthOverride(today ? monthOf(today) : null)}
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">
              {saving
                ? "Saving…"
                : pendingStart === null
                  ? "Pick the first day"
                  : `${formatShootDate(pendingStart)} — pick the last day, or the same day again for one day`}
            </p>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="mt-2" onClick={startEditing}>
          {first === null ? "Set dates" : "Edit dates"}
        </Button>
      )}
    </div>
  );
}
