/**
 * Sunrise and sunset, computed rather than fetched.
 *
 * A weather forecast only reaches about sixteen days out, but a producer
 * setting call times for a shoot in three months still needs to know when the
 * light goes. Sun times are pure astronomy, so they can be worked out for any
 * date — this is the standard NOAA/"sunrise equation" solution, accurate to
 * well under a minute at the latitudes anyone shoots at.
 */

const J2000 = 2451545.0;
const MS_PER_DAY = 86_400_000;
/** Julian date of the Unix epoch, for converting between the two. */
const UNIX_EPOCH_JD = 2440587.5;

/** Refraction plus the sun's radius: the centre sits this far below level. */
const HORIZON_DEGREES = -0.833;
const EARTH_TILT_DEGREES = 23.4397;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** A "YYYY-MM-DD" date as the Julian date of its UTC midnight. */
function julianDateOf(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms)) return null;
  return ms / MS_PER_DAY + UNIX_EPOCH_JD;
}

export type SunTimes = {
  /** Unix milliseconds, UTC. Callers format these in the location's zone. */
  sunriseMs: number;
  sunsetMs: number;
  /** Milliseconds between the two, for a daylight-hours readout. */
  daylightMs: number;
};

/**
 * Sunrise and sunset for a date at a point on the globe, or null inside the
 * polar circles when the sun does not cross the horizon that day.
 *
 * `date` is the local calendar date at that location; longitude is used to
 * anchor it, which is what makes the result right either side of the
 * antimeridian.
 */
export function sunTimes(date: string, lat: number, lng: number): SunTimes | null {
  const julian = julianDateOf(date);
  if (julian === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;

  // Days since J2000, shifted by longitude so the "day" is the local one.
  const n = Math.round(julian - J2000 - 0.0009 + lng / 360);
  const meanSolarTime = n + 0.0009 - lng / 360;

  const meanAnomaly = (357.5291 + 0.98560028 * meanSolarTime) % 360;
  const anomalyRad = toRadians(meanAnomaly);

  // Equation of the centre: the orbit is an ellipse, not a circle.
  const centre =
    1.9148 * Math.sin(anomalyRad) +
    0.02 * Math.sin(2 * anomalyRad) +
    0.0003 * Math.sin(3 * anomalyRad);

  const eclipticLongitude = (meanAnomaly + centre + 180 + 102.9372) % 360;
  const eclipticRad = toRadians(eclipticLongitude);

  const transit =
    J2000 +
    meanSolarTime +
    0.0053 * Math.sin(anomalyRad) -
    0.0069 * Math.sin(2 * eclipticRad);

  const declination = Math.asin(
    Math.sin(eclipticRad) * Math.sin(toRadians(EARTH_TILT_DEGREES)),
  );

  const latRad = toRadians(lat);
  const cosHourAngle =
    (Math.sin(toRadians(HORIZON_DEGREES)) - Math.sin(latRad) * Math.sin(declination)) /
    (Math.cos(latRad) * Math.cos(declination));

  // Outside [-1, 1] the sun never reaches the horizon: midnight sun, or none.
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = toDegrees(Math.acos(cosHourAngle));
  const sunriseJd = transit - hourAngle / 360;
  const sunsetJd = transit + hourAngle / 360;

  const sunriseMs = (sunriseJd - UNIX_EPOCH_JD) * MS_PER_DAY;
  const sunsetMs = (sunsetJd - UNIX_EPOCH_JD) * MS_PER_DAY;
  return { sunriseMs, sunsetMs, daylightMs: sunsetMs - sunriseMs };
}

/**
 * A UTC instant as "HH:MM" where it happened, given an IANA zone. Falls back
 * to UTC when the zone is unknown or unusable, rather than throwing — a time
 * an hour out still beats no time at all, and the caller says which it is.
 */
export function formatInZone(ms: number, timezone: string | undefined): string {
  const date = new Date(ms);
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || "UTC",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(date);
  }
}
