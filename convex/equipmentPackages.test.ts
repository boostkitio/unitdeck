/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    return { org, project };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("a package takes its item name from the inventory when one is not given", async () => {
  const { asA } = await setup();
  const kitId = await asA.mutation(api.equipment.create, { item: "Sony FX9", dept: "Camera" });
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });

  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, equipmentId: kitId });

  const packages = await asA.query(api.equipmentPackages.list, {});
  expect(packages[0].items).toHaveLength(1);
  expect(packages[0].items[0]).toMatchObject({ item: "Sony FX9", equipmentId: kitId });
});

test("a free-text line needs a name, since there is no kit to take one from", async () => {
  const { asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Lighting" });
  await expect(
    asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "   " }),
  ).rejects.toThrow(/Name the item/);
});

test("applying a package copies its contents onto the project", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });
  await asA.mutation(api.equipmentPackages.addItem, {
    packageId: pkgId,
    item: "Tripod",
    quantity: 2,
  });

  const result = await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });
  expect(result).toMatchObject({ added: 2, skipped: 0, packageName: "Camera package" });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item).sort()).toEqual(["Sony FX9", "Tripod"]);
  expect(kit.find((row) => row.item === "Tripod")?.quantity).toBe(2);
  // Everything arrives as still needed, not silently confirmed.
  expect(kit.every((row) => row.status === "needed")).toBe(true);
});

test("applying twice does not duplicate what is already listed", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });

  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });
  const second = await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  expect(second).toMatchObject({ added: 0, skipped: 1 });
  expect(
    await asA.query(api.projectEquipment.listForProject, { projectId: ids.project }),
  ).toHaveLength(1);
});

test("editing a package afterwards does not rewrite a project's kit list", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  const itemId = await asA.mutation(api.equipmentPackages.addItem, {
    packageId: pkgId,
    item: "Sony FX9",
  });
  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  // The project's list is a copy, not a live link.
  await asA.mutation(api.equipmentPackages.removeItem, { id: itemId });
  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item)).toEqual(["Sony FX9"]);
});

test("deleting a package takes its contents with it", async () => {
  const { t, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });

  await asA.mutation(api.equipmentPackages.remove, { id: pkgId });

  expect(await asA.query(api.equipmentPackages.list, {})).toEqual([]);
  const orphans = await t.run(async (ctx) => await ctx.db.query("equipmentPackageItems").collect());
  expect(orphans).toEqual([]);
});

test("another org cannot read a package or apply it", async () => {
  const { t, ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });

  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  expect(await asB.query(api.equipmentPackages.list, {})).toEqual([]);
  await expect(
    asB.mutation(api.equipmentPackages.applyToProject, {
      packageId: pkgId,
      projectId: ids.project,
    }),
  ).rejects.toThrow(/Package not found/);
});
