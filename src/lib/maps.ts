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

export type MapTile = { url: string; left: number; top: number };

const TILE_SIZE = 256;

/**
 * The OpenStreetMap tiles that cover a `width` × `height` pixel box centred on
 * a point, each with where it sits in that box.
 *
 * This is how a printed call sheet gets a map without the Static Maps API: the
 * tiles are ordinary images, so they print, and they are not billed. The page
 * showing them must credit OpenStreetMap.
 */
export function osmTiles(
  lat: number,
  lng: number,
  zoom: number,
  width: number,
  height: number
): MapTile[] {
  const scale = TILE_SIZE * 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;

  const left = x - width / 2;
  const top = y - height / 2;
  const count = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + height - 1) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + width - 1) / TILE_SIZE); tx++) {
      // Across the antimeridian the world repeats.
      const wrapped = ((tx % count) + count) % count;
      tiles.push({
        url: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
        left: Math.round(tx * TILE_SIZE - left),
        top: Math.round(ty * TILE_SIZE - top),
      });
    }
  }
  return tiles;
}

/** A Google Maps search link, which needs no key and works for anyone. */
export function mapLink(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
