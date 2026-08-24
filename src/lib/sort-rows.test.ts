import { describe, expect, it } from "vitest";
import { sortRows, type Sort } from "./sort-rows";

type Row = { name: string; email: string | null; rate: number | null };

const rows: Row[] = [
  { name: "Charlie", email: "c@example.test", rate: 300 },
  { name: "alice", email: null, rate: 100 },
  { name: "Bob", email: "b@example.test", rate: null },
];

const value = (row: Row, key: "name" | "email" | "rate") => row[key];

describe("sortRows", () => {
  it("sorts text case-insensitively", () => {
    const sort: Sort<"name"> = { key: "name", dir: "asc" };
    expect(sortRows(rows, sort, value).map((r) => r.name)).toEqual(["alice", "Bob", "Charlie"]);
  });

  it("reverses on descending", () => {
    const sort: Sort<"name"> = { key: "name", dir: "desc" };
    expect(sortRows(rows, sort, value).map((r) => r.name)).toEqual(["Charlie", "Bob", "alice"]);
  });

  it("keeps blanks at the bottom in both directions", () => {
    const asc = sortRows(rows, { key: "email", dir: "asc" } as Sort<"email">, value);
    const desc = sortRows(rows, { key: "email", dir: "desc" } as Sort<"email">, value);
    expect(asc[asc.length - 1].email).toBeNull();
    expect(desc[desc.length - 1].email).toBeNull();
  });

  it("compares numbers numerically, not as strings", () => {
    const numeric = [{ name: "a", email: null, rate: 9 }, { name: "b", email: null, rate: 100 }];
    const sorted = sortRows(numeric, { key: "rate", dir: "asc" } as Sort<"rate">, value);
    // String comparison would put "100" before "9".
    expect(sorted.map((r) => r.rate)).toEqual([9, 100]);
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortRows(rows, { key: "name", dir: "asc" } as Sort<"name">, value);
    expect(rows).toEqual(original);
  });

  it("is stable, so ties keep their existing order", () => {
    const tied = [
      { name: "same", email: "second@example.test", rate: null },
      { name: "same", email: "first@example.test", rate: null },
    ];
    const sorted = sortRows(tied, { key: "name", dir: "asc" } as Sort<"name">, value);
    expect(sorted.map((r) => r.email)).toEqual(["second@example.test", "first@example.test"]);
  });
});
