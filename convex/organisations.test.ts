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

test("updateSettings persists and settingsView reads it back", async () => {
  const { asA } = await setup();
  await asA.mutation(api.organisations.updateSettings, {
    brandColor: "#123456",
    invoicing: { legalName: "Klaxon Studio Ltd", invoiceEmail: "invoices@klaxon.studio" },
    confidentialByDefault: true,
  });
  const view = await asA.query(api.organisations.settingsView, {});
  expect(view?.brandColor).toBe("#123456");
  expect(view?.invoicing?.legalName).toBe("Klaxon Studio Ltd");
  expect(view?.confidentialByDefault).toBe(true);
});

test("callSheetDefaults returns the mergeable defaults", async () => {
  const { asA } = await setup();
  await asA.mutation(api.organisations.updateSettings, {
    confidentialByDefault: true,
    invoicing: { invoiceEmail: "invoices@klaxon.studio" },
  });
  const defaults = await asA.query(api.organisations.callSheetDefaults, {});
  expect(defaults.confidential).toBe(true);
  expect(defaults.invoicing?.invoiceEmail).toBe("invoices@klaxon.studio");
});
