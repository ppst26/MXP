import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Batch, Payout } from "../../mock/types";
import { money, money2, money4 } from "../../lib/money";
import { fmtDTThai, fmtDateShort, fmtTime } from "../../lib/bangkok";
import { batchLabel, payoutLabel, routeLabel, statusLabel, statusPillClass } from "../../lib/status";
import { DetailPageHeader, DetailPageShell } from "@/components/page-back-link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function Panel({
  title,
  note,
  extra,
  children,
  className,
  headless,
}: {
  title?: string;
  note?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  headless?: boolean;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      {!headless && title ? (
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-3.5">
          <div className="min-w-0">
            <CardTitle className="type-section">{title}</CardTitle>
            {note ? <CardDescription className="type-label">{note}</CardDescription> : null}
          </div>
          {extra}
        </CardHeader>
      ) : null}
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function InfoLine({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="py-1.5">
      <div className="type-micro">{label}</div>
      <div className={cn("mt-0.5 text-xs text-foreground/90", mono && "type-label font-mono")}>{children}</div>
    </div>
  );
}

function BatchRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="type-micro">{label}</div>
      <div className="type-label mt-0.5 break-all font-mono text-foreground/85">{value}</div>
    </div>
  );
}

function bankFeeDisplay(p: Payout): string {
  if (p.bankFee > 0) {
    return p.bankFeeEstimated ? `${money2(p.bankFee)} (ประมาณ)` : money2(p.bankFee);
  }
  if (p.route === "INTERBANK") {
    return p.status === "COMPLETED" ? "5.00" : "5.00 (ประมาณ)";
  }
  return "0.00";
}

function timelineDotClass(point: Payout["timeline"][number], isLast: boolean): string {
  if (isLast && point.status === "COMPLETED") return "payout-event-dot success";
  if (point.note === "confirmed_at" || point.status === "PROCESSING" || point.note === "เข้าชุด") {
    return "payout-event-dot blue";
  }
  return "payout-event-dot";
}

function statusBadgeClass(status: string): string {
  const pill = statusPillClass(status);
  if (pill === "ok") return "border-success/20 bg-success/10 text-success";
  if (pill === "alert" || pill === "orange") return "border-destructive/20 bg-destructive/10 text-destructive";
  if (pill === "review") return "border-review/20 bg-review/10 text-review";
  if (pill === "info") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted/50 text-muted-foreground";
}

type Props = {
  payout: Payout;
  batch: Batch | null;
  isAdmin: boolean;
  onFilterBatch: (batchId: string) => void;
};

