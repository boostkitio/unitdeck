import {
  internalAction,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { joinName } from "./lib/personName";
import { fromLine, quoteEmail, sendEmail } from "./lib/email";
import { senderOf } from "./lib/sender";
import { quoteCategoryValidator, quoteUnitValidator } from "./schema";
import { inCardOrder, SECTION_CATEGORY } from "./lib/rateCardOrder";
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

/**
 * The caveats that go on every quote unless somebody has written their own.
 *
 * These are the ones that were ticked "always include" on the spreadsheet.
 * They are a starting point, not a rule: the caveats box on the quote is free
 * text, so a job with different terms says so.
 */
export const DEFAULT_CAVEATS = [
  "ALL ESTIMATES ARE SUBJECT TO CHANGE",
  "- This quote is valid for 30 days.",
  "- 50% of quoted amount to be paid upfront before work commences, the remaining 50% to be paid on delivery of project.",
  "- Once this quote is accepted any amendment to the scope of work will be subject to additional fees.",
  "- Three edit amends are included per deliverable. Further amends will incur an additional cost.",
];

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
    const quotes = (
      await ctx.db
        .query("quotes")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect()
    ).filter((q) => q.archived !== true);

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
  args: { archivedOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const all = await ctx.db
      .query("quotes")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const quotes = all.filter((q) =>
      args.archivedOnly ? q.archived === true : q.archived !== true
    );

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
        archived: quote.archived === true,
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
  handler: async (ctx, args): Promise<QuoteView | null> => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) return null;
    return await readQuote(ctx, args.id);
  },
});

export type QuoteView = NonNullable<Awaited<ReturnType<typeof readQuote>>>;

/**
 * Everything a quote is, for whoever is allowed to see it.
 *
 * The permission check belongs to the caller: `get` asks for the caller's
 * organisation, the render-token query asks for an unexpired token. What is
 * read is the same either way, so the client's copy on screen and the copy a
 * headless browser turns into a PDF cannot drift apart.
 */
async function readQuote(ctx: QueryCtx, id: Id<"quotes">) {
  const quote = await ctx.db.get(id);
  if (!quote) return null;

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

  // The sheet's own order, worked out from the standard card rather than
  // from when a row was created — otherwise a line added to the card later
  // lands at the bottom of the quote instead of in its section.
  const ordered = inCardOrder<Doc<"quoteLines">>(lines);

  // The name on the client copy follows whoever owns the quote, and a quote
  // written before its owner had a name should read as them now that they
  // do — the name is the person, not a stamp on the row. A name typed into
  // the quote by hand still wins, since somebody meant it.
  // Falls back to whoever wrote it, which is what an owner was before there
  // was one to set, and keeps a quote from going out unsigned. The owner
  // itself is reported as it is stored: a quote set to nobody says nobody.
  const namedBy = quote.ownerId ?? quote.createdBy;
  let producerName = quote.producerName;
  if (namedBy) {
    const profile = await ctx.db
      .query("memberProfiles")
      .withIndex("by_org_user", (q) => q.eq("orgId", quote.orgId).eq("userId", namedBy))
      .unique();
    const owned = joinName(profile);
    if (owned) producerName = owned;
  }

  return {
    quote: { ...quote, producerName },
    project: project
      ? { _id: project._id, name: project.name, jobNumber: project.jobNumber ?? null }
      : null,
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
}

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
    const chosen = houseCaveats
      .filter((c) => c.alwaysInclude && !c.archived)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => c.text);

    const title = args.title?.trim() || undefined;
    const number =
      args.number?.trim() ||
      (await nextNumber(ctx, org._id, client?.name ?? project?.name ?? title ?? null));

    // The name they set in UnitDeck first: Clerk's is blank unless the
    // instance has Name enabled, which is why memberProfiles exists.
    const profile = await ctx.db
      .query("memberProfiles")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", org._id).eq("userId", identity.subject)
      )
      .unique();
    const ownName =
      joinName(profile) ||
      (typeof identity.name === "string" ? identity.name.trim() : "") ||
      undefined;

    const quoteId = await ctx.db.insert("quotes", {
      orgId: org._id,
      projectId: args.projectId,
      title,
      number,
      status: "draft",
      createdBy: identity.subject,
      ownerId: identity.subject,
      quoteType: args.quoteType ?? "Ballpark",
      clientId,
      clientName: client?.name,
      producerName: ownName,
      producerEmail: typeof identity.email === "string" ? identity.email : undefined,
      // The house list where there is one, otherwise the standing terms —
      // never an empty box, since the terms are the same on almost every job
      // and a quote that goes out without them is a quote with no terms.
      caveats: chosen.length > 0 ? chosen : DEFAULT_CAVEATS,
      ...DEFAULT_MARGINS,
      discountPence: 0,
    });

    // Every line on the rate card comes onto the quote, priced but with
    // nothing against it. Pricing then means filling in how many and how long,
    // exactly as the spreadsheet worked — and a chargeable line you have
    // forgotten is a line you can see, rather than one you never thought to
    // look for. A line with nothing against it totals zero and is not printed.
    const card = await ctx.db
      .query("rateCardItems")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const margins = {
      contingencyBp: DEFAULT_MARGINS.contingencyBp,
      profitBp: DEFAULT_MARGINS.profitBp,
      insuranceBp: DEFAULT_MARGINS.insuranceBp,
    };

    let sortOrder = 0;
    for (const item of card
      .filter((i) => !i.archived)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      sortOrder += 1;
      await ctx.db.insert("quoteLines", {
        orgId: org._id,
        quoteId,
        category: item.category,
        section: item.section,
        name: item.name,
        notes: item.notes,
        unit: item.unit,
        pax: 0,
        unitAmount: 0,
        costPence: item.costPence,
        ratePence: rateFromCost(item.costPence, margins, DEFAULT_MARGINS.roundToPence),
        sortOrder,
      });
    }

    return quoteId;
  },
});

