# Talent release and e-sign primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared e-signature primitive and prove it with a UK-correct talent release: a producer creates a release on a project, sends the talent a signing link, the talent signs (typed name + consent, optional drawn signature), and UnitDeck captures an immutable signature and signed PDF and tracks status.

**Architecture:** A generic `documents` table keyed by a `type` union (`"talent_release"` only for now) with a per-type `data` body and a single inline signer. The signing mechanism is generic (public `/sign/[token]` page, token-keyed sign/decline/view mutations, IP/audit capture via a thin Next.js route, signed-PDF via the existing puppeteer pipeline). Later document types add a `type` + `data` validator + body renderer + editor and reuse the signing path unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, Convex, Clerk, Tailwind v4, Resend (via `fetch`), puppeteer-core PDF, vitest + convex-test.

## Global Constraints

- Reuses existing patterns verbatim where possible: public token page/mutations (`convex/setMode.ts` `getByToken`/`markViewed`/`decline`), the awaited Resend action (`convex/distribution.ts` `deliverEmails`, env `RESEND_API_KEY` + `SITE_URL`, `FROM = "UnitDeck <callsheets@mail.unitdeck.app>"`), pure email builders (`convex/lib/email.ts`), the public PDF route (`src/app/api/tools/pdf/route.ts`), and the public page shell (`src/app/s/[token]/page.tsx`).
- Tenancy: every non-public Convex function derives the org from the Clerk token via `requireOrg` (`convex/lib/auth.ts`), never from client args. Public functions are reachable only with a valid `signToken`.
- Immutability: `data` is editable only while `status === "draft"`. `send` freezes it. `sign` stamps the signature; after signing the row is read-only except attaching the signed PDF.
- No fire-and-forget email: sends run in an awaited action that records its outcome. `SITE_URL` (set in Convex prod) builds absolute links.
- Additive only: a new table and new files; no existing table/function/route changes. No migration.
- Copy + commit rules: first person singular, UK English, no em dashes (en dashes allowed), sentence case (no all-caps), no "Claude"/"Anthropic"/AI references anywhere; commits carry NO `Co-Authored-By` trailer and NO "Generated with" footer. Templates are UK-worded (governing law "England and Wales").
- Test runner: vitest `edge-runtime`, includes `convex/**/*.test.ts` and `src/**/*.test.ts`. No jsdom/RTL, so pages/components are verified by `npm run build` + manual QA; Convex functions and pure builders are unit-tested. Known baseline: 5 pre-existing `setMode`/`messageDrafter` failures from a missing local `SITE_URL` — ignore them.
- In Convex-test, scheduled actions run only when the test flushes them. Send/sign state tests must NOT flush the scheduler, so the Resend action never attempts a real network call.
- After each task: commit. Push at the end of the feature (branch is `main`).

---

### Task 1: Schema and talent-release validator

**Files:**
- Create: `convex/lib/documentData.ts`
- Modify: `convex/schema.ts`
- Test: `convex/documents.test.ts` (new; one round-trip test)

**Interfaces:**
- Produces:
  - `talentReleaseDataValidator` / type `TalentReleaseData` = `{ talentName: string; talentEmail?: string; talentPhone?: string; agentName?: string; agentPhone?: string; producerName: string; productionCompany: string; productionTitle: string; compensation?: string; additionalTerms?: string; governingLaw: string }`
  - `documents` table (fields per the spec) with indexes `by_org`, `by_project`, `by_sign_token`.

- [ ] **Step 1: Write the failing test**

Create `convex/documents.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/documents.test.ts`
Expected: FAIL (schema has no `documents` table).

- [ ] **Step 3: Create `convex/lib/documentData.ts`**

```ts
import { Infer, v } from "convex/values";

export const talentReleaseDataValidator = v.object({
  talentName: v.string(),
  talentEmail: v.optional(v.string()),
  talentPhone: v.optional(v.string()),
  agentName: v.optional(v.string()),
  agentPhone: v.optional(v.string()),
  producerName: v.string(),
  productionCompany: v.string(),
  productionTitle: v.string(),
  compensation: v.optional(v.string()),
  additionalTerms: v.optional(v.string()),
  governingLaw: v.string(),
});

export type TalentReleaseData = Infer<typeof talentReleaseDataValidator>;
```

- [ ] **Step 4: Add the `documents` table to `convex/schema.ts`**

