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

test("list returns newest-first with correct type/status, and setStatus updates it", async () => {
  const { asA } = await setup();

  // Submit two items on different pages with different types
  await asA.mutation(api.feedback.submit, {
    message: "The dashboard is missing a summary card.",
    page: "/dashboard",
    type: "missing",
  });
  await asA.mutation(api.feedback.submit, {
    message: "The export button throws an error every time.",
    page: "/projects",
    type: "issue",
  });

  // list should return both, newest first
  const items = await asA.query(api.feedback.list, {});
  expect(items).toHaveLength(2);

  // Newest first: the second submission (issue on /projects) should be first
  expect(items[0].page).toBe("/projects");
  expect(items[0].type).toBe("issue");
  expect(items[0].status).toBe("open");

  expect(items[1].page).toBe("/dashboard");
  expect(items[1].type).toBe("missing");
  expect(items[1].status).toBe("open");

  // Mark the first item addressed
  await asA.mutation(api.feedback.setStatus, {
    id: items[0]._id,
    status: "addressed",
  });

  // list should now show the updated status
  const updated = await asA.query(api.feedback.list, {});
  const addressed = updated.find((i) => i._id === items[0]._id);
  const stillOpen = updated.find((i) => i._id === items[1]._id);
  expect(addressed?.status).toBe("addressed");
  expect(stillOpen?.status).toBe("open");
});