export function PayoutDetailView({ payout: p, batch: b, isAdmin, onFilterBatch }: Props) {
  const procSec =
    p.status === "COMPLETED" && p.confirmedAt ? Math.round((p.confirmedAt.getTime() - p.createdAt.getTime()) / 1000) : null;
  const reserved = p.amount + p.reservedFee;
  const bankFee = bankFeeDisplay(p);

  return (
    <DetailPageShell backTo="/payouts" backLabel="กลับรายการใบถอน">
      <DetailPageHeader
        trailing={
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold", statusBadgeClass(p.status))}>
            <span className="size-1 rounded-full bg-current" />
            {payoutLabel(p.status)}
          </span>
        }
      >
        <div className="type-label">รายละเอียดใบถอน</div>
        <div className="type-section mt-0.5 font-mono font-normal text-foreground/85">
          {p.referenceId} · {p.transactionId}
        </div>
        <div className="type-display mt-2.5">฿ {money(p.amount)}</div>
        <div className="mt-2 text-sm text-muted-foreground">
          {p.merchantName} · {p.merchantCode} · สร้าง {fmtDTThai(p.createdAt)}
        </div>
      </DetailPageHeader>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.32fr)_minmax(330px,0.78fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel headless title="ผู้รับ">
            <div className="px-5 pt-5">
              <div className="flex items-center gap-3 border-b border-border pb-5">
                <div className="type-label grid size-10 place-items-center rounded-lg bg-muted font-bold text-foreground">
                  {p.recipientBankCode.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <div className="type-section">{p.recipientName}</div>
                  <div className="mt-0.5 font-mono text-xs text-foreground/85">{p.recipientAccountNo}</div>
                  {p.nameMismatch ? (
                    <span className="type-label mt-1 inline-flex items-center gap-1 text-warning">
                      <span className="size-1 rounded-full bg-current" />
                      nameMismatch
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
                <InfoLine label="ธนาคาร">{p.recipientBankName} · {p.recipientBankCode}</InfoLine>
                <InfoLine label="เส้นทาง">{routeLabel(p.route)}</InfoLine>
                <InfoLine label="ชื่อที่ร้านส่ง">{p.recipientName}</InfoLine>
                <InfoLine label="ชื่อที่ธนาคารตอบ">{p.accountToName || "—"}</InfoLine>
                {p.recipientPhone ? <InfoLine label="เบอร์">{p.recipientPhone}</InfoLine> : null}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 border-t border-border sm:grid-cols-2">
              <div className="border-border px-5 py-3.5 sm:border-r">
                <div className="type-micro">ยอดโอน</div>
                <div className="type-kpi mt-0.5">{money4(p.amount)}</div>
                <div className="type-micro mt-0.5">ค่าบริการร้าน {money4(p.reservedFee)}</div>
              </div>
              {isAdmin ? (
                <div className="border-t border-border px-5 py-3.5 sm:border-t-0">
                  <div className="type-micro">ค่าโอนธนาคาร</div>
                  <div className="type-kpi mt-0.5">{bankFee}</div>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="บัญชีต้นทาง">
            <div className="px-4 pb-4">
              <InfoLine label="เลขบัญชี" mono>{p.sourceAccountNo}</InfoLine>
              <InfoLine label="ธนาคาร">{p.sourceBankName} · {p.sourceBankCode}</InfoLine>
              <InfoLine label="ชื่อ">{p.sourceAccountName}</InfoLine>
            </div>
          </Panel>

          <Panel title="ไทม์ไลน์">
            <div className="px-4 pb-4">
              {p.timeline.length ? (
                p.timeline.map((t, i) => (
                  <div key={`${t.at.getTime()}-${i}`} className="payout-event">
                    <div className="payout-event-time">
                      <b>{fmtTime(t.at)}</b>
                      {fmtDateShort(t.at)}
                    </div>
                    <div className="payout-event-rail">
                      <span className={timelineDotClass(t, i === p.timeline.length - 1)} />
                    </div>
                    <div className="payout-event-content">
                      <div className="text-xs font-medium text-foreground/90">
                        {statusLabel(t.status)}
                        {t.note ? <span className="font-normal text-muted-foreground"> · {t.note}</span> : null}
                      </div>
                      <div className="type-micro mt-0.5 font-mono">{fmtDTThai(t.at)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
              <p className="type-micro mt-2">
                {procSec != null
                  ? `processSeconds = ${procSec} วินาที ถึงจุดรับคำสั่ง ไม่ใช่เงินเข้าบัญชีผู้รับ`
                  : "ไม่โชว์ processSeconds เพราะใบยังไม่ COMPLETED"}
              </p>
            </div>
          </Panel>

          <Panel title="สมุด">
            <div className="space-y-2 px-4 pb-4 text-xs">
              {p.journal.length ? (
                p.journal.map((j, i) => (
                  <div key={`${j.type}-${i}`} className="type-label font-mono text-foreground/85">
                    {j.type} · {fmtDTThai(j.at)}
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </div>
          </Panel>

          {p.failureReason ? (
            <Panel title="สาเหตุ">
              <p className="px-4 pb-4 text-xs text-foreground/90">{p.failureReason}</p>
            </Panel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel title="เงิน">
            <div className="space-y-0 px-4 pb-4">
              <AmountLine label="ยอดโอน" value={money4(p.amount)} />
              <AmountLine label="ค่าบริการร้าน" value={money4(p.reservedFee)} />
              <AmountLine label="ที่กันไว้" value={money4(reserved)} />
              {isAdmin ? (
                <AmountLine label="ค่าโอนธนาคาร" value={bankFee} />
              ) : null}
            </div>
          </Panel>

          <Panel
            title="ชุดที่สังกัด"
            extra={b ? <Badge variant="secondary">{batchLabel(b.status)}</Badge> : null}
          >
            <div className="px-4 pb-4">
              {b ? (
                <>
                  <BatchRow label="รหัสชุด" value={b.id} />
                  <BatchRow label="สถานะชุด" value={batchLabel(b.status)} />
                  <BatchRow label="package_ref_no" value={b.packageRefNo || p.packageRefNo || "—"} />
                  {isAdmin ? <BatchRow label="bank_bulk_order_id" value={b.bankBulkOrderId || p.bankBulkOrderId || "—"} /> : null}
                  <BatchRow label="bank_item_id" value={p.bankItemId || "—"} />
                  <div className="border-t border-border pt-2.5">
                    {isAdmin ? (
                      <Button variant="outline" size="sm" className="type-label h-7" asChild>
                        <Link to={`/payouts/batches/${b.id}`}>เปิดหน้าชุด</Link>
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" className="type-label h-7" onClick={() => onFilterBatch(b.id)}>
                        ดูใบในชุดนี้ (เฉพาะสายร้าน)
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-2 text-xs text-muted-foreground">ยังไม่เข้าชุด หรือล้มก่อนเข้าชุด</p>
              )}
            </div>
          </Panel>

          <Panel title="ธนาคารระดับใบ">
            <div className="px-4 pb-4">
              <BatchRow label="bank_order_id" value={p.bankOrderId || "—"} />
              <BatchRow label="confirmed_at" value={p.confirmedAt ? fmtDTThai(p.confirmedAt) : "—"} />
              <BatchRow label="attempts" value={String(p.attempts)} />
              <BatchRow label="next_attempt_at" value={p.nextAttemptAt ? fmtDTThai(p.nextAttemptAt) : "—"} />
              {isAdmin ? <BatchRow label="callbackUrl" value={p.callbackUrl} /> : null}
            </div>
          </Panel>
        </div>
      </div>
    </DetailPageShell>
  );
}

function AmountLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="type-label flex justify-between border-t border-border py-2 first:border-t-0">
      <span>{label}</span>
      <b className="font-medium tabular-nums text-foreground/90">{value}</b>
    </div>
  );
}
