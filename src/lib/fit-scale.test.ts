import { describe, expect, it } from "vitest";
import { fitScale } from "./fit-scale";

describe("fitScale", () => {
  // A phone is narrower than the page, so the sheet shrinks to fit it.
  it("shrinks a page too wide for its container", () => {
    expect(fitScale(375, 794)).toBeCloseTo(375 / 794, 5);
  });

  // Never magnify: a call sheet blown up past A4 on a wide monitor would look
  // like a mistake, and print output must not change at all.
  it("never scales a page up", () => {
    expect(fitScale(1600, 794)).toBe(1);
  });

  it("leaves a page that exactly fits alone", () => {
    expect(fitScale(794, 794)).toBe(1);
  });

  // Before the first measurement the container reports zero width. Scaling by
  // zero would collapse the sheet to nothing, so full size is the safe start.
  it("falls back to full size when the container has not been measured", () => {
    expect(fitScale(0, 794)).toBe(1);
  });

  it("falls back to full size for a nonsense page width", () => {
    expect(fitScale(375, 0)).toBe(1);
  });
});
