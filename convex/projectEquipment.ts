import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

const statusValidator = v.union(v.literal("needed"), v.literal("confirmed"));
const sectionValidator = v.union(v.literal("equipment"), v.literal("additional"));

export type EquipmentSection = "equipment" | "additional";

/**
 * Rows written before the list was split carry no section. They read as
 * "additional", which is the list they were already appearing in — nothing
 * moves out from under anyone.
 */
function sectionOf(row: { section?: EquipmentSection }): EquipmentSection {
  return row.section ?? "additional";
}

/**
 * Kit for a project, oldest first so each list reads in entry order. The
 * section is filled in here rather than in the UI, so there is one rule for
 * which list a row belongs to.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];
    const rows = await ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    return rows.map((row) => ({ ...row, section: sectionOf(row) }));
  },
});

export const add = mutation({
  args: {
    projectId: v.id("projects"),
    item: v.string(),
    dept: v.optional(v.string()),
    quantity: v.optional(v.number()),
    notes: v.optional(v.string()),
    section: v.optional(sectionValidator),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (args.item.trim().length === 0) throw new Error("Name the equipment");
    if (args.quantity !== undefined && (!Number.isFinite(args.quantity) || args.quantity < 1)) {
      throw new Error("Quantity must be at least 1");
    }

    // Your own kit is a given, so it lands confirmed; anything additional has
    // still to be sourced, so it lands needed.
    const section = args.section ?? "additional";
    return await ctx.db.insert("projectEquipment", {
      orgId: org._id,
      projectId: args.projectId,
      item: args.item.trim(),
      dept: args.dept?.trim() || undefined,
      quantity: args.quantity,
      notes: args.notes?.trim() || undefined,
      status: args.status ?? (section === "equipment" ? "confirmed" : "needed"),
      section,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projectEquipment"),
    item: v.optional(v.string()),
    dept: v.optional(v.union(v.string(), v.null())),
    quantity: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    status: v.optional(statusValidator),
    section: v.optional(sectionValidator),
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
    if (args.dept !== undefined) patch.dept = args.dept?.trim() || undefined;
    if (args.quantity !== undefined) {
      if (args.quantity !== null && (!Number.isFinite(args.quantity) || args.quantity < 1)) {
        throw new Error("Quantity must be at least 1");
      }
      patch.quantity = args.quantity ?? undefined;
    }
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.section !== undefined) patch.section = args.section;

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
