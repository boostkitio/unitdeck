/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("attention feed flags unsent sheets, unconfirmed crew and missing pieces", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      date: future,
      locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  // Unsent draft: expect a "not sent" item plus missing-schedule/crew flags
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  let items = await asA.query(api.dashboard.attention, {});
  expect(items.some((i) => i.kind === "call_sheet_not_sent")).toBe(true);
  expect(items.some((i) => i.kind === "no_crew")).toBe(true);

  // After sending, the unsent flag clears and unconfirmed appears
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ name: "Sam", role: "Sound", email: "sam@example.test", callTime: "07:30" }],
  });
  items = await asA.query(api.dashboard.attention, {});
  expect(items.some((i) => i.kind === "call_sheet_not_sent")).toBe(false);
  expect(items.some((i) => i.kind === "unconfirmed_crew")).toBe(true);
});
