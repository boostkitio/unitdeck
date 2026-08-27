import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/auth";
import { eventIdFor, isStaffEmail, planEvents, type PlannedEvent } from "./lib/calendarPlan";
import { accessTokenFor, serviceAccountFromEnv } from "./lib/googleAuth";
import { deleteEvent, listEvents, writeEvent } from "./lib/googleCalendarApi";

/**
 * Putting a production's bookings on its own staff's Google calendars.
 *
 * The shape is deliberately a reconciliation rather than a stream of events:
 * something changes on a production, and the whole production is worked out
 * again from scratch and made to match. That is a few more writes than
 * tracking each change individually, and it is the reason a failed sync, a
 * deleted entry, a renamed job or a shoot that moved all come right on the
 * next run without anybody having to reason about ordering.
 *
 * Only addresses in the organisation's own domain are ever written to. That is
 * checked here and enforced again by Google, which refuses an assertion naming
 * anybody outside the domain whose admin authorised us.
 */

// ---------------------------------------------------------------------------
// Reading what should exist
// ---------------------------------------------------------------------------

/** Everything the plan needs, in one read, for one production. */
export const planFor = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const org = await ctx.db.get(project.orgId);
    if (!org) return null;

    const existing = await ctx.db
      .query("calendarEvents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(2000);

    // An archived production is over as far as anybody's diary is concerned:
    // nothing is planned, so everything already written is taken down.
    const off = org.settings?.calendarSync !== true || project.archived === true;
    if (off) return { orgId: org._id, planned: [] as PlannedEvent[], existing };

    const [crew, days] = await Promise.all([
      ctx.db
        .query("projectCrew")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(500),
      ctx.db
        .query("shootDays")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(500),
    ]);
    const people = await loadPeople(ctx, crew);

    return {
      orgId: org._id,
      existing,
      planned: planEvents({
        projectName: project.name,
        jobNumber: project.jobNumber,
        domain: org.settings?.calendarDomain,
        crew: crew.map((row) => ({
          personId: row.personId,
          role: row.role,
          status: row.status,
        })),
        people: people.map((person) => ({
          _id: person._id,
          name: person.name,
          role: person.role,
          email: person.email,
        })),
        days: days.map((day) => ({ _id: day._id, date: day.date, label: day.label })),
      }),
    };
  },
});

async function loadPeople(ctx: QueryCtx, crew: Doc<"projectCrew">[]): Promise<Doc<"people">[]> {
  const ids = [...new Set(crew.map((row) => row.personId).filter(Boolean))] as Id<"people">[];
  const people = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return people.filter((person): person is Doc<"people"> => person !== null);
}

// ---------------------------------------------------------------------------
// Recording what was done
// ---------------------------------------------------------------------------

