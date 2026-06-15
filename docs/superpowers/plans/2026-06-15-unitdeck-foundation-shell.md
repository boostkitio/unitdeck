# UnitDeck Foundation: Design System + Responsive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give UnitDeck a cinematic-dark-default theme (with a light toggle) built on its existing token system, and replace the broken fixed sidebar with a responsive shell that uses a hybrid navigation pattern (desktop sidebar; mobile bottom tab bar + More sheet).

**Architecture:** Two units. Unit 1 reworks the OKLCH token set in `globals.css`, wires `next-themes` (already a dependency, currently unused) for a dark default, points `--font-heading` at the already-loaded Unbounded font, and refines the project-status colour map. Unit 2 decomposes the monolithic `src/app/(app)/layout.tsx` into focused shell components in `src/components/shell/` plus a reusable bottom-sheet primitive, all consuming semantic tokens so light and dark work without per-component branching.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui on Base UI (`@base-ui/react`), `next-themes`, `lucide-react`, Clerk, Convex. Tests: Vitest (edge-runtime) for pure logic; `npm run build` + manual/Playwright visual checks for UI.

---

## Context the engineer needs

- **Brand palette** (from `src/components/marketing/shader-band.tsx`): navy → periwinkle `#11182F`, `#1F2747`, `#34406B`, `#6B7FBE`. The deep navy is the dark-theme base; periwinkle is the dark accent.
- **The app currently ignores its own tokens.** `src/app/(app)/layout.tsx` and `dashboard/page.tsx` hardcode `neutral-*`/`white`. We migrate the shell onto `bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-sidebar`, etc.
- **`font-heading` is already consumed** by components (e.g. `DialogTitle` uses `font-heading`). `globals.css` currently maps it to Geist; pointing it at Unbounded instantly brands existing headings.
- **Base UI composition pattern**: primitives accept a `render={<SomeElement/>}` prop to merge behaviour onto your own element (see `src/components/ui/dialog.tsx` `DialogClose render={<Button/>}`). The bottom sheet mirrors `dialog.tsx`.
- **Vitest only globs `convex/**/*.test.ts`** today (`vitest.config.ts`). Task 1 broadens it to include `src/**/*.test.ts` so pure-logic tests in `src/` run. The edge-runtime environment is fine for framework-free logic (no DOM).
- **Auth gating**: `(app)/*` routes are behind Clerk + `OrgGate`. Automated Playwright on these routes needs a signed-in session; primary UI verification is `npm run build` (catches type/import errors) plus a manual signed-in run with screenshots in both themes and both viewports.
- **Windows/Convex note**: these two units touch no Convex functions, so `npx convex dev` is not required. `npm run dev` connects to the existing deployment via `.env.local`.
- **Commit style**: match the repo's sentence-case messages (e.g. "Add animated mesh gradient band…"). No `feat:` prefix, no AI trailers.

---

## Unit 1 — Design system foundation

### Task 1: Refine the project-status colour map (with tests)

**Files:**
- Modify: `vitest.config.ts`
- Modify: `src/lib/project-status.ts`
- Test: `src/lib/project-status.test.ts` (create)

- [ ] **Step 1: Broaden the Vitest include glob**

Edit `vitest.config.ts`, replace:

```ts
    include: ["convex/**/*.test.ts"],
```

with:

```ts
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/project-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROJECT_STATUSES, statusLabel, statusBadgeClass } from "./project-status";

describe("project status", () => {
  it("labels known and unknown values", () => {
    expect(statusLabel("shooting")).toBe("Shooting");
    expect(statusLabel("mystery")).toBe("mystery");
  });

  it("gives every known status a badge class with a background", () => {
    for (const s of PROJECT_STATUSES) {
      expect(statusBadgeClass(s.value)).toMatch(/bg-/);
    }
  });

  it("falls back to a neutral badge for unknown status", () => {
    expect(statusBadgeClass("mystery")).toMatch(/bg-/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/lib/project-status.test.ts`
Expected: FAIL — `statusBadgeClass` is not exported.

