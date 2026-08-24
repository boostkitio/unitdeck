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
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("legacy statuses read as the booking model without being migrated", async () => {
  const { t, asA } = await setup();
  await t.run(async (ctx) => {
    const org = (await ctx.db.query("organisations").first())!;
    await ctx.db.insert("projects", { orgId: org._id, name: "Old brief", status: "brief" });
    await ctx.db.insert("projects", { orgId: org._id, name: "Old prepro", status: "pre_production" });
    await ctx.db.insert("projects", { orgId: org._id, name: "Old shoot", status: "shooting" });
  });

  const projects = await asA.query(api.projects.list, {});
  const byName = new Map(projects.map((p) => [p.name, p.status]));
  expect(byName.get("Old brief")).toBe("not_booked");
  expect(byName.get("Old prepro")).toBe("pencilled");
  expect(byName.get("Old shoot")).toBe("confirmed");
});

test("archiving hides a project from the list but keeps its status and relations", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id, status: "confirmed" });

  await asA.mutation(api.projects.setArchived, { id, archived: true });

  expect(await asA.query(api.projects.list, {})).toEqual([]);
  const archived = await asA.query(api.projects.list, { archivedOnly: true });
  expect(archived).toHaveLength(1);
  // The booking status survives archiving, so the record still reads correctly.
  expect(archived[0].status).toBe("confirmed");
  expect(archived[0].archived).toBe(true);

  await asA.mutation(api.projects.setArchived, { id, archived: false });
  expect(await asA.query(api.projects.list, {})).toHaveLength(1);
});

test("a legacy row archived via its status counts as archived, and can be restored", async () => {
  const { t, asA } = await setup();
  const id = await t.run(async (ctx) => {
    const org = (await ctx.db.query("organisations").first())!;
    return await ctx.db.insert("projects", {
      orgId: org._id,
      name: "Old archived",
      status: "archived",
    });
  });

  expect(await asA.query(api.projects.list, {})).toEqual([]);
  expect(await asA.query(api.projects.list, { archivedOnly: true })).toHaveLength(1);

  // Restoring has to give it a real status back, or it stays archived.
  await asA.mutation(api.projects.setArchived, { id, archived: false });
  const active = await asA.query(api.projects.list, {});
  expect(active).toHaveLength(1);
  expect(active[0].status).toBe("confirmed");
});

test("migrateStatuses rewrites legacy rows and is idempotent", async () => {
  const { t, asA } = await setup();
  await t.run(async (ctx) => {
    const org = (await ctx.db.query("organisations").first())!;
    await ctx.db.insert("projects", { orgId: org._id, name: "A", status: "brief" });
    await ctx.db.insert("projects", { orgId: org._id, name: "B", status: "delivered" });
    await ctx.db.insert("projects", { orgId: org._id, name: "C", status: "archived" });
    await ctx.db.insert("projects", { orgId: org._id, name: "D", status: "pencilled" });
  });

  expect(await asA.query(api.projects.legacyStatusCount, {})).toBe(3);

  const first = await asA.mutation(api.projects.migrateStatuses, {});
  expect(first.migrated).toBe(3);
  expect(await asA.query(api.projects.legacyStatusCount, {})).toBe(0);

  // The archived one moved onto the flag rather than staying a status.
  const archived = await asA.query(api.projects.list, { archivedOnly: true });
  expect(archived.map((p) => p.name)).toEqual(["C"]);

  // Running again changes nothing.
  const second = await asA.mutation(api.projects.migrateStatuses, {});
  expect(second.migrated).toBe(0);
});

test("new projects start not booked", async () => {
  const { asA } = await setup();
  await asA.mutation(api.projects.create, { name: "Fresh" });
  const projects = await asA.query(api.projects.list, {});
  expect(projects[0].status).toBe("not_booked");
});

test("the attention feed only chases unconfirmed work", async () => {
  const { t, asA } = await setup();
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const ids = await t.run(async (ctx) => {
    const org = (await ctx.db.query("organisations").first())!;
    const pencilled = await ctx.db.insert("projects", {
      orgId: org._id,
      name: "Pencilled job",
      status: "pencilled",
    });
    const confirmed = await ctx.db.insert("projects", {
      orgId: org._id,
      name: "Confirmed job",
      status: "confirmed",
    });
    for (const projectId of [pencilled, confirmed]) {
      await ctx.db.insert("shootDays", {
        orgId: org._id,
        projectId,
        date: future,
        locationIds: [],
      });
    }
    return { pencilled, confirmed };
  });

  const items = await asA.query(api.dashboard.attention, {});
  const names = new Set(items.map((i) => i.projectName));
  expect(names.has("Pencilled job")).toBe(true);
  // A confirmed booking is not "needing attention" just for having no call sheet.
  expect(names.has("Confirmed job")).toBe(false);
  expect(items.every((i) => i.projectId === ids.pencilled)).toBe(true);
});
