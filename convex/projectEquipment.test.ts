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
