import { useMemo, useState } from "react";
import type { MerchantWatchRow } from "../../mock/types";
import { money } from "../../lib/money";
import { SortableTh } from "@/components/sortable-table-head";
import { TablePagination } from "@/components/table-pagination";
import { useSortedPagination } from "@/hooks/use-sorted-pagination";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RiskTone = "ok" | "warn" | "alert";

function riskTone(score: number): RiskTone {
  if (score >= 70) return "alert";
  if (score >= 35) return "warn";
  return "ok";
}

function rowStatus(row: MerchantWatchRow): { label: string; tone: RiskTone } {
  if (row.review > 0) return { label: "ต้องตรวจสอบ", tone: "alert" };
  if (row.pending > 0 || row.failed > 0 || (row.oldestMin != null && row.oldestMin >= 30)) {
    return { label: "มีคิวค้าง", tone: "warn" };
  }
  return { label: "ปกติ", tone: "ok" };
}

function StatusDot({ tone }: { tone: RiskTone }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "ok" && "bg-success",
        tone === "warn" && "bg-warning",
        tone === "alert" && "bg-destructive",
      )}
    />
  );
}

function RiskMeter({ score }: { score: number }) {
  const capped = Math.min(100, score);
  const tone = riskTone(capped);
  return (
    <span className="type-label inline-flex items-center gap-1.5">
      <span className="relative inline-flex h-1 w-[52px] overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            tone === "ok" && "bg-success",
            tone === "warn" && "bg-warning",
            tone === "alert" && "bg-destructive",
          )}
          style={{ width: `${capped}%` }}
        />
      </span>
      <span className="tabular-nums text-foreground">{capped}</span>
    </span>
  );
}

function NumCell({ value, tone }: { value: number; tone?: "default" | "warn" | "alert" }) {
  return (
    <span
      className={cn(
        "text-base font-semibold tabular-nums",
        tone === "warn" && value > 0 && "text-warning",
        tone === "alert" && value > 0 && "text-destructive",
      )}
    >
      {value}
    </span>
  );
}

const watchAccessors = {
  name: (x: MerchantWatchRow) => x.name,
  completedAmount: (x: MerchantWatchRow) => x.completedAmount,
  failed: (x: MerchantWatchRow) => x.failed,
  review: (x: MerchantWatchRow) => x.review,
  pending: (x: MerchantWatchRow) => x.pending,
  held: (x: MerchantWatchRow) => x.held,
  oldestMin: (x: MerchantWatchRow) => x.oldestMin ?? -1,
  alertScore: (x: MerchantWatchRow) => x.alertScore,
  status: (x: MerchantWatchRow) => rowStatus(x).label,
};

export function MerchantWatch({
  rows,
  onPick,
}: {
  rows: MerchantWatchRow[] | null;
  onPick: (merchantId: string) => void;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((x) => x.name.toLowerCase().includes(needle) || x.code.toLowerCase().includes(needle));
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
  } = useSortedPagination(filtered, watchAccessors, `watch-${q}`);

  if (rows === null) {
    return (
      <Card size="sm">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground">ซ่อนตารางร้านที่ต้องดู เพราะกรองเหลือร้านเดียว — ดูการ์ดด้านบน</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm" className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>ร้านค้าที่ต้องติดตาม</CardTitle>
          <CardDescription>เรียงตามความเร่งด่วนจากคิวที่กำลังดำเนินการ · เจ้าของระบบเท่านั้น</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาร้านค้า"
            className="type-label h-7 w-[190px]"
          />
          <Button type="button" variant="outline" size="sm" className="type-label h-7" onClick={() => onPick("")}>
            ดูทั้งหมด
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="data-table w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <SortableTh label="ร้าน" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="px-4 py-2 text-left" />
                <SortableTh label="สำเร็จช่วงนี้" sortKey="completedAmount" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num px-4 py-2" />
                <SortableTh label="ล้ม" sortKey="failed" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num px-4 py-2" />
                <SortableTh label="รอคนดู" sortKey="review" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num px-4 py-2" />
                <SortableTh label="รอส่ง" sortKey="pending" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num px-4 py-2" />
                <SortableTh label="กันไว้" sortKey="held" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num px-4 py-2" />
                <SortableTh label="เก่าสุด" sortKey="oldestMin" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num px-4 py-2" />
                <SortableTh label="ความเสี่ยง" sortKey="alertScore" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="px-4 py-2" />
                <SortableTh label="สถานะ" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {slice.map((x) => {
                const status = rowStatus(x);
                return (
                  <tr key={x.id} className="hover" onClick={() => onPick(x.id)}>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-foreground">{x.name}</span>
                      <span className="type-micro block">{x.code}</span>
                    </td>
                    <td className="num px-4 py-3 align-top">
                      <span className="block text-base font-semibold tabular-nums text-foreground">{money(x.completedAmount)}</span>
                      <span className="type-micro block">{x.completedCount} รายการ</span>
                    </td>
                    <td className="num px-4 py-3 align-top">
                      <NumCell value={x.failed} tone="alert" />
                    </td>
                    <td className="num px-4 py-3 align-top">
                      <NumCell value={x.review} tone="alert" />
                    </td>
                    <td className="num px-4 py-3 align-top">
                      <NumCell value={x.pending} tone="warn" />
                    </td>
                    <td className="num px-4 py-3 align-top tabular-nums">{x.held > 0 ? money(x.held) : "—"}</td>
                    <td className="num px-4 py-3 align-top tabular-nums text-foreground">{x.oldestMin != null ? `${x.oldestMin} น.` : "—"}</td>
                    <td className="px-4 py-3 align-top">
                      <RiskMeter score={x.alertScore} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="type-label inline-flex items-center gap-1.5">
                        <StatusDot tone={status.tone} />
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-4 py-3">
          <TablePagination
            page={page}
            pages={pages}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
        <p className="type-label border-t border-border px-4 py-2">
          คลิกแถวกรองร้านนี้บนภาพรวม · ไม่ใช่จอร้าน · สูงสุด 8 แถว
        </p>
      </CardContent>
    </Card>
  );
}
