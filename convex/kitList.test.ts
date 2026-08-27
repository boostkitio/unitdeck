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
      status: "confirmed",
    });
    const fx9 = await ctx.db.insert("equipment", {
      orgId: org,
      item: "Sony FX9",
      dept: "Camera",
      serialNumber: "FX9-11482",
    });
    return { org, project, fx9 };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("a line picked from the inventory carries its serial", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: ids.fx9,
  });

  const list = (await asA.query(api.projectEquipment.kitList, { projectId: ids.project }))!;
  expect(list.items[0].serialNumber).toBe("FX9-11482");
});

test("a line typed by name still finds the serial of the thing it names", async () => {
  const { t, ids, asA } = await setup();
  // No equipmentId — how rows written before the link existed look, and how
  // anything typed by hand looks. The kit is still ours and still has a
  // serial, so the list has no business pretending otherwise.
  await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    await ctx.db.insert("projectEquipment", {
      orgId: project.orgId,
      projectId: ids.project,
      item: "  sony fx9 ",
      status: "confirmed",
    });
  });

  const list = (await asA.query(api.projectEquipment.kitList, { projectId: ids.project }))!;
  expect(list.items[0].serialNumber).toBe("FX9-11482");
});

test("two of the same thing cannot say which serial went out", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    await ctx.db.insert("equipment", {
      orgId: project.orgId,
      item: "Sony FX9",
      serialNumber: "FX9-22913",
    });
    await ctx.db.insert("projectEquipment", {
      orgId: project.orgId,
      projectId: ids.project,
      item: "Sony FX9",
      status: "confirmed",
    });
  });

  const list = (await asA.query(api.projectEquipment.kitList, { projectId: ids.project }))!;
  // Guessing one of two would print a serial that may not be the unit that
  // left the building.
  expect(list.items[0].serialNumber).toBeNull();
});

test("kit we do not own has no serial to find", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    await ctx.db.insert("projectEquipment", {
      orgId: project.orgId,
      projectId: ids.project,
      item: "Angenieux Optimo 24-290",
      status: "confirmed",
    });
  });

  const list = (await asA.query(api.projectEquipment.kitList, { projectId: ids.project }))!;
  expect(list.items[0].serialNumber).toBeNull();
});
