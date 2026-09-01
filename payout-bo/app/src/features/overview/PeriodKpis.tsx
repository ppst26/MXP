import type { ReactNode } from "react";
import type { BatchPeriodSummary, PeriodMetrics } from "../../mock/types";
import { deltaLabel, money, pct } from "../../lib/money";
import { batchLabel } from "../../lib/status";
import { SummaryMetricCard, SummaryMetricGrid } from "@/components/metric-card";
import { cn } from "@/lib/utils";

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = deltaLabel(cur, prev);
  return <span className={d.dir === "up" ? "text-success" : d.dir === "down" ? "text-destructive" : ""}>{d.text}</span>;
}

function batchTooltipContent(b: BatchPeriodSummary): ReactNode {
  const parts: { label: string; count: number }[] = [
    { label: batchLabel("SETTLED"), count: b.settled },
    { label: batchLabel("SENDING"), count: b.sending },
    { label: batchLabel("SENT"), count: b.sent },
    { label: batchLabel("PENDING"), count: b.pending },
    { label: batchLabel("NEEDS_REVIEW"), count: b.needsReview },
    { label: batchLabel("FAILED"), count: b.failed },
  ];
  const active = parts.filter((p) => p.count > 0);

  return (
    <>
      <p>ชุดที่ created_at อยู่ในช่วงที่เลือก</p>
      {active.length ? (
        <p>{active.map((p) => `${p.label} ${p.count}`).join(" · ")}</p>
      ) : (
        <p>ไม่มีชุดในช่วงนี้</p>
      )}
      {b.stuck > 0 ? <p className="text-warning">ค้างเกินเกณฑ์ {b.stuck} ชุด (ณ ตอนนี้)</p> : null}
    </>
  );
}

function bankFeeTooltip(m: PeriodMetrics): ReactNode {
  const delta = m.bankFeeDelta;
  const showDelta = delta != null && Math.abs(delta) >= 0.005;

  return (
    <>
      <p>
        {m.incurredCount} ใบข้ามธนาคารที่คิดแล้ว · ในธนาคาร {m.sameBank} ใบ = 0.00
      </p>
      {m.bankFeeAllEstimated && m.incurredCount > 0 ? (
        <p>ประมาณการ 5.00 บาท/รายการ — ยังไม่มีค่าจากธนาคารครบ</p>
      ) : null}
      {showDelta ? (
        <p className={cn(delta! < 0 ? "text-success" : delta! > 0 ? "text-warning" : "")}>
          ต่างจากประมาณการ {delta! >= 0 ? "+" : ""}
          {money(delta!)} (จริง {money(m.incurred)} vs {money(m.incurredEstimate)})
        </p>
      ) : null}
      <p>ประมาณการคิวที่ยังไม่จบ {money(m.exposed)} — ไม่รวมตัวเลขหลัก</p>
    </>
  );
}

export function PeriodKpis({
  m,
  pm,
  batches,
  showHouseCost,
  showBatches,
}: {
  m: PeriodMetrics;
  pm: PeriodMetrics;
  batches?: BatchPeriodSummary;
  showHouseCost: boolean;
  showBatches: boolean;
}) {
  const cols = showHouseCost && showBatches ? 7 : 5;

  return (
    <>
      <SummaryMetricGrid cols={cols}>
        <SummaryMetricCard
          label="จำนวนใบ"
          value={m.count}
          footer={<Delta cur={m.count} prev={pm.count} />}
          tooltip="COUNT(*) ของใบที่ created_at อยู่ในช่วงและผ่านตัวกรอง"
        />
        {showBatches && batches ? (
          <SummaryMetricCard label="ชุดในช่วงนี้" value={batches.total} tooltip={batchTooltipContent(batches)} />
        ) : null}
        <SummaryMetricCard
          label="ยอดโอน"
          value={money(m.amount)}
          footer={<Delta cur={m.amount} prev={pm.amount} />}
          tooltip="SUM(amount) ของใบในช่วง — ทุกสถานะ"
        />
        <SummaryMetricCard
          label="สำเร็จ"
          value={`${m.completedCount} · ${money(m.completedAmount)}`}
          footer={<Delta cur={m.completedAmount} prev={pm.completedAmount} />}
          tooltip="จำนวนและยอดใบ COMPLETED ในช่วง"
        />
        <SummaryMetricCard
          label="ล้ม"
          value={`${m.failedCount} · ${money(m.failedAmount)}`}
          tooltip={
            <>
              <p>FAILED ในช่วง — ล้มหลังพยายามโอน</p>
              <p>
                ไม่รับทำ {m.rejectedCount} · {money(m.rejectedAmount)} (REJECTED)
              </p>
            </>
          }
        />
        {showHouseCost ? (
          <SummaryMetricCard
            accent
            label="ค่าธรรมเนียมโอนธนาคาร (บ้านจ่าย)"
            value={
              <>
                {money(m.incurred)}
                {m.bankFeeAllEstimated && m.incurredCount > 0 ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">ประมาณ</span>
                ) : null}
              </>
            }
            footer={<Delta cur={m.incurred} prev={pm.incurred} />}
            tooltip={bankFeeTooltip(m)}
          />
        ) : null}
        <SummaryMetricCard
          label="ค่าบริการร้าน"
          value={money(m.reservedFee, 4)}
          tooltip={
            showHouseCost
              ? "SUM(reserved_fee) — ห้ามบวกกับค่าโอนธนาคาร"
              : "ค่าที่สมุดกันตอนสร้างใบ"
          }
        />
      </SummaryMetricGrid>
      <p className="text-xs text-muted-foreground">
        อัตราสำเร็จ {pct(m.successRate)} = สำเร็จ / (สำเร็จ+ล้ม) ไม่นับคิวและไม่รับทำ
      </p>
    </>
  );
}
