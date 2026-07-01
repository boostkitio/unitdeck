# Talent release and shared e-sign primitive — design

_2026-07-01_

## Goal

Start UnitDeck's compliance/legal-document capability by building a shared
e-signature primitive and proving it end to end with the first document type: a
UK-correct talent release. A producer creates a release on a project, sends the
talent a signing link, the talent signs (typed name + consent, optional drawn
signature), and UnitDeck stores an immutable signed PDF and tracks status. The
signing mechanism is generic so the location release, NDA and risk assessment
later reuse it by adding only a new document type.

This is the first slice of the larger document roadmap (see
`unitdeck-document-roadmap`): shared e-sign primitive + talent release now; the
other documents are separate specs.

## Reference and gap

The supplied Klaxon "Talent Release" is a single-signer form: talent details,
producer/production details, compensation and additional terms, a rights-grant
clause, and a signature (with a guardian line for minors). UnitDeck has no
document-signing capability today. It does have the reusable pieces this builds
on: token-based public pages (`src/app/s/[token]`, `renderTokens`), the
recipient-with-token + status-stamping pattern (`recipients`, `convex/setMode.ts`),
the awaited Resend email path (`convex/distribution.ts`, `convex/lib/email.ts`),
and the puppeteer print-to-PDF pipeline (`src/app/api/call-sheets/pdf`,
`src/app/print/...`).

## Key decisions

### 1. Generic `documents` primitive keyed by type (approach A)

One `documents` table with a `type` union (`"talent_release"` only for now), a
per-type `data` body validator, and a generic signing mechanism (public
`/sign/[token]` page, sign/decline mutations, audit capture, signed-PDF storage).
Later documents add a `type` literal + `data` validator + body renderer + editor
and reuse the signing path unchanged.

Rejected: a concrete `talentReleases` table (fast to first signature but pays a
refactor when the second document lands); and a fully generic form-builder
engine (YAGNI).

### 2. Single inline signer

All four roadmap documents are single-signer (talent, property manager,
contractor, production manager), so the signer lives inline on the `documents`
row rather than in a separate table. Multi-signer is a later extension and is
explicitly out of scope. The `signToken` is a top-level indexed field so the
public page can resolve it.

### 3. Signature capture: typed name + consent, optional drawn

The signer types their full legal name and ticks an explicit consent statement
("I agree this is my electronic signature"); both are required. A drawn signature
(canvas) is optional and, when provided, is stored as a small PNG data URI
embedded in the signature record (self-contained and immutable, renders directly
in the signed PDF via `<img src={dataUri}>`). We also stamp `signedAt`, client
`ip`, and `userAgent`, and freeze the exact document `data` at send time so the
signed artefact cannot drift.

### 4. Immutability

`data` is editable only while `status === "draft"`. **Send** freezes it and mints
the `signToken`. **Sign** stamps the signature and generates the signed PDF stored
in Convex storage (`signedPdfFileId`); after that the row is read-only. This
mirrors the call sheet snapshot discipline.

### 5. IP/audit captured via a thin Next.js route

Convex functions cannot see the raw request IP, so the signer's submission POSTs
to a Next.js route that reads `x-forwarded-for` and `user-agent` from the request
headers and passes them to the Convex sign mutation, mirroring
`src/app/api/call-sheets/pdf/route.ts`. Email sends are awaited and verified (no
fire-and-forget), per the engineering checks.

## Data model

### `documents` table (`convex/schema.ts`)

```ts
documents: defineTable({
  orgId: v.id("organisations"),
  projectId: v.optional(v.id("projects")),
  type: v.union(v.literal("talent_release")),
  title: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("sent"),
    v.literal("signed"),
    v.literal("declined"),
    v.literal("voided")
  ),
  data: talentReleaseDataValidator, // per-type body; a union when more types exist
  signer: v.object({
    name: v.string(),
    email: v.string(),
    personId: v.optional(v.id("people")),
  }),
  signToken: v.string(),          // unguessable; powers /sign/[token]
  signature: v.optional(
    v.object({
      typedName: v.string(),
      drawnImage: v.optional(v.string()), // PNG data URI
      consent: v.literal(true),
      signedAt: v.number(),
      ip: v.optional(v.string()),
      userAgent: v.optional(v.string()),
    })
  ),
  declinedAt: v.optional(v.number()),
  declineReason: v.optional(v.string()),
  viewedAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  signedPdfFileId: v.optional(v.id("_storage")),
})
  .index("by_org", ["orgId"])
  .index("by_project", ["projectId"])
  .index("by_sign_token", ["signToken"]),
```

### Talent-release body (`convex/lib/documentData.ts`, new)

