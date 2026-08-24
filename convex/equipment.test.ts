/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("equipment stores every column", async () => {
  const { asA } = await setup();
  await asA.mutation(api.equipment.create, {
    dept: "Camera",
    item: "Sony FX9",
    serialNumber: "FX9-001",
    weightKg: 2.5,
    valueNew: 12000,
    valueCurrent: 7500,
    countryOfManufacture: "Japan",
  });

  const rows = await asA.query(api.equipment.list, {});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    dept: "Camera",
    item: "Sony FX9",
    serialNumber: "FX9-001",
    weightKg: 2.5,
    valueNew: 12000,
    valueCurrent: 7500,
    countryOfManufacture: "Japan",
  });
});

test("an item name is required and negative numbers are rejected", async () => {
  const { asA } = await setup();
  await expect(asA.mutation(api.equipment.create, { item: "  " })).rejects.toThrow(/Name the item/);
  await expect(
    asA.mutation(api.equipment.create, { item: "Tripod", weightKg: -1 }),
  ).rejects.toThrow(/zero or more/);
  await expect(
    asA.mutation(api.equipment.create, { item: "Tripod", valueCurrent: -5 }),
  ).rejects.toThrow(/zero or more/);
});

test("importing matches on serial number, so a re-import updates rather than duplicates", async () => {
  const { asA } = await setup();
  await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "Sony FX9", serialNumber: "FX9-001", valueCurrent: 7500 }],
  });

  const result = await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "Sony FX9", serialNumber: " fx9-001 ", valueCurrent: 7000 }],
  });

  expect(result).toMatchObject({ created: 0, updated: 1 });
  const rows = await asA.query(api.equipment.list, {});
  expect(rows).toHaveLength(1);
  expect(rows[0].valueCurrent).toBe(7000);
});

test("identical items without serials both import, since nothing distinguishes them", async () => {
  const { asA } = await setup();

  const result = await asA.mutation(api.equipment.importRows, {
    rows: [
      { item: "Manfrotto tripod" },
      { item: "Manfrotto tripod" },
    ],
  });

  // Two physical tripods, not one row imported twice.
  expect(result).toMatchObject({ created: 2, updated: 0 });
  expect(await asA.query(api.equipment.list, {})).toHaveLength(2);
});

test("a row with no item is skipped rather than failing the batch", async () => {
  const { asA } = await setup();
  const result = await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "   " }, { item: "Sony FX9" }],
  });
  expect(result).toMatchObject({ created: 1, skipped: 1 });
});

test("removing equipment hides it but keeps the record", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.equipment.create, { item: "Sony FX9" });
  await asA.mutation(api.equipment.remove, { id });

  expect(await asA.query(api.equipment.list, {})).toEqual([]);
  expect(await asA.query(api.equipment.list, { includeArchived: true })).toHaveLength(1);
});

test("another org cannot see or touch this org's equipment", async () => {
  const { t, asA } = await setup();
  const id = await asA.mutation(api.equipment.create, { item: "Sony FX9" });

  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  expect(await asB.query(api.equipment.list, {})).toEqual([]);
  await expect(asB.mutation(api.equipment.remove, { id })).rejects.toThrow();
  await expect(asB.mutation(api.equipment.update, { id, item: "Stolen" })).rejects.toThrow();
});
