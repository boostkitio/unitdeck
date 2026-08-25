/**
 * Turning an address into coordinates, in one place.
 *
 * Three things want this — the location editor, the enrichment pass and the
 * forecast — and a location that was typed rather than picked has no
 * coordinates until one of them asks.
 */
export type Coordinates = { lat: number; lng: number };

/** Nominatim lookup for an address. Null when nothing matches. */
export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const query = address.trim();
  if (query.length === 0) return null;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Unit production OS (matt@boostkit.io)" },
  });
  if (!res.ok) return null;
  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (results.length === 0) return null;
  const lat = parseFloat(results[0].lat);
  const lng = parseFloat(results[0].lon);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}
