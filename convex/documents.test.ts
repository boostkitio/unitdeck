/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  DEFAULT_TALENT_RIGHTS_CLAUSE,
  rightsClauseFor,
  signerSubject,
} from "./lib/documentData";

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
  expect(signerSubject(read!.data).name).toBe("Claire Francis");
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
  expect(signerSubject(doc!.data).name).toBe("Claire Francis");
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
  expect(signerSubject(res!.data).name).toBe("Claire Francis");
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

async function signedDocWithFiles() {
  const { t, asA, id, token } = await sentDoc();
  await t.mutation(api.documents.sign, { token, typedName: "Claire Francis", consent: true });
  const fileA = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" })));
  const fileB = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([9, 9, 9])], { type: "application/pdf" })));
  return { t, asA, id, token, fileA, fileB };
}

test("attachSignedPdf is first-write-wins: the stored PDF cannot be replaced", async () => {
  const { t, asA, id, token, fileA, fileB } = await signedDocWithFiles();
  await t.mutation(api.documents.attachSignedPdf, { token, fileId: fileA });
  await t.mutation(api.documents.attachSignedPdf, { token, fileId: fileB });
  expect((await asA.query(api.documents.get, { id }))?.signedPdfFileId).toBe(fileA);
});

test("generateSignedUploadUrl refuses once a signed PDF is stored", async () => {
  const { t, token, fileA } = await signedDocWithFiles();
  await expect(t.mutation(api.documents.generateSignedUploadUrl, { token })).resolves.toBeTruthy();
  await t.mutation(api.documents.attachSignedPdf, { token, fileId: fileA });
  await expect(t.mutation(api.documents.generateSignedUploadUrl, { token })).rejects.toThrow(
    "Signed PDF already stored"
  );
});

test("getSignedPdfUrl returns null before storage and a URL after", async () => {
  const { t, token, fileA } = await signedDocWithFiles();
  expect(await t.query(api.documents.getSignedPdfUrl, { token })).toBeNull();
  await t.mutation(api.documents.attachSignedPdf, { token, fileId: fileA });
  const url = await t.query(api.documents.getSignedPdfUrl, { token });
  expect(typeof url).toBe("string");
  expect(await t.query(api.documents.getSignedPdfUrl, { token: "nope" })).toBeNull();
});

test("deliverInvite records a delivered outcome and the doc stays sent", async () => {
  const { t, asA, id } = await sentDoc();
  // vitest.setup.ts stubs api.resend.com with a 200, so the send succeeds.
  await t.action(internal.documents.deliverInvite, { id });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.inviteDelivery?.status).toBe("delivered");
  expect(doc?.status).toBe("sent");
});

test("deliverInvite records a failure without reverting the doc status", async () => {
  const { t, asA, id } = await sentDoc();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  try {
    await t.action(internal.documents.deliverInvite, { id });
  } finally {
    globalThis.fetch = realFetch;
  }
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.inviteDelivery?.status).toBe("failed");
  expect(doc?.inviteDelivery?.error).toContain("Resend 500");
  expect(doc?.status).toBe("sent");
});

