/**
 * The nearest station, A&E and police station to a point, measured.
 *
 * These used to come from a language model reading the address, which names
 * a well-known place near it rather than the nearest one — Woolwich Arsenal
 * for a location beside Woolwich Dockyard. A call sheet needs the nearest, so
 * this asks OpenStreetMap what is actually there and picks by distance.
 *
 * Distances are as the crow flies. That is what "nearest" means on a map, and
 * the walking time given with it is an estimate from that distance, said as
 * one.
 */

/** A thing on the map, as Overpass returns it with `out tags center`. */
export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type Nearby = {
  nearestTube?: string;
  nearestRail?: string;
  nearestHospital?: string;
  nearestPoliceStation?: string;
};

const EARTH_RADIUS_M = 6_371_000;

/** Metres between two points on the Earth's surface. */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function textOf(tags: Record<string, string>): string {
  return [tags.network, tags.operator, tags["network:short"], tags.line]
    .filter(Boolean)
    .join(";");
}

/** Which Transport for London service a station is on, or null when none. */
export function tflService(tags: Record<string, string>): string | null {
  const text = textOf(tags);
  // In service order: a station on the Underground is read as a Tube station
  // even when the DLR stops there too.
  if (/London Underground/i.test(text)) return "Underground";
  if (/Elizabeth line/i.test(text)) return "Elizabeth line";
  if (/London Overground/i.test(text)) return "Overground";
  if (/Docklands Light Railway|\bDLR\b/i.test(text)) return "DLR";
  return null;
}

/** Whether a station is on the National Rail network. */
export function isNationalRail(tags: Record<string, string>): boolean {
  const text = textOf(tags);
  // Heritage lines and miniature railways are stations too, and no use to
  // anyone getting to a shoot.
  if (tags.usage === "tourism" || tags["railway:preserved"] === "yes") return false;
  if (/heritage|steam|preserved|miniature/i.test(text)) return false;
  if (["subway", "light_rail", "miniature", "funicular", "monorail"].includes(tags.station ?? "")) {
    return /National Rail/i.test(text);
  }
  if (/National Rail/i.test(text)) return true;
  // Tagged with no network at all: a mainline station unless it is plainly
  // one of the London services.
  return tflService(tags) === null && (tags.train === "yes" || tags.railway === "station");
}

function pointOf(element: OsmElement): { lat: number; lng: number } | null {
  if (element.lat !== undefined && element.lon !== undefined) {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center) return { lat: element.center.lat, lng: element.center.lon };
  return null;
}

/** "0.4 km, about 6 min walk", or "3.2 km away" once it is too far to walk. */
export function describeDistance(metres: number): string {
  const km = metres / 1000;
  const kmText = km < 10 ? km.toFixed(1) : String(Math.round(km));
  if (metres <= 2500) {
    // Streets are not straight: a fifth again on the crow's line, at a
    // walking pace of 80 metres a minute.
    const minutes = Math.max(1, Math.round((metres * 1.2) / 80));
    return `${kmText} km, about ${minutes} min walk`;
  }
  return `${kmText} km away`;
}

type Candidate = { name: string; metres: number; tags: Record<string, string> };

function candidates(
  lat: number,
  lng: number,
  elements: OsmElement[],
  keep: (tags: Record<string, string>) => boolean
): Candidate[] {
  const out: Candidate[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    const point = pointOf(element);
    if (!name || !point || !keep(tags)) continue;
    out.push({ name, metres: distanceMetres(lat, lng, point.lat, point.lng), tags });
  }
  return out.sort((a, b) => a.metres - b.metres);
}

/**
 * Private hospitals do not run an A&E, but the map sometimes says they take
 * emergencies — Tunbridge Wells Nuffield is tagged that way, four miles
 * nearer than the real A&E at Pembury. They are left out by operator.
 */
const PRIVATE_HOSPITAL =
  /Nuffield|Spire|\bBMI\b|Circle Health|\bHCA\b|Ramsay|Cygnet|Priory|Private|Independ[ae]nt|Renovo/i;

export function couldBeAE(tags: Record<string, string>): boolean {
  if (tags["operator:type"] === "private") return false;
  return !PRIVATE_HOSPITAL.test([tags.name, tags.operator, tags.brand].filter(Boolean).join(" "));
}

