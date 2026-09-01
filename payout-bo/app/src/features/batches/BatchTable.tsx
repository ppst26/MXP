import type { Batch } from "../../mock/types";
import { money } from "../../lib/money";
import { fmtDT } from "../../lib/bangkok";
import { StatusPill } from "../../lib/StatusPill";
import { Badge } from "@/components/ui/badge";
import { SummaryMetricCard, SummaryMetricGrid } from "@/components/metric-card";

export function BatchTable({
  rows,
  relaxed = false,
  onOpen,
}: {
  rows: Batch[];
  relaxed?: boolean;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <p className={relaxed ? "py-12 text-center text-sm text-muted-foreground" : "py-8 text-center text-sm text-muted-foreground"}>
        ไม่พบชุดตามตัวกรอง
      </p>
    );
  }
  return (
    <table className={relaxed ? "data-table relaxed" : "data-table"}>
      <thead>
        <tr>
          <th>เปิดชุด</th>
          <th>สถานะ</th>
          <th className="num">ใบ</th>
          <th className="num">ยอดโอน</th>
          <th>ใน / ข้าม</th>
          <th className="num">ค่าโอน</th>
          <th>เลขออเดอร์ธนาคาร</th>
          <th>package</th>
          <th>สาเหตุชุด</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id} className="clickable" onClick={() => onOpen(b.id)}>
            <td>{fmtDT(b.createdAt)}</td>
            <td>
              <StatusPill status={b.status} />
            </td>
            <td className="num">{b.itemCount}</td>
            <td className="num">{money(b.totalAmount)}</td>
            <td>
              {b.sameBankCount} ใน · {b.interbankCount} ข้าม
            </td>
            <td className="num">
              {money(b.bankFeeIncurred)}
              {b.bankFeeEstimated ? <span className="text-muted-foreground"> (ประมาณ)</span> : null}
            </td>
            <td className="max-w-[200px]">
              {b.bankBulkOrderId ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  <Badge variant="warning">มีแล้ว ห้ามส่งซ้ำ</Badge>
                  <span className="truncate">{b.bankBulkOrderId}</span>
                </span>
              ) : (
                <Badge variant="secondary">ยังไม่มี — ส่งใหม่ได้</Badge>
              )}
            </td>
            <td>{b.packageRefNo || "—"}</td>
            <td className="max-w-[180px] truncate" title={b.failureReason ?? undefined}>
              {b.failureReason ? b.failureReason.slice(0, 40) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BatchSummary({ rows }: { rows: Batch[] }) {
  const items = rows.reduce((s, b) => s + b.itemCount, 0);
  const amt = rows.reduce((s, b) => s + b.totalAmount, 0);
  const fee = rows.reduce((s, b) => s + b.bankFeeIncurred, 0);
  const open = rows.filter((b) => ["PENDING", "SENDING", "SENT", "NEEDS_REVIEW"].includes(b.status)).length;

  return (
    <SummaryMetricGrid>
      <SummaryMetricCard label="ชุด" value={rows.length} />
      <SummaryMetricCard label="ใบในชุด" value={items} />
      <SummaryMetricCard label="ยอดโอนในชุด" value={money(amt)} />
      <SummaryMetricCard label="ยังไม่จบ" value={open} />
      <SummaryMetricCard label="ค่าโอนธนาคารที่เกิดแล้ว" value={money(fee)} />
    </SummaryMetricGrid>
  );
}
