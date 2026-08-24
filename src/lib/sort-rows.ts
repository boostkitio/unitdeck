export type SortDir = "asc" | "desc";
export type Sort<K extends string> = { key: K; dir: SortDir };

/**
 * Sorts rows by the active column.
 *
 * Empty cells always sit at the bottom, whichever direction the column is
 * sorted — otherwise reversing a column fills the top of the table with
 * blanks. Ties keep their original order, because Array.prototype.sort is
 * stable, so a second column's ordering survives underneath the first.
 */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: Sort<K>,
  value: (row: T, key: K) => string | number | null,
): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va === null || vb === null) {
      if (va === null && vb === null) return 0;
      return va === null ? 1 : -1;
    }
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}
