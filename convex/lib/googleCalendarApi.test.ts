/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { deleteEvent, nextDay, writeEvent } from "./googleCalendarApi";

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
