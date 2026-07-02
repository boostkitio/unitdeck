/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Set-mode links expire 7 days after the shoot date, so fixtures must use a
// relative date; a hardcoded literal rots into "This link has expired".
const NEAR_FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

async function setupSent(date = NEAR_FUTURE) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "Brand film",
      status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date,
      locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ name: "Sam", role: "Sound", email: "sam@example.test", callTime: "07:30" }],
  });
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  return { t, ids, asA, token: recipients[0].token };
}

test("getByToken returns sheet data and recipient, without org internals", async () => {
  const { t, token } = await setupSent();
  const result = await t.query(api.setMode.getByToken, { token });
  expect(result).not.toBeNull();
  if (!result || result.expired) throw new Error("expected live payload");
  expect(result.data.title).toBe("Brand film");
  expect(result.recipient.name).toBe("Sam");
  expect(result.recipient.callTime).toBe("07:30");
  expect("orgId" in result.recipient).toBe(false);
});

test("unknown token returns null", async () => {
  const { t } = await setupSent();
  expect(await t.query(api.setMode.getByToken, { token: "nope" })).toBeNull();
});

test("link expires 7 days after the shoot date", async () => {
  const { t, token } = await setupSent("2020-01-01");
  const result = await t.query(api.setMode.getByToken, { token });
  expect(result).toEqual({ expired: true });
});

test("confirm and decline transitions stamp times and are idempotent", async () => {
  const { t, asA, ids, token } = await setupSent();
  await t.mutation(api.setMode.markViewed, { token });
  await t.mutation(api.setMode.confirm, { token });
  await t.mutation(api.setMode.confirm, { token }); // second call is a no-op
  let list = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(list[0].status).toBe("confirmed");
  expect(list[0].viewedAt).toBeDefined();
  expect(list[0].confirmedAt).toBeDefined();
  await t.mutation(api.setMode.decline, { token }); // crew can change their mind
  list = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(list[0].status).toBe("declined");
});

test("safety ack and check-in stamp once", async () => {
  const { t, asA, ids, token } = await setupSent();
  await t.mutation(api.setMode.ackSafety, { token });
  await t.mutation(api.setMode.checkIn, { token });
  const list = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  const first = { safety: list[0].safetyAckAt, checkIn: list[0].checkInAt };
  expect(first.safety).toBeDefined();
  expect(first.checkIn).toBeDefined();
  await t.mutation(api.setMode.ackSafety, { token });
  await t.mutation(api.setMode.checkIn, { token });
  const again = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(again[0].safetyAckAt).toBe(first.safety); // not re-stamped
  expect(again[0].checkInAt).toBe(first.checkIn);
});
