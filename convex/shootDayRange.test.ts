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
      status: "pre_production",
    });
    return { org, project };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

async function datesFor(
  asA: ReturnType<Awaited<ReturnType<typeof setup>>["t"]["withIdentity"]>,
  projectId: Awaited<ReturnType<typeof setup>>["ids"]["project"],
) {
  const days = await asA.query(api.shootDays.listForProject, { projectId });
  return days.map((d) => d.date).sort();
}

test("a range creates one shoot day per date, both ends inclusive", async () => {
  const { ids, asA } = await setup();

  const result = await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-01",
    to: "2026-09-04",
  });

  expect(result).toMatchObject({ created: 4, removed: 0, kept: [] });
  expect(await datesFor(asA, ids.project)).toEqual([
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
  ]);
});

test("a range spanning a month boundary counts days correctly", async () => {
  const { ids, asA } = await setup();

  const result = await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-01-30",
    to: "2026-02-02",
  });

  expect(result.created).toBe(4);
  expect(await datesFor(asA, ids.project)).toEqual([
    "2026-01-30",
    "2026-01-31",
    "2026-02-01",
    "2026-02-02",
  ]);
});

test("re-applying the same range is a no-op rather than duplicating days", async () => {
  const { ids, asA } = await setup();
  const range = { projectId: ids.project, from: "2026-09-01", to: "2026-09-03" };

  await asA.mutation(api.shootDays.setRange, range);
  const second = await asA.mutation(api.shootDays.setRange, range);

  expect(second).toMatchObject({ created: 0, removed: 0, kept: [] });
  expect(await datesFor(asA, ids.project)).toHaveLength(3);
});

test("shrinking a range removes the days that fall outside it", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-01",
    to: "2026-09-05",
  });

  const result = await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-02",
    to: "2026-09-03",
  });

  expect(result).toMatchObject({ created: 0, removed: 3, kept: [] });
  expect(await datesFor(asA, ids.project)).toEqual(["2026-09-02", "2026-09-03"]);
});

test("a day carrying a call sheet is kept, not deleted, when the range shrinks", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-01",
    to: "2026-09-03",
  });

  const days = await asA.query(api.shootDays.listForProject, { projectId: ids.project });
  const first = days.find((d) => d.date === "2026-09-01")!;
  await asA.mutation(api.callSheets.ensure, { shootDayId: first._id });

  // Move the range past the day that now has a call sheet.
  const result = await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-02",
    to: "2026-09-02",
  });

  expect(result.kept).toEqual(["2026-09-01"]);
  expect(result.removed).toBe(1); // only 09-03 went
  // The call sheet's day survives, so its record is not destroyed.
  expect(await datesFor(asA, ids.project)).toEqual(["2026-09-01", "2026-09-02"]);
});

test("a day with wrap notes is kept too", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-01",
    to: "2026-09-02",
  });

  const days = await asA.query(api.shootDays.listForProject, { projectId: ids.project });
  const first = days.find((d) => d.date === "2026-09-01")!;
  await t.run(async (ctx) => {
    await ctx.db.patch(first._id, { wrapNotes: "Overran by an hour" });
  });

  const result = await asA.mutation(api.shootDays.setRange, {
    projectId: ids.project,
    from: "2026-09-02",
    to: "2026-09-02",
  });

  expect(result.kept).toEqual(["2026-09-01"]);
});

test("an inverted or oversized range is rejected", async () => {
  const { ids, asA } = await setup();

  await expect(
    asA.mutation(api.shootDays.setRange, {
      projectId: ids.project,
      from: "2026-09-05",
      to: "2026-09-01",
    }),
  ).rejects.toThrow(/must not be after/);

  // A mistyped year should not create tens of thousands of rows.
  await expect(
    asA.mutation(api.shootDays.setRange, {
      projectId: ids.project,
      from: "2026-09-01",
      to: "2062-09-01",
    }),
  ).rejects.toThrow(/at most/);

  expect(await datesFor(asA, ids.project)).toEqual([]);
});

test("another org cannot set a project's shoot range", async () => {
  const { t, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  await expect(
    asB.mutation(api.shootDays.setRange, {
      projectId: ids.project,
      from: "2026-09-01",
      to: "2026-09-02",
    }),
  ).rejects.toThrow(/Project not found/);
});
