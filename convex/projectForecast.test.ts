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

test("a location without coordinates is still asked about", async () => {
  const { t, ids, asA } = await setup();
  await addShootDay(t, ids, isoDaysFromNow(2));
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.location, { lat: undefined, lng: undefined });
  });

  const project = await asA.query(api.projects.get, { id: ids.project });
  expect(project?.forecastDate).toBe(isoDaysFromNow(2));
  // It has an address, and looking that up is the forecast's job. Refusing
  // here is what left a located project checking forever.
  expect(project?.forecastLocationId).toBe(ids.location);
});

test("a project with no location has nowhere to ask about", async () => {
  const { t, ids, asA } = await setup();
  await addShootDay(t, ids, isoDaysFromNow(2));
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.project, { locationId: undefined });
  });

  const project = await asA.query(api.projects.get, { id: ids.project });
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

test("a project is addressable by its job number, and still by its id", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projects.assignJobNumbers, {});

  const byId = await asA.query(api.projects.getByRef, { ref: ids.project });
  expect(byId?.jobNumber).toBe("0001");
  // Links made before job numbers existed still resolve.
  const byNumber = await asA.query(api.projects.getByRef, { ref: "0001" });
  expect(byNumber?._id).toBe(ids.project);
});

test("a reference that is neither a job number nor an id is not found", async () => {
  const { asA } = await setup();
  expect(await asA.query(api.projects.getByRef, { ref: "nonsense" })).toBeNull();
});

test("a new project is given the next job number", async () => {
  const { asA } = await setup();
  await asA.mutation(api.projects.assignJobNumbers, {});

  const second = await asA.mutation(api.projects.create, { name: "Music video" });
  const project = await asA.query(api.projects.get, { id: second });
  expect(project?.jobNumber).toBe("0002");
});

test("two projects cannot share a job number", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projects.assignJobNumbers, {});
  const second = await asA.mutation(api.projects.create, { name: "Music video" });

  await expect(
    asA.mutation(api.projects.update, { id: second, jobNumber: "0001" }),
  ).rejects.toThrow(/already in use/);
  // Setting a project's own number again is not a clash.
  await asA.mutation(api.projects.update, { id: ids.project, jobNumber: "0001" });
});

test("a house numbering scheme is accepted", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projects.update, { id: ids.project, jobNumber: "KLX-0042" });

  expect((await asA.query(api.projects.getByRef, { ref: "KLX-0042" }))?._id).toBe(ids.project);
  // Counting continues from the numeric ones, ignoring the house scheme.
  const next = await asA.mutation(api.projects.create, { name: "Music video" });
  expect((await asA.query(api.projects.get, { id: next }))?.jobNumber).toBe("0001");
});

test("another org cannot resolve this project by reference", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.projects.assignJobNumbers, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  expect(await asB.query(api.projects.getByRef, { ref: "0001" })).toBeNull();
  expect(await asB.query(api.projects.getByRef, { ref: ids.project })).toBeNull();
});
