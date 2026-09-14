"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function SetModePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const result = useQuery(api.setMode.getByToken, { token });
  const markViewed = useMutation(api.setMode.markViewed);
  const confirm = useMutation(api.setMode.confirm);
  const decline = useMutation(api.setMode.decline);
  const ackSafety = useMutation(api.setMode.ackSafety);
  const checkIn = useMutation(api.setMode.checkIn);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (result && !result.expired) void markViewed({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result === undefined, token]);

  if (result === undefined) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading your call sheet…</p>
      </Shell>
    );
  }
  if (result === null) {
    return (
      <Shell>
        <p className="text-sm text-foreground">This link isn&apos;t valid. Check with your producer.</p>
      </Shell>
    );
  }
  if (result.expired) {
    return (
      <Shell>
        <p className="text-sm text-foreground">This call sheet link has expired.</p>
      </Shell>
    );
  }

  const { data, recipient } = result;
  const isShootDayOrLater = data.date <= new Date().toISOString().slice(0, 10);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      {/* Header */}
      <p className="text-[11px] tracking-widest text-muted-foreground">
        {data.productionCompany}
      </p>
      <h1 className="mt-1 font-heading text-xl font-semibold text-foreground">{data.title}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {formatDate(data.date)}
        {data.extraDays?.length ? ` to ${formatDate(data.extraDays.at(-1)!.date)}` : ""}
      </p>

      {/* Call-time hero */}
      <div className="mt-4 rounded-2xl bg-[linear-gradient(120deg,#11182F,#34406B_58%,#6B7FBE)] p-5 text-white">
        <p className="text-[11px] tracking-widest text-white/60">Your call time</p>
        <p className="mt-1 font-heading text-4xl font-semibold tabular-nums">{recipient.callTime}</p>
        <p className="mt-2 text-sm text-white/75">
          {recipient.name} · {recipient.role} · General call {data.generalCallTime}
        </p>
      </div>

      {/* Confirm / decline */}
      <div className="mt-3">
        {recipient.status === "confirmed" ? (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <p className="text-sm font-medium text-emerald-300">
              You&apos;re confirmed. See you on set.
            </p>
            <button
              className="text-xs text-emerald-400 underline underline-offset-2 disabled:opacity-50"
              disabled={busy}
              onClick={() => act(() => decline({ token }))}
            >
              Can&apos;t make it?
            </button>
          </div>
        ) : recipient.status === "declined" ? (
          <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm font-medium text-red-300">You&apos;ve declined this shoot.</p>
            <button
              className="text-xs text-red-400 underline underline-offset-2 disabled:opacity-50"
              disabled={busy}
              onClick={() => act(() => confirm({ token }))}
            >
              Changed your mind?
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12" disabled={busy} onClick={() => act(() => confirm({ token }))}>
              Confirm availability
            </Button>
            <Button
              variant="outline"
              className="h-12"
              disabled={busy}
              onClick={() => act(() => decline({ token }))}
            >
              Decline
            </Button>
          </div>
        )}
      </div>

      {/* Day facts */}
      {(data.weatherSummary || data.sunrise || data.sunset) && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
          {data.weatherSummary && <span>{data.weatherSummary}</span>}
          {data.sunrise && <span>Sunrise {data.sunrise}</span>}
          {data.sunset && <span>Sunset {data.sunset}</span>}
        </div>
      )}

      {/* Locations */}
      {data.locations.length > 0 && (
        <Section title="Locations">
          <div className="space-y-2">
            {data.locations.map((loc, i) => (
              <div key={loc.id} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">
                  {i + 1}. {loc.name}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{loc.address}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <a
                    className="font-medium text-primary underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                    href={mapsUrl(loc.address)}
                  >
                    Open in Maps
                  </a>
                  {loc.plusCode && <span className="text-muted-foreground">{loc.plusCode}</span>}
                </div>
                {loc.parkingNotes && (
                  <p className="mt-2 text-xs text-muted-foreground">Parking: {loc.parkingNotes}</p>
                )}
                {loc.nearestHospital && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nearest A&amp;E: {loc.nearestHospital}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Schedule */}
      {data.schedule.length > 0 && (
        <Section title="Schedule">
          <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
            {data.schedule.map((b) => (
              <div key={b.id} className="flex gap-3 px-4 py-3">
                <p className="w-24 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {b.start}
                  {b.end ? `–${b.end}` : ""}
                </p>
                <div>
                  <p className="text-sm text-foreground">{b.title}</p>
                  {b.notes && <p className="text-xs text-muted-foreground">{b.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Contacts */}
      {data.contacts.length > 0 && (
        <Section title="Key contacts">
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {data.contacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.role}</p>
                </div>
                <a
                  className="text-sm text-primary underline underline-offset-2"
                  href={`tel:${c.phone.replace(/\s/g, "")}`}
                >
                  {c.phone}
                </a>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Notes */}
      {data.notes && (
        <Section title="Notes">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="whitespace-pre-line text-sm text-muted-foreground">{data.notes}</p>
          </div>
        </Section>
      )}

      {/* Safety */}
      {data.safetyNotes && (
        <Section title="Safety">
          <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 p-4">
            <p className="whitespace-pre-line text-sm text-amber-200">{data.safetyNotes}</p>
            {recipient.safetyAckAt ? (
              <p className="mt-2 text-xs font-medium text-amber-400">
                Acknowledged {new Date(recipient.safetyAckAt).toLocaleString("en-GB")}
              </p>
            ) : (
              <Button
                size="sm"
                className="mt-3 border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                disabled={busy}
                onClick={() => act(() => ackSafety({ token }))}
              >
                I&apos;ve read the safety notes
              </Button>
            )}
          </div>
        </Section>
      )}

      {/* Check-in (shoot day onwards) */}
      <div className="mt-6 border-t border-border pt-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        {recipient.checkInAt ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center">
            <p className="text-sm font-medium text-emerald-300">
              Checked in at{" "}
              {new Date(recipient.checkInAt).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        ) : isShootDayOrLater ? (
          <Button
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={() => act(() => checkIn({ token }))}
          >
            Check in on set
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">Check-in opens on the shoot day.</p>
        )}
      </div>

      {/* Footer */}
      <p className="pb-4 text-center text-[10px] text-muted-foreground/40">Sent with UnitDeck</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-6">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2.5 text-[11px] font-semibold tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}
