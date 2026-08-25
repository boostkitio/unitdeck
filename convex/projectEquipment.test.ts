/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

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

/** A second production, so the two can compete for the same kit. */
async function setupClash() {
  const base = await setup();
  const extra = await base.t.run(async (ctx) => {
    const project = (await ctx.db.get(base.ids.project))!;
    const other = await ctx.db.insert("projects", {
      orgId: project.orgId,
      name: "Music video",
      status: "pencilled",
    });
    const fx9 = await ctx.db.insert("equipment", {
      orgId: project.orgId,
      item: "Sony FX9",
      dept: "Camera",
    });
    const tripod = await ctx.db.insert("equipment", {
      orgId: project.orgId,
      item: "Tripod",
      dept: "Grip",
    });
    return { orgId: project.orgId, other, fx9, tripod };
  });
  return { ...base, extra };
}

async function shootOn(
  t: Awaited<ReturnType<typeof setup>>["t"],
  orgId: Id<"organisations">,
  projectId: Id<"projects">,
  date: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("shootDays", { orgId, projectId, date, locationIds: [] });
  });
}

test("kit wanted by two productions on the same day is a clash", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, ids.project, "2026-09-01");
  await shootOn(t, extra.orgId, extra.other, "2026-09-01");
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: extra.fx9,
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: extra.other,
    equipmentId: extra.fx9,
  });

  const clashes = await asA.query(api.projectEquipment.clashesForProject, {
    projectId: ids.project,
  });

  expect(clashes).toHaveLength(1);
  expect(clashes[0].item).toBe("Sony FX9");
  expect(clashes[0].rowId).not.toBeNull();
  expect(clashes[0].others[0]).toMatchObject({
    projectName: "Music video",
    status: "pencilled",
    dates: ["2026-09-01"],
  });
});

test("the same kit on different days is not a clash", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, ids.project, "2026-09-01");
  await shootOn(t, extra.orgId, extra.other, "2026-09-02");
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: extra.fx9,
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: extra.other,
    equipmentId: extra.fx9,
  });

  expect(
    await asA.query(api.projectEquipment.clashesForProject, { projectId: ids.project }),
  ).toEqual([]);
});

test("two hired-in lines with the same name are not a clash", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, ids.project, "2026-09-01");
  await shootOn(t, extra.orgId, extra.other, "2026-09-01");
  // Free text: two shoots hiring the same model of light is normal.
  await asA.mutation(api.projectEquipment.add, { projectId: ids.project, item: "1.2k HMI" });
  await asA.mutation(api.projectEquipment.add, { projectId: extra.other, item: "1.2k HMI" });

  expect(
    await asA.query(api.projectEquipment.clashesForProject, { projectId: ids.project }),
  ).toEqual([]);
});

test("an archived production is not competing for anything", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, ids.project, "2026-09-01");
  await shootOn(t, extra.orgId, extra.other, "2026-09-01");
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: extra.fx9,
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: extra.other,
    equipmentId: extra.fx9,
  });
  await t.run(async (ctx) => await ctx.db.patch(extra.other, { archived: true }));

  expect(
    await asA.query(api.projectEquipment.clashesForProject, { projectId: ids.project }),
  ).toEqual([]);
});

test("kit booked elsewhere is flagged before it is added here", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, ids.project, "2026-09-01");
  await shootOn(t, extra.orgId, extra.other, "2026-09-01");
  // Only the other production has it, so the picker can warn in advance.
  await asA.mutation(api.projectEquipment.add, {
    projectId: extra.other,
    equipmentId: extra.tripod,
  });

  const clashes = await asA.query(api.projectEquipment.clashesForProject, {
    projectId: ids.project,
  });
  expect(clashes).toHaveLength(1);
  expect(clashes[0].item).toBe("Tripod");
  // Nothing to remove here yet: it is a warning, not a double booking.
  expect(clashes[0].rowId).toBeNull();
});

test("a production with no shoot dates cannot clash with anything", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, extra.other, "2026-09-01");
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: extra.fx9,
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: extra.other,
    equipmentId: extra.fx9,
  });

  expect(
    await asA.query(api.projectEquipment.clashesForProject, { projectId: ids.project }),
  ).toEqual([]);
});