- [ ] **Step 4: Implement `statusBadgeClass` and the canonical colour map**

In `src/lib/project-status.ts`, replace the `STATUS_BADGE_CLASSES` object (lines 16-23) with the canonical mapping and add a helper below it:

```ts
// Canonical status colours. Each works on both light and dark surfaces.
// brief=slate, pre-pro=amber, shooting=emerald (rolling), post=violet, delivered=blue, archived=muted.
export const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  brief: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  pre_production: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  shooting: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  post: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  delivered: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  archived: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};

const FALLBACK_BADGE =
  "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500";

/** Badge classes for a status value, with a neutral fallback for unknown values. */
export function statusBadgeClass(value: string): string {
  return STATUS_BADGE_CLASSES[value as ProjectStatus] ?? FALLBACK_BADGE;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/lib/project-status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Update existing consumers of the badge map**

Search for direct `STATUS_BADGE_CLASSES[` usage and switch to `statusBadgeClass(...)` so unknown values never crash:

Run: `git grep -n "STATUS_BADGE_CLASSES\[" -- src` (replace each indexed access with `statusBadgeClass(value)`; leave the exported object as-is for anything importing the whole map).

- [ ] **Step 7: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add vitest.config.ts src/lib/project-status.ts src/lib/project-status.test.ts
git commit -m "Add canonical project-status colours and a tested badge helper"
```

---

### Task 2: Brand tokens + Unbounded headings in globals.css

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Point the heading font at Unbounded**

In the `@theme inline` block, replace:

```css
  --font-heading: var(--font-geist-sans);
```

with:

```css
  --font-heading: var(--font-unbounded);
```

- [ ] **Step 2: Set the light-theme brand primary**

In `:root`, replace these lines:

```css
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
```

with:

```css
  --primary: oklch(0.45 0.10 264);
  --primary-foreground: oklch(0.985 0 0);
```

And replace:

```css
  --ring: oklch(0.708 0 0);
```

with:

```css
  --ring: oklch(0.55 0.10 264);
```

And replace:

```css
  --sidebar-primary: oklch(0.205 0 0);
```

with:

```css
  --sidebar-primary: oklch(0.45 0.10 264);
```

- [ ] **Step 3: Tint the dark theme navy and set the periwinkle accent**

In `.dark`, apply these replacements (each left-hand line appears once):

```css
  --background: oklch(0.145 0 0);   ->  --background: oklch(0.16 0.022 264);
  --card: oklch(0.205 0 0);         ->  --card: oklch(0.21 0.028 264);
  --popover: oklch(0.205 0 0);      ->  --popover: oklch(0.21 0.028 264);
  --primary: oklch(0.922 0 0);      ->  --primary: oklch(0.72 0.11 264);
  --primary-foreground: oklch(0.205 0 0); -> --primary-foreground: oklch(0.21 0.04 264);
  --secondary: oklch(0.269 0 0);    ->  --secondary: oklch(0.27 0.03 264);
  --muted: oklch(0.269 0 0);        ->  --muted: oklch(0.27 0.03 264);
  --muted-foreground: oklch(0.708 0 0); -> --muted-foreground: oklch(0.74 0.03 264);
  --accent: oklch(0.269 0 0);       ->  --accent: oklch(0.27 0.03 264);
  --ring: oklch(0.556 0 0);         ->  --ring: oklch(0.62 0.10 264);
  --sidebar: oklch(0.205 0 0);      ->  --sidebar: oklch(0.18 0.025 264);
```

Leave `--sidebar-primary: oklch(0.488 0.243 264.376)` as-is (already brand-hued).

- [ ] **Step 4: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds, no CSS errors.

```bash
git add src/app/globals.css
git commit -m "Add navy/periwinkle brand tokens and Unbounded headings"
```

---

### Task 3: Wire next-themes with a dark default

**Files:**
- Create: `src/app/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the theme provider**

Create `src/app/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: Wrap the app and silence the hydration warning**

In `src/app/layout.tsx`, add the import:

```tsx
import { ThemeProvider } from "./theme-provider";
```

Add `suppressHydrationWarning` to the `<html>` tag (next-themes mutates the class before hydration):

```tsx
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${unbounded.variable} h-full antialiased`}
    >
