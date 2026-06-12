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
        <p className="text-sm text-neutral-500">Loading your call sheet…</p>
      </Shell>
    );
  }
  if (result === null) {
    return (
      <Shell>
        <p className="text-sm">This link isn&apos;t valid. Check with your producer.</p>
      </Shell>
    );
  }
  if (result.expired) {
    return (
      <Shell>
        <p className="text-sm">This call sheet link has expired.</p>
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
      <p className="text-[11px] uppercase tracking-widest text-neutral-500">
        {data.productionCompany}
      </p>
      <h1 className="mt-1 text-xl font-bold">{data.title}</h1>
      <p className="mt-0.5 text-sm text-neutral-600">{formatDate(data.date)}</p>

      {/* My call */}
      <div className="mt-4 rounded-xl bg-neutral-900 p-4 text-white">
        <p className="text-xs uppercase tracking-widest text-neutral-400">Your call time</p>
        <p className="text-3xl font-bold tabular-nums">{recipient.callTime}</p>
        <p className="mt-1 text-sm text-neutral-300">
          {recipient.name} · {recipient.role} · General call {data.generalCallTime}
        </p>
      </div>

      {/* Confirm / decline */}
      <div className="mt-3">
        {recipient.status === "confirmed" ? (
          <div className="flex items-center justify-between rounded-lg border border-green-300 bg-green-50 px-4 py-3">
            <p className="text-sm font-medium text-green-800">
              You&apos;re confirmed. See you on set.
            </p>
            <button
              className="text-xs text-green-700 underline"
              disabled={busy}
              onClick={() => act(() => decline({ token }))}
            >
              Can&apos;t make it?
            </button>
          </div>
        ) : recipient.status === "declined" ? (
          <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-800">You&apos;ve declined this shoot.</p>
            <button
              className="text-xs text-red-700 underline"
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
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600">
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
              <div key={loc.id} className="rounded-lg border border-neutral-200 p-3">
                <p className="text-sm font-semibold">
                  {i + 1}. {loc.name}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-neutral-600">{loc.address}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <a
                    className="font-medium underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                    href={mapsUrl(loc.address)}
                  >
                    Open in Maps
                  </a>
                  {loc.w3w && <span className="text-neutral-500">{loc.w3w}</span>}
                </div>
                {loc.parkingNotes && (
                  <p className="mt-2 text-xs text-neutral-600">Parking: {loc.parkingNotes}</p>
                )}
                {loc.nearestHospital && (
                  <p className="mt-1 text-xs text-neutral-600">
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
          <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {data.schedule.map((b) => (
              <div key={b.id} className="flex gap-3 px-3 py-2">
                <p className="w-24 shrink-0 text-sm font-semibold tabular-nums">
                  {b.start}
                  {b.end ? `–${b.end}` : ""}
                </p>
                <div>
                  <p className="text-sm">{b.title}</p>
                  {b.notes && <p className="text-xs text-neutral-500">{b.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Contacts */}
      {data.contacts.length > 0 && (
        <Section title="Key contacts">
          <div className="space-y-1">
            {data.contacts.map((c) => (
              <p key={c.id} className="text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-neutral-500"> ({c.role}) </span>
                <a
                  className="underline underline-offset-2"
                  href={`tel:${c.phone.replace(/\s/g, "")}`}
                >
                  {c.phone}
                </a>
              </p>
            ))}
          </div>
        </Section>
      )}

      {/* Notes */}
      {data.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line text-sm text-neutral-700">{data.notes}</p>
        </Section>
      )}

      {/* Safety */}
      {data.safetyNotes && (
        <Section title="Safety">
          <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
            <p className="whitespace-pre-line text-sm text-amber-900">{data.safetyNotes}</p>
            {recipient.safetyAckAt ? (
              <p className="mt-2 text-xs font-medium text-amber-800">
                Acknowledged {new Date(recipient.safetyAckAt).toLocaleString("en-GB")}
              </p>
            ) : (
              <Button
                size="sm"
                className="mt-3"
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
      <div className="mt-6 border-t border-neutral-200 pt-4 pb-10">
        {recipient.checkInAt ? (
          <p className="text-center text-sm font-medium text-green-700">
            Checked in at{" "}
            {new Date(recipient.checkInAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : isShootDayOrLater ? (
          <Button className="h-12 w-full" disabled={busy} onClick={() => act(() => checkIn({ token }))}>
            Check in on set
          </Button>
        ) : (
          <p className="text-center text-xs text-neutral-400">Check-in opens on the shoot day.</p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-md px-4 py-6">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}
