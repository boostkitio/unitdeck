import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { LEGACY_STATUSES, normaliseStatus } from "./lib/projectStatus";
import { fetchDailyForecast, fetchTimezone } from "./lib/weather";
import { formatInZone, sunTimes } from "./lib/sun";
import { geocodePlace } from "./lib/geocode";
import { contactsOf } from "./clients";
import { clearForProject } from "./projectClients";

// Only current statuses are settable; legacy values remain readable but can
// no longer be written.
const statusValidator = v.union(
  v.literal("not_booked"),
  v.literal("pencilled"),
  v.literal("confirmed")
);

/** Archived either by the flag, or by a legacy row still using the old status. */
function isArchived(project: Doc<"projects">): boolean {
  return project.archived === true || project.status === "archived";
}

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    // Show only archived projects, for the archive view.
    archivedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(200);
    const visible = args.archivedOnly
      ? projects.filter(isArchived)
      : args.includeArchived
        ? projects
        : projects.filter((p) => !isArchived(p));

    // One pass over the org's shoot days, grouped in memory, rather than a
    // per-project query: the table shows a date for every row at once.
    const today = new Date().toISOString().slice(0, 10);
    const shootDays = await ctx.db
      .query("shootDays")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(2000);
    const datesByProject = new Map<Id<"projects">, string[]>();
    for (const day of shootDays) {
      const dates = datesByProject.get(day.projectId);
      if (dates) dates.push(day.date);
      else datesByProject.set(day.projectId, [day.date]);
    }
    for (const dates of datesByProject.values()) dates.sort();

    // Resolve client names for the table view
    return await Promise.all(
      visible.map(async (p) => {
        const dates = datesByProject.get(p._id) ?? [];
        return {
          ...p,
          clientName: p.clientId ? ((await ctx.db.get(p.clientId))?.name ?? null) : null,
          jobNumber: p.jobNumber ?? null,
          locationName: p.locationId ? ((await ctx.db.get(p.locationId))?.name ?? null) : null,
          status: normaliseStatus(p.status),
          archived: isArchived(p),
          // Earliest shoot day still to come, and the last one on the books.
          // The table shows the former and falls back to the latter.
          nextShootDate: dates.find((d) => d >= today) ?? null,
          lastShootDate: dates.length > 0 ? dates[dates.length - 1] : null,
          shootDayCount: dates.length,
        };
      })
    );
  },
});


/**
 * The shoot day a project's header speaks for: the next one still to come, or
 * the last one if the shoot is over. A production booked across a week wants
 * the day it is heading into, not whichever row happens to sort first.
 */
function headlineShootDate(dates: string[], today: string): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return sorted.find((date) => date >= today) ?? sorted[sorted.length - 1];
}


/**
 * The next job number for an organisation.
 *
 * Numbers are strings so a house scheme like "KLX-0042" is as valid as plain
 * counting, which means "next" is only meaningful for the ones that are just
 * digits: the highest of those, plus one. A company using its own scheme
 * simply types over what it is given.
 */
async function nextJobNumber(ctx: MutationCtx, orgId: Id<"organisations">): Promise<string> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(2000);

  let highest = 0;
  for (const project of projects) {
    const number = project.jobNumber?.trim();
    if (!number || !/^\d+$/.test(number)) continue;
    highest = Math.max(highest, Number(number));
  }
  // Four digits so they sort and read consistently from the start.
  return String(highest + 1).padStart(4, "0");
}

/** Rejects a job number already in use, which the URL depends on. */
async function assertJobNumberFree(
  ctx: MutationCtx,
  orgId: Id<"organisations">,
  jobNumber: string,
  ignore?: Id<"projects">,
) {
  const clash = await ctx.db
    .query("projects")
    .withIndex("by_org_and_job_number", (q) => q.eq("orgId", orgId).eq("jobNumber", jobNumber))
    .take(2);
  if (clash.some((p) => p._id !== ignore)) {
    throw new Error(`Job number ${jobNumber} is already in use`);
  }
}

