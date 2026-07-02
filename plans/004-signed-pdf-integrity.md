# Plan 004: Make the stored signed PDF tamper-proof and serve it instead of re-rendering

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b4ba125..HEAD -- convex/documents.ts src/app/api/documents/pdf/route.ts convex/documents.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. In particular, if
> `documents.type` has been widened beyond `"talent_release"` (the multi-type
> documents build may land around the same time), the mechanics below are
> unchanged, but re-read the file before editing.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches the live signing flow; verify end-to-end)
- **Depends on**: none (plays well with, but does not require, the multi-type documents build)
- **Category**: security
- **Planned at**: commit `b4ba125`, 2026-07-02

## Why this matters

The signed talent release PDF is a legal artifact, but today anyone holding
the public sign link can replace it after signing: `generateSignedUploadUrl`
and `attachSignedPdf` are public mutations gated only on the token and
`status === "signed"`, and `attachSignedPdf` overwrites `signedPdfFileId`
unconditionally. The sign token never expires, so this exposure is permanent.
The signature record itself (typed name, timestamp, IP) survives, but the
stored PDF, which is what a producer will rely on and what the roadmap plans
to serve directly, can be swapped for arbitrary bytes by the signer or anyone
they forwarded the link to. Additionally, every download re-renders the PDF
with headless Chromium (slow, expensive) even when a stored copy exists.
After this plan: the first stored PDF is immutable, upload URLs cannot be
minted once a PDF is attached, and the download path serves the stored bytes
without launching a browser.

## Current state

- `convex/documents.ts:229-250` — the two public mutations:

```ts
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
    const firstAttach = !doc.signedPdfFileId;
    await ctx.db.patch(doc._id, { signedPdfFileId: args.fileId });
    if (firstAttach && doc.signer.email) {
      await ctx.scheduler.runAfter(0, internal.documents.deliverSignedCopy, { id: doc._id });
    }
    return null;
  },
});
```

- `src/app/api/documents/pdf/route.ts` — public POST; validates the token
  shape (`/^[a-f0-9]{48}$/`), calls `api.documents.getForPrint`, renders
  `/print/document/<token>` with Puppeteer, then best-effort uploads and
  attaches the PDF (failures logged, PDF still returned). Every call
  re-renders, even when `signedPdfFileId` already exists.
- Callers of that route: `src/app/sign/[token]/page.tsx` (`submitSign` fires
  it right after signing via `/api/documents/sign`, and `downloadPdf` calls it
  from the "Download PDF" button) and
  `src/components/documents/documents-section.tsx` (org-side download).
  `src/app/api/documents/sign/route.ts:21-27` also triggers it best-effort
  after a successful sign.
- `documents` schema (`convex/schema.ts:215-252`): `signedPdfFileId:
  v.optional(v.id("_storage"))`, statuses `draft|sent|signed|declined|voided`,
  token indexed via `by_sign_token`.
- Existing test exemplar: `convex/documents.test.ts` (convex-test; covers the
  sign flow; model new tests on its setup).
- Known backlog recorded elsewhere (do NOT implement here): expiring the sign
  token, rate-limiting the public POST routes.

## Commands you will need

| Purpose   | Command            | Expected on success             |
|-----------|--------------------|----------------------------------|
| Tests     | `npm run test`     | exit 0 (all + new tests pass)   |
| Typecheck | `npx tsc --noEmit` | exit 0                           |
| Lint      | `npm run lint`     | exit 0                           |

## Scope

**In scope** (the only files you should modify):
- `convex/documents.ts`
- `convex/documents.test.ts`
- `src/app/api/documents/pdf/route.ts`

**Out of scope** (do NOT touch):
- `src/app/sign/[token]/page.tsx`, `src/components/documents/documents-section.tsx`
  — both call the same route URL and need no change.
- `src/app/api/documents/sign/route.ts` — its best-effort PDF trigger keeps
  working unchanged.
- Sign-token expiry and rate limiting — separate backlog items, deliberately
  not in this plan.
- `convex/schema.ts` — no schema change is needed.

## Git workflow

- Work directly on `main`.
- Commit message style: short imperative sentence, no trailers, e.g.
  `Lock the signed release PDF after first store and serve it directly`.
- Push after done criteria pass.

## Steps

### Step 1: Make attach one-shot and upload minting single-use

