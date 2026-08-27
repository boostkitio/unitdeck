import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

async function ownedProject(ctx: QueryCtx | MutationCtx, id: Id<"projects">) {
  const { org } = await requireOrg(ctx);
  const project = await ctx.db.get(id);
  if (!project || project.orgId !== org._id) throw new Error("Project not found");
  return { org, project };
}

/** Where the unit is sleeping on this production, in the order it was booked. */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<Doc<"accommodation">[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];
    const rows = await ctx.db
      .query("accommodation")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    return rows.filter((row) => row.orgId === org._id);
  },
});

/** The fields an entry is made of, all optional but the hotel itself. */
const details = {
  address: v.optional(v.string()),
  phone: v.optional(v.string()),
  checkIn: v.optional(v.string()),
  nights: v.optional(v.number()),
  bookingRef: v.optional(v.string()),
  notes: v.optional(v.string()),
};

export const add = mutation({
  args: { projectId: v.id("projects"), name: v.string(), ...details },
  handler: async (ctx, args) => {
    const { org } = await ownedProject(ctx, args.projectId);
    const name = args.name.trim();
    if (name.length === 0) throw new Error("Say which hotel");
    if (args.nights !== undefined && args.nights < 0) throw new Error("Nights cannot be negative");
    return await ctx.db.insert("accommodation", {
      orgId: org._id,
      projectId: args.projectId,
      name,
      address: args.address?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      checkIn: args.checkIn?.trim() || undefined,
      nights: args.nights,
      bookingRef: args.bookingRef?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: { id: v.id("accommodation"), name: v.optional(v.string()), ...details },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Not found");
    if (args.nights !== undefined && args.nights < 0) throw new Error("Nights cannot be negative");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new Error("Say which hotel");
      patch.name = name;
    }
    // A field cleared in the form is stored as absent rather than as an empty
    // string, so nothing prints a blank line where a phone number would be.
    for (const key of ["address", "phone", "checkIn", "bookingRef", "notes"] as const) {
      const value = args[key];
      if (value !== undefined) patch[key] = value.trim() || undefined;
    }
    if (args.nights !== undefined) patch.nights = args.nights;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("accommodation") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
    return null;
  },
});