/**
 * Finds a project by whatever the URL holds — its job number, or the document
 * id links used before job numbers existed. Keeping both readable means old
 * links, bookmarks and anything already sent out still work.
 */
export const getByRef = query({
  args: { ref: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const byNumber = await ctx.db
      .query("projects")
      .withIndex("by_org_and_job_number", (q) =>
        q.eq("orgId", org._id).eq("jobNumber", args.ref.trim())
      )
      .first();
    let project = byNumber;
    if (!project) {
      // Not a job number, so try it as a document id — which is what every
      // link made before job numbers existed contains. A ref that is not an
      // id at all makes this throw, and "not found" is the right answer.
      try {
        project = await ctx.db.get(args.ref as Id<"projects">);
      } catch {
        project = null;
      }
    }
    if (!project || project.orgId !== org._id) return null;
    return await withRelations(ctx, project);
  },
});

/** The project with everything the detail page reads alongside it. */
async function withRelations(ctx: QueryCtx, project: Doc<"projects">) {
  const location = project.locationId ? await ctx.db.get(project.locationId) : null;

  const days = await ctx.db
    .query("shootDays")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .take(200);
  const forecastDate = headlineShootDate(
    days.map((d) => d.date),
    new Date().toISOString().slice(0, 10),
  );

  const client = project.clientId ? await ctx.db.get(project.clientId) : null;
  // Who booked the job, out of everybody at that client. Falls back to the
  // first contact, which is who it was before there was a choice, and to
  // nothing at all if that contact has since been removed.
  const allContacts = client ? contactsOf(client) : [];
  const byId =
    project.bookedByContactId !== undefined
      ? allContacts.findIndex((c) => c.id === project.bookedByContactId)
      : -1;
  const bookedByIndex =
    byId >= 0
      ? byId
      : project.bookedByContact !== undefined &&
          project.bookedByContact >= 0 &&
          project.bookedByContact < allContacts.length
        ? project.bookedByContact
        : allContacts.length > 0
          ? 0
          : null;
  const bookedBy = bookedByIndex === null ? null : allContacts[bookedByIndex];
  return {
    ...project,
    clientName: client?.name ?? null,
    // Whoever you actually ring at the client, carried onto the project so
    // it is not a trip to another tab mid-shoot.
    clientContact: bookedBy
      ? {
          contactName: bookedBy.name,
          role: bookedBy.role ?? null,
          phone: bookedBy.phone ?? null,
          email: bookedBy.email ?? null,
        }
      : null,
    bookedByContact: bookedByIndex,
    status: normaliseStatus(project.status),
    archived: isArchived(project),
    location,
    // The day and place the header reports on. The client compares these
    // with `forecast` to know whether what it is showing is still current.
    forecastDate,
    // Any location at all, coordinates or not: looking them up is the
    // forecast's job, so the header should ask rather than give up here.
    forecastLocationId: location ? location._id : null,
  };
}

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) return null;
    return await withRelations(ctx, project);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    clientId: v.optional(v.id("clients")),
    briefSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Project name is required");
    if (args.clientId) {
      const client = await ctx.db.get(args.clientId);
      if (!client || client.orgId !== org._id) throw new Error("Unknown client");
    }
    return await ctx.db.insert("projects", {
      orgId: org._id,
      name: args.name.trim(),
      clientId: args.clientId,
      jobNumber: await nextJobNumber(ctx, org._id),
      status: "not_booked",
      briefSummary: args.briefSummary,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    clientId: v.optional(v.union(v.id("clients"), v.null())),
    jobNumber: v.optional(v.string()),
    status: v.optional(statusValidator),
    briefSummary: v.optional(v.string()),
    locationId: v.optional(v.union(v.id("locations"), v.null())),
    bookedByContact: v.optional(v.union(v.number(), v.null())),
    // Null clears the owner; a string sets it to that Clerk member.
    ownerId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    const patch: Record<string, unknown> = {};
    if (args.ownerId !== undefined) {
      patch.ownerId = args.ownerId === null ? undefined : args.ownerId;
    }
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Project name is required");
      patch.name = args.name.trim();
    }
    if (args.clientId !== undefined) {
      if (args.clientId !== null) {
        const client = await ctx.db.get(args.clientId);
        if (!client || client.orgId !== org._id) throw new Error("Unknown client");
        patch.clientId = args.clientId;
      } else {
        patch.clientId = undefined;
      }
      // Whoever booked it worked at the old client, and so did everybody
      // booked onto it. Changing the company without clearing them would
      // point at a stranger's phone number.
      if (args.clientId !== project.clientId) {
        patch.bookedByContact = undefined;
        patch.bookedByContactId = undefined;
        await clearForProject(ctx, args.id);
      }
    }
    if (args.bookedByContact !== undefined) {
      patch.bookedByContact = args.bookedByContact ?? undefined;
      // Stored by stable id as well, so the choice survives the book being
      // reordered or somebody above them being deleted.
      const client = (args.clientId ?? project.clientId) as Id<"clients"> | undefined;
      const book = client ? contactsOf((await ctx.db.get(client))!) : [];
      patch.bookedByContactId =
        args.bookedByContact === null ? undefined : book[args.bookedByContact]?.id;
    }
    if (args.jobNumber !== undefined) {
      const jobNumber = args.jobNumber.trim();
      if (jobNumber.length === 0) throw new Error("A job number cannot be blank");
      // It addresses the project in the URL, so two cannot share one.
      await assertJobNumberFree(ctx, org._id, jobNumber, args.id);
      patch.jobNumber = jobNumber;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.briefSummary !== undefined) patch.briefSummary = args.briefSummary;
    if (args.locationId !== undefined) {
      if (args.locationId !== null) {
        const location = await ctx.db.get(args.locationId);
        if (!location || location.orgId !== org._id) throw new Error("Unknown location");
        patch.locationId = args.locationId;
      } else {
        patch.locationId = undefined;
      }
    }

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

/**
 * Archiving hides a project from active lists without touching its booking
 * status, so an archived production still shows who was on it and where.
 */
export const setArchived = mutation({
  args: { id: v.id("projects"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    const patch: Record<string, unknown> = { archived: args.archived };
    // A legacy row archived via its status needs a real status back, or it
    // would still read as archived once the flag is cleared.
    if (project.status === "archived") patch.status = normaliseStatus(project.status);
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

/** How many projects still carry a pre-booking-model status. */
export const legacyStatusCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    return projects.filter((p) => LEGACY_STATUSES.includes(p.status)).length;
  },
});

/**
 * Rewrites legacy statuses to the booking model and moves status-based
 * archiving onto the flag. Idempotent: rows already migrated are skipped, so
 * running it twice is harmless.
 */
/**
 * Deletes a project outright, along with everything hanging off it.
 *
 * Only an archived project can be deleted. Archiving is the reversible step
 * and this one is not, so making it the second of two deliberate actions is
 * the difference between tidying up and losing a production's records.
 *
 * Rows that exist only as part of the project go with it. Shared records —
 * people, clients, locations, inventory — are left completely alone: they
 * belong to the company, not to this job.
 */
export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (!isArchived(project)) {
      throw new Error("Archive the project before deleting it");
    }

    let deleted = 0;

    const crew = await ctx.db
      .query("projectCrew")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .take(500);
    for (const row of crew) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    const kit = await ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .take(1000);
    for (const row of kit) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .take(500);
    for (const row of files) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .take(500);
    for (const row of days) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    await ctx.db.delete(args.id);
    return { deleted: deleted + 1 };
  },
});

