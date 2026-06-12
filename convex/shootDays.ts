import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
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

const WEATHER_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

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
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lng}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset` +
      `&timezone=auto&start_date=${day.date}&end_date=${day.date}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather lookup failed: ${res.status}`);
    const json = (await res.json()) as {
      daily?: {
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
        wind_speed_10m_max: number[];
        sunrise: string[]; // ISO "2026-06-20T04:43"
        sunset: string[];
      };
    };
    const daily = json.daily;
    if (!daily || daily.weather_code.length === 0) {
      return { ok: false as const, reason: "Shoot day is outside the 16-day forecast range" };
    }
    const sunrise = daily.sunrise[0]?.slice(11, 16) ?? "";
    const sunset = daily.sunset[0]?.slice(11, 16) ?? "";
    const weather = {
      fetchedAt: Date.now(),
      summary: WEATHER_CODES[daily.weather_code[0]] ?? "Unknown",
      tempMinC: daily.temperature_2m_min[0],
      tempMaxC: daily.temperature_2m_max[0],
      precipitationProbability: daily.precipitation_probability_max[0] ?? undefined,
      windMaxKph: daily.wind_speed_10m_max[0],
    };
    await ctx.runMutation(internal.shootDays.saveWeather, {
      id: args.id,
      weather,
      sun: { sunrise, sunset },
    });
    // Returned directly so callers can update documents without re-querying
    return {
      ok: true as const,
      weatherSummary: `${weather.summary}, ${Math.round(weather.tempMinC)}–${Math.round(weather.tempMaxC)}°C`,
      sunrise,
      sunset,
    };
  },
});
