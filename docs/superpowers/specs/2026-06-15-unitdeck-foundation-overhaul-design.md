# UnitDeck: foundation overhaul. Mobile shell, identity and command centre. Design spec

Date: 15 June 2026
Status: approved, ready for implementation plan
Predecessor: `docs/superpowers/specs/2026-06-12-unit-mvp-design.md`

## 1. Goal

Turn the existing call-sheet-and-shoot-day MVP into a platform that can credibly rival StudioBinder, starting with the foundation the rest of the product hangs on. This pass does not add StudioBinder feature parity (stripboard, shot lists, breakdown, calendar, tasks, file sharing). It makes the product genuinely usable on a phone (where call sheets are checked on set) and gives the working app a real UnitDeck identity instead of generic greyscale shadcn.

Two problems this fixes:
1. The app shell is a hardcoded 224px sidebar (`src/app/(app)/layout.tsx`) with zero responsive handling. On a phone it eats half the viewport and there is no nav affordance at all.
2. `globals.css` defines a full token system but the app ignores it and hardcodes `neutral-*`. The app is pure greyscale and disconnected from the distinctive marketing identity (navy → periwinkle mesh gradient, Unbounded wordmark, stacked-layers mark).

## 2. Decisions made (brainstorm outcomes)

- **Sequencing**: foundation first, feature roadmap (track B) second.
- **Mobile navigation**: hybrid. Desktop keeps a sidebar; mobile gets a bottom tab bar (Home · Projects · People · More) plus a More sheet for the rest. Chosen over a pure 5-tab bar (won't scale to the coming feature surface) and a hamburger-only drawer (buries primary nav).
- **Visual identity**: cinematic dark as the default theme, with a full light mode toggle. Built on the existing token system, not hardcoded.
- **Scope add-ons (all in)**: re-skin every existing screen, redesign the crew set-mode page, ship as an installable PWA, and add a ⌘K command palette with global search.

## 3. Scope

### In
- Design-system foundation: navy/periwinkle accent tokens, status colour scale, dark-default + light theme via `next-themes`, Unbounded heading font, migration off raw `neutral-*` onto semantic tokens.
- Responsive app shell with hybrid navigation (Sidebar, TopBar, MobileTabBar, MoreSheet, ThemeToggle).
- Command-centre dashboard rebuild (UI + a dashboard query extension).
- Re-skin and make responsive: projects, project detail, shoot-days, people, clients, locations, call-sheet composer.
- Crew set-mode page redesign (`src/app/s/[token]/page.tsx`), on-brand, mobile-first, offline-tolerant.
- Command palette + global search across projects, people, clients, locations.
- PWA: web manifest, app icons, standalone display, service worker caching the app shell and the crew set-mode route for offline viewing on location.

### Out (track B roadmap, unchanged data model)
Shooting schedule / stripboard, shot lists / storyboards, script breakdown, production calendar, task management, file/asset sharing, budgeting. The navigation and information architecture are built to absorb these later; no Convex schema changes in this pass.

## 4. Design-system foundation

The root unit. Everything else depends on it.

- **Tokens** (`src/app/globals.css`): keep the OKLCH structure. Set `--primary` and accent ramp from the brand navy/periwinkle (`#34406B` → `#6B7FBE`). Add a semantic **status colour scale** for project status (`brief`, `pre_production`, `shooting`, `post`, `delivered`, `archived`) and recipient status (`pending`, `sent`, `viewed`, `confirmed`, `declined`, `failed`), each with a dark and light variant meeting WCAG AA on its surface. Single source of truth lives in `src/lib/project-status.ts` (extend it; add a recipient-status sibling if cleaner).
- **Theme**: wire `next-themes` (already a dependency, currently unused). `ThemeProvider` in `src/app/layout.tsx` with `defaultTheme="dark"`, `enableSystem={false}` (we choose dark, not OS), `attribute="class"`, persisted. Avoid hydration flash with `suppressHydrationWarning` on `<html>`.
- **Type**: register Unbounded via `next/font` in the root layout if not already, expose as `--font-heading`, and point heading utilities at it. Body stays Geist. Map `--font-heading` onto `h1/h2` and key surface titles, not body text.
- **Token migration**: replace `bg-neutral-50/white/900` etc. in the shell and screens with `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`. This is what makes light/dark work without per-component branching.

## 5. Shell + navigation

Replace the monolithic `src/app/(app)/layout.tsx` with composed pieces in `src/components/shell/`:

- `app-shell.tsx` — orchestrates layout, renders Sidebar (desktop) or TopBar + MobileTabBar (mobile), wraps `OrgGate` and `children`. Breakpoint: sidebar at `md` and up, bottom bar below.
- `sidebar.tsx` — desktop only. Logo (keeps scroll-to-top-on-home behaviour), `OrganizationSwitcher`, nav (Dashboard, Projects, People, Clients, Locations), footer (Search trigger, ThemeToggle, Feedback, UserButton).
- `top-bar.tsx` — mobile/desktop top bar: page context, ⌘K search trigger, ThemeToggle, UserButton, org switcher (compact on mobile).
- `mobile-tab-bar.tsx` — fixed bottom bar, four tabs: Home · Projects · People · More. Active state from `usePathname`. Respects `env(safe-area-inset-bottom)`.
- `more-sheet.tsx` — bottom sheet opened by the More tab: Clients, Locations, Search, Theme, Feedback, sign-out, org switcher.
- `theme-toggle.tsx` — dark/light switch.
- A `sheet.tsx` UI primitive (bottom sheet) built on the Base UI dialog, since shadcn/Base UI has no sheet yet.

Content wrapper keeps a max width on desktop and goes full-bleed with comfortable padding on mobile; the bottom bar gets bottom padding so it never overlaps content.

## 6. Command-centre dashboard

Rebuild `src/app/(app)/dashboard/page.tsx`:

- **Hero band** (mesh gradient): greeting + live one-line summary (e.g. "2 shoot days this week · 3 crew unconfirmed") + a "+ New" action.
- **Stat tiles** (4): Active projects, Crew, Upcoming shoot days, Unconfirmed (warning-tinted). Each links to its screen.
- **Needs attention**: the existing `convex/dashboard.ts` `attention` query, restyled with status dots and chips.
- **This week**: new panel listing upcoming shoot days with a confirmation progress bar (confirmed / total recipients). Requires a new `upcomingShootDays` query in `convex/dashboard.ts` (org-scoped, next 7 days, joined to recipient counts) with a vitest test alongside the existing `dashboard.test.ts`.
- **Active productions**: project list with status chips and quick links.

All panels collapse to a single column below `md`.

## 7. Re-skin existing screens

Apply tokens + responsiveness to projects, project detail, shoot-days, people, clients, locations, and the call-sheet composer. The recurring mobile offender is wide `<table>` layouts: introduce a shared responsive pattern that renders a table at `md`+ and stacked cards below it (a small `ResponsiveTable`/card-row helper rather than per-screen rewrites). The call-sheet composer is the densest screen and gets the most careful mobile treatment, but the composer's core editing flow is not redesigned in this pass, only made usable and on-theme.

## 8. Crew set-mode page

Redesign `src/app/s/[token]/page.tsx`, the unauthenticated per-recipient page crew open on their phones:

- Call-time hero (name, role, call time, project, date), on-brand dark by default.
- Location with map link (lat/lng or what3words), parking and access notes, nearest hospital.
- Weather + sun snapshot for the day.
- Schedule and any notes.
- Large primary actions: confirm / decline, check-in, safety acknowledgement, mapped to the existing recipient status mutations.
- Offline-tolerant: once viewed, the page and its data are cached by the service worker so call time and location survive patchy signal on set.

This page must look correct in both themes but defaults to the brand dark; it has no app chrome (no sidebar/tab bar).

## 9. Command palette + global search

- `src/components/command/command-palette.tsx`: a dialog opened by ⌘K / Ctrl+K, the TopBar search affordance, and the More sheet.
- v1 fuzzy-filters already-loaded org data (projects, people, clients, locations) client-side; grouped results, keyboard navigation, Enter to navigate. Quick actions (New project, New person) included.
- Add Convex search indexes only if/when org data volume makes client-side filtering insufficient; not required for v1.

## 10. PWA / installable

- `src/app/manifest.ts` (Next metadata manifest route): name/short_name UnitDeck, `display: "standalone"`, `theme_color` brand navy `#11182F`, background colour, `start_url: "/dashboard"`, maskable icons.
- App icons: generate 192/512 (incl. maskable) PNGs from the stacked-layers mark; add `apple-touch-icon` and iOS web-app meta.
- Service worker (`public/sw.js`, registered from a small client component): precache the app shell and an offline fallback; runtime-cache the crew set-mode route and its data with stale-while-revalidate. Implemented minimally by hand rather than via a plugin, to stay compatible with Next 16. Offline scope is deliberately narrow: app shell + set-mode viewing, not full offline editing.

## 11. Build order (independently shippable units)

1. **Design-system foundation** (§4) — tokens, theme provider, Unbounded, status scale. Nothing looks right until this lands.
2. **Responsive shell + nav** (§5) — replaces `layout.tsx`.
3. **Command-centre dashboard** (§6) — incl. the `upcomingShootDays` query + test.
4. **Re-skin existing screens** (§7) — incl. the responsive table/card helper.
5. **Crew set-mode page** (§8).
6. **Command palette + global search** (§9).
7. **PWA** (§10).

Each unit is shippable on its own and leaves `main` deployable.

## 12. Testing and verification

- Playwright at desktop and mobile viewports: nav reachable on mobile (bottom bar + More sheet), no content hidden behind the bar, command palette opens via keyboard, theme toggle persists across reload, no dark-on-dark or light-on-light regressions in either theme.
- Keep existing Convex vitest suites green; add the `upcomingShootDays` dashboard test.
- Lighthouse: PWA installable; verify the manifest and service worker register and that the set-mode route loads offline after a first visit.
- Contrast check on the dark theme status chips and muted text (WCAG AA).
- UK English throughout; copy via `src/lib/brand.ts` where it already routes through it.

## 13. Non-goals

No StudioBinder feature parity in this pass, no Convex schema changes, no billing, no native apps. The call-sheet composer's editing model is untouched beyond theming and responsiveness. Track B (the feature roadmap to rival StudioBinder) is planned separately once this foundation ships.
