import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../mock/seed";
import { money } from "../lib/money";
import { fmtDT } from "../lib/bangkok";
import { StatusPill } from "../lib/StatusPill";
import { payoutLabel } from "../lib/status";
import { PayoutTable } from "../features/payouts/PayoutTable";
import { DetailPageHeader, DetailPageShell } from "@/components/page-back-link";
import { Zone } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function BatchDetailPage() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const b = db.batches.find((x) => x.id === batchId) || db.batches[0];
  if (!b) {
    return (
      <DetailPageShell backTo="/payouts/batches" backLabel="กลับรายการชุด">
        <DetailPageHeader>
          <h1 className="font-heading text-xl">ไม่พบชุด</h1>
        </DetailPageHeader>
      </DetailPageShell>
    );
  }
  const items = db.payouts.filter((p) => b.itemRefs.includes(p.referenceId));
  const reserved = items.reduce((s, p) => s + p.reservedFee, 0);

  return (
    <DetailPageShell backTo="/payouts/batches" backLabel="กลับรายการชุด">
      <DetailPageHeader>
        <h1 className="font-heading text-xl tracking-tight">รายละเอียดชุด</h1>
        <p className="font-mono text-sm text-muted-foreground">{b.id}</p>
        <p className="text-sm text-muted-foreground">อ่านอย่างเดียว · ไม่มีปุ่มส่งซ้ำ / ปิดยอด</p>
      </DetailPageHeader>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={b.status} />
        <strong>
          {b.itemCount} ใบ · {money(b.totalAmount)}
        </strong>
        {b.bankBulkOrderId ? <Badge variant="warning">ห้ามส่งซ้ำ</Badge> : <Badge variant="secondary">ยังไม่มีเลขออเดอร์ — ส่งใหม่ได้</Badge>}
        <span className="text-sm text-muted-foreground">เปิด {fmtDT(b.createdAt)}</span>
      </div>
      <Alert>
        <AlertDescription>ใบที่เช็คชื่อไม่ผ่านหรือคิวที่เงินไม่พอจะไม่โชว์ในชุดนี้ — ไปดูที่รายการใบ</AlertDescription>
      </Alert>
      <div className="grid gap-3 md:grid-cols-2">
        <Zone title="1. จุดห้ามส่งซ้ำ">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="bank_bulk_order_id">{b.bankBulkOrderId || "—"}</Row>
            <Row k="package_ref_no">{b.packageRefNo || "—"}</Row>
            <Row k="confirmed_at">{b.confirmedAt ? `${fmtDT(b.confirmedAt)} — เงินอาจออกแล้ว` : "—"}</Row>
            <Row k="failure_reason">{b.failureReason || "—"}</Row>
          </dl>
        </Zone>
        <Zone title="2. บัญชีต้นทางของชุด">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="เลขบัญชี">
              {db.source.accountNo} · {db.source.bankName} {db.source.bankCode}
            </Row>
          </dl>
        </Zone>
        <Zone title="3. เงินสามก้อน ห้ามปน">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="ยอดโอน">{money(b.totalAmount)}</Row>
            <Row k="ค่าบริการร้านในชุด">{money(reserved, 4)}</Row>
            <Row k="ค่าโอนธนาคารที่เกิดแล้ว">{money(b.bankFeeIncurred)} = ใบข้ามธนาคารที่คิดแล้ว × 5.00</Row>
            <Row k="ค่าเสนอทั้งชุด total_fee">{b.totalFeeQuoted == null ? "ยังไม่ทราบ" : money(b.totalFeeQuoted)}</Row>
          </dl>
        </Zone>
        <Zone title="4. ความคืบหน้าใบในชุด">
          {items.length ? (
            (["PROCESSING", "COMPLETED", "FAILED", "NEEDS_REVIEW"] as const).map((s) => (
              <div key={s}>
                {payoutLabel(s)} {items.filter((p) => p.status === s).length}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">ตารางลูกว่าง — ชุด FAILED ปล่อยใบกลับคิวแล้ว</p>
          )}
        </Zone>
      </div>
      <Zone title="5. ใบในชุดนี้">
        <div className="overflow-auto">
          <PayoutTable rows={items} hideBatch showBankFee onOpen={(ref) => nav(`/payouts/${ref}`)} />
        </div>
      </Zone>
      <Zone title="6. ไทม์ไลน์ชุด">
        <div>{fmtDT(b.createdAt)} เปิดชุด PENDING</div>
        {b.sentAt ? <div>{fmtDT(b.sentAt)} เริ่มส่ง SENDING</div> : null}
        {b.bankBulkOrderId ? <div>เขียน bank_bulk_order_id — จุดห้ามส่งซ้ำ</div> : null}
        {b.confirmedAt ? <div>{fmtDT(b.confirmedAt)} ธนาคารรับชุด</div> : null}
        {b.settledAt ? <div>{fmtDT(b.settledAt)} ปิดชุด SETTLED</div> : <p className="text-xs text-muted-foreground">ยังไม่มี settled_at</p>}
      </Zone>
    </DetailPageShell>
  );
}
