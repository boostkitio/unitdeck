"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ShootDaysSection({ projectId }: { projectId: Id<"projects"> }) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const [creating, setCreating] = useState(false);

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Shoot days</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          Add shoot day
        </Button>
      </div>
      {days === undefined ? null : days.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No shoot days yet. Add one to start a call sheet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {days.map((day) => (
            <li key={day._id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {day.date}
                  {day.label ? ` · ${day.label}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {day.locations.length > 0
                    ? day.locations.map((l) => l.name).join(", ")
                    : "No locations"}
                  {day.weather
                    ? ` · ${day.weather.summary}, ${Math.round(day.weather.tempMinC)}–${Math.round(day.weather.tempMaxC)}°C`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/projects/${projectId}/shoot-days/${day._id}/wrap`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Wrap
                </Link>
                <Link
                  href={`/projects/${projectId}/shoot-days/${day._id}/call-sheet`}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  Call sheet
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <CreateShootDayDialog projectId={projectId} onClose={() => setCreating(false)} />
      )}
    </section>
  );
}

function CreateShootDayDialog({
  projectId,
  onClose,
}: {
  projectId: Id<"projects">;
  onClose: () => void;
}) {
  const createDay = useMutation(api.shootDays.create);
  const locations = useQuery(api.locations.list, {});
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<Set<Id<"locations">>>(new Set());
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add shoot day</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sd-date">Date</Label>
            <Input id="sd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sd-label">Label (optional)</Label>
            <Input
              id="sd-label"
              placeholder="Day 1: interviews"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Locations</Label>
            {locations === undefined || locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No locations in your database yet. You can add them later.
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {locations.map((l) => (
                  <label key={l._id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(l._id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(l._id);
                        else next.delete(l._id);
                        setSelected(next);
                      }}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || date === ""}
            onClick={async () => {
              setBusy(true);
              try {
                await createDay({
                  projectId,
                  date,
                  label: label || undefined,
                  locationIds: [...selected],
                });
                toast.success("Shoot day added.");
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not add shoot day.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Adding…" : "Add shoot day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
