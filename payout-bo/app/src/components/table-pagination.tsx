import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LIST_PAGE_SIZES, visiblePageNumbers, type ListPageSize } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type Props = {
  page: number;
  pages: number;
  pageSize: ListPageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: ListPageSize) => void;
};

export function TablePagination({
  page,
  pages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const pageNums = visiblePageNumbers(page, pages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="type-label shrink-0">แถว</Label>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v) as ListPageSize)}
        >
          <SelectTrigger size="sm" className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LIST_PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="type-label hidden sm:inline">· พบ {total.toLocaleString("th-TH")} แถว</span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
        >
          หน้าแรก
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-8 px-2"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="หน้าก่อน"
        >
          &lt;
        </Button>
        {pageNums.map((n) => (
          <Button
            key={n}
            type="button"
            variant={n === page ? "default" : "outline"}
            size="sm"
            className={cn("min-w-8 px-2 tabular-nums", n === page && "pointer-events-none")}
            onClick={() => onPageChange(n)}
            aria-current={n === page ? "page" : undefined}
          >
            {n}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-8 px-2"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label="หน้าถัดไป"
        >
          &gt;
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(pages)}
        >
          หน้าสุดท้าย
        </Button>
      </div>
    </div>
  );
}
