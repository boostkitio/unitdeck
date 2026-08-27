/**
 * The calls we make against Google Calendar.
 *
 * The rule this file exists to enforce: UnitDeck only ever touches entries
 * UnitDeck made. Somebody's dentist appointment, their holiday, a meeting
 * their colleague invited them to — none of it is ours to change, and nothing
 * here can reach it.
 *
 * Two things make that true rather than merely intended. Every entry we write
 * is stamped with a marker in its private properties, and every entry we write
 * uses an id we derived from the booking. An entry we have no record of is
 * created, never updated: if the id turns out to be taken, we read what is
 * there and refuse unless it carries our marker. Deleting only ever addresses
 * an id from our own table, which is to say an entry we put there.
 */

/** Stamped on everything we write, and checked before we ever overwrite. */
const MARKER = "unitdeck";

const BASE = "https://www.googleapis.com/calendar/v3/calendars";

export type CalendarEventBody = {
  id: string;
  summary: string;
  description: string;
  /** "YYYY-MM-DD". An all-day entry ends on the following day, exclusive. */
  date: string;
};

function eventPayload(event: CalendarEventBody) {
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: { date: event.date },
    end: { date: nextDay(event.date) },
    extendedProperties: { private: { [MARKER]: "1" } },
    // Nobody wants a phone alarm for every shoot day of every job six weeks
    // out; the entry is there to be looked at, not to interrupt.
    reminders: { useDefault: false, overrides: [] },
    transparency: "opaque",
  };
}

/** The day after "YYYY-MM-DD", which is where an all-day entry ends. */
export function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Put the entry on the calendar.
 *
 * `ours` says whether we have a record of having written this entry before.
 * With a record, updating it is ours to do. Without one, we insert — and if
 * the id is somehow taken, we look at what is there and leave it alone unless
 * it is ours. Nothing on anyone's calendar is overwritten by accident.
 */
export async function writeEvent(args: {
  token: string;
  calendarId: string;
  event: CalendarEventBody;
  ours: boolean;
}): Promise<void> {
  const events = `${BASE}/${encodeURIComponent(args.calendarId)}/events`;
  const body = JSON.stringify(eventPayload(args.event));
  const headers = {
    Authorization: `Bearer ${args.token}`,
    "Content-Type": "application/json",
  };

  if (args.ours) {
    const updated = await fetch(`${events}/${args.event.id}`, { method: "PUT", headers, body });
    if (updated.ok) return;
    // 404: deleted by hand. 410: cancelled. Either way, put it back.
    if (updated.status !== 404 && updated.status !== 410) {
      throw new Error(`Google rejected the update (${updated.status}): ${await text(updated)}`);
    }
  }

  const created = await fetch(events, { method: "POST", headers, body });
  if (created.ok) return;
  if (created.status !== 409) {
    throw new Error(`Google rejected the entry (${created.status}): ${await text(created)}`);
  }

  // The id is taken. Ours to update, or somebody else's to leave alone.
  const existing = await fetch(`${events}/${args.event.id}`, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!existing.ok) {
    throw new Error(`Could not read the entry already at that id (${existing.status})`);
  }
  const found = (await existing.json()) as {
    extendedProperties?: { private?: Record<string, string> };
  };
  if (found.extendedProperties?.private?.[MARKER] !== "1") {
    throw new Error(
      "An entry already exists at that id and UnitDeck did not create it, so it has been left alone."
    );
  }
  const updated = await fetch(`${events}/${args.event.id}`, { method: "PUT", headers, body });
  if (!updated.ok) {
    throw new Error(`Google rejected the update (${updated.status}): ${await text(updated)}`);
  }
}

/**
 * Take the entry off the calendar. Already gone counts as done.
 *
 * Only ever called with an id from our own record of what we wrote, so this
 * cannot reach an entry somebody else made — and it removes one entry, never
 * a range, a day or a calendar.
 */
export async function deleteEvent(args: {
  token: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const res = await fetch(
    `${BASE}/${encodeURIComponent(args.calendarId)}/events/${args.eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${args.token}` } }
  );
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new Error(`Google would not remove the entry (${res.status}): ${await text(res)}`);
}

async function text(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
