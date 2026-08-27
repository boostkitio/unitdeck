/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Whoever starts a job owns it until somebody says otherwise. Left empty,
// every new production reads as belonging to nobody, which is never true.
test("whoever creates a production owns it", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const id = await asA.mutation(api.projects.create, { name: "Brand film" });
  const project = await t.run((ctx) => ctx.db.get(id));
  expect(project!.ownerId).toBe("user_a");
});
