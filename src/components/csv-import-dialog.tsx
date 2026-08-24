"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { batch, matchHeaders, parseCsvTable, type CsvTable } from "@/lib/csv";

/** One target field and the CSV column headings that map onto it. */
export type CsvColumnSpec = {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
};

export type ImportOutcome = { created: number; updated: number; skipped: number };

// Matches the row cap on the import mutations.
const BATCH_SIZE = 200;

type MappedRow = Record<string, string | undefined>;

export function CsvImportDialog({
  title,
  description,
  columns,
  exampleHeader,
  onImportBatch,
  onClose,
}: {
  title: string;
  description: string;
  columns: CsvColumnSpec[];
  exampleHeader: string;
  onImportBatch: (rows: MappedRow[]) => Promise<ImportOutcome>;
  onClose: () => void;
}) {
  const [table, setTable] = useState<CsvTable | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Values typed in the review panel, and rows the user has chosen to drop,
  // both keyed by position in the file.
  const [overrides, setOverrides] = useState<Record<number, Record<string, string>>>({});
  const [dropped, setDropped] = useState<number[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const requiredColumns = columns.filter((c) => c.required);
  const requiredKeys = requiredColumns.map((c) => c.key);

  const matched = useMemo(
    () => (table ? matchHeaders(table.headers, columns) : {}),
    [table, columns],
  );

  const baseRows = useMemo<MappedRow[]>(() => {
    if (!table) return [];
    return table.records.map((record) => {
      const row: MappedRow = {};
      for (const column of columns) {
        const header = matched[column.key];
        row[column.key] = header ? record[header] || undefined : undefined;
      }
      return row;
    });
  }, [table, columns, matched]);

  /**
   * What a blocked row probably meant for a required field: the first thing in
   * it that no column claimed. A file whose item column is headed something
   * unrecognisable still has the item names sitting in it.
   */
  const suggestions = useMemo(() => {
    if (!table) return [];
    const claimed = new Set(Object.values(matched).filter(Boolean) as string[]);
    return table.records.map((record) => {
      const spare = Object.entries(record).find(
        ([header, value]) => !claimed.has(header) && value.trim().length > 0,
      );
      const anything = Object.values(record).find((value) => value.trim().length > 0);
      return (spare?.[1] ?? anything ?? "").trim();
    });
  }, [table, matched]);

  const rows = useMemo(
    () => baseRows.map((row, i) => ({ ...row, ...(overrides[i] ?? {}) })),
    [baseRows, overrides],
  );

  function isReady(row: MappedRow) {
    return requiredKeys.every((key) => (row[key] ?? "").trim().length > 0);
  }

  const readyIndexes = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => !dropped.includes(i) && isReady(row))
    .map(({ i }) => i);
  const blockedIndexes = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => !dropped.includes(i) && !isReady(row))
    .map(({ i }) => i);

  const missingLabel = requiredColumns.map((c) => c.label.toLowerCase()).join(" or ");
  const unmatchedFields = columns.filter((c) => matched[c.key] === undefined);

  function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    setOverrides({});
    setDropped([]);
    setReviewing(false);
    file
      .text()
      .then((text) => {
        const parsed = parseCsvTable(text);
        if (parsed.records.length === 0) {
          setTable(null);
          setParseError("No data rows found. The first line should be column headings.");
          return;
        }
        setTable(parsed);
      })
      .catch((err: unknown) => {
        setTable(null);
        setParseError(err instanceof Error ? err.message : "Could not read that file.");
      });
  }

  function setOverride(index: number, key: string, value: string) {
    setOverrides((current) => ({ ...current, [index]: { ...current[index], [key]: value } }));
  }

  /** Fills every blocked row's missing required fields from its suggestion. */
  function useAllSuggestions() {
    setOverrides((current) => {
      const next = { ...current };
      for (const i of blockedIndexes) {
        const suggestion = suggestions[i];
        if (!suggestion) continue;
        const row = { ...baseRows[i], ...next[i] };
        const patch = { ...next[i] };
        for (const key of requiredKeys) {
          if ((row[key] ?? "").trim().length === 0) patch[key] = suggestion;
        }
        next[i] = patch;
      }
      return next;
    });
  }

  async function handleImport() {
    if (readyIndexes.length === 0) return;
    setImporting(true);
    try {
      const totals: ImportOutcome = { created: 0, updated: 0, skipped: 0 };
      // Sent in batches so a large file stays inside the mutation's row cap.
      for (const chunk of batch(readyIndexes.map((i) => rows[i]), BATCH_SIZE)) {
        const result = await onImportBatch(chunk);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
      }
      const parts = [`${totals.created} added`];
      if (totals.updated > 0) parts.push(`${totals.updated} updated`);
      const left = totals.skipped + blockedIndexes.length + dropped.length;
      if (left > 0) parts.push(`${left} not imported`);
      toast.success(`Import finished: ${parts.join(", ")}.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[88vh] w-[92vw] max-w-3xl overflow-y-auto sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">{description}</p>

          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium">Expected columns</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{exampleHeader}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Headings are matched loosely — case, spaces and punctuation are ignored, and a
              heading that is close enough still counts, so &ldquo;Item Name&rdquo; feeds Item.
              Extra columns are ignored.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}

          {table !== null && (
            <div className="min-w-0 space-y-3">
              <p className="break-words text-sm">
                <span className="font-medium">{readyIndexes.length}</span> row
                {readyIndexes.length === 1 ? "" : "s"} ready to import from{" "}
                <span className="font-medium">{fileName}</span>
                {dropped.length > 0 && (
                  <span className="text-muted-foreground"> · {dropped.length} skipped</span>
                )}
              </p>

              {unmatchedFields.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  No column found for{" "}
                  {unmatchedFields.map((c) => c.label.toLowerCase()).join(", ")} — those stay
                  blank and can be filled in afterwards.
                </p>
              )}

              {/* Nothing is dropped quietly: a blocked row is reported, shown,
                  and importable once its missing field has something in it. */}
              {blockedIndexes.length > 0 && (
                <div className="space-y-3 rounded-md border border-amber-400/50 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                      <span className="font-medium">{blockedIndexes.length}</span> row
                      {blockedIndexes.length === 1 ? " has" : "s have"} no {missingLabel}.
                      They will not be imported as they are.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setReviewing((r) => !r)}>
                        {reviewing ? "Hide" : "Review"}
                      </Button>
                      <Button size="sm" onClick={useAllSuggestions}>
                        Add anyway
                      </Button>
                    </div>
                  </div>

                  {reviewing && (
                    <ul className="max-h-64 space-y-2 overflow-y-auto">
                      {blockedIndexes.map((i) => (
                        <li
                          key={i}
                          className="min-w-0 rounded-md border border-border bg-background p-2"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted-foreground">
                              Row {i + 2}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDropped((d) => [...d, i])}
                            >
                              Skip
                            </Button>
                          </div>
                          <p className="truncate text-xs text-muted-foreground" title={rowSummary(table, i)}>
                            {rowSummary(table, i) || "Empty row"}
                          </p>
                          <div className="mt-2 space-y-2">
                            {requiredColumns
                              .filter((c) => (rows[i][c.key] ?? "").trim().length === 0)
                              .map((c) => (
                                <div key={c.key} className="flex items-center gap-2">
                                  <span className="w-20 shrink-0 text-xs text-muted-foreground">
                                    {c.label}
                                  </span>
                                  <Input
                                    value={overrides[i]?.[c.key] ?? ""}
                                    placeholder={suggestions[i] || `Type a ${c.label.toLowerCase()}`}
                                    onChange={(e) => setOverride(i, c.key, e.target.value)}
                                  />
                                </div>
                              ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="text-xs text-amber-900/80 dark:text-amber-200/70">
                    &ldquo;Add anyway&rdquo; fills each one from the first unused value in its
                    row. Everything imported can be edited afterwards.
                  </p>
                </div>
              )}

              {readyIndexes.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  {/* table-fixed: cells share the width evenly and truncate.
                      Auto layout ignores a max-width on a cell and lets long
                      values push the table past the dialog. */}
                  <table className="w-full table-fixed text-left text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {columns.map((column) => (
                          <th key={column.key} className="truncate px-2 py-1.5 font-medium">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {readyIndexes.slice(0, 5).map((i) => (
                        <tr key={i} className="border-t border-border">
                          {columns.map((column) => (
                            <td key={column.key} className="px-2 py-1.5 text-muted-foreground">
                              <span className="block truncate" title={rows[i][column.key] ?? ""}>
                                {rows[i][column.key] ?? "·"}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {readyIndexes.length > 5 && (
                    <p className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
                      … and {readyIndexes.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing || readyIndexes.length === 0}>
            {importing ? "Importing…" : `Import ${readyIndexes.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The row as it appears in the file, so a blocked row can be recognised. */
function rowSummary(table: CsvTable, index: number): string {
  return Object.values(table.records[index] ?? {})
    .filter((value) => value.trim().length > 0)
    .join(" · ");
}
