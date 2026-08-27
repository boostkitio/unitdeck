import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { quoteCategoryValidator, quoteUnitValidator } from "./schema";
import { RATE_CARD_SEED } from "./lib/rateCardSeed";
import { inCardOrder } from "./lib/rateCardOrder";
import { rateFromCost, type Margins } from "./lib/quoteMath";

/**
 * The rate card.
 *
 * One cost per thing, and the client rate worked out from it. Everything that
 * can be quoted lives here, so building a quote is picking rather than typing.
 */

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const shown = args.includeArchived ? rows : rows.filter((r) => !r.archived);
    // The sheet's own order: section by section, and within a section the
    // order the card is written in. Not insertion order — a line added to the
    // card years after the rest still belongs where the sheet puts it.
    return inCardOrder(shown);
  },
});

/** What a line would be charged at, for previewing the card at given margins. */
export const previewRate = query({
  args: {
    costPence: v.number(),
    contingencyBp: v.number(),
    profitBp: v.number(),
    insuranceBp: v.number(),
    roundToPence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrg(ctx);
    const margins: Margins = {
      contingencyBp: args.contingencyBp,
      profitBp: args.profitBp,
      insuranceBp: args.insuranceBp,
    };
    return rateFromCost(args.costPence, margins, args.roundToPence ?? 500);
  },
});

export const add = mutation({
  args: {
    category: quoteCategoryValidator,
    section: v.string(),
    name: v.string(),
    notes: v.optional(v.string()),
    unit: quoteUnitValidator,
    costPence: v.number(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Name the line");
    if (!Number.isFinite(args.costPence) || args.costPence < 0) {
      throw new Error("Cost must be zero or more");
    }
    // Onto the end of the card, so a new line lands where it was added.
    const existing = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const sortOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0) + 1;

    return await ctx.db.insert("rateCardItems", {
      orgId: org._id,
      category: args.category,
      section: args.section.trim(),
      name: args.name.trim(),
      notes: args.notes?.trim() || undefined,
      unit: args.unit,
      costPence: Math.round(args.costPence),
      sortOrder,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("rateCardItems"),
    category: v.optional(quoteCategoryValidator),
    section: v.optional(v.string()),
    name: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    unit: v.optional(quoteUnitValidator),
    costPence: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Rate card line not found");
    if (args.costPence !== undefined && (!Number.isFinite(args.costPence) || args.costPence < 0)) {
      throw new Error("Cost must be zero or more");
    }
    if (args.name !== undefined && args.name.trim().length === 0) {
      throw new Error("Name the line");
    }

    const patch: Record<string, unknown> = {};
    if (args.category !== undefined) patch.category = args.category;
    if (args.section !== undefined) patch.section = args.section.trim();
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    if (args.unit !== undefined) patch.unit = args.unit;
    if (args.costPence !== undefined) patch.costPence = Math.round(args.costPence);
    if (args.archived !== undefined) patch.archived = args.archived || undefined;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("rateCardItems") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Rate card line not found");
    // Quote lines carry their own cost and rate, so deleting a card line never
    // reaches a quote that used it.
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * Fills a rate card from the one the spreadsheet carried.
 *
 * Safe to run on a card that already has lines: it adds what is missing and
 * touches nothing else, matched by name within its section. So a cost
 * somebody has edited stays edited, and a card that predates a new section
 * gains that section rather than a second copy of everything.
 */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const held = new Set(existing.map((row) => key(row.section, row.name)));
    let sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder ?? 0), 0);

    let added = 0;
    for (const item of RATE_CARD_SEED) {
      if (held.has(key(item.section, item.name))) continue;
      sortOrder += 1;
      added += 1;
      await ctx.db.insert("rateCardItems", {
        orgId: org._id,
        category: item.category,
        section: item.section,
        name: item.name,
        notes: item.notes,
        unit: item.unit,
        costPence: item.costPence,
        sortOrder,
      });
    }
    return { added };
  },
});

/**
 * Throws the card away and writes the standard one out again.
 *
 * The blunt instrument, and sometimes the right one: a card that has been
 * seeded, topped up and renamed across several goes ends up carrying rows
 * from every version of itself, and no amount of matching by name sorts that
 * out — the rows that do not belong are exactly the ones whose names no
 * longer match anything. This makes the card the standard card, exactly, and
 * loses any cost that had been edited by hand.
 *
 * Quotes are untouched. A quote's lines are copies with their own costs and
 * rates, which is what lets a quote sent last year still say what it said.
 */
export const rebuild = mutation({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    let sortOrder = 0;
    for (const item of RATE_CARD_SEED) {
      sortOrder += 1;
      await ctx.db.insert("rateCardItems", {
        orgId: org._id,
        category: item.category,
        section: item.section,
        name: item.name,
        notes: item.notes,
        unit: item.unit,
        costPence: item.costPence,
        sortOrder,
      });
    }
    return { removed: existing.length, added: RATE_CARD_SEED.length };
  },
});

/** Case- and space-insensitive, because a card is typed by people. */
function key(section: string, name: string): string {
  return `${section.trim().toLowerCase()}::${name.replace(/\s+/g, " ").trim().toLowerCase()}`;
}
