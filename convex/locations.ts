import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";

const locationFields = {
  name: v.string(),
  address: v.string(),
  w3w: v.optional(v.string()),
  parkingNotes: v.optional(v.string()),
  accessNotes: v.optional(v.string()),
  nearestHospital: v.optional(v.string()),
  notes: v.optional(v.string()),
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
  args: locationFields,
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Location name is required");
    return await ctx.db.insert("locations", { orgId: org._id, ...args, name: args.name.trim() });
  },
});

export const update = mutation({
  args: {
    id: v.id("locations"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    w3w: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    nearestHospital: v.optional(v.string()),
    notes: v.optional(v.string()),
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
    // Address changed: stale coordinates must not survive
    if (patch.address !== undefined && patch.address !== location.address) {
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
    return await ctx.db.get(args.id);
  },
});

export const saveCoordinates = internalMutation({
  args: { id: v.id("locations"), lat: v.number(), lng: v.number() },
  handler: async (ctx, args) => {
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