/** How many projects are still without a job number. */
export const unnumberedCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(2000);
    return projects.filter((p) => !p.jobNumber?.trim()).length;
  },
});

/**
 * Numbers the projects that predate job numbers, oldest first, so the numbers
 * run in the order the work came in rather than alphabetically or at random.
 */
export const assignJobNumbers = mutation({
  args: {},
  handler: async (ctx): Promise<{ numbered: number }> => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(2000);

    const unnumbered = projects
      .filter((p) => !p.jobNumber?.trim())
      .sort((a, b) => a._creationTime - b._creationTime);

    let next = Number(await nextJobNumber(ctx, org._id));
    for (const project of unnumbered) {
      await ctx.db.patch(project._id, { jobNumber: String(next).padStart(4, "0") });
      next++;
    }
    return { numbered: unnumbered.length };
  },
});

export const migrateStatuses = mutation({
  args: {},
  handler: async (ctx): Promise<{ migrated: number }> => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);

    let migrated = 0;
    for (const project of projects) {
      if (!LEGACY_STATUSES.includes(project.status)) continue;
      await ctx.db.patch(project._id, {
        status: normaliseStatus(project.status),
        archived: project.archived === true || project.status === "archived",
      });
      migrated++;
    }
    return { migrated };
  },
});

