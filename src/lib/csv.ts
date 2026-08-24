/**
 * Splits CSV text into rows of cells.
 *
 * Handles the cases a spreadsheet export actually produces: quoted fields
 * containing commas or newlines, and doubled quotes ("") as a literal quote.
 * Accepts CRLF or LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
  // part of the first header name.
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      // Consume the LF of a CRLF pair as part of the same break.
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  // Whatever is buffered at EOF is a final cell unless the file ended on a
  // line break, in which case there is nothing left to flush.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** "Contact Name" / "contact_name" / "contactname" all collapse to the same key. */
function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parses CSV text using its first row as the header, returning one record per
 * remaining row keyed by normalised header name. Returns an empty array when
 * there is no data beyond the header.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header.length === 0) return;
      record[header] = (cells[i] ?? "").trim();
    });
    return record;
  });
}

/**
 * First non-empty value among the given column aliases, or undefined.
 * Lets an import accept "Number", "Phone" or "Telephone" for one field.
 */
export function pickColumn(
  record: Record<string, string>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const value = record[normaliseHeader(alias)];
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

/** Splits a list into fixed-size batches, for import mutations with row caps. */
export function batch<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
