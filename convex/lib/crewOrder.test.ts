import { describe, expect, it } from "vitest";
import { byCrewOrder } from "./crewOrder";

const row = (sortOrder: number | undefined, _creationTime: number) => ({
  sortOrder,
  _creationTime,
});

describe("byCrewOrder", () => {
  it("puts a lower sort order first", () => {
    const rows = [row(2, 100), row(0, 200), row(1, 300)];
    expect([...rows].sort(byCrewOrder).map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  // Every booking made before the field existed has no sortOrder. They must
  // fall to the bottom in a stable order rather than jumping above the crew
  // someone has deliberately arranged.
  it("sorts bookings with no order after those that have one", () => {
    const rows = [row(undefined, 100), row(5, 200)];
    expect([...rows].sort(byCrewOrder).map((r) => r.sortOrder)).toEqual([5, undefined]);
  });

  it("falls back to booking order for two rows that both lack one", () => {
    const rows = [row(undefined, 300), row(undefined, 100)];
    expect([...rows].sort(byCrewOrder).map((r) => r._creationTime)).toEqual([100, 300]);
  });

  // A zero must not be mistaken for "no order set" — it is the top of the list.
  it("treats zero as a real position, not a missing one", () => {
    const rows = [row(undefined, 100), row(0, 200)];
    expect([...rows].sort(byCrewOrder).map((r) => r.sortOrder)).toEqual([0, undefined]);
  });
});
