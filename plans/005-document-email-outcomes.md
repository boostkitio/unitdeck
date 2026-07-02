# Plan 005: Record and surface document email delivery outcomes via one shared Resend transport

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b4ba125..HEAD -- convex/documents.ts convex/distribution.ts convex/agents/messageDrafter.ts convex/feedback.ts convex/lib/email.ts convex/schema.ts src/components/documents`
> The multi-type documents build (location release + NDA) may land before this
> plan and renames the email builders; that is fine, the transport and outcome
> mechanics below are unchanged, but re-read `convex/documents.ts` and
> `convex/lib/email.ts` before editing. On any other mismatch with the
> excerpts, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches every email path; the suite plus one manual send must pass)
- **Depends on**: plans/001-green-test-baseline.md (the suite must be green to catch regressions here)
- **Category**: bug
- **Planned at**: commit `b4ba125`, 2026-07-02

## Why this matters

When a talent release invite email fails to send, nobody finds out. The `send`
mutation marks the document `sent` and schedules `deliverInvite`; if Resend
returns an error, the scheduled action throws (Convex does not retry scheduled
actions), the document stays `sent`, and the UI shows success while the talent
never received anything. The call sheet flow already solved this properly:
`distribution.ts` persists a per-send ledger (`recordSendResult`) and the UI
shows failed sends. The documents flow predates nothing, it simply didn't copy
the pattern. Root enabler: the raw Resend `fetch` block is copy-pasted in five
places, so the flows drift. This plan extracts one `sendEmail` transport
helper, uses it everywhere, records the invite outcome on the document, and
surfaces failure in the documents UI with a retry.

## Current state

- The duplicated transport (five sites, near-identical):
  - `convex/documents.ts:127-136` (`deliverInvite`) and `:267-276`
    (`deliverSignedCopy`) — throw on failure, nothing persisted.
  - `convex/distribution.ts:182-208` (`deliverEmails`) — persists outcomes via
    `internal.distribution.recordSendResult`.
  - `convex/agents/messageDrafter.ts:222-252` (`deliverChase`) — same ledger
    pattern as distribution.
  - `convex/feedback.ts:143` area (`notify`) — internal notification email.
- The shape of the raw block being extracted (from `convex/documents.ts:127-136`):

```ts
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: FROM, to: [doc.signer.email], subject, html }),
});
if (!res.ok) {
  const text = await res.text();
  console.error("Resend send failed", res.status, text.slice(0, 500));
  throw new Error(`Resend ${res.status}`);
}
```

- `convex/documents.ts:95-105` — `send` flips status then schedules delivery:

```ts
await ctx.db.patch(args.id, { status: "sent", sentAt: Date.now() });
await ctx.scheduler.runAfter(0, internal.documents.deliverInvite, { id: args.id });
```

- `documents` table (`convex/schema.ts:215-252`) has no delivery-outcome
  field; statuses are `draft|sent|signed|declined|voided` (keep these; a
  failed email is a delivery attribute, not a document status).
- UI: `src/components/documents/documents-section.tsx` renders per-document
  rows with `StatusBadge` (`src/components/documents/document-status.tsx`,
  which maps the five statuses to badge styles).
- `FROM` constant is currently duplicated too:
  `"UnitDeck <callsheets@mail.unitdeck.app>"` in `documents.ts:9`,
  `distribution.ts:9`, and messageDrafter/feedback equivalents.
- Test note: `vitest.setup.ts` (added by plan 001) stubs
  `fetch("https://api.resend.com/...")` to return `{ id: "email_test_stub" }`
  with status 200, so helper-level tests can exercise the transport without
  network. `convex/lib/email.test.ts` exists and tests the HTML builders; add
  transport tests there or alongside.

## Commands you will need

| Purpose   | Command            | Expected on success            |
|-----------|--------------------|---------------------------------|
| Tests     | `npm run test`     | exit 0 (all + new tests pass)  |
| Typecheck | `npx tsc --noEmit` | exit 0                          |
| Lint      | `npm run lint`     | exit 0                          |

## Scope

**In scope** (the only files you should modify):
- `convex/lib/email.ts` (add `sendEmail` + shared `FROM`)
- `convex/lib/email.test.ts`
- `convex/documents.ts`
- `convex/documents.test.ts`
- `convex/distribution.ts`
- `convex/agents/messageDrafter.ts`
- `convex/feedback.ts`
- `convex/schema.ts` (one optional field on `documents`)
- `src/components/documents/documents-section.tsx`
- `src/components/documents/document-status.tsx`

**Out of scope** (do NOT touch):
- Email HTML builders' content/markup (subjects, copy, escaping) — behaviour
  must be byte-identical.
- The sends/recipients ledger tables and `recordSendResult` — they work; the
  helper slots in beneath them.
- Retry/backoff machinery, webhooks from Resend — future work.

## Git workflow

- Work directly on `main`.
- Commit per logical unit (helper first, then call sites, then documents
  outcome + UI); short imperative messages, no trailers, e.g.
  `Extract a shared Resend transport helper`.
- Push after done criteria pass.

## Steps

### Step 1: Add the shared transport helper

In `convex/lib/email.ts`, export the shared sender identity and a non-throwing
transport:

```ts
export const FROM = "UnitDeck <callsheets@mail.unitdeck.app>";

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** One Resend call. Never throws: callers decide what a failure means. */
export async function sendEmail(args: {
  apiKey: string;
  to: string[];
  subject: string;
  html: string;
  from?: string;
}): Promise<SendEmailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: args.from ?? FROM, to: args.to, subject: args.subject, html: args.html }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 500)}` };
    }
    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown send error" };
  }
}
```

