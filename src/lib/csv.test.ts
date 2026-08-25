import { describe, expect, it } from "vitest";
import {
  batch,
  csvCell,
  matchHeaders,
  parseCsv,
  parseCsvRecords,
  parseCsvTable,
  pickColumn,
  toCsv,
} from "./csv";

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

describe("matchHeaders", () => {
  const specs = [
    { key: "dept", label: "Dept", aliases: ["Department", "Category"] },
    { key: "item", label: "Item", aliases: ["Equipment", "Name", "Description"] },
    { key: "serialNumber", label: "Serial number", aliases: ["Serial", "Serial No", "SN"] },
    { key: "weightKg", label: "Weight (kg)", aliases: ["Weight", "Kg"] },
    { key: "valueNew", label: "Value when new", aliases: ["New Value", "Purchase Price"] },
    { key: "valueCurrent", label: "Current value", aliases: ["Value", "Present Value"] },
  ];

  it("matches headings that are written exactly", () => {
    expect(matchHeaders(["Dept", "Item"], specs)).toMatchObject({
      dept: "dept",
      item: "item",
    });
  });

  it("ignores case, spacing and punctuation", () => {
    expect(matchHeaders(["  SERIAL_NO. ", "weight (KG)"], specs)).toMatchObject({
      serialNumber: "serialno",
      weightKg: "weightkg",
    });
  });

  it("matches a heading that only shares a word", () => {
    // The case that was dropping whole files: close, but not equal.
    expect(matchHeaders(["Item Name", "Dept Code"], specs)).toMatchObject({
      item: "itemname",
      dept: "deptcode",
    });
  });

  it("gives a heading to the field it fits best", () => {
    const matched = matchHeaders(["Value when new", "Current Value"], specs);
    expect(matched.valueNew).toBe("valuewhennew");
    expect(matched.valueCurrent).toBe("currentvalue");
  });

  it("never reads one heading as two fields", () => {
    const matched = matchHeaders(["Value"], specs);
    const used = Object.values(matched).filter(Boolean);
    expect(used).toEqual([...new Set(used)]);
  });

  it("leaves a field unmatched rather than guessing wildly", () => {
    expect(matchHeaders(["Quantity", "Colour"], specs).item).toBeUndefined();
  });

  it("does not match on a short coincidental overlap", () => {
    // "SN" appears inside "Consignment", which is not a serial number.
    expect(matchHeaders(["Consignment"], specs).serialNumber).toBeUndefined();
  });
});

describe("parseCsvTable", () => {
  it("keeps the headings as written alongside the records", () => {
    const table = parseCsvTable("Item Name,Dept\nFX9,Camera");
    expect(table.headers).toEqual(["Item Name", "Dept"]);
    expect(table.records).toEqual([{ itemname: "FX9", dept: "Camera" }]);
  });

  it("returns no records for a header-only file", () => {
    expect(parseCsvTable("Item,Dept").records).toEqual([]);
  });
});

describe("values containing a quote", () => {
  it("keeps an inch mark instead of swallowing the rest of the file", () => {
    // The bug this covers: a stray quote opened a quoted field, so every row
    // after it was absorbed into one cell and vanished without a warning.
    const csv = [
      "Dept,Item,Serial number",
      "Camera,Sony FX9,111",
      'Monitor,24" SmallHD,222',
      "Grip,Baby pin,333",
    ].join("\n");
    const table = parseCsvTable(csv);
    expect(table.records).toHaveLength(3);
    expect(table.records[1].item).toBe('24" SmallHD');
    expect(table.records[2]).toMatchObject({ dept: "Grip", item: "Baby pin" });
  });

  it("still honours a properly quoted field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("still honours a doubled quote inside a quoted field", () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', "b"]]);
  });

  it("keeps a quote inside an otherwise quoted field", () => {
    expect(parseCsv('"a 24" monitor",b')).toEqual([['a 24" monitor', "b"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('"one\ntwo",b')).toEqual([["one\ntwo", "b"]]);
  });
});

describe("parseCsvTable issues", () => {
  it("says nothing about a clean file", () => {
    expect(parseCsvTable("Item,Dept\nFX9,Camera").issues).toEqual([]);
  });

  it("warns when two columns share a heading, and keeps the first", () => {
    const table = parseCsvTable("Item,Item\nFX9,Tripod");
    expect(table.issues.join(" ")).toMatch(/headed the same/i);
    expect(table.records[0].item).toBe("FX9");
  });

  it("warns when a row has more values than there are columns", () => {
    const table = parseCsvTable("Item,Dept\nFX9,Camera,stray");
    expect(table.issues.join(" ")).toMatch(/more values than there are columns/i);
  });
});

describe("toCsv", () => {
  it("writes a header and rows", () => {
    expect(toCsv(["Item", "Dept"], [["FX9", "Camera"]])).toBe("Item,Dept\r\nFX9,Camera");
  });

  it("quotes only what needs quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("has,comma")).toBe('"has,comma"');
    expect(csvCell('has "quotes"')).toBe('"has ""quotes"""');
    expect(csvCell("has\nnewline")).toBe('"has\nnewline"');
  });

  it("writes nothing for a missing value", () => {
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
  });

  it("keeps numbers as numbers", () => {
    expect(csvCell(1200)).toBe("1200");
  });

  it("round-trips back through the parser", () => {
    // The point of the export is that it can be imported again.
    const csv = toCsv(
      ["Item", "Notes"],
      [
        ["Sony FX9", 'Body A, "spare" battery'],
        ["Tripod", "Sticks\nand head"],
      ],
    );
    const table = parseCsvTable(csv);
    expect(table.records).toEqual([
      { item: "Sony FX9", notes: 'Body A, "spare" battery' },
      { item: "Tripod", notes: "Sticks\nand head" },
    ]);
  });
});