const isStation = (tags: Record<string, string>) =>
  tags.railway === "station" || tags.railway === "halt" || tags.public_transport === "station";

/**
 * Picks the nearest of each from what is on the map around a point.
 * Anything not found is left out rather than guessed at.
 */
export function nearestFrom(lat: number, lng: number, elements: OsmElement[]): Nearby {
  const result: Nearby = {};

  const [tube] = candidates(lat, lng, elements, (t) => isStation(t) && tflService(t) !== null);
  if (tube) {
    const service = tflService(tube.tags)!;
    // "Woolwich Arsenal DLR" already says which service it is.
    const named = tube.name.toLowerCase().includes(service.toLowerCase())
      ? tube.name
      : `${tube.name} (${service})`;
    result.nearestTube = `${named}, ${describeDistance(tube.metres)}`;
  }

  const [rail] = candidates(lat, lng, elements, (t) => isStation(t) && isNationalRail(t));
  if (rail) result.nearestRail = `${rail.name}, ${describeDistance(rail.metres)}`;

  const hospitals = candidates(
    lat,
    lng,
    elements,
    (t) => (t.amenity === "hospital" || t.healthcare === "hospital") && couldBeAE(t)
  );
  const withAE = hospitals.find((h) => h.tags.emergency === "yes");
  if (withAE) {
    result.nearestHospital = `${withAE.name}, ${describeDistance(withAE.metres)}`;
  } else if (hospitals[0]) {
    // The map does not say this one takes emergencies. Better to name it and
    // say so than to leave the line blank on a safety document.
    result.nearestHospital = `${hospitals[0].name} (check it has an A&E), ${describeDistance(hospitals[0].metres)}`;
  }

  const [police] = candidates(lat, lng, elements, (t) => t.amenity === "police");
  if (police) result.nearestPoliceStation = `${police.name}, ${describeDistance(police.metres)}`;

  return result;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function overpass(query: string): Promise<OsmElement[]> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        // A busy server can hold a request for minutes; the other is tried.
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass asks callers to say who they are.
          "User-Agent": "UnitDeck/1.0 (https://unitdeck.app)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      return json.elements ?? [];
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not reach the map data");
}

/**
 * Looks up the nearest Tube, National Rail station, A&E and police station to
 * a point. A countryside location can be a long way from a station, so a
 * second, wider search runs for whatever the first did not find.
 */
export async function findNearby(lat: number, lng: number): Promise<Nearby> {
  const at = `${lat},${lng}`;
  // Exact tags and nodes-and-ways only: a regex, or relations, turns a
  // one-second query into one that times out on the wider search.
  const stations = (radius: number) =>
    `nw["railway"="station"](around:${radius},${at});nw["railway"="halt"](around:${radius},${at});`;
  const elements = await overpass(`[out:json][timeout:25];
(
  ${stations(5000)}
  nw["amenity"="hospital"](around:25000,${at});
  nw["healthcare"="hospital"](around:25000,${at});
  nw["amenity"="police"](around:15000,${at});
);
out tags center;`);
  let found = nearestFrom(lat, lng, elements);

  const hasAE = found.nearestHospital !== undefined && !found.nearestHospital.includes("check it has");
  if (!found.nearestRail || !hasAE || !found.nearestPoliceStation) {
    const wider = await overpass(`[out:json][timeout:25];
(
  ${found.nearestRail ? "" : stations(40000)}
  ${hasAE ? "" : `nw["amenity"="hospital"]["emergency"="yes"](around:80000,${at});`}
  ${found.nearestPoliceStation ? "" : `nw["amenity"="police"](around:50000,${at});`}
);
out tags center;`).catch(() => [] as OsmElement[]);
    const more = nearestFrom(lat, lng, [...elements, ...wider]);
    found = {
      // The Tube is never widened: a location thirty miles out is not near one.
      nearestTube: found.nearestTube,
      nearestRail: found.nearestRail ?? more.nearestRail,
      nearestHospital: hasAE ? found.nearestHospital : (more.nearestHospital ?? found.nearestHospital),
      nearestPoliceStation: found.nearestPoliceStation ?? more.nearestPoliceStation,
    };
  }
  return found;
}
