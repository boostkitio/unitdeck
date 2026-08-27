"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Putting bookings on your own people's Google calendars.
 *
 * Deliberately plain about what it will and will not touch. Somebody switching
 * this on is agreeing to let software write into their colleagues' diaries,
 * and the honest answer to "what will it do to the rest of my calendar" is
 * "nothing" — so it says so, where the switch is.
 */
export function CalendarSync() {
  const settings = useQuery(api.calendarSync.settings, {});
  const configure = useMutation(api.calendarSync.configure);
  const [domain, setDomain] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (settings === undefined) return <Skeleton className="h-40 w-full" />;

  const shown = domain ?? settings.domain ?? "";

  async function save(next: { enabled?: boolean; domain?: string }) {
    setSaving(true);
    try {
      await configure(next);
      toast.success(
        next.enabled === false ? "Calendar sync off — entries removed." : "Calendar settings saved."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-border pt-6">
      <div>
        <h2 className="font-heading text-lg font-semibold">Google Calendar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Book one of your own people onto a production and the shoot days appear in their
          Google Calendar as all-day entries. Move a date and they move; take somebody off
          and theirs comes away. Nothing else in anyone&apos;s calendar is read or changed —
          UnitDeck only ever touches the entries it made itself.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="calendar-domain">Your email domain</Label>
        <Input
          id="calendar-domain"
          value={shown}
          placeholder="klaxon.studio"
          onChange={(e) => setDomain(e.target.value)}
          onBlur={() => {
            if (domain !== null && domain !== (settings.domain ?? "")) {
              void save({ domain });
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Only addresses at this domain are ever written to, so freelancers and clients in
          your contacts are never affected. Your Workspace administrator has to authorise
          UnitDeck for this domain before anything is written.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={settings.enabled ? "secondary" : "default"}
          disabled={saving || (!settings.enabled && shown.trim().length === 0)}
          onClick={() => void save({ enabled: !settings.enabled })}
        >
          {settings.enabled ? "Turn off" : "Turn on"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {settings.enabled
            ? `On — ${settings.synced} entr${settings.synced === 1 ? "y" : "ies"} on your people's calendars.`
            : "Off. Nothing is written to anyone's calendar."}
        </span>
      </div>

      {settings.problems.length > 0 && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Some entries could not be written.</p>
          <ul className="mt-1 space-y-1 text-xs">
            {settings.problems.map((problem, i) => (
              <li key={i}>
                {problem.email} · {problem.date} — {problem.error ?? "Unknown error"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
