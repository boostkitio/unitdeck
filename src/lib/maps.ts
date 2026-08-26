/**
 * Google Maps URLs, in one place.
 *
 * Only the Maps Embed API is used, and only through an iframe. Nothing here
 * needs the Maps JavaScript API, Places, or Google geocoding — addresses are
 * placed by Nominatim in convex/lib/geocode.ts.
 *
 * See docs/agent-context/google-maps.md for how the key is set up and why it
 * is public.
 */

/** The browser key, inlined at build time. Undefined when none is configured. */
export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/**
 * An embeddable map for a query, or null when there is nothing safe to embed.
 *
 * Null rather than a keyless URL on purpose. The obvious fallback,
 * `google.com/maps?q=...&output=embed`, is an undocumented endpoint that
 * Google does not support and can withdraw without notice. A caller that gets
 * null can show a link or a Plus Code, which keeps working either way.
 */
export function mapEmbedSrc(query: string, key: string | undefined = MAPS_KEY): string | null {
  if (!key) return null;
  if (query.trim() === "") return null;
  return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${encodeURIComponent(query)}`;
}

/** A Google Maps search link, which needs no key and works for anyone. */
export function mapLink(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
