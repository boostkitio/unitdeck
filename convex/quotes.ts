import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { quoteCategoryValidator, quoteUnitValidator } from "./schema";
import {
  categoryTotals,
  costFromRate,
  quoteTotals,
  rateFromCost,
  type CategoryTotals,
  type Margins,
  type QuoteLine,
} from "./lib/quoteMath";
import { Doc, Id } from "./_generated/dataModel";

/**
 * Quotes.
 *
 * A quote belongs to a production, because in this app a job exists as a
 * project from the enquiry onwards — there is nowhere else it would sit, and
 * hanging it off the project is what lets a quote pull in the crew and kit
 * already booked.
 */

export const CATEGORIES = ["pre", "production", "art", "equipment", "travel", "post"] as const;
export type QuoteCategory = (typeof CATEGORIES)[number];

/** What each heading is called on the client's copy. */
export const CATEGORY_LABELS: Record<QuoteCategory, string> = {
  pre: "Pre Production",
  production: "Production",
  art: "Art Department / Location",
  equipment: "Equipment",
  travel: "Travel and Accommodation",
  post: "Post Production",
};

/** House defaults for a new quote: contingency 10%, profit 10%, insurance 0.30%. */
export const DEFAULT_MARGINS = {
  contingencyBp: 1000,
  profitBp: 1000,
  insuranceBp: 30,
  vatBp: 2000,
  roundToPence: 500,
};

function marginsOf(quote: Doc<"quotes">): Margins {
  return {
    contingencyBp: quote.contingencyBp,
    profitBp: quote.profitBp,
    insuranceBp: quote.insuranceBp,
  };
}

function asLine(row: Doc<"quoteLines">): QuoteLine {
  return {
    costPence: row.costPence,
    ratePence: row.ratePence,
    pax: row.pax,
    unitAmount: row.unitAmount,
  };
}

/** Quotes on a production, newest first. */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const out = [];
    for (const quote of quotes) {
      const lines = await ctx.db
        .query("quoteLines")
        .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
        .collect();
      const overrides = await ctx.db
        .query("quoteCategoryOverrides")
        .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
        .collect();
      out.push({
        _id: quote._id,
        _creationTime: quote._creationTime,
        number: quote.number,
        status: quote.status,
        quoteType: quote.quoteType ?? null,
        clientName: quote.clientName ?? null,
        lineCount: lines.length,
        totals: totalsFor(quote, lines, overrides),
      });
    }
    return out.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Every quote on the account, for the Quotes tab. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    const out = [];
    for (const quote of quotes) {
      const [project, lines, overrides] = await Promise.all([
        quote.projectId ? ctx.db.get(quote.projectId) : null,
        ctx.db
          .query("quoteLines")
          .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
          .collect(),
        ctx.db
          .query("quoteCategoryOverrides")
          .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
          .collect(),
      ]);
      out.push({
        _id: quote._id,
        _creationTime: quote._creationTime,
        number: quote.number,
        status: quote.status,
        quoteType: quote.quoteType ?? null,
        clientName: quote.clientName ?? null,
        title: quote.title ?? null,
        projectId: quote.projectId ?? null,
        projectName: project?.name ?? null,
        totals: totalsFor(quote, lines, overrides),
      });
    }
    return out.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Everything needed to render or edit one quote. */
export const get = query({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) return null;

    const [project, lines, overrides, company] = await Promise.all([
      quote.projectId ? ctx.db.get(quote.projectId) : null,
      ctx.db
        .query("quoteLines")
        .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
        .collect(),
      ctx.db
        .query("quoteCategoryOverrides")
        .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
        .collect(),
      ctx.db.get(quote.orgId),
    ]);

    const ordered = lines.sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a._creationTime - b._creationTime
    );

    return {
      quote,
      project: project ? { _id: project._id, name: project.name, jobNumber: project.jobNumber ?? null } : null,
      lines: ordered,
      overrides: overrides.map((o) => ({ category: o.category, totalPence: o.totalPence })),
      totals: totalsFor(quote, lines, overrides),
      byCategory: CATEGORIES.map((category) => ({
        category,
        label: CATEGORY_LABELS[category],
        totals: categoryTotalsFor(quote, lines, overrides, category),
      })),
      company: {
        name: company?.name ?? "",
        invoicing: company?.settings?.invoicing ?? null,
        logoUrl: company?.settings?.logoStorageId
          ? ((await ctx.storage.getUrl(company.settings.logoStorageId)) ?? null)
          : null,
      },
    };
  },
});