/**
 * The house reference: the date backwards, who it is for, and which go this is.
 *
 * 260827_Ala_1 — 27 August 2026, for Alan, first version. Sorting by name puts
 * quotes in date order, which is the point of writing the date that way round.
 *
 * The version is the next one free for that day and that name, so a second
 * quote written for the same client on the same day is _2 rather than a
 * collision.
 */
export function quoteNumber(date: Date, named: string | null, version: number): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const letters = (named ?? "").replace(/[^A-Za-z]/g, "").slice(0, 3);
  const stem = letters
    ? letters[0].toUpperCase() + letters.slice(1).toLowerCase()
    : "Job";
  return `${yy}${mm}${dd}_${stem}_${version}`;
}

/** Splits a reference back into the part that identifies it and its version. */
export function parseQuoteNumber(
  number: string
): { stem: string; version: number } | null {
  const match = /^(\d{6}_[A-Za-z]{1,3})_(\d+)$/.exec(number);
  if (!match) return null;
  return { stem: match[1], version: Number(match[2]) };
}

async function nextNumber(
  ctx: MutationCtx,
  orgId: Id<"organisations">,
  named: string | null
): Promise<string> {
  const now = new Date();
  const existing = await ctx.db
    .query("quotes")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();

  let version = 1;
  while (existing.some((q) => q.number === quoteNumber(now, named, version))) {
    version += 1;
  }
  return quoteNumber(now, named, version);
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
    for (const quote of quotes.filter(
      (q) => q.projectId === undefined && q.archived !== true
    )) {
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
    ownerId: v.optional(v.union(v.string(), v.null())),
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
    if (args.ownerId !== undefined) {
      patch.ownerId = args.ownerId ?? undefined;
      // Handing a quote over hands over the name on it, so a name stamped in
      // for the old owner is cleared and read from the new one instead.
      patch.producerName = undefined;
      patch.producerEmail = undefined;
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

/**
 * Puts a quote away, or brings it back.
 *
 * Not deleted: a quote that lost the job is still the record of what was
 * offered, and the same thing quoted again next year starts from it.
 */
export const setArchived = mutation({
  args: { id: v.id("quotes"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");
    await ctx.db.patch(args.id, { archived: args.archived || undefined });
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
    if (args.category !== undefined) {
      patch.category = args.category;
      // Moving a line to another category moves it out of its section too: a
      // camera under Post Production would otherwise print under a Cameras
      // heading in the wrong half of the quote. It lands at the end of the
      // category it was moved to, which is where somebody who just moved it
      // looks for it. Naming a section in the same breath wins.
      const belongs = SECTION_CATEGORY.get((line.section ?? "").trim().toLowerCase());
      if (args.section === undefined && belongs !== args.category) patch.section = undefined;
    }
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
 * Re-prices every line on the quote at its current margins.
 *
 * Every line, including one whose rate was typed by hand. Moving the profit
 * margin is a statement about the whole quote, and a handful of lines quietly
 * exempt from it is how a quote ends up carrying a margin nobody can account
 * for. A hand-typed rate set its own cost on the way in, so re-pricing works
 * from that cost and the line lands where the new margins put it.
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
      const ratePence = rateFromCost(line.costPence, marginsOf(quote), quote.roundToPence);
      if (ratePence === line.ratePence) continue;
      await ctx.db.patch(line._id, { ratePence, rateOverridden: undefined });
      repriced++;
    }
    return { repriced };
  },
});

/**
 * The next version of a quote: a copy, numbered _2, _3 and so on.
 *
 * A quote that has gone out is a document somebody has read. Revising it in
 * place would change what they were sent, so a revision is a new quote beside
 * it and the old one stays exactly as it was issued.
 */
export const newVersion = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { org, quote } = await loadQuote(ctx, args.id);

    const existing = await ctx.db
      .query("quotes")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const parsed = parseQuoteNumber(quote.number);
    let number: string;
    if (parsed) {
      let version = parsed.version + 1;
      while (existing.some((q) => q.number === `${parsed.stem}_${version}`)) version += 1;
      number = `${parsed.stem}_${version}`;
    } else {
      number = await nextNumber(ctx, org._id, quote.title ?? quote.clientName ?? null);
    }

    // Written out field by field rather than spread from the original: the
    // three timestamps say when *that* quote went out, and a copy of them on a
    // draft would be a lie the document tells about itself.
    const copyId = await ctx.db.insert("quotes", {
      orgId: quote.orgId,
      projectId: quote.projectId,
      title: quote.title,
      number,
      status: "draft",
      quoteType: quote.quoteType,
      clientId: quote.clientId,
      clientName: quote.clientName,
      clientContact: quote.clientContact,
      createdBy: quote.createdBy,
      ownerId: quote.ownerId,
      producerName: quote.producerName,
      producerEmail: quote.producerEmail,
      producerPhone: quote.producerPhone,
      deliverables: quote.deliverables,
      caveats: quote.caveats,
      contingencyBp: quote.contingencyBp,
      profitBp: quote.profitBp,
      insuranceBp: quote.insuranceBp,
      vatBp: quote.vatBp,
      roundToPence: quote.roundToPence,
      discountPence: quote.discountPence,
    });

    for (const line of await ctx.db
      .query("quoteLines")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.id))
      .collect()) {
      await ctx.db.insert("quoteLines", {
        orgId: line.orgId,
        quoteId: copyId,
        category: line.category,
        section: line.section,
        name: line.name,
        notes: line.notes,
        clientNotes: line.clientNotes,
        unit: line.unit,
        pax: line.pax,
        unitAmount: line.unitAmount,
        costPence: line.costPence,
        ratePence: line.ratePence,
        rateOverridden: line.rateOverridden,
        sortOrder: line.sortOrder,
      });
    }
    for (const o of await ctx.db
      .query("quoteCategoryOverrides")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.id))
      .collect()) {
      await ctx.db.insert("quoteCategoryOverrides", {
        orgId: o.orgId,
        quoteId: copyId,
        category: o.category,
        totalPence: o.totalPence,
      });
    }

    return copyId;
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
 * The line already on the quote for something, if there is one.
 *
 * Every rate card line is on the quote from the start, so pulling in the crew
 * or the kit should fill the line that is already there rather than add a
 * second one beside it — two Camera Op rows, one priced and one blank, is
 * worse than the retyping it was meant to save.
 */
