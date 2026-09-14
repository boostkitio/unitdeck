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

/** Ceiling on how much inventory is read at once, for listing and matching. */
const MAX_INVENTORY = 5000;

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
      .take(MAX_INVENTORY);
    return args.includeArchived ? rows : rows.filter((row) => !row.archived);
  },
});

/** What the department picker offers before anybody has added their own. */
export const DEFAULT_DEPARTMENTS = [
  "Camera",
  "Lenses",
  "Grip",
  "Lighting",
  "Sound",
  "Monitoring",
  "Power",
  "Data",
  "Consumables",
];

/**
 * Every department kit can be filed under: the defaults, the ones added by
 * hand, and any already on a piece of kit — so a department typed before the
 * picker existed is still there to choose. Alphabetical, one of each
 * whatever its capitalisation.
 */
export const departments = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const { org } = await requireOrg(ctx);
    const [saved, owned, onJobs] = await Promise.all([
      ctx.db
        .query("equipmentDepartments")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .take(500),
      ctx.db
        .query("equipment")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .take(MAX_INVENTORY),
      ctx.db
        .query("projectEquipment")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .take(MAX_INVENTORY),
    ]);
    const byKey = new Map<string, string>();
    for (const name of [
      ...DEFAULT_DEPARTMENTS,
      ...saved.map((d) => d.name),
      ...owned.filter((row) => !row.archived).map((row) => row.dept),
      ...onJobs.map((row) => row.dept),
    ]) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, trimmed);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  },
});

/**
 * Adds a department to the picker, and gives back the name to file under —
 * the existing spelling when it is already there in another case, so
 * "lighting" does not become a second Lighting.
 */
export const addDepartment = mutation({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const { org } = await requireOrg(ctx);
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length === 0) throw new Error("Name the department");
    if (name.length > 60) throw new Error("Keep the department name under 60 characters");

    const match = (candidate: string | undefined) =>
      candidate?.trim().toLowerCase() === name.toLowerCase();
    const known = DEFAULT_DEPARTMENTS.find(match);
    if (known) return known;
    const saved = await ctx.db
      .query("equipmentDepartments")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    const existing = saved.find((d) => match(d.name));
    if (existing) return existing.name;

    await ctx.db.insert("equipmentDepartments", { orgId: org._id, name });
    return name;
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
 * Placeholders people put in a serial column when there is no serial. Treating
 * them as real values made every "N/A" row match every other one, so a file of
 * fifty unserialised items collapsed into a single row that was overwritten
 * forty-nine times.
 */
const SERIAL_PLACEHOLDERS = new Set(["", "-", "--", "n/a", "na", "n.a.", "none", "nil", "tbc", "tba", "unknown", "0"]);

function realSerial(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return SERIAL_PLACEHOLDERS.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

/**
 * Bulk insert from a parsed CSV. Rows without an item are skipped rather than
 * failing the batch, and the reasons come back so nothing disappears unsaid.
 *
 * Matching is on serial number when present, since that is what uniquely
 * identifies a physical piece of kit — two identical lenses share an item name
 * but not a serial. Rows without one always insert, because there is nothing
 * to match them on.
 *
 * A serial repeated *within one file* is not treated as a match: two lines
 * someone typed are two pieces of kit, and collapsing them lost items with no
 * way to tell. Only kit already in the inventory is updated.
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
  handler: async (
    ctx,
    args
  ): Promise<{ created: number; updated: number; skipped: number; notes: string[] }> => {
    const { org } = await requireOrg(ctx);
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    }

    const existing = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(MAX_INVENTORY);
    const bySerial = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      const serial = realSerial(row.serialNumber);
      // First wins, so an earlier row is never silently replaced as the key.
      if (serial && !bySerial.has(serial.toLowerCase())) {
        bySerial.set(serial.toLowerCase(), row);
      }
    }

    let created = 0;
    let updated = 0;
    let unnamed = 0;
    let restored = 0;
    const matchedThisFile = new Set<string>();

    for (const row of args.rows) {
      const item = row.item.trim();
      if (item.length === 0) {
        unnamed++;
        continue;
      }
      const serial = realSerial(row.serialNumber);
      const fields = {
        item,
        dept: row.dept?.trim() || undefined,
        serialNumber: serial,
        weightKg: row.weightKg,
        valueNew: row.valueNew,
        valueCurrent: row.valueCurrent,
        countryOfManufacture: row.countryOfManufacture?.trim() || undefined,
      };

      const key = serial?.toLowerCase();
      // Only match kit that was already in the inventory before this file, and
      // only once — a second line with the same serial is a second item.
      const match = key && !matchedThisFile.has(key) ? bySerial.get(key) : undefined;
      if (match) {
        matchedThisFile.add(key!);
        // An item that had been deleted comes back rather than being updated
        // into a row that stays hidden from the list.
        if (match.archived) restored++;
        await ctx.db.patch(match._id, { ...fields, archived: false });
        updated++;
      } else {
        await ctx.db.insert("equipment", { orgId: org._id, ...fields });
        created++;
      }
    }

    const notes: string[] = [];
    if (unnamed > 0) {
      notes.push(`${unnamed} row${unnamed === 1 ? "" : "s"} had no item name and were not imported.`);
    }
    if (updated > 0) {
      notes.push(`${updated} matched kit already in your inventory by serial number and were updated rather than added.`);
    }
    if (restored > 0) {
      notes.push(`${restored} of those had been deleted and are back on the list.`);
    }
    if (existing.length >= MAX_INVENTORY) {
      notes.push(`Only the first ${MAX_INVENTORY} items were checked for a serial match.`);
    }

    return { created, updated, skipped: unnamed, notes };
  },
});
