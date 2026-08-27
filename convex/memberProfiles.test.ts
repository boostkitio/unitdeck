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
    asMatt: t.withIdentity({ subject: "user_matt", org_id: "org_a" }),
    asCharlie: t.withIdentity({ subject: "user_charlie", org_id: "org_a" }),
    asOutsider: t.withIdentity({ subject: "user_outsider", org_id: "org_b" }),
  };
}

test("a name set here comes back, which Clerk would not have allowed", async () => {
  const { asMatt } = await setup();
  await asMatt.mutation(api.memberProfiles.setName, {
    firstName: "Matt",
    lastName: "West",
  });

  expect(await asMatt.query(api.memberProfiles.mine, {})).toEqual({
    userId: "user_matt",
    firstName: "Matt",
    lastName: "West",
  });
});

test("nobody has a name until they set one", async () => {
  const { asMatt } = await setup();
  expect(await asMatt.query(api.memberProfiles.mine, {})).toBeNull();
});

test("saving twice edits the one row rather than stacking up a second", async () => {
  const { t, asMatt } = await setup();
  await asMatt.mutation(api.memberProfiles.setName, { firstName: "Mat", lastName: "West" });
  await asMatt.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });

  const rows = await t.run((ctx) => ctx.db.query("memberProfiles").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].firstName).toBe("Matt");
});

test("a blank field is stored as absent, so the login's name can still show", async () => {
  const { t, asMatt } = await setup();
  await asMatt.mutation(api.memberProfiles.setName, { firstName: "  ", lastName: "  " });

  const rows = await t.run((ctx) => ctx.db.query("memberProfiles").collect());
  expect(rows[0].firstName).toBeUndefined();
  expect(rows[0].lastName).toBeUndefined();
});

test("everyone on the account can read everyone's name, to resolve an owner", async () => {
  const { asMatt, asCharlie } = await setup();
  await asMatt.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });
  await asCharlie.mutation(api.memberProfiles.setName, {
    firstName: "Charlie",
    lastName: "Producer",
  });

  const everyone = await asCharlie.query(api.memberProfiles.listForOrg, {});
  expect(everyone.map((p) => p.userId).sort()).toEqual(["user_charlie", "user_matt"]);
});

// The user id is taken from the token, never from an argument, so there is no
// shape of call that renames somebody else.
test("saving a name only ever writes your own", async () => {
  const { t, asMatt, asCharlie } = await setup();
  await asMatt.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });
  await asCharlie.mutation(api.memberProfiles.setName, { firstName: "Charlie", lastName: "P" });

  const rows = await t.run((ctx) => ctx.db.query("memberProfiles").collect());
  expect(
    Object.fromEntries(rows.map((r) => [r.userId, r.firstName]))
  ).toEqual({ user_matt: "Matt", user_charlie: "Charlie" });
});

test("a name does not cross to another account", async () => {
  const { asMatt, asOutsider } = await setup();
  await asMatt.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });

  expect(await asOutsider.query(api.memberProfiles.listForOrg, {})).toEqual([]);
  expect(await asOutsider.query(api.memberProfiles.mine, {})).toBeNull();
});

test("signed out, a name is neither readable nor writable", async () => {
  const { t } = await setup();
  await expect(t.query(api.memberProfiles.listForOrg, {})).rejects.toThrow(/authenticated/i);
  await expect(
    t.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" })
  ).rejects.toThrow(/authenticated/i);
});
