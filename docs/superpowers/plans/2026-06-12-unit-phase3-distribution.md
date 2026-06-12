# Unit Phase 3: Distribution, Set Mode and Command Centre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Producers send a call sheet by email to crew; each recipient gets a personalised, no-login set mode page where they confirm, acknowledge safety notes and check in on the day; the dashboard becomes a command centre surfacing unconfirmed crew, unsent call sheets and weather risk.

**Architecture:** Sending freezes the current draft as a `sent` version (same mechanics as snapshot, so the composer remounts on a fresh draft) and upserts one `recipients` row per crew email, each with an unguessable token. A Convex internal action sends each email through Resend's REST API, awaited, with success/failure persisted on a `sends` ledger row and mirrored to the recipient status. The set mode page at `/s/[token]` is public-by-token (mobile-first), reads the latest sent version, and writes status transitions (viewed → confirmed/declined, safety ack, check-in) through token-validated public mutations. The command centre is one org-scoped query that walks upcoming shoot days and emits attention items.

**Tech Stack:** Existing stack. Email via Resend REST (`fetch` from a Convex internal action — no SDK dependency). Sender: `Unit <callsheets@updates.boostkit.io>` (domain verified in Matt's Resend account 2026-06-12; key already in Convex env as `RESEND_API_KEY`). Email-only: Twilio SMS/WhatsApp explicitly deferred (Matt's decision 2026-06-12). Resend delivery webhooks (delivered/bounced) also deferred — API-accept/fail is persisted now; webhook statuses are a fast-follow.

**Environment facts:**
- Convex CLI under Node 22: prefix shells with `$env:Path = "C:\Users\itswe\node22;$env:Path"`.
- `SITE_URL` must be set in the Convex env for absolute set-mode links in emails: `npx convex env set SITE_URL http://localhost:3001` for dev (the dev server runs on 3001 because another project holds 3000); switch to the production URL when Vercel ships.
- Clerk is live; e2e testing uses matt+clerk_test@boostkit.io (code 424242). Real send tests go to matt@boostkit.io.
- Commits in Matt's voice, no AI trailers, push after every task.

**Design decisions locked in:**
- Recipients belong to the **shoot day** (stable across versions), not a call sheet row — the spec's `recipients { callSheetId }` predates the immutable-version model where draft ids churn. Each send records which version went to whom on the `sends` ledger.
- "Send" = freeze draft as `sent` + open next draft. The set mode page always shows the **latest sent** version. Re-sending after edits emails everyone again with an "Updated call sheet" subject. Change highlights between versions: deferred.
- Set-mode links expire 7 days after the shoot date (spec section 6).
- All public mutations are token-validated and idempotent; no rate-limit infra in dev (single-tenant dogfood), revisit before public launch.

---

### Task 1: Schema — recipients and sends ledger

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add two tables** inside `defineSchema({ ... })`, after `renderTokens`:

```ts
  recipients: defineTable({
    orgId: v.id("organisations"),
    shootDayId: v.id("shootDays"),
    personId: v.optional(v.id("people")),
    name: v.string(),
    role: v.string(),
    email: v.string(),
    callTime: v.string(), // "HH:MM"
    token: v.string(), // unguessable, powers the set mode link
    status: v.union(
      v.literal("pending"), // created/re-sent, email not yet accepted
      v.literal("sent"), // Resend accepted the email
      v.literal("failed"), // Resend rejected it; lastError set
      v.literal("viewed"), // opened their set mode page
      v.literal("confirmed"),
      v.literal("declined")
    ),
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
    checkInAt: v.optional(v.number()),
    safetyAckAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_shoot_day", ["shootDayId"])
    .index("by_token", ["token"]),

  sends: defineTable({
    orgId: v.id("organisations"),
    recipientId: v.id("recipients"),
    callSheetId: v.id("callSheets"), // the frozen version that went out
    channel: v.literal("email"),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    providerId: v.optional(v.string()), // Resend email id
    error: v.optional(v.string()),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_call_sheet", ["callSheetId"]),
```

- [ ] **Step 2: Push schema and set SITE_URL** (Node 22 shell):

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"
npx convex env set SITE_URL http://localhost:3001
npx convex dev --once
```

Expected: schema deploys, indexes added.

- [ ] **Step 3: Commit and push**

```powershell
git add convex/schema.ts
git commit -m "Add recipients and sends tables for call sheet distribution"
git push
```

### Task 2: Email template helper (pure, unit-tested)

**Files:**
- Create: `convex/lib/email.ts`
- Test: `convex/email.test.ts`

- [ ] **Step 1: Write failing tests** at `convex/email.test.ts`. The helper is pure (data in, subject/HTML out), so it gets real unit tests:

```ts
/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { callSheetEmail } from "./lib/email";
import type { CallSheetData } from "./lib/callSheetData";

const data: CallSheetData = {
  title: "Brand film",
  date: "2026-06-18",
  generalCallTime: "08:00",
  productionCompany: "Boostkit",
  locations: [
    { id: "loc-1", name: "Studio 1", address: "1 High St, Tunbridge Wells" },
  ],
  schedule: [],
  crew: [],
  contacts: [],
};

