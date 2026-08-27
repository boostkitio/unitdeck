import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { itemKey } from "./lib/itemKey";
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

/**
 * The kit list as it goes out of the door: every line with the serial number
 * of the thing it names, and the production and company it belongs to.
 *
 * A line is matched to the inventory by its link where it has one and by its
 * name where it has not, because a row written before that link existed still
 * names kit we own and a serial we hold. Where the name matches more than one
 * unit there is no way to say which body went out, so no serial is claimed.
 */
export const kitList = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return null;

    const rows = await ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(500);

    // The inventory, by name, so a line that is not linked to a record can
    // still be recognised. Most rows carry an equipmentId; ones written
    // before that link existed, or typed by hand rather than picked, do not —
    // and the kit is ours and has a serial either way.
    const inventory = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(5000);
    const byName = new Map<string, Doc<"equipment">[]>();
    for (const kit of inventory) {
      if (kit.archived) continue;
      const key = itemKey(kit.item);
      const found = byName.get(key);
      if (found) found.push(kit);
      else byName.set(key, [kit]);
    }

    const items = [];
    for (const row of rows) {
      const linked = row.equipmentId ? await ctx.db.get(row.equipmentId) : null;
      const ours = linked?.orgId === org._id ? linked : null;
      const sameName = byName.get(itemKey(row.item)) ?? [];

      // A named match settles the serial only when it can name one unit.
      // Owning three FX9s and printing the first one's serial would put a
      // number on the sheet that may not be the body that left the building.
      const unit = ours ?? (sameName.length === 1 ? sameName[0] : null);

      items.push({
        id: String(row._id),
        section: sectionOf(row),
        dept: row.dept ?? unit?.dept ?? null,
        item: row.item,
        serialNumber: unit?.serialNumber ?? null,
        // Whether this is ours at all, which is what a rental house is
        // reading the list to work out.
        owned: ours !== null || sameName.length > 0,
        quantity: row.quantity ?? 1,
        cost: row.cost ?? null,
        status: row.status,
        notes: row.notes ?? null,
      });
    }

    const logoUrl = org.settings?.logoStorageId
      ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? null)
      : null;

    return {
      project: {
        name: project.name,
        jobNumber: project.jobNumber ?? null,
      },
      company: { name: org.name, logoUrl },
      items,
    };
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
  /** Normalised item name — what the clash is about. */
  key: string;
  item: string;
  /** How many of it the company owns. */
  stock: number;
  /** How many this production wants. */
  mine: number;
  /** Lines on this production, so a clash can be cleared from here. */
  rowIds: Id<"projectEquipment">[];
  /**
   * True when the very same piece of kit — the same inventory record — is
   * booked on both. That is a clash whether or not there are others like it
   * spare, because both productions are holding the same object.
   */
  sameUnit: boolean;
  others: {
    projectId: Id<"projects">;
    projectName: string;
    status: string;
    /** How many that production wants. */
    count: number;
    /** The days both productions want it, which is what makes it a clash. */
    dates: string[];
  }[];
};

/**
 * Kit this production wants that it cannot have, because the productions
 * shooting the same day want more of it than the company owns.
 *
 * Counting, not matching. The earlier version compared the inventory row a
 * line pointed at, which meant a line pointing at nothing — anything typed by
 * hand, anything imported, anything whose name more than one piece of kit
 * answers to — could never clash, and most of a real kit list is exactly that.
 * It also called it a clash when two productions each took one of the two
 * tripods the company owns, which is not a clash at all.
 *
 * So: add up what every production sharing a day wants of a thing, compare it
 * with how many exist, and report the ones that do not go round. Kit with no
 * inventory record is a hire-in — there is no fixed number of those, so it
 * cannot run out.
 *
 * Archived productions are left out: a job that has been and gone is not
 * competing for anything.
 */
export const clashesForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<EquipmentClash[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    // Shoot days for the whole org in one pass, grouped by production: a
    // clash is a question about two productions' calendars at once.
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

    // How many of each thing the company actually owns.
    const inventory = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(5000);
    const stock = new Map<string, { count: number; item: string }>();
    for (const kit of inventory) {
      if (kit.archived) continue;
      const key = itemKey(kit.item);
      const held = stock.get(key);
      if (held) held.count++;
      else stock.set(key, { count: 1, item: kit.item });
    }

    const rows = await ctx.db
      .query("projectEquipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(4000);

    // What this production wants, which lines ask for it, and which exact
    // pieces of kit it has claimed.
    const wanted = new Map<
      string,
      { count: number; rowIds: Id<"projectEquipment">[]; units: Set<string> }
    >();
    for (const row of rows) {
      if (row.projectId !== args.projectId) continue;
      const key = itemKey(row.item);
      if (!stock.has(key)) continue; // Hired in: no fixed number to run out of.
      const entry = wanted.get(key) ?? { count: 0, rowIds: [], units: new Set<string>() };
      entry.count += row.quantity ?? 1;
      entry.rowIds.push(row._id);
      if (row.equipmentId) entry.units.add(String(row.equipmentId));
      wanted.set(key, entry);
    }
    if (wanted.size === 0) return [];

    // What everyone else shooting on one of our days wants of the same things.
    const projectCache = new Map<string, Doc<"projects"> | null>();
    const demandElsewhere = new Map<
      string,
      Map<
        string,
        {
          projectName: string;
          status: string;
          count: number;
          dates: string[];
          units: Set<string>;
        }
      >
    >();

    for (const row of rows) {
      if (row.projectId === args.projectId) continue;
      const key = itemKey(row.item);
      if (!wanted.has(key)) continue;

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

      const byProject = demandElsewhere.get(key) ?? new Map();
      const entry = byProject.get(projectKey) ?? {
        projectName: otherProject.name,
        status: normaliseStatus(otherProject.status),
        count: 0,
        dates: shared,
        units: new Set<string>(),
      };
      entry.count += row.quantity ?? 1;
      if (row.equipmentId) entry.units.add(String(row.equipmentId));
      byProject.set(projectKey, entry);
      demandElsewhere.set(key, byProject);
    }

    const clashes: EquipmentClash[] = [];
    for (const [key, mine] of wanted) {
      const byProject = demandElsewhere.get(key);
      if (!byProject || byProject.size === 0) continue;

      const held = stock.get(key)!;
      const elsewhere = [...byProject.values()].reduce((sum, o) => sum + o.count, 0);

      // Two ways this goes wrong, and they are not the same thing.
      //
      // The same physical item booked on both: whichever production takes it,
      // the other has nothing, and owning five more like it does not help
      // because neither production asked for those. Applying one package to
      // two shoots does exactly this, to every piece of kit in it.
      const sameUnit = [...byProject.values()].some((other) =>
        [...other.units].some((unit) => mine.units.has(unit))
      );

      // Or simply more wanted than exists, however the lines were written.
      const overflow = mine.count + elsewhere > held.count;

      if (!sameUnit && !overflow) continue;

      clashes.push({
        key,
        item: held.item,
        stock: held.count,
        mine: mine.count,
        rowIds: mine.rowIds,
        sameUnit,
        others: [...byProject.entries()].map(([projectId, o]) => ({
          projectId: projectId as Id<"projects">,
          projectName: o.projectName,
          status: o.status,
          count: o.count,
          dates: o.dates,
        })),
      });
    }

    clashes.sort((a, b) => a.item.localeCompare(b.item));
    return clashes;
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