Add unit tests in `convex/lib/email.test.ts` (success via the plan-001 fetch
stub; failure by temporarily overriding `globalThis.fetch` within the test and
restoring it after).

**Verify**: `npm run test` → new helper tests pass.

### Step 2: Switch the ledgered flows to the helper

In `convex/distribution.ts` (`deliverEmails`) and
`convex/agents/messageDrafter.ts` (`deliverChase`): replace the inline
`fetch`/try/catch blocks with a `sendEmail` call, mapping the result onto the
existing `recordSendResult` calls (`ok: true` → providerId, `ok: false` →
error). Delete the now-unused local `FROM` constants and import from
`convex/lib/email.ts`. The persisted outcomes must be identical to today for
both success and failure paths.

**Verify**: `npm run test` → distribution and messageDrafter tests pass
unchanged.

### Step 3: Record the invite outcome on documents

- `convex/schema.ts`: add to the `documents` table:

```ts
inviteDelivery: v.optional(
  v.object({
    status: v.union(v.literal("delivered"), v.literal("failed")),
    error: v.optional(v.string()),
    at: v.number(),
  })
),
```

- `convex/documents.ts`: add an internal mutation
  `recordInviteResult({ id, ok, error? })` that patches `inviteDelivery`
  accordingly. In `deliverInvite`, replace the inline fetch with `sendEmail`
  and always call `recordInviteResult` with the outcome instead of throwing on
  failure. In `deliverSignedCopy`, switch to `sendEmail` and log failures
  (`console.error`) without persisting (the signed copy is a courtesy copy;
  keep scope tight).
- Add a `resendInvite` mutation: org-scoped via the existing `requireOwnedDoc`
  helper (`convex/documents.ts:16-21`), allowed only when
  `doc.status === "sent"` and `doc.inviteDelivery?.status === "failed"`;
  it clears `inviteDelivery` and re-schedules `internal.documents.deliverInvite`.

**Verify**: `npx tsc --noEmit` → exit 0; `npm run test` → documents tests pass.

### Step 4: Surface failure in the documents UI

- `convex/documents.ts` `listForProject` already returns full docs, so
  `inviteDelivery` flows through without query changes.
- `src/components/documents/documents-section.tsx`: for a row with
  `doc.status === "sent" && doc.inviteDelivery?.status === "failed"`, show a
  failure note (e.g. "Email failed") in place of the plain sent copy, plus a
  small "Retry email" button calling `api.documents.resendInvite`, styled and
  toasted like the file's existing mutation buttons.
- `src/components/documents/document-status.tsx`: no new document status;
  reuse the badge as-is (failure is shown beside it, matching the
  recipients-ledger approach used on the call sheet page).

**Verify**: `npm run lint` → exit 0; `npx tsc --noEmit` → exit 0.

### Step 5: Tests for the outcome path

In `convex/documents.test.ts`, following the file's existing patterns:

1. Send with the (plan 001) fetch stub in place → after the scheduled action
   runs, `inviteDelivery.status === "delivered"`.
2. Override `globalThis.fetch` in-test to return a 500 for api.resend.com →
   send → `inviteDelivery.status === "failed"` with an error string, and the
   document status is still `sent` (not reverted).
3. `resendInvite` on a failed document clears and re-attempts; `resendInvite`
   on a delivered document throws.

Restore any overridden fetch in a `finally`.

**Verify**: `npm run test` → exit 0, new tests pass.

### Step 6: Sweep the last call site

Switch `convex/feedback.ts` `notify` to `sendEmail`, preserving its current
behaviour on failure (it must not start throwing if it doesn't today; read the
function first and keep semantics).

**Verify**: `grep -rn "api.resend.com" convex --include="*.ts" | grep -v _generated | grep -v test` → exactly one match, in `convex/lib/email.ts`.

## Test plan

Steps 1 and 5 define the new tests (helper success/failure; invite outcome
recorded on success and failure; retry semantics). Model on the existing
`convex/documents.test.ts` and `convex/lib/email.test.ts` structures.
Manual pass after deploy: send a real talent release to a test address and
confirm the email arrives and no failure badge appears.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run test` exits 0, including the new transport and outcome tests
- [ ] `npx tsc --noEmit` exits 0 and `npm run lint` exits 0
- [ ] `grep -rn "api.resend.com" convex --include="*.ts" | grep -v _generated | grep -v test` → 1 match (`convex/lib/email.ts`)
- [ ] Only in-scope files changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 has not landed (`npm run test` not green before you start).
- The multi-type documents build has restructured `convex/documents.ts` so
  the excerpted functions no longer exist under these names: re-read and
  proceed only if the mapping is obvious; otherwise report.
- Changing `deliverInvite` to non-throwing alters any existing test's
  expectation (a test may assert the throw; report rather than rewriting the
  assertion without understanding it).
- Convex schema push rejects the new optional field (it should not; optional
  additions are backward-compatible).

## Maintenance notes

- Every future email path must use `sendEmail`; the done-criterion grep is the
  reviewer's one-line check against new drift.
- If invite volume grows, replace per-document `inviteDelivery` with the
  sends-ledger pattern (`convex/distribution.ts`) wholesale; this plan keeps
  the lighter shape deliberately because a document has exactly one signer.
- A Resend webhook (delivered/bounced) would upgrade "accepted by Resend" to
  true delivery status; deferred.
- The multi-type documents build renames the invite/signed-copy builders to
  generic `documentInviteEmail`/`documentSignedEmail`; the transport helper is
  orthogonal and survives that rename.
