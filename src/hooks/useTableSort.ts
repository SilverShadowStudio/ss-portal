import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortColumnType = "text" | "number" | "date";

export interface SortableColumn<T> {
  id: string;
  accessor: (row: T) => string | number | null | undefined;
  type: SortColumnType;
  /**
   * How empty values sort.
   *
   * "pinned" (default) keeps them out of the way — a half-filled column
   * shouldn't dominate the table.
   *
   * "lowest" treats an empty value as the smallest one, so it sits beside the
   * oldest date or the smallest number and flips with the sort direction like
   * any real value. Use it where "no date" means overdue rather than distant —
   * a lead with no next action is the most neglected, not the least urgent.
   */
  nulls?: "pinned" | "lowest";
}

/**
 * Column-header sort for the finance tables. Click a header to sort asc;
 * click again to flip to desc. Filters run in the parent — this hook only
 * sorts what it receives.
 *
 * Null / undefined / empty-string values always sink to the end regardless
 * of direction (a partially-populated column shouldn't dominate the top).
 */
export function useTableSort<T>(
  rows: T[],
  columns: SortableColumn<T>[],
  defaults?: { key: string; dir: SortDir },
) {
  const [sortKey, setSortKey] = useState<string | null>(defaults?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaults?.dir ?? "asc");

  function toggle(id: string) {
    if (sortKey === id) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(id);
      setSortDir("asc");
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.id === sortKey);
    if (!col) return rows;
    const dirMul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      const aNull = av == null || av === "";
      const bNull = bv == null || bv === "";
      if (aNull || bNull) {
        if (aNull && bNull) return 0;
        // Sort as the smallest value — so it moves with the direction and
        // lands next to the oldest entries at both ends.
        if (col.nulls === "lowest") return (aNull ? -1 : 1) * dirMul;
        return aNull ? 1 : -1;
      }
      return compare(av, bv, col.type) * dirMul;
    });
  }, [rows, sortKey, sortDir, columns]);

  return { sortedRows, sortKey, sortDir, toggle };
}

function compare(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  type: SortColumnType,
): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls at the end regardless of direction
  if (bNull) return -1;

  if (type === "number") {
    return Number(a) - Number(b);
  }
  if (type === "date") {
    const ad = new Date(String(a)).getTime();
    const bd = new Date(String(b)).getTime();
    if (isNaN(ad) && isNaN(bd)) return 0;
    if (isNaN(ad)) return 1;
    if (isNaN(bd)) return -1;
    return ad - bd;
  }
  // text — locale-aware, case-insensitive
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}
