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

test("archive hides from list", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.locations.create, { name: "S1", address: "A" });
  await asA.mutation(api.locations.archive, { id });
  expect(await asA.query(api.locations.list, {})).toHaveLength(0);
});
