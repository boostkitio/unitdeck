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

test("a repeated serial in one file lists each row rather than collapsing them", async () => {
  const { asA } = await setup();

  // Placeholder serials are what an inventory export actually contains, and
  // treating them as real made every such row overwrite the last one.
  const result = await asA.mutation(api.equipment.importRows, {
    rows: [
      { item: "Baby pin", serialNumber: "N/A" },
      { item: "Cheese plate", serialNumber: "N/A" },
      { item: "Apple box", serialNumber: "-" },
      { item: "Sandbag" },
    ],
  });

  expect(result.created).toBe(4);
  expect(result.updated).toBe(0);
  const rows = await asA.query(api.equipment.list, {});
  expect(rows.map((r) => r.item).sort()).toEqual([
    "Apple box",
    "Baby pin",
    "Cheese plate",
    "Sandbag",
  ]);
  // A placeholder is not stored as if it were a serial.
  expect(rows.every((r) => r.serialNumber === undefined)).toBe(true);
});

test("two lines sharing a real serial are two items, not one", async () => {
  const { asA } = await setup();

  const result = await asA.mutation(api.equipment.importRows, {
    rows: [
      { item: "Sony FX9 body A", serialNumber: "SN100" },
      { item: "Sony FX9 body B", serialNumber: "SN100" },
    ],
  });

  expect(result.created).toBe(2);
  expect(
    (await asA.query(api.equipment.list, {})).map((r) => r.item).sort(),
  ).toEqual(["Sony FX9 body A", "Sony FX9 body B"]);
});

test("re-importing a file updates the kit already in the inventory", async () => {
  const { asA } = await setup();
  await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "Sony FX9", serialNumber: "SN100", dept: "Camera" }],
  });

  const second = await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "Sony FX9", serialNumber: "SN100", dept: "Camera dept" }],
  });

  expect(second).toMatchObject({ created: 0, updated: 1 });
  const rows = await asA.query(api.equipment.list, {});
  expect(rows).toHaveLength(1);
  expect(rows[0].dept).toBe("Camera dept");
});

test("re-importing deleted kit brings it back rather than updating it out of sight", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.equipment.create, {
    item: "Sony FX9",
    serialNumber: "SN100",
  });
  await asA.mutation(api.equipment.remove, { id });
  expect(await asA.query(api.equipment.list, {})).toHaveLength(0);

  const result = await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "Sony FX9", serialNumber: "SN100" }],
  });

  expect(result.updated).toBe(1);
  // Previously this patched an archived row, which the list hides: the item
  // was "imported" and still nowhere to be seen.
  expect(await asA.query(api.equipment.list, {})).toHaveLength(1);
  expect(result.notes.join(" ")).toMatch(/deleted/i);
});

test("rows with no item name are reported rather than dropped in silence", async () => {
  const { asA } = await setup();

  const result = await asA.mutation(api.equipment.importRows, {
    rows: [{ item: "Sony FX9" }, { item: "   " }, { item: "" }],
  });

  expect(result).toMatchObject({ created: 1, skipped: 2 });
  expect(result.notes.join(" ")).toMatch(/2 rows had no item name/i);
});

test("the department list offers the defaults, the ones in use and the ones added", async () => {
  const { asA } = await setup();
  await asA.mutation(api.equipment.create, { item: "Mavic 3", dept: "Aerial" });
  await asA.mutation(api.equipment.create, { item: "Sky panel", dept: "lighting" });

  // Adding one in another case files it under the spelling already there.
  expect(await asA.mutation(api.equipment.addDepartment, { name: "  LIGHTING " })).toBe("Lighting");
  expect(await asA.mutation(api.equipment.addDepartment, { name: "Special  effects" })).toBe(
    "Special effects"
  );
  expect(await asA.mutation(api.equipment.addDepartment, { name: "special effects" })).toBe(
    "Special effects"
  );
  await expect(asA.mutation(api.equipment.addDepartment, { name: "   " })).rejects.toThrow();

  const list = await asA.query(api.equipment.departments, {});
  expect(list).toContain("Camera");
  expect(list).toContain("Aerial");
  expect(list).toContain("Special effects");
  expect(list.filter((d) => d.toLowerCase() === "lighting")).toEqual(["Lighting"]);
  expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b)));
});

test("another org does not see the departments you added", async () => {
  const { t, asA } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  await asA.mutation(api.equipment.addDepartment, { name: "Drones" });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  expect(await asB.query(api.equipment.departments, {})).not.toContain("Drones");
});
