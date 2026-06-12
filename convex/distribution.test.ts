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
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "Brand film",
      status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: "2026-06-18",
      locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  return { t, ids, asA };
}

const SAM = { name: "Sam Sound", role: "Sound recordist", email: "sam@example.test", callTime: "07:30" };

test("send freezes the draft as sent and opens a new draft", async () => {
  const { asA, ids } = await setup();
  const sentId = await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [SAM],
  });
  const versions = await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA });
  expect(versions.find((s) => s._id === sentId)?.status).toBe("sent");
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(current?.version).toBe(2);
  expect(current?.status).toBe("draft");
});

test("send creates pending recipients and send rows", async () => {
  const { t, asA, ids } = await setup();
  const sentId = await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [SAM],
  });
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(recipients).toHaveLength(1);
  expect(recipients[0].status).toBe("pending");
  expect(recipients[0].token.length).toBeGreaterThanOrEqual(32);
  const sends = await t.run(async (ctx) =>
    ctx.db.query("sends").withIndex("by_call_sheet", (q) => q.eq("callSheetId", sentId)).take(10)
  );
  expect(sends).toHaveLength(1);
  expect(sends[0].status).toBe("pending");
});

test("re-send keeps the recipient token but resets status and call time", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [SAM] });
  const before = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ ...SAM, callTime: "09:00" }],
  });
  const after = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(after).toHaveLength(1);
  expect(after[0].token).toBe(before[0].token);
  expect(after[0].callTime).toBe("09:00");
  expect(after[0].status).toBe("pending");
});

test("send rejects an empty recipient list and bad emails", async () => {
  const { asA, ids } = await setup();
  await expect(
    asA.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [] })
  ).rejects.toThrow("At least one recipient");
  await expect(
    asA.mutation(api.distribution.send, {
      shootDayId: ids.dayA,
      recipients: [{ ...SAM, email: "not-an-email" }],
    })
  ).rejects.toThrow("Invalid email");
});

test("cross-org send is rejected", async () => {
  const { t, asA, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  await expect(
    asB.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [SAM] })
  ).rejects.toThrow("Shoot day not found");
});
