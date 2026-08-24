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
  args: {
    name: v.string(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Company is required");
    return await ctx.db.insert("clients", {
      orgId: org._id,
      name: args.name.trim(),
      contactName: args.contactName?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      notes: args.notes,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("clients"),
    name: v.optional(v.string()),
    contactName: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== org._id) throw new Error("Client not found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Company is required");
      patch.name = args.name.trim();
    }
    if (args.contactName !== undefined) patch.contactName = args.contactName?.trim() || undefined;
    if (args.phone !== undefined) patch.phone = args.phone?.trim() || undefined;
    if (args.email !== undefined) patch.email = args.email?.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

// One transaction's worth. The client sends larger files in successive batches.
const MAX_IMPORT_ROWS = 200;

/**
 * Bulk insert from a parsed CSV. Rows without a company are skipped rather
 * than failing the batch, so one bad line cannot cost the whole import; the
 * caller is told how many were skipped.
 *
 * Matching an existing client by company name updates it instead of inserting
 * a duplicate, which makes re-importing a corrected file safe.
 */
export const importRows = mutation({
  args: {
    rows: v.array(
      v.object({
        name: v.string(),
        contactName: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ created: number; updated: number; skipped: number }> => {
    const { org } = await requireOrg(ctx);
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    }

    const existing = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(1000);
    const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of args.rows) {
      const name = row.name.trim();
      if (name.length === 0) {
        skipped++;
        continue;
      }
      const fields = {
        contactName: row.contactName?.trim() || undefined,
        phone: row.phone?.trim() || undefined,
        email: row.email?.trim() || undefined,
        notes: row.notes?.trim() || undefined,
      };
      const match = byName.get(name.toLowerCase());
      if (match) {
        await ctx.db.patch(match._id, fields);
        updated++;
      } else {
        const id = await ctx.db.insert("clients", { orgId: org._id, name, ...fields });
        // Keep the map current so duplicate rows in one file collapse too.
        byName.set(name.toLowerCase(), (await ctx.db.get(id))!);
        created++;
      }
    }

    return { created, updated, skipped };
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
