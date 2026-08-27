import { describe, expect, test } from "vitest";
import { dropIndex, moveItem, moveToSlot } from "./reorder";

describe("moveItem", () => {
  const rows = ["a", "b", "c", "d"];

  test("moves a row down to the slot it was dropped in", () => {
    // Dropping the first row into the third slot leaves it third, not second:
    // the slot is read against the list once the row has left it.
    expect(moveItem(rows, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  test("moves a row up", () => {
    expect(moveItem(rows, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("dropping a row where it already is changes nothing", () => {
    expect(moveItem(rows, 2, 2)).toBe(rows);
  });

  test("a slot past the end lands the row last rather than off it", () => {
    expect(moveItem(rows, 0, 99)).toEqual(["b", "c", "d", "a"]);
  });

  test("an index that is not in the list is left alone", () => {
    expect(moveItem(rows, 9, 0)).toBe(rows);
  });

  test("the original is not disturbed", () => {
    moveItem(rows, 0, 3);
    expect(rows).toEqual(["a", "b", "c", "d"]);
  });
});

describe("dropIndex", () => {
  // Four rows, 40px tall, starting at y=0: midpoints at 20, 60, 100, 140.
  const midpoints = [20, 60, 100, 140];

  test("above the first midpoint is the first slot", () => {
    expect(dropIndex(midpoints, 0)).toBe(0);
    expect(dropIndex(midpoints, 19)).toBe(0);
  });

  test("past a row's middle takes that row's place", () => {
    expect(dropIndex(midpoints, 21)).toBe(1);
    expect(dropIndex(midpoints, 61)).toBe(2);
  });

  test("below everything is the last slot", () => {
    expect(dropIndex(midpoints, 500)).toBe(4);
  });

  test("an empty list has one slot", () => {
    expect(dropIndex([], 10)).toBe(0);
  });
});

describe("moveToSlot", () => {
  const rows = ["a", "b", "c", "d"];

  test("dropping into the gap above or below a row is not a move", () => {
    expect(moveToSlot(rows, 1, 1)).toBe(rows);
    expect(moveToSlot(rows, 1, 2)).toBe(rows);
  });

  test("dragging down lands the row where it was dropped", () => {
    // "a" dragged into the gap after "c" — slot 3 — comes back third.
    expect(moveToSlot(rows, 0, 3)).toEqual(["b", "c", "a", "d"]);
  });

  test("dragging to the very bottom", () => {
    expect(moveToSlot(rows, 0, 4)).toEqual(["b", "c", "d", "a"]);
  });

  test("dragging up lands the row where it was dropped", () => {
    expect(moveToSlot(rows, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("dragging to the very top", () => {
    expect(moveToSlot(rows, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  test("a drag across the whole list and back is the list it started as", () => {
    const down = moveToSlot(rows, 0, 4);
    expect(moveToSlot(down, 3, 0)).toEqual(rows);
  });
});
