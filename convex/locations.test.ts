/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  return {
    t,
    asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }),
    asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }),
  };
}

test("create and list locations, org-isolated", async () => {
  const { asA, asB } = await setup();
  await asA.mutation(api.locations.create, {
    name: "Studio 1",
    address: "1 High St, Tunbridge Wells",
  });
  expect(await asA.query(api.locations.list, {})).toHaveLength(1);
  expect(await asB.query(api.locations.list, {})).toHaveLength(0);
});

test("update rejects cross-org access", async () => {
  const { asA, asB } = await setup();
  const id = await asA.mutation(api.locations.create, {
    name: "Studio 1",
    address: "1 High St",
  });
  await expect(
    asB.mutation(api.locations.update, { id, name: "Hijacked" })
  ).rejects.toThrow("Location not found");
});

test("geocode rejects cross-org access", async () => {
  const { asA, asB } = await setup();
  const id = await asA.mutation(api.locations.create, {
    name: "Studio 1",
    address: "1 High St, Tunbridge Wells",
  });
  // Tenancy fails inside getForGeocode before any network call happens.
  await expect(asB.action(api.locations.geocode, { id })).rejects.toThrow(
    "Location not found"
  );
});

test("archive hides from list", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.locations.create, { name: "S1", address: "A" });
  await asA.mutation(api.locations.archive, { id });
  expect(await asA.query(api.locations.list, {})).toHaveLength(0);
});

test("create and update persist the new logistics fields", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.locations.create, {
    name: "Bermondsey Loft",
    address: "3 Tanner St, London SE1 3LE",
    satNav: "SE1 3JT",
    publicTransport: "London Bridge 10 min walk",
    nearestPoliceStation: "Southwark Police Station",
  });
  const created = await asA.query(api.locations.get, { id });
  expect(created?.satNav).toBe("SE1 3JT");
  await asA.mutation(api.locations.update, { id, publicTransport: "Bermondsey tube 20 min" });
  const updated = await asA.query(api.locations.get, { id });
  expect(updated?.publicTransport).toBe("Bermondsey tube 20 min");
  expect(updated?.nearestPoliceStation).toBe("Southwark Police Station");
});

test("the nearest Tube and National Rail station are kept apart, and can be corrected or cleared", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.locations.create, {
    name: "BBC TV Centre",
    address: "101 Wood Lane, London W12 7FA",
    nearestTube: "  White City (Central line), 6 min walk ",
    nearestRail: "",
  });
  let saved = await asA.query(api.locations.get, { id });
  expect(saved?.nearestTube).toBe("White City (Central line), 6 min walk");
  expect(saved?.nearestRail).toBeUndefined();

  await asA.mutation(api.locations.update, { id, nearestRail: "Shepherd's Bush, 12 min walk" });
  saved = await asA.query(api.locations.get, { id });
  expect(saved?.nearestRail).toBe("Shepherd's Bush, 12 min walk");

  // A blank clears a wrong answer rather than keeping it.
  await asA.mutation(api.locations.update, { id, nearestTube: "   " });
  saved = await asA.query(api.locations.get, { id });
  expect(saved?.nearestTube).toBeUndefined();
  expect(saved?.nearestRail).toBe("Shepherd's Bush, 12 min walk");
});
