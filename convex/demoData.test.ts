/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("seedDemo populates an enriched dataset for the caller's org", async () => {
  const { t, asA } = await setup();
  const res = await asA.mutation(api.demoData.seedDemo, {});
  expect(res.seeded).toBe(true);
  const counts = await t.run(async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const people = await ctx.db.query("people").collect();
    const sheets = await ctx.db.query("callSheets").collect();
    const org = (await ctx.db.query("organisations").first())!;
    return { projects, peopleCount: people.length, sheet: sheets[0], org };
  });
  expect(counts.projects.some((p) => p.name === "Barclays Pension Advice")).toBe(true);
  expect(counts.peopleCount).toBeGreaterThanOrEqual(6);
  expect(counts.sheet.data.callTimes).toHaveLength(4);
  expect(counts.sheet.data.contactSections).toHaveLength(3);
  expect(counts.sheet.data.camera?.frameRate).toContain("25");
  expect(counts.sheet.data.confidential).toBe(true);
  expect(counts.org.settings?.invoicing?.legalName).toBe("Klaxon Studio Ltd");
});

test("seedDemo is idempotent", async () => {
  const { t, asA } = await setup();
  await asA.mutation(api.demoData.seedDemo, {});
  const second = await asA.mutation(api.demoData.seedDemo, {});
  expect(second.seeded).toBe(false);
  const projectCount = await t.run(async (ctx) =>
    (await ctx.db.query("projects").collect()).filter((p) => p.name === "Barclays Pension Advice").length
  );
  expect(projectCount).toBe(1);
});
