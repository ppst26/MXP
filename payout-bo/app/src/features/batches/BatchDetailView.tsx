import type { ReactNode } from "react";
import type { Batch, Payout, SourceAccount } from "../../mock/types";
import { money, money4 } from "../../lib/money";
import { fmtDTThai, fmtTime } from "../../lib/bangkok";
import { batchLabel, payoutLabel, routeLabel, statusPillClass } from "../../lib/status";
import { DetailPageHeader, DetailPageShell } from "@/components/page-back-link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Landmark } from "lucide-react";

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

function AmountLine({
  label,
  value,
  total,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  total?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4 border-t border-border px-4 py-2 type-label first:border-t-0",
        total && "pt-3 text-foreground/85",
      )}
    >
      <span>{label}</span>
      <b className={cn("font-medium tabular-nums text-foreground/90", total && "text-sm text-foreground", valueClassName)}>
        {value}
      </b>
    </div>
  );
}

function BankRow({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="type-micro">{label}</div>
      <div className={cn("type-label mt-0.5 break-all text-foreground/85", mono && "font-mono")}>{children}</div>
    </div>
  );
}

function bankFeeDisplay(p: Payout): string {
  if (p.bankFee > 0) {
    return p.bankFeeEstimated ? `${money4(p.bankFee)} (ประมาณ)` : money4(p.bankFee);
  }
  if (p.route === "INTERBANK") {
    return p.status === "COMPLETED" ? "5.00" : "5.00 (ประมาณ)";
  }
  return "0.00";
}

function statusBadgeClass(status: string): string {
  const pill = statusPillClass(status);
  if (pill === "ok") return "border-success/20 bg-success/10 text-success";
  if (pill === "alert" || pill === "orange") return "border-destructive/20 bg-destructive/10 text-destructive";
  if (pill === "review") return "border-review/20 bg-review/10 text-review";
  if (pill === "info") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted/50 text-muted-foreground";
}

function childStatusClass(status: string): string {
  const pill = statusPillClass(status);
  if (pill === "ok") return "text-success";
  if (pill === "alert" || pill === "orange") return "text-destructive";
  if (pill === "review") return "text-review";
  if (pill === "info") return "text-primary";
  return "text-muted-foreground";
}

type Props = {
  batch: Batch;
  items: Payout[];
  source: SourceAccount;
  onOpenPayout: (ref: string) => void;
};

