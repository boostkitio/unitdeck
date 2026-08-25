"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { type ScheduleItem } from "../../../convex/schedule";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";

/** The heading a run of items sits under. */
function groupLabel(item: ScheduleItem): string {
  if (!item.date) return "Any day";
  return item.dayLabel ? `${formatShootDate(item.date)} — ${item.dayLabel}` : formatShootDate(item.date);
}

/**
 * The running order for a production.
 *
 * Grouped by shoot day and ordered by time, because that is how a schedule is
 * read — down the page, in the order the day happens. Items with no time yet
 * sit at the end of their day rather than the start, where they would imply a
 * call time nobody agreed.
 */
export function ScheduleSection({ projectId }: { projectId: Id<"projects"> }) {
  const schedule = useQuery(api.schedule.listForProject, { projectId });
  const remove = useMutation(api.schedule.remove);

  const [editing, setEditing] = useState<ScheduleItem | null>(null);

  async function handleRemove(item: ScheduleItem) {
    try {
      await remove({ id: item._id });
      toast.success("Removed from the schedule.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove it.");
    }
  }

  // The query returns them already in running order, so grouping is just a
  // matter of noticing where the day changes.
  const groups: { label: string; items: ScheduleItem[] }[] = [];
  for (const item of schedule ?? []) {
    const label = groupLabel(item);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        {schedule === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : schedule.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing scheduled yet. Type the running order below — call time, first setup,
            lunch, wrap — and it will read down the page in the order the day happens.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {group.items.map((item) => (
                    <li
                      key={item._id}
                      className="flex min-w-0 items-baseline gap-3 px-3 py-2"
                    >
                      <span className="w-14 shrink-0 font-mono text-sm tabular-nums">
                        {item.time ?? <span className="text-muted-foreground">··</span>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.item}</span>
                        {item.notes && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.notes}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(item)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleRemove(item)}
                        >
                          Remove
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <ScheduleRowEntry projectId={projectId} />
      </CardContent>

      {editing && (
        <ScheduleDialog
          projectId={projectId}
          item={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function ScheduleDialog({
  projectId,
  item,
  onClose,
}: {
  projectId: Id<"projects">;
  item?: ScheduleItem;
  onClose: () => void;
}) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const add = useMutation(api.schedule.add);
  const update = useMutation(api.schedule.update);

  const [time, setTime] = useState(item?.time ?? "");
  const [what, setWhat] = useState(item?.item ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [dayId, setDayId] = useState<string>(item?.shootDayId ?? "any");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (what.trim().length === 0) {
      toast.error("Say what happens.");
      return;
    }
    const shootDayId = dayId === "any" ? null : (dayId as Id<"shootDays">);
    setSaving(true);
    try {
      if (item) {
        await update({
          id: item._id,
          time: time.trim() || null,
          item: what,
          notes: notes.trim() || null,
          shootDayId,
        });
        toast.success("Saved.");
      } else {
        await add({
          projectId,
          time: time.trim() || undefined,
          item: what,
          notes: notes.trim() || undefined,
          shootDayId: shootDayId ?? undefined,
        });
        toast.success("Added to the schedule.");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  }

  const dayLabel = (id: string) => {
    if (id === "any") return "Any day";
    const day = (days ?? []).find((d) => d._id === id);
    if (!day) return "…";
    return day.label ? `${formatShootDate(day.date)} — ${day.label}` : formatShootDate(day.date);
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit schedule item" : "Add to schedule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-item">What happens</Label>
            <Input
              id="schedule-item"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder="Crew call, first setup, lunch, wrap…"
              autoFocus
            />
          </div>
          <div className="flex gap-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-time">Time (optional)</Label>
              <Input
                id="schedule-time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="07:00"
                className="w-28 font-mono"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Label>Day</Label>
              <Select value={dayId} onValueChange={(value) => setDayId(value ?? "any")}>
                <SelectTrigger className="w-full">
                  {/* Explicit label: Base UI shows the raw value otherwise. */}
                  <SelectValue>{dayLabel(dayId)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any day</SelectItem>
                  {(days ?? []).map((day) => (
                    <SelectItem key={day._id} value={day._id}>
                      {day.label
                        ? `${formatShootDate(day.date)} — ${day.label}`
                        : formatShootDate(day.date)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule-notes">Notes (optional)</Label>
            <Textarea
              id="schedule-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Who is needed, where to be…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : item ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A line at a time.
 *
 * Building a running order is twenty short entries in a row, and a dialog per
 * entry makes that twenty open-type-save-close cycles. This is one row that
 * stays where it is: type a time, type what happens, press Enter, and the
 * cursor is back on the time ready for the next one.
 */
function ScheduleRowEntry({ projectId }: { projectId: Id<"projects"> }) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const add = useMutation(api.schedule.add);

  const [time, setTime] = useState("");
  const [what, setWhat] = useState("");
  const [dayId, setDayId] = useState<string>("any");
  const [saving, setSaving] = useState(false);
  const timeRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (what.trim().length === 0) {
      toast.error("Say what happens.");
      return;
    }
    setSaving(true);
    try {
      await add({
        projectId,
        time: time.trim() || undefined,
        item: what,
        shootDayId: dayId === "any" ? undefined : (dayId as Id<"shootDays">),
      });
      // Cleared and refocused, so the next line is straight in. The day is
      // kept: a run of entries is nearly always for the same day.
      setTime("");
      setWhat("");
      timeRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  const dayName = (id: string) => {
    if (id === "any") return "Any day";
    const day = (days ?? []).find((d) => d._id === id);
    if (!day) return "…";
    return day.label ? `${formatShootDate(day.date)} — ${day.label}` : formatShootDate(day.date);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Input
        ref={timeRef}
        value={time}
        onChange={(e) => setTime(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="07:00"
        aria-label="Time"
        className="w-20 font-mono"
      />
      <Input
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Crew call, first setup, lunch, wrap…"
        aria-label="What happens"
        className="min-w-40 flex-1"
      />
      {(days ?? []).length > 0 && (
        <Select value={dayId} onValueChange={(value) => setDayId(value ?? "any")}>
          <SelectTrigger className="w-44">
            <SelectValue>{dayName(dayId)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any day</SelectItem>
            {(days ?? []).map((day) => (
              <SelectItem key={day._id} value={day._id}>
                {day.label
                  ? `${formatShootDate(day.date)} — ${day.label}`
                  : formatShootDate(day.date)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="sm" disabled={saving || what.trim().length === 0} onClick={() => void submit()}>
        Add
      </Button>
    </div>
  );
}
