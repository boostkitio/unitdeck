"use client";

import { useCallback, useState } from "react";
import { TableHead } from "@/components/ui/table";
import type { Sort } from "@/lib/sort-rows";
import { cn } from "@/lib/utils";

export type { Sort, SortDir } from "@/lib/sort-rows";
export { sortRows } from "@/lib/sort-rows";

/** Column sort state: clicking the active column flips it, a new one starts ascending. */
export function useTableSort<K extends string>(initial: Sort<K>) {
  const [sort, setSort] = useState<Sort<K>>(initial);
  const toggle = useCallback((key: K) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);
  return { sort, toggle };
}

export function SortableHead<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: Sort<K>;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <span aria-hidden className={cn("text-xs", active ? "opacity-100" : "opacity-30")}>
          {active && sort.dir === "desc" ? "↓" : "↑"}
        </span>
      </button>
    </TableHead>
  );
}
