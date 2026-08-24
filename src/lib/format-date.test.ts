import { describe, expect, it } from "vitest";
import { formatShootDate, formatShootDateRange } from "./format-date";

describe("formatShootDate", () => {
  it("formats an ISO calendar day", () => {
    expect(formatShootDate("2026-08-24")).toBe("24 Aug 2026");
  });

  it("does not shift the day across timezones", () => {
    // Parsed as parts, so this stays the 1st even though `new Date()` would
    // read it as UTC midnight and render 31 Dec in negative offsets.
    expect(formatShootDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("returns the input unchanged when it is not a calendar day", () => {
    expect(formatShootDate("not-a-date")).toBe("not-a-date");
    expect(formatShootDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("formatShootDateRange", () => {
  it("returns null with no dates", () => {
    expect(formatShootDateRange([])).toBeNull();
  });

  it("returns a single date on its own", () => {
    expect(formatShootDateRange(["2026-08-24"])).toBe("24 Aug 2026");
  });

  it("spans first to last regardless of input order", () => {
    expect(formatShootDateRange(["2026-08-27", "2026-08-24", "2026-08-25"])).toBe(
      "24 Aug 2026 – 27 Aug 2026 · 3 days",
    );
  });
});
