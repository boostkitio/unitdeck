import { describe, expect, it } from "vitest";
import { formatInZone, sunTimes } from "./sun";

/** Minutes between a computed instant and an expected wall-clock time. */
function minutesFrom(ms: number, timezone: string, expected: string): number {
  const [h, m] = formatInZone(ms, timezone).split(":").map(Number);
  const [eh, em] = expected.split(":").map(Number);
  return Math.abs(h * 60 + m - (eh * 60 + em));
}

describe("sunTimes", () => {
  // Published times for these dates and places. Two minutes of slack covers
  // the difference between algorithms without letting a real error through.
  it("matches London at the summer solstice", () => {
    const times = sunTimes("2026-06-21", 51.5072, -0.1276)!;
    expect(minutesFrom(times.sunriseMs, "Europe/London", "04:43")).toBeLessThanOrEqual(2);
    expect(minutesFrom(times.sunsetMs, "Europe/London", "21:21")).toBeLessThanOrEqual(2);
  });

  it("matches London at the winter solstice", () => {
    const times = sunTimes("2026-12-21", 51.5072, -0.1276)!;
    expect(minutesFrom(times.sunriseMs, "Europe/London", "08:03")).toBeLessThanOrEqual(2);
    expect(minutesFrom(times.sunsetMs, "Europe/London", "15:53")).toBeLessThanOrEqual(2);
  });

  it("matches Los Angeles, well west of Greenwich", () => {
    const times = sunTimes("2026-06-21", 34.0522, -118.2437)!;
    expect(minutesFrom(times.sunriseMs, "America/Los_Angeles", "05:42")).toBeLessThanOrEqual(2);
    expect(minutesFrom(times.sunsetMs, "America/Los_Angeles", "20:08")).toBeLessThanOrEqual(2);
  });

  it("matches Sydney, south of the equator and east of Greenwich", () => {
    // Southern midwinter: the short day, not the long one.
    const times = sunTimes("2026-06-21", -33.8688, 151.2093)!;
    expect(minutesFrom(times.sunriseMs, "Australia/Sydney", "07:00")).toBeLessThanOrEqual(2);
    expect(minutesFrom(times.sunsetMs, "Australia/Sydney", "16:54")).toBeLessThanOrEqual(2);
  });

  it("works for a date far beyond any weather forecast", () => {
    // The whole point: sun times are knowable years out, weather is not.
    const times = sunTimes("2031-03-15", 51.5072, -0.1276);
    expect(times).not.toBeNull();
    expect(times!.sunsetMs).toBeGreaterThan(times!.sunriseMs);
  });

  it("puts sunset after sunrise, with a sane day length", () => {
    const times = sunTimes("2026-09-23", 51.5072, -0.1276)!;
    const hours = times.daylightMs / 3_600_000;
    // An equinox is twelve hours of daylight give or take a few minutes.
    expect(hours).toBeGreaterThan(11.8);
    expect(hours).toBeLessThan(12.4);
  });

  it("returns nothing when the sun does not set", () => {
    // Tromsø in midsummer: the midnight sun.
    expect(sunTimes("2026-06-21", 69.6496, 18.956)).toBeNull();
  });

  it("returns nothing when the sun does not rise", () => {
    expect(sunTimes("2026-12-21", 69.6496, 18.956)).toBeNull();
  });

  it("rejects a date it cannot read, rather than guessing", () => {
    expect(sunTimes("not a date", 51.5, -0.1)).toBeNull();
    expect(sunTimes("2026-6-1", 51.5, -0.1)).toBeNull();
  });

  it("rejects coordinates that are not on the globe", () => {
    expect(sunTimes("2026-06-21", 120, 0)).toBeNull();
    expect(sunTimes("2026-06-21", Number.NaN, 0)).toBeNull();
  });
});

describe("formatInZone", () => {
  it("shows the local wall clock, including daylight saving", () => {
    const summer = Date.UTC(2026, 5, 21, 12, 0);
    expect(formatInZone(summer, "Europe/London")).toBe("13:00");
    const winter = Date.UTC(2026, 11, 21, 12, 0);
    expect(formatInZone(winter, "Europe/London")).toBe("12:00");
  });

  it("falls back to UTC rather than throwing on an unknown zone", () => {
    const noon = Date.UTC(2026, 5, 21, 12, 0);
    expect(formatInZone(noon, "Not/AZone")).toBe("12:00");
    expect(formatInZone(noon, undefined)).toBe("12:00");
  });
});