function unfilledLineFor(
  lines: Doc<"quoteLines">[],
  name: string
): Doc<"quoteLines"> | undefined {
  const wanted = name.trim().toLowerCase();
  return lines.find(
    (line) =>
      line.name.trim().toLowerCase() === wanted &&
      (line.pax === 0 || line.unitAmount === 0)
  );
}

/**
 * Makes a quote's lines the rate card's lines again.
 *
 * For a quote that carries rows from an older version of the card — lines
 * whose names nothing on the card answers to any more. Anything priced is
 * kept whatever it is called, because that is somebody's work and possibly
 * a figure a client has already seen; an unpriced line that is not on the
 * card goes, and anything on the card that is missing arrives.
 */
export const rebuildLines = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { org, quote } = await loadQuote(ctx, args.id);
    const [card, lines] = await Promise.all([
      ctx.db
        .query("rateCardItems")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect(),
      ctx.db
        .query("quoteLines")
        .withIndex("by_quote", (q) => q.eq("quoteId", args.id))
        .collect(),
    ]);

    const lineKey = (section: string | undefined, name: string) =>
      `${(section ?? "").trim().toLowerCase()}::${name.replace(/\s+/g, " ").trim().toLowerCase()}`;
    const standard = new Set(
      card.filter((i) => !i.archived).map((i) => lineKey(i.section, i.name))
    );

    let removed = 0;
    const kept = new Set<string>();
    for (const line of lines) {
      const key = lineKey(line.section, line.name);
      const priced = line.pax > 0 && line.unitAmount > 0;
      if (!priced && !standard.has(key)) {
        await ctx.db.delete(line._id);
        removed += 1;
        continue;
      }
      kept.add(key);
    }

    const margins = {
      contingencyBp: quote.contingencyBp,
      profitBp: quote.profitBp,
      insuranceBp: quote.insuranceBp,
    };
    let sortOrder = lines.reduce((max, line) => Math.max(max, line.sortOrder ?? 0), 0);
    let added = 0;
    for (const item of card
      .filter((i) => !i.archived)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      if (kept.has(lineKey(item.section, item.name))) continue;
      sortOrder += 1;
      added += 1;
      await ctx.db.insert("quoteLines", {
        orgId: org._id,
        quoteId: args.id,
        category: item.category,
        section: item.section,
        name: item.name,
        notes: item.notes,
        unit: item.unit,
        pax: 0,
        unitAmount: 0,
        costPence: item.costPence,
        ratePence: rateFromCost(item.costPence, margins, quote.roundToPence),
        sortOrder,
      });
    }
    return { removed, added };
  },
});

