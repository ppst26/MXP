import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../mock/seed";
import { listPayoutRecon } from "../../mock/query";
import { money, money4 } from "../../lib/money";
import { fmtDT } from "../../lib/bangkok";
import { StatusPill } from "../../lib/StatusPill";
import { Zone, MetricCard } from "@/components/metric-card";
import { SortableTh } from "@/components/sortable-table-head";
import { TablePagination } from "@/components/table-pagination";
import { useSortedPagination } from "@/hooks/use-sorted-pagination";
import { Badge } from "@/components/ui/badge";
import { GitCompare } from "lucide-react";

const iconProps = { strokeWidth: 1.8 } as const;

const reconAccessors = {
  match: (r: ReturnType<typeof listPayoutRecon>[number]) => r.match,
  confirmedAt: (r: ReturnType<typeof listPayoutRecon>[number]) => r.confirmedAt?.getTime() ?? 0,
  merchantName: (r: ReturnType<typeof listPayoutRecon>[number]) => r.merchantName,
  referenceId: (r: ReturnType<typeof listPayoutRecon>[number]) => r.referenceId,
  amount: (r: ReturnType<typeof listPayoutRecon>[number]) => r.amount,
  bankFee: (r: ReturnType<typeof listPayoutRecon>[number]) => r.bankFee,
  status: (r: ReturnType<typeof listPayoutRecon>[number]) => r.status,
  bankOrderId: (r: ReturnType<typeof listPayoutRecon>[number]) => r.bankOrderId ?? "",
  note: (r: ReturnType<typeof listPayoutRecon>[number]) => r.note,
};

export function ReconPageContent() {
  const nav = useNavigate();
  const rows = useMemo(() => listPayoutRecon(db), []);
  const gaps = rows.filter((r) => r.match === "discrepancy");
  const matched = rows.filter((r) => r.match === "matched");
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
  } = useSortedPagination(rows, reconAccessors, "recon");

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <h1 className="page-title">กระทบยอดขาออก</h1>
        <p className="page-description">
          เทียบเดบิตที่ธนาคารตัดแล้วกับใบถอนในเกตเวย์ · ไม่ใช่จับคู่ฝาก · เฟสนี้ใช้ใบที่มี confirmed หรือค่าโอนจริง
          ไม่ดึงสเตตเมนต์ดิบ
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <MetricCard icon={<GitCompare {...iconProps} />} label="ผลต่าง" value={String(gaps.length)} tone={gaps.length ? "alert" : undefined} />
        <MetricCard icon={<GitCompare {...iconProps} />} label="ตรงกัน" value={String(matched.length)} />
        <MetricCard
          icon={<GitCompare {...iconProps} />}
          label="ค่าโอนในผลต่าง"
          value={`฿ ${money(gaps.reduce((s, r) => s + r.bankFee, 0))}`}
          hint="ต้นทุนบ้าน — ห้ามบวกกับค่าบริการร้าน"
        />
      </div>

      <Zone title="รายการเทียบ">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          {rows.length ? (
            <table className="data-table relaxed">
              <thead>
                <tr>
                  <SortableTh label="ผล" sortKey="match" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <SortableTh label="เวลา" sortKey="confirmedAt" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <SortableTh label="ร้าน" sortKey="merchantName" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <SortableTh label="ใบถอน" sortKey="referenceId" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <SortableTh label="ยอดโอน" sortKey="amount" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                  <SortableTh label="ค่าโอน" sortKey="bankFee" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                  <SortableTh label="สถานะใบ" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <SortableTh label="เลขออเดอร์" sortKey="bankOrderId" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                  <SortableTh label="หมายเหตุ" sortKey="note" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.referenceId} className="clickable" onClick={() => nav(`/payouts/${r.referenceId}`)}>
                    <td>
                      <Badge variant={r.match === "discrepancy" ? "destructive" : "success"}>
                        {r.match === "discrepancy" ? "ผลต่าง" : "ตรง"}
                      </Badge>
                    </td>
                    <td>{r.confirmedAt ? fmtDT(r.confirmedAt) : "—"}</td>
                    <td>{r.merchantName}</td>
                    <td className="font-medium text-primary">{r.referenceId}</td>
                    <td className="num text-base font-semibold tabular-nums">{money4(r.amount)}</td>
                    <td className="num text-base font-semibold tabular-nums">{money(r.bankFee)}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="font-mono text-xs">{r.bankOrderId ?? "—"}</td>
                    <td className="text-muted-foreground">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีเดบิตที่เทียบได้</p>
          )}
        </div>
        {rows.length > 0 ? (
          <TablePagination
            page={page}
            pages={pages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        ) : null}
      </Zone>
    </div>
  );
}
