"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatShootDate } from "@/lib/format-date";

/**
 * Turn the production into a call sheet.
 *
 * Everything a call sheet needs is already on this page — the crew, the
 * talent, who booked it, the running order, the kit, the location and the
 * weather — so generating one is a matter of laying it out rather than filling
 * anything in. One per shoot day, because that is what a call sheet is.
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
  const generate = useMutation(api.callSheets.generateFromProject);
  const [working, setWorking] = useState<Id<"shootDays"> | null>(null);

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
              {ordered.map((day, i) => (
                <li
                  key={day._id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {formatShootDate(day.date)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {day.label ?? `Day ${i + 1}`}
                    </span>
                  </span>
                  <DayTimes day={day} />
                  <Button
                    size="sm"
                    variant="secondary"
                    render={
                      <Link
                        href={`/projects/${projectRef}/shoot-days/${day._id}/call-sheet`}
                      />
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
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Generating lays out the crew, talent, client, running order, kit, location and
              weather from this production. Edit it there, then send it by email or download
              it as a PDF.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * When the unit is called and when it wraps.
 *
 * Here rather than on its own screen because this is the one list of a
 * production's days, and the times are the two facts about a day that
 * everything else wants: the call sheet prints them, and a crew member's
 * calendar entry runs between them. A day with neither is a whole-day entry,
 * which is the honest answer before the times are known.
 *
 * Native time boxes: they commit a whole value at a time rather than a
 * keystroke, so saving on change is safe and a colleague's edit lands here
 * without anything to reconcile.
 */
function DayTimes({
  day,
}: {
  day: { _id: Id<"shootDays">; callTime?: string; wrapTime?: string };
}) {
  const update = useMutation(api.shootDays.update);

  function save(field: "callTime" | "wrapTime", value: string) {
    void update({ id: day._id, [field]: value === "" ? null : value }).catch(
      (err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not save the time.")
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="flex items-center gap-1.5">
        <Label htmlFor={`call-${day._id}`} className="text-xs text-muted-foreground">
          Call
        </Label>
        <Input
          id={`call-${day._id}`}
          type="time"
          value={day.callTime ?? ""}
          onChange={(e) => save("callTime", e.target.value)}
          className="h-8 w-28 px-2 text-sm"
        />
      </span>
      <span className="flex items-center gap-1.5">
        <Label htmlFor={`wrap-${day._id}`} className="text-xs text-muted-foreground">
          Wrap
        </Label>
        <Input
          id={`wrap-${day._id}`}
          type="time"
          value={day.wrapTime ?? ""}
          onChange={(e) => save("wrapTime", e.target.value)}
          className="h-8 w-28 px-2 text-sm"
        />
      </span>
    </span>
  );
}