Import at the top: `import { talentReleaseDataValidator } from "./lib/documentData";`
Add inside `defineSchema({ ... })`:

```ts
  documents: defineTable({
    orgId: v.id("organisations"),
    projectId: v.optional(v.id("projects")),
    type: v.union(v.literal("talent_release")),
    title: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("declined"),
      v.literal("voided")
    ),
    data: talentReleaseDataValidator,
    signer: v.object({
      name: v.string(),
      email: v.string(),
      personId: v.optional(v.id("people")),
    }),
    signToken: v.string(),
    signature: v.optional(
      v.object({
        typedName: v.string(),
        drawnImage: v.optional(v.string()),
        consent: v.literal(true),
        signedAt: v.number(),
        ip: v.optional(v.string()),
        userAgent: v.optional(v.string()),
      })
    ),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    viewedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    signedPdfFileId: v.optional(v.id("_storage")),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_sign_token", ["signToken"]),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/documents.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/documentData.ts convex/schema.ts convex/documents.test.ts
git commit -m "Add documents table and talent release validator"
```

---

### Task 2: Document CRUD backend

**Files:**
- Create: `convex/documents.ts`
- Test: `convex/documents.test.ts`

**Interfaces:**
- Consumes: `requireOrg` (`convex/lib/auth.ts`), the table from Task 1.
- Produces:
  - `create({ projectId: Id<"projects">, personId?: Id<"people"> }): Id<"documents">` — org-scoped; prefills `data` from the project (title), org (productionCompany), and the person if given (talentName/email/phone); mints a random `signToken`; inserts `status:"draft"`; returns the id.
  - `get({ id }): Doc<"documents"> | null` — org-scoped.
  - `listForProject({ projectId }): Doc<"documents">[]` — org-scoped, newest first.
  - `saveDraft({ id, data })` — org-scoped; only while `draft`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/documents.test.ts` (keep the Task 1 test):

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/documents.test.ts -t "create seeds"`
Expected: FAIL (`api.documents` does not exist).

- [ ] **Step 3: Implement `convex/documents.ts`**

```ts
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { talentReleaseDataValidator } from "./lib/documentData";
import { Doc, Id } from "./_generated/dataModel";

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function requireOwnedDoc(ctx: QueryCtx | MutationCtx, id: Id<"documents">) {
  const { org } = await requireOrg(ctx);
  const doc = await ctx.db.get(id);
  if (!doc || doc.orgId !== org._id) throw new Error("Document not found");
  return { org, doc };
}

export const create = mutation({
  args: { projectId: v.id("projects"), personId: v.optional(v.id("people")) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    const person = args.personId ? await ctx.db.get(args.personId) : null;
    if (person && person.orgId !== org._id) throw new Error("Person not found");
    const talentName = person?.name ?? "";
    const talentEmail = person?.email;
    return await ctx.db.insert("documents", {
      orgId: org._id,
      projectId: args.projectId,
      type: "talent_release",
      title: talentName ? `Talent release: ${talentName}` : "Talent release",
      status: "draft",
      data: {
        talentName,
        talentEmail,
        talentPhone: person?.phone,
        producerName: "",
        productionCompany: org.name,
        productionTitle: project.name,
        governingLaw: "England and Wales",
      },
      signer: { name: talentName, email: talentEmail ?? "", personId: args.personId },
      signToken: newToken(),
    });
  },
});

export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== org._id) return null;
    return doc;
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(200);
    return docs.filter((d) => d.orgId === org._id);
  },
});

export const saveDraft = mutation({
  args: { id: v.id("documents"), data: talentReleaseDataValidator },
  handler: async (ctx, args) => {
    const { doc } = await requireOwnedDoc(ctx, args.id);
    if (doc.status !== "draft") throw new Error("Only a draft can be edited");
    await ctx.db.patch(args.id, { data: args.data, title: `Talent release: ${args.data.talentName || "unnamed"}` });
    return null;
  },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run convex/documents.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add convex/documents.ts convex/documents.test.ts
git commit -m "Add talent release document CRUD"
```

---

### Task 3: Send and invite email

**Files:**
- Modify: `convex/documents.ts` (add `send` mutation + `deliverInvite` internal action)
- Modify: `convex/lib/email.ts` (add `talentReleaseInviteEmail`)
- Test: `convex/documents.test.ts`, `convex/lib/email.test.ts` (new)

