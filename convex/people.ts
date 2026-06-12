import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const people = await ctx.db
      .query("people")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    return people.filter((p) => !p.archived);
  },
});

export const get = query({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const person = await ctx.db.get(args.id);
    if (!person || person.orgId !== org._id) return null;
    return person;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    dayRate: v.optional(v.number()),
    dietary: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Name is required");
    if (args.role.trim().length === 0) throw new Error("Role is required");
    return await ctx.db.insert("people", {
      orgId: org._id,
      name: args.name.trim(),
      role: args.role.trim(),
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      dayRate: args.dayRate,
      dietary: args.dietary,
      notes: args.notes,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("people"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    dayRate: v.optional(v.union(v.number(), v.null())),
    dietary: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const person = await ctx.db.get(args.id);
    if (!person || person.orgId !== org._id) throw new Error("Person not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Name is required");
      patch.name = args.name.trim();
    }
    if (args.role !== undefined) {
      if (args.role.trim().length === 0) throw new Error("Role is required");
      patch.role = args.role.trim();
    }
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.dayRate !== undefined) patch.dayRate = args.dayRate ?? undefined;
    if (args.dietary !== undefined) patch.dietary = args.dietary;
    if (args.notes !== undefined) patch.notes = args.notes;

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const person = await ctx.db.get(args.id);
    if (!person || person.orgId !== org._id) throw new Error("Person not found");
    // Soft delete: people may be referenced by future call sheets
    await ctx.db.patch(args.id, { archived: true });
    return null;
  },
});
