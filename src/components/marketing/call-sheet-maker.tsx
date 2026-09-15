"use client";

import { useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type {
  CallSheetData,
  ContactRow,
  CrewRow,
  ScheduleBlock,
} from "../../../convex/lib/callSheetData";
import { CallSheetDocument } from "@/components/call-sheet/call-sheet-document";
import { FitToWidth } from "@/components/call-sheet/fit-to-width";
import { PagedPreview } from "@/components/documents/paged-preview";
import { WaitlistForm } from "./waitlist-form";

let uid = 0;
function newId(prefix: string) {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

const UNLOCK_KEY = "unitdeck-tool-unlocked";

// Reads the unlock flag without a setState-in-effect: the server snapshot is
// locked, and React re-checks the client snapshot after hydration.
const emptySubscribe = () => () => {};
function useStoredUnlock(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.localStorage.getItem(UNLOCK_KEY) === "1",
    () => false
  );
}

function emptyData(): CallSheetData {
  return {
    title: "",
    date: new Date().toISOString().slice(0, 10),
    generalCallTime: "08:00",
    productionCompany: "",
    locations: [{ id: "loc-1", name: "", address: "" }],
    schedule: [],
    crew: [],
    contacts: [],
  };
}

const inputClass =
  "h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900";
const labelClass = "mb-1 block text-xs font-medium text-neutral-600";
const addButtonClass =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100";
const removeButtonClass = "text-xs font-medium text-red-600 hover:underline";

export function CallSheetMaker() {
  const createRender = useMutation(api.tools.createRender);
  const [data, setData] = useState<CallSheetData>(emptyData);
  const storedUnlock = useStoredUnlock();
  const [justUnlocked, setJustUnlocked] = useState(false);
  const unlocked = storedUnlock || justUnlocked;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<CallSheetData>) => setData((d) => ({ ...d, ...patch }));
  const location = data.locations[0];
  const setLocation = (patch: Partial<CallSheetData["locations"][number]>) =>
    set({ locations: [{ ...location, ...patch }] });

  const ready = data.title.trim() !== "" && data.productionCompany.trim() !== "";

  async function download() {
    setBusy(true);
    setError("");
    try {
      const cleaned: CallSheetData = {
        ...data,
        locations: data.locations.filter((l) => l.name.trim() !== "" || l.address.trim() !== ""),
        crew: data.crew.filter((c) => c.name.trim() !== ""),
        schedule: data.schedule.filter((b) => b.title.trim() !== ""),
        contacts: data.contacts.filter((c) => c.name.trim() !== ""),
      };
      const { token } = await createRender({ data: cleaned, website: "" });
      const res = await fetch("/api/tools/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(`PDF generation failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.title.replace(/[^\w\- ]/g, "") || "call-sheet"} call sheet ${data.date}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="not-prose">
      {/* Form */}
      <div className="space-y-8 rounded-lg border border-neutral-200 p-5">
        <section>
          <h3 className="text-sm font-semibold">Production</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="mk-title">
                Production title
              </label>
              <input
                id="mk-title"
                className={inputClass}
                placeholder="Spring brand film"
                value={data.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="mk-company">
                Company name
              </label>
              <input
                id="mk-company"
                className={inputClass}
                placeholder="Your production company"
                value={data.productionCompany}
                onChange={(e) => set({ productionCompany: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="mk-date">
                Shoot date
              </label>
              <input
                id="mk-date"
                type="date"
                className={inputClass}
                value={data.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="mk-call">
                General call
              </label>
              <input
                id="mk-call"
                type="time"
                className={inputClass}
                value={data.generalCallTime}
                onChange={(e) => set({ generalCallTime: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold">Location</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="mk-loc-name">
                Name
              </label>
              <input
                id="mk-loc-name"
                className={inputClass}
                placeholder="Studio 2"
                value={location.name}
                onChange={(e) => setLocation({ name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="mk-loc-address">
                Address
              </label>
              <input
                id="mk-loc-address"
                className={inputClass}
                placeholder="1 High Street, Tunbridge Wells TN1 1AA"
                value={location.address}
                onChange={(e) => setLocation({ address: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="mk-loc-parking">
                Parking notes
              </label>
              <input
                id="mk-loc-parking"
                className={inputClass}
                value={location.parkingNotes ?? ""}
                onChange={(e) => setLocation({ parkingNotes: e.target.value || undefined })}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="mk-loc-ae">
                Nearest A&amp;E
              </label>
              <input
                id="mk-loc-ae"
                className={inputClass}
                value={location.nearestHospital ?? ""}
                onChange={(e) => setLocation({ nearestHospital: e.target.value || undefined })}
              />
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Schedule</h3>
            <button
              type="button"
              className={addButtonClass}
              onClick={() =>
                set({
                  schedule: [
                    ...data.schedule,
                    {
                      id: newId("blk"),
                      start: data.schedule.at(-1)?.end ?? data.generalCallTime,
                      title: "",
                    } satisfies ScheduleBlock,
                  ],
                })
              }
            >
              Add block
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {data.schedule.map((block) => (
              <div key={block.id} className="grid grid-cols-[6.5rem_6.5rem_1fr_auto] items-center gap-2">
                <input
                  type="time"
                  className={inputClass}
                  value={block.start}
                  onChange={(e) =>
                    set({
                      schedule: data.schedule.map((b) =>
                        b.id === block.id ? { ...b, start: e.target.value } : b
                      ),
                    })
                  }
                />
                <input
                  type="time"
                  className={inputClass}
                  value={block.end ?? ""}
                  onChange={(e) =>
                    set({
                      schedule: data.schedule.map((b) =>
                        b.id === block.id ? { ...b, end: e.target.value || undefined } : b
                      ),
                    })
                  }
                />
                <input
                  className={inputClass}
                  placeholder="What's happening"
                  value={block.title}
                  onChange={(e) =>
                    set({
                      schedule: data.schedule.map((b) =>
                        b.id === block.id ? { ...b, title: e.target.value } : b
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className={removeButtonClass}
                  onClick={() => set({ schedule: data.schedule.filter((b) => b.id !== block.id) })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Crew</h3>
            <button
              type="button"
              className={addButtonClass}
              onClick={() =>
                set({
                  crew: [
                    ...data.crew,
                    {
                      id: newId("crew"),
                      name: "",
                      role: "",
                      callTime: data.generalCallTime,
                    } satisfies CrewRow,
                  ],
                })
              }
            >
              Add crew member
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {data.crew.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_6.5rem_1fr_auto] items-center gap-2">
                <input
                  className={inputClass}
                  placeholder="Name"
                  value={row.name}
                  onChange={(e) =>
                    set({
                      crew: data.crew.map((c) =>
                        c.id === row.id ? { ...c, name: e.target.value } : c
                      ),
                    })
                  }
                />
                <input
                  className={inputClass}
                  placeholder="Role"
                  value={row.role}
                  onChange={(e) =>
                    set({
                      crew: data.crew.map((c) =>
                        c.id === row.id ? { ...c, role: e.target.value } : c
                      ),
                    })
                  }
                />
                <input
                  type="time"
                  className={inputClass}
                  value={row.callTime}
                  onChange={(e) =>
                    set({
                      crew: data.crew.map((c) =>
                        c.id === row.id ? { ...c, callTime: e.target.value } : c
                      ),
                    })
                  }
                />
                <input
                  className={inputClass}
                  placeholder="Phone"
                  value={row.phone ?? ""}
                  onChange={(e) =>
                    set({
                      crew: data.crew.map((c) =>
                        c.id === row.id ? { ...c, phone: e.target.value || undefined } : c
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className={removeButtonClass}
                  onClick={() => set({ crew: data.crew.filter((c) => c.id !== row.id) })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Key contacts</h3>
            <button
              type="button"
              className={addButtonClass}
              onClick={() =>
                set({
                  contacts: [
                    ...data.contacts,
                    { id: newId("contact"), name: "", role: "", phone: "" } satisfies ContactRow,
                  ],
                })
              }
            >
              Add contact
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {data.contacts.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <input
                  className={inputClass}
                  placeholder="Name"
                  value={c.name}
                  onChange={(e) =>
                    set({
                      contacts: data.contacts.map((x) =>
                        x.id === c.id ? { ...x, name: e.target.value } : x
                      ),
                    })
                  }
                />
                <input
                  className={inputClass}
                  placeholder="Role"
                  value={c.role}
                  onChange={(e) =>
                    set({
                      contacts: data.contacts.map((x) =>
                        x.id === c.id ? { ...x, role: e.target.value } : x
                      ),
                    })
                  }
                />
                <input
                  className={inputClass}
                  placeholder="Phone"
                  value={c.phone}
                  onChange={(e) =>
                    set({
                      contacts: data.contacts.map((x) =>
                        x.id === c.id ? { ...x, phone: e.target.value } : x
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className={removeButtonClass}
                  onClick={() => set({ contacts: data.contacts.filter((x) => x.id !== c.id) })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="mk-notes">
              Notes
            </label>
            <textarea
              id="mk-notes"
              rows={3}
              className={`${inputClass} h-auto py-2`}
              value={data.notes ?? ""}
              onChange={(e) => set({ notes: e.target.value || undefined })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="mk-safety">
              Safety notes
            </label>
            <textarea
              id="mk-safety"
              rows={3}
              className={`${inputClass} h-auto py-2`}
              value={data.safetyNotes ?? ""}
              onChange={(e) => set({ safetyNotes: e.target.value || undefined })}
            />
          </div>
        </section>
      </div>

      {/* Live preview */}
      <h3 className="mt-8 text-sm font-semibold">Live preview</h3>
      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100 p-4">
        <FitToWidth>
          <PagedPreview>
            <CallSheetDocument
              data={{
                ...data,
                title: data.title || "Your production title",
                productionCompany: data.productionCompany || "Your company",
              }}
            />
          </PagedPreview>
        </FitToWidth>
      </div>

      {/* Gate + download */}
      <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        {!unlocked ? (
          <>
            <p className="text-sm font-medium">Almost there</p>
            <p className="mt-1 text-sm text-neutral-600">
              Pop your email in to unlock the download. You&apos;ll also get early access to
              UnitDeck when it opens up.
            </p>
            <div className="mt-3">
              <WaitlistForm
                source="tool-call-sheet-maker"
                buttonLabel="Unlock download"
                onJoined={() => {
                  window.localStorage.setItem(UNLOCK_KEY, "1");
                  setJustUnlocked(true);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || !ready}
              className="h-11 rounded-md bg-neutral-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-60"
              onClick={download}
            >
              {busy ? "Building your PDF…" : "Download your call sheet PDF"}
            </button>
            {!ready && (
              <p className="mt-2 text-xs text-neutral-500">
                Add a production title and company name first.
              </p>
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
