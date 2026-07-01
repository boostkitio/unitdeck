# Call sheet enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring UnitDeck's generated call sheet up to the level a working studio sends, matching the real Klaxon Studio reference (tiered call times, grouped contacts, camera/equipment/invoicing/emergency blocks, parking + transport, confidentiality banner, logo).

**Architecture:** Extend the `callSheetData` snapshot validator and `organisations.settings` with new optional fields. Reusable org-level defaults (logo, invoicing, confidentiality) are copied into each call sheet snapshot at `ensure` seed time so sent sheets stay immutable. Keep `crew[]` as the single sendable list (distribution untouched) and add generic `contactSections[]` for Agency / Client / Contributors. Everything renders conditionally so the public tool stays minimal.

**Tech Stack:** Next.js 16 (App Router), React 19, Convex, Clerk, Tailwind v4, shadcn/base-ui, vitest + convex-test, puppeteer-core PDF via `/print/call-sheet/[token]`.

## Global Constraints

- Every new schema/validator field is **optional**; existing `organisations`, `locations`, `callSheets` rows must stay valid with no backfill.
- **Immutability:** org-level defaults are copied into the call sheet `data` snapshot at seed time (mirroring `productionCompany: org.name`); editing org settings never mutates an existing sheet.
- **Tenancy:** every query/mutation derives the org from the Clerk token via `requireOrg` / `requireIdentity` (see `convex/lib/auth.ts`), never from client args.
- `crew[]` stays the only sendable list; the send dialog reads `data.crew`. Do not touch distribution.
- The public no-login tool keeps its current field set; new blocks render only when populated.
- `CallSheetDocument` is the single source of truth for both the composer preview and the Chromium PDF: keep colours print-safe, avoid viewport-relative units.
- Copy rules for all user-facing text and commit messages: first person singular, UK English, no em dashes (en dashes allowed), sentence case (no all-caps headers). No "Claude"/"Anthropic"/AI references anywhere. Commits carry **no** `Co-Authored-By` trailer and no "Generated with" footer.
- Test runner: `edge-runtime` environment, includes `convex/**/*.test.ts` and `src/**/*.test.ts`. No jsdom / React Testing Library is installed, so presentational components are verified by `npm run build` + manual visual QA; pure functions are unit-tested.
- After each task: commit. Push at the end of the feature (Matt's workspace rule: commit and push before declaring done; branch is `main`).
- **Live domain:** everything must work on the production site `https://unitdeck.app`. `src/lib/brand.ts` already exports `SITE_URL = "https://unitdeck.app"`; PDF routes render via `req.nextUrl.origin` (resolves to the live host); the logo resolves to an absolute Convex storage URL (fetchable by both the app and headless Chromium). Do not introduce localhost or app-relative absolute URLs. Production dependency to verify before "done": `SITE_URL` must be set in the Convex **production** deployment env (it powers crew set-mode email links); the local test env not having it causes the known pre-existing `setMode`/`messageDrafter` failures.

---

### Task 1: Extend validators and schema (types foundation)

Adds all new optional fields. Leaves the repo compiling and every existing test green. Does not rename existing validators (keeps builds green between tasks); the legacy flat `contacts[]`/`ContactRow` stay as-is and are migrated in Task 2.

**Files:**
- Modify: `convex/lib/callSheetData.ts`
- Modify: `convex/schema.ts`
- Test: `convex/callSheets.test.ts` (add one round-trip test)

**Interfaces:**
- Produces (consumed by every later task):
  - `sectionRowValidator` / type `SectionRow` = `{ id: string; personId?: Id<"people">; name: string; role: string; callTime?: string; phone?: string; email?: string; reportsTo?: string; notes?: string }`
  - `contactSectionValidator` / type `ContactSection` = `{ id: string; title: string; rows: SectionRow[] }`
  - `callTimeValidator` / type `CallTimeEntry` = `{ id: string; label: string; time: string }`
  - `equipmentRowValidator` / type `EquipmentRow` = `{ id: string; supplier?: string; item: string }`
  - `cameraInfoValidator` / type `CameraInfo` = `{ recordingFormat?: string; frameRate?: string; aspectRatios?: string; namingConvention?: string; otherNotes?: string }`
  - `crewRowValidator` gains `reportsTo?: string`
  - `locationEntryValidator` gains `satNav?: string`, `publicTransport?: string`, `nearestPoliceStation?: string`
  - `callSheetDataValidator` gains `callTimes?`, `crewSectionTitle?`, `contactSections?`, `camera?`, `equipment?`, `branding?`, `invoicing?`, `confidential?`
  - `organisations.settings` gains `logoStorageId?`, `invoicing?`, `confidentialByDefault?`
  - `locations` table gains `satNav?`, `publicTransport?`, `nearestPoliceStation?`

- [ ] **Step 1: Write the failing test**

Add to `convex/callSheets.test.ts`:

```ts
test("enriched call sheet data and org settings round-trip through the schema", async () => {
  const t = convexTest(schema, modules);
  const read = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organisations", {
      name: "Org A",
      clerkOrgId: "org_a",
      settings: {
        brandColor: "#ff0000",
        invoicing: {
          legalName: "Klaxon Studio Ltd",
          companyNumber: "15712401",
          vatNumber: "GB470025721",
          invoiceEmail: "invoices@klaxon.studio",
          receiptsNote: "Keep and submit all receipts",
        },
        confidentialByDefault: true,
      },
    });
    const projectId = await ctx.db.insert("projects", {
      orgId,
      name: "P",
      status: "brief",
    });
    const dayId = await ctx.db.insert("shootDays", {
      orgId,
      projectId,
      date: "2026-06-09",
      locationIds: [],
    });
    const csId = await ctx.db.insert("callSheets", {
      orgId,
      shootDayId: dayId,
      projectId,
      version: 1,
      status: "draft",
      data: {
        title: "T",
        date: "2026-06-09",
        generalCallTime: "07:45",
        productionCompany: "Klaxon",
        locations: [
          {
            id: "l1",
            name: "Loft",
            address: "3 Tanner St",
            satNav: "SE1 3JT",
            publicTransport: "London Bridge 10 min walk",
            nearestPoliceStation: "Southwark Police Station",
          },
        ],
        schedule: [],
        crew: [],
        contacts: [],
        callTimes: [{ id: "ct1", label: "Crew call", time: "07:45" }],
        crewSectionTitle: "Crew",
        contactSections: [
          {
            id: "s1",
            title: "Agency",
            rows: [
              { id: "r1", name: "Adam", role: "Senior Producer", email: "a@omc.com", reportsTo: "" },
            ],
          },
        ],
        camera: {
          recordingFormat: "3840x2160 S-Log3",
          frameRate: "25",
          aspectRatios: "16:9, 1:1, 9:16",
          namingConvention: "26MMDD_prodtitle_camA_001_",
          otherNotes: "2x camera, lapel + boom",
        },
        equipment: [{ id: "e1", supplier: "Klaxon Studio", item: "Sony FX9" }],
        branding: { logoUrl: "https://example/logo.png", brandColor: "#ff0000" },
        invoicing: { legalName: "Klaxon Studio Ltd", invoiceEmail: "invoices@klaxon.studio" },
        confidential: true,
      },
    });
    return await ctx.db.get(csId);
  });
  expect(read?.data.contactSections?.[0].title).toBe("Agency");
  expect(read?.data.camera?.aspectRatios).toBe("16:9, 1:1, 9:16");
  expect(read?.data.locations[0].satNav).toBe("SE1 3JT");
  expect(read?.data.equipment?.[0].item).toBe("Sony FX9");
  expect(read?.data.confidential).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/callSheets.test.ts -t "round-trip through the schema"`
Expected: FAIL (schema/validator rejects unknown fields such as `contactSections`, `camera`, `invoicing`).

- [ ] **Step 3: Extend `convex/lib/callSheetData.ts`**

Add the new validators and extend the existing ones. Keep the existing `contactRowValidator` / `ContactRow` untouched.

```ts
export const sectionRowValidator = v.object({
  id: v.string(),
  personId: v.optional(v.id("people")),
  name: v.string(),
  role: v.string(),
  callTime: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  reportsTo: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const contactSectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  rows: v.array(sectionRowValidator),
});

export const callTimeValidator = v.object({
  id: v.string(),
  label: v.string(),
  time: v.string(),
});

export const equipmentRowValidator = v.object({
  id: v.string(),
  supplier: v.optional(v.string()),
  item: v.string(),
});

export const cameraInfoValidator = v.object({
  recordingFormat: v.optional(v.string()),
  frameRate: v.optional(v.string()),
  aspectRatios: v.optional(v.string()),
  namingConvention: v.optional(v.string()),
  otherNotes: v.optional(v.string()),
});

export const invoicingValidator = v.object({
  legalName: v.optional(v.string()),
  companyNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  invoiceEmail: v.optional(v.string()),
  receiptsNote: v.optional(v.string()),
});
```

Add `reportsTo: v.optional(v.string())` to `crewRowValidator`.

Add to `locationEntryValidator`:

```ts
  satNav: v.optional(v.string()),
  publicTransport: v.optional(v.string()),
  nearestPoliceStation: v.optional(v.string()),
```

Add to `callSheetDataValidator` (after the existing fields, before the closing brace):

```ts
  callTimes: v.optional(v.array(callTimeValidator)),
  crewSectionTitle: v.optional(v.string()),
  contactSections: v.optional(v.array(contactSectionValidator)),
  camera: v.optional(cameraInfoValidator),
  equipment: v.optional(v.array(equipmentRowValidator)),
  branding: v.optional(
    v.object({ logoUrl: v.optional(v.string()), brandColor: v.optional(v.string()) })
  ),
  invoicing: v.optional(invoicingValidator),
  confidential: v.optional(v.boolean()),
```

Add the exported types at the bottom:

```ts
export type SectionRow = Infer<typeof sectionRowValidator>;
export type ContactSection = Infer<typeof contactSectionValidator>;
export type CallTimeEntry = Infer<typeof callTimeValidator>;
export type EquipmentRow = Infer<typeof equipmentRowValidator>;
export type CameraInfo = Infer<typeof cameraInfoValidator>;
```

- [ ] **Step 4: Extend `convex/schema.ts`**

Import the shared invoicing validator at the top so the table and `updateSettings` (Task 4) can never drift:

```ts
import { invoicingValidator } from "./lib/callSheetData";
```

Replace the `organisations.settings` object with:

```ts
    settings: v.optional(
      v.object({
        brandColor: v.optional(v.string()),
        logoStorageId: v.optional(v.id("_storage")),
        invoicing: v.optional(invoicingValidator),
        confidentialByDefault: v.optional(v.boolean()),
      })
    ),
```

Add to the `locations` table definition (before `.index(...)`):

```ts
    satNav: v.optional(v.string()),
    publicTransport: v.optional(v.string()),
    nearestPoliceStation: v.optional(v.string()),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/callSheets.test.ts`
Expected: PASS (all existing tests plus the new round-trip test).

- [ ] **Step 6: Typecheck the whole project**

Run: `npm run build`
Expected: build succeeds (validators compile, no importer broke).

- [ ] **Step 7: Commit**

```bash
git add convex/lib/callSheetData.ts convex/schema.ts convex/callSheets.test.ts
git commit -m "Extend call sheet and org validators for enrichment"
```

---

### Task 2: Legacy contacts migration helper (pure function)

The old flat `contacts[]` becomes a `contactSections` entry titled "Key contacts" the first time a draft is touched. A pure, idempotent function drives it, reused by `ensure` (Task 3) and the composer (Task 8).

**Files:**
- Modify: `convex/lib/callSheetData.ts`
- Test: `convex/callSheetData.test.ts` (new)

**Interfaces:**
- Consumes: `CallSheetData`, `ContactSection`, `SectionRow` from Task 1.
- Produces: `migrateLegacyContacts(data: CallSheetData): CallSheetData` — if `data.contacts` is non-empty, appends a `{ title: "Key contacts" }` section built from those rows and returns data with `contacts: []`; otherwise returns data unchanged. Idempotent.

- [ ] **Step 1: Write the failing test**

Create `convex/callSheetData.test.ts`:

```ts
/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { migrateLegacyContacts } from "./lib/callSheetData";
import type { CallSheetData } from "./lib/callSheetData";

function base(): CallSheetData {
  return {
    title: "T",
    date: "2026-06-09",
    generalCallTime: "08:00",
    productionCompany: "Klaxon",
    locations: [],
    schedule: [],
    crew: [],
    contacts: [],
  };
}

test("moves legacy contacts into a Key contacts section and clears the flat list", () => {
  const data = {
    ...base(),
    contacts: [{ id: "c1", name: "Jo", role: "Producer", phone: "0700" }],
  };
  const out = migrateLegacyContacts(data);
  expect(out.contacts).toEqual([]);
  expect(out.contactSections?.at(-1)?.title).toBe("Key contacts");
  expect(out.contactSections?.at(-1)?.rows[0]).toMatchObject({
    name: "Jo",
    role: "Producer",
    phone: "0700",
  });
});

test("is a no-op when there are no legacy contacts", () => {
  const data = base();
  const out = migrateLegacyContacts(data);
  expect(out).toEqual(data);
});

test("is idempotent (running twice does not duplicate the section)", () => {
  const data = {
    ...base(),
    contacts: [{ id: "c1", name: "Jo", role: "Producer", phone: "0700" }],
  };
  const once = migrateLegacyContacts(data);
  const twice = migrateLegacyContacts(once);
  expect(twice.contactSections).toHaveLength(1);
  expect(twice.contacts).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/callSheetData.test.ts`
Expected: FAIL with "migrateLegacyContacts is not a function" / not exported.

- [ ] **Step 3: Implement the helper in `convex/lib/callSheetData.ts`**

Add at the bottom (after the type exports):

```ts
/**
 * One-way, idempotent migration: fold the deprecated flat `contacts[]` into a
 * "Key contacts" section so every group lives in `contactSections[]`. Safe to
 * call on already-migrated data (no-op when `contacts` is empty).
 */
export function migrateLegacyContacts(data: CallSheetData): CallSheetData {
  if (!data.contacts || data.contacts.length === 0) return data;
  const rows: SectionRow[] = data.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    phone: c.phone || undefined,
  }));
  const section: ContactSection = {
    id: `sec-legacy-${data.contacts[0].id}`,
    title: "Key contacts",
    rows,
  };
  return {
    ...data,
    contacts: [],
    contactSections: [...(data.contactSections ?? []), section],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/callSheetData.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/callSheetData.ts convex/callSheetData.test.ts
git commit -m "Add legacy contacts migration helper for call sheets"
```

---

### Task 3: Seed org defaults, call times and location fields in `ensure`

New drafts copy the org's reusable defaults into the snapshot, seed a single "Crew call" from the general call time, and carry the three new location fields onto each location entry.

**Files:**
- Modify: `convex/callSheets.ts` (`ensure`, lines ~41-64)
- Test: `convex/callSheets.test.ts`

**Interfaces:**
- Consumes: `org.settings.{invoicing, confidentialByDefault, logoStorageId, brandColor}`; `ctx.storage.getUrl`.
- Produces: seeded `data.branding`, `data.invoicing`, `data.confidential`, `data.callTimes`, and location-entry `satNav`/`publicTransport`/`nearestPoliceStation`.

- [ ] **Step 1: Write the failing test**

Add to `convex/callSheets.test.ts`. Extend `setup()` to give Org A settings and a richer location, or add a self-contained test:

```ts
test("ensure copies org defaults, seeds call times, and carries location fields", async () => {
  const t = convexTest(schema, modules);
  const { dayId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organisations", {
      name: "Klaxon",
      clerkOrgId: "org_a",
      settings: {
        brandColor: "#111111",
        invoicing: { legalName: "Klaxon Studio Ltd", invoiceEmail: "invoices@klaxon.studio" },
        confidentialByDefault: true,
      },
    });
    const locId = await ctx.db.insert("locations", {
      orgId,
      name: "Bermondsey Loft",
      address: "3 Tanner St, London SE1 3LE",
      satNav: "SE1 3JT",
      publicTransport: "London Bridge 10 min walk",
      nearestPoliceStation: "Southwark Police Station",
    });
    const projectId = await ctx.db.insert("projects", { orgId, name: "Barclays", status: "pre_production" });
    const dayId = await ctx.db.insert("shootDays", {
      orgId,
      projectId,
      date: "2026-06-09",
      locationIds: [locId],
    });
    return { dayId };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: dayId });
  const draft = await asA.query(api.callSheets.getCurrent, { shootDayId: dayId });
  expect(draft?.data.invoicing?.legalName).toBe("Klaxon Studio Ltd");
  expect(draft?.data.confidential).toBe(true);
  expect(draft?.data.branding?.brandColor).toBe("#111111");
  expect(draft?.data.callTimes?.[0]).toMatchObject({ label: "Crew call", time: "08:00" });
  expect(draft?.data.locations[0].satNav).toBe("SE1 3JT");
  expect(draft?.data.locations[0].nearestPoliceStation).toBe("Southwark Police Station");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/callSheets.test.ts -t "copies org defaults"`
Expected: FAIL (`invoicing`/`confidential`/`callTimes` undefined on the seeded draft).

- [ ] **Step 3: Update `ensure` in `convex/callSheets.ts`**

Inside the `ensure` handler, after `const client = ...` and the `locations` fetch, resolve the logo URL and build the enriched data. Replace the location mapping and add the new fields:

```ts
    const logoUrl = org.settings?.logoStorageId
      ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
      : undefined;

    const data: CallSheetData = {
      title: project.name,
      date: day.date,
      generalCallTime: "08:00",
      productionCompany: org.name,
      clientName: client?.name,
      locations: locations.map((l, i) => ({
        id: `loc-${i + 1}`,
        locationId: l._id,
        name: l.name,
        address: l.address,
        w3w: l.w3w,
        parkingNotes: l.parkingNotes,
        nearestHospital: l.nearestHospital,
        satNav: l.satNav,
        publicTransport: l.publicTransport,
        nearestPoliceStation: l.nearestPoliceStation,
      })),
      schedule: [],
      crew: [],
      contacts: [],
      crewSectionTitle: "Crew",
      contactSections: [],
      callTimes: [{ id: "ct-crew", label: "Crew call", time: "08:00" }],
      branding:
        org.settings?.brandColor || logoUrl
          ? { brandColor: org.settings?.brandColor, logoUrl }
          : undefined,
      invoicing: org.settings?.invoicing,
      confidential: org.settings?.confidentialByDefault,
      weatherSummary: day.weather
        ? `${day.weather.summary}, ${Math.round(day.weather.tempMinC)}–${Math.round(day.weather.tempMaxC)}°C`
        : undefined,
      sunrise: day.sun?.sunrise,
      sunset: day.sun?.sunset,
    };
```

Note: the en dash in `weatherSummary` is pre-existing and intentional (numeric range); leave it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/callSheets.test.ts`
Expected: PASS (all tests, including the existing "ensure creates version 1 draft with defaults").

- [ ] **Step 5: Commit**

```bash
git add convex/callSheets.ts convex/callSheets.test.ts
git commit -m "Seed org defaults, call times and location fields into new call sheets"
```

---

### Task 4: Org settings backend

Mutations and queries for the settings page and the composer's "refresh from org defaults" action. All org-scoped.

**Files:**
- Modify: `convex/organisations.ts`
- Test: `convex/organisations.test.ts`

**Interfaces:**
- Produces:
  - `updateSettings(args: { brandColor?, invoicing?, confidentialByDefault? })` — patches `org.settings`, merging with existing.
  - `generateLogoUploadUrl(): string` — org-scoped upload URL.
  - `setLogo(args: { storageId: Id<"_storage"> })` — stores `settings.logoStorageId`.
  - `settingsView(): { name, brandColor?, invoicing?, confidentialByDefault?, logoUrl? }` — current org settings with the logo resolved to a URL.
  - `callSheetDefaults(): { branding?, invoicing?, confidential? }` — the exact shape the composer merges into a draft on "refresh from org defaults".

- [ ] **Step 1: Write the failing test**

Add to `convex/organisations.test.ts` (create it if absent, following `callSheets.test.ts` style):

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("updateSettings persists and settingsView reads it back", async () => {
  const { asA } = await setup();
  await asA.mutation(api.organisations.updateSettings, {
    brandColor: "#123456",
    invoicing: { legalName: "Klaxon Studio Ltd", invoiceEmail: "invoices@klaxon.studio" },
    confidentialByDefault: true,
  });
  const view = await asA.query(api.organisations.settingsView, {});
  expect(view?.brandColor).toBe("#123456");
  expect(view?.invoicing?.legalName).toBe("Klaxon Studio Ltd");
  expect(view?.confidentialByDefault).toBe(true);
});

test("callSheetDefaults returns the mergeable defaults", async () => {
  const { asA } = await setup();
  await asA.mutation(api.organisations.updateSettings, {
    confidentialByDefault: true,
    invoicing: { invoiceEmail: "invoices@klaxon.studio" },
  });
  const defaults = await asA.query(api.organisations.callSheetDefaults, {});
  expect(defaults.confidential).toBe(true);
  expect(defaults.invoicing?.invoiceEmail).toBe("invoices@klaxon.studio");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/organisations.test.ts`
Expected: FAIL ("updateSettings is not a function" on the api).

- [ ] **Step 3: Implement in `convex/organisations.ts`**

Add imports and mutations/queries (keep the existing `ensure`/`current`):

```ts
import { requireOrg } from "./lib/auth";
import { invoicingValidator } from "./lib/callSheetData";

export const updateSettings = mutation({
  args: {
    brandColor: v.optional(v.string()),
    invoicing: v.optional(invoicingValidator),
    confidentialByDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    await ctx.db.patch(org._id, { settings: { ...org.settings, ...args } });
    return null;
  },
});

export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    await ctx.db.patch(org._id, {
      settings: { ...org.settings, logoStorageId: args.storageId },
    });
    return null;
  },
});

export const settingsView = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const logoUrl = org.settings?.logoStorageId
      ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
      : undefined;
    return {
      name: org.name,
      brandColor: org.settings?.brandColor,
      invoicing: org.settings?.invoicing,
      confidentialByDefault: org.settings?.confidentialByDefault,
      logoUrl,
    };
  },
});

export const callSheetDefaults = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const logoUrl = org.settings?.logoStorageId
      ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
      : undefined;
    const branding =
      org.settings?.brandColor || logoUrl
        ? { brandColor: org.settings?.brandColor, logoUrl }
        : undefined;
    return {
      branding,
      invoicing: org.settings?.invoicing,
      confidential: org.settings?.confidentialByDefault,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/organisations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/organisations.ts convex/organisations.test.ts
git commit -m "Add org settings mutations and call sheet default queries"
```

---

### Task 5: Location fields (mutations + editor UI)

Persist and edit sat-nav, public transport and nearest police station on locations, so they reseed onto future shoots.

**Files:**
- Modify: `convex/locations.ts` (`locationFields` ~8-16, `update` args ~55-66)
- Modify: `src/app/(app)/locations/page.tsx`
- Test: `convex/locations.test.ts`

**Interfaces:**
- Consumes: schema fields from Task 1.
- Produces: `create`/`update` accept `satNav?`, `publicTransport?`, `nearestPoliceStation?`.

- [ ] **Step 1: Write the failing test**

Add to `convex/locations.test.ts`:

```ts
test("create and update persist the new logistics fields", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.locations.create, {
    name: "Bermondsey Loft",
    address: "3 Tanner St, London SE1 3LE",
    satNav: "SE1 3JT",
    publicTransport: "London Bridge 10 min walk",
    nearestPoliceStation: "Southwark Police Station",
  });
  const created = await asA.query(api.locations.get, { id });
  expect(created?.satNav).toBe("SE1 3JT");
  await asA.mutation(api.locations.update, { id, publicTransport: "Bermondsey tube 20 min" });
  const updated = await asA.query(api.locations.get, { id });
  expect(updated?.publicTransport).toBe("Bermondsey tube 20 min");
  expect(updated?.nearestPoliceStation).toBe("Southwark Police Station");
});
```

(If `convex/locations.test.ts` has no `setup()` helper, copy the one from `callSheets.test.ts`, inserting an `organisations` row with `clerkOrgId: "org_a"` and returning `asA`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/locations.test.ts -t "logistics fields"`
Expected: FAIL (mutation rejects unknown args `satNav` etc.).

- [ ] **Step 3: Update `convex/locations.ts`**

Add to `locationFields`:

```ts
  satNav: v.optional(v.string()),
  publicTransport: v.optional(v.string()),
  nearestPoliceStation: v.optional(v.string()),
```

Add the same three optional args to the `update` mutation's `args` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/locations.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the three inputs to the location dialog**

In `src/app/(app)/locations/page.tsx`, inside `LocationDialog`: add state next to the existing `useState` lines:

```tsx
  const [satNav, setSatNav] = useState(location?.satNav ?? "");
  const [publicTransport, setPublicTransport] = useState(location?.publicTransport ?? "");
  const [nearestPoliceStation, setNearestPoliceStation] = useState(
    location?.nearestPoliceStation ?? ""
  );
```

Add them to the `fields` object in `save()`:

```tsx
        satNav: satNav || undefined,
        publicTransport: publicTransport || undefined,
        nearestPoliceStation: nearestPoliceStation || undefined,
```

Add inputs after the "Access notes" block (mirror its markup):

```tsx
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="loc-satnav">Sat nav postcode</Label>
              <Input id="loc-satnav" value={satNav} onChange={(e) => setSatNav(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-police">Nearest police station</Label>
              <Input
                id="loc-police"
                value={nearestPoliceStation}
                onChange={(e) => setNearestPoliceStation(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-transport">Public transport</Label>
            <Input
              id="loc-transport"
              value={publicTransport}
              onChange={(e) => setPublicTransport(e.target.value)}
            />
          </div>
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA: open Locations, add/edit a location, confirm the three fields save and reload.

- [ ] **Step 7: Commit**

```bash
git add convex/locations.ts convex/locations.test.ts "src/app/(app)/locations/page.tsx"
git commit -m "Add sat nav, transport and police station to locations"
```

---

### Task 6: Document format helpers (pure functions)

Extract the non-trivial render logic (equipment grouping, call-time strip fallback) into pure, tested helpers so the JSX stays a thin map.

**Files:**
- Create: `src/components/call-sheet/format.ts`
- Test: `src/components/call-sheet/format.test.ts`

**Interfaces:**
- Consumes: `EquipmentRow`, `CallTimeEntry`, `CallSheetData` from Task 1.
- Produces:
  - `groupEquipmentBySupplier(rows: EquipmentRow[]): { supplier: string | null; items: EquipmentRow[] }[]` — preserves first-seen supplier order; `null` supplier grouped last under an "Other" bucket at render.
  - `callStrip(data: Pick<CallSheetData, "callTimes" | "generalCallTime">): CallTimeEntry[]` — returns `callTimes` when non-empty, else a single `{ id: "general", label: "General call", time: generalCallTime }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/call-sheet/format.test.ts`:

```ts
/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { groupEquipmentBySupplier, callStrip } from "./format";

test("groups equipment by supplier in first-seen order", () => {
  const groups = groupEquipmentBySupplier([
    { id: "1", supplier: "Klaxon", item: "FX9" },
    { id: "2", supplier: "Michael", item: "Boom" },
    { id: "3", supplier: "Klaxon", item: "Slider" },
    { id: "4", item: "Sandbags" },
  ]);
  expect(groups.map((g) => g.supplier)).toEqual(["Klaxon", "Michael", null]);
  expect(groups[0].items.map((i) => i.item)).toEqual(["FX9", "Slider"]);
  expect(groups[2].items[0].item).toBe("Sandbags");
});

test("callStrip falls back to the general call time when no tiered times", () => {
  expect(callStrip({ callTimes: undefined, generalCallTime: "08:00" })).toEqual([
    { id: "general", label: "General call", time: "08:00" },
  ]);
  const tiered = [{ id: "c", label: "Crew call", time: "07:45" }];
  expect(callStrip({ callTimes: tiered, generalCallTime: "08:00" })).toBe(tiered);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/call-sheet/format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/call-sheet/format.ts`**

```ts
import type { CallSheetData, CallTimeEntry, EquipmentRow } from "../../../convex/lib/callSheetData";

export function groupEquipmentBySupplier(
  rows: EquipmentRow[]
): { supplier: string | null; items: EquipmentRow[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, EquipmentRow[]>();
  for (const row of rows) {
    const key = row.supplier && row.supplier.trim() !== "" ? row.supplier : null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(row);
  }
  // Ungrouped items always render last.
  order.sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
  return order.map((supplier) => ({ supplier, items: map.get(supplier)! }));
}

export function callStrip(
  data: Pick<CallSheetData, "callTimes" | "generalCallTime">
): CallTimeEntry[] {
  if (data.callTimes && data.callTimes.length > 0) return data.callTimes;
  return [{ id: "general", label: "General call", time: data.generalCallTime }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/call-sheet/format.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/call-sheet/format.ts src/components/call-sheet/format.test.ts
git commit -m "Add pure call sheet formatting helpers"
```

---

### Task 7: Render the new blocks in `CallSheetDocument`

Add every enrichment block, each rendered only when populated so minimal tool data omits them.

**Files:**
- Modify: `src/components/call-sheet/call-sheet-document.tsx`

**Interfaces:**
- Consumes: `groupEquipmentBySupplier`, `callStrip` (Task 6); the enriched `CallSheetData` (Task 1).

- [ ] **Step 1: Add the imports**

At the top of `call-sheet-document.tsx`:

```tsx
import { groupEquipmentBySupplier, callStrip } from "./format";
```

- [ ] **Step 2: Confidentiality banner**

As the first child inside the root `<div>`, before `<header>`:

```tsx
      {data.confidential && (
        <p className="mb-3 text-center text-[8pt] font-bold uppercase tracking-wide text-red-600">
          Confidential document. Do not misplace. Dispose of securely.
        </p>
      )}
```

- [ ] **Step 3: Logo in the header**

In the header's left `<div>`, above the production-company line, render the logo when present:

```tsx
            {data.branding?.logoUrl && (
              <img
                src={data.branding.logoUrl}
                alt=""
                className="mb-2 h-10 w-auto object-contain"
              />
            )}
```

- [ ] **Step 4: Replace the single general-call line with the tiered strip**

Replace the `<p>` in the header that shows `General call` with:

```tsx
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-right">
            {callStrip(data).map((ct) => (
              <span key={ct.id}>
                <span className="font-semibold">{ct.label}: </span>
                {ct.time}
              </span>
            ))}
          </div>
```

- [ ] **Step 5: Extend the locations block**

In the locations `.map`, after the existing parking/hospital line, add sat-nav, transport and the emergency line:

```tsx
                  {(loc.satNav || loc.publicTransport) && (
                    <p className="text-[8.5pt] text-neutral-600">
                      {loc.satNav && <span className="mr-3">Sat nav: {loc.satNav}</span>}
                      {loc.publicTransport && <span>Transport: {loc.publicTransport}</span>}
                    </p>
                  )}
                  {(loc.nearestHospital || loc.nearestPoliceStation) && (
                    <p className="text-[8.5pt] text-neutral-600">
                      In an emergency call 999.
                      {loc.nearestHospital && <span className="ml-2">Nearest A&amp;E: {loc.nearestHospital}.</span>}
                      {loc.nearestPoliceStation && (
                        <span className="ml-2">Nearest police: {loc.nearestPoliceStation}.</span>
                      )}
                    </p>
                  )}
```

(The existing `nearestHospital` line inside the current parking `<p>` can stay; this adds the police + 999 emergency framing.)

- [ ] **Step 6: Grouped contact sections after the crew table**

Change the crew section heading to use the configurable title, then render each contact section. Replace the crew `<h2>` text `Crew` with `{data.crewSectionTitle ?? "Crew"}`. After the crew `</section>`, add:

```tsx
      {(data.contactSections ?? []).map((section) => (
        <section key={section.id} className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {section.title}
          </h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
                <th className="py-1 pr-2 font-semibold">Role</th>
                <th className="py-1 pr-2 font-semibold">Name</th>
                <th className="py-1 pr-2 font-semibold">Reports to</th>
                <th className="py-1 pr-2 font-semibold">Phone</th>
                <th className="py-1 pr-2 font-semibold">Email</th>
                <th className="py-1 font-semibold">Call</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-2">{r.role}</td>
                  <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                  <td className="py-1.5 pr-2 text-neutral-600">{r.reportsTo ?? ""}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.phone ?? ""}</td>
                  <td className="py-1.5 pr-2">{r.email ?? ""}</td>
                  <td className="py-1.5 font-semibold">{r.callTime ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
```

- [ ] **Step 7: Camera/tech block**

Before the Notes section, add:

```tsx
      {data.camera &&
        (data.camera.recordingFormat ||
          data.camera.frameRate ||
          data.camera.aspectRatios ||
          data.camera.namingConvention ||
          data.camera.otherNotes) && (
          <section className="mt-5">
            <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
              Camera
            </h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
              {data.camera.recordingFormat && (<><dt className="font-semibold">Recording format</dt><dd>{data.camera.recordingFormat}</dd></>)}
              {data.camera.frameRate && (<><dt className="font-semibold">Frame rate</dt><dd>{data.camera.frameRate}</dd></>)}
              {data.camera.aspectRatios && (<><dt className="font-semibold">Aspect ratios</dt><dd>{data.camera.aspectRatios}</dd></>)}
              {data.camera.namingConvention && (<><dt className="font-semibold">Naming convention</dt><dd>{data.camera.namingConvention}</dd></>)}
              {data.camera.otherNotes && (<><dt className="font-semibold">Other notes</dt><dd>{data.camera.otherNotes}</dd></>)}
            </dl>
          </section>
        )}
```

- [ ] **Step 8: Equipment grouped by supplier**

After the camera block:

```tsx
      {data.equipment && data.equipment.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Equipment
          </h2>
          <div className="mt-2 space-y-2 text-[9pt]">
            {groupEquipmentBySupplier(data.equipment).map((group) => (
              <div key={group.supplier ?? "other"}>
                <p className="font-semibold">{group.supplier ?? "Other"}</p>
                <ul className="ml-4 list-disc">
                  {group.items.map((it) => (
                    <li key={it.id}>{it.item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 9: Invoicing footer**

After the safety section (last block):

```tsx
      {data.invoicing &&
        (data.invoicing.legalName ||
          data.invoicing.companyNumber ||
          data.invoicing.vatNumber ||
          data.invoicing.invoiceEmail ||
          data.invoicing.receiptsNote) && (
          <section className="mt-5 border-t border-neutral-300 pt-2 text-[8pt] text-neutral-600">
            <p className="font-semibold uppercase tracking-widest">Invoicing</p>
            <p>
              {[data.invoicing.legalName,
                data.invoicing.companyNumber && `Company no. ${data.invoicing.companyNumber}`,
                data.invoicing.vatNumber && `VAT ${data.invoicing.vatNumber}`,
                data.invoicing.invoiceEmail && `Invoices to ${data.invoicing.invoiceEmail}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {data.invoicing.receiptsNote && <p>{data.invoicing.receiptsNote}</p>}
          </section>
        )}
```

- [ ] **Step 10: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA: on a call sheet with the seeded/enriched data, confirm every new block renders, and on the public tool (`/print/tool/[token]` via the tool page) confirm the new blocks are absent (minimal data omits them). Export the PDF and eyeball against the Klaxon reference.

- [ ] **Step 11: Commit**

```bash
git add src/components/call-sheet/call-sheet-document.tsx
git commit -m "Render enriched blocks on the call sheet document"
```

---

### Task 8: Composer editor sections

Editors for the per-sheet blocks, following the existing add-row / move / remove pattern. Also apply the legacy contacts migration to the initial state.

**Files:**
- Modify: `src/components/call-sheet/composer-form.tsx`

**Interfaces:**
- Consumes: `migrateLegacyContacts` (Task 2); `CallSheetData`, `SectionRow`, `ContactSection`, `CallTimeEntry`, `EquipmentRow`, `CameraInfo` (Task 1).

- [ ] **Step 1: Migrate legacy contacts on entry**

The composer receives `data`/`onChange` from the page. Add an effect at the top of `ComposerForm` that migrates once if needed:

```tsx
  useEffect(() => {
    if (data.contacts && data.contacts.length > 0) {
      onChange(migrateLegacyContacts(data));
    }
    // Run only when the incoming legacy list changes.
  }, [data.contacts?.length]);
```

Add imports: `import { useEffect } from "react";` and `migrateLegacyContacts`, plus the new types, from `callSheetData`.

- [ ] **Step 2: Tiered call times editor (fully worked; the template for the rest)**

Add this section (it establishes the exact add / edit / remove idiom the remaining editors mirror). `newId` and `set` already exist in the file:

```tsx
      {/* Call times */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Call times</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              set({
                callTimes: [
                  ...(data.callTimes ?? []),
                  { id: newId("ct"), label: "", time: data.generalCallTime },
                ],
              })
            }
          >
            Add call time
          </Button>
        </div>
        {(data.callTimes ?? []).map((ct) => (
          <div key={ct.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
            <Input
              placeholder="Label (e.g. Crew call)"
              value={ct.label}
              onChange={(e) =>
                set({
                  callTimes: (data.callTimes ?? []).map((x) =>
                    x.id === ct.id ? { ...x, label: e.target.value } : x
                  ),
                })
              }
            />
            <Input
              type="time"
              className="w-28"
              value={ct.time}
              onChange={(e) =>
                set({
                  callTimes: (data.callTimes ?? []).map((x) =>
                    x.id === ct.id ? { ...x, time: e.target.value } : x
                  ),
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              onClick={() =>
                set({ callTimes: (data.callTimes ?? []).filter((x) => x.id !== ct.id) })
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </section>
```

- [ ] **Step 2b: Confirm the pattern**

The remaining editors (steps 3-6) follow this exact idiom: an "Add" button that appends a new row with `newId(prefix)`, per-field `Input`s that `set({ field: (data.field ?? []).map(...) })`, and a Remove button that filters by id. Reuse it verbatim.

- [ ] **Step 3: Contact sections editor**

Add a section that edits `data.contactSections`. "Add section" appends `{ id: newId("sec"), title: "", rows: [] }`. Within each section: a title `Input`; an "Add row" button appending a `SectionRow` (`{ id: newId("row"), name: "", role: "" }`); and the same "Add from people" `Select` used by the crew section (prefill `name`, `role`, `phone`, `email`, `personId`). Each row edits name / role / reportsTo / phone / email / callTime and a Remove button. A Remove button on the section removes the whole section. Reuse the existing `move` helper for reordering if desired (optional).

- [ ] **Step 4: Camera/tech editor**

Add a section with five `Input`s bound to `data.camera` fields (`recordingFormat`, `frameRate`, `aspectRatios`, `namingConvention`, `otherNotes`), each writing via `set({ camera: { ...data.camera, [field]: value || undefined } })`.

- [ ] **Step 5: Equipment editor**

Add a section editing `data.equipment` rows. "Add item" appends `{ id: newId("eq"), item: "" }`. Each row: an `item` `Input` and an optional `supplier` `Input`, plus Remove.

- [ ] **Step 6: Confidentiality toggle**

Add a labelled checkbox bound to `data.confidential` writing `set({ confidential: e.target.checked })`. Use the existing `ui` checkbox if present, else a plain `<input type="checkbox">` styled minimally.

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA: rebuild the Klaxon reference sheet through the composer (Crew + Agency/Client/Contributors sections, four tiered call times, camera block, equipment, confidentiality on) and watch the live preview update. Confirm a call sheet that had legacy `contacts` shows them migrated into a "Key contacts" section and autosaves.

- [ ] **Step 8: Commit**

```bash
git add src/components/call-sheet/composer-form.tsx
git commit -m "Add composer editors for enriched call sheet blocks"
```

---

### Task 9: Settings page, nav item and refresh-from-defaults wiring

The org settings surface (net-new), a sidebar entry, and the composer's "refresh from org defaults" action.

**Files:**
- Create: `src/app/(app)/settings/page.tsx`
- Modify: `src/components/shell/nav-items.ts`
- Modify: `src/components/shell/nav-items.test.ts`
- Modify: `src/app/(app)/projects/[id]/shoot-days/[shootDayId]/call-sheet/page.tsx`

**Interfaces:**
- Consumes: `organisations.settingsView`, `updateSettings`, `generateLogoUploadUrl`, `setLogo`, `callSheetDefaults` (Task 4).

- [ ] **Step 1: Add the nav item and update its test**

In `nav-items.ts`, import `SettingsIcon` from `lucide-react` and append to `NAV_ITEMS`:

```ts
  { href: "/settings", label: "Settings", icon: SettingsIcon },
```

Open `nav-items.test.ts`, read what it asserts (likely the count/labels of `NAV_ITEMS` or `MORE_ITEMS`), and update the expectation to include "Settings". Run: `npx vitest run src/components/shell/nav-items.test.ts` and make it pass.

- [ ] **Step 2: Create the settings page**

Create `src/app/(app)/settings/page.tsx` as a `"use client"` page following the Locations page conventions (`useOrganization`, `useQuery`/`useMutation`, shadcn `Input`/`Label`/`Button`, `toast`). It:
- Loads `api.organisations.settingsView`.
- Edits brand colour, the five invoicing fields, and a confidentiality-default checkbox; saves via `updateSettings`.
- Logo upload: file input → `generateLogoUploadUrl` → `fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file })` → `setLogo({ storageId })` (read `storageId` from the upload response JSON, same pattern as `/api/call-sheets/pdf`), then show the returned `logoUrl` preview.
- Uses sentence-case headings and UK English throughout.

- [ ] **Step 3: Add "Refresh from org defaults" to the call sheet toolbar**

In the call sheet `page.tsx` `Composer` toolbar, add a query and button:

```tsx
  const orgDefaults = useQuery(api.organisations.callSheetDefaults, {});
```

Add a ghost button next to "Refresh weather":

```tsx
          <Button
            size="sm"
            variant="ghost"
            disabled={!orgDefaults}
            onClick={() => {
              if (!orgDefaults) return;
              onChange({
                ...data,
                branding: orgDefaults.branding ?? data.branding,
                invoicing: orgDefaults.invoicing ?? data.invoicing,
                confidential: orgDefaults.confidential ?? data.confidential,
              });
              toast.success("Refreshed from organisation defaults.");
            }}
          >
            Refresh branding
          </Button>
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA: open Settings, upload a logo, set invoicing + confidentiality default, save. Create a new call sheet and confirm the seeded snapshot carries them (logo in header, invoicing footer, confidentiality banner). On an existing draft, click "Refresh branding" and confirm the blocks update.

- [ ] **Step 5: Commit and push**

```bash
git add "src/app/(app)/settings/page.tsx" src/components/shell/nav-items.ts src/components/shell/nav-items.test.ts "src/app/(app)/projects/[id]/shoot-days/[shootDayId]/call-sheet/page.tsx"
git commit -m "Add org settings page, nav entry and refresh branding action"
git push
```

- [ ] **Step 6: Full test + build gate**

Run: `npm test`
Expected: all suites pass.
Run: `npm run build`
Expected: build succeeds. Confirm `git status` shows the branch up to date with `origin/main`.

---

### Task 10: Demo dataset (self-serve seed + CLI)

Seed a realistic dataset modelled on Charlie's own Klaxon/Barclays shoot so a new user (Charlie) can log into `unitdeck.app`, load it in one click, and analyse a fully enriched call sheet. Depends only on the Task 1 validators, but is built last so the seeded data renders through the finished document and composer.

**Files:**
- Create: `convex/demoData.ts`
- Create: `convex/demoData.test.ts`
- Modify: `src/app/(app)/dashboard/page.tsx` (empty-state "Load sample data" button)

**Interfaces:**
- Consumes: `requireOrg` (`convex/lib/auth.ts`), `CallSheetData` and the enriched validators (Task 1).
- Produces:
  - `seedDemoDataForOrg(ctx: MutationCtx, orgId: Id<"organisations">): Promise<{ seeded: boolean; projectId: Id<"projects"> }>` — idempotent (skips if a project named "Barclays Pension Advice" already exists in the org); patches org settings; inserts client, people, location, project, shoot day and a v1 enriched call sheet draft.
  - `seedDemo()` public mutation — `requireOrg` then calls the helper on the caller's org (the button path).
  - `seedDemoForOrg({ orgId })` internal mutation — the CLI path: `npx convex run demoData:seedDemoForOrg '{"orgId":"<id>"}'`.

- [ ] **Step 1: Write the failing test**

Create `convex/demoData.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("seedDemo populates an enriched dataset for the caller's org", async () => {
  const { t, asA } = await setup();
  const res = await asA.mutation(api.demoData.seedDemo, {});
  expect(res.seeded).toBe(true);
  const counts = await t.run(async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const people = await ctx.db.query("people").collect();
    const sheets = await ctx.db.query("callSheets").collect();
    const org = (await ctx.db.query("organisations").first())!;
    return { projects, peopleCount: people.length, sheet: sheets[0], org };
  });
  expect(counts.projects.some((p) => p.name === "Barclays Pension Advice")).toBe(true);
  expect(counts.peopleCount).toBeGreaterThanOrEqual(6);
  expect(counts.sheet.data.callTimes).toHaveLength(4);
  expect(counts.sheet.data.contactSections).toHaveLength(3);
  expect(counts.sheet.data.camera?.frameRate).toContain("25");
  expect(counts.sheet.data.confidential).toBe(true);
  expect(counts.org.settings?.invoicing?.legalName).toBe("Klaxon Studio Ltd");
});

test("seedDemo is idempotent", async () => {
  const { t, asA } = await setup();
  await asA.mutation(api.demoData.seedDemo, {});
  const second = await asA.mutation(api.demoData.seedDemo, {});
  expect(second.seeded).toBe(false);
  const projectCount = await t.run(async (ctx) =>
    (await ctx.db.query("projects").collect()).filter((p) => p.name === "Barclays Pension Advice").length
  );
  expect(projectCount).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/demoData.test.ts`
Expected: FAIL ("seedDemo is not a function" on the api).

- [ ] **Step 3: Implement `convex/demoData.ts`**

Create the file. Read `convex/_generated/ai/guidelines.md` first if unsure about Convex APIs. Use dummy contact details throughout (names/roles are Charlie's real crew so it's familiar, but phones use the Ofcom reserved `07700 900xxx` range and emails use `@example.com`, so nothing can reach a real inbox if the demo sheet is ever sent).

```ts
import { mutation, internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Id } from "./_generated/dataModel";
import { CallSheetData } from "./lib/callSheetData";

const DEMO_PROJECT = "Barclays Pension Advice";

export async function seedDemoDataForOrg(
  ctx: MutationCtx,
  orgId: Id<"organisations">
): Promise<{ seeded: boolean; projectId: Id<"projects"> }> {
  const existing = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const already = existing.find((p) => p.name === DEMO_PROJECT);
  if (already) return { seeded: false, projectId: already._id };

  const org = await ctx.db.get(orgId);
  await ctx.db.patch(orgId, {
    settings: {
      ...org?.settings,
      brandColor: "#11182F",
      confidentialByDefault: true,
      invoicing: {
        legalName: "Klaxon Studio Ltd",
        companyNumber: "15712401",
        vatNumber: "GB470025721",
        invoiceEmail: "invoices@klaxon.studio",
        receiptsNote: "Please keep and submit all receipts to Klaxon Studio.",
      },
    },
  });

  const clientId = await ctx.db.insert("clients", {
    orgId,
    name: "RAPP (Barclays)",
    notes: "Agency: RAPP. End client: Barclays.",
  });

  const crewPeople = [
    { name: "James England", role: "Producer", email: "producer@example.com", phone: "07700 900447" },
    { name: "Charlie Fox", role: "Director of Photography", email: "dp@example.com", phone: "07700 900988" },
    { name: "Matt Hill", role: "Camera Operator", email: "cam@example.com", phone: "07700 900076" },
    { name: "James Travis", role: "Camera Assistant", email: "ac@example.com", phone: "07700 900855" },
    { name: "Michael O'Donahue", role: "Sound Recordist", email: "sound@example.com", phone: "07700 900721" },
    { name: "Rozzie Roux", role: "Autocue Operator", email: "autocue@example.com", phone: "07700 900982" },
  ];
  const pid: Record<string, Id<"people">> = {};
  for (const p of crewPeople) pid[p.name] = await ctx.db.insert("people", { orgId, ...p });

  const locationId = await ctx.db.insert("locations", {
    orgId,
    name: "Bermondsey Loft",
    address: "3 Tanner St, London, SE1 3LE",
    parkingNotes: "Premier Inn Tower Bridge, 159 Tower Bridge Road, SE1 3LP",
    satNav: "SE1 3JT",
    publicTransport: "London Bridge 10 min walk; Bermondsey tube 20 min walk",
    nearestHospital: "St Thomas' A&E, Westminster Bridge Rd, SE1 7EH",
    nearestPoliceStation: "Southwark Police Station, 323 Borough High St, SE1 1JL",
  });

  const projectId = await ctx.db.insert("projects", {
    orgId,
    clientId,
    name: DEMO_PROJECT,
    status: "pre_production",
    briefSummary: "4x 15sec talking-head videos, versioned for 16:9, 1:1 and 9:16.",
  });

  const shootDayId = await ctx.db.insert("shootDays", {
    orgId,
    projectId,
    date: "2026-06-09",
    label: "Day 1: studio talking heads",
    locationIds: [locationId],
    sun: { sunrise: "04:44", sunset: "21:16" },
  });

  const data: CallSheetData = {
    title: DEMO_PROJECT,
    date: "2026-06-09",
    generalCallTime: "07:45",
    productionCompany: "Klaxon Studio",
    clientName: "RAPP (Barclays)",
    confidential: true,
    branding: { brandColor: "#11182F" },
    invoicing: {
      legalName: "Klaxon Studio Ltd",
      companyNumber: "15712401",
      vatNumber: "GB470025721",
      invoiceEmail: "invoices@klaxon.studio",
      receiptsNote: "Please keep and submit all receipts to Klaxon Studio.",
    },
    callTimes: [
      { id: "ct-crew", label: "Crew call", time: "07:45" },
      { id: "ct-agency", label: "Agency call", time: "08:00" },
      { id: "ct-client", label: "Client call", time: "08:45" },
      { id: "ct-talent", label: "Talent call", time: "09:45" },
    ],
    locations: [
      {
        id: "loc-1",
        locationId,
        name: "Bermondsey Loft",
        address: "3 Tanner St, London, SE1 3LE",
        parkingNotes: "Premier Inn Tower Bridge, 159 Tower Bridge Road, SE1 3LP",
        satNav: "SE1 3JT",
        publicTransport: "London Bridge 10 min walk; Bermondsey tube 20 min walk",
        nearestHospital: "St Thomas' A&E, Westminster Bridge Rd, SE1 7EH",
        nearestPoliceStation: "Southwark Police Station, 323 Borough High St, SE1 1JL",
      },
    ],
    schedule: [
      { id: "s1", start: "07:45", title: "Crew call and load in" },
      { id: "s2", start: "08:15", title: "Block through locations", notes: "Charlie, Adam, Francesco" },
      { id: "s3", start: "10:00", title: "Talent to set" },
      { id: "s4", start: "10:15", title: "RX: consolidation film #1" },
      { id: "s5", start: "11:30", title: "Reset, position #2 and wardrobe" },
      { id: "s6", start: "12:00", title: "RX: SIPP film #2" },
      { id: "s7", start: "13:15", title: "Lunch" },
      { id: "s8", start: "14:30", title: "RX: time is your advantage #3" },
      { id: "s9", start: "16:15", title: "RX: planning and advice #4" },
      { id: "s10", start: "17:00", title: "Talent, agency, client wrap" },
      { id: "s11", start: "18:00", title: "Hard out of location" },
    ],
    crew: [
      { id: "c1", personId: pid["James England"], name: "James England", role: "Producer", callTime: "07:45", email: "producer@example.com", phone: "07700 900447" },
      { id: "c2", personId: pid["Charlie Fox"], name: "Charlie Fox", role: "Director of Photography", callTime: "07:45", email: "dp@example.com", phone: "07700 900988" },
      { id: "c3", personId: pid["Matt Hill"], name: "Matt Hill", role: "Camera Operator", callTime: "07:45", email: "cam@example.com", phone: "07700 900076" },
      { id: "c4", personId: pid["James Travis"], name: "James Travis", role: "Camera Assistant", callTime: "07:45", email: "ac@example.com", phone: "07700 900855" },
      { id: "c5", personId: pid["Michael O'Donahue"], name: "Michael O'Donahue", role: "Sound Recordist", callTime: "08:30", email: "sound@example.com", phone: "07700 900721" },
      { id: "c6", personId: pid["Rozzie Roux"], name: "Rozzie Roux", role: "Autocue Operator", callTime: "08:30", email: "autocue@example.com", phone: "07700 900982" },
    ],
    crewSectionTitle: "Crew",
    contactSections: [
      {
        id: "sec-agency",
        title: "Agency",
        rows: [
          { id: "a1", name: "Adam Pretty", role: "Senior Producer", callTime: "08:00", email: "adam@example.com", phone: "07700 900963" },
          { id: "a2", name: "Neil Williamson", role: "RAPP", email: "neil@example.com", reportsTo: "Adam Pretty" },
          { id: "a3", name: "Francesco Perillo", role: "RAPP", email: "fran@example.com", reportsTo: "Adam Pretty" },
        ],
      },
      {
        id: "sec-client",
        title: "Client",
        rows: [
          { id: "cl1", name: "Pauline Howard", role: "Barclays", callTime: "08:45", email: "pauline@example.com" },
          { id: "cl2", name: "Joyce Chen", role: "Barclays", callTime: "08:45", email: "joyce@example.com" },
          { id: "cl3", name: "Adrian Richards", role: "Barclays", callTime: "08:45", email: "adrian@example.com" },
        ],
      },
      {
        id: "sec-contrib",
        title: "Contributors",
        rows: [{ id: "t1", name: "Claire Francis", role: "Talent", callTime: "09:45", email: "claire@example.com" }],
      },
    ],
    camera: {
      recordingFormat: "3840 x 2160, S-Gamut3.Cine / S-Log3",
      frameRate: "25fps / PAL",
      aspectRatios: "9:16 and 1:1",
      namingConvention: "26MMDD_prodtitle_camA_001_",
      otherNotes: "PTCs, 2x camera setup, lapel + boom, 4x client IEMs. Time-of-day timecode, record on-camera sound.",
    },
    equipment: [
      { id: "e1", supplier: "Klaxon Studio", item: "Sony FX9 (x2)" },
      { id: "e2", supplier: "Klaxon Studio", item: "Sony FX6 or FX3" },
      { id: "e3", supplier: "Klaxon Studio", item: "Sigma Cine Prime set: 14, 24, 25, 50, 85, 135mm" },
      { id: "e4", supplier: "Klaxon Studio", item: "Prosup 2.9m slider" },
      { id: "e5", supplier: "Klaxon Studio", item: "Aputure 600d + 150cm dome; 300d + 90cm dome" },
      { id: "e6", supplier: "Klaxon Studio", item: "Blackmagic ATEM Pro, Atomos + ProHD client monitors" },
      { id: "e7", supplier: "Michael O'Donahue", item: "Sound kit: lapel + booms, 4x IEMs, 2x TC boxes" },
    ],
    notes:
      "Extremely time-dependent shoot with a hard out of the location at 18:00. Bring reusable water bottles. Snacks on set; lunch via Deliveroo. Take extra care of the property, damages are chargeable.",
    safetyNotes:
      "All cables to be taped down. In an emergency call 999. Nearest A&E: St Thomas'. First aid kit on set. Report any accidents to the producer.",
    sunrise: "04:44",
    sunset: "21:16",
  };

  await ctx.db.insert("callSheets", {
    orgId,
    shootDayId,
    projectId,
    version: 1,
    status: "draft",
    data,
  });

  return { seeded: true, projectId };
}

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    return await seedDemoDataForOrg(ctx, org._id);
  },
});

export const seedDemoForOrg = internalMutation({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    return await seedDemoDataForOrg(ctx, args.orgId);
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/demoData.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the "Load sample data" button to the dashboard empty state**

In `src/app/(app)/dashboard/page.tsx`, add `useMutation`/`useState`/`toast` imports as needed, wire a `seedDemo` mutation, and render a "Load sample data" button in the "Active productions" empty-state branch (the `active.length === 0` block, currently a `<p>`). The button calls `seedDemo`, is disabled while running, and toasts on success; the reactive queries repopulate the dashboard automatically. Follow the existing `Button` usage in the file. Keep copy sentence case and UK English ("Load sample data", "Loading sample data…").

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: build succeeds. Manual QA: on a fresh org, click "Load sample data" on the dashboard; confirm the Barclays project, crew, location and enriched call sheet appear, open the call sheet and confirm every enriched block renders and the PDF exports. Confirm a second click does not duplicate (button can be hidden once projects exist).

- [ ] **Step 7: Commit and push**

```bash
git add convex/demoData.ts convex/demoData.test.ts "src/app/(app)/dashboard/page.tsx"
git commit -m "Add self-serve demo dataset seed for the Barclays sample shoot"
git push
```

---

## Self-review notes

- **Spec coverage:** tiered call times (T1/T3/T6/T7/T8), grouped contacts + approach A (T1/T2/T7/T8), camera block (T1/T7/T8), equipment by supplier (T1/T6/T7/T8), invoicing (T1/T3/T4/T7/T9), emergency hospital+police+999 (T1/T5/T7), parking/sat-nav/transport (T1/T5/T7/T8 via location editor), confidentiality banner (T1/T3/T7/T8), logo/branding (T1/T3/T4/T7/T9), org settings surface (T4/T9), immutability via seed copy (T3), backward-compat migration (T2/T8), public tool stays minimal (conditional render throughout). All covered.
- **Naming choice:** the design named the shared row `contactRowValidator`; to keep every intermediate build green (the existing flat `contactRowValidator`/`ContactRow` stays for legacy `contacts[]`), the shared section row is `sectionRowValidator`/`SectionRow`. Same design, less churn.
- **Out of scope (unchanged):** public tool enrichment, brief-parser awareness of new fields, making contributors sendable, the other document types (RA, releases, NDA, quote/budget, shot list, DIT log).
