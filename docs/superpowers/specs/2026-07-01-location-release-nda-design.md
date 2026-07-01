# Location release, NDA, and multi-type documents — design

_2026-07-01_

## Goal

Extend the e-signature primitive (shipped 2026-07-01, see
`2026-07-01-talent-release-esign-design.md`) from one document type to three by
generalising the `documents` table to multiple types and adding two more
send-link signable documents: a UK-correct **location release** (project-scoped,
signed by the property manager) and a contractor **NDA / confidentiality
agreement** (org-level, signed by the contractor). After this slice, adding any
further send-link document is a new `type` literal + a `data` validator + a body
renderer + editor fields, with the signing flow reused unchanged.

The risk assessment (a structured checklist with an internal sign-off, not a
send-link signature) is deliberately a separate later spec.

## Context

The primitive already provides: the `documents` table with an inline signer and
`signToken`; org-scoped CRUD (`convex/documents.ts`); send + invite email;
public token-keyed signing (`getBySignToken`/`markViewed`/`sign`/`decline`, with
server-enforced consent); the signed PDF (`/api/documents/pdf`,
`/print/document/[token]`) and signed-copy email; and a project Documents section
+ composer (`src/components/documents/`). It is single-type today
(`type: v.union(v.literal("talent_release"))`, `data: talentReleaseDataValidator`).

## Key decisions

### 1. Generalise the primitive to multiple types (backward-compatible)

- `documents.type` widens to `v.union(v.literal("talent_release"), v.literal("location_release"), v.literal("nda"))`.
- `documents.data` widens to `v.union(talentReleaseDataValidator, locationReleaseDataValidator, ndaDataValidator)`. TypeScript treats this as a union discriminated by the row's `type`; consumers narrow via `switch (doc.type)`.
- Existing `talent_release` rows stay valid under both widened unions, so this is additive with no migration.
- The signing flow (`send`/`sign`/`decline`/`markViewed`/`attachSignedPdf`/PDF) is already type-agnostic and does not change, except `getBySignToken` and `getForPrint` start returning the document's `type` so the public signing page and print page know which body to render.

### 2. Type-dispatch seams (small, testable helpers)

- `signerFromData(type, data): { name: string; email: string }` in `convex/lib/documentData.ts` — talent → `talentName`/`talentEmail`; location → `propertyManagerName`/`propertyManagerEmail`; nda → `contractorName`/`contractorEmail`. `create` and `saveDraft` use it so the composer's editable contact fields stay the authoritative source of the signer (the generalised form of the fix already applied to the talent release).
- A `title(type, data)` helper for the per-type document title.

### 3. Generic email builders

