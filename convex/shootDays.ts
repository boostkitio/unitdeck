import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { fetchDailyForecast } from "./lib/weather";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireProject(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  const { org } = await requireOrg(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== org._id) throw new Error("Project not found");
  return { org, project };
}

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireProject(ctx, args.projectId);
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    const visible = days.filter((d) => d.orgId === org._id);
    visible.sort((a, b) => a.date.localeCompare(b.date));
    return await Promise.all(
      visible.map(async (d) => ({
        ...d,
        locations: (await Promise.all(d.locationIds.map((id) => ctx.db.get(id)))).filter(
          (l): l is Doc<"locations"> => l !== null
        ),
      }))
    );
  },
});

export const get = query({
  args: { id: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.id);
    if (!day || day.orgId !== org._id) return null;
    return {
      ...day,
      locations: (await Promise.all(day.locationIds.map((id) => ctx.db.get(id)))).filter(
        (l): l is Doc<"locations"> => l !== null
      ),
    };
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    date: v.string(),
    label: v.optional(v.string()),
    locationIds: v.array(v.id("locations")),
  },
  handler: async (ctx, args) => {
    const { org } = await requireProject(ctx, args.projectId);
    if (!DATE_RE.test(args.date)) throw new Error("Date must be YYYY-MM-DD");
    for (const locationId of args.locationIds) {
      const location = await ctx.db.get(locationId);
      if (!location || location.orgId !== org._id) throw new Error("Unknown location");
    }
    return await ctx.db.insert("shootDays", {
      orgId: org._id,
      projectId: args.projectId,
      date: args.date,
      label: args.label,
      locationIds: args.locationIds,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("shootDays"),
    date: v.optional(v.string()),
    label: v.optional(v.string()),
    locationIds: v.optional(v.array(v.id("locations"))),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.id);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    const patch: Record<string, unknown> = {};
    if (args.date !== undefined) {
      if (!DATE_RE.test(args.date)) throw new Error("Date must be YYYY-MM-DD");
      patch.date = args.date;
    }
    if (args.label !== undefined) patch.label = args.label;
    if (args.locationIds !== undefined) {
      for (const locationId of args.locationIds) {
        const location = await ctx.db.get(locationId);
        if (!location || location.orgId !== org._id) throw new Error("Unknown location");
      }
      patch.locationIds = args.locationIds;
    }
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.id);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    // Refuse deletion once call sheets exist; they are the record of the day
    const sheets = await ctx.db
      .query("callSheets")
      .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", args.id))
      .take(1);
    if (sheets.length > 0) throw new Error("This shoot day has call sheets and cannot be deleted");
    await ctx.db.delete(args.id);
    return null;
  },
});

// A production can be long, but a typo like 2026 -> 2062 should not create
// tens of thousands of rows.
const MAX_RANGE_DAYS = 366;

/**
 * Inclusive list of "YYYY-MM-DD" between two dates. Walked in UTC so the day
 * count never shifts with the server's timezone or a daylight-saving boundary.
 */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** True when something hangs off this day that deleting it would destroy. */
async function dayHasRecords(ctx: MutationCtx, day: Doc<"shootDays">): Promise<boolean> {
  if (day.wrapNotes !== undefined && day.wrapNotes.trim().length > 0) return true;
  const sheets = await ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", day._id))
    .take(1);
  if (sheets.length > 0) return true;
  const recipients = await ctx.db
    .query("recipients")
    .withIndex("by_shoot_day", (q) => q.eq("shootDayId", day._id))
    .take(1);
  return recipients.length > 0;
}

/**
 * Reconciles a project's shoot days to a date range, both ends inclusive.
 * Missing days inside the range are created; days outside it are removed.
 *
 * A day carrying a call sheet, crew recipients or wrap notes is never deleted
 * — that is the record of a shoot that actually happened. Those days are kept
 * and returned in `kept` so the UI can say what it declined to remove.
 */
