import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Id } from "./_generated/dataModel";

export type ScheduleItem = {
  _id: Id<"scheduleItems">;
  shootDayId: Id<"shootDays"> | null;
  /** The day this sits on, resolved for display and ordering. */
  date: string | null;
  dayLabel: string | null;
  time: string | null;
  item: string;
  notes: string | null;
};

/** "07:00" and nothing else — anything looser sorts wrongly and reads worse. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function checkTime(time: string | undefined) {
  if (time === undefined) return;
  if (time.trim().length === 0) return;
  if (!TIME_RE.test(time.trim())) throw new Error("Time must be written as HH:MM, like 07:00");
}

/**
 * The running order, in the order it runs: by day, then by time, with items
 * whose time is not settled at the end of their day rather than the start.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<ScheduleItem[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const dayById = new Map(days.map((d) => [String(d._id), d]));

    const rows = await ctx.db
      .query("scheduleItems")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(500);

    const items = rows.map((row) => {
      const day = row.shootDayId ? dayById.get(String(row.shootDayId)) : undefined;
      return {
        _id: row._id,
        shootDayId: row.shootDayId ?? null,
        date: day?.date ?? null,
        dayLabel: day?.label ?? null,
        time: row.time ?? null,
        item: row.item,
        notes: row.notes ?? null,
      };
    });

    items.sort((a, b) => {
      // Items not tied to a day come first: they apply to the whole job.
      if (a.date !== b.date) return (a.date ?? "").localeCompare(b.date ?? "");
      if (a.time === b.time) return a.item.localeCompare(b.item);
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time.localeCompare(b.time);
    });
    return items;
  },
});

export const add = mutation({
  args: {
    projectId: v.id("projects"),
    shootDayId: v.optional(v.id("shootDays")),
    time: v.optional(v.string()),
    item: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (args.item.trim().length === 0) throw new Error("Say what happens");
    checkTime(args.time);
    if (args.shootDayId) {
      const day = await ctx.db.get(args.shootDayId);
      if (!day || day.projectId !== args.projectId) {
        throw new Error("That shoot day is not on this project");
      }
    }

    return await ctx.db.insert("scheduleItems", {
      orgId: org._id,
      projectId: args.projectId,
      shootDayId: args.shootDayId,
      time: args.time?.trim() || undefined,
      item: args.item.trim(),
      notes: args.notes?.trim() || undefined,
    });
  },
});

/** One transaction's worth of a pasted running order. */
const MAX_IMPORT_ITEMS = 200;

/**
 * A whole running order at once, from a schedule somebody else wrote.
 *
 * `replace` clears what is already there first, which is what you want when
 * the schedule you were sent has been revised: the alternative is deleting
 * twenty lines by hand before pasting twenty more.
 */
export const addMany = mutation({
  args: {
    projectId: v.id("projects"),
    replace: v.optional(v.boolean()),
    items: v.array(
      v.object({
        shootDayId: v.optional(v.id("shootDays")),
        time: v.optional(v.string()),
        item: v.string(),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ added: number; replaced: number }> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (args.items.length > MAX_IMPORT_ITEMS) {
      throw new Error(`Add at most ${MAX_IMPORT_ITEMS} lines at a time`);
    }

    // Every day named must belong to this project, checked once rather than
    // per line.
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const ours = new Set(days.map((d) => String(d._id)));
    for (const row of args.items) {
      if (row.shootDayId && !ours.has(String(row.shootDayId))) {
        throw new Error("That shoot day is not on this project");
      }
      checkTime(row.time);
    }

    let replaced = 0;
    if (args.replace) {
      const existing = await ctx.db
        .query("scheduleItems")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(500);
      for (const row of existing) {
        await ctx.db.delete(row._id);
        replaced++;
      }
    }

    let added = 0;
    for (const row of args.items) {
      const item = row.item.trim();
      // A blank line is not worth failing the paste over.
      if (item.length === 0) continue;
      await ctx.db.insert("scheduleItems", {
        orgId: org._id,
        projectId: args.projectId,
        shootDayId: row.shootDayId,
        time: row.time?.trim() || undefined,
        item,
        notes: row.notes?.trim() || undefined,
      });
      added++;
    }

    return { added, replaced };
  },
});

export const update = mutation({
  args: {
    id: v.id("scheduleItems"),
    shootDayId: v.optional(v.union(v.id("shootDays"), v.null())),
    time: v.optional(v.union(v.string(), v.null())),
    item: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Schedule item not found");

    const patch: Record<string, unknown> = {};
    if (args.item !== undefined) {
      if (args.item.trim().length === 0) throw new Error("Say what happens");
      patch.item = args.item.trim();
    }
    if (args.time !== undefined) {
      checkTime(args.time ?? undefined);
      patch.time = args.time?.trim() || undefined;
    }
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    if (args.shootDayId !== undefined) {
      if (args.shootDayId !== null) {
        const day = await ctx.db.get(args.shootDayId);
        if (!day || day.projectId !== row.projectId) {
          throw new Error("That shoot day is not on this project");
        }
      }
      patch.shootDayId = args.shootDayId ?? undefined;
    }

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("scheduleItems") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Schedule item not found");
    await ctx.db.delete(args.id);
    return null;
  },
});
