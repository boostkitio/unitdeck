import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

const statusValidator = v.union(v.literal("needed"), v.literal("confirmed"));

/** Kit needed for a project, oldest first so the list reads in entry order. */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];
    return await ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
  },
});

export const add = mutation({
  args: {
    projectId: v.id("projects"),
    item: v.string(),
    quantity: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (args.item.trim().length === 0) throw new Error("Name the equipment");
    if (args.quantity !== undefined && (!Number.isFinite(args.quantity) || args.quantity < 1)) {
      throw new Error("Quantity must be at least 1");
    }

    return await ctx.db.insert("projectEquipment", {
      orgId: org._id,
      projectId: args.projectId,
      item: args.item.trim(),
      quantity: args.quantity,
      notes: args.notes?.trim() || undefined,
      status: "needed",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projectEquipment"),
    item: v.optional(v.string()),
    quantity: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Equipment not found");

    const patch: Record<string, unknown> = {};
    if (args.item !== undefined) {
      if (args.item.trim().length === 0) throw new Error("Name the equipment");
      patch.item = args.item.trim();
    }
    if (args.quantity !== undefined) {
      if (args.quantity !== null && (!Number.isFinite(args.quantity) || args.quantity < 1)) {
        throw new Error("Quantity must be at least 1");
      }
      patch.quantity = args.quantity ?? undefined;
    }
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projectEquipment") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Equipment not found");
    await ctx.db.delete(args.id);
    return null;
  },
});
