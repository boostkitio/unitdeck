/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("attention feed chases crew confirmation, not call sheets", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "Brand film",
      status: "pencilled",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: future,
      locationIds: [],
    });
    const person = await ctx.db.insert("people", {
      orgId: orgA,
      name: "Sam Reed",
      role: "Sound recordist",
    });
    return { orgA, projectA, dayA, person };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  // Nobody booked yet.
  let items = await asA.query(api.dashboard.attention, {});
  expect(items.map((i) => i.kind)).toEqual(["no_crew"]);

  // Booked but not confirmed.
  const bookingId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.projectA,
    personId: ids.person,
  });
  items = await asA.query(api.dashboard.attention, {});
  expect(items.map((i) => i.kind)).toEqual(["unconfirmed_crew"]);
  expect(items[0].label).toBe("1 of 1 crew still to confirm");

  // Confirmed: nothing left to chase.
  await asA.mutation(api.projectCrew.update, { id: bookingId, status: "confirmed" });
  items = await asA.query(api.dashboard.attention, {});
  expect(items).toEqual([]);
});

test("an unsent call sheet is not something to chase", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org D", clerkOrgId: "org_d" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    const day = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: future,
      locationIds: [],
    });
    const person = await ctx.db.insert("people", { orgId: org, name: "Sam", role: "Sound" });
    return { project, day, person };
  });
  const asD = t.withIdentity({ subject: "user_d", org_id: "org_d" });

  const bookingId = await asD.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });
  await asD.mutation(api.projectCrew.update, { id: bookingId, status: "confirmed" });

  // A draft call sheet exists and has never been sent; that is not a problem.
  await asD.mutation(api.callSheets.ensure, { shootDayId: ids.day });
  const items = await asD.query(api.dashboard.attention, {});
  expect(items).toEqual([]);
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
  expect(items.some((i) => i.date === future && i.kind === "no_crew")).toBe(true);

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

test("an unfilled role is chased separately from unconfirmed crew", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org E", clerkOrgId: "org_e" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
    const person = await ctx.db.insert("people", { orgId: org, name: "Sam", role: "Sound" });
    return { project, person };
  });
  const asE = t.withIdentity({ subject: "user_e", org_id: "org_e" });

  // One booked and confirmed, one role nobody is in.
  const bookingId = await asE.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });
  await asE.mutation(api.projectCrew.update, { id: bookingId, status: "confirmed" });
  await asE.mutation(api.projectCrew.add, { projectId: ids.project, role: "Gaffer" });

  const items = await asE.query(api.dashboard.attention, {});
  // The confirmed person is settled; the empty role is not.
  expect(items.map((i) => i.kind)).toEqual(["unfilled_roles"]);
  expect(items[0].label).toBe("1 role still to book");
});

test("a crew problem is raised once per production, not once per shoot day", async () => {
  const t = convexTest(schema, modules);
  const dayOne = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    // A week's shoot with nobody booked on it.
    for (const offset of [1, 2, 3, 4, 5]) {
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10),
        locationIds: [],
      });
    }
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const items = await asA.query(api.dashboard.attention, {});

  // One production with no crew is one problem, not five — and the panel's
  // count is what the tile above it shows.
  expect(items).toHaveLength(1);
  expect(items[0].kind).toBe("no_crew");
  // It points at the first day it matters, not an arbitrary one.
  expect(items[0].date).toBe(dayOne);
});

test("a kit clash is raised on both productions, whatever their status", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    // One camera, two productions shooting the same day — and both confirmed,
    // which the crew checks deliberately ignore but a double booking is a
    // problem regardless.
    await ctx.db.insert("equipment", { orgId: org, item: "Sony FX9" });
    for (const name of ["Brand film", "Music video"]) {
      const project = await ctx.db.insert("projects", { orgId: org, name, status: "confirmed" });
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: soon,
        locationIds: [],
      });
      await ctx.db.insert("projectEquipment", {
        orgId: org,
        projectId: project,
        item: "Sony FX9",
        status: "confirmed",
      });
    }
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const items = await asA.query(api.dashboard.attention, {});
  const clashes = items.filter((i) => i.kind === "kit_clash");
  expect(clashes).toHaveLength(2);
  expect(clashes[0].label).toMatch(/Sony FX9 double-booked — 2 wanted, 1 owned/);
  expect(clashes.map((c) => c.projectName).sort()).toEqual(["Brand film", "Music video"]);
});

test("kit that goes round is not raised on the dashboard", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    for (let i = 0; i < 2; i++) {
      await ctx.db.insert("equipment", { orgId: org, item: "Tripod" });
    }
    for (const name of ["Brand film", "Music video"]) {
      const project = await ctx.db.insert("projects", { orgId: org, name, status: "confirmed" });
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: soon,
        locationIds: [],
      });
      await ctx.db.insert("projectEquipment", {
        orgId: org,
        projectId: project,
        item: "Tripod",
        status: "confirmed",
      });
    }
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const items = await asA.query(api.dashboard.attention, {});
  expect(items.filter((i) => i.kind === "kit_clash")).toEqual([]);
});
