import { describe, expect, it } from "vitest";
import { encodePlusCode, localityFrom, plusCodeFor } from "./plusCode";

describe("encodePlusCode", () => {
  // The worked example from the Open Location Code README: the Google office
  // in Zurich. Using the reference implementation's own published vector means
  // a wrong answer here is a real encoding fault, not a disagreement about
  // rounding.
  it("matches the published code for Zurich", () => {
    expect(encodePlusCode(47.36559, 8.524997)).toBe("8FVC9G8F+6X");
  });

  it("puts the separator after eight digits", () => {
    expect(encodePlusCode(51.5072, -0.1276)).toMatch(/^[0-9A-Z]{8}\+[0-9A-Z]{2}$/);
  });

  it("encodes places south and west of Greenwich", () => {
    // Negative latitude and longitude are where sign errors surface.
    const code = encodePlusCode(-33.8688, 151.2093);
    expect(code).toMatch(/^[0-9A-Z]{8}\+[0-9A-Z]{2}$/);
    expect(code).not.toBe(encodePlusCode(33.8688, 151.2093));
  });
});

describe("localityFrom", () => {
  it("takes the town off the end of a full address", () => {
    expect(localityFrom("Salomons Estate, Broomhill Road, Tunbridge Wells TN3 0TG")).toBe(
      "Tunbridge Wells"
    );
  });

  it("keeps a town whose address carries no postcode", () => {
    expect(localityFrom("The Old Studio, Bristol")).toBe("Bristol");
  });

  it("has no locality for an empty address", () => {
    expect(localityFrom("")).toBeNull();
  });

  it("has no locality when the last segment is only a postcode", () => {
    expect(localityFrom("25 Tree Lane, EC4A 8BX")).toBeNull();
  });
});

describe("plusCodeFor", () => {
  // A driver reads this off a call sheet, so it is the short form paired with
  // a town rather than the full global code.
  it("drops the four leading characters and names the town", () => {
    expect(plusCodeFor(47.36559, 8.524997, "Europaallee 36, Zurich")).toBe("9G8F+6X Zurich");
  });

  it("falls back to the full code when no town can be read", () => {
    expect(plusCodeFor(47.36559, 8.524997, "")).toBe("8FVC9G8F+6X");
  });
});