function categoryTotalsFor(
  quote: Doc<"quotes">,
  lines: Doc<"quoteLines">[],
  overrides: Doc<"quoteCategoryOverrides">[],
  category: QuoteCategory
): CategoryTotals {
  const override = overrides.find((o) => o.category === category);
  return categoryTotals(
    lines.filter((l) => l.category === category).map(asLine),
    marginsOf(quote),
    { roundToPence: quote.roundToPence, overrideTotal: override?.totalPence }
  );
}

function totalsFor(
  quote: Doc<"quotes">,
  lines: Doc<"quoteLines">[],
  overrides: Doc<"quoteCategoryOverrides">[]
) {
  return quoteTotals(
    CATEGORIES.map((c) => categoryTotalsFor(quote, lines, overrides, c)),
    { discountPence: quote.discountPence ?? 0, vatBp: quote.vatBp }
  );
}

/**
 * Starts a quote.
 *
 * A production is optional, because a quote is often what wins the work: the
 * job does not exist yet, and making somebody invent a project to price
 * against would put a fake production in the list every time a client asked
 * "roughly what would this cost". Attach it to a production later, from the
 * production.
 *
 * Where a production is given, the client and the caveats marked "always
 * include" come across with it, because retyping them is the part of quoting
 * that wastes the most time.
 */
export const create = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    clientId: v.optional(v.id("clients")),
    title: v.optional(v.string()),
    number: v.optional(v.string()),
    quoteType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);

    const project = args.projectId ? await ctx.db.get(args.projectId) : null;
    if (args.projectId && (!project || project.orgId !== org._id)) {
      throw new Error("Project not found");
    }

    // Named on the quote if given, otherwise whoever the production is for.
    const clientId = args.clientId ?? project?.clientId;
    const client = clientId ? await ctx.db.get(clientId) : null;
    if (clientId && (!client || client.orgId !== org._id)) {
      throw new Error("Client not found");
    }

    const houseCaveats = await ctx.db
      .query("caveats")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    const title = args.title?.trim() || undefined;
    const number =
      args.number?.trim() ||
      (await nextNumber(ctx, org._id, client?.name ?? project?.name ?? title ?? null));

    return await ctx.db.insert("quotes", {
      orgId: org._id,
      projectId: args.projectId,
      title,
      number,
      status: "draft",
      quoteType: args.quoteType ?? "Ballpark",
      clientId,
      clientName: client?.name,
      producerName: typeof identity.name === "string" ? identity.name : undefined,
      producerEmail: typeof identity.email === "string" ? identity.email : undefined,
      caveats: houseCaveats
        .filter((c) => c.alwaysInclude && !c.archived)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((c) => c.text),
      ...DEFAULT_MARGINS,
      discountPence: 0,
    });
  },
});

/**
 * The house reference, in the shape the spreadsheet used: two-digit year, the
 * first three letters of whoever it is for, then QV and a version.
 */
async function nextNumber(
  ctx: MutationCtx,
  orgId: Id<"organisations">,
  named: string | null
): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2);
  const stem = (named ?? "").replace(/[^A-Za-z]/g, "").slice(0, 3);
  const initials = stem ? stem[0].toUpperCase() + stem.slice(1).toLowerCase() : "Job";
  const prefix = `${year}_${initials}_QV`;

  const existing = await ctx.db
    .query("quotes")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const taken = existing
    .map((q) => q.number)
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = taken.length === 0 ? 1 : Math.max(...taken) + 1;
  return `${prefix}${next}`;
}

