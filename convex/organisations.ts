import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { clerkOrgIdFromIdentity, requireIdentity } from "./lib/auth";

/**
 * Idempotently creates the organisation row for the caller's active Clerk org.
 * Called from the client whenever the active organisation changes.
 */
export const ensure = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const clerkOrgId = clerkOrgIdFromIdentity(identity as unknown as Record<string, unknown>);
    if (!clerkOrgId) throw new Error("No active organisation");

    const existing = await ctx.db
      .query("organisations")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
      .unique();
    if (existing) {
      if (existing.name !== args.name) {
        await ctx.db.patch(existing._id, { name: args.name });
      }
      return existing._id;
    }
    return await ctx.db.insert("organisations", {
      name: args.name,
      clerkOrgId,
    });
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const clerkOrgId = clerkOrgIdFromIdentity(identity as unknown as Record<string, unknown>);
    if (!clerkOrgId) return null;
    return await ctx.db
      .query("organisations")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
      .unique();
  },
});
