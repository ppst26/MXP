import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Batch, Payout, TimelinePoint } from "../../mock/types";
import { money, money2, money4 } from "../../lib/money";
import { fmtDTThai, fmtTime } from "../../lib/bangkok";
import { batchLabel, payoutLabel, routeLabel, statusLabel, statusPillClass } from "../../lib/status";
import { buildPayoutQueueTimeline } from "../../mock/query";
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
            <CardTitle className="text-base font-semibold leading-tight">{title}</CardTitle>
            {note ? <CardDescription className="text-sm text-muted-foreground">{note}</CardDescription> : null}
          </div>
          {extra}
        </CardHeader>
      ) : null}
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function InfoLine({
  label,
  children,
  mono,
  size = "default",
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  size?: "default" | "lg";
}) {
  const large = size === "lg";
  return (
    <div className={large ? "py-2.5" : "py-1.5"}>
      <div className={large ? "text-base text-muted-foreground" : "text-sm text-muted-foreground"}>{label}</div>
      <div
        className={cn(
          large ? "mt-1 text-lg leading-snug text-foreground" : "mt-0.5 text-sm text-foreground/90",
          mono && "font-mono tabular-nums",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function BatchRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-all font-mono text-sm text-foreground/85">{value}</div>
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

function timelineDotClass(point: TimelinePoint, isLast: boolean): string {
  if (isLast && point.status === "COMPLETED") {
    return "bg-success shadow-[0_0_0_1px_var(--success)]";
  }
  if (point.note === "confirmed_at" || point.status === "PROCESSING" || point.note === "เข้าชุด") {
    return "bg-[#93c5fd] shadow-[0_0_0_1px_#93c5fd]";
  }
  return "bg-muted shadow-[0_0_0_1px_var(--border)]";
}

function PayoutTimelineHorizontal({ points }: { points: TimelinePoint[] }) {
  if (!points.length) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">—</p>;
  }

  return (
    <div
      className="grid px-4 pb-5 pt-4"
      style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
    >
      {points.map((step, i) => (
        <div key={`${step.at.getTime()}-${i}`} className="relative min-w-0 pr-2">
          {i < points.length - 1 ? (
            <span className="absolute top-1.5 left-3 right-0 h-px bg-foreground/25" />
          ) : null}
          <span
            className={cn(
              "relative z-1 block size-3 rounded-full border-[3px] border-card",
              timelineDotClass(step, i === points.length - 1),
            )}
          />
          <div className="mt-2 text-base font-medium text-foreground/90">
            {statusLabel(step.status)}
            {step.note ? <span className="font-normal text-muted-foreground"> · {step.note}</span> : null}
          </div>
          <div className="mt-0.5 text-sm tabular-nums text-muted-foreground">{fmtTime(step.at)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{fmtDTThai(step.at)}</div>
        </div>
      ))}
    </div>
  );
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
  const timeline = buildPayoutQueueTimeline(p, b);

  return (
    <DetailPageShell backTo="/payouts" backLabel="กลับรายการใบถอน" className="max-w-none">
      <DetailPageHeader
        trailing={
          <div className="flex flex-col items-end gap-2">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold", statusBadgeClass(p.status))}>
              <span className="size-1 rounded-full bg-current" />
              {payoutLabel(p.status)}
            </span>
            <div className="text-right">
              <div className="type-display">฿ {money(p.amount)}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                ค่าบริการร้าน {money4(p.reservedFee)}
                {isAdmin ? ` · ค่าโอนธนาคาร ${bankFee}` : null}
              </div>
            </div>
          </div>
        }
      >
        <div className="text-sm font-semibold text-muted-foreground">รายละเอียดใบถอน</div>
        <div className="mt-1 font-mono text-lg font-semibold tracking-tight text-foreground">
          {p.referenceId} · {p.transactionId}
        </div>
        <div className="mt-2 text-base text-muted-foreground">
          {p.merchantName} · {p.merchantCode} · สร้าง {fmtDTThai(p.createdAt)}
        </div>
      </DetailPageHeader>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.32fr)_minmax(330px,0.78fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel headless title="ผู้รับ">
            <div className="px-5 pt-5">
              <div className="flex items-center gap-3.5 border-b border-border pb-5">
                <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-base font-bold text-foreground">
                  {p.recipientBankCode.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-semibold tracking-tight">{p.recipientName}</div>
                  <div className="mt-1 font-mono text-base text-foreground/90">{p.recipientAccountNo}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <InfoLine size="lg" label="ธนาคาร">{p.recipientBankName} · {p.recipientBankCode}</InfoLine>
                <InfoLine size="lg" label="เส้นทาง">{routeLabel(p.route)}</InfoLine>
                <InfoLine size="lg" label="ชื่อที่ร้านส่ง">{p.recipientName}</InfoLine>
                <InfoLine size="lg" label="ชื่อที่ธนาคารตอบ">{p.accountToName || "—"}</InfoLine>
                {p.recipientPhone ? <InfoLine size="lg" label="เบอร์">{p.recipientPhone}</InfoLine> : null}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 border-t border-border sm:grid-cols-2">
              <div className="border-border px-5 py-4 sm:border-r">
                <div className="text-base text-muted-foreground">ยอดโอน</div>
                <div className="type-stat-value mt-1">{money4(p.amount)}</div>
                <div className="mt-1 text-base text-muted-foreground">ค่าบริการร้าน {money4(p.reservedFee)}</div>
              </div>
              {isAdmin ? (
                <div className="border-t border-border px-5 py-4 sm:border-t-0">
                  <div className="text-base text-muted-foreground">ค่าโอนธนาคาร</div>
                  <div className="type-stat-value mt-1">{bankFee}</div>
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

          <Panel title="ไทม์ไลน์" note="จากคอลัมน์คิวจริง — created_at · sent_at ชุด · confirmed_at · updated_at">
            <PayoutTimelineHorizontal points={timeline} />
            <p className="border-t border-border px-4 pb-4 text-sm text-muted-foreground">
              {procSec != null
                ? `processSeconds = ${procSec} วินาที ถึงจุดรับคำสั่ง ไม่ใช่เงินเข้าบัญชีผู้รับ`
                : "ไม่โชว์ processSeconds เพราะใบยังไม่ COMPLETED"}
            </p>
          </Panel>

          <Panel title="สมุด">
            <div className="space-y-2 px-4 pb-4 text-sm">
              {p.journal.length ? (
                p.journal.map((j, i) => (
                  <div key={`${j.type}-${i}`} className="font-mono text-foreground/85">
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
              <p className="px-4 pb-4 text-sm text-foreground/90">{p.failureReason}</p>
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
                      <Button variant="outline" size="sm" className="h-8 text-sm" asChild>
                        <Link to={`/payouts/batches/${b.id}`}>เปิดหน้าชุด</Link>
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" className="h-8 text-sm" onClick={() => onFilterBatch(b.id)}>
                        ดูใบในชุดนี้ (เฉพาะสายร้าน)
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">ยังไม่เข้าชุด หรือล้มก่อนเข้าชุด</p>
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
    <div className="flex justify-between border-t border-border py-2.5 text-sm first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <b className="text-base font-medium tabular-nums text-foreground/90">{value}</b>
    </div>
  );
}
