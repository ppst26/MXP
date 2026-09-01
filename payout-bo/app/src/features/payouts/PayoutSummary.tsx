import type { PeriodMetrics } from "../../mock/types";
import { money } from "../../lib/money";
import { SummaryMetricCard, SummaryMetricGrid } from "@/components/metric-card";

export function PayoutSummary({ m, showBankFee = true }: { m: PeriodMetrics; showBankFee?: boolean }) {
  return (
    <SummaryMetricGrid>
      <SummaryMetricCard label="ใบ" value={m.count} />
      <SummaryMetricCard label="ยอดโอน" value={money(m.amount)} />
      <SummaryMetricCard label="สำเร็จ" value={`${m.completedCount} · ${money(m.completedAmount)}`} />
      <SummaryMetricCard
        label="ล้ม"
        value={`${m.failedCount} · ${money(m.failedAmount)}`}
        hint={`ไม่รับทำ ${m.rejectedCount}`}
      />
      <SummaryMetricCard label="ค่าบริการร้าน" value={money(m.reservedFee, 4)} />
      {showBankFee ? (
        <SummaryMetricCard
          label="ค่าโอนธนาคารที่เกิดแล้ว"
          value={money(m.incurred)}
          hint={`${m.incurredCount} ใบข้ามธนาคาร`}
        />
      ) : null}
    </SummaryMetricGrid>
  );
}
