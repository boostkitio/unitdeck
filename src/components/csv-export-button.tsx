"use client";

import { Button } from "@/components/ui/button";
import { toCsv } from "@/lib/csv";

/**
 * Downloads a list as CSV.
 *
 * The columns are the ones the matching importer accepts, so a file exported
 * here can be edited in a spreadsheet and brought straight back in — which is
 * the point of having both.
 */
export function CsvExportButton({
  filename,
  headers,
  rows,
  disabled,
}: {
  /** Without the extension; the date is appended so files do not overwrite. */
  filename: string;
  headers: string[];
  rows: (string | number | undefined | null)[][];
  disabled?: boolean;
}) {
  function download() {
    const csv = toCsv(headers, rows);
    // A BOM so Excel reads it as UTF-8 rather than mangling accented names.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={download}
      disabled={disabled || rows.length === 0}
    >
      Export CSV
    </Button>
  );
}
