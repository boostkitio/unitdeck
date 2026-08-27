/**
 * What ought to be on people's calendars.
 *
 * Kept apart from anything that talks to Google so the decisions — who gets an
 * entry, for which day, called what — can be reasoned about and tested on
 * their own. The sync is then a dumb loop: make the world look like this.
 *
 * Entries are all-day. A production office books people onto days, not hours:
 * the call time moves twice before the shoot and nobody wants their calendar
 * rewritten each time, and an all-day block is what a colleague scanning the
 * week actually wants to see.
 */

export type PlannedEvent = {
  personId: string;
  shootDayId: string;
  /** The calendar to write to — the person's work address. */
  email: string;
  /** "YYYY-MM-DD". All-day, so this is the whole event. */
  date: string;
  summary: string;
  description: string;
};

export type PlanPerson = {
  _id: string;
  name: string;
  /** Their usual role, used when the booking does not name one. */
  role?: string;
  email?: string;
};

export type PlanBooking = {
  personId?: string;
  role?: string;
  status?: "pencilled" | "confirmed";
};

export type PlanDay = {
  _id: string;
  date: string;
  label?: string;
};

/**
 * Whether an address belongs to the organisation's own domain.
 *
 * Only staff addresses are ever written to, and this is the check that makes
 * that true in the app as well as at Google's end — delegation refuses
 * anything outside the domain that authorised it, but a booking should never
 * get as far as being refused.
 */
export function isStaffEmail(email: string | undefined, domain: string | undefined): boolean {
  if (!email || !domain) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return email.slice(at + 1).toLowerCase() === domain.replace(/^@/, "").toLowerCase();
}

/**
 * A calendar entry's id, derived from the booking it stands for.
 *
 * Google accepts an id we choose, so the same person on the same day always
 * addresses the same entry: writing twice updates rather than duplicating, and
 * a sync that failed half way through can simply be run again. Ids must be
 * base32hex — digits and a-v — which hex satisfies.
 */
export function eventIdFor(personId: string, shootDayId: string): string {
  return `ud${hash(`${personId}:${shootDayId}`, 0x811c9dc5)}${hash(`${shootDayId}|${personId}`, 0x01000193)}`;
}

/** FNV-1a, seeded, as 8 hex characters. Two of them make a wide enough id. */
function hash(input: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Every entry a production should be putting on staff calendars.
 *
 * A booking is made against the production rather than against one of its
 * days, so somebody booked on the job is on all of its days — which is how
 * the crew list is read everywhere else. An unfilled role has nobody to tell,
 * and a freelancer has no calendar we may write to; both simply produce
 * nothing here.
 */
export function planEvents(args: {
  projectName: string;
  jobNumber?: string;
  crew: PlanBooking[];
  people: PlanPerson[];
  days: PlanDay[];
  domain: string | undefined;
}): PlannedEvent[] {
  const byId = new Map(args.people.map((p) => [p._id, p]));
  const events: PlannedEvent[] = [];

  for (const booking of args.crew) {
    if (!booking.personId) continue;
    const person = byId.get(booking.personId);
    if (!isStaffEmail(person?.email, args.domain)) continue;

    const role = booking.role?.trim() || person!.role?.trim() || "";
    // Pencilled is said out loud. Somebody reading their week needs to know
    // which of these jobs is firm, and a colour they have to remember is not
    // an answer.
    const prefix = booking.status === "confirmed" ? "" : "Pencilled: ";

    for (const day of args.days) {
      events.push({
        personId: booking.personId,
        shootDayId: day._id,
        email: person!.email!,
        date: day.date,
        summary: `${prefix}${args.projectName}${role ? ` — ${role}` : ""}`,
        description: describe({
          projectName: args.projectName,
          jobNumber: args.jobNumber,
          dayLabel: day.label,
          role,
          status: booking.status,
        }),
      });
    }
  }

  return events;
}

function describe(args: {
  projectName: string;
  jobNumber?: string;
  dayLabel?: string;
  role: string;
  status?: "pencilled" | "confirmed";
}): string {
  const lines = [args.projectName];
  if (args.jobNumber) lines.push(`Job ${args.jobNumber}`);
  if (args.dayLabel) lines.push(args.dayLabel);
  if (args.role) lines.push(`Role: ${args.role}`);
  lines.push(args.status === "confirmed" ? "Confirmed" : "Pencilled");
  lines.push("", "Booked in UnitDeck. Changes here are overwritten by the next sync.");
  return lines.join("\n");
}
