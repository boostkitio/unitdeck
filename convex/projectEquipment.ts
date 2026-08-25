import { QueryCtx, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { normaliseStatus } from "./lib/projectStatus";

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
    // One of the two: an inventory id names the kit for you, free text is for
    // anything you do not own.
    equipmentId: v.optional(v.id("equipment")),
    item: v.optional(v.string()),
    dept: v.optional(v.string()),
    quantity: v.optional(v.number()),
    cost: v.optional(v.number()),
    notes: v.optional(v.string()),
    section: v.optional(sectionValidator),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (args.quantity !== undefined && (!Number.isFinite(args.quantity) || args.quantity < 1)) {
      throw new Error("Quantity must be at least 1");
    }
    if (args.cost !== undefined && (!Number.isFinite(args.cost) || args.cost < 0)) {
      throw new Error("Cost must be zero or more");
    }

    // Kit from the inventory names itself, so picking it is a single click.
    let item = args.item?.trim() ?? "";
    let dept = args.dept?.trim() || undefined;
    if (args.equipmentId !== undefined) {
      const kit = await ctx.db.get(args.equipmentId);
      if (!kit || kit.orgId !== org._id) throw new Error("Equipment not found");
      if (item.length === 0) item = kit.item;
      if (dept === undefined) dept = kit.dept;
    }
    if (item.length === 0) throw new Error("Name the equipment");

    // Your own kit is a given, so it lands confirmed; anything additional has
    // still to be sourced, so it lands needed.
    const section = args.section ?? "additional";
    return await ctx.db.insert("projectEquipment", {
      orgId: org._id,
      projectId: args.projectId,
      item,
      dept,
      equipmentId: args.equipmentId,
      quantity: args.quantity,
      cost: args.cost,
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
    cost: v.optional(v.union(v.number(), v.null())),
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
    if (args.cost !== undefined) {
      if (args.cost !== null && (!Number.isFinite(args.cost) || args.cost < 0)) {
        throw new Error("Cost must be zero or more");
      }
      patch.cost = args.cost ?? undefined;
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

export type EquipmentClash = {
  equipmentId: Id<"equipment">;
  item: string;
  /** This project's line for it, when it is already listed here. */
  rowId: Id<"projectEquipment"> | null;
  others: {
    projectId: Id<"projects">;
    projectName: string;
    status: string;
    /** The days both productions want it, which is what makes it a clash. */
    dates: string[];
  }[];
};

/**
 * Kit this production wants that another production wants on the same day.
 *
 * Only inventory can clash: two lines reading "1.2k HMI" are two hires, but
 * one `equipmentId` is one physical object and it cannot be in two places at
 * once. Free text is deliberately ignored rather than matched on name, which
 * would raise a clash every time two shoots hired the same model of light.
 *
 * Archived productions are left out — a job that has been and gone is not
 * competing for anything.
 */
export const clashesForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<EquipmentClash[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    // Shoot days for the whole org in one pass, grouped by production: a
    // clash is a question about two projects' calendars at once.
    const shootDays = await ctx.db
      .query("shootDays")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(4000);
    const datesByProject = new Map<string, Set<string>>();
    for (const day of shootDays) {
      const key = String(day.projectId);
      const dates = datesByProject.get(key);
      if (dates) dates.add(day.date);
      else datesByProject.set(key, new Set([day.date]));
    }

    const myDates = datesByProject.get(String(args.projectId));
    if (!myDates || myDates.size === 0) return [];

    const rows = await ctx.db
      .query("projectEquipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(4000);

    // What this production has, and which line holds it.
    const mine = new Map<string, Id<"projectEquipment">>();
    for (const row of rows) {
      if (row.projectId !== args.projectId || !row.equipmentId) continue;
      if (!mine.has(String(row.equipmentId))) mine.set(String(row.equipmentId), row._id);
    }

    const byEquipment = new Map<string, EquipmentClash>();
    const projectCache = new Map<string, Doc<"projects"> | null>();

    for (const row of rows) {
      if (row.projectId === args.projectId || !row.equipmentId) continue;

      const other = datesByProject.get(String(row.projectId));
      if (!other) continue;
      const shared = [...myDates].filter((date) => other.has(date)).sort();
      if (shared.length === 0) continue;

      const projectKey = String(row.projectId);
      if (!projectCache.has(projectKey)) {
        projectCache.set(projectKey, await ctx.db.get(row.projectId));
      }
      const otherProject = projectCache.get(projectKey);
      if (!otherProject || otherProject.archived === true) continue;

      const key = String(row.equipmentId);
      const existing = byEquipment.get(key);
      const entry: EquipmentClash = existing ?? {
        equipmentId: row.equipmentId,
        item: row.item,
        rowId: mine.get(key) ?? null,
        others: [],
      };
      if (!entry.others.some((o) => o.projectId === row.projectId)) {
        entry.others.push({
          projectId: row.projectId,
          projectName: otherProject.name,
          status: normaliseStatus(otherProject.status),
          dates: shared,
        });
      }
      byEquipment.set(key, entry);
    }

    return [...byEquipment.values()].sort((a, b) => a.item.localeCompare(b.item));
  },
});

/** Takes several lines off in one go, for clearing a clash in one action. */
export const removeMany = mutation({
  args: { ids: v.array(v.id("projectEquipment")) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    let removed = 0;
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row || row.orgId !== org._id) continue;
      await ctx.db.delete(id);
      removed++;
    }
    return { removed };
  },
});

/**
 * Project kit that predates the inventory link, and could be matched to it.
 *
 * Clash detection works on `equipmentId`, so lines added before that field
 * existed are invisible to it — a production could be double-booked and
 * nothing would say so. This counts what a backfill could join up.
 */
export const unlinkedCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { org } = await requireOrg(ctx);
    const matches = await matchableRows(ctx, org._id);
    return matches.length;
  },
});

