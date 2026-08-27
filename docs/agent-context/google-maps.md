# Google Maps in UnitDeck

Repository-safe notes on how maps work here and how to set the key up. No
secret values belong in this file.

## What we actually use

One Google API: the **Maps Embed API**, an `<iframe>` pointing at
`google.com/maps/embed/v1/place`. It is not metered.

We deliberately do **not** use the Maps Static API. It was used once, for the
map printed on a call sheet, and was dropped on 2026-08-27: it is billed per
request for a picture nobody navigates by, and on paper the Plus Code is what
actually gets somebody to the gate. A printed call sheet now always shows the
Plus Code, so there is no key to get wrong and no image to break.

Nor do we use the Maps JavaScript API, the Places API, or Google Geocoding.
Turning an address into coordinates is Nominatim (OpenStreetMap), in
`convex/lib/geocode.ts`. Grid references are Plus Codes computed offline in
`convex/lib/plusCode.ts`. Neither needs a Google key.

So: enable one API, not the suite.

## The live key

Project **boostkit-data**, key named "UnitDeck Maps Embed (browser)", created
2026-08-27. Restricted to the Maps Embed API only, with HTTP referrers
`https://unitdeck.app/*`, `https://*.unitdeck.app/*` and
`http://localhost:3000/*`.

The previous key was deleted from Google at some point before 2026-08-27 and
nothing noticed: `gcloud services api-keys lookup` returned NOT_FOUND, and both
APIs returned 403 "the provided API key is invalid" regardless of referrer. If
maps stop working again, run that lookup first, because a deleted key and an
over-restricted one produce different errors:

    RefererNotAllowed / "not authorized to use this API key"  -> restriction
    "the provided API key is invalid"                          -> the key is gone
    "This API is not activated on your API project"            -> wrong API on the key

## The key is public, and that is fine

The variable is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. In Next.js the
`NEXT_PUBLIC_` prefix means the value is inlined into the JavaScript served to
every visitor. Anyone can read it from page source.

That is unavoidable for an embedded map, and it is not a leak. The key is not
protected by secrecy, it is protected by **restriction**: Google checks which
site the request came from and refuses the rest. A copied key is useless from
another origin.

The one genuinely bad outcome is an *unrestricted* key, which anyone can lift
and spend your quota with.

## Setting it up

1. Google Cloud Console, create or choose a project.
2. Enable **Maps Embed API**. Nothing else.
3. Credentials, then Create credentials, then API key.
4. Restrict it. This step is the security model, not an optional extra:
   - Application restrictions, HTTP referrers:
     `https://unitdeck.app/*` and `http://localhost:3000/*`
   - API restrictions, Restrict key: Maps Embed API only.
5. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` **and** in Vercel for
   Production and Preview. A key that works in dev and not in production is
   almost always missing from Vercel.

Check current pricing on Google's pricing page before relying on any free
allowance. Do not take a figure from a chat transcript.

## Locking the key to this site

Two independent locks, set on the key in APIs & Services, Credentials.

**Application restrictions, who may use it.** Choose HTTP referrers (web
sites) and list:

    https://unitdeck.app/*
    https://*.unitdeck.app/*
    http://localhost:3000/*

The trailing `/*` is required. Without it only the bare homepage matches and
every other page loses its maps. Add `https://*.vercel.app/*` only if maps are
needed on preview deployments; it is a broad pattern that admits any site on
vercel.app.

**API restrictions, what it may do.** Choose Restrict key and tick Maps Embed
API, nothing else. A key that can only draw an iframe is a key with nothing
worth stealing.

**Cost, and why there is no cap to set.** Referrer checking is not
cryptographic security: the browser states where it came from, and anyone with
curl can claim to be unitdeck.app. It reliably stops a copied key being used
from someone else's site, which is the realistic risk, but it is not a wall.
That mattered when the Static API was on the key, because it bills per request.
The Embed API is not metered, so a lifted key costs nothing to run up. This is
the main reason to keep Static off the key rather than merely capped.

Referrer restrictions only apply to requests a browser makes. The only use
here is a browser request, an iframe, so it is covered. A server-side call
would need IP restrictions instead.

## Where maps are rendered

| File | Behaviour without a key |
| --- | --- |
| `src/components/projects/location-section.tsx` | link tile, via `src/lib/maps.ts` |
| `src/app/(app)/locations/page.tsx` | link tile, via `src/lib/maps.ts` |
| `src/components/call-sheet/call-sheet-document.tsx` | always prints the Plus Code, key or no key |

Both former gaps are closed. The unsupported `maps?q=...&output=embed`
endpoint is gone, and no map now depends on it. URL building lives in
`src/lib/maps.ts` and is tested.

A missing key is no longer a broken panel: on screen the tile becomes a link
to Google Maps, and on a printed call sheet it becomes the Plus Code, which is
what someone without a clickable page actually needs.

## Content-Security-Policy

There is currently **no CSP** configured anywhere in this project. Worth
knowing for two reasons: CSP is never the cause when a map fails to render
here, and if a CSP is added later it must allow framing
`https://www.google.com` or every map breaks at once.