test("removeMany clears several lines and ignores another org's", async () => {
  const { t, ids, asA, extra } = await setupClash();
  const a = await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: extra.fx9,
  });
  const b = await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    equipmentId: extra.tripod,
  });
  const theirs = await t.run(async (ctx) => {
    const orgB = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    const proj = await ctx.db.insert("projects", { orgId: orgB, name: "Theirs", status: "confirmed" });
    return await ctx.db.insert("projectEquipment", {
      orgId: orgB,
      projectId: proj,
      item: "Their FX9",
      status: "needed",
    });
  });

  const result = await asA.mutation(api.projectEquipment.removeMany, { ids: [a, b, theirs] });

  expect(result.removed).toBe(2);
  expect(
    await asA.query(api.projectEquipment.listForProject, { projectId: ids.project }),
  ).toEqual([]);
  // The other org's row is untouched.
  const survivor = await t.run(async (ctx) => await ctx.db.get(theirs));
  expect(survivor).not.toBeNull();
});

test("kit listed before the inventory link can be matched up by name", async () => {
  const { t, ids, asA, extra } = await setupClash();
  // A line as it would have been written before equipmentId existed.
  await t.run(async (ctx) => {
    await ctx.db.insert("projectEquipment", {
      orgId: extra.orgId,
      projectId: ids.project,
      item: "sony fx9",
      status: "confirmed",
    });
  });

  expect(await asA.query(api.projectEquipment.unlinkedCount, {})).toBe(1);
  expect(await asA.mutation(api.projectEquipment.linkToInventory, {})).toEqual({ linked: 1 });

  const rows = await asA.query(api.projectEquipment.listForProject, { projectId: ids.project });
  expect(rows[0].equipmentId).toBe(extra.fx9);
  // The department comes across with it.
  expect(rows[0].dept).toBe("Camera");
  expect(await asA.query(api.projectEquipment.unlinkedCount, {})).toBe(0);
});

test("a name two pieces of kit answer to is left alone", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await t.run(async (ctx) => {
    // Two tripods, both called Tripod: guessing which one a line meant would
    // invent a clash between productions each holding their own.
    await ctx.db.insert("equipment", { orgId: extra.orgId, item: "Tripod" });
    await ctx.db.insert("projectEquipment", {
      orgId: extra.orgId,
      projectId: ids.project,
      item: "Tripod",
      status: "confirmed",
    });
  });

  expect(await asA.query(api.projectEquipment.unlinkedCount, {})).toBe(0);
  expect(await asA.mutation(api.projectEquipment.linkToInventory, {})).toEqual({ linked: 0 });
});

test("matching up makes an existing double booking visible", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await shootOn(t, extra.orgId, ids.project, "2026-09-01");
  await shootOn(t, extra.orgId, extra.other, "2026-09-01");
  // Both productions listed the same camera the old way.
  await t.run(async (ctx) => {
    for (const projectId of [ids.project, extra.other]) {
      await ctx.db.insert("projectEquipment", {
        orgId: extra.orgId,
        projectId,
        item: "Sony FX9",
        status: "confirmed",
      });
    }
  });

  // Invisible until the lines are joined to the kit they name.
  expect(
    await asA.query(api.projectEquipment.clashesForProject, { projectId: ids.project }),
  ).toEqual([]);

  await asA.mutation(api.projectEquipment.linkToInventory, {});

  const clashes = await asA.query(api.projectEquipment.clashesForProject, {
    projectId: ids.project,
  });
  expect(clashes).toHaveLength(1);
  expect(clashes[0].rowId).not.toBeNull();
});

test("archived kit is not used for matching", async () => {
  const { t, ids, asA, extra } = await setupClash();
  await t.run(async (ctx) => {
    await ctx.db.patch(extra.fx9, { archived: true });
    await ctx.db.insert("projectEquipment", {
      orgId: extra.orgId,
      projectId: ids.project,
      item: "Sony FX9",
      status: "confirmed",
    });
  });

  expect(await asA.query(api.projectEquipment.unlinkedCount, {})).toBe(0);
});
