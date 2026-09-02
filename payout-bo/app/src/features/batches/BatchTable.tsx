import { AlertTriangle, Banknote, Clock, Files, Landmark, Layers } from "lucide-react";
import type { Batch } from "../../mock/types";
import type { SortDir } from "../../lib/sort";
import { money } from "../../lib/money";
import { STUCK_BATCH_LABEL } from "../../lib/copy";
import { fmtDT } from "../../lib/bangkok";
import { StatusPill } from "../../lib/StatusPill";
import { SortableTh } from "@/components/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { SummaryMetricCard, SummaryMetricGrid } from "@/components/metric-card";

const iconProps = { strokeWidth: 1.8 } as const;

type SortProps = {
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
};

export function BatchTable({
  rows,
  relaxed = false,
  sort,
  onOpen,
}: {
  rows: Batch[];
  relaxed?: boolean;
  sort: SortProps;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <p className={relaxed ? "py-12 text-center text-sm text-muted-foreground" : "py-8 text-center text-sm text-muted-foreground"}>
        ไม่พบชุดตามตัวกรอง
      </p>
    );
  }
  const { sortKey, sortDir, onSort } = sort;
  return (
    <table className={relaxed ? "data-table relaxed" : "data-table"}>
      <thead>
        <tr>
          <SortableTh label="เปิดชุด" sortKey="createdAt" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="สถานะ" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ใบ" sortKey="itemCount" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="ยอดโอน" sortKey="totalAmount" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="ใน / ข้าม" sortKey="routes" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ค่าโอน" sortKey="bankFeeIncurred" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="เลขออเดอร์ธนาคาร" sortKey="bankBulkOrderId" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="package" sortKey="packageRefNo" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="สาเหตุชุด" sortKey="failureReason" activeKey={sortKey} direction={sortDir} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id} className="clickable" onClick={() => onOpen(b.id)}>
            <td>{fmtDT(b.createdAt)}</td>
            <td>
              <StatusPill status={b.status} />
            </td>
            <td className="num text-base font-semibold tabular-nums">{b.itemCount}</td>
            <td className="num text-base font-semibold tabular-nums">{money(b.totalAmount)}</td>
            <td>
              {b.sameBankCount} ใน · {b.interbankCount} ข้าม
            </td>
            <td className="num tabular-nums">
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

export function BatchSummary({
  rows,
  onStuckClick,
}: {
  rows: Batch[];
  onStuckClick?: () => void;
}) {
  const items = rows.reduce((s, b) => s + b.itemCount, 0);
  const amt = rows.reduce((s, b) => s + b.totalAmount, 0);
  const fee = rows.reduce((s, b) => s + b.bankFeeIncurred, 0);
  const open = rows.filter((b) => ["PENDING", "SENDING", "SENT", "NEEDS_REVIEW"].includes(b.status)).length;
  const stuck = rows.filter((b) => b.stuck).length;

  return (
    <SummaryMetricGrid cols={6}>
      <SummaryMetricCard icon={<Layers {...iconProps} />} label="ชุด" value={rows.length} />
      <SummaryMetricCard icon={<Files {...iconProps} />} label="ใบในชุด" value={items} />
      <SummaryMetricCard icon={<Banknote {...iconProps} />} label="ยอดโอนในชุด" value={money(amt)} />
      <SummaryMetricCard icon={<Clock {...iconProps} />} label="ยังไม่จบ" value={open} />
      <SummaryMetricCard
        icon={<AlertTriangle {...iconProps} />}
        label={STUCK_BATCH_LABEL}
        value={stuck}
        valueClassName={stuck > 0 ? "text-destructive" : undefined}
        onClick={stuck > 0 ? onStuckClick : undefined}
        hint={stuck > 0 ? "คลิกกรองเฉพาะชุดค้าง" : undefined}
      />
      <SummaryMetricCard icon={<Landmark {...iconProps} />} label="ค่าโอนธนาคารที่เกิดแล้ว" value={money(fee)} />
    </SummaryMetricGrid>
  );
}
