# Unit Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, multi-tenant Next.js + Convex + Clerk app (codename `unit`) with organisations, projects and people CRUD, wired to GitHub and Vercel, rename-friendly throughout.

**Architecture:** Next.js App Router frontend on Vercel; Convex as the realtime database and function layer; Clerk for auth with organisations as the tenancy boundary. Every Convex table carries `orgId`; every query/mutation derives the org from the authenticated Clerk identity, never from client input. Brand name lives in one config file so renaming is a one-file change plus repo/project renames.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind v4, shadcn/ui), Convex, Clerk (`@clerk/nextjs`), Vercel. Convex CLI runs under Node 22 on this machine (Node 24 + libuv crash); prefix PATH with `C:\Users\itswe\node22`.

**Environment facts (this machine):**
- Scaffold target `C:\dev\projects\videoprod` already contains `.git/` and `docs/`, so `create-next-app` must scaffold into a temp dir and files are then moved to the root.
- Convex CLI: run all `npx convex ...` commands in a shell with `$env:Path = "C:\Users\itswe\node22;$env:Path"`.
- Vercel CLI is not installed; deployment goes through the Vercel MCP (`deploy_to_vercel`) or `npm i -g vercel` + login if MCP lacks env-var support.
- GitHub repo creation via the GitHub MCP (`create_repository`), push via local git (credential manager already holds GitHub auth from other projects under `C:\dev\projects\`).
- Clerk keys: try the `clerk` CLI first (per clerk skill); if not authenticated, app keys must come from Matt via dashboard. Code and `.env.example` are written regardless so the app runs the moment keys land.

---

### Task 1: Scaffold Next.js into the existing repo

**Files:**
- Create: full Next.js scaffold at repo root (`app/`, `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.gitignore`, etc.)

- [ ] **Step 1: Scaffold in a temp subdir (create-next-app refuses non-empty dirs)**

```powershell
npx --yes create-next-app@latest unit-scaffold --ts --tailwind --eslint --app --src-dir --use-npm --turbopack --import-alias "@/*" --yes
```

- [ ] **Step 2: Move scaffold contents to repo root and remove temp dir**

```powershell
Get-ChildItem -Force C:\dev\projects\videoprod\unit-scaffold | Move-Item -Destination C:\dev\projects\videoprod
Remove-Item C:\dev\projects\videoprod\unit-scaffold
```

- [ ] **Step 3: Verify dev server boots**

Run: `npm run build` (cheaper than holding a dev server; confirms scaffold integrity)
Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "Scaffold Next.js app (TypeScript, Tailwind, App Router)"
```

### Task 2: Brand config (rename-friendly naming)

**Files:**
- Create: `src/lib/brand.ts`

- [ ] **Step 1: Create the single source of truth for the product name**

```ts
// src/lib/brand.ts
export const BRAND = {
  name: "Unit",
  domain: "unit.film",
  tagline: "The command centre for video production companies",
} as const;
```

All UI copy, email templates and metadata import from here. Renaming later = edit this file + rename GitHub repo + rename Vercel project.

- [ ] **Step 2: Use it in root layout metadata** (`src/app/layout.tsx`): `export const metadata = { title: BRAND.name, description: BRAND.tagline }`.

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "Add brand config as single rename point"
```

### Task 3: Convex install and provision

**Files:**
- Create: `convex/` directory, `convex.json`, `.env.local` (gitignored), `src/app/ConvexClientProvider.tsx`

- [ ] **Step 1: Install deps**

```powershell
npm install convex
```

- [ ] **Step 2: Provision the Convex project (Node 22 shell)**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once --configure=new --project unit
```

Expected: creates project `unit` on Matt's Convex account, writes `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOYMENT` to `.env.local`. If it reports not logged in, stop and ask Matt to run `! npx convex login` (with Node 22 PATH prefix).

- [ ] **Step 3: Read `convex/_generated/ai/guidelines.md` if generated** (per boostkit-engineering-checks) and follow it for all Convex code.

- [ ] **Step 4: Commit** (convex config; `.env.local` stays gitignored)

```powershell
git add -A; git commit -m "Add Convex and provision dev deployment"
```

### Task 4: Clerk install and auth wiring

**Files:**
- Create: `src/middleware.ts`, `convex/auth.config.ts`, `.env.example`
- Modify: `src/app/layout.tsx`, `src/app/ConvexClientProvider.tsx`

- [ ] **Step 1: Try the clerk CLI for app creation/keys**

```powershell
clerk --version; clerk apps list
```

If authenticated: create app `unit`, pull `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` into `.env.local`. If CLI absent/unauthenticated: write `.env.example` with placeholders, continue building, and flag the two keys as the only blocker at the end.

- [ ] **Step 2: Install and wire Clerk + Convex integration**

```powershell
npm install @clerk/nextjs
```

`src/middleware.ts`:
```ts
import { clerkMiddleware } from "@clerk/nextjs/server";
export default clerkMiddleware();
export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
```

`convex/auth.config.ts`:
```ts
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
```

`src/app/ConvexClientProvider.tsx`:
```tsx
"use client";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
```

Wrap `children` with `ConvexClientProvider` in `src/app/layout.tsx`. Requires a Clerk JWT template named `convex` (CLI or dashboard; flag if dashboard-only).

- [ ] **Step 3: `.env.example`** with `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN` (set the latter in the Convex dashboard env too).

- [ ] **Step 4: Build check + commit**

```powershell
npm run build
git add -A; git commit -m "Wire Clerk auth with Convex integration"
```

### Task 5: Convex schema (phase 1 tables)

**Files:**
- Create: `convex/schema.ts`

- [ ] **Step 1: Define schema**

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  organisations: defineTable({
    name: v.string(),
    clerkOrgId: v.string(),
    settings: v.optional(v.object({ brandColor: v.optional(v.string()) })),
  }).index("by_clerk_org", ["clerkOrgId"]),

  clients: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    notes: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  people: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    role: v.string(), // free text: "DP", "Sound recordist", "Editor"
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    dayRate: v.optional(v.number()),
    dietary: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_name", ["orgId", "name"]),

  projects: defineTable({
    orgId: v.id("organisations"),
    clientId: v.optional(v.id("clients")),
    name: v.string(),
    status: v.union(
      v.literal("brief"),
      v.literal("pre_production"),
      v.literal("shooting"),
      v.literal("post"),
      v.literal("delivered"),
      v.literal("archived")
    ),
    briefSummary: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),
});
```

- [ ] **Step 2: Push schema** (Node 22 shell): `npx convex dev --once`
Expected: schema validates and deploys.

- [ ] **Step 3: Commit**

### Task 6: Org-scoped auth helper + organisations functions

**Files:**
- Create: `convex/lib/auth.ts`, `convex/organisations.ts`

- [ ] **Step 1: Auth helper used by every function**

```ts
// convex/lib/auth.ts
import { QueryCtx, MutationCtx } from "../_generated/server";

