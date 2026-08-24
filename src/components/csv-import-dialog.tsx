"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { batch, parseCsvRecords, pickColumn } from "@/lib/csv";

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
  const [rows, setRows] = useState<MappedRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);
  const usableRows = rows?.filter((row) => requiredKeys.every((key) => row[key])) ?? [];
  const unusableCount = (rows?.length ?? 0) - usableRows.length;

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    try {
      const records = parseCsvRecords(await file.text());
      if (records.length === 0) {
        setRows(null);
        setParseError("No data rows found. The first line should be column headings.");
        return;
      }
      setRows(
        records.map((record) => {
          const mapped: MappedRow = {};
          for (const column of columns) {
            mapped[column.key] = pickColumn(record, [column.label, ...column.aliases]);
          }
          return mapped;
        }),
      );
    } catch (err) {
      setRows(null);
      setParseError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function handleImport() {
    if (usableRows.length === 0) return;
    setImporting(true);
    try {
      const totals: ImportOutcome = { created: 0, updated: 0, skipped: 0 };
      // Sent in batches so a large file stays inside the mutation's row cap.
      for (const chunk of batch(usableRows, BATCH_SIZE)) {
        const result = await onImportBatch(chunk);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
      }
      const parts = [`${totals.created} added`];
      if (totals.updated > 0) parts.push(`${totals.updated} updated`);
      const skipped = totals.skipped + unusableCount;
      if (skipped > 0) parts.push(`${skipped} skipped`);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">{description}</p>

          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium">Expected columns</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{exampleHeader}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Headings are matched loosely — case, spaces and punctuation are ignored, and
              common alternatives are accepted. Extra columns are ignored.
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
                if (file) void handleFile(file);
              }}
            />
          </div>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}

          {rows !== null && (
            <div className="min-w-0 space-y-2">
              <p className="break-words text-sm">
                <span className="font-medium">{usableRows.length}</span> row
                {usableRows.length === 1 ? "" : "s"} ready to import from{" "}
                <span className="font-medium">{fileName}</span>
                {unusableCount > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {unusableCount} skipped for a missing{" "}
                    {columns
                      .filter((c) => c.required)
                      .map((c) => c.label.toLowerCase())
                      .join(" or ")}
                  </span>
                )}
              </p>

              {usableRows.length > 0 && (
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
                      {usableRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-border">
                          {columns.map((column) => (
                            <td key={column.key} className="px-2 py-1.5 text-muted-foreground">
                              <span className="block truncate" title={row[column.key] ?? ""}>
                                {row[column.key] ?? "·"}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {usableRows.length > 5 && (
                    <p className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
                      … and {usableRows.length - 5} more
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
          <Button onClick={handleImport} disabled={importing || usableRows.length === 0}>
            {importing ? "Importing…" : `Import ${usableRows.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
