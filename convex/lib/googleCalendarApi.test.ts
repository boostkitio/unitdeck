/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { deleteEvent, listEvents, nextDay, writeEvent } from "./googleCalendarApi";

type Call = { url: string; method: string; body?: unknown };

/**
 * A stand-in for Google, recording what we asked of it.
 *
 * The point of these tests is not that the requests are well-formed — it is
 * that nothing on somebody's calendar is touched unless UnitDeck put it there.
 * That rule lives in the order and the conditions of these calls, so the calls
 * are what is checked.
 */
function stubGoogle(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses[i++] ?? { status: 200 };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
      text: async () => JSON.stringify(next.body ?? {}),
    } as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const event = {
  id: "ud0123456789abcdef",
  summary: "Brand film — Producer",
  description: "Brand film",
  date: "2026-09-14",
};

test("an entry we have never written is created, not updated", async () => {
  const calls = stubGoogle([{ status: 200 }]);
  await writeEvent({ token: "t", calendarId: "sam@klaxon.studio", event, ours: false });

  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("POST");
  // An all-day entry, ending the following day, and stamped as ours.
  expect(calls[0].body).toMatchObject({
    start: { date: "2026-09-14" },
    end: { date: "2026-09-15" },
    extendedProperties: { private: { unitdeck: "1" } },
  });
});

test("an entry somebody else made is left exactly as it is", async () => {
  // The insert collides, and what is already there is not ours: a real entry
  // in that person's diary that happens to sit at the same id.
  const calls = stubGoogle([
    { status: 409 },
    { status: 200, body: { summary: "Dentist", extendedProperties: { private: {} } } },
  ]);

  await expect(
    writeEvent({ token: "t", calendarId: "sam@klaxon.studio", event, ours: false })
  ).rejects.toThrow("left alone");

  // Read, and then nothing. No PUT, no DELETE, no second attempt.
  expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
});

test("an entry we made but had lost track of is updated", async () => {
  const calls = stubGoogle([
    { status: 409 },
    { status: 200, body: { extendedProperties: { private: { unitdeck: "1" } } } },
    { status: 200 },
  ]);
  await writeEvent({ token: "t", calendarId: "sam@klaxon.studio", event, ours: false });
  expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "PUT"]);
});

test("an entry we know is ours is updated in place", async () => {
  const calls = stubGoogle([{ status: 200 }]);
  await writeEvent({ token: "t", calendarId: "sam@klaxon.studio", event, ours: true });
  expect(calls.map((c) => c.method)).toEqual(["PUT"]);
  expect(calls[0].url).toContain(`/events/${event.id}`);
});

test("an entry deleted by hand is put back rather than left missing", async () => {
  const calls = stubGoogle([{ status: 404 }, { status: 200 }]);
  await writeEvent({ token: "t", calendarId: "sam@klaxon.studio", event, ours: true });
  expect(calls.map((c) => c.method)).toEqual(["PUT", "POST"]);
});

test("removing addresses one entry by id, and gone already is done", async () => {
  const calls = stubGoogle([{ status: 410 }]);
  await deleteEvent({ token: "t", calendarId: "sam@klaxon.studio", eventId: event.id });
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("DELETE");
  expect(calls[0].url).toContain(`/calendars/sam%40klaxon.studio/events/${event.id}`);
});

test("a refusal from Google is raised rather than swallowed", async () => {
  stubGoogle([{ status: 403, body: { error: "forbidden" } }]);
  await expect(
    deleteEvent({ token: "t", calendarId: "sam@klaxon.studio", eventId: event.id })
  ).rejects.toThrow("403");
});

test("an all-day entry ends the next day, across a month and a leap year", () => {
  expect(nextDay("2026-09-14")).toBe("2026-09-15");
  expect(nextDay("2026-09-30")).toBe("2026-10-01");
  expect(nextDay("2026-12-31")).toBe("2027-01-01");
  expect(nextDay("2028-02-28")).toBe("2028-02-29");
});

test("reading a diary keeps the days, and marks which entries are ours", async () => {
  stubGoogle([
    {
      status: 200,
      body: {
        items: [
          // A week's holiday, all-day: Google reports the end exclusively, so
          // the last day it actually covers is the 21st, not the 22nd.
          {
            id: "holiday1",
            summary: "Annual leave",
            start: { date: "2026-09-14" },
            end: { date: "2026-09-22" },
          },
          // A timed meeting on one day.
          {
            id: "meeting1",
            summary: "Client call",
            start: { dateTime: "2026-09-15T10:00:00+01:00" },
            end: { dateTime: "2026-09-15T11:00:00+01:00" },
          },
          // One of ours, recognised by its stamp.
          {
            id: "ud00",
            summary: "Brand film — Producer",
            start: { date: "2026-09-16" },
            end: { date: "2026-09-17" },
            extendedProperties: { private: { unitdeck: "1" } },
          },
          // Cancelled, and marked free: neither is a commitment.
          { id: "gone", status: "cancelled", start: { date: "2026-09-15" } },
          {
            id: "free",
            summary: "Reminder",
            transparency: "transparent",
            start: { date: "2026-09-15" },
            end: { date: "2026-09-16" },
          },
        ],
      },
    },
  ]);

  const events = await listEvents({
    token: "t",
    calendarId: "sam@klaxon.studio",
    from: "2026-09-01",
    to: "2026-09-30",
  });

  expect(events).toEqual([
    {
      eventId: "holiday1",
      summary: "Annual leave",
      startDate: "2026-09-14",
      endDate: "2026-09-21",
      ours: false,
    },
    {
      eventId: "meeting1",
      summary: "Client call",
      startDate: "2026-09-15",
      endDate: "2026-09-15",
      ours: false,
    },
    {
      eventId: "ud00",
      summary: "Brand film — Producer",
      startDate: "2026-09-16",
      endDate: "2026-09-16",
      ours: true,
    },
  ]);
});

test("a private entry is reported as busy without a name", async () => {
  stubGoogle([
    {
      status: 200,
      body: {
        items: [{ id: "private1", start: { date: "2026-09-15" }, end: { date: "2026-09-16" } }],
      },
    },
  ]);
  const [event] = await listEvents({
    token: "t",
    calendarId: "sam@klaxon.studio",
    from: "2026-09-01",
    to: "2026-09-30",
  });
  // Whoever shares their calendar as free/busy chose not to say what it is,
  // and that choice is theirs to keep.
  expect(event.summary).toBe("Busy");
});

test("reading is a read: the request is a GET and asks for a window", async () => {
  const calls = stubGoogle([{ status: 200, body: { items: [] } }]);
  await listEvents({
    token: "t",
    calendarId: "sam@klaxon.studio",
    from: "2026-09-01",
    to: "2026-09-30",
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("GET");
  expect(calls[0].url).toContain("timeMin=2026-09-01T00%3A00%3A00Z");
  // Exclusive end, so the last day asked for is included.
  expect(calls[0].url).toContain("timeMax=2026-10-01T00%3A00%3A00Z");
  expect(calls[0].url).toContain("singleEvents=true");
});
