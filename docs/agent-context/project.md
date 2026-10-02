---
source: project adoption approved on 2026-09-29
author: portfolio tooling
captured: 2026-09-29
trust: unreviewed
sensitivity: repository-safe
---

# unitdeck project context

<!-- agent-context:start -->
- Canonical path: C:\dev\projects\unitdeck
- Portfolio ID: unitdeck
- Kind: client
- Business: boostkit
- Client ID: none recorded
- Lifecycle status: uncertain
- Production changes require explicit approval.
- Add verified architecture, integrations, commands, and constraints here. Never add secret values or private commercial notes.
<!-- agent-context:end -->

## Verified on 2 October 2026

Checked against source, CI configuration, the Vercel project and the production
Convex deployment (read-only).

### What it is

UnitDeck is a production-management app for video companies: productions,
shoot days, crew, kit, locations, quotes, call sheets and e-signed releases.
It is live at https://unitdeck.app with a real customer organisation using it
daily. Users send feedback from inside the app (`feedback` table); that is the
working backlog.

### Stack and runtime

- Next.js 16 App Router, React 19, TypeScript 6, Tailwind v4, Base UI.
- Convex for data and functions, Clerk for auth and organisations.
- Node 24 locally, in CI and on Vercel (`engines` in `package.json`).
- TypeScript stays on 6.0 and ESLint on 9 until `typescript-eslint` and
  `eslint-plugin-react` support TypeScript 7 and ESLint 10.

### Commands

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`. None of
  them deploys anything. `typecheck` covers `convex/tsconfig.json` as well,
  because `convex deploy` typechecks the functions and a failure there stops a
  release.
- `npx convex codegen` regenerates `convex/_generated` against the dev
  deployment named in `.env.local`.

### Release

- A push to `main` deploys production: `.github/workflows/deploy-production.yml` runs the
  Vercel CLI, and the Vercel build command is
  `npx convex deploy --cmd 'npm run build'`, which also pushes Convex functions
  and schema to the production deployment. There is no staging step.
- Branch previews on Vercel fail at build: no Convex deploy key is configured
  for the preview environment.

### Constraints worth knowing

- The dev Convex deployment is scratch data. Production holds the customer's
  real data; read it only, and only when a bug cannot be diagnosed otherwise.
- Convex schema changes ship with the push. Adding an optional field or an
  index is safe; narrowing a validator needs a migration first.
- In-app addresses are built only in `src/lib/routes.ts`. Pages accept a
  readable reference or a document id and canonicalise to the readable one.
- Kit clash counting lives only in `convex/lib/kitClashes.ts`.
- PDFs render through headless Chromium (`@sparticuz/chromium` on Vercel, the
  local Chrome in development), so PDF output on the deployed binary cannot be
  checked locally.