export function BatchDetailView({ batch: b, items, source, onOpenPayout }: Props) {
  const reserved = items.reduce((s, p) => s + p.reservedFee, 0);
  const completed = items.filter((p) => p.status === "COMPLETED").length;
  const processing = items.filter((p) => p.status === "PROCESSING").length;
  const failed = items.filter((p) => p.status === "FAILED").length;
  const review = items.filter((p) => p.status === "NEEDS_REVIEW").length;

  const steps = [
    { name: "เปิดชุด", at: b.createdAt },
    { name: "เริ่มส่ง", at: b.sentAt },
    { name: "ธนาคารรับชุด", at: b.confirmedAt },
    { name: "ปิดยอด", at: b.settledAt },
  ];


  const moneyStatus =
    b.status === "SETTLED" ? (
      <span className="text-success">ตัดยอดแล้ว</span>
    ) : (
      batchLabel(b.status)
    );

  const bankFeeText =
    b.bankFeeEstimated && b.bankFeeIncurred > 0
      ? `${money(b.bankFeeIncurred)} (ประมาณ)`
      : money(b.bankFeeIncurred);

  return (
    <DetailPageShell backTo="/payouts/batches" backLabel="กลับสู่รายการชุดโอน">
      <DetailPageHeader
        trailing={
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold", statusBadgeClass(b.status))}>
            <span className="size-1 rounded-full bg-current" />
            {batchLabel(b.status)}
          </span>
        }
      >
        <div className="type-label">รายละเอียดชุดโอน</div>
        <div className="type-section mt-0.5 font-mono font-normal text-foreground/85">{b.id}</div>
        <div className="type-display mt-2.5">
          {b.itemCount} ใบ
          <small className="ml-1.5 text-sm font-medium tracking-normal text-muted-foreground">· ฿ {money(b.totalAmount)}</small>
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          เปิดเมื่อ {fmtDTThai(b.createdAt)}
          {b.bankBulkOrderId ? " · คำสั่งธนาคารหนึ่งชุด" : null}
        </div>
      </DetailPageHeader>

      {b.bankBulkOrderId ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-warning/10 text-warning">
            <AlertTriangle className="size-3.5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground/90">ชุดนี้มีเลขออเดอร์ธนาคารแล้ว — ห้ามส่งซ้ำ</div>
            <div className="type-label mt-0.5">
              การส่งซ้ำอาจทำให้มีการโอนเงินซ้ำ แม้บางรายการในชุดยังรอการตรวจสอบ
            </div>
            <div className="type-micro mt-1 font-mono text-warning">bank_bulk_order_id: {b.bankBulkOrderId}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.34fr)_minmax(330px,0.76fr)]">
        <Panel
          title="ความคืบหน้าชุดโอน"
          note="ลำดับการส่งจากระบบไปยังธนาคาร"
          extra={<span className="type-label">เสร็จสิ้น {completed} / {b.itemCount} ใบ</span>}
        >
          <div className="grid grid-cols-4 px-4 pb-5 pt-2">
            {steps.map((step, i) => (
              <div key={step.name} className="relative min-w-0 pr-2">
                {i < steps.length - 1 ? (
                  <span
                    className={cn(
                      "absolute top-1.5 left-3 right-0 h-px",
                      step.at ? "bg-foreground/25" : "bg-border",
                    )}
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-1 block size-3 rounded-full border-[3px] border-card",
                    step.at
                      ? "bg-success shadow-[0_0_0_1px_var(--success)]"
                      : "bg-muted shadow-[0_0_0_1px_var(--border)]",
                  )}
                />
                <div className="type-label mt-2 font-medium text-foreground/90">{step.name}</div>
                <div className="type-micro mt-0.5">{step.at ? fmtTime(step.at) : "—"}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 border-t border-border">
            {[
              { label: "สำเร็จ", value: completed, tone: completed ? "text-success" : undefined },
              { label: "กำลังดำเนินการ", value: processing },
              { label: "ล้มเหลว", value: failed, tone: failed ? "text-destructive" : undefined },
              { label: "ต้องตรวจสอบ", value: review, tone: review ? "text-review" : undefined },
            ].map((c, i) => (
              <div key={c.label} className={cn("border-border px-4 py-3", i < 3 && "border-r")}>
                <div className="type-micro">{c.label}</div>
                <div className={cn("type-kpi mt-0.5", c.tone)}>{c.value}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="เงินของชุดนี้" headless>
          <div className="px-4 pb-4 pt-4">
            <div className="type-section mb-3">เงินของชุดนี้</div>
            <AmountLine label="ยอดโอนทั้งหมด" value={`฿ ${money(b.totalAmount)}`} />
            <AmountLine label="ค่าบริการร้านในชุด" value={`฿ ${money(reserved, 4)}`} />
            <AmountLine label="ค่าโอนธนาคารที่เกิดแล้ว" value={`฿ ${bankFeeText}`} />
            <AmountLine
              label="ค่าเสนอทั้งชุด (total fee)"
              value={b.totalFeeQuoted == null ? "ยังไม่ทราบ" : `฿ ${money(b.totalFeeQuoted)}`}
            />
            <AmountLine label="สถานะเงิน" value={moneyStatus} total />
            <p className="type-micro mt-2">
              ค่าโอนธนาคารเป็นต้นทุนบัญชีต้นทาง ไม่รวมอยู่ในค่าบริการร้าน
            </p>
          </div>
        </Panel>

        <Panel title="บัญชีต้นทางของชุด" note="snapshot ของ bank_account_id ตอนเปิดชุด">
          <div className="flex gap-2.5 px-4 pb-4 pt-1">
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-foreground/15 text-foreground/85">
              <Landmark className="size-3.5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <div className="text-xs text-foreground/90">
                {source.accountName} · {source.bankName}
              </div>
              <div className="type-micro mt-0.5 font-mono">
                {source.accountNo} · {source.bankCode} · source_account_id: {source.id}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="ข้อมูลส่งธนาคาร" headless>
          <div className="px-4 pb-4 pt-4">
            <div className="type-section mb-3">ข้อมูลส่งธนาคาร</div>
            <BankRow label="Bank bulk order ID" mono>
              {b.bankBulkOrderId || "—"}
            </BankRow>
            <BankRow label="Package reference" mono>
              {b.packageRefNo || "—"}
            </BankRow>
            <BankRow label="Confirmed at">{b.confirmedAt ? fmtDTThai(b.confirmedAt) : "—"}</BankRow>
            <BankRow label="Failure reason">{b.failureReason || "—"}</BankRow>
          </div>
        </Panel>

        <Panel
          className="xl:col-span-2"
          title="ใบในชุดนี้"
          note="เฉพาะใบที่ผ่านการตรวจและถูกส่งเข้าชุด"
        >
          <div className="overflow-auto">
            {items.length ? (
              <table className="data-table min-w-[930px]">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>ร้านค้า</th>
                    <th>ผู้รับเงิน</th>
                    <th>เส้นทาง</th>
                    <th className="num">ยอดโอน</th>
                    <th className="num">ค่าโอน</th>
                    <th>สถานะ</th>
                    <th>Bank item ID</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.referenceId} className="clickable" onClick={() => onOpenPayout(p.referenceId)}>
                      <td>
                        <span className="type-label font-mono text-foreground/90">{p.referenceId}</span>
                        <span className="type-label mt-0.5 block font-mono">{p.transactionId}</span>
                      </td>
                      <td>
                        {p.merchantName}
                        <span className="type-label mt-0.5 block font-mono">{p.merchantCode}</span>
                      </td>
                      <td>
                        {p.recipientBankName} · {p.recipientAccountNo}
                        <span className="type-label mt-0.5 block">{p.recipientName}</span>
                      </td>
                      <td>
                        <span className="type-label">{routeLabel(p.route)}</span>
                      </td>
                      <td className="num">฿ {money4(p.amount)}</td>
                      <td className="num">฿ {bankFeeDisplay(p)}</td>
                      <td>
                        <span className={cn("type-label inline-flex items-center gap-1", childStatusClass(p.status))}>
                          <span className="size-1 rounded-full bg-current" />
                          {payoutLabel(p.status)}
                        </span>
                      </td>
                      <td>
                        <span className="type-label font-mono text-foreground/90">{p.bankItemId || "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                ตารางลูกว่าง — ชุด FAILED ปล่อยใบกลับคิวแล้ว
              </p>
            )}
          </div>
        </Panel>
      </div>

      <p className="type-label -mt-1">
        ใบที่เช็คชื่อไม่ผ่านหรือเงินไม่พอจะไม่แสดงในชุดนี้ — ตรวจได้จากหน้ารายการโอนออก
      </p>
    </DetailPageShell>
  );
}
