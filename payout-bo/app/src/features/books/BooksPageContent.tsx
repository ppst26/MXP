import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../mock/seed";
import { listMerchantBookRows } from "../../mock/query";
import { money } from "../../lib/money";
import { useFilters } from "../../state/FilterProvider";
import { Zone } from "@/components/metric-card";
import { SortableTh } from "@/components/sortable-table-head";
import { TablePagination } from "@/components/table-pagination";
import { useSortedPagination } from "@/hooks/use-sorted-pagination";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const bookAccessors = {
  name: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.name,
  role: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.role,
  operate: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.operate,
  pendingPayout: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.pendingPayout,
  parking: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.parking,
  freeze: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.freeze,
  balance: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.balance,
};

export function BooksPageContent() {
  const nav = useNavigate();
  const { setFilters, setPreset } = useFilters();
  const rows = useMemo(() => listMerchantBookRows(db).filter((r) => r.role === "DIRECT"), []);
  const {
    slice,
    page,
    pages,
    total,
    pageSize,
    setPage,
    setPageSize,
    sortKey,
    sortDir,
    requestSort,
  } = useSortedPagination(rows, bookAccessors, "books");

  const openShop = (merchantId: string, role: string) => {
    if (role !== "DIRECT") return;
    setPreset("d30");
    setFilters({ merchantId, listPage: 1 });
    nav("/payouts/overview");
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <h1 className="page-title">สมุดร้าน</h1>
        <p className="page-description">
          ยอดเสมือนต่อเทนแนนท์ คนละชั้นกับเงินในบัญชีจ่าย · ใช้ได้ + พัก + อายัด + กันถอน = ยอดร้าน · กดแถวร้านเพื่อดูภาพรวมร้านนั้น
        </p>
      </header>

      <Zone title="ยอดแยกประเภท">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          <table className="data-table relaxed">
            <thead>
              <tr>
                <SortableTh label="เทนแนนท์" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                <SortableTh label="บทบาท" sortKey="role" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                <SortableTh label="ใช้ได้" sortKey="operate" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                <SortableTh label="กันถอน" sortKey="pendingPayout" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                <SortableTh label="พัก" sortKey="parking" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                <SortableTh label="อายัด" sortKey="freeze" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                <SortableTh label="ยอดร้าน" sortKey="balance" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr
                  key={r.merchantId}
                  className={cn(r.role === "DIRECT" && "clickable")}
                  onClick={() => openShop(r.merchantId, r.role)}
                >
                  <td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.code}
                      {r.parentName ? ` · ${r.parentName}` : ""}
                    </div>
                  </td>
                  <td>
                    <Badge variant="outline">{r.role === "RESELLER" ? "ตัวแทน" : "ร้าน"}</Badge>
                  </td>
                  <td className={cn("num text-base font-semibold tabular-nums", r.operate <= 0 && "text-warning")}>
                    ฿ {money(r.operate)}
                  </td>
                  <td className="num text-base font-semibold tabular-nums">฿ {money(r.pendingPayout)}</td>
                  <td className="num text-base font-semibold tabular-nums text-muted-foreground">฿ {money(r.parking)}</td>
                  <td className={cn("num text-base font-semibold tabular-nums", r.freeze > 0 && "text-warning")}>
                    ฿ {money(r.freeze)}
                  </td>
                  <td className="num text-base font-semibold tabular-nums">฿ {money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={page}
          pages={pages}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        <p className="text-xs text-muted-foreground">
          กันถอน = ใบ PENDING / PROCESSING / NEEDS_REVIEW · อายัดไม่รวมกันถอน · ห้ามบวกรวมเป็นยอดบัญชีธนาคาร
        </p>
      </Zone>
    </div>
  );
}