/** Quotes not yet on any production, for picking one from a production. */
export const listUnattached = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    const out = [];
    for (const quote of quotes.filter((q) => q.projectId === undefined)) {
      const [lines, overrides] = await Promise.all([
        ctx.db
          .query("quoteLines")
          .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
          .collect(),
        ctx.db
          .query("quoteCategoryOverrides")
          .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
          .collect(),
      ]);
      out.push({
        _id: quote._id,
        _creationTime: quote._creationTime,
        number: quote.number,
        title: quote.title ?? null,
        status: quote.status,
        clientName: quote.clientName ?? null,
        totals: totalsFor(quote, lines, overrides),
      });
    }
    return out.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * Puts a quote on a production, or takes it off again with `projectId: null`.
 *
 * A quote that has no client of its own takes the production's, since that is
 * plainly who it is for. One that already names a client keeps it: the quote
 * is the document, and it should not change under whoever it was sent to.
 */
export const setProject = mutation({
  args: {
    id: v.id("quotes"),
    projectId: v.union(v.id("projects"), v.null()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");

    if (args.projectId === null) {
      await ctx.db.patch(args.id, { projectId: undefined });
      return null;
    }

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    const patch: Record<string, unknown> = { projectId: args.projectId };
    if (quote.clientId === undefined && project.clientId !== undefined) {
      const client = await ctx.db.get(project.clientId);
      if (client && client.orgId === org._id) {
        patch.clientId = client._id;
        patch.clientName = client.name;
      }
    }
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("quotes"),
    number: v.optional(v.string()),
    title: v.optional(v.union(v.string(), v.null())),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("sent"), v.literal("accepted"), v.literal("declined"))
    ),
    quoteType: v.optional(v.string()),
    clientId: v.optional(v.union(v.id("clients"), v.null())),
    clientContact: v.optional(v.union(v.string(), v.null())),
    producerName: v.optional(v.union(v.string(), v.null())),
    producerEmail: v.optional(v.union(v.string(), v.null())),
    producerPhone: v.optional(v.union(v.string(), v.null())),
    deliverables: v.optional(v.union(v.string(), v.null())),
    caveats: v.optional(v.array(v.string())),
    contingencyBp: v.optional(v.number()),
    profitBp: v.optional(v.number()),
    insuranceBp: v.optional(v.number()),
    vatBp: v.optional(v.number()),
    roundToPence: v.optional(v.number()),
    discountPence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");

    const patch: Record<string, unknown> = {};
    if (args.number !== undefined) {
      if (args.number.trim().length === 0) throw new Error("A quote needs a number");
      patch.number = args.number.trim();
    }
    if (args.status !== undefined) {
      patch.status = args.status;
      if (args.status === "sent" && quote.issuedAt === undefined) patch.issuedAt = Date.now();
      if (args.status === "accepted") patch.acceptedAt = Date.now();
      if (args.status === "declined") patch.declinedAt = Date.now();
    }
    if (args.quoteType !== undefined) patch.quoteType = args.quoteType;
    if (args.clientId !== undefined) {
      patch.clientId = args.clientId ?? undefined;
      if (args.clientId) {
        const client = await ctx.db.get(args.clientId);
        if (!client || client.orgId !== org._id) throw new Error("Client not found");
        patch.clientName = client.name;
      } else {
        patch.clientName = undefined;
      }
    }
    for (const key of ["title", "clientContact", "producerName", "producerEmail", "producerPhone", "deliverables"] as const) {
      const value = args[key];
      if (value !== undefined) patch[key] = value?.trim() || undefined;
    }
    if (args.caveats !== undefined) patch.caveats = args.caveats;
    for (const key of ["contingencyBp", "profitBp", "insuranceBp", "vatBp", "roundToPence", "discountPence"] as const) {
      const value = args[key];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0) throw new Error("That has to be zero or more");
      patch[key] = Math.round(value);
    }

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");
    for (const line of await ctx.db.query("quoteLines").withIndex("by_quote", (q) => q.eq("quoteId", args.id)).collect()) {
      await ctx.db.delete(line._id);
    }
    for (const o of await ctx.db.query("quoteCategoryOverrides").withIndex("by_quote", (q) => q.eq("quoteId", args.id)).collect()) {
      await ctx.db.delete(o._id);
    }
    await ctx.db.delete(args.id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

async function loadQuote(ctx: MutationCtx, quoteId: Id<"quotes">) {
  const { org } = await requireOrg(ctx);
  const quote = await ctx.db.get(quoteId);
  if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");
  return { org, quote };
}

/** Onto the end of the quote, so a line lands where it was added. */
async function nextSortOrder(ctx: MutationCtx, quoteId: Id<"quotes">) {
  const lines = await ctx.db
    .query("quoteLines")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .collect();
  return lines.reduce((max, l) => Math.max(max, l.sortOrder ?? 0), 0) + 1;
}

/**
 * Adds a line.
 *
 * The rate is worked out from the cost and the quote's margins unless one is
 * given, and either way it is written down. From here on the line carries its
 * own rate: the rate card can change without touching a quote that has gone
 * out, which is the whole reason the figures are snapshotted.
 */
export const addLine = mutation({
  args: {
    quoteId: v.id("quotes"),
    category: quoteCategoryValidator,
    section: v.optional(v.string()),
    name: v.string(),
    notes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    unit: quoteUnitValidator,
    pax: v.optional(v.number()),
    unitAmount: v.optional(v.number()),
    costPence: v.number(),
    /** Given for a pass-through, where the client pays what it costs. */
    ratePence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org, quote } = await loadQuote(ctx, args.quoteId);
    if (args.name.trim().length === 0) throw new Error("Name the line");
    if (!Number.isFinite(args.costPence) || args.costPence < 0) {
      throw new Error("Cost must be zero or more");
    }
    const pax = args.pax ?? 1;
    const unitAmount = args.unitAmount ?? 1;
    if (pax < 0 || unitAmount < 0) throw new Error("That has to be zero or more");

    const ratePence =
      args.ratePence ?? rateFromCost(args.costPence, marginsOf(quote), quote.roundToPence);

    return await ctx.db.insert("quoteLines", {
      orgId: org._id,
      quoteId: args.quoteId,
      category: args.category,
      section: args.section?.trim() || undefined,
      name: args.name.trim(),
      notes: args.notes?.trim() || undefined,
      clientNotes: args.clientNotes?.trim() || undefined,
      unit: args.unit,
      pax,
      unitAmount,
      costPence: Math.round(args.costPence),
      ratePence: Math.round(ratePence),
      rateOverridden: args.ratePence !== undefined ? true : undefined,
      sortOrder: await nextSortOrder(ctx, args.quoteId),
    });
  },
});

/** Adds several rate card lines at once, which is how a quote gets built. */
export const addFromRateCard = mutation({
  args: {
    quoteId: v.id("quotes"),
    itemIds: v.array(v.id("rateCardItems")),
    pax: v.optional(v.number()),
    unitAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org, quote } = await loadQuote(ctx, args.quoteId);
    let sortOrder = await nextSortOrder(ctx, args.quoteId);
    let added = 0;

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.orgId !== org._id) continue;
      await ctx.db.insert("quoteLines", {
        orgId: org._id,
        quoteId: args.quoteId,
        category: item.category,
        section: item.section,
        name: item.name,
        notes: item.notes,
        unit: item.unit,
        pax: args.pax ?? 1,
        unitAmount: args.unitAmount ?? 1,
        costPence: item.costPence,
        ratePence: rateFromCost(item.costPence, marginsOf(quote), quote.roundToPence),
        sortOrder: sortOrder++,
      });
      added++;
    }
    return { added };
  },
});

