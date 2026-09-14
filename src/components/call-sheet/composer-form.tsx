"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CallSheetData,
  CameraInfo,
  ContactSection,
  CrewRow,
  Hotel,
  ScheduleBlock,
  SectionRow,
  SheetDay,
} from "../../../convex/lib/callSheetData";
import { migrateLegacyContacts, sheetHotels } from "../../../convex/lib/callSheetData";
import { Button } from "@/components/ui/button";
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
import {
  ASPECT_RATIOS,
  FRAME_RATES,
  PickOrType,
  RECORDING_FORMATS,
} from "@/components/call-sheet/pick-or-type";

let uid = 0;
function newId(prefix: string) {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ComposerForm({
  data,
  onChange,
  projectId,
}: {
  data: CallSheetData;
  onChange: (next: CallSheetData) => void;
  /** The production the sheet is for, to pull its hotels back in from. */
  projectId?: Id<"projects">;
}) {
  const people = useQuery(api.people.list, {});
  const stays = useQuery(api.accommodation.listForProject, projectId ? { projectId } : "skip");
  const set = (patch: Partial<CallSheetData>) => onChange({ ...data, ...patch });
  const extraDays = data.extraDays ?? [];
  const combined = extraDays.length > 0;
  const setDay = (id: string, patch: Partial<SheetDay>) =>
    set({ extraDays: extraDays.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const hotels = sheetHotels(data);
  const setHotel = (id: string, patch: Partial<Hotel>) =>
    set({ hotels: hotels.map((h) => (h.id === id ? { ...h, ...patch } : h)), accommodation: undefined });

  useEffect(() => {
    if (data.contacts && data.contacts.length > 0) {
      onChange(migrateLegacyContacts(data));
    }
    // Run only when the incoming legacy list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.contacts?.length]);

  return (
    <div className="space-y-8">
      {/* Production details */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Production</h3>
        <div className="space-y-2">
          <Label htmlFor="cs-title">Title</Label>
          <Input id="cs-title" value={data.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cs-date">{combined ? "Day 1 date" : "Date"}</Label>
            <Input
              id="cs-date"
              type="date"
              value={data.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cs-call">General call</Label>
            <Input
              id="cs-call"
              type="time"
              value={data.generalCallTime}
              onChange={(e) => set({ generalCallTime: e.target.value })}
            />
          </div>
        </div>
        {combined && (
          <div className="space-y-2">
            <Label htmlFor="cs-day-label">What day 1 is (optional)</Label>
            <Input
              id="cs-day-label"
              value={data.dayLabel ?? ""}
              placeholder="Interviews, B-roll, travel…"
              onChange={(e) => set({ dayLabel: e.target.value || undefined })}
            />
            <p className="text-xs text-muted-foreground">
              This sheet covers {extraDays.length + 1} dates. Each has its own call and schedule
              below; the crew, contacts, kit and hotels are printed once for all of them.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="cs-important">Important notices</Label>
          <Textarea
            id="cs-important"
            rows={3}
            value={data.importantNotices ?? ""}
            placeholder="A road closure, a change of unit base, a client on set…"
            onChange={(e) => set({ importantNotices: e.target.value || undefined })}
          />
          <p className="text-xs text-muted-foreground">
            Printed in a box at the top of the sheet, above everything else.
          </p>
        </div>
      </section>

      {/* Call times */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Call times</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              set({
                callTimes: [
                  ...(data.callTimes ?? []),
                  { id: newId("ct"), label: "", time: data.generalCallTime },
                ],
              })
            }
          >
            Add call time
          </Button>
        </div>
        {(data.callTimes ?? []).map((ct) => (
          <div key={ct.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
            <Input
              placeholder="Label (e.g. Crew call)"
              value={ct.label}
              onChange={(e) =>
                set({
                  callTimes: (data.callTimes ?? []).map((x) =>
                    x.id === ct.id ? { ...x, label: e.target.value } : x
                  ),
                })
              }
            />
            <Input
              type="time"
              className="w-28"
              value={ct.time}
              onChange={(e) =>
                set({
                  callTimes: (data.callTimes ?? []).map((x) =>
                    x.id === ct.id ? { ...x, time: e.target.value } : x
                  ),
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() =>
                set({ callTimes: (data.callTimes ?? []).filter((x) => x.id !== ct.id) })
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </section>

      {/* Schedule */}
      <ScheduleEditor
        title={combined ? `Schedule · Day 1` : "Schedule"}
        schedule={data.schedule}
        generalCallTime={data.generalCallTime}
        onChange={(schedule) => set({ schedule })}
      />

      {/* The further dates on a combined sheet, each with its own call and
          running order. The crew, kit and hotels below are shared. */}
      {extraDays.map((day, i) => (
        <section key={day.id} className="space-y-4 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Day {i + 2}</h3>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() =>
                set({
                  extraDays: extraDays.filter((d) => d.id !== day.id),
                  ...(extraDays.length === 1 ? { dayLabel: undefined } : {}),
                })
              }
            >
              Take this date off the sheet
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`cs-date-${day.id}`}>Date</Label>
              <Input
                id={`cs-date-${day.id}`}
                type="date"
                value={day.date}
                onChange={(e) => setDay(day.id, { date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`cs-call-${day.id}`}>General call</Label>
              <Input
                id={`cs-call-${day.id}`}
                type="time"
                value={day.generalCallTime}
                onChange={(e) => setDay(day.id, { generalCallTime: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`cs-label-${day.id}`}>What the day is (optional)</Label>
            <Input
              id={`cs-label-${day.id}`}
              value={day.label ?? ""}
              placeholder="Interviews, B-roll, travel…"
              onChange={(e) => setDay(day.id, { label: e.target.value || undefined })}
            />
          </div>
          <ScheduleEditor
            title={`Schedule · Day ${i + 2}`}
            schedule={day.schedule}
            generalCallTime={day.generalCallTime}
            onChange={(schedule) => setDay(day.id, { schedule })}
          />
        </section>
      ))}

      {/* Crew */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Crew</h3>
          <div className="flex items-center gap-2">
            <Select
              value={null}
              onValueChange={(personId) => {
                if (personId === null) return;
                const person = people?.find((p) => p._id === personId);
                if (!person) return;
                set({
                  crew: [
                    ...data.crew,
                    {
                      id: newId("crew"),
                      personId: person._id,
                      name: person.name,
                      role: person.role,
                      callTime: data.generalCallTime,
                      phone: person.phone,
                      email: person.email,
                    } satisfies CrewRow,
                  ],
                });
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Add from people…" />
              </SelectTrigger>
              <SelectContent>
                {(people ?? [])
                  .filter((p) => !data.crew.some((c) => c.personId === p._id))
                  .map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name} ({p.role})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
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
              Add blank row
            </Button>
          </div>
        </div>
        {data.crew.map((row) => (
          <div
            key={row.id}
            className="space-y-2 rounded-md border border-border p-3"
          >
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <Input
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
              <Input
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
              <Input
                type="time"
                className="w-28"
                value={row.callTime}
                onChange={(e) =>
                  set({
                    crew: data.crew.map((c) =>
                      c.id === row.id ? { ...c, callTime: e.target.value } : c
                    ),
                  })
                }
              />
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <Input
                type="email"
                placeholder="Email (needed to send)"
                value={row.email ?? ""}
                onChange={(e) =>
                  set({
                    crew: data.crew.map((c) =>
                      c.id === row.id ? { ...c, email: e.target.value || undefined } : c
                    ),
                  })
                }
              />
              <Input
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
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => set({ crew: data.crew.filter((c) => c.id !== row.id) })}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </section>

      {/* Contact sections (e.g. Agency, Client, Contributors) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Contact sections</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              set({
                contactSections: [
                  ...(data.contactSections ?? []),
                  { id: newId("sec"), title: "", rows: [] } satisfies ContactSection,
                ],
              })
            }
          >
            Add section
          </Button>
        </div>
        {(data.contactSections ?? []).map((section) => (
          <div key={section.id} className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Section title (e.g. Agency, Client, Contributors)"
                value={section.title}
                onChange={(e) =>
                  set({
                    contactSections: (data.contactSections ?? []).map((s) =>
                      s.id === section.id ? { ...s, title: e.target.value } : s
                    ),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() =>
                  set({
                    contactSections: (data.contactSections ?? []).filter(
                      (s) => s.id !== section.id
                    ),
                  })
                }
              >
                Remove section
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={null}
                onValueChange={(personId) => {
                  if (personId === null) return;
                  const person = people?.find((p) => p._id === personId);
                  if (!person) return;
                  set({
                    contactSections: (data.contactSections ?? []).map((s) =>
                      s.id === section.id
                        ? {
                            ...s,
                            rows: [
                              ...s.rows,
                              {
                                id: newId("row"),
                                personId: person._id,
                                name: person.name,
                                role: person.role,
                                phone: person.phone,
                                email: person.email,
                              } satisfies SectionRow,
                            ],
                          }
                        : s
                    ),
                  });
                }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Add from people…" />
                </SelectTrigger>
                <SelectContent>
                  {(people ?? [])
                    .filter((p) => !section.rows.some((r) => r.personId === p._id))
                    .map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name} ({p.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  set({
                    contactSections: (data.contactSections ?? []).map((s) =>
                      s.id === section.id
                        ? {
                            ...s,
                            rows: [
                              ...s.rows,
                              { id: newId("row"), name: "", role: "" } satisfies SectionRow,
                            ],
                          }
                        : s
                    ),
                  })
                }
              >
                Add row
              </Button>
            </div>
            {section.rows.map((row) => (
              <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2">
                  <Input
                    placeholder="Name"
                    value={row.name}
                    onChange={(e) =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? {
                                ...s,
                                rows: s.rows.map((r) =>
                                  r.id === row.id ? { ...r, name: e.target.value } : r
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  />
                  <Input
                    placeholder="Role"
                    value={row.role}
                    onChange={(e) =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? {
                                ...s,
                                rows: s.rows.map((r) =>
                                  r.id === row.id ? { ...r, role: e.target.value } : r
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  />
                  <Input
                    placeholder="Reports to (optional)"
                    value={row.reportsTo ?? ""}
                    onChange={(e) =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? {
                                ...s,
                                rows: s.rows.map((r) =>
                                  r.id === row.id
                                    ? { ...r, reportsTo: e.target.value || undefined }
                                    : r
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <Input
                    type="email"
                    placeholder="Email"
                    value={row.email ?? ""}
                    onChange={(e) =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? {
                                ...s,
                                rows: s.rows.map((r) =>
                                  r.id === row.id
                                    ? { ...r, email: e.target.value || undefined }
                                    : r
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  />
                  <Input
                    placeholder="Phone"
                    value={row.phone ?? ""}
                    onChange={(e) =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? {
                                ...s,
                                rows: s.rows.map((r) =>
                                  r.id === row.id
                                    ? { ...r, phone: e.target.value || undefined }
                                    : r
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  />
                  <Input
                    type="time"
                    className="w-28"
                    value={row.callTime ?? ""}
                    onChange={(e) =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? {
                                ...s,
                                rows: s.rows.map((r) =>
                                  r.id === row.id
                                    ? { ...r, callTime: e.target.value || undefined }
                                    : r
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() =>
                      set({
                        contactSections: (data.contactSections ?? []).map((s) =>
                          s.id === section.id
                            ? { ...s, rows: s.rows.filter((r) => r.id !== row.id) }
                            : s
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      {/* Accommodation */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Accommodation</h3>
          <div className="flex items-center gap-2">
            {projectId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={stays === undefined}
                title="Replaces the hotels on this sheet with the production's accommodation list."
                onClick={() =>
                  set({
                    accommodation: undefined,
                    hotels: (stays ?? []).map((stay) => ({
                      id: newId("hotel"),
                      name: stay.name,
                      address: stay.address,
                      phone: stay.phone,
                      checkIn: stay.checkIn,
                      nights: stay.nights,
                      bookingRef: stay.bookingRef,
                      notes: stay.notes,
                    })),
                  })
                }
              >
                Pull in from production
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                set({
                  accommodation: undefined,
                  hotels: [...hotels, { id: newId("hotel"), name: "" } satisfies Hotel],
                })
              }
            >
              Add hotel
            </Button>
          </div>
        </div>
        {hotels.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nobody staying over. Hotels added to the production&apos;s Accommodation section come
            onto the sheet when it is generated.
          </p>
        )}
        {hotels.map((hotel) => (
          <div key={hotel.id} className="space-y-2 rounded-md border border-border p-3">
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <Input
                placeholder="Hotel"
                value={hotel.name}
                onChange={(e) => setHotel(hotel.id, { name: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() =>
                  set({ accommodation: undefined, hotels: hotels.filter((h) => h.id !== hotel.id) })
                }
              >
                Remove
              </Button>
            </div>
            <Textarea
              rows={2}
              placeholder="Address"
              value={hotel.address ?? ""}
              onChange={(e) => setHotel(hotel.id, { address: e.target.value || undefined })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Phone"
                value={hotel.phone ?? ""}
                onChange={(e) => setHotel(hotel.id, { phone: e.target.value || undefined })}
              />
              <Input
                placeholder="Check-in, e.g. Mon 12 May from 3pm"
                value={hotel.checkIn ?? ""}
                onChange={(e) => setHotel(hotel.id, { checkIn: e.target.value || undefined })}
              />
              <Input
                placeholder="Nights"
                inputMode="numeric"
                value={hotel.nights !== undefined ? String(hotel.nights) : ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const nights = Number(raw);
                  if (raw === "") setHotel(hotel.id, { nights: undefined });
                  else if (Number.isInteger(nights) && nights >= 0) setHotel(hotel.id, { nights });
                }}
              />
              <Input
                placeholder="Booking ref"
                value={hotel.bookingRef ?? ""}
                onChange={(e) => setHotel(hotel.id, { bookingRef: e.target.value || undefined })}
              />
            </div>
            <Input
              placeholder="Notes (optional)"
              value={hotel.notes ?? ""}
              onChange={(e) => setHotel(hotel.id, { notes: e.target.value || undefined })}
            />
          </div>
        ))}
      </section>

      {/* Camera / tech */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Camera / tech</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cs-camera-format">Recording format</Label>
            <PickOrType
              id="cs-camera-format"
              value={data.camera?.recordingFormat}
              options={RECORDING_FORMATS}
              placeholder="e.g. 6048x4032"
              onChange={(next) =>
                set({ camera: { ...data.camera, recordingFormat: next } satisfies CameraInfo })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cs-camera-framerate">Frame rate</Label>
            <PickOrType
              id="cs-camera-framerate"
              value={data.camera?.frameRate}
              options={FRAME_RATES}
              placeholder="e.g. 96 fps"
              onChange={(next) =>
                set({ camera: { ...data.camera, frameRate: next } satisfies CameraInfo })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cs-camera-aspect">Aspect ratio</Label>
            <PickOrType
              id="cs-camera-aspect"
              value={data.camera?.aspectRatios}
              options={ASPECT_RATIOS}
              placeholder="e.g. 1.66:1"
              onChange={(next) =>
                set({ camera: { ...data.camera, aspectRatios: next } satisfies CameraInfo })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cs-camera-naming">Naming convention (optional)</Label>
            <Input
              id="cs-camera-naming"
              value={data.camera?.namingConvention ?? ""}
              placeholder="MERIDIAN_D01_A001"
              onChange={(e) =>
                set({
                  camera: {
                    ...data.camera,
                    namingConvention: e.target.value || undefined,
                  } satisfies CameraInfo,
                })
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cs-camera-notes">Other notes (optional)</Label>
          <Textarea
            id="cs-camera-notes"
            rows={2}
            value={data.camera?.otherNotes ?? ""}
            onChange={(e) =>
              set({
                camera: { ...data.camera, otherNotes: e.target.value || undefined } satisfies CameraInfo,
              })
            }
          />
        </div>
      </section>

      {/* Notes */}
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cs-notes">Notes</Label>
          <Textarea
            id="cs-notes"
            rows={3}
            value={data.notes ?? ""}
            onChange={(e) => set({ notes: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cs-safety">Safety notes</Label>
          <Textarea
            id="cs-safety"
            rows={3}
            value={data.safetyNotes ?? ""}
            onChange={(e) => set({ safetyNotes: e.target.value || undefined })}
          />
        </div>
      </section>


      {/* Confidentiality */}
      <section className="space-y-2">
        <label htmlFor="cs-confidential" className="flex items-center gap-2 text-sm font-medium">
          <input
            id="cs-confidential"
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={data.confidential ?? false}
            onChange={(e) => set({ confidential: e.target.checked })}
          />
          Confidential (mark this call sheet as confidential)
        </label>
      </section>
    </div>
  );
}

/** One date's running order: blocks with a start, an optional end, and notes. */
function ScheduleEditor({
  title,
  schedule,
  generalCallTime,
  onChange,
}: {
  title: string;
  schedule: ScheduleBlock[];
  generalCallTime: string;
  onChange: (next: ScheduleBlock[]) => void;
}) {
  const edit = (id: string, patch: Partial<ScheduleBlock>) =>
    onChange(schedule.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange([
              ...schedule,
              {
                id: newId("blk"),
                start: schedule.at(-1)?.end ?? generalCallTime,
                title: "",
              } satisfies ScheduleBlock,
            ])
          }
        >
          Add block
        </Button>
      </div>
      {schedule.map((block, i) => (
        <div key={block.id} className="rounded-md border border-border p-3">
          <div className="flex items-start gap-2">
            <Input
              type="time"
              className="w-28"
              value={block.start}
              onChange={(e) => edit(block.id, { start: e.target.value })}
            />
            <Input
              type="time"
              className="w-28"
              value={block.end ?? ""}
              onChange={(e) => edit(block.id, { end: e.target.value || undefined })}
            />
            <Input
              placeholder="What's happening"
              value={block.title}
              onChange={(e) => edit(block.id, { title: e.target.value })}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              placeholder="Notes (optional)"
              className="text-sm"
              value={block.notes ?? ""}
              onChange={(e) => edit(block.id, { notes: e.target.value || undefined })}
            />
            <Button size="sm" variant="ghost" onClick={() => onChange(move(schedule, i, i - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(move(schedule, i, i + 1))}>
              ↓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() => onChange(schedule.filter((b) => b.id !== block.id))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
