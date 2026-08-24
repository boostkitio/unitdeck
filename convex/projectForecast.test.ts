/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/** Shoot dates relative to today, so the tests do not rot. */
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const location = await ctx.db.insert("locations", {
      orgId: org,
      name: "Shoreditch studio",
      address: "1 Curtain Road, London",
      lat: 51.5245,
      lng: -0.0787,
    });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
      locationId: location,
    });
    return { org, project, location };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

type Ids = Awaited<ReturnType<typeof setup>>["ids"];

async function addShootDay(
  t: Awaited<ReturnType<typeof setup>>["t"],
  ids: Ids,
  date: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("shootDays", {
      orgId: ids.org,
      projectId: ids.project,
      date,
      locationIds: [],
    });
  });
}

test("the header reports on the next shoot day still to come", async () => {
  const { t, ids, asA } = await setup();
  await addShootDay(t, ids, isoDaysFromNow(-5));
  await addShootDay(t, ids, isoDaysFromNow(3));
  await addShootDay(t, ids, isoDaysFromNow(9));

  const project = await asA.query(api.projects.get, { id: ids.project });
  // Not the earliest date on the project — the one it is heading into.
  expect(project?.forecastDate).toBe(isoDaysFromNow(3));
});

test("a finished shoot reports on its last day rather than nothing", async () => {
  const { t, ids, asA } = await setup();
  await addShootDay(t, ids, isoDaysFromNow(-10));
  await addShootDay(t, ids, isoDaysFromNow(-4));

  const project = await asA.query(api.projects.get, { id: ids.project });
  expect(project?.forecastDate).toBe(isoDaysFromNow(-4));
});

test("a project with no shoot dates has nothing to report on", async () => {
  const { ids, asA } = await setup();
  const project = await asA.query(api.projects.get, { id: ids.project });
  expect(project?.forecastDate).toBeNull();
});

test("a location without coordinates cannot be asked about", async () => {
  const { t, ids, asA } = await setup();
  await addShootDay(t, ids, isoDaysFromNow(2));
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.location, { lat: undefined, lng: undefined });
  });

  const project = await asA.query(api.projects.get, { id: ids.project });
  expect(project?.forecastDate).toBe(isoDaysFromNow(2));
  // The date is known, but there is nowhere to ask about, so no lookup runs.
  expect(project?.forecastLocationId).toBeNull();
});

test("another org cannot read a project's forecast target", async () => {
  const { t, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  expect(await asB.query(api.projects.get, { id: ids.project })).toBeNull();
});
