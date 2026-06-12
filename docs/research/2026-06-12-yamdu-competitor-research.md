# Yamdu competitor research

Date: 12 June 2026 (evening, after Phase 4 shipped)
Sources: yamdu.com homepage and pricing page (scraped live), Capterra reviews (28 reviews, 4.8 overall), G2 (2 reviews only).
Companion: `2026-06-12-studiobinder-competitor-research.md`

## What Yamdu is

A heavyweight, script-first production management system out of Germany, aimed at scripted film and TV. Think "Movie Magic in the cloud": script import (Final Draft/PDF/Celtx/Fountain), AI breakdown suggestions, stripboard scheduling, Day-out-of-Days reports, budgeting with payroll/time cards, CO₂e sustainability budgeting, watermarked distribution, episodic feature set, TPN membership and a MovieLabs OMC API. Customer logos are broadcasters and studios: Netflix, Disney+, NBCUniversal, Constantin Film, ARD/ZDF, Sky.

## Pricing (live from their purchase page, USD)

| Plan | Price | Limits |
|---|---|---|
| Flex | $45/month | 1 user, 1 project (extra user $22/mo, extra project $45/mo), 25 GB |
| Core | $265/month, or $199/month billed annually | 20 users, unlimited projects, 25 GB |
| Signature | On request | Custom users/storage, PRO add-ons (white labelling, SSO/SAML, travel) |

Unlimited external contacts on all plans (non-login recipients, same idea as Unit's unlimited guests). Free trial, no card. Student/university sponsored plans.

## Evidenced weaknesses (Capterra cons, verbatim themes)

- Contacts are not retained across projects unless on a higher tier ("you have to have a higher tiered plan in order to retain contacts through multiple projects") — the company-memory database is paywalled.
- Performance: "the website freezes at times and the response time while clicking on some icons can be slow".
- Complexity: "sometimes it's a bit tricky to know which change in which tab has to be done to get the result you want"; "a bit too modern... unappealing to the old school film crews". A tool you have to learn.
- Mobile app trails the desktop ("the app needs to have the majority of the same features as on the computer").
- No script editing in-app; users want Google Drive integration instead of its file features.
- Tiny review footprint for its age (28 Capterra, 2 G2): low penetration outside its DACH/broadcast heartland.

## Yamdu vs Unit: the honest read

**Where Yamdu is genuinely ahead** (all deliberate Unit deferrals): script breakdown, stripboards/DOODs, budgeting + time cards + payroll exports, episodic tooling, watermarking, native mobile apps, integrations (Movie Magic, Fuzzlecheck, Showbiz, Slack, Zapier), enterprise trust badges (TPN, ISO, Azure EU). If a customer is making scripted TV, Yamdu wins and that is fine — that is not Unit's customer.

**Where Unit beats them for the target customer (corporate/branded video companies):**
1. **Script-first is wrong for unscripted.** Yamdu's whole workflow starts from a screenplay. A corporate producer with a client email thread has nothing to import. Unit starts from the brief itself: paste the email, get a project, client and shoot days proposed in seconds. No incumbent does this, including Yamdu (their AI is script breakdown only).
2. **Price.** A 5-seat corporate team on Yamdu needs Core at $265/month (or Flex gymnastics at $45 + $22/user + $45/project, which explodes with weekly shoots since projects are metered). Unit's hypothesis is ~£39/seat with unlimited projects. For weekly-shoot companies, Yamdu's per-project metering on Flex is actively hostile.
3. **Speed to a sent call sheet.** Yamdu's call sheet assumes the surrounding machinery (script, stripboard, units). Unit's path is brief → shoot day → composer → send, with live confirmation tracking and a no-login mobile set mode with check-in and safety acknowledgement. Yamdu tracks views/downloads; it does not run the morning of the shoot day.
4. **Company memory is free.** Their cross-project contacts database is tier-gated; Unit's people/clients/locations database is the core product at every tier.
5. **Lightness as a feature.** Their own reviewers say it freezes, lags and takes training. Unit's bar: a producer sends their first call sheet in 15 minutes with no onboarding call.
6. **UK-native details.** what3words, nearest A&E, sunrise/sunset, UK weather on the sheet by default. Yamdu is DACH/Hollywood-centric (reviewers even flag missing Italian; UK-specific compliance content is absent).

**What to take from them (later, not now):**
- Call sheet **templates with reuse** ("create or reuse templates") — worth adding once dogfood shows repeated patterns.
- **Announcements** to cast/crew mailing lists — natural Phase 5+ extension of the distribution rails.
- **Watermarked file sharing** — relevant when the documents module lands.
- Their **"unlimited external contacts"** wording validates Unit's unlimited-guests marketing line; Unit should claim it louder since StudioBinder caps sends.

## Positioning line against them

Yamdu manages film productions. Unit runs video production companies. (Same shape as the StudioBinder line: they are project tools; Unit is the company's operating system, priced for weekly shoots, starting from the client brief rather than a screenplay.)

## SEO note

"Yamdu alternative" volume will be small (their review footprint suggests a modest funnel), but the comparison page is cheap to add to the planned engine alongside StudioBinder/SetHero pages, and it captures exactly the corporate-video producers who bounce off Yamdu's complexity and pricing.
