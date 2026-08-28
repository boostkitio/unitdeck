/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { cleanEmail, eventIdFor, isStaffEmail, planEvents } from "./calendarPlan";

const days = [
  { _id: "day1", date: "2026-09-14", label: "Day 1: interviews" },
  { _id: "day2", date: "2026-09-15" },
];

const people = [
  { _id: "p1", name: "Sam Okafor", role: "Producer", email: "sam@klaxon.studio" },
  { _id: "p2", name: "Jo Reid", role: "DP", email: "jo@freelance.example" },
  { _id: "p3", name: "Ali Chen", role: "Sound", email: undefined },
];

test("only the company's own people get an entry", () => {
  const events = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ personId: "p1" }, { personId: "p2" }, { personId: "p3" }],
    people,
    days,
  });

  // Two days for Sam, and nothing at all for the freelancer or the person with
  // no address: a calendar we may not write to is not a failure, it is simply
  // not ours.
  expect(events.map((e) => e.email)).toEqual(["sam@klaxon.studio", "sam@klaxon.studio"]);
  expect(events.map((e) => e.date)).toEqual(["2026-09-14", "2026-09-15"]);
});

test("an unfilled role has nobody to tell", () => {
  const events = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ role: "Runner" }],
    people,
    days,
  });
  expect(events).toEqual([]);
});

test("nothing is planned without a domain to check against", () => {
  // Half-configured must mean off, not "write to everybody".
  const events = planEvents({
    projectName: "Brand film",
    domain: undefined,
    crew: [{ personId: "p1" }],
    people,
    days,
  });
  expect(events).toEqual([]);
});

test("a pencilled booking says so, a confirmed one does not", () => {
  const [pencilled] = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ personId: "p1", role: "Producer", status: "pencilled" }],
    people,
    days: [days[0]],
  });
  const [confirmed] = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ personId: "p1", role: "Producer", status: "confirmed" }],
    people,
    days: [days[0]],
  });

  expect(pencilled.summary).toBe("Pencilled: Brand film — Producer");
  expect(confirmed.summary).toBe("Brand film — Producer");
  // A booking predating the status field reads as pencilled, which is the safe
  // way round: nothing is announced as firm that nobody confirmed.
  const [bare] = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ personId: "p1" }],
    people,
    days: [days[0]],
  });
  expect(bare.summary).toBe("Pencilled: Brand film — Producer");
});

test("the booking's own role wins over the person's usual one", () => {
  const [event] = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ personId: "p1", role: "Director", status: "confirmed" }],
    people,
    days: [days[0]],
  });
  expect(event.summary).toBe("Brand film — Director");
});

test("the day's label and the job number are in the entry", () => {
  const [event] = planEvents({
    projectName: "Brand film",
    jobNumber: "KLX-0042",
    domain: "klaxon.studio",
    crew: [{ personId: "p1", status: "confirmed" }],
    people,
    days: [days[0]],
  });
  expect(event.description).toContain("KLX-0042");
  expect(event.description).toContain("Day 1: interviews");
  expect(event.description).toContain("Confirmed");
});

test("a domain written with an @, or in capitals, still matches", () => {
  expect(isStaffEmail("sam@klaxon.studio", "@klaxon.studio")).toBe(true);
  expect(isStaffEmail("SAM@Klaxon.Studio", "klaxon.studio")).toBe(true);
  expect(isStaffEmail("sam@klaxon.studio.evil.example", "klaxon.studio")).toBe(false);
  expect(isStaffEmail("sam@notklaxon.studio", "klaxon.studio")).toBe(false);
  expect(isStaffEmail("sam", "klaxon.studio")).toBe(false);
  expect(isStaffEmail(undefined, "klaxon.studio")).toBe(false);
});

test("an entry's id is the same every time, and different for everything else", () => {
  expect(eventIdFor("p1", "day1")).toBe(eventIdFor("p1", "day1"));
  expect(eventIdFor("p1", "day1")).not.toBe(eventIdFor("p1", "day2"));
  expect(eventIdFor("p1", "day1")).not.toBe(eventIdFor("p2", "day1"));
  // Google only accepts base32hex, and the id is ours to choose — so it has to
  // be in that alphabet or the write is refused.
  expect(eventIdFor("p1", "day1")).toMatch(/^[a-v0-9]{5,1024}$/);
});

test("an address is matched as a person would read it, not as it was typed", () => {
  // Every one of these is somebody's real address in a contacts book: pasted
  // out of a mail client, imported from a CSV with a trailing space, typed in
  // capitals, left with a comma from a list.
  for (const typed of [
    "sam@klaxon.studio",
    "  sam@klaxon.studio  ",
    "Sam@Klaxon.Studio",
    "SAM@KLAXON.STUDIO",
    "Sam Okafor <sam@klaxon.studio>",
    "sam@klaxon.studio,",
    "sam@klaxon.studio;",
    "sam@klaxon.studio.",
  ]) {
    expect(isStaffEmail(typed, "klaxon.studio")).toBe(true);
    expect(cleanEmail(typed)).toBe("sam@klaxon.studio");
  }

  // And the ones that genuinely are not this domain still are not.
  expect(isStaffEmail("sam@klaxon.studio.example", "klaxon.studio")).toBe(false);
  expect(isStaffEmail("sam@notklaxon.studio", "klaxon.studio")).toBe(false);
  expect(isStaffEmail("sam", "klaxon.studio")).toBe(false);
  expect(cleanEmail("not an address")).toBeNull();
});

test("the domain box is as forgiving as the addresses are", () => {
  for (const typed of ["klaxon.studio", "@klaxon.studio", " Klaxon.Studio ", "KLAXON.STUDIO"]) {
    expect(isStaffEmail("sam@klaxon.studio", typed)).toBe(true);
  }
});

test("a booking is written to the cleaned address, never the raw string", () => {
  const [event] = planEvents({
    projectName: "Brand film",
    domain: "klaxon.studio",
    crew: [{ personId: "p1", status: "confirmed" }],
    people: [{ _id: "p1", name: "Sam", role: "Producer", email: "Sam Okafor <SAM@klaxon.studio> " }],
    days: [{ _id: "day1", date: "2026-09-14" }],
  });
  // Google is handed an address, not a display name wrapped round one.
  expect(event.email).toBe("sam@klaxon.studio");
});
