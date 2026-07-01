# Call sheet enrichment — design

_2026-07-01_

## Goal

Bring UnitDeck's generated call sheet up to the level of what a working studio
actually sends, using a real reference: Klaxon Studio's "Barclays Pension Advice"
call sheet (Tuesday 9 June 2026). Today UnitDeck renders a solid but thin call
sheet. The reference adds nine blocks I don't yet support. Closing that gap makes
UnitDeck's output indistinguishable from a studio's hand-made sheet, which is the
cheapest high-credibility win before the larger modules (quoting, releases, RA).

## Reference and gap

| Real call sheet block | UnitDeck today |
|---|---|
| Tiered call times (crew 07:45, agency 08:00, client 08:45, talent 09:45) | single `generalCallTime` |
| Grouped contacts: Crew / Agency / Client / Contributors, with "℅" reporting | flat `crew[]` + `contacts[]` |
| Camera/tech block (format, fps, aspect ratios, file-naming convention, notes) | none |
| Equipment list grouped by supplier | none |
| Invoicing block (company no., VAT, invoice email, keep receipts) | none |
| Emergency block: nearest hospital and nearest police station + 999 | `nearestHospital` on location only |
| Parking + sat-nav postcode + public transport | `parkingNotes` only, not surfaced this way |
| Confidentiality banner | none |
| Brand header / logo | none |

## Key decisions

### 1. Grouped contacts: keep `crew[]`, add generic `contactSections[]` (approach A)

`crew[]` stays the single "sendable" cast/crew table, so distribution and the send
dialog (which build recipients from `data.crew` rows that have an email) are
untouched. Agency / Client / Contributors, and any custom group a studio invents,
become editable `contactSections[]` that share a near-identical row shape with crew
(crew keeps its required call time; section rows make call time optional). The legacy
flat `contacts[]` auto-migrates into a "Key contacts" section the first time a draft
is edited; the validator field stays for backward compatibility but the composer
stops writing to it.

Rejected: a single unified `sections[]` with a per-section `sendable` flag (cleanest
concept but rewrites distribution, the send dialog, the seed and the brief parser and
migrates every existing row — more than this visual task needs); and fixed typed
arrays per group (rigid, no custom groups, four near-identical editors).

### 2. Immutability via snapshot copy

Every reusable org-level default is copied into the call sheet `data` snapshot at
`ensure` seed time, exactly as `productionCompany: org.name` already works. Editing
org settings later never mutates a sheet that has been sent. The composer gets a
"refresh from org defaults" action that re-copies the current values into the open
draft on demand.

### 3. Public tool stays minimal

The no-login call sheet maker keeps its current small field set. Because every new
field is optional and every new render block is conditional, tool renders simply
omit the new blocks. The tool composer does not expose them, and org-level defaults
(logo, invoicing, confidentiality) do not apply since there is no org.

## Data model

All additions are optional, so existing rows stay valid with no migration.

### Organisation settings (`schema.ts`)

Extend `organisations.settings`:

```ts
settings: v.optional(v.object({
  brandColor: v.optional(v.string()),            // already present
  logoStorageId: v.optional(v.id("_storage")),   // new
  invoicing: v.optional(v.object({
    legalName: v.optional(v.string()),
    companyNumber: v.optional(v.string()),
    vatNumber: v.optional(v.string()),
    invoiceEmail: v.optional(v.string()),
    receiptsNote: v.optional(v.string()),
  })),
  confidentialByDefault: v.optional(v.boolean()),
}))
```

### Call sheet data (`convex/lib/callSheetData.ts`)

A shared contact-row validator, reused by crew and by contact sections:

```ts
// contactRow supersedes the old crewRow shape; crewRow keeps its fields
export const contactRowValidator = v.object({
  id: v.string(),
  personId: v.optional(v.id("people")),
  name: v.string(),
  role: v.string(),
  callTime: v.optional(v.string()),   // "HH:MM"
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  reportsTo: v.optional(v.string()),  // the "℅ Adam" pattern
  notes: v.optional(v.string()),
});

export const contactSectionValidator = v.object({
  id: v.string(),
  title: v.string(),                  // "Agency", "Client", "Contributors"
  rows: v.array(contactRowValidator),
});

export const callTimeValidator = v.object({
  id: v.string(),
  label: v.string(),                  // "Crew call", "Client call"
  time: v.string(),                   // "HH:MM"
});

export const equipmentRowValidator = v.object({
  id: v.string(),
  supplier: v.optional(v.string()),   // groups under a supplier heading
  item: v.string(),
});

export const cameraInfoValidator = v.object({
  recordingFormat: v.optional(v.string()),
  frameRate: v.optional(v.string()),
  aspectRatios: v.optional(v.string()),
  namingConvention: v.optional(v.string()),
  otherNotes: v.optional(v.string()),
});
```

Note: the existing flat `contactRowValidator` (name/role/phone only) is renamed to
`legacyContactRowValidator` and kept solely to type the deprecated `contacts[]`
field. The new `contactRowValidator` above is the shared shape.

Additions to `callSheetDataValidator` (all optional):

```ts
callTimes: v.optional(v.array(callTimeValidator)),
crewSectionTitle: v.optional(v.string()),        // default "Crew"
contactSections: v.optional(v.array(contactSectionValidator)),
camera: v.optional(cameraInfoValidator),
equipment: v.optional(v.array(equipmentRowValidator)),
branding: v.optional(v.object({
  logoUrl: v.optional(v.string()),
  brandColor: v.optional(v.string()),
})),
invoicing: v.optional(v.object({
  legalName: v.optional(v.string()),
  companyNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  invoiceEmail: v.optional(v.string()),
  receiptsNote: v.optional(v.string()),
})),
confidential: v.optional(v.boolean()),
```

