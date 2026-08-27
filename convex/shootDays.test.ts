/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const orgB = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "P1",
      status: "pre_production",
    });
    return { orgA, orgB, projectA };
  });
  return {
    t,
    ids,
    asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }),
    asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }),
  };
}

test("create and list shoot days for a project", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.shootDays.create, {
    projectId: ids.projectA,
    date: "2026-06-20",
    label: "Day 1",
    locationIds: [],
  });
  const days = await asA.query(api.shootDays.listForProject, { projectId: ids.projectA });
  expect(days).toHaveLength(1);
  expect(days[0].date).toBe("2026-06-20");
});

test("rejects invalid date format", async () => {
  const { asA, ids } = await setup();
  await expect(
    asA.mutation(api.shootDays.create, {
      projectId: ids.projectA,
      date: "20/06/2026",
      locationIds: [],
    })
  ).rejects.toThrow("Date must be YYYY-MM-DD");
});

test("cross-org project is rejected", async () => {
  const { asB, ids } = await setup();
  await expect(
    asB.mutation(api.shootDays.create, {
      projectId: ids.projectA,
      date: "2026-06-20",
      locationIds: [],
    })
  ).rejects.toThrow("Project not found");
});

test("a shoot day takes a call and a wrap time, and gives them back up", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org T", clerkOrgId: "org_t" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    const day = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: "2026-09-14",
      locationIds: [],
    });
    return { project, day };
  });
  const asT = t.withIdentity({ subject: "user_t", org_id: "org_t" });

  await asT.mutation(api.shootDays.update, {
    id: ids.day,
    callTime: "07:30",
    wrapTime: "19:00",
  });
  let days = await asT.query(api.shootDays.listForProject, { projectId: ids.project });
  expect(days[0].callTime).toBe("07:30");
  expect(days[0].wrapTime).toBe("19:00");

  // Emptying the box clears the time rather than storing "".
  await asT.mutation(api.shootDays.update, { id: ids.day, wrapTime: "" });
  days = await asT.query(api.shootDays.listForProject, { projectId: ids.project });
  expect(days[0].callTime).toBe("07:30");
  expect(days[0].wrapTime).toBeUndefined();
});

test("a time that is not a time is refused", async () => {
  const t = convexTest(schema, modules);
  const dayId = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org U", clerkOrgId: "org_u" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    return await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: "2026-09-14",
      locationIds: [],
    });
  });
  const asU = t.withIdentity({ subject: "user_u", org_id: "org_u" });

  await expect(
    asU.mutation(api.shootDays.update, { id: dayId, callTime: "half seven" })
  ).rejects.toThrow("HH:MM");
  await expect(
    asU.mutation(api.shootDays.update, { id: dayId, callTime: "25:00" })
  ).rejects.toThrow("HH:MM");
});
