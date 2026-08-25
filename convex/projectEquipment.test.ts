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
      status: "pre_production",
    });
    return { org, project };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("equipment starts as needed and can be confirmed", async () => {
  const { ids, asA } = await setup();

  const id = await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "Ronin gimbal",
    quantity: 2,
  });

  let rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ item: "Ronin gimbal", quantity: 2, status: "needed" });

  await asA.mutation(api.projectEquipment.update, { id, status: "confirmed" });
  rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0].status).toBe("confirmed");
});

test("an added item defaults to the hire-in list, still needed", async () => {
  const { ids, asA } = await setup();

  await asA.mutation(api.projectEquipment.add, { projectId: ids.project, item: "1.2k HMI" });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0]).toMatchObject({ section: "additional", status: "needed" });
});

test("kit added to the standard list lands confirmed", async () => {
  const { ids, asA } = await setup();

  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "Sony FX9",
    section: "equipment",
  });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  // It is your own kit — nothing to chase.
  expect(rows[0]).toMatchObject({ section: "equipment", status: "confirmed" });
});

test("a line can be moved between the two lists", async () => {
  const { ids, asA } = await setup();

  const id = await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "Ronin gimbal",
  });
  await asA.mutation(api.projectEquipment.update, { id, section: "equipment" });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0].section).toBe("equipment");
});

test("a row written before the split reads as additional", async () => {
  const { t, ids, asA } = await setup();

  // No section field at all, as older rows have.
  await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    await ctx.db.insert("projectEquipment", {
      orgId: project.orgId,
      projectId: ids.project,
      item: "Walkie set",
      status: "needed",
    });
  });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0].section).toBe("additional");
});

test("a blank item or a quantity below one is rejected", async () => {
  const { ids, asA } = await setup();

  await expect(
    asA.mutation(api.projectEquipment.add, { projectId: ids.project, item: "   " }),
  ).rejects.toThrow(/Name the equipment/);

  await expect(
    asA.mutation(api.projectEquipment.add, {
      projectId: ids.project,
      item: "Tripod",
      quantity: 0,
    }),
  ).rejects.toThrow(/at least 1/);

  expect(
    await asA.query(api.projectEquipment.listForProject, { projectId: ids.project }),
  ).toEqual([]);
});

test("clearing the quantity leaves the item in place", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "Walkie set",
    quantity: 6,
  });

  await asA.mutation(api.projectEquipment.update, { id, quantity: null });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0].item).toBe("Walkie set");
  expect(rows[0].quantity).toBeUndefined();
});

test("another org cannot see or change a project's equipment", async () => {
  const { t, ids, asA } = await setup();
  const id = await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "Ronin gimbal",
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  expect(
    await asB.query(api.projectEquipment.listForProject, { projectId: ids.project }),
  ).toEqual([]);
  await expect(
    asB.mutation(api.projectEquipment.update, { id, status: "confirmed" }),
  ).rejects.toThrow();
  await expect(asB.mutation(api.projectEquipment.remove, { id })).rejects.toThrow();
});

test("kit picked from the inventory names itself and brings its department", async () => {
  const { t, ids, asA } = await setup();
  const equipmentId = await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    return await ctx.db.insert("equipment", {
      orgId: project.orgId,
      item: "Sony FX9",
      dept: "Camera",
      serialNumber: "FX9-001",
    });
  });

  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId,
    section: "equipment",
  });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  // No name typed: it comes from the kit, department and all.
  expect(rows[0]).toMatchObject({
    item: "Sony FX9",
    dept: "Camera",
    equipmentId,
    section: "equipment",
    status: "confirmed",
  });
});

test("a typed name wins over the inventory one", async () => {
  const { t, ids, asA } = await setup();
  const equipmentId = await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    return await ctx.db.insert("equipment", { orgId: project.orgId, item: "Sony FX9" });
  });

  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId,
    item: "Sony FX9 (B camera)",
  });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0].item).toBe("Sony FX9 (B camera)");
});

test("a line still needs a name when there is no kit to take one from", async () => {
  const { ids, asA } = await setup();
  await expect(
    asA.mutation(api.projectEquipment.add, { projectId: ids.project }),
  ).rejects.toThrow(/Name the equipment/);
});

test("another org's kit cannot be added to a project", async () => {
  const { t, ids, asA } = await setup();
  const theirs = await t.run(async (ctx) => {
    const orgB = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    return await ctx.db.insert("equipment", { orgId: orgB, item: "Their FX9" });
  });

  await expect(
    asA.mutation(api.projectEquipment.add, { projectId: ids.project, equipmentId: theirs }),
  ).rejects.toThrow(/Equipment not found/);
});
