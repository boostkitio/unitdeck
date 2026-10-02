import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import {
  dayForecastIsFresh,
  fetchDailyForecast,
  fetchTimezone,
  FORECAST_HORIZON_DAYS,
} from "./lib/weather";
import { formatInZone, sunTimes } from "./lib/sun";
import { geocodePlace } from "./lib/geocode";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 24-hour, zero-padded: what a native time box produces. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

async function requireProject(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  const { org } = await requireOrg(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== org._id) throw new Error("Project not found");
  return { org, project };
}


/** See convex/calendarSync.ts: the days a production runs decide the entries. */
async function syncCalendar(ctx: MutationCtx, projectId: Id<"projects">) {
  await ctx.scheduler.runAfter(0, internal.calendarSync.reconcileProject, { projectId });
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
    const day = await ctx.db.insert("shootDays", {
      orgId: org._id,
      projectId: args.projectId,
      date: args.date,
      label: args.label,
      locationIds: args.locationIds,
    });
    await syncCalendar(ctx, args.projectId);
    return day;
  },
});

export const update = mutation({
  args: {
    id: v.id("shootDays"),
    date: v.optional(v.string()),
    label: v.optional(v.string()),
    // Null clears a time; "" from an emptied box means the same thing.
    callTime: v.optional(v.union(v.string(), v.null())),
    wrapTime: v.optional(v.union(v.string(), v.null())),
    locationIds: v.optional(v.array(v.id("locations"))),
    // Null clears the block; an object replaces it wholesale, because a
    // half-edited hotel is worse than none on a call sheet.
    accommodation: v.optional(
      v.union(
        v.object({
          name: v.string(),
          address: v.optional(v.string()),
          phone: v.optional(v.string()),
          checkIn: v.optional(v.string()),
          bookingRef: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
        v.null()
      )
    ),
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
    for (const field of ["callTime", "wrapTime"] as const) {
      const value = args[field];
      if (value === undefined) continue;
      if (value === null || value === "") {
        patch[field] = undefined;
        continue;
      }
      if (!TIME_RE.test(value)) throw new Error("Time must be HH:MM");
      patch[field] = value;
    }
    if (args.accommodation !== undefined) {
      patch.accommodation = args.accommodation ?? undefined;
    }
    if (args.locationIds !== undefined) {
      for (const locationId of args.locationIds) {
        const location = await ctx.db.get(locationId);
        if (!location || location.orgId !== org._id) throw new Error("Unknown location");
      }
      patch.locationIds = args.locationIds;
    }
    await ctx.db.patch(args.id, patch);
    // A day that moved moves in everyone's diary too.
    if (patch.date !== undefined) await syncCalendar(ctx, day.projectId);
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
    // The day is gone, so its entries come off the diaries that had it.
    await syncCalendar(ctx, day.projectId);
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
    // Days created and days dropped, in one go: work the whole production out
    // again rather than chase each one.
    await syncCalendar(ctx, args.projectId);

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

/**
 * Every shoot day on a production, with the place its weather is for: the
 * day's own first location, or the production's when the day has none — the
 * same place its call sheet prints.
 */
export const getForProjectWeather = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org, project } = await requireProject(ctx, args.projectId);
    const days = (
      await ctx.db
        .query("shootDays")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(100)
    ).filter((d) => d.orgId === org._id);
    const projectLocation = project.locationId ? await ctx.db.get(project.locationId) : null;
    const out: { day: Doc<"shootDays">; location: Doc<"locations"> | null }[] = [];
    for (const day of days) {
      const own = day.locationIds.length > 0 ? await ctx.db.get(day.locationIds[0]) : null;
      out.push({ day, location: own ?? projectLocation });
    }
    return out.sort((a, b) => a.day.date.localeCompare(b.day.date));
  },
});

export const saveDayForecast = internalMutation({
  args: {
    id: v.id("shootDays"),
    locationId: v.optional(v.id("locations")),
    reason: v.optional(v.string()),
    weather: v.optional(
      v.object({
        fetchedAt: v.number(),
        summary: v.string(),
        tempMinC: v.number(),
        tempMaxC: v.number(),
        precipitationProbability: v.optional(v.number()),
        windMaxKph: v.optional(v.number()),
      })
    ),
    sun: v.optional(v.object({ sunrise: v.string(), sunset: v.string() })),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.id);
    if (!day || day.orgId !== org._id) return null;
    await ctx.db.patch(args.id, {
      forecastCheckedAt: Date.now(),
      forecastLocationId: args.locationId,
      forecastReason: args.reason,
      // Replaced rather than kept: a forecast from before a location changed
      // is the weather somewhere else.
      weather: args.weather,
      sun: args.sun ?? day.sun,
    });
    return null;
  },
});

/** Whole days between today and a "YYYY-MM-DD" date; negative for the past. */
function daysAhead(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (!isFinite(target)) return 0;
  return Math.round((target - today) / 86_400_000);
}

