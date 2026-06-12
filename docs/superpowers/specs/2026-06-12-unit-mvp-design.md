# Unit: production OS for video companies. MVP design spec

Date: 12 June 2026
Status: draft for review
Companion research: `docs/research/2026-06-12-studiobinder-competitor-research.md`

## 1. Product thesis

An AI-native production operating system for video production companies, sold per month. StudioBinder makes production documents; Unit runs the production company. The wedge is the one workflow every company runs weekly and every incumbent does badly: brief in, call sheet out, crew confirmed, day run, wrapped.

Decisions already made:
- Target customer v1: corporate/branded video production companies (weekly shoots, client briefs, retainers). Film/TV objects (scenes, stripboards, scripts) deferred.
- MVP wedge: AI call sheets + command centre + set mode.
- Validation: dogfood on real shoots at Matt's company before selling.
- Working name: Unit (unit.film, $250/yr, available as of 12 June 2026, trademark check pending). Fallback: DailyCall (dailycall.io). Build proceeds under codename `unit` regardless.

## 2. Differentiators (each maps to evidenced incumbent failure)

1. **Never loses work.** Versioned documents, undo/redo on everything, autosave with visible save state. (StudioBinder's undo deleted user pages; stripboards have no undo.)
2. **Pixel-perfect PDFs.** Server renders the same React component as the on-screen preview via headless Chromium print. Preview and PDF cannot disagree. Snapshot tests guard layout. (Misaligned StudioBinder PDF exports embarrassed a producer in front of crew.)
3. **AI does the data entry.** Brief Parser turns a client email thread, PDF or deck into structured project data the producer approves as a diff. No incumbent does this; it removes the reason producers stay in spreadsheets.
4. **Unlimited guests.** Crew, clients and freelancers are free recipients/viewers; only producer seats are paid. (SetHero caps people-per-project; StudioBinder caps sends.)
5. **UK-native compliance.** Risk assessment prompts, RAMS templates, what3words, sunrise/sunset, nearest A&E lookup, weather. Near-zero SEO competition on these terms.

## 3. MVP scope

### In
- Organisations (multi-tenant), producer seats, roles (owner/producer/viewer)
- Projects with status, client, brief documents
- People database: contacts, crew, freelancers; role, rates, phone, email, dietary/allergy notes, attached documents
- Shoot days: date, location(s), schedule blocks, weather pull, sunrise/sunset
- Call sheet composer: structured data left, live preview centre, AI checklist right
- Call sheet distribution: email (Resend), SMS/WhatsApp (Twilio), personalised signed-link set-mode page per recipient, confirmation tracking, update re-sends with change highlights
- Set mode (mobile web, no login): my call time, role, map, parking, contacts, schedule, documents, check-in, safety acknowledgement
- Command centre: per-project attention feed (unconfirmed crew, missing required fields, weather risk, no risk assessment, unsent call sheet)
- AI v1: Brief Parser, Call Sheet Checker, Message Drafter. All proposals are approve/reject diffs logged in `agentRuns`.
- Wrap: simple production report (who attended, check-in times, notes)

### Out (later modules on the same graph)
Screenwriting, stripboards/scene breakdowns, storyboards/mood boards, budgeting/actuals/invoicing, client review portal and cuts, kit/inventory, crew availability calendars, Frame.io integration, native apps. Risk Agent (drafting full UK risk assessments) is the first fast-follow.

## 4. Architecture

- **Frontend**: Next.js App Router, TypeScript, Tailwind, shadcn/Radix, dnd-kit for schedule blocks. Mobile-first set mode as routes within the same app. PWA later.
- **Backend**: Convex (mandated default). Realtime subscriptions power confirmation tracking and command centre. Convex file storage for briefs/documents at MVP scale (20 MB HTTP action limit respected via upload URLs); R2 + Mux only when a review module ships.
- **Auth**: Clerk with organisations. Crew/clients never authenticate; they use signed, expiring magic links bound to a recipient record.
- **AI**: Vercel AI SDK v6 via AI Gateway ("provider/model" strings, model-agnostic). Agents are Convex actions writing proposals, never direct mutations. `agentRuns` stores prompt, sources, proposal diff, decision, actor.
- **PDF pipeline**: dedicated render endpoint running headless Chromium (e.g. browserless or a Vercel function with chromium build) printing the preview component with print CSS. Snapshot-tested. This is load-bearing; build it early (phase 2, not last).
- **Email**: Resend with React Email templates. All sends awaited and receipt-verified per the engineering checks skill; send status stored and surfaced.
- **SMS/WhatsApp**: Twilio. Sends are queued through Convex scheduled functions with delivery webhooks updating recipient status.
- **Billing**: Stripe Billing (deferred until after dogfood).
- **Hosting**: Vercel, Node 24, Fluid Compute defaults.

## 5. Data model (Convex tables, v1)

```
organisations   { name, branding, settings }
users           { clerkId, orgId, role }            // producer seats only
clients         { orgId, name, contacts[] }
people          { orgId, name, role, email, phone, rates, dietary, notes, docs[] }
projects        { orgId, clientId, name, status, briefSummary }
briefs          { projectId, source (email/pdf/deck/text), fileId, parsedJson }
shootDays       { projectId, date, locations[], scheduleBlocks[], weatherSnapshot, sun }
locations       { orgId, name, address, w3w, parking, nearestHospital, notes }
callSheets      { shootDayId, version, status (draft/sent/updated), dataJson, pdfFileId }
recipients      { callSheetId, personId, callTime, role, channel[], linkToken,
                  status (pending/delivered/viewed/confirmed/declined), checkInAt }
documents       { orgId, projectId?, type (riskAssessment/release/other), fileId }
agentRuns       { orgId, projectId, agent, input, proposalDiff, status, decidedBy, sources }
auditLogs       { orgId, actor, action, entity, before, after, at }
notifications   { orgId, userId, kind, payload, readAt }
```

Everything carries `orgId`; all queries filter by it (tenant isolation). Call sheet data is a versioned JSON document so undo/version history is a pointer walk, not a migration.

## 6. Error handling and reliability rules

- All sends (email/SMS) awaited with explicit success/failure state persisted; failures surface in the command centre, never silently dropped.
- Mutations validated with Convex validators + Zod at the edge; auth checked in every mutation.
- Magic links: signed tokens, per-recipient, revocable, expire after the shoot day + 7 days.
- Rate limiting and honeypots on any public endpoint (set-mode pages are public-by-token).
- AI agents cannot mutate production data directly; only humans approve proposal diffs.
- Pixel snapshot tests on call sheet PDF output in CI; Playwright e2e on the send → confirm loop.

## 7. Pricing hypothesis (validate during dogfood)

- Free: 1 active project, watermarked PDFs, email-only sends.
- Pro: ~£39 per producer seat/month. Unlimited projects, guests, sends; AI credits included.
- Studio: ~£99/month, 5 seats, branded set mode/portal, priority support, higher AI credits.
- Unlimited guests on all tiers is a headline marketing line.

## 8. Go-to-market notes (post-dogfood)

- SEO template/free-tool engine: call sheet template (1,000/mo UK), shot list template (880), film risk assessment template (110, uncontested), free call sheet maker tool gated by email. Mirrors StudioBinder's proven growth engine; US volumes ~5-8x UK.
- Comparison pages: StudioBinder alternative, SetHero alternative.
- Positioning line: "StudioBinder plans the shoot. Unit runs the company."

## 9. Build phases

1. Scaffold: Next.js + Convex + Clerk, orgs, projects, people CRUD.
2. Call sheet composer + versioning + PDF pipeline (load-bearing, built early).
3. Distribution: Resend/Twilio sends, recipient tracking, set mode pages, command centre feed.
4. AI: Brief Parser, Call Sheet Checker, Message Drafter via AI SDK + Gateway.
5. Dogfood on real shoots; wrap report; fix friction; then waitlist landing page + SEO engine.

Each phase gets its own implementation plan via the writing-plans skill before code is written.
