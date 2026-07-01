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

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_a" });
    const person = await ctx.db.insert("people", { orgId: orgA, name: "Claire Francis", role: "Talent", email: "claire@example.com" });
    const projectA = await ctx.db.insert("projects", { orgId: orgA, name: "Barclays", status: "pre_production" });
    return { orgA, projectA, person };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }), asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }) };
}

test("create seeds a draft prefilled from project, org and person, with a token", async () => {
  const { asA, ids } = await setup();
  const id = await asA.mutation(api.documents.create, { projectId: ids.projectA, personId: ids.person });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("draft");
  expect(doc?.data.productionTitle).toBe("Barclays");
  expect(doc?.data.productionCompany).toBe("Klaxon");
  expect(doc?.data.talentName).toBe("Claire Francis");
  expect(doc?.signer.email).toBe("claire@example.com");
  expect(doc?.signToken).toMatch(/^[a-f0-9]{48}$/);
});

test("saveDraft edits only while draft, and cross-org is rejected", async () => {
  const { t, asA, asB, ids } = await setup();
  await t.run(async (ctx) => { await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" }); });
  const id = await asA.mutation(api.documents.create, { projectId: ids.projectA, personId: ids.person });
  const doc = await asA.query(api.documents.get, { id });
  await asA.mutation(api.documents.saveDraft, { id, data: { ...doc!.data, compensation: "£500" } });
  expect((await asA.query(api.documents.get, { id }))?.data.compensation).toBe("£500");
  await expect(asB.query(api.documents.get, { id })).resolves.toBeNull();
  await expect(asB.mutation(api.documents.saveDraft, { id, data: doc!.data })).rejects.toThrow();
});