```

Wrap the existing body content with `ThemeProvider`:

```tsx
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ThemeProvider>
      </body>
```

- [ ] **Step 3: Verify the build and the default theme**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run dev`, open the marketing homepage and (signed in) `/dashboard`. The `<html>` element should carry `class="… dark"`. App surfaces render on the navy background. Marketing pages keep their own explicit `bg-white` and are intentionally unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/app/theme-provider.tsx src/app/layout.tsx
git commit -m "Default the app to a dark theme via next-themes"
```

---

### Task 4: Theme toggle component

**Files:**
- Create: `src/components/shell/theme-toggle.tsx`

- [ ] **Step 1: Create the toggle**

Create `src/components/shell/theme-toggle.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch */}
      {mounted && isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
```

- [ ] **Step 2: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/components/shell/theme-toggle.tsx
git commit -m "Add a theme toggle button"
```

- [ ] **Step 3: Push Unit 1**

Run: `git push`
Expected: `git status -sb` shows up to date with `origin/main`. Vercel redeploys.

---

## Unit 2 — Responsive shell + hybrid navigation

### Task 5: Navigation config + active-route helper (with tests)

**Files:**
- Create: `src/components/shell/nav-items.ts`
- Test: `src/components/shell/nav-items.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/components/shell/nav-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isActive } from "./nav-items";

describe("isActive", () => {
  it("matches the dashboard only on an exact path", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
    expect(isActive("/dashboard/anything", "/dashboard")).toBe(false);
  });

  it("matches a section and its nested routes", () => {
    expect(isActive("/projects", "/projects")).toBe(true);
    expect(isActive("/projects/abc123", "/projects")).toBe(true);
  });

  it("does not match a different section", () => {
    expect(isActive("/people", "/projects")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/components/shell/nav-items.test.ts`
Expected: FAIL — cannot find module / `isActive` not exported.

- [ ] **Step 3: Implement the nav config and helper**

Create `src/components/shell/nav-items.ts`:

```ts
import {
  LayoutDashboardIcon,
  FolderIcon,
  UsersIcon,
  Building2Icon,
  MapPinIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the compact mobile tab bar. Falls back to `label`. */
  shortLabel?: string;
  icon: LucideIcon;
};

/** Full sidebar navigation (desktop). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboardIcon },
  { href: "/projects", label: "Projects", icon: FolderIcon },
  { href: "/people", label: "People", icon: UsersIcon },
  { href: "/clients", label: "Clients", icon: Building2Icon },
  { href: "/locations", label: "Locations", icon: MapPinIcon },
];

/** First three become bottom tabs; the rest live in the More sheet. */
export const PRIMARY_TABS: NavItem[] = NAV_ITEMS.slice(0, 3);
export const MORE_ITEMS: NavItem[] = NAV_ITEMS.slice(3);

/** Whether `href` is the active section for the current pathname. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/components/shell/nav-items.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/nav-items.ts src/components/shell/nav-items.test.ts
git commit -m "Add shared navigation config and active-route helper"
```

---

### Task 6: Bottom-sheet UI primitive

**Files:**
- Create: `src/components/ui/sheet.tsx`

- [ ] **Step 1: Create the sheet, mirroring dialog.tsx on Base UI**

Create `src/components/ui/sheet.tsx`:

```tsx
"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-1 rounded-t-2xl border-t border-border bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl outline-none duration-200 data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        <div
          className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30"
          aria-hidden
        />
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent };
```

- [ ] **Step 2: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds (confirms the Base UI dialog imports resolve and the `tw-animate-css` slide classes compile).

```bash
git add src/components/ui/sheet.tsx
git commit -m "Add a bottom-sheet primitive on Base UI"
```

---

### Task 7: Desktop sidebar

**Files:**
- Create: `src/components/shell/sidebar.tsx`

- [ ] **Step 1: Create the sidebar (token-based, hidden below md)**

Create `src/components/shell/sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/logo";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeToggle } from "./theme-toggle";
import { NAV_ITEMS, isActive } from "./nav-items";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4 md:flex">
      <Link
        href="/"
        className="px-2"
        onClick={(e) => {
          if (pathname === "/") {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      >
        <Logo size={15} />
      </Link>
      <div className="mt-4">
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
        />
      </div>
      <nav className="mt-6 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-muted text-foreground"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3">
        <FeedbackButton />
        <div className="flex items-center justify-between px-2">
          <UserButton />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/components/shell/sidebar.tsx
git commit -m "Add the desktop sidebar shell component"
```

---

### Task 8: Mobile top bar

**Files:**
- Create: `src/components/shell/top-bar.tsx`

- [ ] **Step 1: Create the top bar (mobile only)**

Create `src/components/shell/top-bar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "./theme-toggle";

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:hidden">
      <Link
        href="/"
        onClick={(e) => {
          if (pathname === "/") {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      >
        <Logo size={15} />
      </Link>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserButton />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/components/shell/top-bar.tsx
git commit -m "Add the mobile top bar shell component"
```

---

### Task 9: More sheet

**Files:**
- Create: `src/components/shell/more-sheet.tsx`

Depends on Task 6 (`sheet.tsx`) and Task 5 (`MORE_ITEMS`, `isActive`).

- [ ] **Step 1: Create the More sheet**

Create `src/components/shell/more-sheet.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher } from "@clerk/nextjs";
import { Sheet, SheetTrigger, SheetClose, SheetContent } from "@/components/ui/sheet";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeToggle } from "./theme-toggle";
import { MORE_ITEMS, isActive } from "./nav-items";
import { cn } from "@/lib/utils";

/** `children` is the trigger element (the More tab button). */
export function MoreSheet({ children }: { children: React.ReactElement }) {
  const pathname = usePathname();
  return (
    <Sheet>
      <SheetTrigger render={children} />
      <SheetContent>
        <div className="px-1 pb-1 font-heading text-sm">More</div>
        <div className="flex items-center justify-between gap-2 px-1 py-2">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
          />
          <ThemeToggle />
        </div>
        <nav className="flex flex-col">
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <SheetClose
                key={item.href}
                render={
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                      isActive(pathname, item.href) && "bg-muted text-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                }
              />
            );
          })}
        </nav>
        <div className="mt-2 border-t border-border pt-3">
          <FeedbackButton />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/components/shell/more-sheet.tsx
git commit -m "Add the mobile More sheet"
```

---

### Task 10: Mobile bottom tab bar

**Files:**
- Create: `src/components/shell/mobile-tab-bar.tsx`

Depends on Task 5 (`PRIMARY_TABS`, `isActive`) and Task 9 (`MoreSheet`).

- [ ] **Step 1: Create the bottom tab bar**

Create `src/components/shell/mobile-tab-bar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { PRIMARY_TABS, isActive } from "./nav-items";
import { MoreSheet } from "./more-sheet";
import { cn } from "@/lib/utils";

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {PRIMARY_TABS.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors",
              active && "text-primary"
            )}
          >
            <Icon className="size-5" />
            {item.shortLabel ?? item.label}
          </Link>
        );
      })}
      <MoreSheet>
        <button
          type="button"
          className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors aria-expanded:text-primary"
        >
          <MenuIcon className="size-5" />
          More
        </button>
      </MoreSheet>
    </nav>
  );
}
```

- [ ] **Step 2: Verify the build and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/components/shell/mobile-tab-bar.tsx
git commit -m "Add the mobile bottom tab bar"
```

---

### Task 11: Compose the AppShell and replace the app layout

**Files:**
- Create: `src/components/shell/app-shell.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Create the AppShell**

Create `src/components/shell/app-shell.tsx`:

```tsx
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileTabBar } from "./mobile-tab-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1">
          {/* pb-24 on mobile clears the fixed bottom tab bar */}
          <div className="mx-auto max-w-5xl px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
            {children}
          </div>
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
```

- [ ] **Step 2: Replace the app layout**

Replace the entire contents of `src/app/(app)/layout.tsx` with:

```tsx
import { Toaster } from "@/components/ui/sonner";
import { OrgGate } from "./org-bootstrap";
import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>
        <OrgGate>{children}</OrgGate>
      </AppShell>
      <Toaster richColors />
    </>
  );
}
```

(The old layout was a client component because it called `usePathname`; that logic now lives inside the shell's client components, so this layout is a plain server component.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds with no "usePathname in a Server Component" errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Visual verification (signed in)**

Run: `npm run dev`. Sign in, then check:
- **Desktop (≥768px)**: sidebar visible with icons + active highlight; no bottom bar; theme toggle in the sidebar footer flips dark/light and persists across reload.
- **Mobile (375px, devtools device toolbar)**: no sidebar; top bar with logo + toggle + user; bottom tab bar with Home/Projects/People/More; tapping More opens the sheet with Clients, Locations, org switcher, theme, feedback; selecting an item navigates and closes the sheet; page content is not hidden behind the bottom bar (scroll to the end of a long list to confirm the `pb-24` gap).
- **Both themes**: no dark-on-dark or light-on-light text anywhere in the shell.

Capture a screenshot of each viewport in dark mode for the record.

- [ ] **Step 6: Commit and push Unit 2**

```bash
git add src/components/shell/app-shell.tsx "src/app/(app)/layout.tsx"
git commit -m "Replace the fixed sidebar with a responsive hybrid shell"
git push
```

Expected: `git status -sb` shows up to date with `origin/main`. Vercel redeploys.

---

## Self-review against the spec

- **§4 Design system** → Tasks 1 (status scale), 2 (brand tokens + Unbounded), 3 (dark default), 4 (toggle). Covered.
- **§5 Shell + navigation** → Tasks 5 (nav config), 6 (sheet primitive), 7 (sidebar), 8 (top bar), 9 (More sheet), 10 (tab bar), 11 (AppShell + layout swap). Covered.
- **Token migration off `neutral-*`** → the new shell components use `bg-background`/`bg-sidebar`/`bg-muted`/`border-border`/`text-muted-foreground` throughout; the old hardcoded layout is fully replaced in Task 11.
- **Logo scroll-to-top-on-home** → preserved in both Sidebar (Task 7) and TopBar (Task 8).
- **Deferred to later plans (out of this plan's scope, by design):** command palette / global search (the `⌘K` search affordance is intentionally omitted from the TopBar until that unit so there is no dead control), the command-centre dashboard rebuild, screen re-skins, the crew set-mode redesign, and the PWA. These are Units 3-7 in `docs/superpowers/specs/2026-06-15-unitdeck-foundation-overhaul-design.md` and get their own plans.

**Placeholder scan:** none — every step contains the literal code or command. **Type consistency:** `NavItem`, `isActive`, `PRIMARY_TABS`, `MORE_ITEMS`, `statusBadgeClass`, `ThemeToggle`, `Sheet/SheetTrigger/SheetClose/SheetContent`, `MoreSheet`, `AppShell` are defined once and referenced with matching names/signatures across tasks.

## Remaining units (subsequent plans, after this ships)

Each becomes its own dated plan in `docs/superpowers/plans/`, written against the concrete API this foundation produces:
3. **Command-centre dashboard** — rebuild `dashboard/page.tsx`; add an `upcomingShootDays` query + test to `convex/dashboard.ts`.
4. **Re-skin existing screens** — projects, project detail, shoot-days, people, clients, locations, call-sheet composer; introduce a responsive table→card helper.
5. **Crew set-mode page** — redesign `src/app/s/[token]/page.tsx`, offline-tolerant.
6. **Command palette + global search** — `⌘K` over org data; wire the TopBar search trigger added here.
7. **PWA** — manifest, icons, service worker caching the shell + the set-mode route.
