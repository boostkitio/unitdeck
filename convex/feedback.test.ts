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
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a", name: "Test User" }) };
}

test("submit stores org-scoped feedback with the page path", async () => {
  const { t, asA } = await setup();
  await asA.mutation(api.feedback.submit, {
    message: "The schedule blocks should support drag and drop.",
    page: "/projects/abc/shoot-days/def/call-sheet",
  });
  const rows = await t.run(async (ctx) => ctx.db.query("feedback").take(10));
  expect(rows).toHaveLength(1);
  expect(rows[0].orgName).toBe("Org A");
  expect(rows[0].userId).toBe("user_a");
  expect(rows[0].page).toContain("call-sheet");
});

test("empty feedback is rejected", async () => {
  const { asA } = await setup();
  await expect(
    asA.mutation(api.feedback.submit, { message: "  ", page: "/dashboard" })
  ).rejects.toThrow("Write a sentence");
});

test("unauthenticated submission is rejected", async () => {
  const { t } = await setup();
  await expect(
    t.mutation(api.feedback.submit, { message: "hello there", page: "/" })
  ).rejects.toThrow("Not authenticated");
});
