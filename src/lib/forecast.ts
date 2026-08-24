/**
 * When a stored forecast has stopped answering the question being asked.
 *
 * Kept apart from the component so it can be tested directly, and so the
 * refresh rule is stated once rather than inferred from an effect.
 */

/** A forecast goes off quickly; sun times and "too far ahead" do not. */
export const FRESH_FOR_MS = 3 * 60 * 60 * 1000;
export const FRESH_FOR_MS_WITHOUT_WEATHER = 24 * 60 * 60 * 1000;

export type StoredForecast = {
  date: string;
  locationId: string;
  fetchedAt: number;
  /** Set when there is no weather to show, saying why. */
  reason?: string;
};

export function isStale(
  forecast: StoredForecast | undefined,
  date: string | null,
  locationId: string | null,
  now: number,
): boolean {
  // Nothing to be stale about: no shoot date, or nowhere to ask about.
  if (!date || !locationId) return false;
  if (!forecast) return true;
  if (forecast.date !== date || forecast.locationId !== locationId) return true;
  const window = forecast.reason ? FRESH_FOR_MS_WITHOUT_WEATHER : FRESH_FOR_MS;
  return now - forecast.fetchedAt > window;
}
