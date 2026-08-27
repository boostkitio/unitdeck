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
    return { org, project };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("a job that moves keeps a hotel per stay", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.accommodation.add, {
    projectId: ids.project,
    name: "Premier Inn",
    nights: 3,
    bookingRef: "PI-4471",
  });
  await asA.mutation(api.accommodation.add, {
    projectId: ids.project,
    name: "Ibis",
    nights: 2,
    bookingRef: "IB-9910",
  });

  const stays = await asA.query(api.accommodation.listForProject, { projectId: ids.project });
  expect(stays.map((s) => s.name)).toEqual(["Premier Inn", "Ibis"]);
  expect(stays.map((s) => s.nights)).toEqual([3, 2]);
  expect(stays.map((s) => s.bookingRef)).toEqual(["PI-4471", "IB-9910"]);
});

test("a hotel needs a name", async () => {
  const { ids, asA } = await setup();
  await expect(
    asA.mutation(api.accommodation.add, { projectId: ids.project, name: "   " }),
  ).rejects.toThrow(/which hotel/i);
});

test("a field cleared in the form is stored as absent, not as an empty line", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.accommodation.add, {
    projectId: ids.project,
    name: "Premier Inn",
    phone: "01632 960000",
  });

  await asA.mutation(api.accommodation.update, { id, phone: "  " });

  const stays = await asA.query(api.accommodation.listForProject, { projectId: ids.project });
  expect(stays[0].phone).toBeUndefined();
});

test("nights left blank is not the same as nought nights", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.accommodation.add, { projectId: ids.project, name: "Premier Inn" });

  const stays = await asA.query(api.accommodation.listForProject, { projectId: ids.project });
  expect(stays[0].nights).toBeUndefined();
});

test("another organisation's hotels are not on this production", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const other = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    await ctx.db.insert("accommodation", {
      orgId: other,
      projectId: ids.project,
      name: "Somewhere else",
    });
  });

  const stays = await asA.query(api.accommodation.listForProject, { projectId: ids.project });
  expect(stays.map((s) => s.name)).toEqual([]);
});