export const recordWrite = internalMutation({
  args: {
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    shootDayId: v.id("shootDays"),
    personId: v.id("people"),
    email: v.string(),
    eventId: v.string(),
    summary: v.string(),
    date: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendarEvents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(2000);
    const row = existing.find((e) => e.eventId === args.eventId);
    const fields = {
      orgId: args.orgId,
      projectId: args.projectId,
      shootDayId: args.shootDayId,
      personId: args.personId,
      email: args.email,
      eventId: args.eventId,
      summary: args.summary,
      date: args.date,
      state: (args.error ? "failed" : "synced") as "failed" | "synced",
      lastError: args.error,
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("calendarEvents", fields);
    return null;
  },
});

export const forget = internalMutation({
  args: { id: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Making it so
// ---------------------------------------------------------------------------

/**
 * Bring one production's calendar entries in line with its bookings.
 *
 * Scheduled from every mutation that could change the answer, and safe to run
 * at any time: it compares rather than remembers.
 */
export const reconcileProject = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ written: number; removed: number; failed: number }> => {
    const account = serviceAccountFromEnv(process.env);
    // Not configured is not a failure. Every production carries on working
    // exactly as it did before anyone thought about calendars.
    if (!account) return { written: 0, removed: 0, failed: 0 };

    const plan = await ctx.runQuery(internal.calendarSync.planFor, {
      projectId: args.projectId,
    });
    if (!plan) return { written: 0, removed: 0, failed: 0 };

    const wanted = new Map(
      plan.planned.map((event) => [eventIdFor(event.personId, event.shootDayId), event])
    );
    // One token per calendar, not per entry: a person on a five-day shoot is
    // one exchange with Google rather than five.
    const tokens = new Map<string, string>();
    async function tokenFor(email: string): Promise<string> {
      const held = tokens.get(email);
      if (held) return held;
      const fresh = await accessTokenFor(account!, email);
      tokens.set(email, fresh);
      return fresh;
    }

    let written = 0;
    let removed = 0;
    let failed = 0;

    // Gone from the plan: unbooked, day deleted, left the company, sync
    // turned off. Whatever the reason, take the entry down.
    for (const row of plan.existing) {
      if (wanted.has(row.eventId)) continue;
      try {
        await deleteEvent({
          token: await tokenFor(row.email),
          calendarId: row.email,
          eventId: row.eventId,
        });
        await ctx.runMutation(internal.calendarSync.forget, { id: row._id });
        removed++;
      } catch {
        // Left in place deliberately: the row is the only record that the
        // entry exists, so forgetting it while it is still on somebody's
        // calendar would strand it there for good.
        failed++;
      }
    }

    const already = new Map(plan.existing.map((row) => [row.eventId, row]));
    for (const [eventId, event] of wanted) {
      const row = already.get(eventId);
      // Unchanged and last written successfully: nothing to say to Google.
      if (
        row &&
        row.state === "synced" &&
        row.summary === event.summary &&
        row.date === event.date &&
        row.email === event.email
      ) {
        continue;
      }
      try {
        await writeEvent({
          token: await tokenFor(event.email),
          calendarId: event.email,
          // Only an entry we have a record of writing may be updated. Without
          // one this inserts, and backs off if the id is somehow taken by
          // something we did not create.
          ours: row !== undefined,
          event: {
            id: eventId,
            summary: event.summary,
            description: event.description,
            date: event.date,
          },
        });
        written++;
        await ctx.runMutation(internal.calendarSync.recordWrite, {
          orgId: plan.orgId,
          projectId: args.projectId,
          shootDayId: event.shootDayId as Id<"shootDays">,
          personId: event.personId as Id<"people">,
          email: event.email,
          eventId,
          summary: event.summary,
          date: event.date,
        });
      } catch (err) {
        failed++;
        await ctx.runMutation(internal.calendarSync.recordWrite, {
          orgId: plan.orgId,
          projectId: args.projectId,
          shootDayId: event.shootDayId as Id<"shootDays">,
          personId: event.personId as Id<"people">,
          email: event.email,
          eventId,
          summary: event.summary,
          date: event.date,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return { written, removed, failed };
  },
});

// ---------------------------------------------------------------------------
// Settings, and what the office can see
// ---------------------------------------------------------------------------

export const settings = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const failures = await ctx.db
      .query("calendarEvents")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    return {
      enabled: org.settings?.calendarSync === true,
      domain: org.settings?.calendarDomain,
      synced: failures.filter((row) => row.state === "synced").length,
      // Surfaced rather than swallowed: a sync that quietly stopped working is
      // worse than one that never started.
      problems: failures
        .filter((row) => row.state === "failed")
        .slice(0, 5)
        .map((row) => ({ email: row.email, date: row.date, error: row.lastError })),
    };
  },
});

export const configure = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const settings = { ...org.settings };
    if (args.enabled !== undefined) settings.calendarSync = args.enabled;
    if (args.domain !== undefined) {
      const cleaned = args.domain.trim().replace(/^@/, "").toLowerCase();
      settings.calendarDomain = cleaned.length > 0 ? cleaned : undefined;
    }
    await ctx.db.patch(org._id, { settings });

    // Turning it on should do something visible, and turning it off should
    // clear people's calendars rather than leaving stale entries behind.
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    for (const project of projects) {
      await ctx.scheduler.runAfter(0, internal.calendarSync.reconcileProject, {
        projectId: project._id,
      });
    }
    return null;
  },
});

/** Sync one production on demand, for when somebody wants to be sure. */
export const syncProject = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ written: number; removed: number; failed: number }> => {
    // Runs through the same internal action, which reads the org from the
    // project — but the caller still has to be in the org to ask.
    await ctx.runQuery(internal.calendarSync.assertMember, { projectId: args.projectId });
    return await ctx.runAction(internal.calendarSync.reconcileProject, {
      projectId: args.projectId,
    });
  },
});

export const assertMember = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    return null;
  },
});


// ---------------------------------------------------------------------------
// Reading what else people have on
// ---------------------------------------------------------------------------

/**
 * How far ahead the office is shown. Far enough to plan a shoot around
 * somebody's holiday, short enough that the cache stays small and a stale row
 * cannot survive long.
 */
