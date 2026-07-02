# Implementation plans

Generated from the 2026-07-02 codebase audit (advisor session, planned at
commit `b4ba125`). Execute in the order below unless dependencies say
otherwise. Each executor: read the plan fully before starting, honour its
STOP conditions, and update your row when done.

These are advisor audit plans; product build plans live separately in
`docs/superpowers/plans/`. The audit ran without the owner present, so the
top five findings by leverage were planned by default; the remaining findings
are listed below and can be promoted to plans on request.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | Make the test suite green and deterministic | P1 | S | — | DONE (see execution notes: all 5 failures were the date bomb; lint has 2 pre-existing errors, handed to 002) |
| 002  | Add a CI gate (lint, typecheck, tests) | P1 | S | 001 | DONE (required fixing 2 pre-existing react-hooks/set-state-in-effect lint errors first; first run green) |
| 003  | Close the geocode tenancy gap and middleware route gaps | P1 | S | — | DONE |
| 004  | Make the stored signed PDF tamper-proof, serve it directly | P2 | M | — | TODO |
| 005  | Record and surface document email delivery outcomes | P2 | M | 001 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) |
REJECTED (with one-line rationale).

## Dependency notes

- 002 requires 001: CI over a red suite is permanent noise.
- 005 requires 001: its new tests rely on the fetch stub plan 001 introduces,
  and a green baseline is needed to see regressions in the email paths.
- 004 and 005 both touch `convex/documents.ts`; execute serially, either order.
- The approved multi-type documents build
  (`docs/superpowers/specs/2026-07-01-location-release-nda-design.md`) also
  touches `convex/documents.ts` and `convex/lib/email.ts`. Plans 004 and 005
  are written to survive it (see their drift checks), but landing 001–003
  first, then the spec build, then 004–005, is the lowest-friction order.

## Findings without plans (promote on request)

- Dashboard date-scan bug: `convex/dashboard.ts` `attention` and
  `upcomingShootDays` both `take(500)` on the `by_org` index and filter by
  date in JS; once an org exceeds 500 shoot-day rows (or 200/500 projects),
  upcoming days silently vanish from the dashboard. Fix: add
  `by_org_and_date` index on `shootDays` and range-query. Effort S, not urgent
  at current data volumes but should land before real multi-year usage.
- `convex` package bump: `npm audit` reports 2 high (`ws` memory-exhaustion
  advisory) + 2 moderate via convex 1.41.0; `npm i convex@1.42.1` clears it
  within semver. One-liner plus a test run; barely needs a plan.
- Expired-token rows never deleted: `toolRenders` (15-min TTL) and
  `renderTokens` (10-min TTL) are filtered on read but nothing removes rows;
  add a Convex cron to delete expired rows. Effort S.
- Raw Convex ids in app URLs (`/projects/<id>`): the owner's cross-project
  convention prefers human slugs on user-facing URLs. Internal authenticated
  app, so lower stakes; M effort if wanted.
- `.env.example` documents Convex-side vars partially: `SITE_URL` and
  `RESEND_API_KEY` (Convex deployment env) are not mentioned anywhere; add a
  comment block. Effort trivial; fold into any nearby change.

## Findings considered and rejected

- Triplicated PDF API routes (`call-sheets/pdf`, `documents/pdf`,
  `tools/pdf`): 48–68 lines each, already share `src/lib/pdf-browser.ts`;
  merging them buys little and couples three flows. Not worth doing.
- `composer-form.tsx` at 819 lines: long but coherent sectioned form with
  shared state; splitting is churn without a defect. Not worth doing now.
- `feedback.list` unbounded `.collect()`: bounded by per-org feedback volume;
  fine at any plausible scale for this table.
- Per-day sub-queries in dashboard loops: bounded `take`s, idiomatic Convex
  reactive pattern; the real dashboard issue is the date-scan finding above.
- Public `waitlist.join` / `tools.createRender` spam exposure: honeypot,
  dedupe, size caps and TTLs already in place; residual risk accepted, and
  rate limiting is already on the recorded backlog.
- Email HTML injection: all user content is escaped via `escapeHtml` in
  `convex/lib/email.ts`; verified clean.
- Secrets in repo: pattern grep + git history check found none; only
  `.env.example` placeholders ever committed.

## Audit coverage note

Audited at standard depth on 2026-07-02: all Convex functions (tenancy sweep
of every exported function), public token surfaces, Next API routes, schema
indexes, email builders, test suite health, dependency audit, middleware, and
the largest client components. Not audited in depth: pixel-level UI/visual
QA, the marketing pages' content, `docs/` prose, and Clerk/Vercel dashboard
configuration (outside the repo).
