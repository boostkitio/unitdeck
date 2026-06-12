"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type {
  CallSheetData,
  ContactRow,
  CrewRow,
  ScheduleBlock,
} from "../../../convex/lib/callSheetData";
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
}: {
  data: CallSheetData;
  onChange: (next: CallSheetData) => void;
}) {
  const people = useQuery(api.people.list, {});
  const set = (patch: Partial<CallSheetData>) => onChange({ ...data, ...patch });

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
            <Label htmlFor="cs-date">Date</Label>
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
      </section>

      {/* Schedule */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Schedule</h3>
          <Button
            size="sm"
            variant="secondary"
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
          </Button>
        </div>
        {data.schedule.map((block, i) => (
          <div
            key={block.id}
            className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="flex items-start gap-2">
              <Input
                type="time"
                className="w-28"
                value={block.start}
                onChange={(e) =>
                  set({
                    schedule: data.schedule.map((b) =>
                      b.id === block.id ? { ...b, start: e.target.value } : b
                    ),
                  })
                }
              />
              <Input
                type="time"
                className="w-28"
                value={block.end ?? ""}
                onChange={(e) =>
                  set({
                    schedule: data.schedule.map((b) =>
                      b.id === block.id ? { ...b, end: e.target.value || undefined } : b
                    ),
                  })
                }
              />
              <Input
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
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                placeholder="Notes (optional)"
                className="text-sm"
                value={block.notes ?? ""}
                onChange={(e) =>
                  set({
                    schedule: data.schedule.map((b) =>
                      b.id === block.id ? { ...b, notes: e.target.value || undefined } : b
                    ),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => set({ schedule: move(data.schedule, i, i - 1) })}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => set({ schedule: move(data.schedule, i, i + 1) })}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => set({ schedule: data.schedule.filter((b) => b.id !== block.id) })}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </section>

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
          <div key={row.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
            <Input
              placeholder="Name"
              value={row.name}
              onChange={(e) =>
                set({
                  crew: data.crew.map((c) => (c.id === row.id ? { ...c, name: e.target.value } : c)),
                })
              }
            />
            <Input
              placeholder="Role"
              value={row.role}
              onChange={(e) =>
                set({
                  crew: data.crew.map((c) => (c.id === row.id ? { ...c, role: e.target.value } : c)),
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
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() => set({ crew: data.crew.filter((c) => c.id !== row.id) })}
            >
              Remove
            </Button>
          </div>
        ))}
      </section>

      {/* Key contacts */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Key contacts</h3>
          <Button
            size="sm"
            variant="secondary"
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
          </Button>
        </div>
        {data.contacts.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
            <Input
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
            <Input
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
            <Input
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
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() => set({ contacts: data.contacts.filter((x) => x.id !== c.id) })}
            >
              Remove
            </Button>
          </div>
        ))}
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
    </div>
  );
}
