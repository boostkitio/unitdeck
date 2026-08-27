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
    const other = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    const tesco = await ctx.db.insert("projects", {
      orgId: org,
      name: "Tesco spot",
      status: "confirmed",
      jobNumber: "KLX-0042",
    });
    const newJob = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pre_production",
    });
    const theirs = await ctx.db.insert("projects", {
      orgId: other,
      name: "Someone else's job",
      status: "confirmed",
    });
    return { org, other, tesco, newJob, theirs };
  });
  return {
    t,
    ids,
    asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }),
    asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }),
  };
}

/** Puts a kit list on the Tesco job: one owned line, one still to be hired. */
async function stockTesco(asA: Awaited<ReturnType<typeof setup>>["asA"], tesco: string) {
  await asA.mutation(api.projectEquipment.add, {
    projectId: tesco as never,
    item: "Sony FX9",
    dept: "Camera",
    quantity: 1,
    section: "equipment",
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: tesco as never,
    item: "1.2k HMI",
    section: "additional",
    cost: 180,
  });
}

test("a production with kit on it can be copied from", async () => {
  const { ids, asA } = await setup();
  await stockTesco(asA, ids.tesco);

  const options = await asA.query(api.projectEquipment.projectsWithKit, {
    exclude: ids.newJob,
  });
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({
    _id: ids.tesco,
    name: "Tesco spot",
    jobNumber: "KLX-0042",
    itemCount: 2,
  });
  expect(options[0].preview).toEqual(["Sony FX9", "1.2k HMI"]);
});

test("a production with no kit is not offered, and nor is this one", async () => {
  const { ids, asA } = await setup();
  await stockTesco(asA, ids.tesco);
  // The job being added to has kit of its own, and still must not list itself.
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.newJob,
    item: "Tripod",
  });

  const options = await asA.query(api.projectEquipment.projectsWithKit, {
    exclude: ids.newJob,
  });
  expect(options.map((o) => o.name)).toEqual(["Tesco spot"]);
});

test("add all brings the whole list across, keeping section and status", async () => {
  const { ids, asA } = await setup();
  await stockTesco(asA, ids.tesco);

  const result = await asA.mutation(api.projectEquipment.copyFromProject, {
    projectId: ids.newJob,
    fromProjectId: ids.tesco,
  });
  expect(result).toEqual({ added: 2, fromName: "Tesco spot" });

  const rows = await asA.query(api.projectEquipment.listForProject, {
    projectId: ids.newJob,
  });
  expect(rows).toHaveLength(2);
  // Owned kit stays confirmed on the equipment list; a hire-in stays needed
  // on the additional list, because it is still to be sourced here too.
  expect(rows.map((r) => [r.item, r.section, r.status])).toEqual([
    ["Sony FX9", "equipment", "confirmed"],
    ["1.2k HMI", "additional", "needed"],
  ]);
  expect(rows[1].cost).toBe(180);
});

test("copying leaves the production it came from untouched", async () => {
  const { ids, asA } = await setup();
  await stockTesco(asA, ids.tesco);

  await asA.mutation(api.projectEquipment.copyFromProject, {
    projectId: ids.newJob,
    fromProjectId: ids.tesco,
  });

  const source = await asA.query(api.projectEquipment.listForProject, {
    projectId: ids.tesco,
  });
  expect(source).toHaveLength(2);
});

test("one line can be taken rather than the lot", async () => {
  const { ids, asA } = await setup();
  await stockTesco(asA, ids.tesco);
  const source = await asA.query(api.projectEquipment.listForProject, {
    projectId: ids.tesco,
  });
  const fx9 = source.find((r) => r.item === "Sony FX9")!;

  const result = await asA.mutation(api.projectEquipment.copyFromProject, {
    projectId: ids.newJob,
    fromProjectId: ids.tesco,
    lineIds: [fx9._id],
  });
  expect(result.added).toBe(1);

  const rows = await asA.query(api.projectEquipment.listForProject, {
    projectId: ids.newJob,
  });
  expect(rows.map((r) => r.item)).toEqual(["Sony FX9"]);
});

// A line that tracks a package changes when the package changes. Somebody
// copying a production asked for what that job had, not for a subscription to
// a package they never chose.
test("a copied line does not inherit the package it came from", async () => {
  const { t, ids, asA } = await setup();
  const packageItemId = await t.run(async (ctx) => {
    const pkg = await ctx.db.insert("equipmentPackages", {
      orgId: ids.org,
      name: "Doc kit",
    });
    const item = await ctx.db.insert("equipmentPackageItems", {
      orgId: ids.org,
      packageId: pkg,
      item: "Sony FX9",
    });
    await ctx.db.insert("projectEquipment", {
      orgId: ids.org,
      projectId: ids.tesco,
      item: "Sony FX9",
      status: "confirmed",
      section: "equipment",
      packageItemId: item,
    });
    return item;
  });

  await asA.mutation(api.projectEquipment.copyFromProject, {
    projectId: ids.newJob,
    fromProjectId: ids.tesco,
  });

  const copied = await t.run(async (ctx) =>
    ctx.db
      .query("projectEquipment")
      .withIndex("by_project", (q) => q.eq("projectId", ids.newJob))
      .collect()
  );
  expect(copied).toHaveLength(1);
  expect(copied[0].item).toBe("Sony FX9");
  expect(copied[0].packageItemId).toBeUndefined();

  // And the source still tracks it, so nothing was taken away from that job.
  const source = await t.run(async (ctx) =>
    ctx.db
      .query("projectEquipment")
      .withIndex("by_package_item", (q) => q.eq("packageItemId", packageItemId))
      .collect()
  );
  expect(source).toHaveLength(1);
});

test("a production cannot be copied onto itself", async () => {
  const { ids, asA } = await setup();
  await stockTesco(asA, ids.tesco);
  await expect(
    asA.mutation(api.projectEquipment.copyFromProject, {
      projectId: ids.tesco,
      fromProjectId: ids.tesco,
    })
  ).rejects.toThrow(/same production/i);
});

test("kit cannot be copied across accounts", async () => {
  const { ids, asA, asB } = await setup();
  await stockTesco(asA, ids.tesco);

  // Another account cannot see the job in the picker...
  expect(await asB.query(api.projectEquipment.projectsWithKit, {})).toEqual([]);
  // ...nor name it as a source.
  await expect(
    asB.mutation(api.projectEquipment.copyFromProject, {
      projectId: ids.theirs,
      fromProjectId: ids.tesco,
    })
  ).rejects.toThrow(/not found/i);
});