**Interfaces:**
- Consumes: `requireOwnedDoc` (Task 2), `FROM`/Resend pattern from `convex/distribution.ts`.
- Produces:
  - `send({ id })` — freezes: rejects unless `draft` and the signer has an email; sets `status:"sent"`, `sentAt`; schedules `internal.documents.deliverInvite`.
  - `talentReleaseInviteEmail({ talentName, productionTitle, productionCompany, signUrl }): { subject: string; html: string }`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/lib/email.test.ts` (new):

```ts
/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { talentReleaseInviteEmail } from "./email";

test("invite email includes the sign link and production, and escapes html", () => {
  const { subject, html } = talentReleaseInviteEmail({
    talentName: "Claire <O'Brien>",
    productionTitle: "Barclays",
    productionCompany: "Klaxon",
    signUrl: "https://unitdeck.app/sign/tok_abc",
  });
  expect(subject).toContain("Barclays");
  expect(html).toContain("https://unitdeck.app/sign/tok_abc");
  expect(html).toContain("Claire &lt;O&#39;Brien&gt;");
  expect(html).not.toContain("<O'Brien>");
});
```

Add to `convex/documents.test.ts`:

```ts
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
```

Do NOT flush scheduled functions in this test, so `deliverInvite` never runs (no real network call).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/lib/email.test.ts convex/documents.test.ts -t "send freezes"`
Expected: FAIL (`talentReleaseInviteEmail`/`documents.send` undefined).

- [ ] **Step 3: Add `talentReleaseInviteEmail` to `convex/lib/email.ts`**

Reuse the existing `escapeHtml`:

```ts
export function talentReleaseInviteEmail(args: {
  talentName: string;
  productionTitle: string;
  productionCompany: string;
  signUrl: string;
}): { subject: string; html: string } {
  const subject = `Please sign your talent release: ${args.productionTitle}`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
  <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#737373;">${escapeHtml(args.productionCompany)}</p>
  <h1 style="margin:6px 0 8px;font-size:22px;color:#171717;">Talent release</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#404040;">Hello ${escapeHtml(args.talentName)}, please review and sign your talent release for ${escapeHtml(args.productionTitle)}.</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#171717;">
    <a href="${args.signUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Review and sign</a>
  </td></tr></table>
  <p style="margin:16px 0 0;font-size:13px;color:#737373;">The link is personal to you, no login needed.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html };
}
```

- [ ] **Step 4: Add `send` and `deliverInvite` to `convex/documents.ts`**

Add imports: `import { internalAction } from "./_generated/server";`, `import { internal } from "./_generated/api";`, `import { talentReleaseInviteEmail } from "./lib/email";`. Add a module-level `const FROM = "UnitDeck <callsheets@mail.unitdeck.app>";`.

```ts
export const send = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { doc } = await requireOwnedDoc(ctx, args.id);
    if (doc.status !== "draft") throw new Error("Only a draft can be sent");
    if (!doc.signer.email) throw new Error("Add the signer's email before sending");
    await ctx.db.patch(args.id, { status: "sent", sentAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.documents.deliverInvite, { id: args.id });
    return null;
  },
});

export const deliverInvite = internalAction({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set in the Convex environment");
    if (!siteUrl) throw new Error("SITE_URL is not set in the Convex environment");
    const doc = await ctx.runQuery(internal.documents.getForInvite, { id: args.id });
    if (!doc) return;
    const { subject, html } = talentReleaseInviteEmail({
      talentName: doc.data.talentName || doc.signer.name,
      productionTitle: doc.data.productionTitle,
      productionCompany: doc.data.productionCompany,
      signUrl: `${siteUrl}/sign/${doc.signToken}`,
    });
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [doc.signer.email], subject, html }),
    });
  },
});
```

Add the internal query it uses:

```ts
import { internalQuery } from "./_generated/server";

export const getForInvite = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run convex/lib/email.test.ts convex/documents.test.ts`
Expected: PASS. (The send test asserts frozen state without flushing the scheduler, so `deliverInvite` never runs.)

- [ ] **Step 6: Commit**

```bash
git add convex/documents.ts convex/lib/email.ts convex/lib/email.test.ts convex/documents.test.ts
git commit -m "Add talent release send and invite email"
```

---

### Task 4: Public signing backend

**Files:**
- Modify: `convex/documents.ts`
- Test: `convex/documents.test.ts`

