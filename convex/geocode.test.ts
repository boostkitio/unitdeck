import { describe, expect, it } from "vitest";
import { geocodeQueries, repairPostcode } from "./lib/geocode";

describe("repairPostcode", () => {
  it("leaves a complete postcode alone", () => {
    expect(repairPostcode("25 Tree Lane, London EC4A 4HT")).toBe("25 Tree Lane, London EC4A 4HT");
  });

  it("drops the half of a postcode that was never finished", () => {
    // The real fault behind a location the map could not place.
    expect(repairPostcode("Plum Tree Court, 25 Tree Lane, London EC4A 8B")).toBe(
      "Plum Tree Court, 25 Tree Lane, London EC4A",
    );
  });

  it("keeps an outward code that stands on its own", () => {
    expect(repairPostcode("London EC4A")).toBe("London EC4A");
  });

  it("leaves an address with no postcode at all alone", () => {
    expect(repairPostcode("Shoreditch studio, Curtain Road")).toBe(
      "Shoreditch studio, Curtain Road",
    );
  });
});

describe("geocodeQueries", () => {
  it("asks for the address itself before anything looser", () => {
    const queries = geocodeQueries("Plum Tree Court, 25 Tree Lane, London EC4A 8B");
    expect(queries[0]).toEqual({
      query: "Plum Tree Court, 25 Tree Lane, London EC4A 8B",
      precise: true,
    });
  });

  it("works down from the building to the street to the town", () => {
    const queries = geocodeQueries("Plum Tree Court, 25 Tree Lane, London EC4A 8B").map(
      (q) => q.query,
    );
    expect(queries).toContain("Plum Tree Court, 25 Tree Lane, London EC4A");
    expect(queries).toContain("25 Tree Lane, London EC4A");
    expect(queries).toContain("London EC4A");
    expect(queries).toContain("London");
  });

  it("only calls the address-level queries precise", () => {
    const queries = geocodeQueries("Plum Tree Court, 25 Tree Lane, London EC4A 8B");
    const byQuery = new Map(queries.map((q) => [q.query, q.precise]));
    expect(byQuery.get("Plum Tree Court, 25 Tree Lane, London EC4A 8B")).toBe(true);
    expect(byQuery.get("Plum Tree Court, 25 Tree Lane, London EC4A")).toBe(true);
    // Dropping the building means the pin would land on the street, not the door.
    expect(byQuery.get("25 Tree Lane, London EC4A")).toBe(false);
    expect(byQuery.get("London")).toBe(false);
  });

  it("asks a complete postcode on its own, which almost always lands", () => {
    const queries = geocodeQueries("Plum Tree Court, 25 Tree Lane, London EC4A 4HT");
    expect(queries.map((q) => q.query)).toContain("EC4A 4HT");
    expect(queries.find((q) => q.query === "EC4A 4HT")?.precise).toBe(true);
  });

  it("does not repeat itself when the loose queries collapse together", () => {
    const queries = geocodeQueries("London").map((q) => q.query);
    expect(queries).toEqual(["London"]);
  });

  it("has nothing to ask about an empty address", () => {
    expect(geocodeQueries("   ")).toEqual([]);
  });

  it("never asks about a fragment too short to mean anywhere", () => {
    for (const { query } of geocodeQueries("A big shed, Someplace, XY")) {
      expect(query.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("handles an address written without commas", () => {
    const queries = geocodeQueries("25 Tree Lane London EC4A 8B").map((q) => q.query);
    expect(queries[0]).toBe("25 Tree Lane London EC4A 8B");
    expect(queries).toContain("25 Tree Lane London EC4A");
  });
});