test("resendInvite requeues whether the last one failed or simply went unanswered", async () => {
  const { t, asA, id } = await sentDoc();

  // A reminder is the invite arriving a second time, so a delivered one can
  // be sent again — that is what chasing a signature is.
  await asA.mutation(api.documents.resendInvite, { id });
  expect((await asA.query(api.documents.get, { id }))?.status).toBe("sent");

  await t.run(async (ctx) => {
    await ctx.db.patch(id, {
      inviteDelivery: { status: "failed" as const, error: "Resend 500", at: Date.now() },
    });
  });
  await asA.mutation(api.documents.resendInvite, { id });
  expect((await asA.query(api.documents.get, { id }))?.status).toBe("sent");
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

test("a release is raised from the talent already on the production", async () => {
  const { t, ids, asA } = await setup();
  const actor = await t.run(async (ctx) => {
    const producer = await ctx.db.insert("people", {
      orgId: ids.orgA,
      name: "Nia Roberts",
      role: "Producer",
    });
    const talent = await ctx.db.insert("people", {
      orgId: ids.orgA,
      name: "Jo Patel",
      kind: "talent",
      role: "Lead",
      email: "jo@agency.test",
      phone: "07700 900222",
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      personId: producer,
      status: "confirmed",
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      kind: "talent",
      personId: talent,
      status: "confirmed",
    });
    return talent;
  });

  const id = await asA.mutation(api.documents.ensureForPerson, {
    projectId: ids.projectA,
    personId: actor,
  });
  const doc = await asA.query(api.documents.get, { id });

  // Everything on it was already known; none of it was asked for again.
  expect(doc?.data).toMatchObject({
    talentName: "Jo Patel",
    talentEmail: "jo@agency.test",
    talentPhone: "07700 900222",
    producerName: "Nia Roberts",
  });
  expect(doc?.signer).toMatchObject({ name: "Jo Patel", email: "jo@agency.test" });
  expect(doc?.status).toBe("draft");
});

test("asking twice reopens the release rather than raising a second", async () => {
  const { t, ids, asA } = await setup();
  const actor = await t.run(async (ctx) =>
    ctx.db.insert("people", { orgId: ids.orgA, name: "Jo Patel", kind: "talent", role: "Lead" }),
  );

  const first = await asA.mutation(api.documents.ensureForPerson, {
    projectId: ids.projectA,
    personId: actor,
  });
  const second = await asA.mutation(api.documents.ensureForPerson, {
    projectId: ids.projectA,
    personId: actor,
  });

  expect(second).toBe(first);
  expect(await asA.query(api.documents.listForProject, { projectId: ids.projectA })).toHaveLength(1);
});

test("another org cannot raise a release on your production", async () => {
  const { t, ids, asB } = await setup();
  const actor = await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    return ctx.db.insert("people", { orgId: ids.orgA, name: "Jo Patel", role: "Lead" });
  });

  await expect(
    asB.mutation(api.documents.ensureForPerson, { projectId: ids.projectA, personId: actor }),
  ).rejects.toThrow(/not found/i);
});

test("a location release is raised from the location on the project", async () => {
  const { t, ids, asA } = await setup();
  const locationId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("locations", {
      orgId: ids.orgA,
      name: "Shoreditch studio",
      address: "25 Tree Lane, London",
    });
    await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-05-12",
      locationIds: [id],
    });
    await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-05-14",
      locationIds: [id],
    });
    return id;
  });

  const id = await asA.mutation(api.documents.ensureForLocation, {
    projectId: ids.projectA,
    locationId,
  });
  const doc = await asA.query(api.documents.get, { id });

  expect(doc?.type).toBe("location_release");
  expect(doc?.data).toMatchObject({
    kind: "location",
    locationName: "Shoreditch studio",
    address: "25 Tree Lane, London",
    productionTitle: "Barclays",
    shootDates: "2026-05-12 to 2026-05-14",
  });
  // Nobody has said who owns it; that is the one thing left to fill in.
  expect(signerSubject(doc!.data).name).toBe("");
  expect(doc?.title).toBe("Location release: Shoreditch studio");

  // Asking twice reopens it rather than raising a second.
  const again = await asA.mutation(api.documents.ensureForLocation, {
    projectId: ids.projectA,
    locationId,
  });
  expect(again).toBe(id);
});

test("a release keeps the wording it was raised under", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const org = await ctx.db.get(ids.orgA);
    await ctx.db.patch(ids.orgA, {
      settings: { ...org!.settings, releaseWording: { talent: "House wording, {{governingLaw}}." } },
    });
  });

  const id = await asA.mutation(api.documents.create, {
    projectId: ids.projectA,
    personId: ids.person,
  });
  const before = await asA.query(api.documents.get, { id });
  expect(before?.data.rightsClause).toBe("House wording, {{governingLaw}}.");
  expect(rightsClauseFor(before!.data)).toBe("House wording, England and Wales.");

  // Changing settings afterwards must not rewrite a release already raised.
  await t.run(async (ctx) => {
    const org = await ctx.db.get(ids.orgA);
    await ctx.db.patch(ids.orgA, {
      settings: { ...org!.settings, releaseWording: { talent: "Something else entirely." } },
    });
  });
  const after = await asA.query(api.documents.get, { id });
  expect(after?.data.rightsClause).toBe("House wording, {{governingLaw}}.");
});

test("a release with no house wording falls back to the default clause", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.documents.create, {
    projectId: ids.projectA,
    personId: ids.person,
  });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.data.rightsClause).toBe(DEFAULT_TALENT_RIGHTS_CLAUSE);
});

test("a release waiting to be signed can be chased, a finished one cannot", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.documents.create, {
    projectId: ids.projectA,
    personId: ids.person,
  });

  // Not yet sent: there is nothing to remind anybody about.
  await expect(asA.mutation(api.documents.resendInvite, { id })).rejects.toThrow(/waiting/i);

  await asA.mutation(api.documents.send, { id });
  await asA.mutation(api.documents.resendInvite, { id });

  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("sent");
});
