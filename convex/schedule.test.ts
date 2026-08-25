/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    const dayOne = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: "2026-09-01",
      label: "Interviews",
      locationIds: [],
    });
    const dayTwo = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: "2026-09-02",
      locationIds: [],
    });
    return { org, project, dayOne, dayTwo };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("the schedule reads in the order the days happen", async () => {
  const { ids, asA } = await setup();
  // Added out of order on purpose.
  await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    shootDayId: ids.dayTwo,
    time: "08:00",
    item: "Day two call",
  });
  await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    shootDayId: ids.dayOne,
    time: "13:00",
    item: "Lunch",
  });
  await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    shootDayId: ids.dayOne,
    time: "07:00",
    item: "Crew call",
  });

  const items = await asA.query(api.schedule.listForProject, { projectId: ids.project });
  expect(items.map((i) => i.item)).toEqual(["Crew call", "Lunch", "Day two call"]);
  expect(items[0].dayLabel).toBe("Interviews");
});

test("an item with no time yet sits at the end of its day", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    shootDayId: ids.dayOne,
    item: "Pickups if there is time",
  });
  await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    shootDayId: ids.dayOne,
    time: "18:00",
    item: "Wrap",
  });

  const items = await asA.query(api.schedule.listForProject, { projectId: ids.project });
  // Not at the start, where it would imply a call time nobody agreed.
  expect(items.map((i) => i.item)).toEqual(["Wrap", "Pickups if there is time"]);
});

test("an item for the whole job comes before any particular day", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    shootDayId: ids.dayOne,
    time: "07:00",
    item: "Crew call",
  });
  await asA.mutation(api.schedule.add, { projectId: ids.project, item: "Kit check" });

  const items = await asA.query(api.schedule.listForProject, { projectId: ids.project });
  expect(items.map((i) => i.item)).toEqual(["Kit check", "Crew call"]);
  expect(items[0].date).toBeNull();
});

test("a time has to be a real time", async () => {
  const { ids, asA } = await setup();
  for (const time of ["7am", "25:00", "07:60", "0700"]) {
    await expect(
      asA.mutation(api.schedule.add, { projectId: ids.project, item: "Call", time }),
    ).rejects.toThrow(/HH:MM/);
  }
  // A blank one is fine: not every item has a settled time.
  await asA.mutation(api.schedule.add, { projectId: ids.project, item: "Call", time: "  " });
});

test("an item cannot be put on another project's shoot day", async () => {
  const { t, ids, asA } = await setup();
  const otherDay = await t.run(async (ctx) => {
    const other = await ctx.db.insert("projects", {
      orgId: ids.org,
      name: "Music video",
      status: "confirmed",
    });
    return await ctx.db.insert("shootDays", {
      orgId: ids.org,
      projectId: other,
      date: "2026-09-01",
      locationIds: [],
    });
  });

  await expect(
    asA.mutation(api.schedule.add, {
      projectId: ids.project,
      shootDayId: otherDay,
      item: "Crew call",
    }),
  ).rejects.toThrow(/not on this project/);
});

test("an item needs to say what happens", async () => {
  const { ids, asA } = await setup();
  await expect(
    asA.mutation(api.schedule.add, { projectId: ids.project, item: "   " }),
  ).rejects.toThrow(/Say what happens/);
});

test("another org cannot read or change this schedule", async () => {
  const { t, ids, asA } = await setup();
  const id = await asA.mutation(api.schedule.add, {
    projectId: ids.project,
    item: "Crew call",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  expect(await asB.query(api.schedule.listForProject, { projectId: ids.project })).toEqual([]);
  await expect(asB.mutation(api.schedule.remove, { id })).rejects.toThrow(/not found/);
});
