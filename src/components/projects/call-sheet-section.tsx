"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
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
 * Turn the production into a call sheet.
 *
 * Everything a call sheet needs is already on this page — the crew, the
 * talent, who booked it, the running order, the kit, the location and the
 * weather — so generating one is a matter of laying it out rather than filling
 * anything in. One per shoot day by default, or several dates combined onto
 * one sheet when the crew would rather carry a single document.
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
  const combinedSheets = useQuery(api.callSheets.combinedForProject, { projectId });
  const generate = useMutation(api.callSheets.generateFromProject);
  const [working, setWorking] = useState<Id<"shootDays"> | null>(null);
  const [combining, setCombining] = useState(false);

  async function handleGenerate(dayId: Id<"shootDays">) {
    setWorking(dayId);
    try {
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

  const ordered = [...(days ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map(ordered.map((day) => [day._id, day]));
  // Which combined sheet, if any, each date is printed on.
  const coveredBy = new Map<Id<"shootDays">, Id<"shootDays">>();
  const covering = new Map<Id<"shootDays">, number>();
  for (const sheet of combinedSheets ?? []) {
    covering.set(sheet.shootDayId, sheet.coversDayIds.length + 1);
    for (const id of sheet.coversDayIds) coveredBy.set(id, sheet.shootDayId);
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Call sheet</CardTitle>
      </CardHeader>
      <CardContent>
        {days === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Add a shoot date at the top of this page and a call sheet can be generated for it.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {ordered.map((day, i) => {
                const anchor = coveredBy.get(day._id);
                const anchorDay = anchor ? byId.get(anchor) : undefined;
                const dateCount = covering.get(day._id);
                return (
                  <li key={day._id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {formatShootDate(day.date)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {day.label ?? `Day ${i + 1}`}
                        {dateCount !== undefined && ` · Combined sheet covering ${dateCount} dates`}
                        {anchorDay && (
                          <>
                            {" · Also on the "}
                            <Link
                              href={`/projects/${projectRef}/shoot-days/${anchorDay._id}/call-sheet`}
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              combined sheet from {formatShootDate(anchorDay.date)}
                            </Link>
                          </>
                        )}
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
                      {working === day._id
                        ? "Generating…"
                        : dateCount !== undefined
                          ? "Regenerate combined sheet"
                          : "Generate call sheet"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {/* Always offered, not tucked away: one sheet for the whole shoot is
                as common an ask as one per day. */}
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium">Combined call sheet</span>
                <span className="block text-xs text-muted-foreground">
                  {ordered.length > 1
                    ? "Several dates on one sheet: the crew, kit and hotels once, each date with its own call, schedule and location."
                    : "Add a second shoot date to put several dates on one sheet."}
                </span>
              </span>
              <Button
                size="sm"
                onClick={() => setCombining(true)}
                disabled={ordered.length < 2 || working !== null}
              >
                Generate combined call sheet
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Generating lays out the crew, talent, client, running order, kit, location,
              accommodation and weather from this production. Edit it there, then send it by
              email or download it as a PDF.
            </p>
          </>
        )}
      </CardContent>

      {combining && (
        <CombineDialog
          days={ordered}
          projectRef={projectRef}
          onClose={() => setCombining(false)}
        />
      )}
    </Card>
  );
}

function CombineDialog({
  days,
  projectRef,
  onClose,
}: {
  days: Doc<"shootDays">[];
  projectRef: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const generateCombined = useMutation(api.callSheets.generateCombined);
  // Every date to start with: combining is usually "the whole shoot".
  const [picked, setPicked] = useState<Set<Id<"shootDays">>>(
    () => new Set(days.map((day) => day._id)),
  );
  const [busy, setBusy] = useState(false);

  function toggle(id: Id<"shootDays">) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function combine() {
    setBusy(true);
    try {
      const result = await generateCombined({ shootDayIds: [...picked] });
      toast.success(
        result.replacedDraft
          ? "Combined call sheet generated — the previous draft for that date is kept in its version history."
          : "Combined call sheet generated.",
      );
      onClose();
      router.push(`/projects/${projectRef}/shoot-days/${result.shootDayId}/call-sheet`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not combine them.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate a combined call sheet</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The crew, contacts, kit and accommodation are printed once; each date gets its own
          call time, schedule and location. The sheet is kept on the earliest date you pick.
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
          <Button onClick={() => void combine()} disabled={busy || picked.size < 2}>
            {busy
              ? "Combining…"
              : picked.size < 2
                ? "Pick at least two dates"
                : `Combine ${picked.size} dates`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