/** Everything the forecast action needs, resolved inside the org check. */
export const getForForecast = internalQuery({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    // The org check belongs here rather than in the action: an action has no
    // database to check against, and runQuery carries the caller's identity.
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) return null;
    // A location without coordinates is still worth returning: it has an
    // address, and the forecast can look those up. Refusing here is what left
    // a located project reading "Checking the forecast…" for good.
    const location = project.locationId ? await ctx.db.get(project.locationId) : null;
    if (!location) return null;

    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .take(200);
    const date = headlineShootDate(
      days.map((d) => d.date),
      new Date().toISOString().slice(0, 10)
    );
    if (!date) return null;
    return { date, location };
  },
});

export const saveForecast = internalMutation({
  args: {
    id: v.id("projects"),
    locationId: v.id("locations"),
    timezone: v.optional(v.string()),
    forecast: v.object({
      date: v.string(),
      locationId: v.id("locations"),
      fetchedAt: v.number(),
      reason: v.optional(v.string()),
      summary: v.optional(v.string()),
      tempMinC: v.optional(v.number()),
      tempMaxC: v.optional(v.number()),
      precipitationProbability: v.optional(v.number()),
      windMaxKph: v.optional(v.number()),
      sunrise: v.optional(v.string()),
      sunset: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { forecast: args.forecast });
    // Worth keeping: it is what lets a shoot beyond the forecast window still
    // show its sun times in local time.
    if (args.timezone) {
      const location = await ctx.db.get(args.locationId);
      if (location && location.timezone !== args.timezone) {
        await ctx.db.patch(args.locationId, { timezone: args.timezone });
      }
    }
    return null;
  },
});

/** Roughly how far Open-Meteo forecasts. Past this, only the sun is known. */
const FORECAST_HORIZON_DAYS = 16;

/** Whole days between today and a "YYYY-MM-DD" date; negative for the past. */
function daysAhead(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (!isFinite(target)) return 0;
  return Math.round((target - today) / 86_400_000);
}

/**
 * Sunrise, sunset and the weather for the project's shoot day at its location.
 *
 * Sun times always come back: they are astronomy, so they are known for any
 * date, and a producer setting a call time months out needs them. Weather only
 * reaches about sixteen days, and beyond that the reason is recorded rather
 * than left blank.
 */
export const refreshForecast = action({
  args: { id: v.id("projects") },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const target = await ctx.runQuery(internal.projects.getForForecast, { id: args.id });
    if (!target) return { ok: false, reason: "No shoot date, or no location with coordinates" };

    const { date, location } = target;

    // A location that was typed rather than picked has no coordinates until
    // something asks for them. Ask now: the weather is the first thing that
    // needs them, and a producer who has set a location has done their part.
    let lat = location.lat;
    let lng = location.lng;
    // Says the weather is for somewhere looser than the address given, which
    // is worth admitting rather than quietly reporting the next town's sky.
    let approximate: string | null = null;
    if (lat === undefined || lng === undefined) {
      const placed = await geocodePlace(location.address).catch(() => null);
      if (placed) {
        lat = placed.lat;
        lng = placed.lng;
        if (placed.precise) {
          // Only an address-level match is written back: the map pin uses
          // these too, and a pin on the wrong side of town is worse than none.
          await ctx.runMutation(internal.locations.saveCoordinates, {
            id: location._id,
            lat,
            lng,
          });
        } else {
          approximate = placed.matched;
        }
      }
    }

    if (lat === undefined || lng === undefined) {
      // Nothing more to try. Record why, so the line under the title says so
      // rather than checking forever.
      const reason = location.address.trim()
        ? `Could not place “${location.address.trim()}” on the map`
        : "This location has no address to look up";
      await ctx.runMutation(internal.projects.saveForecast, {
        id: args.id,
        locationId: location._id,
        forecast: { date, locationId: location._id, fetchedAt: Date.now(), reason },
      });
      return { ok: false, reason };
    }

    // A weather service that is down, rate-limiting or unreachable must not
    // leave the header stuck: fall through to sun times, which are arithmetic.
    const forecast = await fetchDailyForecast(lat, lng, date).catch(() => null);
    if (forecast) {
      await ctx.runMutation(internal.projects.saveForecast, {
        id: args.id,
        locationId: location._id,
        timezone: forecast.timezone,
        forecast: {
          date,
          locationId: location._id,
          fetchedAt: Date.now(),
          summary: forecast.summary,
          tempMinC: forecast.tempMinC,
          tempMaxC: forecast.tempMaxC,
          precipitationProbability: forecast.precipitationProbability,
          windMaxKph: forecast.windMaxKph,
          sunrise: forecast.sunrise,
          sunset: forecast.sunset,
          reason: approximate ? `Weather for ${approximate}` : undefined,
        },
      });
      return {
        ok: true,
        reason: approximate ? `Forecast updated for ${approximate}.` : "Forecast updated.",
      };
    }

    // Either beyond the forecast window or the service did not answer. The sun
    // still rises: work it out and show it, in the location's own time.
    const timezone = location.timezone ?? (await fetchTimezone(lat, lng).catch(() => undefined));
    const sun = sunTimes(date, lat, lng);
    const beyondForecast = daysAhead(date) > FORECAST_HORIZON_DAYS;
    const reason = beyondForecast
      ? sun
        ? "Too far ahead for a forecast"
        : "Too far ahead for a forecast, and the sun does not rise or set here that day"
      : "Could not reach the weather service — sun times only";
    await ctx.runMutation(internal.projects.saveForecast, {
      id: args.id,
      locationId: location._id,
      timezone,
      forecast: {
        date,
        locationId: location._id,
        fetchedAt: Date.now(),
        reason,
        sunrise: sun ? formatInZone(sun.sunriseMs, timezone) : undefined,
        sunset: sun ? formatInZone(sun.sunsetMs, timezone) : undefined,
      },
    });
    return { ok: true, reason };
  },
});


