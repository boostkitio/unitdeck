import { describe, expect, it } from "vitest";
import {
  addMonths,
  dateKey,
  dayCount,
  daysInMonth,
  leadingBlanks,
  monthOf,
} from "./calendar";

describe("dateKey", () => {
  it("pads month and day", () => {
    expect(dateKey(2026, 0, 1)).toBe("2026-01-01");
    expect(dateKey(2026, 11, 25)).toBe("2026-12-25");
  });
});

describe("daysInMonth", () => {
  it("handles 30- and 31-day months", () => {
    expect(daysInMonth({ year: 2026, month: 8 })).toBe(30); // September
    expect(daysInMonth({ year: 2026, month: 7 })).toBe(31); // August
  });

  it("handles February in leap and common years", () => {
    expect(daysInMonth({ year: 2024, month: 1 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 1 })).toBe(28);
  });
});

describe("leadingBlanks", () => {
  it("is 0 when the month starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    expect(leadingBlanks({ year: 2026, month: 5 })).toBe(0);
  });

  it("is 6 when the month starts on a Sunday", () => {
    // 1 March 2026 is a Sunday.
    expect(leadingBlanks({ year: 2026, month: 2 })).toBe(6);
  });
});

describe("addMonths", () => {
  it("rolls over the year in both directions", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("monthOf", () => {
  it("reads the month out of a date key", () => {
    expect(monthOf("2026-08-24")).toEqual({ year: 2026, month: 7 });
  });
});

describe("dayCount", () => {
  it("counts both ends", () => {
    expect(dayCount("2026-09-01", "2026-09-01")).toBe(1);
    expect(dayCount("2026-09-01", "2026-09-04")).toBe(4);
  });

  it("counts across a month and a DST boundary", () => {
    expect(dayCount("2026-01-30", "2026-02-02")).toBe(4);
    // UK clocks go forward on 29 March 2026; the count must not lose a day.
    expect(dayCount("2026-03-28", "2026-03-30")).toBe(3);
  });

  it("returns 0 for an inverted or unparseable range", () => {
    expect(dayCount("2026-09-04", "2026-09-01")).toBe(0);
    expect(dayCount("nope", "2026-09-01")).toBe(0);
  });
});
