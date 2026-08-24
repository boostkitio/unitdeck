import { describe, expect, it } from "vitest";
import { FRESH_FOR_MS, FRESH_FOR_MS_WITHOUT_WEATHER, isStale } from "./forecast";

const NOW = 1_700_000_000_000;
const stored = {
  date: "2026-09-01",
  locationId: "loc1",
  fetchedAt: NOW,
};

describe("isStale", () => {
  it("is stale when there is nothing stored", () => {
    expect(isStale(undefined, "2026-09-01", "loc1", NOW)).toBe(true);
  });

  it("is not stale when it was just fetched for the same day and place", () => {
    expect(isStale(stored, "2026-09-01", "loc1", NOW + 60_000)).toBe(false);
  });

  it("is stale once the shoot date moves", () => {
    expect(isStale(stored, "2026-09-02", "loc1", NOW)).toBe(true);
  });

  it("is stale once the location changes", () => {
    expect(isStale(stored, "2026-09-01", "loc2", NOW)).toBe(true);
  });

  it("is stale after a few hours", () => {
    expect(isStale(stored, "2026-09-01", "loc1", NOW + FRESH_FOR_MS - 1)).toBe(false);
    expect(isStale(stored, "2026-09-01", "loc1", NOW + FRESH_FOR_MS + 1)).toBe(true);
  });

  it("holds a sun-times-only reading for longer, since it does not change", () => {
    const sunOnly = { ...stored, reason: "Too far ahead for a forecast" };
    expect(isStale(sunOnly, "2026-09-01", "loc1", NOW + FRESH_FOR_MS + 1)).toBe(false);
    expect(
      isStale(sunOnly, "2026-09-01", "loc1", NOW + FRESH_FOR_MS_WITHOUT_WEATHER + 1),
    ).toBe(true);
  });

  it("asks for nothing when there is no shoot date or no location", () => {
    // Otherwise the page would fetch forever for a project that cannot answer.
    expect(isStale(undefined, null, "loc1", NOW)).toBe(false);
    expect(isStale(undefined, "2026-09-01", null, NOW)).toBe(false);
  });
});