**Interfaces:**
- Produces (all **public**, token-keyed, no auth):
  - `getBySignToken({ token }): { status, data, signer: { name }, signedAt? } | null` — never returns org internals.
  - `markViewed({ token })` — stamps `viewedAt` once; upgrades `sent`→ (leaves status but records view). No-op if signed/declined.
  - `sign({ token, typedName, drawnImage?, ip?, userAgent? })` — requires a `sent` doc and non-empty `typedName`; stamps `signature` (with `consent:true`), sets `status:"signed"`; rejects a second sign.
  - `decline({ token, reason? })` — sets `status:"declined"`, stamps `declinedAt`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/documents.test.ts`:

```ts
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
  await expect(t.mutation(api.documents.sign, { token, typedName: "" })).rejects.toThrow();
  await t.mutation(api.documents.sign, { token, typedName: "Claire Francis", ip: "1.2.3.4", userAgent: "jsdom" });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("signed");
  expect(doc?.signature?.typedName).toBe("Claire Francis");
  expect(doc?.signature?.consent).toBe(true);
  expect(doc?.signature?.ip).toBe("1.2.3.4");
  await expect(t.mutation(api.documents.sign, { token, typedName: "again" })).rejects.toThrow();
});

test("decline records a declined status", async () => {
  const { t, asA, id, token } = await sentDoc();
  await t.mutation(api.documents.decline, { token, reason: "Not available" });
  const doc = await asA.query(api.documents.get, { id });
  expect(doc?.status).toBe("declined");
  expect(doc?.declineReason).toBe("Not available");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/documents.test.ts -t "getBySignToken"`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Implement in `convex/documents.ts`**

```ts
async function docByToken(ctx: QueryCtx | MutationCtx, token: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_sign_token", (q) => q.eq("signToken", token))
    .unique();
}

export const getBySignToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    return {
      status: doc.status,
      data: doc.data,
      signer: { name: doc.signer.name },
      signedAt: doc.signature?.signedAt ?? null,
    };
  },
});

export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    if (!doc.viewedAt && (doc.status === "sent")) {
      await ctx.db.patch(doc._id, { viewedAt: Date.now() });
    }
    return null;
  },
});

export const sign = mutation({
  args: {
    token: v.string(),
    typedName: v.string(),
    drawnImage: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) throw new Error("Unknown link");
    if (doc.status === "signed") throw new Error("This document is already signed");
    if (doc.status !== "sent") throw new Error("This document cannot be signed");
    if (args.typedName.trim().length === 0) throw new Error("Type your full name to sign");
    await ctx.db.patch(doc._id, {
      status: "signed",
      signature: {
        typedName: args.typedName.trim(),
        drawnImage: args.drawnImage,
        consent: true as const,
        signedAt: Date.now(),
        ip: args.ip,
        userAgent: args.userAgent,
      },
    });
    return null;
  },
});

export const decline = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) throw new Error("Unknown link");
    if (doc.status === "signed") throw new Error("This document is already signed");
    await ctx.db.patch(doc._id, { status: "declined", declinedAt: Date.now(), declineReason: args.reason });
    return null;
  },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run convex/documents.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add convex/documents.ts convex/documents.test.ts
git commit -m "Add public talent release signing backend"
```

---

### Task 5: Talent release render component

**Files:**
- Create: `src/components/documents/talent-release-document.tsx`

**Interfaces:**
- Consumes: `TalentReleaseData` (Task 1) and the signature shape from the table (Task 1).
- Produces: `TalentReleaseDocument({ data, signature }: { data: TalentReleaseData; signature?: { typedName: string; drawnImage?: string; signedAt: number } })`; exported constants `RIGHTS_GRANT_CLAUSE: string` and `CLAUSE_VERSION: string`.

- [ ] **Step 1: Implement the component**

Create `src/components/documents/talent-release-document.tsx`. It is the single source of truth for both the on-screen preview and the PDF (print-safe: A4 width `210mm`, `pt`/`mm` units, no viewport units, dark-on-light). Follow the layout idiom of `src/components/call-sheet/call-sheet-document.tsx`.

- Export a UK-correct grant clause constant and its version:

```tsx
export const CLAUSE_VERSION = "uk-1.0";
export const RIGHTS_GRANT_CLAUSE =
  "The Talent grants the Producer the right to photograph, film and record the Talent's voice and likeness for the Production, to make copies of those recordings, and to use the Talent's name and likeness for the promotion, advertising and distribution of the Production, in all media, worldwide, in perpetuity, unless otherwise stated above. The master recordings remain the property of the Producer. The Talent confirms they are over 18 and have authority to grant these rights. This agreement is governed by the law of {{governingLaw}}.";
