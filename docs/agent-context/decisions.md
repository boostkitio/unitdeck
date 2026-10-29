# Project decisions

Record durable, repository-safe technical decisions here. Include date,
decision, evidence, consequences, and superseded decision where applicable.
Do not store credentials or private client/commercial notes.

## 2026-10-29: quote line order within a section can be set by hand

- Decision: quote sections stay in rate card order, but lines inside a section
  carry an optional `position` once someone drags them or renames one. Where a
  section has positions, they win over the card order; lines added later sort
  after them. Renaming a line pins its section's current order first, because
  the card order is matched by name and a renamed line used to drop to the end.
- Evidence: Klaxon feedback (renamed titles jumped to the bottom; wanted to
  group lines within a section). Logic in `convex/lib/rateCardOrder.ts`,
  `reorderLines` in `convex/quotes.ts`, tests in `convex/quotes.test.ts`.
- Consequences: lines only move within their section, never across. Copies and
  new versions carry the arrangement. A line moved to another category loses
  its position and lands at the end of its new block.

## 2026-10-29: VAT can be marked out of scope per quote

- Decision: a quote has an optional `vatOutOfScope` flag (e.g. a client
  outside the UK). When set, no VAT is charged and the client copy reads
  "Outside the scope of UK VAT"; the stored VAT rate is kept so switching it
  off restores the rate. New versions and copies carry the flag.
- Evidence: Klaxon feedback (US clients). Tests in `convex/quotes.test.ts`.
