import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db } from "../mock/seed";
import { money2, money4 } from "../lib/money";
import { fmtDT } from "../lib/bangkok";
import { StatusPill } from "../lib/StatusPill";
import { batchLabel } from "../lib/status";
import { subtreeIds } from "../mock/query";
import { useFilters } from "../state/FilterProvider";
import { useScopedMerchantId, useViewer } from "../state/ViewerProvider";
import { Zone } from "@/components/metric-card";
import { Button } from "@/components/ui/button";

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function PayoutDetailPage() {
  const { referenceId } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useViewer();
  const merchantId = useScopedMerchantId();
  const { setFilters } = useFilters();
  const p = db.payouts.find((x) => x.referenceId === referenceId);
  if (!p) {
    return (
      <div>
        <h1 className="font-heading text-xl tracking-tight">404</h1>
        <p className="text-sm text-muted-foreground">ไม่พบใบ</p>
      </div>
    );
  }
  const visible = isAdmin || (subtreeIds(merchantId)?.includes(p.merchantId) ?? false);
  if (!visible) {
    return (
      <div>
        <h1 className="font-heading text-xl tracking-tight">404</h1>
        <p className="text-sm text-muted-foreground">ไม่พบใบในสายร้านนี้</p>
      </div>
    );
  }
  const b = p.batchId ? db.batches.find((x) => x.id === p.batchId) : null;
  const procSec = p.status === "COMPLETED" && p.confirmedAt ? Math.round((p.confirmedAt.getTime() - p.createdAt.getTime()) / 1000) : null;

  return (
    <>
      <div>
        <h1 className="font-heading text-xl tracking-tight">/payouts/{p.referenceId}</h1>
        <p className="text-sm text-muted-foreground">รายละเอียดหนึ่งใบ · อ่านอย่างเดียว</p>
      </div>
      <Button variant="link" asChild>
        <Link to="/payouts">← กลับรายการ</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={p.status} />
        <strong className="text-xl">{money4(p.amount)}</strong>
        <span>
          {p.merchantName} · {p.merchantCode}
        </span>
        <span className="text-sm text-muted-foreground">สร้าง {fmtDT(p.createdAt)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Zone title="1. ผู้รับ">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="บัญชี">{p.recipientAccountNo}</Row>
            <Row k="ธนาคาร">{p.recipientBankName} · {p.recipientBankCode}</Row>
            <Row k="ชื่อที่ร้านส่ง">{p.recipientName}</Row>
            <Row k="ชื่อที่ธนาคารตอบ">{p.accountToName || "—"}</Row>
            <Row k="เส้นทาง">{p.route === "INTERBANK" ? "ข้ามธนาคาร" : "ในธนาคาร"}</Row>
            {isAdmin ? (
              <Row k="ค่าโอนธนาคาร">{p.route === "INTERBANK" ? (p.status === "COMPLETED" ? "5.00" : "5.00 (ประมาณ)") : "0.00"}</Row>
            ) : null}
          </dl>
        </Zone>
        <Zone title="2. บัญชีต้นทาง">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="เลขบัญชี">{p.sourceAccountNo}</Row>
            <Row k="ธนาคาร">{p.sourceBankName} · {p.sourceBankCode}</Row>
            <Row k="ชื่อ">{p.sourceAccountName}</Row>
          </dl>
        </Zone>
        <Zone title="3. เงิน">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="ยอดโอน">{money4(p.amount)}</Row>
            <Row k="ค่าบริการร้าน">{money4(p.reservedFee)}</Row>
            <Row k="ที่กันไว้">{money4(p.amount + p.reservedFee)}</Row>
            {isAdmin ? (
              <Row k="ค่าโอนธนาคาร">{(p.bankFee ? money2(p.bankFee) : p.route === "INTERBANK" ? "5.00 ประมาณการ" : "0.00")} — ห้ามบวกเข้าค่าบริการ</Row>
            ) : null}
          </dl>
        </Zone>
        <Zone title="4. ชุดที่สังกัด">
          {b ? (
            <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
              <Row k="รหัสชุด">{b.id}</Row>
              <Row k="สถานะชุด">{batchLabel(b.status)}</Row>
              <Row k="package_ref_no">{b.packageRefNo || "—"}</Row>
              {isAdmin ? <Row k="bank_bulk_order_id">{b.bankBulkOrderId || "ยังไม่มี"}</Row> : null}
              <Row k="bank_item_id">{p.bankItemId || "—"}</Row>
              <dd className="col-span-2">
                {isAdmin ? (
                  <Button variant="link" asChild>
                    <Link to={`/payouts/batches/${b.id}`}>เปิดหน้าชุด</Link>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => {
                      setFilters({ batchId: b.id, listPage: 1 });
                      nav("/payouts");
                    }}
                  >
                    ดูใบในชุดนี้ (เฉพาะสายร้าน)
                  </Button>
                )}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">ยังไม่เข้าชุด หรือล้มก่อนเข้าชุด</p>
          )}
        </Zone>
        <Zone title="5. ธนาคารระดับใบ">
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1 text-sm">
            <Row k="bank_order_id">{p.bankOrderId || "—"}</Row>
            <Row k="confirmed_at">{p.confirmedAt ? fmtDT(p.confirmedAt) : "—"}</Row>
            <Row k="attempts">{p.attempts}</Row>
            {isAdmin ? <Row k="callbackUrl">{p.callbackUrl}</Row> : null}
          </dl>
        </Zone>
        <Zone title="6. ไทม์ไลน์ / สมุด / สาเหตุ">
          {p.timeline.map((t, i) => (
            <div key={i}>
              {fmtDT(t.at)} — {t.status}
              {t.note ? ` (${t.note})` : ""}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {procSec != null
              ? `processSeconds = ${procSec} วินาที ถึงจุดรับคำสั่ง ไม่ใช่เงินเข้าบัญชีผู้รับ`
              : "ไม่โชว์ processSeconds เพราะใบยังไม่ COMPLETED"}
          </p>
          {p.journal.map((j, i) => (
            <div key={i}>
              {j.type} {fmtDT(j.at)}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">สาเหตุ: {p.failureReason || "—"}</p>
        </Zone>
      </div>
    </>
  );
}
