"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";

/**
 * Turn the production into call sheets.
 *
 * Everything a call sheet needs is already on this page — the crew, the
 * talent, who booked it, the running order, the kit, the location and the
 * weather — so generating one is a matter of laying it out rather than filling
 * anything in. Each date has a sheet of its own, and the production can also
 * have one combined sheet covering several dates, opened from here like the
 * rest.
 */
export function CallSheetSection({
  projectId,
  projectRef,
}: {
  projectId: Id<"projects">;
  /** What the URL calls this project: its job number, or its id on old links. */
  projectRef: string;
}) {
  const router = useRouter();
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const combinedSheet = useQuery(api.callSheets.combinedForProject, { projectId });
  const generate = useMutation(api.callSheets.generateFromProject);
  const generateCombined = useMutation(api.callSheets.generateCombined);
  const refreshWeather = useAction(api.shootDays.refreshWeatherForProject);
  const [working, setWorking] = useState<Id<"shootDays"> | "combined" | null>(null);
  const [picking, setPicking] = useState(false);

  const combinedHref = `/projects/${projectRef}/call-sheets/combined`;

  /**
   * Brings every day's forecast up to date before a sheet is laid out, so the
   * weather printed is for each date. A weather service that is down must not
   * stop a call sheet being made, so a failure here is let go.
   */
  async function freshWeather() {
    await refreshWeather({ projectId }).catch(() => undefined);
  }

  async function handleGenerate(dayId: Id<"shootDays">) {
    setWorking(dayId);
    try {
      await freshWeather();
      const result = await generate({ shootDayId: dayId });
      toast.success(
        result.replacedDraft
          ? "Call sheet regenerated — the previous draft is kept in its version history."
          : "Call sheet generated.",
      );
      router.push(`/projects/${projectRef}/shoot-days/${dayId}/call-sheet`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate it.");
    } finally {
      setWorking(null);
    }
  }

  async function handleCombine(shootDayIds: Id<"shootDays">[]) {
    setWorking("combined");
    try {
      await freshWeather();
      const result = await generateCombined({ shootDayIds });
      toast.success(
        result.replacedDraft
          ? "Combined call sheet regenerated — the previous draft is kept in its version history."
          : "Combined call sheet generated.",
      );
      setPicking(false);
      router.push(combinedHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate it.");
    } finally {
      setWorking(null);
    }
  }

  const ordered = [...(days ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  // The dates the combined sheet was made for that are still on the production.
  const stillHere = new Set(ordered.map((day) => day._id));
  const combinedDayIds = (combinedSheet?.shootDayIds ?? []).filter((id) => stillHere.has(id));

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Call sheet</CardTitle>
      </CardHeader>
      <CardContent>
        {days === undefined || combinedSheet === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Add a shoot date at the top of this page and a call sheet can be generated for it.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {ordered.map((day, i) => (
                <li key={day._id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{formatShootDate(day.date)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {day.label ?? `Day ${i + 1}`}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    render={
                      <Link href={`/projects/${projectRef}/shoot-days/${day._id}/call-sheet`} />
                    }
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleGenerate(day._id)}
                    disabled={working !== null}
                  >
                    {working === day._id ? "Generating…" : "Generate call sheet"}
                  </Button>
                </li>
              ))}

              {/* The combined sheet sits with the dates, as a sheet of its own:
                  opened from here, not from inside Day 1. */}
              <li className="flex flex-wrap items-center gap-3 bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Combined call sheet</span>
                  <span className="block text-xs text-muted-foreground">
                    {combinedSheet
                      ? `${combinedSheet.dates.length} dates: ${combinedSheet.dates
                          .map((date) => formatShootDate(date))
                          .join(", ")}`
                      : ordered.length > 1
                        ? "Several dates on one sheet: the crew, kit and hotels once, each date with its own call, schedule, location and weather."
                        : "Add a second shoot date to put several dates on one sheet."}
                  </span>
                </span>
                {combinedSheet ? (
                  <>
                    <Button size="sm" variant="secondary" render={<Link href={combinedHref} />}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPicking(true)}
                      disabled={working !== null || ordered.length < 2}
                    >
                      Change dates
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleCombine(combinedDayIds)}
                      disabled={working !== null || combinedDayIds.length < 2}
                      title={
                        combinedDayIds.length < 2
                          ? "Some of its dates have been removed. Use Change dates."
                          : "Lay the sheet out again from the production, for the same dates."
                      }
                    >
                      {working === "combined" ? "Generating…" : "Regenerate"}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setPicking(true)}
                    disabled={ordered.length < 2 || working !== null}
                  >
                    Generate combined call sheet
                  </Button>
                )}
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Generating lays out the crew, talent, client, running order, kit, location,
              accommodation and weather from this production. Each date&apos;s own sheet and the
              combined sheet are separate: changing one does not change the other.
            </p>
          </>
        )}
      </CardContent>

      {picking && (
        <CombineDialog
          days={ordered}
          initial={combinedDayIds.length >= 2 ? combinedDayIds : ordered.map((day) => day._id)}
          busy={working === "combined"}
          onCombine={(ids) => void handleCombine(ids)}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}

function CombineDialog({
  days,
  initial,
  busy,
  onCombine,
  onClose,
}: {
  days: Doc<"shootDays">[];
  initial: Id<"shootDays">[];
  busy: boolean;
  onCombine: (ids: Id<"shootDays">[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<Id<"shootDays">>>(() => new Set(initial));

  function toggle(id: Id<"shootDays">) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dates on the combined call sheet</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The crew, contacts, kit and accommodation are printed once; each date gets its own call
          time, schedule, location and weather. Each date keeps its own call sheet as well.
        </p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {days.map((day, i) => (
            <li key={day._id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={picked.has(day._id)}
                  onChange={() => toggle(day._id)}
                  disabled={busy}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{formatShootDate(day.date)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {day.label ?? `Day ${i + 1}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onCombine([...picked])} disabled={busy || picked.size < 2}>
            {busy
              ? "Generating…"
              : picked.size < 2
                ? "Pick at least two dates"
                : `Generate for ${picked.size} dates`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
