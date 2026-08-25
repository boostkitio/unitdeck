"use client";

import { useMemo, useRef, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatShootDate } from "@/lib/format-date";
import { matchDay, parseSchedule, type ParsedScheduleLine } from "@/lib/parse-schedule";

type ShootDay = { _id: Id<"shootDays">; date: string; label?: string };

const ANY_DAY = "any";

function dayName(day: ShootDay): string {
  return day.label ? `${formatShootDate(day.date)} — ${day.label}` : formatShootDate(day.date);
}

/**
 * Paste in a schedule somebody else wrote and see it as rows before it lands.
 *
 * The preview is the point: reading a running order is guesswork at the edges,
 * so every line is shown with the time and day it was read as, and any of them
 * can be corrected before a single row is written.
 */
export function ScheduleImportDialog({
  projectId,
  onClose,
}: {
  projectId: Id<"projects">;
  onClose: () => void;
}) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const addMany = useMutation(api.schedule.addMany);
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  // Corrections to what was read, by line number. Cleared whenever the text
  // changes, since the line numbers then mean something else.
  const [dayOverrides, setDayOverrides] = useState<Record<number, string>>({});
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  const ordered = useMemo(
    () => [...(days ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [days],
  );
  const lines = useMemo(() => parseSchedule(text), [text]);

  function readText(next: string) {
    setText(next);
    setDayOverrides({});
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      readText(await file.text());
    } catch {
      toast.error("Could not read that file. Open it and paste the text instead.");
    }
  }

  function dayFor(line: ParsedScheduleLine, i: number): string {
    const override = dayOverrides[i];
    if (override !== undefined) return override;
    return matchDay(line, ordered)?._id ?? ANY_DAY;
  }

  const matched = lines.filter((line, i) => dayFor(line, i) !== ANY_DAY).length;
  const timed = lines.filter((l) => l.time !== null).length;

  async function handleAdd() {
    if (lines.length === 0) {
      toast.error("Nothing to add yet — paste a schedule first.");
      return;
    }
    setSaving(true);
    try {
      const result = await addMany({
        projectId,
        replace,
        items: lines.map((line, i) => {
          const day = dayFor(line, i);
          return {
            shootDayId: day === ANY_DAY ? undefined : (day as Id<"shootDays">),
            time: line.time ?? undefined,
            item: line.item,
            notes: line.notes ?? undefined,
          };
        }),
      });
      toast.success(
        result.replaced > 0
          ? `${result.added} lines added, ${result.replaced} replaced.`
          : `${result.added} line${result.added === 1 ? "" : "s"} added.`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import a schedule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="schedule-paste">Paste the running order</Label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.csv,.tsv,.md,text/plain,text/csv"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  Upload a file
                </Button>
              </div>
            </div>
            <Textarea
              id="schedule-paste"
              value={text}
              onChange={(e) => readText(e.target.value)}
              rows={8}
              autoFocus
              placeholder={
                "Day 1 — Monday 12 May\n07:00 Crew call\n07:30 Breakfast\n08:00 First setup — kitchen\n13:00 Lunch\n18:00 Wrap"
              }
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Paste straight out of Word, an email or a spreadsheet. Times can be written
              07:00, 7.30, 7am or 0700, and a heading like “Day 2” or “Tuesday 13 May” puts
              everything under it on that day. Uploading works for plain text and CSV — for a
              Word file or a PDF, open it and paste.
            </p>
          </div>

          {text.trim().length > 0 && lines.length === 0 && (
            <p className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing recognisable in that yet.
            </p>
          )}

          {lines.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {lines.length} line{lines.length === 1 ? "" : "s"} read
                <span className="ml-2 font-normal text-muted-foreground">
                  {timed} with a time
                  {ordered.length > 0 && ` · ${matched} matched to a shoot day`}
                </span>
              </p>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {lines.map((line, i) => (
                    <li key={i} className="flex min-w-0 items-center gap-3 px-3 py-2">
                      <span className="w-14 shrink-0 font-mono text-sm tabular-nums">
                        {line.time ?? <span className="text-muted-foreground">··</span>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{line.item}</span>
                        {line.notes && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {line.notes}
                          </span>
                        )}
                      </span>
                      {ordered.length > 0 && (
                        <Select
                          value={dayFor(line, i)}
                          onValueChange={(value) =>
                            setDayOverrides((rows) => ({ ...rows, [i]: value ?? ANY_DAY }))
                          }
                        >
                          <SelectTrigger className="w-44 shrink-0">
                            <SelectValue>
                              {(() => {
                                const id = dayFor(line, i);
                                const day = ordered.find((d) => d._id === id);
                                return day ? dayName(day) : "Any day";
                              })()}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ANY_DAY}>Any day</SelectItem>
                            {ordered.map((day) => (
                              <SelectItem key={day._id} value={day._id}>
                                {dayName(day)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                Replace the schedule already on this production
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleAdd()} disabled={saving || lines.length === 0}>
            {saving
              ? "Adding…"
              : `Add ${lines.length} line${lines.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
