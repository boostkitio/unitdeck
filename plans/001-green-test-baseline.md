# Plan 001: Make the test suite green and deterministic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b4ba125..HEAD -- vitest.config.ts convex/setMode.test.ts convex/messageDrafter.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `b4ba125`, 2026-07-02

## Why this matters

`npm run test` currently reports 5 failed / 82 passed, and the team treats the
5 failures as a known baseline. A permanently red suite masks real regressions:
nobody can tell a new failure from the baseline at a glance, and it blocks
adding CI (plan 002). Worse, the baseline is drifting: it was recorded as a
`SITE_URL` environment issue, but three of the failures are actually a date
time bomb. `convex/setMode.test.ts` hardcodes a shoot date of `2026-06-18`, and
set-mode links expire 7 days after the shoot date, so those tests started
failing around 2026-06-26 and would have "failed harder" over time regardless
of environment. After this plan, `npm run test` exits 0 with all 87 tests
passing, deterministically, with no real network calls.

## Current state

- `vitest.config.ts` (repo root), the whole file today:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

There is no `setupFiles` entry, no env stubbing, and no fetch mocking anywhere
in the test suite (verified: `grep -n "stubEnv\|setupFiles\|vi.mock" convex/*.test.ts vitest.config.ts` returns nothing).

- `convex/setMode.test.ts:9` — the shared fixture hardcodes a date that is now
  in the past:

```ts
async function setupSent(date = "2026-06-18") {
```

- `convex/setMode.ts:14-19` — links expire 7 days after the shoot date:

```ts
function isExpired(shootDate: string): boolean {
  const [y, m, d] = shootDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const cutoff = Date.UTC(y, m - 1, d) + (EXPIRY_DAYS_AFTER_SHOOT + 1) * 24 * 60 * 60 * 1000;
  return Date.now() > cutoff;
}
```

So every `setupSent()` caller that expects a live link now gets
`This link has expired` from `convex/setMode.ts:67`. The one test that
deliberately exercises expiry passes `"2020-01-01"` explicitly
(`convex/setMode.test.ts:52-56`) and must keep doing so.

- The other failure mechanism: several Convex functions schedule email actions
  which read env vars and throw when they are unset locally:
  - `convex/distribution.ts:166-168` — `deliverEmails` throws
    `SITE_URL is not set in the Convex environment`.
  - `convex/agents/messageDrafter.ts:208-212` — `deliverChase` throws the same
    way (and checks `RESEND_API_KEY` first).
  These actions are scheduled with `ctx.scheduler.runAfter(0, ...)` from
  mutations under test (`distribution.send`, `messageDrafter.approveAndSend`),
  and the thrown error surfaces as a test failure in
  `convex/messageDrafter.test.ts`.
  If the env vars are simply set, the actions will then attempt a real
  `fetch("https://api.resend.com/emails", ...)` (`convex/distribution.ts:182`,
  `convex/agents/messageDrafter.ts:222`), which must not happen in tests, so a
  fetch stub for that host is required as well.

- Production is unaffected: `SITE_URL` is correctly set in the Convex
  production deployment. This plan changes test setup only. Do not change any
  production code.

## Commands you will need

| Purpose   | Command           | Expected on success                     |
|-----------|-------------------|-----------------------------------------|
| Tests     | `npm run test`    | exit 0, `Tests  87 passed (87)`         |
| Typecheck | `npx tsc --noEmit`| exit 0, no output                       |
| Lint      | `npm run lint`    | exit 0                                  |

Note (Windows): the Convex CLI needs Node 22, but none of these commands
invoke the Convex CLI, so the default shell is fine.

## Scope