const BUSY_DAYS_AHEAD = 90;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The organisations with sync on, and the staff whose diaries we may read. */
export const orgsToRead = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organisations").take(200);
    const enabled = orgs.filter(
      (org) => org.settings?.calendarSync === true && org.settings?.calendarDomain
    );
    return enabled.map((org) => ({ orgId: org._id, domain: org.settings!.calendarDomain! }));
  },
});

export const staffFor = internalQuery({
  args: { orgId: v.id("organisations"), domain: v.string() },
  handler: async (ctx, args) => {
    const people = await ctx.db
      .query("people")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .take(1000);
    return people
      .filter((person) => person.archived !== true && isStaffEmail(person.email, args.domain))
      .map((person) => ({ personId: person._id, email: person.email! }));
  },
});

/**
 * Replace one person's window wholesale.
 *
 * Wholesale rather than merged: an appointment that was cancelled has to
 * disappear, and working out which of the rows we hold no longer exists is the
 * same work as writing them all again.
 */
export const replaceBusy = internalMutation({
  args: {
    orgId: v.id("organisations"),
    personId: v.id("people"),
    email: v.string(),
    events: v.array(
      v.object({
        eventId: v.string(),
        summary: v.string(),
        startDate: v.string(),
        endDate: v.string(),
        ours: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const held = await ctx.db
      .query("calendarBusy")
      .withIndex("by_person", (q) => q.eq("personId", args.personId))
      .take(2000);
    for (const row of held) await ctx.db.delete(row._id);

    const fetchedAt = Date.now();
    for (const event of args.events) {
      await ctx.db.insert("calendarBusy", {
        orgId: args.orgId,
        personId: args.personId,
        email: args.email,
        fetchedAt,
        ...event,
      });
    }
    return null;
  },
});

/** Refresh every staff diary in one organisation. */
export const refreshBusyForOrg = internalAction({
  args: { orgId: v.id("organisations"), domain: v.string() },
  handler: async (ctx, args): Promise<{ people: number; events: number }> => {
    const account = serviceAccountFromEnv(process.env);
    if (!account) return { people: 0, events: 0 };

    const staff = await ctx.runQuery(internal.calendarSync.staffFor, {
      orgId: args.orgId,
      domain: args.domain,
    });
    const from = today();
    const to = daysFromToday(BUSY_DAYS_AHEAD);

    let events = 0;
    for (const person of staff) {
      try {
        const token = await accessTokenFor(account, person.email);
        const found = await listEvents({
          token,
          calendarId: person.email,
          from,
          to,
        });
        await ctx.runMutation(internal.calendarSync.replaceBusy, {
          orgId: args.orgId,
          personId: person.personId,
          email: person.email,
          events: found,
        });
        events += found.length;
      } catch {
        // One person's calendar being unreadable — they left, they were never
        // in the domain — must not stop everybody else's from refreshing.
      }
    }
    return { people: staff.length, events };
  },
});

/** The hourly sweep. Every organisation with sync switched on. */
export const refreshAllBusy = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const orgs = await ctx.runQuery(internal.calendarSync.orgsToRead, {});
    for (const org of orgs) {
      await ctx.runAction(internal.calendarSync.refreshBusyForOrg, org);
    }
    return null;
  },
});

/** Refresh on demand, for when somebody wants to be sure before booking. */
export const refreshBusyNow = action({
  args: {},
  handler: async (ctx): Promise<{ people: number; events: number }> => {
    const org = await ctx.runQuery(internal.calendarSync.myOrg, {});
    if (!org) return { people: 0, events: 0 };
    return await ctx.runAction(internal.calendarSync.refreshBusyForOrg, org);
  },
});

export const myOrg = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    if (org.settings?.calendarSync !== true || !org.settings?.calendarDomain) return null;
    return { orgId: org._id, domain: org.settings.calendarDomain };
  },
});

/**
 * Who is otherwise committed between two dates.
 *
 * Entries UnitDeck wrote are left out: those are the bookings the schedule is
 * already showing, and listing a shoot again as a clash with itself would be
 * nonsense. Everything else is read-only here and says so.
 */
export const busy = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("calendarBusy")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(4000);

    const overlapping = rows.filter(
      (row) => !row.ours && row.startDate <= args.to && row.endDate >= args.from
    );
    const names = new Map<string, string>();
    for (const row of overlapping) {
      if (names.has(row.personId)) continue;
      const person = await ctx.db.get(row.personId);
      names.set(row.personId, person?.name ?? "Somebody");
    }

    return overlapping.map((row) => ({
      personId: row.personId,
      name: names.get(row.personId) ?? "Somebody",
      summary: row.summary,
      startDate: row.startDate,
      endDate: row.endDate,
    }));
  },
});
