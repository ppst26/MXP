import { useMemo, useState } from "react";
import { compareValues, type SortDir } from "@/lib/sort";

export function useClientSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => unknown>,
  defaultKey?: string,
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return rows;
    const get = accessors[sortKey];
    return [...rows].sort((a, b) => compareValues(get(a), get(b), sortDir));
  }, [rows, sortKey, sortDir, accessors]);

  const requestSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  return { sorted, sortKey, sortDir, requestSort };
}