**In scope** (the only files you should modify or create):
- `vitest.setup.ts` (create, repo root)
- `vitest.config.ts`
- `convex/setMode.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `convex/setMode.ts`, `convex/distribution.ts`, `convex/agents/messageDrafter.ts`,
  `convex/documents.ts` — production behaviour is correct; only the tests are
  environment- and time-dependent.
- `convex/messageDrafter.test.ts` — its failures are fixed by the setup file
  alone; do not edit it.
- Any `.env*` file.

## Git workflow

- Work directly on `main` (repo convention; the owner works on main and pushes
  each completed task).
- Commit message style: short imperative sentence, no trailers, no
  co-author lines, e.g. `Make the vitest suite deterministic and green`.
- Push after the done criteria pass.

## Steps

### Step 1: Create the test setup file

Create `vitest.setup.ts` at the repo root:

```ts
// Test-only environment and network stubs.
// SITE_URL / RESEND_API_KEY are read by scheduled email actions
// (convex/distribution.ts, convex/documents.ts, convex/agents/messageDrafter.ts);
// unset locally they throw and fail tests. The fetch stub keeps the suite
// hermetic: no real Resend calls, everything else passes through.
process.env.SITE_URL ??= "https://unitdeck.test";
process.env.RESEND_API_KEY ??= "resend-test-key";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com/")) {
    return new Response(JSON.stringify({ id: "email_test_stub" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;
```

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Register the setup file

In `vitest.config.ts`, add `setupFiles` to the `test` block:

```ts
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

**Verify**: `npm run test` → the 2 `convex/messageDrafter.test.ts` failures are
gone; remaining failures (if any) are only in `convex/setMode.test.ts`.

### Step 3: Make the setMode fixture date relative

In `convex/setMode.test.ts`, replace the hardcoded default date with a
computed near-future date. Change line 9 from:

```ts
async function setupSent(date = "2026-06-18") {
```

to:

```ts
const NEAR_FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

async function setupSent(date = NEAR_FUTURE) {
```

Leave the explicit `setupSent("2020-01-01")` call in the
"link expires 7 days after the shoot date" test unchanged — it exercises the
expiry path on purpose.

**Verify**: `npm run test` → exit 0, `Tests  87 passed (87)`, `5 failed` no
longer appears.

### Step 4: Full gate

**Verify**: all three commands pass:
- `npm run test` → exit 0, 87 passed
- `npx tsc --noEmit` → exit 0
- `npm run lint` → exit 0

## Test plan

No new test files: this plan repairs the harness. The regression guard is the
suite itself passing deterministically. Run `npm run test` twice in a row and
confirm both runs report 87 passed (catches any residual order/time
dependence).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run test` exits 0 with 87 passed, on two consecutive runs
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `grep -n "2026-06-18" convex/setMode.test.ts` returns no matches
- [ ] `git status` shows only the three in-scope files changed/created
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Test counts differ wildly from 87 total (the suite has grown or shrunk since
  planning; re-check which tests fail and why before applying fixes).
- After Step 2, failures remain in `convex/messageDrafter.test.ts` (the
  failure mechanism is different from the one this plan assumes).
- Stubbing `globalThis.fetch` breaks a previously-passing test (e.g. something
  in `convex/llm.test.ts` or `convex/briefParser.test.ts` relied on real
  fetch behaviour). Do not widen or narrow the stub on your own.
- You find yourself wanting to edit any file in the out-of-scope list.

## Execution notes (2026-07-02)

Executed same day by the plan author; three deviations from the text above,
all verified:

1. **Root cause correction**: all five failures were the date time bomb, not
   just three. `convex/messageDrafter.test.ts:21` hardcoded the same
   `"2026-06-18"` date, and its failures surfaced as `This link has expired`
   too. The `SITE_URL` mechanism recorded in project memory was never the
   failure path (convex-test does not execute the scheduled email actions).
   `convex/messageDrafter.test.ts` was therefore added to scope and given the
   same relative-date fix.
2. **The setup file is insurance, not the fix**: the suite passes without it
   once dates are relative (verified by unregistering it and re-running).
   Kept regardless: it makes the suite hermetic if scheduled actions ever run
   under test, and plan 005's new tests rely on its Resend fetch stub.
3. **Lint done-criterion**: `npm run lint` fails with 2 pre-existing errors
   (`react-hooks/set-state-in-effect` in
   `src/app/(app)/projects/[id]/shoot-days/[shootDayId]/wrap/page.tsx:43` and
   `src/components/marketing/call-sheet-maker.tsx:52`) plus 6 pre-existing
   warnings, none in files this plan touched. Tracked as a prerequisite fix
   for plan 002 (CI would be red otherwise).

## Maintenance notes

- Any new test fixture that inserts a `shootDays` row must use a relative
  date, never a literal. Set-mode links expire 7 days after the shoot date
  (`convex/setMode.ts:14`), so hardcoded dates rot.
- Any new Convex action that sends email must go through the same env vars so
  the setup file keeps covering it.
- The project memory note that attributed all 5 baseline failures to
  `SITE_URL` alone was inaccurate (3 were the date time bomb); after this plan
  lands the correct baseline is simply "green".
- Plan 002 (CI) depends on this plan: a red suite makes CI useless.
