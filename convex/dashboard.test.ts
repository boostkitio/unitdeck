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

test("a long shoot-day history cannot crowd upcoming days out of the dashboard", async () => {
  const t = convexTest(schema, modules);
  const past = (n: number) =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org C", clerkOrgId: "org_c" });
    // Pencilled, not confirmed: the attention feed only chases unconfirmed
    // work, and this test is about the take() bound, not about status.
    const project = await ctx.db.insert("projects", { orgId: org, name: "Series", status: "pencilled" });
    // More history rows than the query's take() bound; the old by_org scan
    // read the oldest 500 first and silently dropped the upcoming day.
    for (let i = 0; i < 501; i++) {
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: past(i + 1),
        locationIds: [],
      });
    }
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
  });
  const asC = t.withIdentity({ subject: "user_c", org_id: "org_c" });

  const items = await asC.query(api.dashboard.attention, {});
  expect(items.some((i) => i.date === future && i.kind === "call_sheet_not_sent")).toBe(true);

  const week = await asC.query(api.dashboard.upcomingShootDays, {});
  expect(week.length).toBe(1);
  expect(week[0].date).toBe(future);
});

test("upcoming shoot days lists this week's days with confirmation counts", async () => {
  const t = convexTest(schema, modules);
  const inThree = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const inThirty = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    const project = await ctx.db.insert("projects", { orgId: org, name: "Promo", status: "shooting" });
    const soon = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: inThree,
      locationIds: [],
    });
    // A day outside the 7-day window must not appear
    await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: inThirty,
      locationIds: [],
    });
    // Two crew on the soon day: one confirmed, one merely sent
    await ctx.db.insert("recipients", {
      orgId: org,
      shootDayId: soon,
      name: "Ada",
      role: "DP",
      email: "ada@example.test",
      callTime: "07:00",
      token: "tok_ada",
      status: "confirmed",
    });
    await ctx.db.insert("recipients", {
      orgId: org,
      shootDayId: soon,
      name: "Ben",
      role: "Gaffer",
      email: "ben@example.test",
      callTime: "07:00",
      token: "tok_ben",
      status: "sent",
    });
    return { soon };
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  const week = await asB.query(api.dashboard.upcomingShootDays, {});
  expect(week.length).toBe(1);
  expect(week[0].shootDayId).toBe(ids.soon);
  expect(week[0].projectName).toBe("Promo");
  expect(week[0].total).toBe(2);
  expect(week[0].confirmed).toBe(1);
});
