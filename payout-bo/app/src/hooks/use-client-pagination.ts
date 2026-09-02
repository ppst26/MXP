import { useEffect, useState } from "react";
import {
  DEFAULT_LIST_PAGE_SIZE,
  paginate,
  type ListPageSize,
} from "@/lib/pagination";

export function useClientPagination<T>(rows: T[], resetKey: string | number = rows.length) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ListPageSize>(DEFAULT_LIST_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const { slice, page: safePage, pages, total } = paginate(rows, page, pageSize);

  return {
    slice,
    page: safePage,
    pages,
    total,
    pageSize,
    setPage,
    setPageSize: (size: ListPageSize) => {
      setPageSize(size);
      setPage(1);
    },
  };
}