// ---------------------------------------------------------------------------
// Getting it to the client
// ---------------------------------------------------------------------------

/**
 * A short-lived link a headless browser can read the quote through.
 *
 * The client's copy is behind a login, and the renderer has no login. The
 * token is unguessable, single-purpose and expires in minutes, which is the
 * same bargain the call sheets make.
 */
export const createRenderToken = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await ctx.db.insert("renderTokens", {
      quoteId: args.id,
      token,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return { token };
  },
});

/** The quote behind a render token, for the page that is printed to PDF. */
export const getByRenderToken = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<QuoteView | null> => {
    const row = await ctx.db
      .query("renderTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row || row.expiresAt < Date.now() || !row.quoteId) return null;
    return await readQuote(ctx, row.quoteId);
  },
});

/** Somewhere to put the rendered PDF before it is attached to an email. */
export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Emails the quote to the client with the PDF attached.
 *
 * The PDF is made in the browser and uploaded first, so there is one renderer
 * and what the client opens is what was on screen. Sending marks the quote as
 * sent, because that is what has happened.
 */
export const sendToClient = mutation({
  args: {
    id: v.id("quotes"),
    to: v.string(),
    message: v.optional(v.string()),
    fileId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote || quote.orgId !== org._id) throw new Error("Quote not found");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to.trim())) {
      throw new Error("That does not look like an email address");
    }
    const sender = await senderOf(ctx);

    await ctx.scheduler.runAfter(0, internal.quotes.deliverToClient, {
      quoteId: args.id,
      orgName: org.name,
      to: args.to.trim(),
      message: args.message,
      fileId: args.fileId,
      fileName: args.fileName,
      // Whoever pressed send, not whoever raised the quote — a client
      // replying should reach the person who actually emailed them. The
      // producer named on the document is the fallback.
      fromName: sender.senderName ?? quote.producerName ?? undefined,
      fromEmail: sender.senderEmail ?? quote.producerEmail ?? undefined,
    });

    await ctx.db.patch(args.id, {
      status: "sent",
      issuedAt: quote.issuedAt ?? Date.now(),
    });
    return null;
  },
});