```ts
export const talentReleaseDataValidator = v.object({
  talentName: v.string(),
  talentEmail: v.optional(v.string()),
  talentPhone: v.optional(v.string()),
  agentName: v.optional(v.string()),
  agentPhone: v.optional(v.string()),
  producerName: v.string(),
  productionCompany: v.string(),
  productionTitle: v.string(),
  compensation: v.optional(v.string()),
  additionalTerms: v.optional(v.string()),
  governingLaw: v.string(), // defaults to "England and Wales"
});
```

The rights-grant clause is a versioned UK-correct constant in the render
component (not stored per-row), so wording fixes apply everywhere and the signed
PDF still captures what was shown via the frozen `data` + the constant's version.

## Backend (`convex/documents.ts`, new)

- `create({ projectId, type, ... })` — org-scoped via `requireOrg`; prefills the
  body from the project/org and the chosen person; inserts a `draft` with a fresh
  `signToken`; returns the id.
- `get` / `listForProject` — org-scoped reads.
- `saveDraft({ id, data })` — only while `draft`.
- `send({ id })` — freezes: sets `status: "sent"`, `sentAt`; then (awaited)
  emails the talent a link to `/sign/{signToken}` via the Resend path; records the
  send result. Rejects if not `draft` or the signer has no email.
- `getBySignToken({ token })` — **public** (no auth) query, used only by the
  signing page; returns the rendered body + status, never org internals. Being a
  query it does not write.
- `markViewed({ token })` — **public** mutation the signing page calls once on
  load to stamp `viewedAt` (a query cannot write, so the view stamp is its own
  mutation); no-op if already signed/declined.
- `sign({ token, typedName, drawnImage?, ip?, userAgent? })` — **public**;
  validates the token resolves to a `sent` doc, requires a non-empty typedName and
  consent, stamps `signature`, sets `status: "signed"`. Idempotent-safe (a second
  sign on an already-signed doc is rejected, not duplicated).
- `decline({ token, reason? })` — **public**; stamps `declinedAt`, sets
  `status: "declined"`.
- `attachSignedPdf({ id, fileId })` — org-scoped; stores `signedPdfFileId`.

Tenancy: every non-public function derives the org from the Clerk token via
`requireOrg`; the three public functions are reachable only with a valid
`signToken`.

## Signing page and PDF (frontend)

- `src/app/sign/[token]/page.tsx` — public, no login. Loads `getBySignToken`.
  Renders the release read-only, then a sign panel: typed-name input, a consent
  checkbox, an optional draw-your-signature canvas, and Sign / Decline actions.
  Already-signed → shows a "signed" confirmation with a download; expired/invalid
  → a friendly not-found; declined → a recorded state. On submit it POSTs to the
  Next.js sign route.
- `src/app/api/documents/sign/route.ts` — reads `x-forwarded-for` + `user-agent`,
  calls `documents.sign`, then triggers signed-PDF generation.
- `src/app/print/document/[token]/page.tsx` + `src/app/api/documents/pdf/route.ts`
  — render the release (with the signature block when signed) to PDF via the same
  puppeteer pattern as call sheets; store via `attachSignedPdf`.
- `src/components/documents/talent-release-document.tsx` — the print/preview body
  (single source of truth for screen preview and PDF), print-safe.
- `src/components/documents/release-composer.tsx` — the producer's editor.
- A **Documents** section on the project page listing a project's documents with
  status badges, a "New talent release" action, per-document send/preview/download,
  and a talent picker from `people`.

## Email

Reuse the awaited Resend path and the existing `FROM = "UnitDeck <callsheets@mail.unitdeck.app>"`
sender. Two templates: the signing invite (to the
talent, with the `/sign/{token}` link) and the signed copy (to talent + the
producer, linking the signed PDF). All sends awaited and their outcome recorded;
`SITE_URL` (already set in Convex prod) builds the absolute links.

## Backward compatibility

Purely additive: a new table and new files. No existing table, function or route
changes. No migration.

## Testing

- Convex (`convex/documents.test.ts`): create seeds a draft with a token; saveDraft
  only works on drafts; send freezes and sets `sent`; `getBySignToken` returns body
  not org internals and stamps `viewedAt`; `sign` requires typedName + consent,
  stamps once, and rejects a second sign; `decline` records; cross-org isolation on
  every org-scoped function; token resolution + invalid token returns null.
- Manual QA: create a talent release on a project, send to a test address
  ("Matt - Test - Please Ignore" style dummy signer), open `/sign/[token]` on
  desktop and mobile, sign both with and without a drawn signature, confirm the
  signed PDF renders the signature block and both emails arrive.

## Out of scope (this slice)

- Minors / legal-guardian co-signing.
- Multi-signer and producer countersignature.
- The location release, NDA and risk assessment (each a later spec reusing this
  primitive).
- Bulk-send to many talents at once.
