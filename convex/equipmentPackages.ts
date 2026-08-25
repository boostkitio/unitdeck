import { MutationCtx, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";

export type PackageItem = {
  _id: Id<"equipmentPackageItems">;
  equipmentId: Id<"equipment"> | null;
  item: string;
  /** Read live from the inventory, so it follows the kit rather than going stale. */
  dept: string | null;
  quantity: number | null;
};

export type EquipmentPackage = {
  _id: Id<"equipmentPackages">;
  name: string;
  notes: string | null;
  items: PackageItem[];
};

/** Packages with their contents, ready to render without a second round trip. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<EquipmentPackage[]> => {
    const { org } = await requireOrg(ctx);
    const packages = await ctx.db
      .query("equipmentPackages")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(200);

    const result: EquipmentPackage[] = [];
    for (const pkg of packages.filter((p) => !p.archived)) {
      const rows = await ctx.db
        .query("equipmentPackageItems")
        .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
        .take(200);
      const items: PackageItem[] = [];
      for (const row of rows) {
        const kit = row.equipmentId ? await ctx.db.get(row.equipmentId) : null;
        items.push({
          _id: row._id,
          equipmentId: row.equipmentId ?? null,
          item: row.item,
          dept: (kit?.orgId === org._id ? kit.dept : undefined) ?? null,
          quantity: row.quantity ?? null,
        });
      }
      result.push({
        _id: pkg._id,
        name: pkg.name,
        notes: pkg.notes ?? null,
        items,
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  },
});

/**
 * The productions currently carrying this package, found from the rows it
 * wrote. Archived projects are left alone: a job that has already been and
 * gone is a record of what went out, and rewriting its kit list would make
 * that record wrong.
 */
async function projectsUsingPackage(
  ctx: MutationCtx,
  packageId: Id<"equipmentPackages">,
): Promise<Id<"projects">[]> {
  const rows = await ctx.db
    .query("projectEquipment")
    .withIndex("by_package", (q) => q.eq("packageId", packageId))
    .take(2000);

  const seen = new Set<string>();
  const projects: Id<"projects">[] = [];
  for (const row of rows) {
    if (seen.has(row.projectId)) continue;
    seen.add(row.projectId);
    const project = await ctx.db.get(row.projectId);
    if (project && !project.archived) projects.push(row.projectId);
  }
  return projects;
}

/** The line a package item becomes on a project. */
async function projectRowFor(
  ctx: MutationCtx,
  orgId: Id<"organisations">,
  item: Doc<"equipmentPackageItems">,
  packageName: string,
) {
  const kit = item.equipmentId ? await ctx.db.get(item.equipmentId) : null;
  return {
    orgId,
    item: item.item,
    dept: kit?.orgId === orgId ? kit.dept : undefined,
    equipmentId: kit?.orgId === orgId ? kit._id : undefined,
    quantity: item.quantity,
    notes: `From ${packageName}`,
    section: "equipment" as const,
    packageId: item.packageId,
    packageItemId: item._id,
  };
}

export const create = mutation({
  args: { name: v.string(), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Name the package");
    return await ctx.db.insert("equipmentPackages", {
      orgId: org._id,
      name: args.name.trim(),
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("equipmentPackages"),
    name: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const pkg = await ctx.db.get(args.id);
    if (!pkg || pkg.orgId !== org._id) throw new Error("Package not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Name the package");
      patch.name = args.name.trim();
    }
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    await ctx.db.patch(args.id, patch);

    // The name is stamped on every line the package put on a project, so a
    // rename has to reach them or they keep citing a package that is gone.
    if (typeof patch.name === "string") {
      const rows = await ctx.db
        .query("projectEquipment")
        .withIndex("by_package", (q) => q.eq("packageId", args.id))
        .take(2000);
      for (const row of rows) {
        await ctx.db.patch(row._id, { notes: `From ${patch.name as string}` });
      }
    }
    return null;
  },
});

/**
 * Copies a package and its contents under a new name.
 *
 * The copy is independent: it is a starting point for a variation on a setup,
 * so editing it must not reach back into the original or the productions
 * carrying it.
 */
export const duplicate = mutation({
  args: { id: v.id("equipmentPackages"), name: v.string() },
  handler: async (ctx, args): Promise<Id<"equipmentPackages">> => {
    const { org } = await requireOrg(ctx);
    const pkg = await ctx.db.get(args.id);
    if (!pkg || pkg.orgId !== org._id) throw new Error("Package not found");
    const name = args.name.trim();
    if (name.length === 0) throw new Error("Name the package");
    if (name.toLowerCase() === pkg.name.trim().toLowerCase()) {
      throw new Error("Give the copy a different name");
    }

    const copyId = await ctx.db.insert("equipmentPackages", {
      orgId: org._id,
      name,
      notes: pkg.notes,
    });
    const rows = await ctx.db
      .query("equipmentPackageItems")
      .withIndex("by_package", (q) => q.eq("packageId", args.id))
      .take(500);
    for (const row of rows) {
      await ctx.db.insert("equipmentPackageItems", {
        orgId: org._id,
        packageId: copyId,
        equipmentId: row.equipmentId,
        item: row.item,
        quantity: row.quantity,
      });
    }
    return copyId;
  },
});

export const remove = mutation({
  args: { id: v.id("equipmentPackages") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const pkg = await ctx.db.get(args.id);
    if (!pkg || pkg.orgId !== org._id) throw new Error("Package not found");

    // Kit already on a project stays on it — deleting a package is tidying the
    // template, not stripping a production's list — but the link goes, so
    // nothing later tries to follow it.
    const onProjects = await ctx.db
      .query("projectEquipment")
      .withIndex("by_package", (q) => q.eq("packageId", args.id))
      .take(2000);
    for (const row of onProjects) {
      await ctx.db.patch(row._id, { packageId: undefined, packageItemId: undefined });
    }

    // The contents go with it — they exist only as part of this package, and
    // orphaned rows would linger invisibly.
    const rows = await ctx.db
      .query("equipmentPackageItems")
      .withIndex("by_package", (q) => q.eq("packageId", args.id))
      .take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(args.id);
    return null;
  },
});

export const addItem = mutation({
  args: {
    packageId: v.id("equipmentPackages"),
    equipmentId: v.optional(v.id("equipment")),
    item: v.optional(v.string()),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.orgId !== org._id) throw new Error("Package not found");
    if (args.quantity !== undefined && (!Number.isFinite(args.quantity) || args.quantity < 1)) {
      throw new Error("Quantity must be at least 1");
    }

    // An inventory line takes its name from the kit; a free-text line needs one.
    let item = args.item?.trim() ?? "";
    if (args.equipmentId !== undefined) {
      const kit = await ctx.db.get(args.equipmentId);
      if (!kit || kit.orgId !== org._id) throw new Error("Equipment not found");
      if (item.length === 0) item = kit.item;
    }
    if (item.length === 0) throw new Error("Name the item");

    const itemId = await ctx.db.insert("equipmentPackageItems", {
      orgId: org._id,
      packageId: args.packageId,
      equipmentId: args.equipmentId,
      item,
      quantity: args.quantity,
    });

    // Adding to the package adds to the productions carrying it.
    const inserted = (await ctx.db.get(itemId))!;
    for (const projectId of await projectsUsingPackage(ctx, args.packageId)) {
      await ctx.db.insert("projectEquipment", {
        ...(await projectRowFor(ctx, org._id, inserted, pkg.name)),
        projectId,
        status: "confirmed",
      });
    }
    return itemId;
  },
});

export const removeItem = mutation({
  args: { id: v.id("equipmentPackageItems") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Item not found");

    // Taking kit out of the package takes it off the productions carrying it.
    const onProjects = await ctx.db
      .query("projectEquipment")
      .withIndex("by_package_item", (q) => q.eq("packageItemId", args.id))
      .take(2000);
    for (const projectRow of onProjects) {
      const project = await ctx.db.get(projectRow.projectId);
      if (project?.archived) continue;
      await ctx.db.delete(projectRow._id);
    }

    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * Copies a package's contents onto a project's Equipment list.
 *
 * Every line is copied, including ones sharing a name with something already
 * listed: two identical bodies or three of the same lens are separate pieces
 * of kit, and collapsing them would understate what is going on the truck.
 *
 * They arrive confirmed — this is kit you own and have just committed to the
 * job, not something still to be chased.
 *
 * Each line keeps a link back to the package item it came from, so later
 * changes to the package reach the productions carrying it. Archived projects
 * are excluded from that: their kit list is a record of what went out.
 */
export const applyToProject = mutation({
  args: { packageId: v.id("equipmentPackages"), projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ added: number; packageName: string }> => {
    const { org } = await requireOrg(ctx);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.orgId !== org._id) throw new Error("Package not found");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    const rows = await ctx.db
      .query("equipmentPackageItems")
      .withIndex("by_package", (q) => q.eq("packageId", args.packageId))
      .take(200);

    for (const row of rows) {
      await ctx.db.insert("projectEquipment", {
        ...(await projectRowFor(ctx, org._id, row, pkg.name)),
        projectId: args.projectId,
        status: "confirmed",
      });
    }

    return { added: rows.length, packageName: pkg.name };
  },
});
