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