```

- Render: a header (production company + "Talent release"), a Talent details block (name/email/phone, agent), a Production details block (producer, company, title), a Payment block (compensation, additional terms), the grant clause (with `{{governingLaw}}` substituted from `data.governingLaw`), and a signature area. When `signature` is present, render the signature block: the typed name in a script-style line, the drawn image (`{signature.drawnImage && <img src={signature.drawnImage} .../>}`) if present, and "Signed electronically on {date}"; otherwise render a blank signature line. Keep all copy UK English, sentence case, no em dashes.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: build succeeds. (No component-test harness; correctness is verified end to end in Task 6/7 QA.)

- [ ] **Step 3: Commit**

```bash
git add src/components/documents/talent-release-document.tsx
git commit -m "Add talent release document render component"
```

---

### Task 6: Public signing page and sign route

**Files:**
- Create: `src/app/sign/[token]/page.tsx`
- Create: `src/app/api/documents/sign/route.ts`

**Interfaces:**
- Consumes: `documents.getBySignToken`/`markViewed`/`decline` (Task 4), `TalentReleaseDocument` (Task 5).
- Produces: a working sign flow that POSTs to `/api/documents/sign` and, on success, generates the signed PDF (Task 7 route) then shows the signed state.

- [ ] **Step 1: Create the sign API route**

Create `src/app/api/documents/sign/route.ts` following `src/app/api/tools/pdf/route.ts` conventions (`runtime = "nodejs"`, `ConvexHttpClient` with `NEXT_PUBLIC_CONVEX_URL`, no auth). It reads the client IP and user agent from the request and calls `documents.sign`, then kicks the signed-PDF generation:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { token?: string; typedName?: string; drawnImage?: string };
  if (!body.token || !/^[a-f0-9]{48}$/.test(body.token)) return NextResponse.json({ error: "token required" }, { status: 400 });
  if (!body.typedName || body.typedName.trim().length === 0) return NextResponse.json({ error: "typed name required" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    await convex.mutation(api.documents.sign, { token: body.token, typedName: body.typedName, drawnImage: body.drawnImage, ip, userAgent });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not sign" }, { status: 400 });
  }
  // Generate and store the signed PDF (best-effort; the signature is already captured)
  try {
    await fetch(`${req.nextUrl.origin}/api/documents/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.token }),
    });
  } catch {}
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create the signing page**

Create `src/app/sign/[token]/page.tsx` as a `"use client"` page modelled on `src/app/s/[token]/page.tsx` (the `Shell`/loading/invalid/expired structure, `use(params)`, `useQuery(getBySignToken)`, `markViewed` on load). It:
- Renders `<TalentReleaseDocument data={result.data} />` read-only inside a scrollable frame.
- If `result.status === "signed"`: show a "Signed" confirmation with a "Download signed PDF" button (POSTs to `/api/documents/pdf`, downloads the blob) and stop.
- If `result.status === "declined"`: show a declined state.
- Otherwise show the sign panel: a typed-name `Input`, a required consent checkbox ("I agree this is my electronic signature"), an optional signature canvas (a `<canvas>` with pointer handlers that captures strokes; a "Clear" button; export via `canvas.toDataURL("image/png")`), and Sign / Decline buttons. Sign is disabled until the typed name is non-empty and consent is ticked. Sign POSTs `{ token, typedName, drawnImage? }` to `/api/documents/sign`; on `ok` the page re-queries (Convex reactivity flips it to the signed state). Decline calls `decline({ token })`.
- Keep copy UK English, sentence case, no em dashes.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA deferred to Task 7 (needs the PDF route).

- [ ] **Step 4: Commit**

```bash
git add "src/app/sign/[token]/page.tsx" src/app/api/documents/sign/route.ts
git commit -m "Add public talent release signing page and sign route"
```

---

### Task 7: Signed PDF (print page, PDF route, storage, signed-copy email)

