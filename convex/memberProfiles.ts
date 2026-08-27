import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

/**
 * Names for the people on this account.
 *
 * Written and read here rather than in Clerk because Clerk only accepts a
 * first and last name when Name is enabled for the instance, which is a
 * dashboard setting the app cannot reach. See the schema comment on
 * `memberProfiles`.
 */

/** Everyone on this account who has set a name, so a user id can be resolved
 *  to a person wherever one is shown. */
export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("memberProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    return rows.map((row) => ({
      userId: row.userId,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
    }));
  },
});

/** The caller's own name, or null if they have not set one here. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const { identity, org } = await requireOrg(ctx);
    const row = await ctx.db
      .query("memberProfiles")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", org._id).eq("userId", identity.subject)
      )
      .unique();
    if (!row) return null;
    return {
      userId: row.userId,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
    };
  },
});

/**
 * Sets the caller's own name.
 *
 * Only ever the caller's: the user id comes from the token, never from an
 * argument, so nobody can rename a colleague. Blank clears the field rather
 * than storing an empty string, so "not said" stays distinguishable and the
 * fallback to a Clerk name still works.
 */
export const setName = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
  },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const firstName = args.firstName.trim() || undefined;
    const lastName = args.lastName.trim() || undefined;

    const existing = await ctx.db
      .query("memberProfiles")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", org._id).eq("userId", identity.subject)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { firstName, lastName });
      return existing._id;
    }
    return await ctx.db.insert("memberProfiles", {
      orgId: org._id,
      userId: identity.subject,
      firstName,
      lastName,
    });
  },
});
