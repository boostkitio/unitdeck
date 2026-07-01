/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("a talent_release document round-trips through the schema", async () => {
  const t = convexTest(schema, modules);
  const read = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_a" });
    const projectId = await ctx.db.insert("projects", { orgId, name: "Barclays", status: "pre_production" });
    const id = await ctx.db.insert("documents", {
      orgId,
      projectId,
      type: "talent_release",
      title: "Talent release: Claire Francis",
      status: "draft",
      data: {
        talentName: "Claire Francis",
        talentEmail: "claire@example.com",
        producerName: "Charlie Fox",
        productionCompany: "Klaxon Studio",
        productionTitle: "Barclays Pension Advice",
        compensation: "£480 buyout",
        governingLaw: "England and Wales",
      },
      signer: { name: "Claire Francis", email: "claire@example.com" },
      signToken: "tok_abc",
    });
    return await ctx.db.get(id);
  });
  expect(read?.type).toBe("talent_release");
  expect(read?.status).toBe("draft");
  expect(read?.data.talentName).toBe("Claire Francis");
  expect(read?.signToken).toBe("tok_abc");
});
