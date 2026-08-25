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
  const input = text.replace(/^\ufeff/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        const next = input[i + 1];
        if (next === '"') {
          cell += '"';
          i++;
        } else if (next === undefined || next === "," || next === "\n" || next === "\r") {
          // A closing quote is followed by the end of the field. Anything
          // else and this is a stray quote inside the value, so keep it
          // rather than ending the field early.
          inQuotes = false;
        } else {
          cell += '"';
        }
      } else {
        cell += char;
      }
      continue;
    }

    // A quote only opens a quoted field at the start of one. Anywhere else it
    // is a literal character — an inch mark in `24" monitor`, a foot mark in a
    // cable length. Treating those as opening a quoted field swallowed every
    // row after them into a single cell.
    if (char === '"' && cell.length === 0) {
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
  return parseCsvTable(text).records;
}

export type CsvTable = {
  /** Headings as written in the file, for matching against field names. */
  headers: string[];
  /** One record per data row, keyed by normalised heading. */
  records: Record<string, string>[];
  /**
   * Anything about the file worth saying out loud before importing it. Empty
   * for a clean file. These are the cases where rows or values used to go
   * missing without explanation.
   */
  issues: string[];
};

/** Like parseCsvRecords, but keeps the original headings and reports problems. */
export function parseCsvTable(text: string): CsvTable {
  const rows = parseCsv(text);
  if (rows.length < 2) return { headers: rows[0] ?? [], records: [], issues: [] };

  const headers = rows[0];
  const keys = headers.map(normaliseHeader);
  const issues: string[] = [];

  // A repeated heading used to overwrite the earlier column silently. Keep the
  // first and say which one is being ignored.
  const seen = new Set<string>();
  const duplicates: string[] = [];
  keys.forEach((key, i) => {
    if (key.length === 0) return;
    if (seen.has(key)) duplicates.push(headers[i]);
    else seen.add(key);
  });
  if (duplicates.length > 0) {
    issues.push(
      `Two columns are headed the same thing (${[...new Set(duplicates)].join(", ")}). Only the first of each is read.`,
    );
  }

  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, i) => {
      if (key.length === 0) return;
      if (record[key] !== undefined) return;
      record[key] = (cells[i] ?? "").trim();
    });
    return record;
  });

  // More values than headings means the file does not line up — usually an
  // unescaped comma or quote — and the surplus has nowhere to go.
  const ragged = rows.slice(1).filter((cells) => cells.length > headers.length).length;
  if (ragged > 0) {
    issues.push(
      `${ragged} row${ragged === 1 ? " has" : "s have"} more values than there are columns, so the extra values are ignored. Check for a stray comma or quote.`,
    );
  }

  return { headers, records, issues };
}

/** Words of a heading, for comparing "Value when new" with "New value (£)". */
function tokens(header: string): string[] {
  return header
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export type ColumnMatchSpec = { key: string; label: string; aliases?: string[] };

/**
 * How well a CSV heading fits one of a field's accepted names, from 0 (not at
 * all) to 1. Anything at or above MATCH_THRESHOLD is taken as the same column.
 *
 * Three ways of being the same thing, in descending confidence: the same name
 * ignoring case and punctuation; sharing words, scored by how much of the
 * longer name is shared; and one name containing the other, which catches the
 * headings that run words together.
 */
function headingScore(header: string, candidate: string): number {
  const h = normaliseHeader(header);
  const c = normaliseHeader(candidate);
  if (h.length === 0 || c.length === 0) return 0;
  if (h === c) return 1;

  const hWords = tokens(header);
  const cWords = tokens(candidate);
  const shared = hWords.filter((word) => cWords.includes(word)).length;
  if (shared > 0) {
    return 0.5 + 0.4 * (shared / Math.max(hWords.length, cWords.length));
  }

  // Long enough that the overlap means something: "sn" inside "consignment"
  // is a coincidence, "serial" inside "serialnumber" is not.
  const shorter = Math.min(h.length, c.length);
  if (shorter >= 4 && (h.includes(c) || c.includes(h))) return 0.45;

  return 0;
}

const MATCH_THRESHOLD = 0.4;

/**
 * Works out which column of a file feeds each field, returning the normalised
 * heading to read for each one.
 *
 * Headings in the wild are close to what we ask for rather than equal to it —
 * "Item Name" for Item, "Current Value (£)" for Current value — and demanding
 * an exact match silently dropped every row of an otherwise fine file. Matches
 * are scored and taken best-first, so a heading goes to the field it fits
 * best; each heading is used once, so "Value when new" cannot also be read as
 * "Current value".
 */
export function matchHeaders(
  headers: string[],
  specs: ColumnMatchSpec[],
): Record<string, string | undefined> {
  const scored: { key: string; header: string; score: number }[] = [];
  for (const spec of specs) {
    for (const header of headers) {
      const score = Math.max(
        ...[spec.label, ...(spec.aliases ?? [])].map((name) => headingScore(header, name)),
      );
      if (score >= MATCH_THRESHOLD) scored.push({ key: spec.key, header, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const result: Record<string, string | undefined> = {};
  const claimed = new Set<string>();
  for (const match of scored) {
    const header = normaliseHeader(match.header);
    if (result[match.key] !== undefined || claimed.has(header)) continue;
    result[match.key] = header;
    claimed.add(header);
  }
  return result;
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

/**
 * One CSV cell, quoted only when it has to be.
 *
 * A value containing a comma, quote or newline must be quoted or the file
 * cannot be read back — which matters here because these exports are meant to
 * go straight back into the importer.
 */
export function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A whole CSV file from a header row and its data rows. */
export function toCsv(headers: string[], rows: (string | number | undefined | null)[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
