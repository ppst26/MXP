import type { ReactNode } from "react";
import type { PeriodMetrics } from "../../mock/types";
import { deltaLabel, money, pct } from "../../lib/money";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = deltaLabel(cur, prev);
  return <span className={d.dir === "up" ? "text-success" : d.dir === "down" ? "text-destructive" : ""}>{d.text}</span>;
}

function KpiCell({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 border-r border-border px-3 py-4 last:border-r-0 sm:px-4",
        accent && "bg-primary/5",
      )}
    >
      <div className="text-[11px] leading-snug text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums sm:text-xl">{value}</div>
      {hint ? <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function PeriodKpis({
  m,
  pm,
  batchCount,
  batchSettled,
  batchOpen,
  showHouseCost,
  showBatches,
}: {
  m: PeriodMetrics;
  pm: PeriodMetrics;
  batchCount: number;
  batchSettled: number;
  batchOpen: number;
  showHouseCost: boolean;
  showBatches: boolean;
}) {
  const cols = showHouseCost && showBatches ? "grid-cols-7" : "grid-cols-5";

  return (
    <>
      <Card className="overflow-hidden py-0">
        <div className={cn("grid divide-x divide-border", cols)}>
          <KpiCell label="จำนวนใบ" value={m.count} hint={<Delta cur={m.count} prev={pm.count} />} />
          <KpiCell label="ยอดโอน" value={money(m.amount)} hint={<Delta cur={m.amount} prev={pm.amount} />} />
          <KpiCell
            label="สำเร็จ"
            value={`${m.completedCount} · ${money(m.completedAmount)}`}
            hint={<Delta cur={m.completedAmount} prev={pm.completedAmount} />}
          />
          <KpiCell
            label="ล้ม"
            value={`${m.failedCount} · ${money(m.failedAmount)}`}
            hint={`ไม่รับทำ ${m.rejectedCount} · ${money(m.rejectedAmount)}`}
          />
          {showHouseCost ? (
            <KpiCell
              accent
              label="ค่าธรรมเนียมโอนธนาคาร (บ้านจ่าย)"
              value={money(m.incurred)}
              hint={
                <>
                  <div>
                    {m.incurredCount} ใบข้ามธนาคาร × 5.00 · ในธนาคาร {m.sameBank} ใบ = 0.00
                  </div>
                  <div>ประมาณการคิวที่ยังไม่จบ {money(m.exposed)} — ไม่รวมตัวเลขหลัก</div>
                  <div>
                    <Delta cur={m.incurred} prev={pm.incurred} />
                  </div>
                </>
              }
            />
          ) : null}
          <KpiCell
            label="ค่าบริการร้าน"
            value={money(m.reservedFee, 4)}
            hint={showHouseCost ? "ห้ามบวกกับการ์ดซ้าย" : "ค่าที่สมุดกันตอนสร้างใบ"}
          />
          {showBatches ? (
            <KpiCell label="ชุดในช่วงนี้" value={batchCount} hint={`ปิดยอด ${batchSettled} · ยังไม่จบ ${batchOpen}`} />
          ) : null}
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        อัตราสำเร็จ {pct(m.successRate)} = สำเร็จ / (สำเร็จ+ล้ม) ไม่นับคิวและไม่รับทำ
      </p>
    </>
  );
}