export async function requireOrg(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const clerkOrgId = (identity.org_id as string) ?? null;
  if (!clerkOrgId) throw new Error("No active organisation");
  const org = await ctx.db
    .query("organisations")
    .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
  if (!org) throw new Error("Organisation not provisioned");
  return { identity, org };
}
```

- [ ] **Step 2: `convex/organisations.ts`** with `ensure` mutation (creates the org row on first sign-in, idempotent by `clerkOrgId`) and `current` query. Called from a client-side bootstrap component after Clerk org selection.

- [ ] **Step 3: Push, commit.**

### Task 7: Projects and people functions (org-scoped CRUD)

**Files:**
- Create: `convex/projects.ts`, `convex/people.ts`, `convex/clients.ts`

- [ ] **Step 1: Implement CRUD**: each function calls `requireOrg`, filters with `.withIndex("by_org", q => q.eq("orgId", org._id))`, and validates args with `v` validators. Mutations never accept `orgId` from the client. `list`/`get`/`create`/`update`/`archive` for projects; `list`/`get`/`create`/`update`/`remove` for people and clients.

- [ ] **Step 2: Push schema/functions, run a smoke test in the Convex dashboard function runner, commit.**

### Task 8: App shell and UI foundation

**Files:**
- Create: `src/components/` (shadcn), `src/app/(app)/layout.tsx` (sidebar shell), `src/app/(app)/dashboard/page.tsx`, `src/app/page.tsx` (marketing stub → sign-in), `src/app/(app)/org-bootstrap.tsx`

- [ ] **Step 1: Init shadcn/ui** (`npx shadcn@latest init -d`, then add `button card dialog dropdown-menu input label select table badge sonner skeleton`).

- [ ] **Step 2: Build the authed shell**: left sidebar (Dashboard, Projects, People, Clients), org switcher (`<OrganizationSwitcher/>`), user button. Dark-friendly, Linear-flavoured: neutral greys, one accent. All copy imports `BRAND`.

- [ ] **Step 3: Org bootstrap component** calls `organisations.ensure` when the active Clerk org changes.

- [ ] **Step 4: Build check, commit.**

### Task 9: Projects pages

**Files:**
- Create: `src/app/(app)/projects/page.tsx` (list + create dialog), `src/app/(app)/projects/[id]/page.tsx` (detail: status, client, brief summary)

- [ ] **Step 1: List page**: `useQuery(api.projects.list)`, table with name/client/status badge, create dialog with Zod-validated form.
- [ ] **Step 2: Detail page**: editable fields, status select, archive action with confirm.
- [ ] **Step 3: Build check, commit.**

### Task 10: People and clients pages

**Files:**
- Create: `src/app/(app)/people/page.tsx`, `src/app/(app)/clients/page.tsx`

- [ ] **Step 1: People table** (name, role, email, phone, day rate) + create/edit dialog.
- [ ] **Step 2: Clients list** + create/edit dialog.
- [ ] **Step 3: Build check, commit.**

### Task 11: GitHub repo + push

- [ ] **Step 1: Create private repo `unit` via GitHub MCP** (`create_repository`, private: true).
- [ ] **Step 2: Add remote and push**

```powershell
git remote add origin https://github.com/<owner>/unit.git
git push -u origin main
git status   # confirm "up to date with origin/main"
```

### Task 12: Vercel project + deploy

- [ ] **Step 1: Deploy via Vercel MCP** (`deploy_to_vercel`) to create project `unit`, or install Vercel CLI if env vars need setting and MCP can't.
- [ ] **Step 2: Set env vars** (`NEXT_PUBLIC_CONVEX_URL`, Clerk keys when available) on the Vercel project.
- [ ] **Step 3: Verify the deployment serves the marketing stub; authed area requires Clerk keys.**

### Task 13: Verification pass

- [ ] `npm run build` clean; `npx convex dev --once` clean.
- [ ] Playwright or manual smoke: sign-in page renders, dashboard shell renders with keys present.
- [ ] All commits pushed; `git status` clean and up to date.
- [ ] Flag any outstanding blockers (Clerk keys, JWT template) to Matt explicitly.

---

**Self-review notes:** Spec coverage for phase 1 only (per scope check; phases 2-4 get their own plans). No placeholders beyond deliberate CLI-availability branches (Clerk CLI, Vercel MCP), each with an explicit fallback. Type names consistent (`organisations`, `clerkOrgId`, `requireOrg`). TDD is relaxed for scaffold/UI tasks (build checks + smoke tests instead); proper unit/e2e testing lands with the call sheet engine in phase 2 where logic density justifies it.