export const updateLine = mutation({
  args: {
    id: v.id("quoteLines"),
    category: v.optional(quoteCategoryValidator),
    section: v.optional(v.union(v.string(), v.null())),
    name: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    clientNotes: v.optional(v.union(v.string(), v.null())),
    unit: v.optional(quoteUnitValidator),
    pax: v.optional(v.number()),
    unitAmount: v.optional(v.number()),
    costPence: v.optional(v.number()),
    /** Null puts the line back on the rate the margins give. */
    ratePence: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const line = await ctx.db.get(args.id);
    if (!line || line.orgId !== org._id) throw new Error("Line not found");
    const quote = await ctx.db.get(line.quoteId);
    if (!quote) throw new Error("Quote not found");

    const patch: Record<string, unknown> = {};
    if (args.category !== undefined) patch.category = args.category;
    if (args.section !== undefined) patch.section = args.section?.trim() || undefined;
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Name the line");
      patch.name = args.name.trim();
    }
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    if (args.clientNotes !== undefined) patch.clientNotes = args.clientNotes?.trim() || undefined;
    if (args.unit !== undefined) patch.unit = args.unit;
    for (const key of ["pax", "unitAmount"] as const) {
      const value = args[key];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0) throw new Error("That has to be zero or more");
      patch[key] = value;
    }

    const cost = args.costPence ?? line.costPence;
    if (args.costPence !== undefined) {
      if (!Number.isFinite(args.costPence) || args.costPence < 0) {
        throw new Error("Cost must be zero or more");
      }
      patch.costPence = Math.round(args.costPence);
    }

    if (args.ratePence === null) {
      // Back onto the derived rate, at the quote's current margins.
      patch.ratePence = rateFromCost(cost, marginsOf(quote), quote.roundToPence);
      patch.rateOverridden = undefined;
    } else if (args.ratePence !== undefined) {
      if (!Number.isFinite(args.ratePence) || args.ratePence < 0) {
        throw new Error("Rate must be zero or more");
      }
      patch.ratePence = Math.round(args.ratePence);
      patch.rateOverridden = true;
      // The cost follows the rate backwards, unless the cost was set in the
      // same breath — then the producer has said what both are and neither
      // should be worked out from the other. Typing a rate is how a producer
      // works: they know what the job will bear, and the cost that leaves is
      // the answer. Letting the two drift apart makes the margin the quote
      // claims to be carrying a fiction.
      if (args.costPence === undefined) {
        patch.costPence = costFromRate(Math.round(args.ratePence), marginsOf(quote));
      }
    } else if (args.costPence !== undefined && !line.rateOverridden) {
      // The cost moved and nobody had pinned the rate, so it follows.
      patch.ratePence = rateFromCost(cost, marginsOf(quote), quote.roundToPence);
    }

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const removeLine = mutation({
  args: { id: v.id("quoteLines") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const line = await ctx.db.get(args.id);
    if (!line || line.orgId !== org._id) throw new Error("Line not found");
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * Re-prices every line that has not been pinned.
 *
 * Moving the profit margin should move the quote, which is what the sheet did
 * when you changed the percentage. A pinned line — a pass-through, a rate
 * agreed with the client — is left exactly where it is.
 */
export const repriceLines = mutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    const { quote } = await loadQuote(ctx, args.quoteId);
    const lines = await ctx.db
      .query("quoteLines")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .collect();

    let repriced = 0;
    for (const line of lines) {
      if (line.rateOverridden) continue;
      const ratePence = rateFromCost(line.costPence, marginsOf(quote), quote.roundToPence);
      if (ratePence === line.ratePence) continue;
      await ctx.db.patch(line._id, { ratePence });
      repriced++;
    }
    return { repriced };
  },
});

/**
 * Sets a category's total by hand, to land the quote on a round figure.
 *
 * Passing null takes the override off and puts the category back on the sum of
 * its lines.
 */
export const setCategoryTotal = mutation({
  args: {
    quoteId: v.id("quotes"),
    category: quoteCategoryValidator,
    totalPence: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const { org } = await loadQuote(ctx, args.quoteId);
    const existing = await ctx.db
      .query("quoteCategoryOverrides")
      .withIndex("by_quote_category", (q) =>
        q.eq("quoteId", args.quoteId).eq("category", args.category)
      )
      .unique();

    if (args.totalPence === null) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    if (!Number.isFinite(args.totalPence) || args.totalPence < 0) {
      throw new Error("A total has to be zero or more");
    }
    const totalPence = Math.round(args.totalPence);
    if (existing) await ctx.db.patch(existing._id, { totalPence });
    else {
      await ctx.db.insert("quoteCategoryOverrides", {
        orgId: org._id,
        quoteId: args.quoteId,
        category: args.category,
        totalPence,
      });
    }
    return null;
  },
});

/**
 * Pulls the crew already booked on the production onto the quote.
 *
 * The rate card is matched by role, so a booked DoP arrives as the DoP line
 * with the DoP's cost on it. Anyone whose role is not on the card comes in at
 * their own day rate, and at zero if they have not got one — a line you can
 * see and price beats a person quietly left off.
 */
export const addCrewFromProject = mutation({
  args: { quoteId: v.id("quotes"), unitAmount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { org, quote } = await loadQuote(ctx, args.quoteId);
    const projectId = quote.projectId;
    if (!projectId) throw new Error("Put this quote on a production first");
    const bookings = await ctx.db
      .query("projectCrew")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const card = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    let sortOrder = await nextSortOrder(ctx, args.quoteId);
    let added = 0;

    for (const booking of bookings) {
      const person = booking.personId ? await ctx.db.get(booking.personId) : null;
      const role = (booking.role ?? person?.role ?? "").trim();
      if (role.length === 0 && !person) continue;

      const match = card.find(
        (item) => !item.archived && item.name.toLowerCase() === role.toLowerCase()
      );
      const costPence = match?.costPence ?? Math.round((person?.dayRate ?? 0) * 100);

      await ctx.db.insert("quoteLines", {
        orgId: org._id,
        quoteId: args.quoteId,
        category: match?.category ?? "production",
        section: match?.section ?? "PRODUCTION CREW",
        name: match?.name ?? role ?? person?.name ?? "Crew",
        // Who is actually booked, which the rate card cannot know.
        notes: person?.name,
        unit: match?.unit ?? "day",
        pax: 1,
        unitAmount: args.unitAmount ?? 1,
        costPence,
        ratePence: rateFromCost(costPence, marginsOf(quote), quote.roundToPence),
        sortOrder: sortOrder++,
      });
      added++;
    }
    return { added };
  },
});

/**
 * Pulls the kit list onto the quote.
 *
 * Matched to the rate card by name, so an FX9 kit on the job arrives at the
 * FX9 kit's rate. A line already carrying a cost — something hired in — keeps
 * that cost, since it is what the job will actually pay.
 */
export const addKitFromProject = mutation({
  args: { quoteId: v.id("quotes"), unitAmount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { org, quote } = await loadQuote(ctx, args.quoteId);
    const projectId = quote.projectId;
    if (!projectId) throw new Error("Put this quote on a production first");
    const kit = await ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const card = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    let sortOrder = await nextSortOrder(ctx, args.quoteId);
    let added = 0;

    for (const row of kit) {
      const match = card.find(
        (item) => !item.archived && item.name.toLowerCase() === row.item.trim().toLowerCase()
      );
      const costPence = match?.costPence ?? Math.round((row.cost ?? 0) * 100);

      await ctx.db.insert("quoteLines", {
        orgId: org._id,
        quoteId: args.quoteId,
        category: "equipment",
        section: match?.section ?? "EQUIPMENT",
        name: row.item,
        notes: row.notes,
        unit: match?.unit ?? "day",
        pax: row.quantity ?? 1,
        unitAmount: args.unitAmount ?? 1,
        costPence,
        ratePence: rateFromCost(costPence, marginsOf(quote), quote.roundToPence),
        sortOrder: sortOrder++,
      });
      added++;
    }
    return { added };
  },
});
