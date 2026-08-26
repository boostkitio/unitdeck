# Google Maps in UnitDeck

Repository-safe notes on how maps work here and how to set the key up. No
secret values belong in this file.

## What we actually use

Two Google APIs, both driven by the same browser key:

- **Maps Embed API** — the interactive maps on screen, an `<iframe>` pointing
  at `google.com/maps/embed/v1/place`.
- **Maps Static API** — the map printed on a call sheet, an `<img>` from
  `maps.googleapis.com/maps/api/staticmap`. A printed sheet needs an image,
  not an embed.

Both must be enabled on the key or the corresponding map silently fails. Note
that Static Maps is metered and billed per request, which the Embed API is
not — check current pricing before assuming either is free.

We do **not** use the Maps JavaScript API, the Places API, or Google
Geocoding. Turning an address into coordinates is Nominatim (OpenStreetMap),
in `convex/lib/geocode.ts`. Grid references are Plus Codes computed offline in
`convex/lib/plusCode.ts`. Neither needs a Google key.

So: enable one API, not the suite.

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
2. Enable **Maps Embed API** and **Maps Static API**.
3. Credentials, then Create credentials, then API key.
4. Restrict it. This step is the security model, not an optional extra:
   - Application restrictions, HTTP referrers:
     `https://unitdeck.app/*` and `http://localhost:3000/*`
   - API restrictions, Restrict key: Maps Embed API and Maps Static API.
5. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` **and** in Vercel for
   Production and Preview. A key that works in dev and not in production is
   almost always missing from Vercel.

Check current pricing on Google's pricing page before relying on any free
allowance. Do not take a figure from a chat transcript.

## Where maps are rendered

| File | Behaviour without a key |
| --- | --- |
| `src/components/projects/location-section.tsx` | link tile, via `src/lib/maps.ts` |
| `src/app/(app)/locations/page.tsx` | link tile, via `src/lib/maps.ts` |
| `src/components/call-sheet/call-sheet-document.tsx` | prints the Plus Code |

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