**Files:**
- Create: `src/app/print/document/[token]/page.tsx`
- Create: `src/app/api/documents/pdf/route.ts`
- Modify: `convex/documents.ts` (public token-keyed `getForPrint`, `generateSignedUploadUrl`, `attachSignedPdf`; `deliverSignedCopy` internal action + `signedCopyEmail`)
- Modify: `convex/lib/email.ts` (add `signedCopyEmail`)
- Test: `convex/documents.test.ts`, `convex/lib/email.test.ts`

**Interfaces:**
- Produces:
  - `getForPrint({ token }): { data, signature } | null` — public; the print page's data source.
  - `generateSignedUploadUrl({ token }): string` — public; validates a signed doc, returns an upload URL.
  - `attachSignedPdf({ token, fileId })` — public; sets `signedPdfFileId` on the signed doc and schedules `internal.documents.deliverSignedCopy`.
  - `signedCopyEmail({ talentName, productionTitle, productionCompany, viewUrl }): { subject, html }`.

- [ ] **Step 1: Write the failing tests**

Add to `convex/lib/email.test.ts`:

```ts
import { signedCopyEmail } from "./email";
test("signed copy email links the document and names the production", () => {
  const { subject, html } = signedCopyEmail({ talentName: "Claire", productionTitle: "Barclays", productionCompany: "Klaxon", viewUrl: "https://unitdeck.app/sign/tok" });
  expect(subject.toLowerCase()).toContain("signed");
  expect(html).toContain("https://unitdeck.app/sign/tok");
  expect(html).toContain("Barclays");
});
```

Add to `convex/documents.test.ts`:

```ts
test("attachSignedPdf stores the file id on a signed doc", async () => {
  const { t, asA, id, token } = await sentDoc();
  await t.mutation(api.documents.sign, { token, typedName: "Claire Francis" });
  const fileId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" })));
  await t.mutation(api.documents.attachSignedPdf, { token, fileId });
  expect((await asA.query(api.documents.get, { id }))?.signedPdfFileId).toBe(fileId);
});
```

(Do NOT flush scheduled functions, so `deliverSignedCopy` does not run in the test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/lib/email.test.ts convex/documents.test.ts -t "attachSignedPdf"`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Add `signedCopyEmail` to `convex/lib/email.ts`**

Mirror `talentReleaseInviteEmail`: subject `Signed: talent release — ${productionTitle}` (use a hyphen, not an em dash), body "Your talent release for {productionTitle} has been signed. You can view or download it here." with a "View signed release" button linking `viewUrl`, `escapeHtml` on all interpolated text.

- [ ] **Step 4: Add the token-keyed functions to `convex/documents.ts`**

```ts
export const getForPrint = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    return { data: doc.data, signature: doc.signature ?? null };
  },
});

export const generateSignedUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed") throw new Error("Not signable");
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachSignedPdf = mutation({
  args: { token: v.string(), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed") throw new Error("Not signable");
    await ctx.db.patch(doc._id, { signedPdfFileId: args.fileId });
    if (doc.signer.email) {
      await ctx.scheduler.runAfter(0, internal.documents.deliverSignedCopy, { id: doc._id });
    }
    return null;
  },
});

export const deliverSignedCopy = internalAction({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey || !siteUrl) throw new Error("Email env not set");
    const doc = await ctx.runQuery(internal.documents.getForInvite, { id: args.id });
    if (!doc) return;
    const { subject, html } = signedCopyEmail({
      talentName: doc.data.talentName || doc.signer.name,
      productionTitle: doc.data.productionTitle,
      productionCompany: doc.data.productionCompany,
      viewUrl: `${siteUrl}/sign/${doc.signToken}`,
    });
    const to = [doc.signer.email].filter(Boolean) as string[];
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
  },
});
```

Add `import { signedCopyEmail } from "./lib/email";`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run convex/lib/email.test.ts convex/documents.test.ts`
Expected: PASS.

- [ ] **Step 6: Create the print page and PDF route**

- `src/app/print/document/[token]/page.tsx` — a server or client page that loads `getForPrint` by token and renders `<TalentReleaseDocument data={data} signature={signature} />` full-bleed (mirror `src/app/print/tool/[token]/page.tsx`).
- `src/app/api/documents/pdf/route.ts` — mirror `src/app/api/tools/pdf/route.ts`: validate the token, launch the browser, navigate to `${origin}/print/document/${token}`, produce the A4 PDF. Then store it: call `generateSignedUploadUrl({ token })`, `fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: Buffer.from(pdf) })`, read `{ storageId }`, call `attachSignedPdf({ token, fileId: storageId })`. Return the PDF bytes with `Content-Disposition: attachment; filename="talent-release.pdf"`.

