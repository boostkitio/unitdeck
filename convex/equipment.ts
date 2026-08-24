import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

const equipmentFields = {
  dept: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  weightKg: v.optional(v.number()),
  valueNew: v.optional(v.number()),
  valueCurrent: v.optional(v.number()),
  countryOfManufacture: v.optional(v.string()),
  notes: v.optional(v.string()),
};

/** Clears a field when null is passed, rather than treating null as a value. */
const nullableText = v.optional(v.union(v.string(), v.null()));
const nullableNumber = v.optional(v.union(v.number(), v.null()));

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(1000);
    return args.includeArchived ? rows : rows.filter((row) => !row.archived);
  },
});

function checkNumbers(args: {
  weightKg?: number | null;
  valueNew?: number | null;
  valueCurrent?: number | null;
}) {
  for (const [label, value] of [
    ["Weight", args.weightKg],
    ["Value when new", args.valueNew],
    ["Current value", args.valueCurrent],
  ] as const) {
    if (value === undefined || value === null) continue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or more`);
  }
}

export const create = mutation({
  args: { item: v.string(), ...equipmentFields },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.item.trim().length === 0) throw new Error("Name the item");
    checkNumbers(args);

    return await ctx.db.insert("equipment", {
      orgId: org._id,
      item: args.item.trim(),
      dept: args.dept?.trim() || undefined,
      serialNumber: args.serialNumber?.trim() || undefined,
      weightKg: args.weightKg,
      valueNew: args.valueNew,
      valueCurrent: args.valueCurrent,
      countryOfManufacture: args.countryOfManufacture?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("equipment"),
    item: v.optional(v.string()),
    dept: nullableText,
    serialNumber: nullableText,
    weightKg: nullableNumber,
    valueNew: nullableNumber,
    valueCurrent: nullableNumber,
    countryOfManufacture: nullableText,
    notes: nullableText,
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Equipment not found");
    checkNumbers(args);

    const patch: Record<string, unknown> = {};
    if (args.item !== undefined) {
      if (args.item.trim().length === 0) throw new Error("Name the item");
      patch.item = args.item.trim();
    }
    if (args.dept !== undefined) patch.dept = args.dept?.trim() || undefined;
    if (args.serialNumber !== undefined) {
      patch.serialNumber = args.serialNumber?.trim() || undefined;
    }
    if (args.weightKg !== undefined) patch.weightKg = args.weightKg ?? undefined;
    if (args.valueNew !== undefined) patch.valueNew = args.valueNew ?? undefined;
    if (args.valueCurrent !== undefined) patch.valueCurrent = args.valueCurrent ?? undefined;
    if (args.countryOfManufacture !== undefined) {
      patch.countryOfManufacture = args.countryOfManufacture?.trim() || undefined;
    }
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("equipment") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Equipment not found");
    // Soft delete: kit may be referenced by past paperwork.
    await ctx.db.patch(args.id, { archived: true });
    return null;
  },
});

// One transaction's worth. Larger files are sent in successive batches.
const MAX_IMPORT_ROWS = 200;

/**
 * Bulk insert from a parsed CSV. Rows without an item are skipped rather than
 * failing the batch.
 *
 * Matching is on serial number when present, since that is what uniquely
 * identifies a physical piece of kit — two identical lenses share an item name
 * but not a serial. Rows without one always insert, because there is nothing
 * to match them on.
 */
export const importRows = mutation({
  args: {
    rows: v.array(
      v.object({
        item: v.string(),
        dept: v.optional(v.string()),
        serialNumber: v.optional(v.string()),
        weightKg: v.optional(v.number()),
        valueNew: v.optional(v.number()),
        valueCurrent: v.optional(v.number()),
        countryOfManufacture: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ created: number; updated: number; skipped: number }> => {
    const { org } = await requireOrg(ctx);
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    }

    const existing = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(1000);
    const bySerial = new Map(
      existing
        .filter((row) => row.serialNumber?.trim())
        .map((row) => [row.serialNumber!.trim().toLowerCase(), row])
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of args.rows) {
      const item = row.item.trim();
      if (item.length === 0) {
        skipped++;
        continue;
      }
      const serial = row.serialNumber?.trim();
      const fields = {
        item,
        dept: row.dept?.trim() || undefined,
        serialNumber: serial || undefined,
        weightKg: row.weightKg,
        valueNew: row.valueNew,
        valueCurrent: row.valueCurrent,
        countryOfManufacture: row.countryOfManufacture?.trim() || undefined,
      };

      const match = serial ? bySerial.get(serial.toLowerCase()) : undefined;
      if (match) {
        await ctx.db.patch(match._id, fields);
        updated++;
      } else {
        const id = await ctx.db.insert("equipment", { orgId: org._id, ...fields });
        // Keep the map current so duplicate serials in one file collapse too.
        if (serial) bySerial.set(serial.toLowerCase(), (await ctx.db.get(id))!);
        created++;
      }
    }

    return { created, updated, skipped };
  },
});
