"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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
  const testConnection = useAction(api.calendarSync.testConnection);
  const refreshBusy = useAction(api.calendarSync.refreshBusyNow);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
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

      {/* What is actually true right now, rather than what should be. Each
          line here has been the answer to "why is nothing happening" at least
          once. */}
      <dl className="grid gap-1 rounded-lg border border-border p-3 text-xs sm:grid-cols-[12rem_1fr]">
        <dt className="text-muted-foreground">Service account</dt>
        <dd>
          {settings.configured ? (
            <span className="break-all">{settings.clientEmail}</span>
          ) : (
            <span className="text-destructive">
              Not set on this deployment — nothing can be written or read until it is.
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">People at this domain</dt>
        <dd>
          {settings.staff.length === 0 ? (
            <span className="text-destructive">
              None matched {settings.domain ?? "your domain"}.
              {settings.otherDomains.length > 0 && (
                <>
                  {" "}
                  The addresses in your People list are at:{" "}
                  {settings.otherDomains.join(", ")}. If one of those should be your domain,
                  correct the box above; if it is a near miss, the address itself has
                  something in it — a stray space, a name in front — worth fixing on the
                  person.
                </>
              )}
            </span>
          ) : (
            settings.staff.map((person) => person.name).join(", ")
          )}
        </dd>
        <dt className="text-muted-foreground">Entries written</dt>
        <dd>{settings.synced}</dd>
        <dt className="text-muted-foreground">Commitments read back</dt>
        <dd>
          {settings.busyEntries}
          {settings.lastRead
            ? ` — last read ${new Date(settings.lastRead).toLocaleString("en-GB")}`
            : " — never read yet"}
        </dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            setResult(null);
            void testConnection({})
              .then((r) => setResult(r))
              .catch((err: unknown) =>
                setResult({
                  ok: false,
                  message: err instanceof Error ? err.message : "Could not run the test.",
                })
              )
              .finally(() => setChecking(false));
          }}
        >
          {checking ? "Asking Google…" : "Test the connection"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={checking || !settings.enabled}
          onClick={() => {
            setChecking(true);
            void refreshBusy({})
              .then((r) =>
                toast.success(
                  `Read ${r.people} calendar${r.people === 1 ? "" : "s"}, ${r.events} entries.`
                )
              )
              .catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : "Could not read them.")
              )
              .finally(() => setChecking(false));
          }}
        >
          Read calendars now
        </Button>
      </div>

      {result && (
        <p
          className={
            result.ok
              ? "rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          }
        >
          {result.message}
        </p>
      )}

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