Refactor `talentReleaseInviteEmail`/`signedCopyEmail` in `convex/lib/email.ts`
into `documentInviteEmail`/`documentSignedEmail` parameterised by a
`documentLabel` ("talent release" / "location release" / "confidentiality
agreement") and the signer name + context + `signUrl`. The email chrome lives in
one place; `deliverInvite`/`deliverSignedCopy` pass the label derived from the
document `type`. The existing `talentReleaseInviteEmail` test is updated to the
generic builder.

### 4. Location release (`type: "location_release"`, project-scoped)

`locationReleaseDataValidator`:

```ts
export const locationReleaseDataValidator = v.object({
  propertyName: v.string(),
  propertyAddress: v.string(),
  interior: v.optional(v.boolean()),
  exterior: v.optional(v.boolean()),
  propertyManagerName: v.string(),
  propertyManagerEmail: v.optional(v.string()),
  propertyManagerPhone: v.optional(v.string()),
  producerName: v.string(),
  productionCompany: v.string(),
  productionTitle: v.string(),
  datesOfOccupancy: v.optional(v.string()),
  hoursOfOccupancy: v.optional(v.string()),
  locationFee: v.optional(v.string()),
  additionalTerms: v.optional(v.string()),
  governingLaw: v.string(),
});
```

- `create({ type: "location_release", projectId, locationId? })` prefills
  `propertyName`/`propertyAddress` from the `location` (if given),
  `productionTitle`/`productionCompany` from project/org; the producer types the
  property-manager contact in the composer (the `locations` table has no contact
  field today; adding one is a future enhancement, out of scope).
- Signer = the property manager.
- A UK-correct location grant clause constant in the render component (the
  supplied sample was US-worded).
- It appears in the existing project Documents section, which becomes type-aware
  ("New location release" alongside "New talent release").

### 5. NDA (`type: "nda"`, org-level, new `/documents` home)

`ndaDataValidator`:

```ts
export const ndaDataValidator = v.object({
  contractorName: v.string(),
  contractorEmail: v.optional(v.string()),
  contractorAddress: v.optional(v.string()),
  position: v.optional(v.string()),        // the "Retainer" position/role
  clientName: v.string(),                  // the org, prefilled from org.name
  clientAddress: v.optional(v.string()),
  governingLaw: v.string(),                // "England and Wales"
});
```

- `create({ type: "nda", personId? })` with no `projectId` (org-level); prefills
  the contractor from the person (name/email) and `clientName` from the org.
- Signer = the contractor.
- The NDA body is mostly fixed boilerplate (confidentiality, non-solicitation,
  non-competition, ownership, return, remedies, governing law, etc.) as a
  versioned constant in the render component, with the variable bits (contractor
  name/address, position, client, governing law) substituted.
- **Home:** a new `/documents` app page (new nav item "Documents") listing
  org-level documents (those with `projectId === undefined`) via a new
  `documents.listOrgLevel` query, with a "New NDA" action that picks a contractor
  from People or free-types name + email, then opens the composer. It reuses the
  same type-aware list-row and composer components as the project section.

### 6. Public render dispatch

`getBySignToken` and `getForPrint` return `type` alongside `data`/`signature`, so
the signing page and print page render via a `DocumentBody` switch. No org
internals are added to those public returns.

## Frontend

- `src/components/documents/document-body.tsx` — a `DocumentBody({ type, data, signature })` switch → `TalentReleaseDocument` / `LocationReleaseDocument` / `NdaDocument`.
- `src/components/documents/location-release-document.tsx` and `nda-document.tsx` — per-type print-safe render components (mirror `talent-release-document.tsx`), each exporting its grant/boilerplate clause constant + version.
- The composer's `ComposerFields` becomes a `switch (type)` rendering the per-type editable fields; `DocumentBody` drives the live preview and the print/PDF path.
- `src/app/(app)/documents/page.tsx` — the org-level Documents page (NDAs), reusing the type-aware section/composer components.
- `src/components/shell/nav-items.ts` — add a "Documents" nav item (+ update `nav-items.test.ts`).
- The project Documents section gains a type picker so "New talent release" and "New location release" both create the right `type`.

## Backend

- `convex/schema.ts` — widen `type` and `data` unions.
- `convex/lib/documentData.ts` — `locationReleaseDataValidator`, `ndaDataValidator`, `signerFromData`, `title`, and the discriminated `DocumentData` type.
- `convex/documents.ts` — `create` dispatches prefill by `type` (accepts `locationId?` and no-`projectId` NDA path); `saveDraft` uses `signerFromData`; `getBySignToken`/`getForPrint` return `type`; new `listOrgLevel` query (org-scoped, `projectId === undefined`).
- `convex/lib/email.ts` — generic `documentInviteEmail`/`documentSignedEmail`; `convex/documents.ts` `deliverInvite`/`deliverSignedCopy` pass the per-type label.

## Backward compatibility

Purely additive: widened unions accept existing talent rows; new validators, one
new query, one new page, new components. No existing table/function/route
behaviour changes for the talent release. No migration.

## Testing

- Convex (`convex/documents.test.ts`): `create` for `location_release` and `nda`
  prefills the right fields and sets the right signer via `signerFromData`;
  `saveDraft` re-derives the signer per type; `listOrgLevel` returns NDAs (no
  `projectId`) and excludes project-scoped docs; a location + NDA send → sign
  smoke test (the signing state machine is already covered generically for
  talent). Round-trip tests for the two new `data` shapes.
- `convex/lib/email.test.ts`: the generic builders escape interpolated text and
  include the sign link and the correct document label.
- `convex/lib/documentData.test.ts` (or the existing test file): `signerFromData`
  returns the right contact for each type.
- Render components, composer, org page, nav: `npm run build` + manual QA (the
  nav-items test is a real unit test to update).

## Out of scope (this slice)

- Risk assessment (separate later spec: structured checklist + internal sign-off).
- Minors/guardian signing, multi-signer, producer countersignature.
- The cross-cutting e-sign hardening follow-ups noted in the roadmap memory
  (rate-limiting the public POST routes, expiring the `signToken`, serving the
  stored signed PDF, project-relevant people filtering) — one pass across all
  types, later.
- A property-manager contact field on the `locations` table (future prefill
  enhancement).
