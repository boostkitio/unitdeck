import { describe, expect, it } from "vitest";
import { batch, parseCsv, parseCsvRecords, pickColumn } from "./csv";

describe("parseCsv", () => {
  it("splits plain rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('name,notes\n"Reed, Sam",Sound')).toEqual([
      ["name", "notes"],
      ["Reed, Sam", "Sound"],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('name,notes\nSam,"line one\nline two"')).toEqual([
      ["name", "notes"],
      ["Sam", "line one\nline two"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('name\n"He said ""hi"""')).toEqual([["name"], ['He said "hi"']]);
  });

  it("handles CRLF endings and a trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a leading BOM so the first header is usable", () => {
    expect(parseCsv("﻿name,role\nSam,Sound")[0]).toEqual(["name", "role"]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a\n\n1\n")).toEqual([["a"], ["1"]]);
  });
});

describe("parseCsvRecords", () => {
  it("keys rows by normalised header", () => {
    const records = parseCsvRecords("Contact Name,E-mail\nSam Reed,sam@example.test");
    expect(records).toEqual([{ contactname: "Sam Reed", email: "sam@example.test" }]);
  });

  it("returns nothing when there is only a header", () => {
    expect(parseCsvRecords("name,role")).toEqual([]);
  });

  it("tolerates rows with missing trailing cells", () => {
    expect(parseCsvRecords("name,role,email\nSam,Sound")).toEqual([
      { name: "Sam", role: "Sound", email: "" },
    ]);
  });
});

describe("pickColumn", () => {
  const record = { number: "07700 900000", company: "Acme" };

  it("finds a value by any accepted alias", () => {
    expect(pickColumn(record, ["Phone", "Number"])).toBe("07700 900000");
  });

  it("returns undefined when no alias matches or all are empty", () => {
    expect(pickColumn(record, ["Email"])).toBeUndefined();
    expect(pickColumn({ email: "" }, ["Email"])).toBeUndefined();
  });
});

describe("batch", () => {
  it("splits into fixed-size chunks", () => {
    expect(batch([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns nothing for an empty list", () => {
    expect(batch([], 10)).toEqual([]);
  });
});