type DayForecast = {
  shootDayId: Id<"shootDays">;
  date: string;
  weatherSummary?: string;
  sunrise?: string;
  sunset?: string;
  reason?: string;
};

/**
 * The weather and sun times for every shoot day on a production, each at its
 * own location.
 *
 * Days checked recently are left alone unless `force` is set, so opening the
 * page does not ask the weather service about a ten-day shoot every time.
 * Beyond the forecast window the sun times are still worked out, since a call
 * time months ahead is set by them.
 */
export const refreshWeatherForProject = action({
  args: { projectId: v.id("projects"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ days: DayForecast[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const targets = await ctx.runQuery(internal.shootDays.getForProjectWeather, {
      projectId: args.projectId,
    });

    // Each place is looked up once, however many days are shot there.
    const placed = new Map<string, { lat: number; lng: number; approximate: string | null } | null>();
    async function place(location: Doc<"locations">) {
      if (placed.has(location._id)) return placed.get(location._id)!;
      let result: { lat: number; lng: number; approximate: string | null } | null = null;
      if (location.lat !== undefined && location.lng !== undefined) {
        result = { lat: location.lat, lng: location.lng, approximate: null };
      } else if (location.address.trim()) {
        const found = await geocodePlace(location.address).catch(() => null);
        if (found) {
          result = { lat: found.lat, lng: found.lng, approximate: found.precise ? null : found.matched };
          if (found.precise) {
            await ctx.runMutation(internal.locations.saveCoordinates, {
              id: location._id,
              lat: found.lat,
              lng: found.lng,
            });
          }
        }
      }
      placed.set(location._id, result);
      return result;
    }

    const now = Date.now();
    const out: DayForecast[] = [];
    for (const { day, location } of targets) {
      const summaryOf = (w: NonNullable<Doc<"shootDays">["weather"]>) =>
        `${w.summary}, ${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°C`;
      if (!args.force && dayForecastIsFresh(day, location?._id ?? null, now)) {
        out.push({
          shootDayId: day._id,
          date: day.date,
          weatherSummary: day.weather ? summaryOf(day.weather) : undefined,
          sunrise: day.sun?.sunrise,
          sunset: day.sun?.sunset,
          reason: day.forecastReason,
        });
        continue;
      }

      if (!location) {
        const reason = "No location for this day";
        await ctx.runMutation(internal.shootDays.saveDayForecast, { id: day._id, reason });
        out.push({ shootDayId: day._id, date: day.date, reason });
        continue;
      }
      const point = await place(location);
      if (!point) {
        const reason = location.address.trim()
          ? `Could not place “${location.address.trim()}” on the map`
          : "This location has no address to look up";
        await ctx.runMutation(internal.shootDays.saveDayForecast, {
          id: day._id,
          locationId: location._id,
          reason,
        });
        out.push({ shootDayId: day._id, date: day.date, reason });
        continue;
      }

      const ahead = daysAhead(day.date);
      const forecast =
        ahead <= FORECAST_HORIZON_DAYS
          ? await fetchDailyForecast(point.lat, point.lng, day.date).catch(() => null)
          : null;
      if (forecast) {
        const weather = {
          fetchedAt: Date.now(),
          summary: forecast.summary,
          tempMinC: forecast.tempMinC,
          tempMaxC: forecast.tempMaxC,
          precipitationProbability: forecast.precipitationProbability,
          windMaxKph: forecast.windMaxKph,
        };
        const reason = point.approximate ? `Weather for ${point.approximate}` : undefined;
        await ctx.runMutation(internal.shootDays.saveDayForecast, {
          id: day._id,
          locationId: location._id,
          weather,
          sun: { sunrise: forecast.sunrise, sunset: forecast.sunset },
          reason,
        });
        out.push({
          shootDayId: day._id,
          date: day.date,
          weatherSummary: summaryOf(weather),
          sunrise: forecast.sunrise,
          sunset: forecast.sunset,
          reason,
        });
        continue;
      }

      // Too far ahead, in the past, or the service did not answer: the sun
      // still rises, so work it out in the location's own time.
      const timezone =
        location.timezone ?? (await fetchTimezone(point.lat, point.lng).catch(() => undefined));
      const times = sunTimes(day.date, point.lat, point.lng);
      const sun = times
        ? {
            sunrise: formatInZone(times.sunriseMs, timezone),
            sunset: formatInZone(times.sunsetMs, timezone),
          }
        : undefined;
      const reason =
        ahead > FORECAST_HORIZON_DAYS
          ? "Too far ahead for a forecast"
          : ahead < 0
            ? "No forecast for a past date"
            : "Could not reach the weather service — sun times only";
      await ctx.runMutation(internal.shootDays.saveDayForecast, {
        id: day._id,
        locationId: location._id,
        sun,
        reason,
      });
      out.push({
        shootDayId: day._id,
        date: day.date,
        sunrise: sun?.sunrise,
        sunset: sun?.sunset,
        reason,
      });
    }
    return { days: out };
  },
});