`crewRowValidator` gains `reportsTo: v.optional(v.string())` so the crew table can
carry the same "℅" reporting column.

### Location additions

Add to both the `locations` table and `locationEntryValidator`:

```ts
satNav: v.optional(v.string()),
publicTransport: v.optional(v.string()),
nearestPoliceStation: v.optional(v.string()),
```

Storing them on the `locations` table means they reseed onto the next shoot.

## Seeding (`callSheets.ensure`)

On first draft creation, copy the reusable defaults into the snapshot:

- `branding.brandColor` from `org.settings.brandColor`.
- `branding.logoUrl` resolved from `org.settings.logoStorageId` via
  `ctx.storage.getUrl`. The snapshot stores the resolved URL so it stays
  self-contained and immutable. (Plan-time check: confirm Convex serving URLs are
  durable; if not, the print-by-token query re-resolves from a stored id.)
- `invoicing` copied wholesale from `org.settings.invoicing`.
- `confidential` from `org.settings.confidentialByDefault`.
- Location entries copy the three new location fields.
- `callTimes` seeds with a single "Crew call" row from `generalCallTime`.
- `contactSections`, `camera`, `equipment` start empty/undefined.

The composer's "refresh from org defaults" action re-runs the copy for
branding/invoicing/confidential on the open draft only.

## Rendering (`CallSheetDocument`)

New conditional blocks, each rendered only when populated so tool renders stay
clean:

- **Confidentiality banner** — when `confidential`, a print-safe red banner at the
  top ("Confidential document. Do not misplace. Dispose of securely."). Banner text
  is a constant in the component.
- **Logo** — `branding.logoUrl` in the header beside the production company.
- **Tiered call-time strip** — `callTimes[]` as a labelled row under the header,
  falling back to `generalCallTime` when empty.
- **Locations** — extend the existing block with sat-nav, public transport and the
  emergency line (nearest hospital, nearest police station, and a static 999 note).
- **Grouped contacts** — the crew table (heading from `crewSectionTitle`, default
  "Crew"), then one table per `contactSections[]` entry, each with role / name /
  phone / email / call / reports-to columns.
- **Camera/tech block** — a small labelled grid from `camera`.
- **Equipment** — `equipment[]` grouped by `supplier` (supplier as a sub-heading,
  ungrouped items under a default heading).
- **Invoicing footer** — legal name, company number, VAT, invoice email, receipts
  note.

Keep colours print-safe and avoid viewport units, per the existing component's
contract (it is the single source of truth for both the composer preview and the
Chromium PDF).

## Composer (`ComposerForm`)

Matching editor sections for each per-sheet block, following the existing
add-row / move up-down / remove pattern already used for schedule and crew:

- Tiered call times (label + time rows).
- Contact sections (add section, add row, the same people-picker the crew section
  uses to prefill name/role/phone/email from `people`).
- Camera/tech fields.
- Equipment rows (item + optional supplier).
- Confidentiality toggle.
- A "refresh from org defaults" button.

Location-level fields (sat-nav, transport, police station) are edited on the
locations screen; the composer shows them read-only as part of the seeded location
entry.

## Org settings page

Net-new, since no settings surface exists today (`organisations.ts` has only
`ensure` and `current`, and `brandColor` is defined but never edited or rendered).

- Route: `/settings` under `src/app/(app)`.
- New mutation `organisations.updateSettings` (org-scoped via `requireOrg`) for
  brand colour, invoicing block and confidentiality default.
- Logo upload: `organisations.generateLogoUploadUrl` + `setLogo` mutations storing
  `logoStorageId`, plus a query that resolves the current logo URL for preview.
- Follows the same Convex storage upload pattern already used for call sheet PDFs.

## Backward compatibility and migration

- Every schema and validator addition is optional; existing `organisations`,
  `locations` and `callSheets` rows remain valid untouched.
- Legacy `contacts[]` still renders as "Key contacts" if present. On first edit of
  a draft, its entries migrate into a `contactSections` entry titled "Key contacts"
  and the composer stops writing the flat field.
- No backfill job is required.

## Surfaces touched

1. `convex/schema.ts` — org settings, locations fields.
2. `convex/lib/callSheetData.ts` — shared contact row, new validators, callSheetData additions.
3. `convex/callSheets.ts` (`ensure`) — seed copies and logo URL resolution.
4. `convex/organisations.ts` — `updateSettings`, logo upload/set mutations, logo URL query.
5. `convex/locations.ts` — accept and persist the three new fields.
6. `src/components/call-sheet/call-sheet-document.tsx` — all new render blocks.
7. `src/components/call-sheet/composer-form.tsx` — all new editor sections.
8. `src/app/(app)/settings/` — new org settings page.
9. Location editor UI — the three new location fields.
10. Tests — `callSheets.test.ts` seed expectations, `locations.test.ts`, plus new
    coverage for the contacts migration and settings mutations.

## Out of scope for this pass

- The public no-login tool keeps its current minimal field set.
- Teaching the brief-parser agent the new fields (optional follow-up; it emits
  proposals for a subset and the new fields default cleanly).
- Making talent/contributors "sendable" (possible later by promoting a section to
  sendable; distribution stays crew-only for now).
- The other document types from the same source set (risk assessment, releases,
  NDA, quote/budget, shot list, DIT log) are separate epics.

## Testing

- Unit: `ensure` copies org defaults into the snapshot and resolves the logo URL;
  contacts migration converts legacy `contacts[]` into a section once; settings
  mutations enforce org scope.
- Render: the document shows each new block only when populated and omits them for
  minimal tool data (guards the "keep the tool clean" requirement).
- Manual visual QA (desktop + mobile, per the engineering checks): rebuild the
  reference Klaxon sheet in the composer and compare the PDF side by side.
