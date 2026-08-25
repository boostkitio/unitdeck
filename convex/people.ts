import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

const kindValidator = v.union(v.literal("crew"), v.literal("talent"));

/**
 * One contact book per kind. Contacts added before talent existed have no
 * kind and read as crew, which is what they are.
 */
export const list = query({
  args: { kind: v.optional(kindValidator) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const people = await ctx.db
      .query("people")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    const wanted = args.kind ?? "crew";
    return people
      .filter((p) => !p.archived)
      .filter((p) => (p.kind ?? "crew") === wanted)
      .map((p) => ({ ...p, kind: p.kind ?? ("crew" as const) }));
  },
});

export const get = query({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const person = await ctx.db.get(args.id);
    if (!person || person.orgId !== org._id) return null;
    return person;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    kind: v.optional(kindValidator),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    dayRate: v.optional(v.number()),
    dietary: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Name is required");
    if (args.role.trim().length === 0) throw new Error("Role is required");
    return await ctx.db.insert("people", {
      orgId: org._id,
      name: args.name.trim(),
      role: args.role.trim(),
      kind: args.kind,
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      dayRate: args.dayRate,
      dietary: args.dietary,
      notes: args.notes,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("people"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    dayRate: v.optional(v.union(v.number(), v.null())),
    dietary: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const person = await ctx.db.get(args.id);
    if (!person || person.orgId !== org._id) throw new Error("Person not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Name is required");
      patch.name = args.name.trim();
    }
    if (args.role !== undefined) {
      if (args.role.trim().length === 0) throw new Error("Role is required");
      patch.role = args.role.trim();
    }
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.dayRate !== undefined) patch.dayRate = args.dayRate ?? undefined;
    if (args.dietary !== undefined) patch.dietary = args.dietary;
    if (args.notes !== undefined) patch.notes = args.notes;

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

// One transaction's worth. Larger files are sent in successive batches.
const MAX_IMPORT_ROWS = 200;

/**
 * Bulk insert from a parsed CSV. Rows missing a name are skipped rather than
 * failing the batch. Matching an existing person by name updates them instead
 * of inserting a duplicate, so re-importing a corrected file is safe.
 */
export const importRows = mutation({
  args: {
    kind: v.optional(kindValidator),
    rows: v.array(
      v.object({
        name: v.string(),
        role: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        notes: v.optional(v.string()),
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
      .query("people")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(1000);
    const wanted = args.kind ?? "crew";
    // Matching stays inside the book being imported into, so a talent import
    // does not silently overwrite a crew member with the same name.
    const byName = new Map(
      existing
        .filter((person) => (person.kind ?? "crew") === wanted)
        .map((person) => [person.name.trim().toLowerCase(), person])
    );

    let created = 0;
    let updated = 0;
    let unnamed = 0;

    for (const row of args.rows) {
      const name = row.name.trim();
      if (name.length === 0) {
        unnamed++;
        continue;
      }
      const fields = {
        email: row.email?.trim() || undefined,
        phone: row.phone?.trim() || undefined,
        notes: row.notes?.trim() || undefined,
      };
      const match = byName.get(name.toLowerCase());
      if (match) {
        await ctx.db.patch(match._id, {
          ...fields,
          // Role is required on the table, so a blank column keeps the old one.
          role: row.role?.trim() || match.role,
        });
        updated++;
      } else {
        const id = await ctx.db.insert("people", {
          orgId: org._id,
          name,
          role: row.role?.trim() || (wanted === "talent" ? "Talent" : "Crew"),
          kind: args.kind,
          ...fields,
        });
        byName.set(name.toLowerCase(), (await ctx.db.get(id))!);
        created++;
      }
    }

    const notes: string[] = [];
    if (unnamed > 0) {
      notes.push(`${unnamed} row${unnamed === 1 ? "" : "s"} had no name and were not imported.`);
    }
    if (updated > 0) {
      notes.push(`${updated} matched someone already on the list by name and were updated rather than added.`);
    }

    return { created, updated, skipped: unnamed, notes };
  },
});

export const remove = mutation({
  args: { id: v.id("people") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const person = await ctx.db.get(args.id);
    if (!person || person.orgId !== org._id) throw new Error("Person not found");
    // Soft delete: people may be referenced by future call sheets
    await ctx.db.patch(args.id, { archived: true });
    return null;
  },
});
