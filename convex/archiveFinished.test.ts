/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const org = await t.run(async (ctx) =>
    ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" }),
  );
  return { t, org, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

async function project(t: Awaited<ReturnType<typeof setup>>["t"], org: string, name: string, dates: number[]) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("projects", {
      orgId: org as never,
      name,
      status: "confirmed",
    });
    for (const offset of dates) {
      await ctx.db.insert("shootDays", {
        orgId: org as never,
        projectId: id,
        date: day(offset),
        locationIds: [],
      });
    }
    return id;
  });
}

test("a production whose shoot has passed archives itself", async () => {
  const { t, org, asA } = await setup();
  await project(t, org, "Wrapped", [-5, -3]);

  const result = await t.mutation(internal.projects.archiveFinished, {});
  expect(result.archived).toBe(1);

  const active = await asA.query(api.projects.list, {});
  expect(active.map((p) => p.name)).toEqual([]);
  const archived = await asA.query(api.projects.list, { archivedOnly: true });
  expect(archived.map((p) => p.name)).toEqual(["Wrapped"]);
});

test("a shoot still to come is left alone", async () => {
  const { t, org, asA } = await setup();
  await project(t, org, "Next week", [3, 4]);

  await t.mutation(internal.projects.archiveFinished, {});

  const active = await asA.query(api.projects.list, {});
  expect(active.map((p) => p.name)).toEqual(["Next week"]);
});

test("a shoot part way through is left alone until its last day", async () => {
  const { t, org, asA } = await setup();
  // Started on Monday, still running on Friday: the first day has passed but
  // the job has not.
  await project(t, org, "Mid shoot", [-2, 2]);

  await t.mutation(internal.projects.archiveFinished, {});

  const active = await asA.query(api.projects.list, {});
  expect(active.map((p) => p.name)).toEqual(["Mid shoot"]);
});

test("a production with no dates has nothing that can have passed", async () => {
  const { t, org, asA } = await setup();
  await project(t, org, "Enquiry", []);

  const result = await t.mutation(internal.projects.archiveFinished, {});
  expect(result.archived).toBe(0);

  const active = await asA.query(api.projects.list, {});
  expect(active.map((p) => p.name)).toEqual(["Enquiry"]);
});

test("running twice does not re-archive what is already away", async () => {
  const { t, org } = await setup();
  await project(t, org, "Wrapped", [-5]);

  expect((await t.mutation(internal.projects.archiveFinished, {})).archived).toBe(1);
  expect((await t.mutation(internal.projects.archiveFinished, {})).archived).toBe(0);
});
