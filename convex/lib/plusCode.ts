/**
 * Plus Codes, in one place.
 *
 * A Plus Code (Open Location Code) is a grid reference derived from
 * coordinates by arithmetic alone. There is no service to call and no key to
 * hold, so unlike the address lookups elsewhere in this directory it cannot
 * fail, rate-limit, or go blank because an environment variable is unset.
 *
 * Google's own display convention pairs a shortened code with a town —
 * "9G8F+6X Zurich" rather than "8FVC9G8F+6X" — because that is what someone
 * reads off a call sheet and types into a maps app.
 */
import { OpenLocationCode } from "open-location-code";

const codec = new OpenLocationCode();

/** Leading characters a locality-paired code leaves out. */
const LOCALITY_PREFIX_LENGTH = 4;

/**
 * A trailing UK postcode, or the start of one.
 *
 * Deliberately a copy of the shape used in geocode.ts rather than an import:
 * that module reaches the network, and this one is arithmetic that should stay
 * cheap to test.
 */
const TRAILING_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\b.*$/i;

/** The full global Plus Code for a point. */
export function encodePlusCode(lat: number, lng: number): string {
  return codec.encode(lat, lng);
}

/**
 * The town an address ends with, or null when it does not name one.
 *
 * A Plus Code is only shortened when there is somewhere to anchor it, so a
 * missing locality is a real answer rather than an empty string.
 */
export function localityFrom(address: string): string | null {
  const segments = address
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;

  const locality = last.replace(TRAILING_POSTCODE, "").trim();
  // One character is a stray initial, not a town.
  return locality.length > 1 ? locality : null;
}

/**
 * The Plus Code to print for a location: short form and town where the address
 * gives one, and the unambiguous full code where it does not.
 *
 * The shortened form drops a fixed four characters. The library's `shorten`
 * would drop six whenever the reference point is this close, and a six-drop
 * code only resolves near a reference the reader does not have.
 */
export function plusCodeFor(lat: number, lng: number, address: string): string {
  const full = encodePlusCode(lat, lng);
  const locality = localityFrom(address);
  if (!locality) return full;
  return `${full.slice(LOCALITY_PREFIX_LENGTH)} ${locality}`;
}