/**
 * How long after the last shoot day a production is left alone.
 *
 * A job outlives its shoot — post, invoicing, deliverables — so a fortnight
 * is the gap between wrapping and the point where a production is fairly
 * called finished. Raise it if archiving starts catching work still going on.
 */
const DAYS_AFTER_WRAP = 14;

/**
 * Archives productions whose shoot is over.
 *
 * Runs for every organisation, so it takes no org from a caller and derives
 * nothing from one. A production with no dates in the diary has nothing that
 * can have passed and is left where it is; so is one already archived.
 *
 * Archiving is reversible and archived work has its own view, which is what
 * makes doing this automatically reasonable at all.
 */
export const archiveFinished = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() - DAYS_AFTER_WRAP * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // One pass over the shoot days rather than a query per production.
    const days = await ctx.db.query("shootDays").take(20_000);
    const lastDay = new Map<string, string>();
    for (const day of days) {
      const key = String(day.projectId);
      const seen = lastDay.get(key);
      if (!seen || day.date > seen) lastDay.set(key, day.date);
    }

    const projects = await ctx.db.query("projects").take(5_000);
    let archived = 0;
    for (const project of projects) {
      if (project.archived === true || project.status === "archived") continue;
      const last = lastDay.get(String(project._id));
      // No dates means nothing has passed.
      if (last === undefined || last >= cutoff) continue;
      await ctx.db.patch(project._id, { archived: true });
      archived++;
    }
    return { archived };
  },
});
