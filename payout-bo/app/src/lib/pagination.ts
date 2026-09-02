export const LIST_PAGE_SIZES = [20, 50, 100] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number];

export const DEFAULT_LIST_PAGE_SIZE: ListPageSize = 20;

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const slice = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { slice, page: safePage, pages, total: rows.length };
}

/** เลขหน้าที่จะแสดงเป็นปุ่ม (สูงสุด 7 ปุ่ม โฟกัสรอบหน้าปัจจุบัน) */
export function visiblePageNumbers(page: number, pages: number): number[] {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const start = Math.max(1, Math.min(page - 3, pages - 6));
  return Array.from({ length: 7 }, (_, i) => start + i);
}
