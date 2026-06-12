import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    return clients.filter((c) => !c.archived);
  },
});

export const create = mutation({
  args: { name: v.string(), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Client name is required");
    return await ctx.db.insert("clients", {
      orgId: org._id,
      name: args.name.trim(),
      notes: args.notes,
    });
  },
});

export const update = mutation({
  args: { id: v.id("clients"), name: v.optional(v.string()), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== org._id) throw new Error("Client not found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Client name is required");
      patch.name = args.name.trim();
    }
    if (args.notes !== undefined) patch.notes = args.notes;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== org._id) throw new Error("Client not found");
    await ctx.db.patch(args.id, { archived: true });
    return null;
  },
});
