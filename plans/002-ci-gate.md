# Plan 002: Add a CI gate so pushes to main are verified automatically

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b4ba125..HEAD -- .github package.json vitest.config.ts`
> If `.github/` already exists, treat that as a STOP condition (someone added
> CI since this plan was written).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-green-test-baseline.md
- **Category**: dx
- **Planned at**: commit `b4ba125`, 2026-07-02

## Why this matters

There is no CI at all: the repo has no `.github/` directory, and `vercel.json`
builds production with `npx convex deploy --cmd 'npm run build'` on every push
to `main`. Nothing runs the test suite, the linter, or the typechecker
automatically, so a regression ships to https://unitdeck.app unless someone
remembered to run the checks locally. A minimal GitHub Actions workflow gives
every push a red/green signal within a couple of minutes. It cannot land
before plan 001 because the suite is currently red by default and CI would
just be permanently failing noise.

## Current state

- No `.github/` directory exists (`ls .github` fails).
- `vercel.json` (whole file):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npx convex deploy --cmd 'npm run build'"
}
```

- `package.json` scripts: `dev`, `build`, `start`, `lint` (`eslint`),
  `test` (`vitest run`). There is no `typecheck` script.
- Local verification commands that must become the CI steps:
  `npm run lint`, `npx tsc --noEmit`, `npm run test`.
- The repo targets Node 22 locally (the Convex CLI crashes under Node 24 on
  Windows, per README). CI does not run the Convex CLI, but matching Node 22
  LTS keeps behaviour aligned.
- Note: this workflow is a signal, not a deploy blocker. Vercel deploys from
  `main` regardless of Actions results. Blocking deploys would require PR-based
  workflow with required checks or a Vercel "ignored build step", both out of
  scope here (the owner commits directly to main).

## Commands you will need

| Purpose        | Command                              | Expected on success        |
|----------------|--------------------------------------|-----------------------------|
| Tests          | `npm run test`                       | exit 0, 87 passed           |
| Typecheck      | `npx tsc --noEmit`                   | exit 0                      |
| Lint           | `npm run lint`                       | exit 0                      |
| Validate YAML  | `npx --yes yaml-lint .github/workflows/ci.yml` (or read it carefully) | no parse errors |
| Watch a run    | `gh run watch` (after pushing)       | run completes green         |

## Scope

**In scope** (the only files you should modify or create):
- `.github/workflows/ci.yml` (create)
- `package.json` (add a `typecheck` script only)

**Out of scope** (do NOT touch):
- `vercel.json` — the deploy pipeline works; do not wire CI into it.
- `vitest.config.ts`, any test file — plan 001 owns those.
- Branch protection / repo settings — do not change GitHub settings.

## Git workflow

- Work directly on `main`.
- Commit message style: short imperative sentence, no trailers, e.g.
  `Add CI workflow running lint, typecheck and tests`.
- Push, then confirm the Actions run goes green (`gh run watch`).

## Steps

### Step 1: Add a typecheck script

In `package.json`, add to `scripts`:

```json
"typecheck": "tsc --noEmit"
```

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Create the workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
```

**Verify**: file parses as valid YAML; paths and script names match
`package.json` exactly.

### Step 3: Push and confirm the run

Commit, push to `main`, then:

**Verify**: `gh run watch` → the CI run completes with all steps green.
If `gh` is not authenticated, check the Actions tab result via
`gh run list --limit 1` once authenticated, or report the push and stop.

## Test plan

The workflow itself is the test: one green run on GitHub-hosted infrastructure
proves install, lint, typecheck, and the full vitest suite pass from a clean
checkout (no local node_modules, no local env). No new test files.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0 locally
- [ ] `.github/workflows/ci.yml` exists and the pushed run is green
      (`gh run list --limit 1` shows `completed success`)
- [ ] `git status` clean; only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 has not landed (run `npm run test`: if it does not exit 0 locally,
  this plan is blocked).
- The CI run fails on a step that passes locally (environment difference:
  report the log excerpt rather than patching the workflow ad hoc).
- `npm ci` fails in CI due to lockfile issues.

## Maintenance notes

- If a build-affecting env var ever becomes required at lint/typecheck time,
  it must be added to the workflow env, not hardcoded.
- When the owner starts using PRs, turn this into a required check via branch
  protection so it actually gates merges; consider a Vercel ignored-build-step
  to block deploys on red.
- Keep the Node version in sync with local guidance (currently 22 LTS).