- [ ] **Step 7: Build and verify end to end**

Run: `npm run build`
Expected: build succeeds. Manual QA: create a release (Task 8), send to a dummy address, open `/sign/[token]` on desktop and mobile, sign with and without a drawn signature, confirm the signed state renders, the downloaded PDF shows the signature block, and `signedPdfFileId` is set.

- [ ] **Step 8: Commit**

```bash
git add "src/app/print/document/[token]/page.tsx" src/app/api/documents/pdf/route.ts convex/documents.ts convex/lib/email.ts convex/lib/email.test.ts convex/documents.test.ts
git commit -m "Add signed talent release PDF and signed copy email"
```

---

### Task 8: Project documents section (composer + list)

**Files:**
- Create: `src/components/documents/release-composer.tsx`
- Create: `src/components/documents/documents-section.tsx`
- Modify: the project page `src/app/(app)/projects/[id]/page.tsx` (mount the documents section)

**Interfaces:**
- Consumes: `documents.create`/`get`/`listForProject`/`saveDraft`/`send` (Tasks 2-3), `TalentReleaseDocument` (Task 5).

- [ ] **Step 1: Inspect the project page**

Read `src/app/(app)/projects/[id]/page.tsx` to find where a new section mounts (follow the existing card/section layout and the `useOrganization`/`useQuery` conventions there).

- [ ] **Step 2: Build the documents section**

`documents-section.tsx` (`"use client"`): given a `projectId`, `useQuery(listForProject)` and render a card titled "Documents" with a "New talent release" button. The button opens a talent picker (a `Select` of the project-relevant `people`, following the crew-picker pattern in `src/components/call-sheet/composer-form.tsx`), then calls `create({ projectId, personId })` and opens the composer. Each listed document shows its title, a status badge (draft/sent/signed/declined), and actions: Edit (draft only), Preview, Send (draft only, with a confirm), and Download signed PDF (signed only, POST `/api/documents/pdf`). Copy is sentence case, UK English.

- [ ] **Step 3: Build the composer**

`release-composer.tsx` (`"use client"`): given a document id, `useQuery(get)` and edit the `data` fields (producer, compensation, additional terms, talent/agent details) with autosave via `saveDraft` (debounced, mirroring the call sheet composer's 800ms autosave), a live `<TalentReleaseDocument data={data} />` preview, and a "Send for signing" action that calls `send` after a confirm. Only editable while `status === "draft"`; once sent, show read-only with the current status.

- [ ] **Step 4: Mount it on the project page**

Add `<DocumentsSection projectId={projectId} />` to `src/app/(app)/projects/[id]/page.tsx` in the project detail layout.

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA (full loop): on a project, New talent release → pick talent → edit compensation → preview → Send → open the emailed `/sign/[token]` → sign → confirm status flips to signed on the project and the signed PDF downloads.

- [ ] **Step 6: Commit and push**

```bash
git add src/components/documents/release-composer.tsx src/components/documents/documents-section.tsx "src/app/(app)/projects/[id]/page.tsx"
git commit -m "Add project documents section and talent release composer"
git push
```

- [ ] **Step 7: Full test + build gate**

Run: `npm test` (expect all pass except the 5 known `setMode`/`messageDrafter` baseline failures).
Run: `npm run build` (expect success). Confirm `git status` shows the branch up to date with `origin/main`.

---

## Self-review notes

- **Spec coverage:** generic `documents` primitive keyed by type (T1); single inline signer (T1); typed name + consent + optional drawn signature (T4 sign, T6 canvas); immutability freeze-on-send / stamp-on-sign (T3 send, T4 sign); IP/audit via Next.js route (T6); data model + talent-release body (T1); backend create/get/list/saveDraft/send + public getBySignToken/markViewed/sign/decline (T2, T3, T4); signing page (T6); signed PDF + print page (T7); render component + UK clause (T5); email invite + signed copy (T3, T7); project documents section + composer + talent picker (T8); backward-compatible/additive (all). All covered.
- **Deferred to future specs (out of scope):** minors/guardian co-signing, multi-signer, producer countersignature, the location release / NDA / risk assessment, bulk send.
- **Test-env note:** send/sign/attach tests must not flush scheduled functions, so the Resend actions never fetch. Email template builders are pure and unit-tested directly.
