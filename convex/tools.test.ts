/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { CallSheetData } from "./lib/callSheetData";

const modules = import.meta.glob("./**/*.ts");

const DATA: CallSheetData = {
  title: "My first shoot",
  date: "2026-07-01",
  generalCallTime: "08:00",
  productionCompany: "Example Films",
  locations: [{ id: "loc-1", name: "Studio", address: "1 High St" }],
  schedule: [{ id: "blk-1", start: "08:00", end: "09:00", title: "Crew call" }],
  crew: [{ id: "crew-1", name: "Sam", role: "Sound", callTime: "08:00" }],
  contacts: [],
};

test("createRender stores the data and getRender round-trips it", async () => {
  const t = convexTest(schema, modules);
  const { token } = await t.mutation(api.tools.createRender, { data: DATA, website: "" });
  expect(token.length).toBeGreaterThanOrEqual(32);
  const result = await t.query(api.tools.getRender, { token });
  expect(result?.data.title).toBe("My first shoot");
});

test("renders expire", async () => {
  const t = convexTest(schema, modules);
  const { token } = await t.mutation(api.tools.createRender, { data: DATA, website: "" });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("toolRenders")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 });
  });
  expect(await t.query(api.tools.getRender, { token })).toBeNull();
});

test("honeypot submissions store nothing", async () => {
  const t = convexTest(schema, modules);
  const { token } = await t.mutation(api.tools.createRender, {
    data: DATA,
    website: "https://spam.example",
  });
  expect(await t.query(api.tools.getRender, { token })).toBeNull();
  const rows = await t.run(async (ctx) => ctx.db.query("toolRenders").take(5));
  expect(rows).toHaveLength(0);
});

test("oversized payloads are rejected", async () => {
  const t = convexTest(schema, modules);
  const big = { ...DATA, notes: "x".repeat(25000) };
  await expect(t.mutation(api.tools.createRender, { data: big, website: "" })).rejects.toThrow(
    "too large"
  );
});

test("cleanupExpired deletes only expired render rows", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("toolRenders", { token: "tok_old", data: DATA, expiresAt: Date.now() - 1000 });
    await ctx.db.insert("toolRenders", { token: "tok_live", data: DATA, expiresAt: Date.now() + 60_000 });
  });
  await t.mutation(internal.tools.cleanupExpired, {});
  const remaining = await t.run(async (ctx) => await ctx.db.query("toolRenders").collect());
  expect(remaining).toHaveLength(1);
  expect(remaining[0].token).toBe("tok_live");
});
