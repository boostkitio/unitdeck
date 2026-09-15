import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { chatJson } from "./lib/llm";
import { AI_MODEL_FAST } from "./lib/ai";
import { geocodeAddress } from "./lib/geocode";
import { plusCodeFor } from "./lib/plusCode";
import { findNearby, type Nearby } from "./lib/nearby";
import { syncLocationOntoDrafts } from "./lib/sheetLocations";

const locationFields = {
  name: v.string(),
  address: v.string(),
  projectOnly: v.optional(v.boolean()),
  plusCode: v.optional(v.string()),
  parkingNotes: v.optional(v.string()),
  accessNotes: v.optional(v.string()),
  nearestHospital: v.optional(v.string()),
  notes: v.optional(v.string()),
  satNav: v.optional(v.string()),
  nearestStation: v.optional(v.string()),
  nearestTube: v.optional(v.string()),
  nearestRail: v.optional(v.string()),
  // Superseded by nearestStation, which said the same thing twice. Still
  // accepted so existing rows and any older client keep working.
  publicTransport: v.optional(v.string()),
  nearestPoliceStation: v.optional(v.string()),
};

export const list = query({
  // `archivedOnly` switches the list over to what has been archived, the same
  // way the projects list does, rather than mixing the two together —
  // archived work is looked at on its own or not at all.
  args: {
    includeArchived: v.optional(v.boolean()),
    archivedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(200);
    // A project-only address belongs to its production, not to the database
    // everyone picks from, so it never appears in this list.
    const shared = locations.filter((l) => !l.projectOnly);
    if (args.archivedOnly) return shared.filter((l) => l.archived === true);
    return args.includeArchived ? shared : shared.filter((l) => !l.archived);
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
    return await ctx.db.insert("locations", {
      orgId: org._id,
      ...args,
      name: args.name.trim(),
      nearestTube: args.nearestTube?.trim() || undefined,
      nearestRail: args.nearestRail?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("locations"),
    nearestStation: v.optional(v.string()),
    nearestTube: v.optional(v.string()),
    nearestRail: v.optional(v.string()),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    plusCode: v.optional(v.string()),
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
    const { id, ...rest } = args;
    const patch: Omit<typeof args, "id"> = { ...rest };
    // The stations are corrected by hand when the lookup got them wrong, and
    // clearing one has to clear it rather than leave the wrong answer behind.
    for (const key of ["nearestTube", "nearestRail"] as const) {
      if (patch[key] !== undefined) patch[key] = patch[key]!.trim() || undefined;
    }
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
    // Whatever was corrected here shows on the call sheets being drafted.
    const saved = await ctx.db.get(id);
    if (saved) await syncLocationOntoDrafts(ctx, saved);
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
    const saved = await ctx.db.get(args.id);
    if (saved) await syncLocationOntoDrafts(ctx, saved);
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
    const coords = await geocodeAddress(location.address);
    if (!coords) return { found: false as const };
    await ctx.runMutation(internal.locations.saveCoordinates, {
      id: args.id,
      lat: coords.lat,
      lng: coords.lng,
    });
    return { found: true as const, ...coords };
  },
});

export const saveEnrichment = internalMutation({
  args: {
    id: v.id("locations"),
    nearestHospital: v.optional(v.string()),
    nearestPoliceStation: v.optional(v.string()),
    nearestStation: v.optional(v.string()),
    nearestTube: v.optional(v.string()),
    nearestRail: v.optional(v.string()),
    plusCode: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    // Replace the nearest-things with what was just measured, rather than
    // only filling blanks. Only ever set when somebody asked for it.
    replaceNearest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");

    const patch: Record<string, unknown> = {};
    const nearest = [
      "nearestHospital",
      "nearestPoliceStation",
      "nearestStation",
      "nearestTube",
      "nearestRail",
    ] as const;
    if (args.replaceNearest) {
      // Asked for outright: what the map says now, blanks included, since a
      // station that is not the nearest should not stay on the sheet.
      for (const key of nearest) patch[key] = args[key];
    } else {
      // Never overwrite something a human typed: only fill what is blank.
      for (const key of nearest) {
        const value = args[key];
        if (value && !location[key]?.trim()) patch[key] = value;
      }
    }
    if (args.plusCode && !location.plusCode?.trim()) patch.plusCode = args.plusCode;
    if (args.lat !== undefined && args.lng !== undefined && location.lat === undefined) {
      patch.lat = args.lat;
      patch.lng = args.lng;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
      const saved = await ctx.db.get(args.id);
      if (saved) await syncLocationOntoDrafts(ctx, saved);
    }
    return null;
  },
});

/**
 * Fills in everything derivable from a location's address: coordinates, the
 * nearest A&E, police station, Tube and National Rail station, and the Plus
 * Code. Runs automatically when a location is saved, filling only blanks.
 *
 * `replace` measures again and replaces the nearest-things, for when what is
 * there is wrong. They are measured from the map (see lib/nearby.ts), not
 * guessed from the address.
 */
export const enrichLocation = action({
  args: { id: v.id("locations"), replace: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    nearestHospital?: string;
    nearestPoliceStation?: string;
    nearestStation?: string;
    nearestTube?: string;
    nearestRail?: string;
    plusCode?: string;
    /** Why nothing could be measured, when nothing could. */
    problem?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const location = await ctx.runQuery(internal.locations.getForGeocode, { id: args.id });
    if (!location) throw new Error("Location not found");
    if (location.address.trim().length === 0) {
      return { problem: "This location has no address to look up." };
    }

    // Coordinates first: everything else is measured from them.
    let coords =
      location.lat !== undefined && location.lng !== undefined
        ? { lat: location.lat, lng: location.lng }
        : null;
    if (!coords) coords = await geocodeAddress(location.address).catch(() => null);
    if (!coords) {
      return { problem: `Could not place “${location.address.trim()}” on the map.` };
    }

    let nearby: Nearby;
    try {
      nearby = await findNearby(coords.lat, coords.lng);
    } catch {
      return { problem: "Could not reach the map data just now. Try again in a minute." };
    }
    const nearestStation = nearby.nearestTube ?? nearby.nearestRail;
    // Arithmetic, not a lookup: this cannot fail once there are coordinates.
    const plusCode = plusCodeFor(coords.lat, coords.lng, location.address);

    await ctx.runMutation(internal.locations.saveEnrichment, {
      id: args.id,
      ...nearby,
      nearestStation,
      plusCode,
      lat: coords.lat,
      lng: coords.lng,
      replaceNearest: args.replace,
    });

    return { ...nearby, nearestStation, plusCode };
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

/**
 * Fills in the Plus Code for locations saved before Plus Codes existed.
 *
 * A one-off, run by hand with `npx convex run locations:backfillPlusCodes`.
 * Safe to run more than once: a location that already has a code is skipped,
 * so a hand-typed value is never overwritten. Locations without coordinates
 * are left alone — the next enrichment pass geocodes them and fills the code
 * on the way through.
 */
export const backfillPlusCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const locations = await ctx.db.query("locations").collect();
    let filled = 0;
    for (const location of locations) {
      if (location.plusCode?.trim()) continue;
      if (location.lat === undefined || location.lng === undefined) continue;
      await ctx.db.patch(location._id, {
        plusCode: plusCodeFor(location.lat, location.lng, location.address),
      });
      filled++;
    }
    return { scanned: locations.length, filled };
  },
});
