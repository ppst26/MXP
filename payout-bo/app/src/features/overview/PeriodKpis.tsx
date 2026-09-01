import type { ReactNode } from "react";
import {
  Banknote,
  CircleCheck,
  CircleX,
  Files,
  Layers,
} from "lucide-react";
import type { BatchPeriodSummary, PeriodMetrics } from "../../mock/types";
import { deltaLabel, money, pct } from "../../lib/money";
import { batchLabel } from "../../lib/status";
import { SummaryMetricCard, SummaryMetricGrid } from "@/components/metric-card";

const iconProps = { strokeWidth: 1.8 } as const;

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

export function PeriodKpis({
  m,
  pm,
  batches,
  showBatches,
}: {
  m: PeriodMetrics;
  pm: PeriodMetrics;
  batches?: BatchPeriodSummary;
  showBatches: boolean;
}) {
  return (
    <>
      <SummaryMetricGrid cols={showBatches ? 5 : 4}>
        <SummaryMetricCard
          icon={<Files {...iconProps} />}
          label="จำนวนใบ"
          value={m.count}
          footer={<Delta cur={m.count} prev={pm.count} />}
          tooltip="COUNT(*) ของใบที่ created_at อยู่ในช่วงและผ่านตัวกรอง"
        />
        {showBatches && batches ? (
          <SummaryMetricCard
            icon={<Layers {...iconProps} />}
            label="ชุดในช่วงนี้"
            value={batches.total}
            tooltip={batchTooltipContent(batches)}
          />
        ) : null}
        <SummaryMetricCard
          icon={<Banknote {...iconProps} />}
          label="ยอดโอน"
          value={money(m.amount)}
          footer={<Delta cur={m.amount} prev={pm.amount} />}
          tooltip="SUM(amount) ของใบในช่วง — ทุกสถานะ"
        />
        <SummaryMetricCard
          icon={<CircleCheck {...iconProps} />}
          label="สำเร็จ"
          value={`${m.completedCount} · ${money(m.completedAmount)}`}
          footer={<Delta cur={m.completedAmount} prev={pm.completedAmount} />}
          tooltip="จำนวนและยอดใบ COMPLETED ในช่วง"
        />
        <SummaryMetricCard
          icon={<CircleX {...iconProps} />}
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
      </SummaryMetricGrid>
      <p className="text-xs text-muted-foreground">
        อัตราสำเร็จ {pct(m.successRate)} = สำเร็จ / (สำเร็จ+ล้ม) ไม่นับคิวและไม่รับทำ
      </p>
    </>
  );
}
