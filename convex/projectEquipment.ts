import { mutation, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { itemKey } from "./lib/itemKey";
import {
  bookedElsewhere,
  clashesFor,
  kitDemand,
  kitStock,
  type KitClash,
} from "./lib/kitClashes";
import { sectionOf, type EquipmentSection } from "./lib/kitSection";
import { Doc, Id } from "./_generated/dataModel";
import { normaliseStatus } from "./lib/projectStatus";

const statusValidator = v.union(v.literal("needed"), v.literal("confirmed"));
const sectionValidator = v.union(v.literal("equipment"), v.literal("additional"));

export type { EquipmentSection };

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

    // The days the kit is out for. A rental house reading this list wants to
    // know when as much as what, and whoever signs for it on collection is
    // signing for those dates.
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(500);

    return {
      project: {
        name: project.name,
        jobNumber: project.jobNumber ?? null,
        shootDates: days
          .filter((day) => day.orgId === org._id)
          .map((day) => day.date)
          .sort(),
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

export type EquipmentClash = Omit<KitClash, "others"> & {
  others: (KitClash["others"][number] & { projectName: string; status: string })[];
};

/**
 * Everything a clash is worked out from, read once: what the company owns,
 * what every production wants of it, and which days each production is on.
 *
 * Archived productions are left out of the days, and so out of the count: a
 * job that has been and gone is not competing for anything.
 */
async function kitPicture(ctx: QueryCtx, orgId: Id<"organisations">) {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(2000);
  const live = new Map<Id<"projects">, Doc<"projects">>();
  for (const project of projects) {
    if (project.archived !== true && project.status !== "archived") live.set(project._id, project);
  }

  const shootDays = await ctx.db
    .query("shootDays")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(4000);
  const datesByProject = new Map<Id<"projects">, Set<string>>();
  for (const day of shootDays) {
    const dates = datesByProject.get(day.projectId);
    if (dates) dates.add(day.date);
    else datesByProject.set(day.projectId, new Set([day.date]));
  }

  const inventory = await ctx.db
    .query("equipment")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(5000);
  const stock = kitStock(inventory);

  const lines = await ctx.db
    .query("projectEquipment")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(8000);

  return { live, datesByProject, stock, lines };
}

/**
 * The days that count for one production's clashes: its own, whatever state
 * it is in, against every other production still on the books.
 */
function competingDates(
  projectId: Id<"projects">,
  live: Map<Id<"projects">, Doc<"projects">>,
  datesByProject: Map<Id<"projects">, Set<string>>
) {
  const competing = new Map<Id<"projects">, Set<string>>();
  for (const [id, dates] of datesByProject) {
    if (id === projectId || live.has(id)) competing.set(id, dates);
  }
  return competing;
}

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
 * The counting itself is in convex/lib/kitClashes.ts, a day at a time, and is
 * the same counting the dashboard does.
 */
export const clashesForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<EquipmentClash[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    const { live, datesByProject, stock, lines } = await kitPicture(ctx, org._id);
    const competing = competingDates(args.projectId, live, datesByProject);
    const clashes = clashesFor(args.projectId, kitDemand(lines, stock), stock, competing);

    return clashes.map((clash) => ({
      ...clash,
      others: clash.others.map((other) => {
        const otherProject = live.get(other.projectId)!;
        return {
          ...other,
          projectName: otherProject.name,
          status: normaliseStatus(otherProject.status),
        };
      }),
    }));
  },
});

export type EquipmentBooking = {
  /** The exact piece of kit that is spoken for; absent when all of a thing is. */
  equipmentId?: Id<"equipment">;
  /** Normalised item name. */
  key: string;
  /** Who has it, for saying so. */
  projectNames: string[];
  /** The days of this production it is unavailable on, earliest first. */
  dates: string[];
};

/**
 * What is already out on this production's dates, for the picker to say
 * before a piece of kit is added rather than after: the exact units another
 * production holds, and the things there are none left of.
 */
export const bookedElsewhereForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<EquipmentBooking[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    const { live, datesByProject, stock, lines } = await kitPicture(ctx, org._id);
    const competing = competingDates(args.projectId, live, datesByProject);
    const bookings = bookedElsewhere(args.projectId, kitDemand(lines, stock), stock, competing);

    return bookings.map((booking) => ({
      equipmentId: booking.equipmentId,
      key: booking.key,
      projectNames: booking.projectIds.map((id) => live.get(id)!.name).sort(),
      dates: booking.dates,
    }));
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
 * Other productions that have kit listed, for copying a list off one of them.
 *
 * A package is a standing kit list you maintain; a production is what actually
 * went out on a job. "The same as we took on the Tesco shoot" is how the
 * question usually arrives, and until now there was no way to answer it
 * without retyping the list.
 *
 * Archived productions are included and flagged rather than hidden: a finished
 * job is the most likely thing to be copying from.
 */
export const projectsWithKit = query({
  args: { exclude: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .order("desc")
      .take(200);

    const out: {
      _id: Id<"projects">;
      name: string;
      jobNumber: string | null;
      archived: boolean;
      itemCount: number;
      preview: string[];
    }[] = [];

    for (const project of projects) {
      if (args.exclude !== undefined && project._id === args.exclude) continue;
      const rows = await ctx.db
        .query("projectEquipment")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(200);
      if (rows.length === 0) continue;
      out.push({
        _id: project._id,
        name: project.name,
        jobNumber: project.jobNumber ?? null,
        archived: project.archived === true,
        itemCount: rows.length,
        // Enough to recognise the job by what was on it, without sending the
        // whole list for every production in the picker.
        preview: rows.slice(0, 8).map((row) => row.item),
      });
    }

    return out;
  },
});

/**
 * Copies kit from one production onto another.
 *
 * `lineIds` picks specific lines; without it the whole list comes across,
 * which is the "add all" case and the common one.
 *
 * Section and status are preserved, because they say something true about the
 * line that is worth carrying: kit still to be sourced on the job you are
 * copying from is still to be sourced on this one. This differs deliberately
 * from applying a package, which lands confirmed — a package is kit you own
 * and have just committed, a copied production is a record of what a job
 * needed.
 *
 * The link back to a package item is deliberately not copied. A line that
 * tracks a package changes when the package changes, and somebody copying a
 * production asked for what that job had, not for a subscription to a package
 * they did not choose. What comes across is a snapshot.
 */
export const copyFromProject = mutation({
  args: {
    projectId: v.id("projects"),
    fromProjectId: v.id("projects"),
    lineIds: v.optional(v.array(v.id("projectEquipment"))),
  },
  handler: async (ctx, args): Promise<{ added: number; fromName: string }> => {
    const { org } = await requireOrg(ctx);
    if (args.projectId === args.fromProjectId) {
      throw new Error("That is the same production");
    }
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    const from = await ctx.db.get(args.fromProjectId);
    if (!from || from.orgId !== org._id) throw new Error("Project not found");

    const all = await ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", args.fromProjectId))
      .take(200);

    const wanted =
      args.lineIds === undefined
        ? all
        : all.filter((row) => args.lineIds!.includes(row._id));

    for (const row of wanted) {
      await ctx.db.insert("projectEquipment", {
        orgId: org._id,
        projectId: args.projectId,
        item: row.item,
        dept: row.dept,
        equipmentId: row.equipmentId,
        quantity: row.quantity,
        cost: row.cost,
        notes: row.notes,
        status: row.status,
        section: sectionOf(row),
      });
    }

    return { added: wanted.length, fromName: from.name };
  },
});
