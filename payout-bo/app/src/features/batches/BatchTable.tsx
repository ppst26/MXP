import type { Batch } from "../../mock/types";
import { money } from "../../lib/money";
import { fmtDT } from "../../lib/bangkok";
import { StatusPill } from "../../lib/StatusPill";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function BatchTable({ rows, onOpen }: { rows: Batch[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">ไม่พบชุดตามตัวกรอง</p>;
  return (
    <table className="data-table">
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
            <td>
              {b.bankBulkOrderId ? (
                <>
                  <Badge variant="warning">มีแล้ว ห้ามส่งซ้ำ</Badge> {b.bankBulkOrderId}
                </>
              ) : (
                <Badge variant="secondary">ยังไม่มี — ส่งใหม่ได้</Badge>
              )}
            </td>
            <td>{b.packageRefNo || "—"}</td>
            <td>{b.failureReason ? b.failureReason.slice(0, 40) : "—"}</td>
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
    <Card size="sm">
      <CardContent className="flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-muted-foreground">ชุด</p>
          <p className="font-medium">{rows.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ใบในชุด</p>
          <p className="font-medium">{items}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ยอดโอนในชุด</p>
          <p className="font-medium">{money(amt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ยังไม่จบ</p>
          <p className="font-medium">{open}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ค่าโอนธนาคารที่เกิดแล้ว</p>
          <p className="font-medium">{money(fee)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
