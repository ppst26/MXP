import { useClientPagination } from "./use-client-pagination";
import { useClientSort } from "./use-client-sort";

export function useSortedPagination<T>(
  rows: T[],
  accessors: Record<string, (row: T) => unknown>,
  resetKey: string | number,
  defaultSortKey?: string,
) {
  const { sorted, sortKey, sortDir, requestSort } = useClientSort(rows, accessors, defaultSortKey);
  const paging = useClientPagination(sorted, resetKey);

  return {
    ...paging,
    sortKey,
    sortDir,
    requestSort,
  };
}
