# UnitDeck

Production OS for video companies: plan shoots, send call sheets, track confirmations and run production days from one place. Live at https://unitdeck.app. `src/lib/brand.ts` is the single rename point.

## Stack

- Next.js (App Router, TypeScript, Tailwind v4, shadcn/ui on Base UI)
- Convex (database, realtime, functions): project `unit` on team `boostkit_`
- Clerk (auth, organisations as tenancy boundary)
- Vercel (hosting): project `unit` on team `boostkit`, production at https://unitdeck.app (alias unit-boostkit.vercel.app), auto-deploys from `main`

## Local development

```bash
npm install
npx convex dev   # run under Node 22 on Windows (see note below)
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the values. Convex writes its own values when `npx convex dev` first runs.

### Windows note

The Convex CLI crashes on exit under Node 24 (libuv assertion). Prefix the shell with the portable Node 22:

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"
```

## Architecture rules

- Every Convex table carries `orgId`. Every query/mutation derives the org from the Clerk identity via `requireOrg` (`convex/lib/auth.ts`), never from client arguments.
- AI agents (phase 4) write proposals to `agentRuns`, never directly to production data.
- All UI copy imports from `src/lib/brand.ts`.

## Docs

- Product spec: `docs/superpowers/specs/2026-06-12-unit-mvp-design.md`
- Competitor research: `docs/research/2026-06-12-studiobinder-competitor-research.md`
- Phase 1 plan: `docs/superpowers/plans/2026-06-12-unit-phase1-foundation.md`
- Phase 2 plan (call sheets, versioning, PDF): `docs/superpowers/plans/2026-06-12-unit-phase2-call-sheets.md`
- Phase 3 plan (distribution, set mode, command centre): `docs/superpowers/plans/2026-06-12-unit-phase3-distribution.md`
