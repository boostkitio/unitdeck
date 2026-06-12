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
    const clientId = await ctx.db.insert("clients", { orgId: orgA, name: "Acme" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      clientId,
      name: "Brand film",
      status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: "2026-06-20",
      locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  return {
    t,
    ids,
    asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }),
    asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }),
  };
}

test("ensure creates version 1 draft with defaults, and is idempotent", async () => {
  const { asA, ids } = await setup();
  const first = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const second = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  expect(first).toBe(second);
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(current?.version).toBe(1);
  expect(current?.status).toBe("draft");
  expect(current?.data.title).toBe("Brand film");
  expect(current?.data.clientName).toBe("Acme");
  expect(current?.data.productionCompany).toBe("Org A");
  expect(current?.data.date).toBe("2026-06-20");
});

test("saveDraft patches the draft", async () => {
  const { asA, ids } = await setup();
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: draftId,
    data: { ...current!.data, generalCallTime: "07:30" },
  });
  const after = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(after?.data.generalCallTime).toBe("07:30");
  expect(after?.version).toBe(1); // autosave does not bump versions
});

test("snapshot freezes the draft and starts a new one", async () => {
  const { asA, ids } = await setup();
  const v1Id = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.snapshotVersion, {
    shootDayId: ids.dayA,
    note: "Sent to crew",
  });
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(current?.version).toBe(2);
  expect(current?._id).not.toBe(v1Id);
  const versions = await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA });
  expect(versions).toHaveLength(2);
  expect(versions.find((s) => s.version === 1)?.status).toBe("snapshot");
  // frozen versions reject writes
  await expect(
    asA.mutation(api.callSheets.saveDraft, { id: v1Id, data: current!.data })
  ).rejects.toThrow("Only the draft can be edited");
});

test("restore carries old data into a new draft without rewriting history", async () => {
  const { asA, ids } = await setup();
  const v1Id = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const v1 = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: v1Id,
    data: { ...v1!.data, title: "Original title" },
  });
  await asA.mutation(api.callSheets.snapshotVersion, { shootDayId: ids.dayA });
  const v2 = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: v2!._id,
    data: { ...v2!.data, title: "Edited title" },
  });
  await asA.mutation(api.callSheets.restoreVersion, { shootDayId: ids.dayA, fromId: v1Id });
  const v3 = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(v3?.version).toBe(3);
  expect(v3?.data.title).toBe("Original title");
  expect(await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA })).toHaveLength(3);
});

test("render tokens resolve and expire", async () => {
  const { t, asA, ids } = await setup();
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const { token } = await asA.mutation(api.callSheets.createRenderToken, { id: draftId });
  const resolved = await t.query(api.callSheets.getByRenderToken, { token });
  expect(resolved?.data.title).toBe("Brand film");
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("renderTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 });
  });
  expect(await t.query(api.callSheets.getByRenderToken, { token })).toBeNull();
});

test("cross-org access is rejected everywhere", async () => {
  const { t, asA, asB, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await expect(asB.mutation(api.callSheets.ensure, { shootDayId: ids.dayA })).rejects.toThrow();
  await expect(
    asB.mutation(api.callSheets.createRenderToken, { id: draftId })
  ).rejects.toThrow();
});
