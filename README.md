# UnitDeck

Production OS for video companies: plan shoots, book crew and kit, quote the job, send call sheets, track confirmations and run production days from one place. Live at https://unitdeck.app. `src/lib/brand.ts` is the single rename point.

## Stack

- Next.js 16 (App Router, React 19, TypeScript, Tailwind v4, shadcn/ui on Base UI)
- Convex (database, realtime, functions): project `unit` on team `boostkit_`
- Clerk (auth, organisations as the tenancy boundary)
- Vercel (hosting): project `unit` on team `boostkit`, production at https://unitdeck.app
- Node 24 everywhere: locally, in CI and on Vercel (`engines` in `package.json`)

## Local development

```bash
npm install
npx convex dev   # pushes functions to the dev deployment and watches
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the values. Convex writes its own values when `npx convex dev` first runs.

## Checks

```bash
npm run lint
npm run typecheck   # the app, then the Convex functions on their own config
npm run test
npm run build       # Next.js only; deploys nothing
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests on every push and pull request.

## Release

A push to `main` is a production release. `.github/workflows/deploy-production.yml` deploys `main` to Vercel through the CLI, and the Vercel build command (`vercel.json`) is `npm run build:vercel`, which in the production environment runs `npx convex deploy --cmd 'npm run build'`, so the same step pushes the Convex functions and schema to the production deployment. There is no staging step in between: treat a push to `main` as a change to the live app and its live data model.

Preview deployments of other branches do not run `convex deploy` unless the Vercel preview environment holds a preview deploy key (`CONVEX_DEPLOY_KEY` starting `preview:`). Without one, `build:vercel` builds Next.js only, against whatever `NEXT_PUBLIC_CONVEX_URL` the preview environment provides; with none set, the preview builds but has no Convex backend.

## Addresses

Every in-app address is built in `src/lib/routes.ts` and names a thing the way the office does:

| Page | Address |
| --- | --- |
| Production | `/projects/0025` (job number) |
| Kit list | `/projects/0025/kit-list` |
| A day's call sheet | `/projects/0025/call-sheets/2026-10-05` (shoot date) |
| Combined call sheet | `/projects/0025/call-sheets/combined` |
| Wrap report | `/projects/0025/wrap/2026-10-05` |
| Quote | `/quotes/260915_Rap_2` (quote reference) |
| Client copy of a quote | `/quotes/260915_Rap_2/view` |

Each page also opens from the database id that older links carry, then moves the address bar to the readable form (`src/lib/use-canonical-path.ts`). The old `/projects/…/shoot-days/<id>/…` addresses redirect (`next.config.ts`). Public links sent to crew, signers and PDF renderers are token addresses (`/s/…`, `/sign/…`, `/print/…`) and are unchanged.

## Architecture rules

- Every Convex table carries `orgId`. Every query and mutation derives the org from the Clerk identity via `requireOrg` (`convex/lib/auth.ts`), never from client arguments.
- AI agents write proposals to `agentRuns`, never directly to production data.
- All UI copy imports from `src/lib/brand.ts`.
- Kit clashes are counted in one place, `convex/lib/kitClashes.ts`, a day at a time. The production page, the kit picker and the dashboard all read from it.
- Read `convex/_generated/ai/guidelines.md` before changing Convex code, and the relevant guide under `node_modules/next/dist/docs/` before changing framework behaviour.

## Docs

- Agent and project context: `docs/agent-context/`
- Product spec: `docs/superpowers/specs/2026-06-12-unit-mvp-design.md`
- Later designs and build plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`
- Competitor research: `docs/research/`
- July 2026 audit plans (all complete): `plans/`