export const deliverToClient = internalAction({
  args: {
    quoteId: v.id("quotes"),
    orgName: v.string(),
    to: v.string(),
    message: v.optional(v.string()),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set on this deployment");

    const file = await ctx.storage.get(args.fileId);
    if (!file) throw new Error("The PDF was not there to send");
    const attachment = bytesToBase64(new Uint8Array(await file.arrayBuffer()));

    const quote = await ctx.runQuery(internal.quotes.numberFor, { id: args.quoteId });
    const result = await sendEmail({
      apiKey,
      to: [args.to],
      // In the producer's name, and a reply reaches them rather than us.
      from: fromLine(args.fromName),
      replyTo: args.fromEmail,
      subject: `Quote ${quote?.number ?? ""} from ${args.orgName}`.trim(),
      html: quoteEmail({
        orgName: args.orgName,
        fromName: args.fromName,
        message: args.message,
        number: quote?.number,
        title: quote?.title,
      }),
      attachments: [{ filename: args.fileName, content: attachment }],
    });
    if (!result.ok) throw new Error(result.error);

    // The upload was a courier, not a record: the quote is the record, and it
    // can be rendered again whenever anybody wants it.
    await ctx.storage.delete(args.fileId);
    return null;
  },
});

export const numberFor = internalQuery({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.id);
    if (!quote) return null;
    return { number: quote.number, title: quote.title };
  },
});

/** Resend takes base64; a quote is a few pages, so one pass is fine. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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

    const existing = await ctx.db
      .query("quoteLines")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
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
      const name = match?.name ?? role ?? person?.name ?? "Crew";
      const unitAmount = args.unitAmount ?? 1;

      const line = unfilledLineFor(existing, name);
      if (line) {
        await ctx.db.patch(line._id, {
          pax: line.pax > 0 ? line.pax + 1 : 1,
          unitAmount,
          // Who is actually booked, which the rate card cannot know.
          notes: person?.name ?? line.notes,
        });
        // So a second person in the same role adds to the count rather than
        // filling the line twice.
        line.pax = line.pax > 0 ? line.pax + 1 : 1;
        line.unitAmount = unitAmount;
      } else {
        await ctx.db.insert("quoteLines", {
          orgId: org._id,
          quoteId: args.quoteId,
          category: match?.category ?? "production",
          section: match?.section ?? "PRODUCTION CREW",
          name,
          notes: person?.name,
          unit: match?.unit ?? "day",
          pax: 1,
          unitAmount,
          costPence,
          ratePence: rateFromCost(costPence, marginsOf(quote), quote.roundToPence),
          sortOrder: sortOrder++,
        });
      }
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

    const existing = await ctx.db
      .query("quoteLines")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .collect();
    let sortOrder = await nextSortOrder(ctx, args.quoteId);
    let added = 0;

    for (const row of kit) {
      const match = card.find(
        (item) => !item.archived && item.name.toLowerCase() === row.item.trim().toLowerCase()
      );
      const costPence = match?.costPence ?? Math.round((row.cost ?? 0) * 100);
      const pax = row.quantity ?? 1;
      const unitAmount = args.unitAmount ?? 1;

      const line = unfilledLineFor(existing, row.item);
      if (line) {
        await ctx.db.patch(line._id, { pax, unitAmount, notes: row.notes ?? line.notes });
        line.pax = pax;
        line.unitAmount = unitAmount;
      } else {
        await ctx.db.insert("quoteLines", {
          orgId: org._id,
          quoteId: args.quoteId,
          category: "equipment",
          section: match?.section ?? "EQUIPMENT",
          name: row.item,
          notes: row.notes,
          unit: match?.unit ?? "day",
          pax,
          unitAmount,
          costPence,
          ratePence: rateFromCost(costPence, marginsOf(quote), quote.roundToPence),
          sortOrder: sortOrder++,
        });
      }
      added++;
    }
    return { added };
  },
});
