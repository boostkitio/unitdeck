import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { clerkOrgIdFromIdentity, requireIdentity, requireOrg } from "./lib/auth";
import { invoicingValidator } from "./lib/callSheetData";
import { releaseWordingValidator } from "./lib/documentData";

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

export const updateSettings = mutation({
  args: {
    brandColor: v.optional(v.string()),
    invoicing: v.optional(invoicingValidator),
    confidentialByDefault: v.optional(v.boolean()),
    releaseWording: v.optional(releaseWordingValidator),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    await ctx.db.patch(org._id, { settings: { ...org.settings, ...args } });
    return null;
  },
});

export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    await ctx.db.patch(org._id, {
      settings: { ...org.settings, logoStorageId: args.storageId },
    });
    return null;
  },
});

export const settingsView = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const logoUrl = org.settings?.logoStorageId
      ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
      : undefined;
    return {
      name: org.name,
      brandColor: org.settings?.brandColor,
      invoicing: org.settings?.invoicing,
      confidentialByDefault: org.settings?.confidentialByDefault,
      releaseWording: org.settings?.releaseWording,
      logoUrl,
    };
  },
});

export const callSheetDefaults = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const logoUrl = org.settings?.logoStorageId
      ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
      : undefined;
    const branding =
      org.settings?.brandColor || logoUrl
        ? { brandColor: org.settings?.brandColor, logoUrl }
        : undefined;
    return {
      branding,
      invoicing: org.settings?.invoicing,
      confidential: org.settings?.confidentialByDefault,
    };
  },
});