/**
 * Rows that can be joined to exactly one piece of inventory by name.
 *
 * A name shared by two pieces of kit is deliberately left alone: two tripods
 * called "Tripod" are two objects, and guessing which one a line meant would
 * invent clashes between productions that are each holding their own.
 */
async function matchableRows(
  ctx: QueryCtx,
  orgId: Id<"organisations">,
): Promise<{ rowId: Id<"projectEquipment">; equipmentId: Id<"equipment"> }[]> {
  const inventory = await ctx.db
    .query("equipment")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(5000);

  const byName = new Map<string, Id<"equipment"> | null>();
  for (const kit of inventory) {
    if (kit.archived) continue;
    const key = kit.item.trim().toLowerCase();
    // null marks a name that more than one piece of kit answers to.
    byName.set(key, byName.has(key) ? null : kit._id);
  }

  const rows = await ctx.db
    .query("projectEquipment")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(5000);

  const out: { rowId: Id<"projectEquipment">; equipmentId: Id<"equipment"> }[] = [];
  for (const row of rows) {
    if (row.equipmentId) continue;
    const match = byName.get(row.item.trim().toLowerCase());
    if (!match) continue;
    out.push({ rowId: row._id, equipmentId: match });
  }
  return out;
}

/** Joins those rows up, so clash detection can see kit listed before the link. */
export const linkToInventory = mutation({
  args: {},
  handler: async (ctx): Promise<{ linked: number }> => {
    const { org } = await requireOrg(ctx);
    const matches = await matchableRows(ctx, org._id);
    for (const match of matches) {
      const row = await ctx.db.get(match.rowId);
      const kit = await ctx.db.get(match.equipmentId);
      await ctx.db.patch(match.rowId, {
        equipmentId: match.equipmentId,
        // Take the department too while we are here, if it has none.
        dept: row?.dept ?? kit?.dept,
      });
    }
    return { linked: matches.length };
  },
});
