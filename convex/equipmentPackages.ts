import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Id } from "./_generated/dataModel";

export type PackageItem = {
  _id: Id<"equipmentPackageItems">;
  equipmentId: Id<"equipment"> | null;
  item: string;
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
      result.push({
        _id: pkg._id,
        name: pkg.name,
        notes: pkg.notes ?? null,
        items: rows.map((row) => ({
          _id: row._id,
          equipmentId: row.equipmentId ?? null,
          item: row.item,
          quantity: row.quantity ?? null,
        })),
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  },
});

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
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("equipmentPackages") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const pkg = await ctx.db.get(args.id);
    if (!pkg || pkg.orgId !== org._id) throw new Error("Package not found");

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

    return await ctx.db.insert("equipmentPackageItems", {
      orgId: org._id,
      packageId: args.packageId,
      equipmentId: args.equipmentId,
      item,
      quantity: args.quantity,
    });
  },
});

export const removeItem = mutation({
  args: { id: v.id("equipmentPackageItems") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Item not found");
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
 * Rows are copied, not linked: editing the package later must not rewrite a
 * production's kit list.
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
      // Take the department from the inventory when the line points at kit we
      // own, so the project's list can be read and sorted by department.
      const kit = row.equipmentId ? await ctx.db.get(row.equipmentId) : null;
      await ctx.db.insert("projectEquipment", {
        orgId: org._id,
        projectId: args.projectId,
        item: row.item,
        dept: kit?.orgId === org._id ? kit.dept : undefined,
        quantity: row.quantity,
        notes: `From ${pkg.name}`,
        status: "confirmed",
        section: "equipment",
      });
    }

    return { added: rows.length, packageName: pkg.name };
  },
});
