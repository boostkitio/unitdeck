# Plan 003: Close the tenancy gap in locations.geocode and the middleware route gaps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b4ba125..HEAD -- convex/locations.ts src/proxy.ts convex/locations.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b4ba125`, 2026-07-02

## Why this matters

The repo's stated architecture rule (README "Architecture rules") is: every
Convex query/mutation derives the org from the Clerk identity via `requireOrg`
and never trusts client arguments. Two spots fall short:

1. `locations.geocode` only checks that *some* user is signed in, then loads
   and patches any location by raw id. A signed-in user from org A can
   overwrite the coordinates of org B's location. Location ids are not private:
   they are embedded in call sheet data (`locationId` per location block),
   which is delivered to public set-mode token holders, so cross-tenant ids do
   leak to third parties. The field being patched (lat/lng) is deliberately
   low-stakes, but the pattern violates the tenancy rule and will be copied by
   future actions if left as the exemplar.
2. `src/proxy.ts` (Clerk middleware) protects only five app routes. `/settings`
   and `/feedback` are app pages but are not in the matcher, so the middleware
   never runs `auth.protect()` for them. Convex still rejects their data
   queries for anonymous users, so there is no data exposure today; this is a
   defence-in-depth and consistency fix.

## Current state

- `convex/locations.ts:104-160` — the internal query does no auth (fine for
  internal-only) and the action checks identity but not tenancy:

```ts
export const getForGeocode = internalQuery({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
// ...
export const geocode = action({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const location = await ctx.runQuery(internal.locations.getForGeocode, { id: args.id });
    if (!location) throw new Error("Location not found");
```

- Auth propagates from actions into `ctx.runQuery` in Convex, so `requireOrg`
  works inside the internal query when called from the action with a signed-in
  user.
- The repo's tenancy helper, `convex/lib/auth.ts` — `requireOrg(ctx)` returns
  `{ identity, org }` and throws if unauthenticated or unprovisioned. The
  ownership convention used everywhere else (e.g. `convex/locations.ts:34-42`
  `get`):

```ts
const { org } = await requireOrg(ctx);
const location = await ctx.db.get(args.id);
if (!location || location.orgId !== org._id) return null;
```

- `src/proxy.ts:1-16` (whole matcher today):

```ts
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/people(.*)",
  "/clients(.*)",
  "/locations(.*)",
]);
```

- App pages that exist under `src/app/(app)/`: dashboard, projects, people,
  clients, locations, settings, feedback. The last two are missing from the
  matcher.
- Existing test exemplar for org isolation: `convex/locations.test.ts` (uses
  `convexTest(schema, modules)` plus `t.withIdentity({ subject, org_id })`;
  see also `convex/callSheets.test.ts` for the two-org isolation pattern).

## Commands you will need

| Purpose   | Command            | Expected on success              |
|-----------|--------------------|-----------------------------------|
| Tests     | `npm run test`     | exit 0 (87 + new tests passing)  |
| Typecheck | `npx tsc --noEmit` | exit 0                            |
| Lint      | `npm run lint`     | exit 0                            |

## Scope

**In scope** (the only files you should modify):
- `convex/locations.ts`
- `convex/locations.test.ts`
- `src/proxy.ts`

**Out of scope** (do NOT touch):
- `convex/lib/auth.ts` — the helper is correct; use it, do not modify it.
- `locations.suggestAddress` — it reads no tenant data (query string to an
  LLM only); its identity-only check is acceptable.
- Public token surfaces (`convex/setMode.ts`, `convex/tools.ts`,
  `convex/documents.ts`) — public by design.

## Git workflow

- Work directly on `main`.
- Commit message style: short imperative sentence, no trailers, e.g.
  `Scope geocoding to the caller's org and protect all app routes`.
- Push after done criteria pass.

## Steps

### Step 1: Enforce tenancy in the geocode read path

In `convex/locations.ts`, change `getForGeocode` to derive the org and check
ownership (imports for `requireOrg` already exist in the file):

```ts
export const getForGeocode = internalQuery({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) return null;
    return location;
  },
});
```

Keep the `geocode` action's own identity check as is (cheap fail-fast before
the internal query runs).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Enforce tenancy in the geocode write path

In the same file, guard `saveCoordinates` the same way (auth also propagates
through `ctx.runMutation` from the action):

```ts
export const saveCoordinates = internalMutation({
  args: { id: v.id("locations"), lat: v.number(), lng: v.number() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const location = await ctx.db.get(args.id);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");
    await ctx.db.patch(args.id, { lat: args.lat, lng: args.lng });
    return null;
  },
});
```

**Verify**: `npm run test` → existing location tests still pass.

### Step 3: Add the cross-tenant regression test

In `convex/locations.test.ts`, add a test following the existing two-org
pattern in the file (or `convex/callSheets.test.ts` if none exists there):
create a location under org A, then as an identity whose `org_id` is org B,
call `api.locations.geocode` with org A's location id and assert it throws
("Location not found"). Stub nothing extra: the tenancy check fails before any
network call to Nominatim happens.

**Verify**: `npm run test` → the new test passes; total test count increased
by at least 1.

### Step 4: Protect the missing app routes

In `src/proxy.ts`, extend the matcher:

```ts
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/people(.*)",
  "/clients(.*)",
  "/locations(.*)",
  "/settings(.*)",
  "/feedback(.*)",
]);
```

Add a one-line comment above the array: new pages under `src/app/(app)/` must
be added here.

**Verify**: `npm run lint` → exit 0; `npx tsc --noEmit` → exit 0.

## Test plan

- New test in `convex/locations.test.ts`: cross-tenant `geocode` rejection
  (step 3). Model the setup after the existing org-isolation tests in
  `convex/callSheets.test.ts` (two orgs, `t.withIdentity`).
- Middleware matcher has no unit-test harness in this repo; verification is
  lint + typecheck + manual: after deploy, an incognito request to
  `https://unitdeck.app/settings` should redirect to sign-in rather than
  render the app shell.
- Verification: `npm run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run test` exits 0, including a new cross-tenant geocode test
- [ ] `npx tsc --noEmit` exits 0 and `npm run lint` exits 0
- [ ] `grep -n "settings" src/proxy.ts` shows the new matcher entry
- [ ] `git status` shows only the three in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `requireOrg` inside the internal query throws for the legitimate same-org
  path in tests (would mean auth does not propagate through `runQuery` in
  convex-test the way it does in production; report, do not weaken the check).
- The geocode UI flow breaks locally (the action is called from the locations
  page after saving; if the same-org path stops working, stop).
- You find other exported functions missing tenancy checks: report them,
  do not fix beyond scope.

## Maintenance notes

- Every new Convex action that touches a document by id must resolve tenancy
  via `requireOrg` inside the internal query/mutation it calls, exactly as
  `getForGeocode` now does; the identity-only check in an action is not
  sufficient on its own.
- Reviewers should check `src/proxy.ts` whenever a new route group page is
  added; consider a nav-items-driven test later if the list keeps growing.