In `convex/documents.ts`:

- `generateSignedUploadUrl`: after the existing status check, add
  `if (doc.signedPdfFileId) throw new Error("Signed PDF already stored");`
- `attachSignedPdf`: replace the unconditional patch with a first-write-wins
  guard:

```ts
if (doc.signedPdfFileId) return null; // first stored PDF is canonical
await ctx.db.patch(doc._id, { signedPdfFileId: args.fileId });
if (doc.signer.email) {
  await ctx.scheduler.runAfter(0, internal.documents.deliverSignedCopy, { id: doc._id });
}
```

(The `firstAttach` variable disappears; the email schedule only ever runs on
the first, now-only, attach.)

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Add a public query for the stored PDF URL

In `convex/documents.ts`, next to `getForPrint`:

```ts
export const getSignedPdfUrl = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed" || !doc.signedPdfFileId) return null;
    return await ctx.storage.getUrl(doc.signedPdfFileId);
  },
});
```

This exposes nothing beyond what the token already grants (the same bytes are
reachable via `getForPrint` + render today).

**Verify**: `npm run test` → existing tests still pass.

### Step 3: Serve the stored PDF from the route

In `src/app/api/documents/pdf/route.ts`, after the token-shape check and
before `getForPrint`, query `api.documents.getSignedPdfUrl`. If it returns a
URL: fetch it server-side and return the bytes with the existing
`Content-Type: application/pdf` and `Content-Disposition` headers, skipping
the browser launch and the upload/attach block entirely. If it returns null,
fall through to the existing render-and-store path unchanged.

Keep the existing behaviour where storage failure is logged but the freshly
rendered PDF is still returned to the caller.

**Verify**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

### Step 4: Tests

In `convex/documents.test.ts`, following the file's existing setup pattern,
add:

1. `attachSignedPdf` is first-write-wins: sign a document, attach file A,
   attach file B, assert the document's `signedPdfFileId` still equals file A.
2. `generateSignedUploadUrl` throws once a PDF is attached.
3. `getSignedPdfUrl` returns null for a sent-but-unsigned document and a
   non-null URL after sign + attach.

Use `t.run(async (ctx) => ctx.storage.store(new Blob([...])))` (convex-test
supports storage) to create file ids; if convex-test's storage API differs,
see STOP conditions.

**Verify**: `npm run test` → exit 0, new tests pass.

### Step 5: End-to-end check of the live flow

Run the app locally (`npx convex dev` under Node 22 + `npm run dev`), create a
talent release, send it, open the sign link, sign it, then click
"Download PDF" twice. Expected: first download stores the PDF (Convex
dashboard shows `signedPdfFileId` set), second download returns identical
bytes without launching Chromium (fast response; no puppeteer log lines).

**Verify**: both downloads return a valid PDF; `signedPdfFileId` unchanged
between them.

## Test plan

Covered in step 4 (three new convex-test cases) plus the manual end-to-end
pass in step 5. Model test structure on the existing cases in
`convex/documents.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run test` exits 0, including the three new tests
- [ ] `npx tsc --noEmit` exits 0 and `npm run lint` exits 0
- [ ] `grep -n "firstAttach" convex/documents.ts` returns no matches
- [ ] `git status` shows only the three in-scope files changed
- [ ] Manual end-to-end pass (step 5) done and described in the status update
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- convex-test does not support `ctx.storage.store` / storage URLs in a way
  that lets the tests run (report which API is missing rather than mocking
  around it).
- The signed-copy email would no longer be sent in the normal flow (trace:
  sign → sign route fires the PDF route → first attach schedules
  `deliverSignedCopy`; if your change breaks that ordering, stop).
- `documents.ts` has been refactored by the multi-type documents build in a
  way that moved these functions (re-read, and only proceed if the mutations
  are recognisably the same).

## Maintenance notes

- If a release ever legitimately needs re-issuing after signing, the intended
  path is voiding and creating a new document, not overwriting the stored PDF;
  a future `void` flow should not relax first-write-wins.
- The re-render path still exists for signed docs whose storage step failed;
  it heals on the next download (renders, then stores because
  `signedPdfFileId` is empty).
- Sign-token expiry and public-route rate limiting remain open backlog items;
  when token expiry lands, `getSignedPdfUrl` must keep working for signed
  documents (signers keep their copy) even if signing is closed.
