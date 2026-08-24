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
  expect(result).toMatchObject({ added: 2, packageName: "Camera package" });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item).sort()).toEqual(["Sony FX9", "Tripod"]);
  expect(kit.find((row) => row.item === "Tripod")?.quantity).toBe(2);
  // It is kit you own and have just committed to the job, so it lands
  // confirmed, in the standard equipment list rather than the hire-in one.
  expect(kit.every((row) => row.status === "confirmed")).toBe(true);
  expect(kit.every((row) => row.section === "equipment")).toBe(true);
});

test("kit from the inventory brings its department onto the project", async () => {
  const { t, ids, asA } = await setup();
  const equipmentId = await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    return await ctx.db.insert("equipment", {
      orgId: project.orgId,
      item: "Sony FX9",
      dept: "Camera",
    });
  });
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, equipmentId });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "1.2k HMI" });

  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.find((row) => row.item === "Sony FX9")?.dept).toBe("Camera");
  // A hired-in line has no inventory record to take a department from.
  expect(kit.find((row) => row.item === "1.2k HMI")?.dept).toBeUndefined();
});

test("a package with two of the same item lists both", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  // Two identical bodies are two pieces of kit, not one.
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });

  const result = await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  expect(result.added).toBe(2);
  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item)).toEqual(["Sony FX9", "Sony FX9"]);
});

test("applying twice lists the kit twice rather than swallowing the second run", async () => {
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

  expect(second).toMatchObject({ added: 1 });
  expect(
    await asA.query(api.projectEquipment.listForProject, { projectId: ids.project }),
  ).toHaveLength(2);
});

test("a project's package kit follows the package it came from", async () => {
  // This replaces an earlier test asserting the opposite. The kit list used to
  // be a snapshot; a package is a live definition of a setup, so a change to
  // it is meant to reach the productions using it.
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

  await asA.mutation(api.equipmentPackages.removeItem, { id: itemId });
  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit).toEqual([]);
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

test("adding kit to a package adds it to the projects carrying that package", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });
  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Tripod" });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item).sort()).toEqual(["Sony FX9", "Tripod"]);
  expect(kit.find((row) => row.item === "Tripod")?.status).toBe("confirmed");
});

test("removing kit from a package removes it from those projects", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  const itemId = await asA.mutation(api.equipmentPackages.addItem, {
    packageId: pkgId,
    item: "Sony FX9",
  });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Tripod" });
  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  await asA.mutation(api.equipmentPackages.removeItem, { id: itemId });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item)).toEqual(["Tripod"]);
});

test("renaming a package updates where its kit says it came from", async () => {
  const { ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });
  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  await asA.mutation(api.equipmentPackages.update, { id: pkgId, name: "A-cam package" });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit[0].notes).toBe("From A-cam package");
});

test("an archived project keeps the kit list it went out with", async () => {
  const { t, ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  const itemId = await asA.mutation(api.equipmentPackages.addItem, {
    packageId: pkgId,
    item: "Sony FX9",
  });
  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });
  await t.run(async (ctx) => await ctx.db.patch(ids.project, { archived: true }));

  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Tripod" });
  await asA.mutation(api.equipmentPackages.removeItem, { id: itemId });

  // The record of what actually went out is not rewritten after the fact.
  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item)).toEqual(["Sony FX9"]);
});

test("deleting a package leaves the kit on projects but cuts the link", async () => {
  const { t, ids, asA } = await setup();
  const pkgId = await asA.mutation(api.equipmentPackages.create, { name: "Camera package" });
  await asA.mutation(api.equipmentPackages.addItem, { packageId: pkgId, item: "Sony FX9" });
  await asA.mutation(api.equipmentPackages.applyToProject, {
    packageId: pkgId,
    projectId: ids.project,
  });

  await asA.mutation(api.equipmentPackages.remove, { id: pkgId });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item)).toEqual(["Sony FX9"]);
  const raw = await t.run(async (ctx) => await ctx.db.query("projectEquipment").collect());
  expect(raw[0].packageId).toBeUndefined();
  expect(raw[0].packageItemId).toBeUndefined();
});

test("a package change does not touch kit added to a project by hand", async () => {
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
  await asA.mutation(api.projectEquipment.add, { projectId: ids.project, item: "1.2k HMI" });

  await asA.mutation(api.equipmentPackages.removeItem, { id: itemId });

  const kit = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(kit.map((row) => row.item)).toEqual(["1.2k HMI"]);
});
