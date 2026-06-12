/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("projects.list requires an authenticated org", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.projects.list, {})).rejects.toThrow("Not authenticated");
});

test("org-scoped project listing works end to end", async () => {
  const t = convexTest(schema, modules);
  const orgId = await t.run(async (ctx) =>
    ctx.db.insert("organisations", { name: "Test Org", clerkOrgId: "org_test1" })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("projects", { orgId, name: "Shoot A", status: "brief" })
  );
  const asUser = t.withIdentity({ subject: "user_1", org_id: "org_test1" });
  const projects = await asUser.query(api.projects.list, {});
  expect(projects).toHaveLength(1);
  expect(projects[0].name).toBe("Shoot A");
});
