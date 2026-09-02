import { useMemo, useState } from "react";
import { db, MERCHANTS } from "../../mock/seed";
import { listPayoutRates } from "../../mock/query";
import { money, pct } from "../../lib/money";
import { Zone, MetricCard } from "@/components/metric-card";
import { SortableTh } from "@/components/sortable-table-head";
import { TablePagination } from "@/components/table-pagination";
import { useSortedPagination } from "@/hooks/use-sorted-pagination";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Percent } from "lucide-react";

const iconProps = { strokeWidth: 1.8 } as const;

const rateAccessors = {
  name: (r: ReturnType<typeof listPayoutRates>[number]) => r.name,
  rate: (r: ReturnType<typeof listPayoutRates>[number]) => r.rate,
  parentRate: (r: ReturnType<typeof listPayoutRates>[number]) => r.parentRate ?? -1,
  mdrSum: (r: ReturnType<typeof listPayoutRates>[number]) => r.mdrSum,
};

export function RatesPageContent() {
  const [q, setQ] = useState("");
  const rows = useMemo(() => listPayoutRates(MERCHANTS, db.payouts), []);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.name} ${r.code} ${r.parentName ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q]);
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
  } = useSortedPagination(filtered, rateAccessors, `rates-${q}`);
  const lines = new Set(rows.map((r) => r.parentId).filter(Boolean)).size;
  const totalMdr = rows.reduce((s, r) => s + r.mdrSum, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <h1 className="page-title">อัตราถอน</h1>
        <p className="page-description">
          เรตสัญญาของร้าน · ยังไม่แสดงเรตตัวแทน · ยอด MDR คือ SUM(reserved_fee) จากทุกใบโอนของร้าน · ไม่บวกค่าโอนธนาคาร
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <MetricCard icon={<Percent {...iconProps} />} label="สายงาน" value={String(lines)} hint="สายที่ร้านสังกัด" />
        <MetricCard icon={<Percent {...iconProps} />} label="ร้าน" value={String(rows.length)} hint="เรตที่หักจากร้าน" />
        <MetricCard
          icon={<Percent {...iconProps} />}
          label="รวม MDR"
          value={money(totalMdr)}
          hint="SUM(reserved_fee) ทุกใบ · ไม่รวมค่าโอนธนาคาร"
        />
      </div>

      <Zone title="เรตตามร้าน">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาร้าน / รหัส / สาย"
          className="max-w-sm"
        />
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          {filtered.length ? (
            <table className="data-table relaxed">
              <thead>
                <tr>
                  <SortableTh label="ร้าน" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <th>บทบาท</th>
                  <SortableTh label="เรตถอน" sortKey="rate" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                  <SortableTh label="ต้นทุนสาย" sortKey="parentRate" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                  <SortableTh label="ยอด MDR" sortKey="mdrSum" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.code}</div>
                    </td>
                    <td>
                      <Badge variant="outline">ร้าน</Badge>
                    </td>
                    <td className="num text-base font-semibold tabular-nums">{pct(r.rate)}</td>
                    <td className="num tabular-nums text-muted-foreground">
                      {r.parentRate == null ? "—" : pct(r.parentRate)}
                    </td>
                    <td className="num text-base font-semibold tabular-nums">{money(r.mdrSum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบร้านตามคำค้น</p>
          )}
        </div>
        {filtered.length > 0 ? (
          <TablePagination
            page={page}
            pages={pages}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        ) : null}
        <p className="text-xs text-muted-foreground">
          ค่าบริการต่อใบ = ยอด × เรตถอนของร้าน เก็บใน reserved_fee · ยอด MDR = ผลรวมทุกใบของร้านนั้น · ไม่บวก bank_fee
        </p>
      </Zone>
    </div>
  );
}
