import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { chatJson } from "./lib/llm";
import { AI_MODEL_FAST } from "./lib/ai";

const locationFields = {
  name: v.string(),
  address: v.string(),
  w3w: v.optional(v.string()),
  parkingNotes: v.optional(v.string()),
  accessNotes: v.optional(v.string()),
  nearestHospital: v.optional(v.string()),
  notes: v.optional(v.string()),
  satNav: v.optional(v.string()),
  nearestStation: v.optional(v.string()),
  publicTransport: v.optional(v.string()),
  nearestPoliceStation: v.optional(v.string()),
};

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(200);
    return args.includeArchived ? locations : locations.filter((l) => !l.archived);
  },
});

export const get = query({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) return null;
    return location;
  },
});

export const create = mutation({
  args: {
    ...locationFields,
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Location name is required");
    return await ctx.db.insert("locations", { orgId: org._id, ...args, name: args.name.trim() });
  },
});

export const update = mutation({
  args: {
    id: v.id("locations"),
    nearestStation: v.optional(v.string()),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    w3w: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    nearestHospital: v.optional(v.string()),
    notes: v.optional(v.string()),
    satNav: v.optional(v.string()),
    publicTransport: v.optional(v.string()),
    nearestPoliceStation: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");
    const { id, ...patch } = args;
    if (patch.name !== undefined && patch.name.trim().length === 0) {
      throw new Error("Location name is required");
    }
    await ctx.db.patch(id, patch);
    // Address changed and caller didn't supply new coordinates: stale coords must not survive
    const addressChanged =
      patch.address !== undefined && patch.address !== location.address;
    const coordsProvided = patch.lat !== undefined || patch.lng !== undefined;
    if (addressChanged && !coordsProvided) {
      await ctx.db.patch(id, { lat: undefined, lng: undefined });
    }
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");
    await ctx.db.patch(args.id, { archived: true });
    return null;
  },
});

export const getForGeocode = internalQuery({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    // Auth propagates from the calling action, so the tenancy rule applies
    // here too: never hand back another org's location.
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) return null;
    return location;
  },
});

export const saveCoordinates = internalMutation({
  args: { id: v.id("locations"), lat: v.number(), lng: v.number() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");
    await ctx.db.patch(args.id, { lat: args.lat, lng: args.lng });
    return null;
  },
});

/**
 * Resolve lat/lng for a location's address via Nominatim (OpenStreetMap).
 * Only ever patches coordinates (lowest-stakes field); requires a signed-in
 * user. Called from the UI after a location is saved.
 */
export const geocode = action({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const location = await ctx.runQuery(internal.locations.getForGeocode, { id: args.id });
    if (!location) throw new Error("Location not found");
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location.address)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Unit production OS (matt@boostkit.io)" },
    });
    if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
    const results = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (results.length === 0) return { found: false as const };
    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    await ctx.runMutation(internal.locations.saveCoordinates, { id: args.id, lat, lng });
    return { found: true as const, lat, lng };
  },
});

export const saveEnrichment = internalMutation({
  args: {
    id: v.id("locations"),
    nearestHospital: v.optional(v.string()),
    nearestPoliceStation: v.optional(v.string()),
    nearestStation: v.optional(v.string()),
    publicTransport: v.optional(v.string()),
    w3w: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");

    // Never overwrite something a human typed: only fill what is blank.
    const patch: Record<string, unknown> = {};
    const fill = (
      key:
        | "nearestHospital"
        | "nearestPoliceStation"
        | "nearestStation"
        | "publicTransport"
        | "w3w"
    ) => {
      const value = args[key];
      if (value && !location[key]?.trim()) patch[key] = value;
    };
    fill("nearestHospital");
    fill("nearestPoliceStation");
    fill("nearestStation");
    fill("publicTransport");
    fill("w3w");
    if (args.lat !== undefined && args.lng !== undefined && location.lat === undefined) {
      patch.lat = args.lat;
      patch.lng = args.lng;
    }

    if (Object.keys(patch).length > 0) await ctx.db.patch(args.id, patch);
    return null;
  },
});