describe("callSheetEmail", () => {
  test("first send subject and personalised body", () => {
    const { subject, html } = callSheetEmail({
      data,
      recipientName: "Sam Sound",
      recipientCallTime: "07:30",
      setModeUrl: "https://example.test/s/tok123",
      isUpdate: false,
    });
    expect(subject).toBe("Call sheet: Brand film – Thursday 18 June 2026");
    expect(html).toContain("Sam Sound");
    expect(html).toContain("07:30");
    expect(html).toContain('href="https://example.test/s/tok123"');
    expect(html).toContain("Studio 1");
  });

  test("update send is labelled as updated", () => {
    const { subject, html } = callSheetEmail({
      data,
      recipientName: "Sam",
      recipientCallTime: "07:30",
      setModeUrl: "https://example.test/s/tok123",
      isUpdate: true,
    });
    expect(subject).toBe("Updated call sheet: Brand film – Thursday 18 June 2026");
    expect(html).toContain("updated");
  });

  test("escapes HTML in user-supplied fields", () => {
    const { html } = callSheetEmail({
      data: { ...data, title: '<script>alert("x")</script>' },
      recipientName: "<b>Sam</b>",
      recipientCallTime: "07:30",
      setModeUrl: "https://example.test/s/tok123",
      isUpdate: false,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Sam</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `./lib/email` does not exist.

- [ ] **Step 3: Implement `convex/lib/email.ts`.** Inline-styled HTML (email clients), real anchors (never bare URLs), all dynamic fields escaped:

```ts
import type { CallSheetData } from "./callSheetData";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatEmailDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function callSheetEmail(args: {
  data: CallSheetData;
  recipientName: string;
  recipientCallTime: string;
  setModeUrl: string;
  isUpdate: boolean;
}): { subject: string; html: string } {
  const { data, recipientName, recipientCallTime, setModeUrl, isUpdate } = args;
  const dateText = formatEmailDate(data.date);
  const subject = `${isUpdate ? "Updated call sheet" : "Call sheet"}: ${data.title} – ${dateText}`;
  const firstLocation = data.locations[0];

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#737373;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#171717;">${value}</td></tr>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
  <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#737373;">${escapeHtml(data.productionCompany)}</p>
  <h1 style="margin:6px 0 2px;font-size:22px;color:#171717;">${escapeHtml(data.title)}</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#404040;">${isUpdate ? "Your call sheet has been updated. Please check the latest details below." : "Your call sheet is ready."}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;margin-bottom:24px;">
    ${row("Hello", escapeHtml(recipientName))}
    ${row("Date", escapeHtml(dateText))}
    ${row("Your call time", `<strong>${escapeHtml(recipientCallTime)}</strong>`)}
    ${row("General call", escapeHtml(data.generalCallTime))}
    ${firstLocation ? row("Location", `${escapeHtml(firstLocation.name)}<br/><span style="color:#525252;">${escapeHtml(firstLocation.address)}</span>`) : ""}
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#171717;">
    <a href="${setModeUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Open your call sheet</a>
  </td></tr></table>
  <p style="margin:16px 0 0;font-size:13px;color:#737373;">Please confirm your availability on the page above. The link is personal to you, no login needed.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html };
}
```

- [ ] **Step 4: Run to verify pass:** `npm test` — all green.

- [ ] **Step 5: Commit and push**

```powershell
git add convex/lib/email.ts convex/email.test.ts
git commit -m "Add escaped, inline-styled call sheet email template"
git push
```

### Task 3: Distribution functions — send, recipients, ledger

**Files:**
- Create: `convex/distribution.ts`
- Test: `convex/distribution.test.ts`

**Send contract:**
- `send(shootDayId, recipients[])` — recipients arg is `{ name, role, email, callTime, personId? }` taken from crew rows in the UI. Validates draft exists and list non-empty; freezes draft to `sent` + inserts next draft; upserts `recipients` by (shootDayId, email) — existing rows keep their token and check-in history but reset to `pending` with the new call time; inserts one pending `sends` row per recipient bound to the frozen version; schedules `deliverEmails` and returns the frozen version id.
- `deliverEmails(sendIds)` — internal action; for each send row: compose email, POST Resend, persist outcome (sent + providerId, or failed + error) to both the send row and recipient. Sequential and awaited; one failure never silently drops the rest.
- `listForShootDay(shootDayId)` — org-scoped recipient list for the composer UI.

- [ ] **Step 1: Write failing tests** at `convex/distribution.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA, name: "Brand film", status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA, projectId: projectA, date: "2026-06-18", locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  return { t, ids, asA };
}

const SAM = { name: "Sam Sound", role: "Sound recordist", email: "sam@example.test", callTime: "07:30" };

test("send freezes the draft as sent and opens a new draft", async () => {
  const { asA, ids } = await setup();
  const sentId = await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [SAM],
  });
  const versions = await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA });
  expect(versions.find((s) => s._id === sentId)?.status).toBe("sent");
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(current?.version).toBe(2);
  expect(current?.status).toBe("draft");
});

test("send creates pending recipients and send rows", async () => {
  const { t, asA, ids } = await setup();
  const sentId = await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [SAM],
  });
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(recipients).toHaveLength(1);
  expect(recipients[0].status).toBe("pending");
  expect(recipients[0].token.length).toBeGreaterThanOrEqual(32);
  const sends = await t.run(async (ctx) =>
    ctx.db.query("sends").withIndex("by_call_sheet", (q) => q.eq("callSheetId", sentId)).take(10)
  );
  expect(sends).toHaveLength(1);
  expect(sends[0].status).toBe("pending");
});

test("re-send keeps the recipient token but resets status and call time", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [SAM] });
  const before = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ ...SAM, callTime: "09:00" }],
  });
  const after = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(after).toHaveLength(1);
  expect(after[0].token).toBe(before[0].token);
  expect(after[0].callTime).toBe("09:00");
  expect(after[0].status).toBe("pending");
});

test("send rejects an empty recipient list and bad emails", async () => {
  const { asA, ids } = await setup();
  await expect(
    asA.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [] })
  ).rejects.toThrow("At least one recipient");
  await expect(
    asA.mutation(api.distribution.send, {
      shootDayId: ids.dayA,
      recipients: [{ ...SAM, email: "not-an-email" }],
    })
  ).rejects.toThrow("Invalid email");
});

test("cross-org send is rejected", async () => {
  const { t, asA, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  await expect(
    asB.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [SAM] })
  ).rejects.toThrow("Shoot day not found");
});
```

- [ ] **Step 2: Run to verify failure:** `npm test` — `api.distribution` missing.

- [ ] **Step 3: Implement `convex/distribution.ts`:**

```ts
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { callSheetEmail } from "./lib/email";
import { Id } from "./_generated/dataModel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FROM = "Unit <callsheets@updates.boostkit.io>";

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const listForShootDay = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    return await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", args.shootDayId))
      .take(200);
  },
});

export const send = mutation({
  args: {
    shootDayId: v.id("shootDays"),
    recipients: v.array(
      v.object({
        name: v.string(),
        role: v.string(),
        email: v.string(),
        callTime: v.string(),
        personId: v.optional(v.id("people")),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    if (args.recipients.length === 0) throw new Error("At least one recipient is required");
    for (const r of args.recipients) {
      if (!EMAIL_RE.test(r.email)) throw new Error(`Invalid email: ${r.email}`);
      if (r.name.trim() === "") throw new Error("Recipient name is required");
    }

    // Freeze the draft as the sent version, open the next draft
    const draft = await ctx.db
      .query("callSheets")
      .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", args.shootDayId))
      .order("desc")
      .first();
    if (!draft || draft.status !== "draft") throw new Error("No draft to send");
    const isUpdate = draft.version > 1;
    await ctx.db.patch(draft._id, { status: "sent", versionNote: "Sent to crew" });
    await ctx.db.insert("callSheets", {
      orgId: org._id,
      shootDayId: args.shootDayId,
      projectId: draft.projectId,
      version: draft.version + 1,
      status: "draft",
      data: draft.data,
    });

    // Upsert recipients by (shootDay, email); tokens survive re-sends
    const existing = await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", args.shootDayId))
      .take(200);
    const sendIds: Id<"sends">[] = [];
    for (const r of args.recipients) {
      const email = r.email.trim().toLowerCase();
      const found = existing.find((e) => e.email === email);
      let recipientId: Id<"recipients">;
      if (found) {
        await ctx.db.patch(found._id, {
          name: r.name.trim(),
          role: r.role.trim(),
          callTime: r.callTime,
          personId: r.personId,
          status: "pending",
          lastError: undefined,
        });
        recipientId = found._id;
      } else {
        recipientId = await ctx.db.insert("recipients", {
          orgId: org._id,
          shootDayId: args.shootDayId,
          personId: r.personId,
          name: r.name.trim(),
          role: r.role.trim(),
          email,
          callTime: r.callTime,
          token: newToken(),
          status: "pending",
        });
      }
      sendIds.push(
        await ctx.db.insert("sends", {
          orgId: org._id,
          recipientId,
          callSheetId: draft._id,
          channel: "email",
          status: "pending",
        })
      );
    }

    await ctx.scheduler.runAfter(0, internal.distribution.deliverEmails, {
      sendIds,
      isUpdate,
    });
    return draft._id;
  },
});

export const getSendPayload = internalQuery({
  args: { sendId: v.id("sends") },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return null;
    const recipient = await ctx.db.get(send.recipientId);
    const sheet = await ctx.db.get(send.callSheetId);
    if (!recipient || !sheet) return null;
    return { send, recipient, sheet };
  },
});

export const recordSendResult = internalMutation({
  args: {
    sendId: v.id("sends"),
    ok: v.boolean(),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return null;
    if (args.ok) {
      await ctx.db.patch(args.sendId, { status: "sent", providerId: args.providerId });
      await ctx.db.patch(send.recipientId, { status: "sent", sentAt: Date.now() });
    } else {
      await ctx.db.patch(args.sendId, { status: "failed", error: args.error });
      await ctx.db.patch(send.recipientId, { status: "failed", lastError: args.error });
    }
    return null;
  },
});

/**
 * Sends every email, awaited, one at a time. Each outcome is persisted
 * before the next send starts — a crash mid-batch leaves an accurate ledger
 * (engineering rule: no fire-and-forget sends, ever).
 */
export const deliverEmails = internalAction({
  args: { sendIds: v.array(v.id("sends")), isUpdate: v.boolean() },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set in the Convex environment");
    if (!siteUrl) throw new Error("SITE_URL is not set in the Convex environment");

    for (const sendId of args.sendIds) {
      const payload = await ctx.runQuery(internal.distribution.getSendPayload, { sendId });
      if (!payload) continue;
      const { recipient, sheet } = payload;
      const { subject, html } = callSheetEmail({
        data: sheet.data,
        recipientName: recipient.name,
        recipientCallTime: recipient.callTime,
        setModeUrl: `${siteUrl}/s/${recipient.token}`,
        isUpdate: args.isUpdate,
      });
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM, to: [recipient.email], subject, html }),
        });
        if (res.ok) {
          const json = (await res.json()) as { id: string };
          await ctx.runMutation(internal.distribution.recordSendResult, {
            sendId, ok: true, providerId: json.id,
          });
        } else {
          const text = await res.text();
          await ctx.runMutation(internal.distribution.recordSendResult, {
            sendId, ok: false, error: `Resend ${res.status}: ${text.slice(0, 500)}`,
          });
        }
      } catch (err) {
        await ctx.runMutation(internal.distribution.recordSendResult, {
          sendId, ok: false, error: err instanceof Error ? err.message : "Unknown send error",
        });
      }
    }
    return null;
  },
});
```

- [ ] **Step 4: Run to verify pass:** `npm test` — all green (the action itself is not unit-tested; the mutation/ledger logic is, and the action is e2e-verified in Task 7).

- [ ] **Step 5: Deploy, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
git add convex/distribution.ts convex/distribution.test.ts
git commit -m "Add call sheet send flow with recipient upserts and awaited email ledger"
git push
```

### Task 4: Set mode — public token functions

**Files:**
- Create: `convex/setMode.ts`
- Test: `convex/setMode.test.ts`

**Contract:** `getByToken(token)` returns `{ recipient: <public fields only>, data: <latest sent version data>, expired: false }` or `null` (unknown token) or `{ expired: true }` (past shoot date + 7 days). Mutations `markViewed`, `confirm`, `decline`, `ackSafety`, `checkIn` are all token-validated, idempotent, and never expose org data.

- [ ] **Step 1: Write failing tests** at `convex/setMode.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupSent(date = "2026-06-18") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA, name: "Brand film", status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA, projectId: projectA, date, locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ name: "Sam", role: "Sound", email: "sam@example.test", callTime: "07:30" }],
  });
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  return { t, ids, asA, token: recipients[0].token };
}

test("getByToken returns sheet data and recipient, without org internals", async () => {
  const { t, token } = await setupSent();
  const result = await t.query(api.setMode.getByToken, { token });
  expect(result).not.toBeNull();
  if (!result || result.expired) throw new Error("expected live payload");
  expect(result.data.title).toBe("Brand film");
  expect(result.recipient.name).toBe("Sam");
  expect(result.recipient.callTime).toBe("07:30");
  expect("orgId" in result.recipient).toBe(false);
});

test("unknown token returns null", async () => {
  const { t } = await setupSent();
  expect(await t.query(api.setMode.getByToken, { token: "nope" })).toBeNull();
});

test("link expires 7 days after the shoot date", async () => {
  const { t, token } = await setupSent("2020-01-01");
  const result = await t.query(api.setMode.getByToken, { token });
  expect(result).toEqual({ expired: true });
});

test("confirm and decline transitions stamp times and are idempotent", async () => {
  const { t, asA, ids, token } = await setupSent();
  await t.mutation(api.setMode.markViewed, { token });
  await t.mutation(api.setMode.confirm, { token });
  await t.mutation(api.setMode.confirm, { token }); // second call is a no-op
  let list = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(list[0].status).toBe("confirmed");
  expect(list[0].viewedAt).toBeDefined();
  expect(list[0].confirmedAt).toBeDefined();
  await t.mutation(api.setMode.decline, { token }); // crew can change their mind
  list = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(list[0].status).toBe("declined");
});

test("safety ack and check-in stamp once", async () => {
  const { t, asA, ids, token } = await setupSent();
  await t.mutation(api.setMode.ackSafety, { token });
  await t.mutation(api.setMode.checkIn, { token });
  const list = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  const first = { safety: list[0].safetyAckAt, checkIn: list[0].checkInAt };
  expect(first.safety).toBeDefined();
  expect(first.checkIn).toBeDefined();
  await t.mutation(api.setMode.ackSafety, { token });
  await t.mutation(api.setMode.checkIn, { token });
  const again = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  expect(again[0].safetyAckAt).toBe(first.safety); // not re-stamped
  expect(again[0].checkInAt).toBe(first.checkIn);
});
```

- [ ] **Step 2: Run to verify failure:** `npm test` — `api.setMode` missing.

- [ ] **Step 3: Implement `convex/setMode.ts`:**

```ts
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

const EXPIRY_DAYS_AFTER_SHOOT = 7;

async function recipientByToken(ctx: QueryCtx | MutationCtx, token: string) {
  return await ctx.db
    .query("recipients")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

function isExpired(shootDate: string): boolean {
  const [y, m, d] = shootDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const cutoff = Date.UTC(y, m - 1, d) + (EXPIRY_DAYS_AFTER_SHOOT + 1) * 24 * 60 * 60 * 1000;
  return Date.now() > cutoff;
}

async function latestSentSheet(ctx: QueryCtx | MutationCtx, shootDayId: Doc<"recipients">["shootDayId"]) {
  const versions = await ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", shootDayId))
    .order("desc")
    .take(20);
  return versions.find((s) => s.status === "sent") ?? null;
}

/**
 * Public by token. Returns only what crew need: the sent document and their
 * own row's public fields. Never returns org ids or other recipients.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const recipient = await recipientByToken(ctx, args.token);
    if (!recipient) return null;
    const day = await ctx.db.get(recipient.shootDayId);
    if (!day) return null;
    if (isExpired(day.date)) return { expired: true as const };
    const sheet = await latestSentSheet(ctx, recipient.shootDayId);
    if (!sheet) return null;
    return {
      expired: false as const,
      data: sheet.data,
      version: sheet.version,
      recipient: {
        name: recipient.name,
        role: recipient.role,
        callTime: recipient.callTime,
        status: recipient.status,
        safetyAckAt: recipient.safetyAckAt ?? null,
        checkInAt: recipient.checkInAt ?? null,
      },
    };
  },
});

async function liveRecipient(ctx: MutationCtx, token: string) {
  const recipient = await recipientByToken(ctx, token);
  if (!recipient) throw new Error("Unknown link");
  const day = await ctx.db.get(recipient.shootDayId);
  if (!day || isExpired(day.date)) throw new Error("This link has expired");
  return recipient;
}

export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    const patch: Record<string, unknown> = {};
    if (!r.viewedAt) patch.viewedAt = Date.now();
    // Only upgrade pending/sent → viewed; never downgrade confirmed/declined
    if (r.status === "pending" || r.status === "sent" || r.status === "failed") {
      patch.status = "viewed";
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(r._id, patch);
    return null;
  },
});

export const confirm = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (r.status === "confirmed") return null;
    await ctx.db.patch(r._id, { status: "confirmed", confirmedAt: Date.now() });
    return null;
  },
});

export const decline = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (r.status === "declined") return null;
    await ctx.db.patch(r._id, { status: "declined", declinedAt: Date.now() });
    return null;
  },
});

export const ackSafety = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (!r.safetyAckAt) await ctx.db.patch(r._id, { safetyAckAt: Date.now() });
    return null;
  },
});

export const checkIn = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (!r.checkInAt) await ctx.db.patch(r._id, { checkInAt: Date.now() });
    return null;
  },
});
```

- [ ] **Step 4: Run to verify pass:** `npm test` — all green.

- [ ] **Step 5: Deploy, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
git add convex/setMode.ts convex/setMode.test.ts
git commit -m "Add token-validated set mode queries and status transitions"
git push
```

### Task 5: Set mode page (mobile-first, no login)

**Files:**
- Create: `src/app/s/[token]/page.tsx`

`/s/...` is not in the protected-route matcher, so Clerk lets it through. The page is a client component (live status via `useQuery`); Convex public queries work unauthenticated.

- [ ] **Step 1: Create the page:**

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export default function SetModePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const result = useQuery(api.setMode.getByToken, { token });
  const markViewed = useMutation(api.setMode.markViewed);
  const confirm = useMutation(api.setMode.confirm);
  const decline = useMutation(api.setMode.decline);
  const ackSafety = useMutation(api.setMode.ackSafety);
  const checkIn = useMutation(api.setMode.checkIn);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (result && !result.expired) void markViewed({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result === undefined, token]);

  if (result === undefined) {
    return <Shell><p className="text-sm text-neutral-500">Loading your call sheet…</p></Shell>;
  }
  if (result === null) {
    return <Shell><p className="text-sm">This link isn&apos;t valid. Check with your producer.</p></Shell>;
  }
  if (result.expired) {
    return <Shell><p className="text-sm">This call sheet link has expired.</p></Shell>;
  }

  const { data, recipient } = result;
  const isShootDayOrLater = data.date <= new Date().toISOString().slice(0, 10);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <Shell>
      {/* Header */}
      <p className="text-[11px] uppercase tracking-widest text-neutral-500">{data.productionCompany}</p>
      <h1 className="mt-1 text-xl font-bold">{data.title}</h1>
      <p className="mt-0.5 text-sm text-neutral-600">{formatDate(data.date)}</p>

      {/* My call */}
      <div className="mt-4 rounded-xl bg-neutral-900 p-4 text-white">
        <p className="text-xs uppercase tracking-widest text-neutral-400">Your call time</p>
        <p className="text-3xl font-bold tabular-nums">{recipient.callTime}</p>
        <p className="mt-1 text-sm text-neutral-300">
          {recipient.name} · {recipient.role} · General call {data.generalCallTime}
        </p>
      </div>

      {/* Confirm / decline */}
      <div className="mt-3">
        {recipient.status === "confirmed" ? (
          <div className="flex items-center justify-between rounded-lg border border-green-300 bg-green-50 px-4 py-3">
            <p className="text-sm font-medium text-green-800">You&apos;re confirmed. See you on set.</p>
            <button className="text-xs text-green-700 underline" disabled={busy}
              onClick={() => act(() => decline({ token }))}>
              Can&apos;t make it?
            </button>
          </div>
        ) : recipient.status === "declined" ? (
          <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-800">You&apos;ve declined this shoot.</p>
            <button className="text-xs text-red-700 underline" disabled={busy}
              onClick={() => act(() => confirm({ token }))}>
              Changed your mind?
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12" disabled={busy} onClick={() => act(() => confirm({ token }))}>
              Confirm availability
            </Button>
            <Button variant="outline" className="h-12" disabled={busy}
              onClick={() => act(() => decline({ token }))}>
              Decline
            </Button>
          </div>
        )}
      </div>

      {/* Day facts */}
      {(data.weatherSummary || data.sunrise || data.sunset) && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600">
          {data.weatherSummary && <span>{data.weatherSummary}</span>}
          {data.sunrise && <span>Sunrise {data.sunrise}</span>}
          {data.sunset && <span>Sunset {data.sunset}</span>}
        </div>
      )}

      {/* Locations */}
      {data.locations.length > 0 && (
        <Section title="Locations">
          {data.locations.map((loc, i) => (
            <div key={loc.id} className="rounded-lg border border-neutral-200 p-3">
              <p className="text-sm font-semibold">{i + 1}. {loc.name}</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-neutral-600">{loc.address}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <a className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer"
                  href={mapsUrl(loc.address)}>
                  Open in Maps
                </a>
                {loc.w3w && <span className="text-neutral-500">{loc.w3w}</span>}
              </div>
              {loc.parkingNotes && (
                <p className="mt-2 text-xs text-neutral-600">Parking: {loc.parkingNotes}</p>
              )}
              {loc.nearestHospital && (
                <p className="mt-1 text-xs text-neutral-600">Nearest A&amp;E: {loc.nearestHospital}</p>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Schedule */}
      {data.schedule.length > 0 && (
        <Section title="Schedule">
          <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
            {data.schedule.map((b) => (
              <div key={b.id} className="flex gap-3 px-3 py-2">
                <p className="w-24 shrink-0 text-sm font-semibold tabular-nums">
                  {b.start}{b.end ? `–${b.end}` : ""}
                </p>
                <div>
                  <p className="text-sm">{b.title}</p>
                  {b.notes && <p className="text-xs text-neutral-500">{b.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Contacts */}
      {data.contacts.length > 0 && (
        <Section title="Key contacts">
          <div className="space-y-1">
            {data.contacts.map((c) => (
              <p key={c.id} className="text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-neutral-500"> ({c.role}) </span>
                <a className="underline underline-offset-2" href={`tel:${c.phone.replace(/\s/g, "")}`}>
                  {c.phone}
                </a>
              </p>
            ))}
          </div>
        </Section>
      )}

      {/* Notes */}
      {data.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line text-sm text-neutral-700">{data.notes}</p>
        </Section>
      )}

      {/* Safety */}
      {data.safetyNotes && (
        <Section title="Safety">
          <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
            <p className="whitespace-pre-line text-sm text-amber-900">{data.safetyNotes}</p>
            {recipient.safetyAckAt ? (
              <p className="mt-2 text-xs font-medium text-amber-800">
                Acknowledged {new Date(recipient.safetyAckAt).toLocaleString("en-GB")}
              </p>
            ) : (
              <Button size="sm" className="mt-3" disabled={busy}
                onClick={() => act(() => ackSafety({ token }))}>
                I&apos;ve read the safety notes
              </Button>
            )}
          </div>
        </Section>
      )}

      {/* Check-in (shoot day onwards) */}
      <div className="mt-6 border-t border-neutral-200 pt-4 pb-10">
        {recipient.checkInAt ? (
          <p className="text-center text-sm font-medium text-green-700">
            Checked in at {new Date(recipient.checkInAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </p>
        ) : isShootDayOrLater ? (
          <Button className="h-12 w-full" disabled={busy} onClick={() => act(() => checkIn({ token }))}>
            Check in on set
          </Button>
        ) : (
          <p className="text-center text-xs text-neutral-400">
            Check-in opens on the shoot day.
          </p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-md px-4 py-6">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Build check:** `npm run build` — `/s/[token]` appears in the route list.

- [ ] **Step 3: Commit and push**

```powershell
git add src/app/s
git commit -m "Add mobile set mode page with confirm, safety ack and check-in"
git push
```

### Task 6: Send dialog + recipient tracking in the composer

**Files:**
- Create: `src/components/call-sheet/send-dialog.tsx`
- Modify: `src/app/(app)/projects/[id]/shoot-days/[shootDayId]/call-sheet/page.tsx` (toolbar: add Send button + recipient status strip)

- [ ] **Step 1: Create `src/components/call-sheet/send-dialog.tsx`.** Recipient candidates come from crew rows that have an email; rows without one are listed as un-sendable so producers know who is missing:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { CallSheetData } from "../../../convex/lib/callSheetData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SendDialog({
  dayId,
  data,
  onClose,
}: {
  dayId: Id<"shootDays">;
  data: CallSheetData;
  onClose: () => void;
}) {
  const send = useMutation(api.distribution.send);
  const sendable = data.crew.filter((c) => c.email && c.email.includes("@"));
  const missingEmail = data.crew.filter((c) => !c.email || !c.email.includes("@"));
  const [selected, setSelected] = useState<Set<string>>(new Set(sendable.map((c) => c.id)));
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send call sheet</DialogTitle>
        </DialogHeader>
        {sendable.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No crew members have an email address yet. Add emails to crew rows first (pick people
            from your People database to fill them automatically).
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-neutral-500">
              Sending freezes this version and emails each person a personal link. They confirm on
              the page, no login needed.
            </p>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              {sendable.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setSelected(next);
                    }}
                  />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-neutral-500">{c.role} · {c.email} · call {c.callTime}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {missingEmail.length > 0 && (
          <p className="text-xs text-amber-600">
            No email, can&apos;t send: {missingEmail.map((c) => c.name || "(unnamed)").join(", ")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || selected.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await send({
                  shootDayId: dayId,
                  recipients: sendable
                    .filter((c) => selected.has(c.id))
                    .map((c) => ({
                      name: c.name,
                      role: c.role,
                      email: c.email!,
                      callTime: c.callTime,
                      personId: c.personId,
                    })),
                });
                toast.success(`Call sheet sent to ${selected.size} ${selected.size === 1 ? "person" : "people"}.`);
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Send failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : `Send to ${selected.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "Sending", className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  viewed: { label: "Viewed", className: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300" },
  confirmed: { label: "Confirmed", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  declined: { label: "Declined", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

export function RecipientStrip({ dayId }: { dayId: Id<"shootDays"> }) {
  const recipients = useQuery(api.distribution.listForShootDay, { shootDayId: dayId });
  if (!recipients || recipients.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-6 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      {recipients.map((r) => {
        const s = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
        return (
          <span key={r._id} title={r.lastError ?? undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
            {r.name}
            <span className="opacity-70">· {s.label}{r.checkInAt ? " · On set" : ""}</span>
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the composer** (`.../call-sheet/page.tsx`):
  - Import: `import { SendDialog, RecipientStrip } from "@/components/call-sheet/send-dialog";`
  - Add state in `Composer`: `const [sendOpen, setSendOpen] = useState(false);`
  - Toolbar: replace the `Save version` / `Export PDF` cluster's end with a primary Send button — `Export PDF` becomes `variant="secondary"`, and add after it:

```tsx
          <Button size="sm" onClick={() => setSendOpen(true)}>
            Send
          </Button>
```

  - Directly under the toolbar `</div>` (before the editor flex container): `<RecipientStrip dayId={dayId} />`
  - Before the closing tag, alongside the history dialog: `{sendOpen && <SendDialog dayId={dayId} data={data} onClose={() => setSendOpen(false)} />}`

- [ ] **Step 3: Build, commit, push**

```powershell
npm run build
git add src/components/call-sheet/send-dialog.tsx "src/app/(app)/projects/[id]/shoot-days/[shootDayId]/call-sheet/page.tsx"
git commit -m "Add send dialog and live recipient status strip to the composer"
git push
```

### Task 7: Command centre dashboard

**Files:**
- Create: `convex/dashboard.ts`
- Modify: `src/app/(app)/dashboard/page.tsx` (replace the "Needs attention" placeholder card)
- Test: `convex/dashboard.test.ts`

- [ ] **Step 1: Write failing tests** at `convex/dashboard.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("attention feed flags unsent sheets, unconfirmed crew and missing pieces", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA, name: "Brand film", status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA, projectId: projectA, date: future, locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  // Unsent draft: expect a "not sent" item plus missing-schedule/crew flags
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  let items = await asA.query(api.dashboard.attention, {});
  expect(items.some((i) => i.kind === "call_sheet_not_sent")).toBe(true);
  expect(items.some((i) => i.kind === "no_crew")).toBe(true);

  // After sending, the unsent flag clears and unconfirmed appears
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ name: "Sam", role: "Sound", email: "sam@example.test", callTime: "07:30" }],
  });
  items = await asA.query(api.dashboard.attention, {});
  expect(items.some((i) => i.kind === "call_sheet_not_sent")).toBe(false);
  expect(items.some((i) => i.kind === "unconfirmed_crew")).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure:** `npm test` — `api.dashboard` missing.

- [ ] **Step 3: Implement `convex/dashboard.ts`:**

```ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";

export type AttentionItem = {
  kind:
    | "call_sheet_not_sent"
    | "unconfirmed_crew"
    | "declined_crew"
    | "failed_sends"
    | "no_crew"
    | "no_schedule"
    | "no_locations"
    | "weather_risk";
  projectId: Id<"projects">;
  projectName: string;
  shootDayId: Id<"shootDays">;
  date: string;
  label: string;
};

const ACTIVE = new Set(["brief", "pre_production", "shooting", "post"]);

export const attention = query({
  args: {},
  handler: async (ctx): Promise<AttentionItem[]> => {
    const { org } = await requireOrg(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(200);
    const byId = new Map(projects.filter((p) => ACTIVE.has(p.status)).map((p) => [p._id, p]));

    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    const upcoming = days
      .filter((d) => d.date >= today && byId.has(d.projectId))
      .sort((a, b) => a.date.localeCompare(b.date));

    const items: AttentionItem[] = [];
    for (const day of upcoming) {
      const project = byId.get(day.projectId)!;
      const base = {
        projectId: project._id,
        projectName: project.name,
        shootDayId: day._id,
        date: day.date,
      };

      const versions = await ctx.db
        .query("callSheets")
        .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", day._id))
        .order("desc")
        .take(20);
      const sent = versions.find((s) => s.status === "sent") ?? null;
      const latest = versions[0] ?? null;
      const data = latest?.data;

      if (!sent) {
        items.push({ ...base, kind: "call_sheet_not_sent", label: "Call sheet not sent yet" });
      }
      if (data && data.crew.length === 0) {
        items.push({ ...base, kind: "no_crew", label: "No crew on the call sheet" });
      }
      if (data && data.schedule.length === 0) {
        items.push({ ...base, kind: "no_schedule", label: "No schedule blocks yet" });
      }
      if (data && data.locations.length === 0) {
        items.push({ ...base, kind: "no_locations", label: "No locations attached" });
      }
      if (
        day.weather?.precipitationProbability !== undefined &&
        day.weather.precipitationProbability >= 60
      ) {
        items.push({
          ...base,
          kind: "weather_risk",
          label: `Weather risk: ${day.weather.summary}, ${day.weather.precipitationProbability}% rain`,
        });
      }

      const recipients: Doc<"recipients">[] = await ctx.db
        .query("recipients")
        .withIndex("by_shoot_day", (q) => q.eq("shootDayId", day._id))
        .take(200);
      const unconfirmed = recipients.filter(
        (r) => r.status === "sent" || r.status === "viewed" || r.status === "pending"
      );
      const declined = recipients.filter((r) => r.status === "declined");
      const failed = recipients.filter((r) => r.status === "failed");
      if (sent && unconfirmed.length > 0) {
        items.push({
          ...base,
          kind: "unconfirmed_crew",
          label: `${unconfirmed.length} of ${recipients.length} crew not confirmed`,
        });
      }
      if (declined.length > 0) {
        items.push({
          ...base,
          kind: "declined_crew",
          label: `${declined.map((r) => r.name).join(", ")} declined`,
        });
      }
      if (failed.length > 0) {
        items.push({
          ...base,
          kind: "failed_sends",
          label: `Email failed for ${failed.map((r) => r.name).join(", ")}`,
        });
      }
    }
    return items;
  },
});
```

- [ ] **Step 4: Run to verify pass:** `npm test` — all green.

- [ ] **Step 5: Replace the placeholder card** in `src/app/(app)/dashboard/page.tsx`. Add to imports:

```tsx
import { Badge } from "@/components/ui/badge";
```

Add the query inside `DashboardPage` beside the others:

```tsx
  const attention = useQuery(api.dashboard.attention, organization ? {} : "skip");
```

Replace the entire `<Card className="mt-6">…</Card>` block with:

```tsx
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Needs attention</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {attention === undefined ? (
            <Skeleton className="h-5 w-64" />
          ) : attention.length === 0 ? (
            <p className="text-neutral-500">
              Nothing needs attention. Upcoming shoot days with unsent call sheets, unconfirmed
              crew or weather risk will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {attention.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.label}</p>
                    <p className="text-xs text-neutral-500">
                      {item.projectName} · {item.date}
                    </p>
                  </div>
                  <Link
                    className="shrink-0 text-xs underline underline-offset-2"
                    href={`/projects/${item.projectId}/shoot-days/${item.shootDayId}/call-sheet`}
                  >
                    Open call sheet
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
```

(If the `Badge` import ends up unused, drop it — lint will say.)

- [ ] **Step 6: Deploy, build, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
npm run build
git add convex/dashboard.ts convex/dashboard.test.ts "src/app/(app)/dashboard/page.tsx"
git commit -m "Add command centre attention feed to the dashboard"
git push
```

### Task 8: End-to-end dogfood + verification pass

- [ ] **Step 1: Full suite + lint:** `npm test` and `npm run lint` — clean (4 pre-existing warnings in generated files are acceptable).

- [ ] **Step 2: Live e2e with a real email.** With the dev server running and signed in as matt+clerk_test@boostkit.io: open the existing test call sheet, add a crew row with email `matt@boostkit.io`, call time 07:30, Send. Verify:
  - Recipient strip appears and progresses pending → Sent.
  - The email arrives at matt@boostkit.io from `callsheets@updates.boostkit.io` with a working `/s/<token>` link (subject contains "Call sheet:").
  - Opening the link shows set mode with the right call time; recipient flips to Viewed on the strip in realtime; Confirm flips it to Confirmed.
  - Dashboard attention feed reflects the state (unconfirmed before confirming, clean after).
- [ ] **Step 3: `git status`** — clean and pushed.
- [ ] **Step 4: Report**, including deferred items: Twilio SMS, Resend delivery webhooks, change-highlight re-sends, rate limiting on public endpoints before any non-dogfood user, wrap report (Phase 5).

---

**Self-review notes:** Covers spec section 3 distribution scope minus the explicitly deferred items (SMS via Twilio per Matt 2026-06-12, change highlights, documents in set mode — documents table doesn't exist until later). Set mode covers call time, role, map links, parking, contacts, schedule, check-in, safety acknowledgement (spec list). Command centre covers unconfirmed crew, missing fields, weather risk, unsent call sheet (risk assessment items come with the documents module). Send semantics reuse the freeze-and-insert mechanics from Phase 2 so the composer's remount-by-key model keeps working. Type check: `distribution.send` recipient arg shape matches `SendDialog`'s mapped crew rows; `setMode.getByToken` return shape matches the page's usage; `dashboard.attention` item kinds match the test's assertions. No placeholder steps.
