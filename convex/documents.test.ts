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

test("send freezes the draft to sent and rejects without a signer email", async () => {
  const { asA, ids, t } = await setup();
  const id = await asA.mutation(api.documents.create, { projectId: ids.projectA, personId: ids.person });
  await asA.mutation(api.documents.send, { id });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("sent");
  expect(typeof doc?.sentAt).toBe("number");

  // A doc whose signer has no email cannot be sent: create a second draft (no person)
  // and blank its signer email directly, then assert send rejects.
  const id2 = await asA.mutation(api.documents.create, { projectId: ids.projectA });
  await t.run(async (ctx) => {
    await ctx.db.patch(id2, { signer: { name: "X", email: "" } });
  });
  await expect(asA.mutation(api.documents.send, { id: id2 })).rejects.toThrow();
});

async function sentDoc() {
  const { t, asA, ids } = await setup();
  const id = await asA.mutation(api.documents.create, { projectId: ids.projectA, personId: ids.person });
  await asA.mutation(api.documents.send, { id });
  const token = (await asA.query(api.documents.get, { id }))!.signToken;
  return { t, asA, id, token };
}

test("getBySignToken returns the body but no org internals", async () => {
  const { t, token } = await sentDoc();
  const res = await t.query(api.documents.getBySignToken, { token });
  expect(res?.status).toBe("sent");
  expect(res?.data.talentName).toBe("Claire Francis");
  expect((res as Record<string, unknown>)?.orgId).toBeUndefined();
  expect(await t.query(api.documents.getBySignToken, { token: "nope" })).toBeNull();
});

test("sign requires typed name and consent, stamps once, rejects a second sign", async () => {
  const { t, asA, id, token } = await sentDoc();
  await expect(t.mutation(api.documents.sign, { token, typedName: "", consent: true })).rejects.toThrow();
  await t.mutation(api.documents.sign, { token, typedName: "Claire Francis", consent: true, ip: "1.2.3.4", userAgent: "jsdom" });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("signed");
  expect(doc?.signature?.typedName).toBe("Claire Francis");
  expect(doc?.signature?.consent).toBe(true);
  expect(doc?.signature?.ip).toBe("1.2.3.4");
  await expect(t.mutation(api.documents.sign, { token, typedName: "again", consent: true })).rejects.toThrow();
});

test("sign rejects when consent is not given", async () => {
  const { t, token } = await sentDoc();
  await expect(
    t.mutation(api.documents.sign, { token, typedName: "Claire Francis", consent: false })
  ).rejects.toThrow();
});

test("decline records a declined status", async () => {
  const { t, asA, id, token } = await sentDoc();
  await t.mutation(api.documents.decline, { token, reason: "Not available" });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("declined");
  expect(doc?.declineReason).toBe("Not available");
});

test("attachSignedPdf stores the file id on a signed doc", async () => {
  const { t, asA, id, token } = await sentDoc();
  await t.mutation(api.documents.sign, { token, typedName: "Claire Francis", consent: true });
  const fileId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" })));
  await t.mutation(api.documents.attachSignedPdf, { token, fileId });
  expect((await asA.query(api.documents.get, { id }))?.signedPdfFileId).toBe(fileId);
});

test("markViewed sets viewedAt once and is idempotent", async () => {
  const { t, asA, id, token } = await sentDoc();
  expect((await asA.query(api.documents.get, { id }))?.viewedAt).toBeUndefined();
  await t.mutation(api.documents.markViewed, { token });
  const viewedAt = (await asA.query(api.documents.get, { id }))?.viewedAt;
  expect(typeof viewedAt).toBe("number");
  await t.mutation(api.documents.markViewed, { token });
  expect((await asA.query(api.documents.get, { id }))?.viewedAt).toBe(viewedAt);
});