/** Nominatim lookup for an address. Null when nothing matches. */
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Unit production OS (matt@boostkit.io)" },
  });
  if (!res.ok) return null;
  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (results.length === 0) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

/**
 * The real what3words address for a set of coordinates.
 *
 * This deliberately calls what3words rather than asking the model: a w3w
 * address is an arbitrary grid reference, so a generated one would look
 * plausible and point somewhere else entirely — worse than blank for an
 * address someone drives to. Returns null when W3W_API_KEY is unset, leaving
 * the field empty rather than wrong.
 */
async function whatThreeWords(lat: number, lng: number): Promise<string | null> {
  const key = process.env.W3W_API_KEY;
  if (!key) return null;
  const url = `https://api.what3words.com/v3/convert-to-3wa?coordinates=${lat},${lng}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { words?: unknown };
  return typeof body.words === "string" && body.words.trim() !== "" ? body.words.trim() : null;
}

/**
 * Fills in everything derivable from a location's address: coordinates, the
 * nearest A&E and police station, public transport, and the what3words
 * address. Runs automatically when a location is saved.
 *
 * Only blank fields are written, so anything typed by hand survives.
 */
export const enrichLocation = action({
  args: { id: v.id("locations") },
  handler: async (
    ctx,
    args
  ): Promise<{
    nearestHospital?: string;
    nearestPoliceStation?: string;
    nearestStation?: string;
    publicTransport?: string;
    w3w?: string;
    w3wUnavailable?: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const location = await ctx.runQuery(internal.locations.getForGeocode, { id: args.id });
    if (!location) throw new Error("Location not found");
    if (location.address.trim().length === 0) return {};

    // Coordinates first: what3words is derived from them.
    let coords =
      location.lat !== undefined && location.lng !== undefined
        ? { lat: location.lat, lng: location.lng }
        : null;
    if (!coords) coords = await geocodeAddress(location.address).catch(() => null);

    const system = `You are a UK location assistant for a film and TV production management tool.
Given a UK address, name the nearest NHS A&E or major hospital, the nearest police station, the nearest rail or Underground station, and how a crew member would travel in.

Reply with ONLY a JSON object in exactly this shape, no prose, no code fences:
{
  "nearestHospital": "Name of nearest A&E or hospital, or null",
  "nearestPoliceStation": "Name of nearest police station, or null",
  "nearestStation": "Nearest rail/Underground/tram station with line and walking time, or null",
  "publicTransport": "One or two sentences on getting there, or null"
}

Rules:
- Give commonly used names, e.g. "Wexham Park Hospital", "Slough Police Station".
- "nearestStation" MUST name a specific station, and where it applies the line and
  approximate walking time, e.g. "White City (Central line), 6 min walk" or
  "Slough rail station, 12 min walk". Never answer with a generic phrase like
  "good transport links" or "various stations nearby" — return null instead.
- In London prefer the nearest Underground, Overground or DLR station; elsewhere
  prefer the nearest National Rail station.
- "publicTransport" adds what the station line does not cover: useful bus routes,
  a second station worth knowing, or the last train back.
- Use null when you are not confident. Never invent a name.`;

    const raw = await chatJson({
      system,
      user: `${location.name}\n${location.address}`,
      model: AI_MODEL_FAST,
    }).catch(() => ({}) as unknown);

    const obj = raw as Record<string, unknown>;
    const text = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "null"
        ? value.trim()
        : undefined;

    const nearestHospital = text(obj?.nearestHospital);
    const nearestPoliceStation = text(obj?.nearestPoliceStation);
    const nearestStation = text(obj?.nearestStation);
    const publicTransport = text(obj?.publicTransport);

    const w3w = coords ? await whatThreeWords(coords.lat, coords.lng).catch(() => null) : null;

    await ctx.runMutation(internal.locations.saveEnrichment, {
      id: args.id,
      nearestHospital,
      nearestPoliceStation,
      nearestStation,
      publicTransport,
      w3w: w3w ?? undefined,
      lat: coords?.lat,
      lng: coords?.lng,
    });

    return {
      nearestHospital,
      nearestPoliceStation,
      nearestStation,
      publicTransport,
      w3w: w3w ?? undefined,
      // Lets the UI say why w3w is blank rather than leaving it a mystery.
      w3wUnavailable: !process.env.W3W_API_KEY,
    };
  },
});

/**
 * Shape returned to the frontend for each address suggestion.
 */
export type AddressSuggestion = {
  name: string;
  address: string;
  postcode: string | undefined;
  nearestHospital: string | undefined;
  nearestPoliceStation: string | undefined;
  lat: number | undefined;
  lng: number | undefined;
};

/**
 * AI-powered UK address/venue suggestion. Requires a signed-in user.
 * Returns up to 4 suggestions matching the query.
 */
export const suggestAddress = action({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<{ suggestions: AddressSuggestion[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (args.query.trim().length < 3) return { suggestions: [] };

    const system = `You are a UK location and address assistant for a film and TV production management tool called UnitDeck.
Given a venue name, place name, or partial address, return up to 4 of the best matching real UK postal addresses.

Reply with ONLY a JSON object in exactly this shape, no prose, no code fences:
{
  "suggestions": [
    {
      "name": "Venue or location name",
      "address": "Full single-line or comma-separated UK postal address",
      "postcode": "UK postcode or null",
      "nearestHospital": "Name of nearest A&E or hospital or null",
      "nearestPoliceStation": "Name of nearest police station or null",
      "lat": 51.5074,
      "lng": -0.1278
    }
  ]
}

Rules:
- Only return real UK addresses you are confident about.
- "address" must be a clean comma-separated address (no newlines), e.g. "1 Sample St, Soho, London W1A 1AA".
- "name" is the venue or location name a production would use (e.g. "Pinewood Studios", "Twickenham Studios").
- "nearestHospital" is the name of the nearest NHS A&E or major hospital (e.g. "Wexham Park Hospital"). Null if unknown.
- "nearestPoliceStation" is the name of the nearest police station (e.g. "Slough Police Station"). Null if unknown.
- "lat" and "lng" are your best-estimate decimal coordinates. Null if genuinely unsure.
- "postcode" is the full UK postcode (e.g. "SL0 0NH"). Null if unavailable.
- Return fewer than 4 results if you are unsure of the others. Never invent addresses.`;

    const raw = await chatJson({ system, user: args.query, model: AI_MODEL_FAST });

    // Defensively shape the unknown result
    const obj = raw as Record<string, unknown>;
    const rawSuggestions = Array.isArray(obj?.suggestions) ? obj.suggestions : [];

    const suggestions: AddressSuggestion[] = rawSuggestions
      .slice(0, 4)
      .map((s) => {
        const item = s as Record<string, unknown>;
        const address = typeof item?.address === "string" ? item.address.trim() : "";
        if (!address) return null;
        return {
          name: typeof item?.name === "string" && item.name.trim() !== "" ? item.name.trim() : address,
          address,
          postcode:
            typeof item?.postcode === "string" && item.postcode.trim() !== ""
              ? item.postcode.trim()
              : undefined,
          nearestHospital:
            typeof item?.nearestHospital === "string" && item.nearestHospital.trim() !== ""
              ? item.nearestHospital.trim()
              : undefined,
          nearestPoliceStation:
            typeof item?.nearestPoliceStation === "string" &&
            item.nearestPoliceStation.trim() !== ""
              ? item.nearestPoliceStation.trim()
              : undefined,
          lat: typeof item?.lat === "number" && isFinite(item.lat) ? item.lat : undefined,
          lng: typeof item?.lng === "number" && isFinite(item.lng) ? item.lng : undefined,
        } satisfies AddressSuggestion;
      })
      .filter((s): s is AddressSuggestion => s !== null);

    return { suggestions };
  },
});
