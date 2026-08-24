import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { LEGACY_STATUSES, normaliseStatus } from "./lib/projectStatus";

// Only current statuses are settable; legacy values remain readable but can
// no longer be written.
const statusValidator = v.union(
  v.literal("not_booked"),
  v.literal("pencilled"),
  v.literal("confirmed")
);

/** Archived either by the flag, or by a legacy row still using the old status. */
function isArchived(project: Doc<"projects">): boolean {
  return project.archived === true || project.status === "archived";
}

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    // Show only archived projects, for the archive view.
    archivedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(200);
    const visible = args.archivedOnly
      ? projects.filter(isArchived)
      : args.includeArchived
        ? projects
        : projects.filter((p) => !isArchived(p));

    // One pass over the org's shoot days, grouped in memory, rather than a
    // per-project query: the table shows a date for every row at once.
    const today = new Date().toISOString().slice(0, 10);
    const shootDays = await ctx.db
      .query("shootDays")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(2000);
    const datesByProject = new Map<Id<"projects">, string[]>();
    for (const day of shootDays) {
      const dates = datesByProject.get(day.projectId);
      if (dates) dates.push(day.date);
      else datesByProject.set(day.projectId, [day.date]);
    }
    for (const dates of datesByProject.values()) dates.sort();

    // Resolve client names for the table view
    return await Promise.all(
      visible.map(async (p) => {
        const dates = datesByProject.get(p._id) ?? [];
        return {
          ...p,
          clientName: p.clientId ? ((await ctx.db.get(p.clientId))?.name ?? null) : null,
          status: normaliseStatus(p.status),
          archived: isArchived(p),
          // Earliest shoot day still to come, and the last one on the books.
          // The table shows the former and falls back to the latter.
          nextShootDate: dates.find((d) => d >= today) ?? null,
          lastShootDate: dates.length > 0 ? dates[dates.length - 1] : null,
          shootDayCount: dates.length,
        };
      })
    );
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) return null;
    const location = project.locationId ? await ctx.db.get(project.locationId) : null;
    return {
      ...project,
      clientName: project.clientId
        ? ((await ctx.db.get(project.clientId))?.name ?? null)
        : null,
      status: normaliseStatus(project.status),
      archived: isArchived(project),
      location,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    clientId: v.optional(v.id("clients")),
    briefSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Project name is required");
    if (args.clientId) {
      const client = await ctx.db.get(args.clientId);
      if (!client || client.orgId !== org._id) throw new Error("Unknown client");
    }
    return await ctx.db.insert("projects", {
      orgId: org._id,
      name: args.name.trim(),
      clientId: args.clientId,
      status: "not_booked",
      briefSummary: args.briefSummary,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    clientId: v.optional(v.union(v.id("clients"), v.null())),
    status: v.optional(statusValidator),
    briefSummary: v.optional(v.string()),
    locationId: v.optional(v.union(v.id("locations"), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Project name is required");
      patch.name = args.name.trim();
    }
    if (args.clientId !== undefined) {
      if (args.clientId !== null) {
        const client = await ctx.db.get(args.clientId);
        if (!client || client.orgId !== org._id) throw new Error("Unknown client");
        patch.clientId = args.clientId;
      } else {
        patch.clientId = undefined;
      }
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.briefSummary !== undefined) patch.briefSummary = args.briefSummary;
    if (args.locationId !== undefined) {
      if (args.locationId !== null) {
        const location = await ctx.db.get(args.locationId);
        if (!location || location.orgId !== org._id) throw new Error("Unknown location");
        patch.locationId = args.locationId;
      } else {
        patch.locationId = undefined;
      }
    }

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

/**
 * Archiving hides a project from active lists without touching its booking
 * status, so an archived production still shows who was on it and where.
 */
export const setArchived = mutation({
  args: { id: v.id("projects"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    const patch: Record<string, unknown> = { archived: args.archived };
    // A legacy row archived via its status needs a real status back, or it
    // would still read as archived once the flag is cleared.
    if (project.status === "archived") patch.status = normaliseStatus(project.status);
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

/** How many projects still carry a pre-booking-model status. */
export const legacyStatusCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    return projects.filter((p) => LEGACY_STATUSES.includes(p.status)).length;
  },
});

/**
 * Rewrites legacy statuses to the booking model and moves status-based
 * archiving onto the flag. Idempotent: rows already migrated are skipped, so
 * running it twice is harmless.
 */
export const migrateStatuses = mutation({
  args: {},
  handler: async (ctx): Promise<{ migrated: number }> => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);

    let migrated = 0;
    for (const project of projects) {
      if (!LEGACY_STATUSES.includes(project.status)) continue;
      await ctx.db.patch(project._id, {
        status: normaliseStatus(project.status),
        archived: project.archived === true || project.status === "archived",
      });
      migrated++;
    }
    return { migrated };
  },
});