export const setRange = mutation({
  args: {
    projectId: v.id("projects"),
    from: v.string(),
    to: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ created: number; removed: number; kept: string[] }> => {
    const { org } = await requireProject(ctx, args.projectId);
    if (!DATE_RE.test(args.from) || !DATE_RE.test(args.to)) {
      throw new Error("Dates must be YYYY-MM-DD");
    }
    if (args.from > args.to) throw new Error("The start date must not be after the end date");

    const wanted = datesBetween(args.from, args.to);
    if (wanted.length > MAX_RANGE_DAYS) {
      throw new Error(`A shoot range covers at most ${MAX_RANGE_DAYS} days`);
    }

    const existing = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(500);
    const existingDates = new Set(existing.map((d) => d.date));

    let created = 0;
    for (const date of wanted) {
      if (existingDates.has(date)) continue;
      await ctx.db.insert("shootDays", {
        orgId: org._id,
        projectId: args.projectId,
        date,
        locationIds: [],
      });
      created++;
    }

    const wantedDates = new Set(wanted);
    let removed = 0;
    const kept: string[] = [];
    for (const day of existing) {
      if (wantedDates.has(day.date)) continue;
      if (await dayHasRecords(ctx, day)) {
        kept.push(day.date);
        continue;
      }
      await ctx.db.delete(day._id);
      removed++;
    }
    kept.sort();

    return { created, removed, kept };
  },
});

export const getForWeather = internalQuery({
  args: { id: v.id("shootDays") },
  handler: async (ctx, args) => {
    const day = await ctx.db.get(args.id);
    if (!day) return null;
    const locations = (
      await Promise.all(day.locationIds.map((id) => ctx.db.get(id)))
    ).filter((l): l is Doc<"locations"> => l !== null);
    const withCoords = locations.find((l) => l.lat !== undefined && l.lng !== undefined);
    return { day, location: withCoords ?? null };
  },
});

export const saveWeather = internalMutation({
  args: {
    id: v.id("shootDays"),
    weather: v.object({
      fetchedAt: v.number(),
      summary: v.string(),
      tempMinC: v.number(),
      tempMaxC: v.number(),
      precipitationProbability: v.optional(v.number()),
      windMaxKph: v.optional(v.number()),
    }),
    sun: v.object({ sunrise: v.string(), sunset: v.string() }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { weather: args.weather, sun: args.sun });
    return null;
  },
});

/**
 * Pull the Open-Meteo daily forecast for the shoot day's first geocoded
 * location. Forecast range is ~16 days; outside that the API returns no
 * rows and we report "too far out" without failing.
 */
export const refreshWeather = action({
  args: { id: v.id("shootDays") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const result = await ctx.runQuery(internal.shootDays.getForWeather, { id: args.id });
    if (!result) throw new Error("Shoot day not found");
    if (!result.location) {
      return { ok: false as const, reason: "No location with coordinates on this shoot day" };
    }
    const { day, location } = result;
    const forecast = await fetchDailyForecast(location.lat!, location.lng!, day.date);
    if (!forecast) {
      return { ok: false as const, reason: "Shoot day is outside the 16-day forecast range" };
    }
    const weather = {
      fetchedAt: Date.now(),
      summary: forecast.summary,
      tempMinC: forecast.tempMinC,
      tempMaxC: forecast.tempMaxC,
      precipitationProbability: forecast.precipitationProbability,
      windMaxKph: forecast.windMaxKph,
    };
    await ctx.runMutation(internal.shootDays.saveWeather, {
      id: args.id,
      weather,
      sun: { sunrise: forecast.sunrise, sunset: forecast.sunset },
    });
    // Returned directly so callers can update documents without re-querying
    return {
      ok: true as const,
      weatherSummary: `${weather.summary}, ${Math.round(weather.tempMinC)}–${Math.round(weather.tempMaxC)}°C`,
      sunrise: forecast.sunrise,
      sunset: forecast.sunset,
    };
  },
});
