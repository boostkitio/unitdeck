/**
 * Turning an address into coordinates, in one place.
 *
 * Three things want this — the location editor, the enrichment pass and the
 * forecast — and a location that was typed rather than picked has no
 * coordinates until one of them asks.
 */
export type Coordinates = { lat: number; lng: number };

export type Placement = Coordinates & {
  /** The query that actually matched, which may be looser than what was typed. */
  matched: string;
  /** Whether the match was of the address itself rather than the area round it. */
  precise: boolean;
};

/** A complete UK postcode: outward code, then a digit and two letters. */
const FULL_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
/** A postcode that stops partway through its second half, as typed ones do. */
const PARTIAL_POSTCODE = /\s+([A-Z]{1,2}\d[A-Z\d]?)\s+\d[A-Z]?\b(?!\s*[A-Z])/i;

function tidy(query: string): string {
  return query.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
}

/**
 * Drop a postcode that was typed only halfway.
 *
 * "London EC4A 8B" is not a postcode any gazetteer will match, and leaving it
 * in fails the whole lookup. The outward code is real and worth keeping — it
 * narrows the search to a few streets — so only the broken half goes.
 */
export function repairPostcode(address: string): string {
  if (FULL_POSTCODE.test(address)) return tidy(address);
  return tidy(address.replace(PARTIAL_POSTCODE, " $1"));
}

/**
 * Progressively looser ways to ask where an address is, best first.
 *
 * A gazetteer either matches an address or it does not; it will not tell you
 * that everything but the building name was fine. So the building name comes
 * off, then the street, until something lands. For the weather, the area is a
 * perfectly good answer — it is the same sky.
 */
export function geocodeQueries(address: string): { query: string; precise: boolean }[] {
  const out: { query: string; precise: boolean }[] = [];
  const seen = new Set<string>();
  const push = (query: string, precise: boolean) => {
    const cleaned = tidy(query);
    // Two characters is a country code at best, not somewhere to shoot.
    if (cleaned.length < 3) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ query: cleaned, precise });
  };

  const full = tidy(address);
  if (full.length === 0) return [];
  push(full, true);
  push(repairPostcode(full), true);

  // A whole postcode on its own is the single most reliable query there is.
  const postcode = full.match(FULL_POSTCODE);
  if (postcode) push(`${postcode[1]} ${postcode[2]}`, true);

  // "Plum Tree Court, 25 Tree Lane, London" → "25 Tree Lane, London" → "London"
  const segments = repairPostcode(full).split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < segments.length; i++) {
    push(segments.slice(i).join(", "), false);
  }

  // Whatever the last segment names, without the postcode clinging to it.
  const last = segments[segments.length - 1];
  if (last) push(last.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\b.*$/i, ""), false);

  return out;
}

/** One Nominatim lookup. Null when nothing matches or the service declines. */
async function lookup(query: string): Promise<Coordinates | null> {
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

/**
 * Where an address is, falling back to the area around it.
 *
 * `precise` says which of those it managed, so a caller that needs the pin in
 * the right place can refuse a match that only found the town.
 */
export async function geocodePlace(address: string): Promise<Placement | null> {
  for (const { query, precise } of geocodeQueries(address)) {
    const found = await lookup(query).catch(() => null);
    if (found) return { ...found, matched: query, precise };
  }
  return null;
}

/**
 * Coordinates good enough to drop a pin on. Null unless the address itself
 * matched — a map pin on the wrong side of town is worse than no pin.
 */
export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const placed = await geocodePlace(address);
  if (!placed || !placed.precise) return null;
  return { lat: placed.lat, lng: placed.lng };
}
