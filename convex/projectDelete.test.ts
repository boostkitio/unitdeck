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
    const person = await ctx.db.insert("people", { orgId: org, name: "Sam Reed", role: "Gaffer" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
      archived: true,
    });
    await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: "2026-09-01",
      locationIds: [],
    });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: project, personId: person });
    await ctx.db.insert("projectEquipment", {
      orgId: org,
      projectId: project,
      item: "Sony FX9",
      status: "confirmed",
    });
    return { org, project, person };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("deleting an archived project takes everything that belongs only to it", async () => {
  const { t, ids, asA } = await setup();

  const result = await asA.mutation(api.projects.remove, { id: ids.project });

  // The project, its shoot day, its crew booking and its equipment line.
  expect(result.deleted).toBe(4);
  expect(await t.run(async (ctx) => await ctx.db.get(ids.project))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.query("shootDays").collect())).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.query("projectCrew").collect())).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.query("projectEquipment").collect())).toEqual([]);
});

test("company records survive the project being deleted", async () => {
  const { t, ids, asA } = await setup();

  await asA.mutation(api.projects.remove, { id: ids.project });

  // The person was booked on the job; they do not belong to it.
  expect(await t.run(async (ctx) => await ctx.db.get(ids.person))).not.toBeNull();
});

test("a live project cannot be deleted without archiving it first", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => await ctx.db.patch(ids.project, { archived: false }));

  await expect(asA.mutation(api.projects.remove, { id: ids.project })).rejects.toThrow(
    /Archive the project before deleting it/,
  );
  expect(await t.run(async (ctx) => await ctx.db.get(ids.project))).not.toBeNull();
});

test("another org cannot delete this project", async () => {
  const { t, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  await expect(asB.mutation(api.projects.remove, { id: ids.project })).rejects.toThrow(
    /Project not found/,
  );
});
