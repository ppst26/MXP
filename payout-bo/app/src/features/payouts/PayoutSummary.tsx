import { Banknote, CircleCheck, CircleX, Files, Landmark, Store } from "lucide-react";
import type { PeriodMetrics } from "../../mock/types";
import { money } from "../../lib/money";
import { SummaryMetricCard, SummaryMetricGrid } from "@/components/metric-card";

const iconProps = { strokeWidth: 1.8 } as const;

export function PayoutSummary({ m, showBankFee = true }: { m: PeriodMetrics; showBankFee?: boolean }) {
  return (
    <SummaryMetricGrid>
      <SummaryMetricCard icon={<Files {...iconProps} />} label="ใบ" value={m.count} />
      <SummaryMetricCard icon={<Banknote {...iconProps} />} label="ยอดโอน" value={money(m.amount)} />
      <SummaryMetricCard
        icon={<CircleCheck {...iconProps} />}
        label="สำเร็จ"
        value={`${m.completedCount} · ${money(m.completedAmount)}`}
      />
      <SummaryMetricCard
        icon={<CircleX {...iconProps} />}
        label="ล้ม"
        value={`${m.failedCount} · ${money(m.failedAmount)}`}
        hint={`ไม่รับทำ ${m.rejectedCount}`}
      />
      <SummaryMetricCard icon={<Store {...iconProps} />} label="ค่าบริการร้าน" value={money(m.reservedFee, 4)} />
      {showBankFee ? (
        <SummaryMetricCard
          icon={<Landmark {...iconProps} />}
          label="ค่าโอนธนาคารที่เกิดแล้ว"
          value={money(m.incurred)}
          hint={`${m.incurredCount} ใบข้ามธนาคาร`}
        />
      ) : null}
    </SummaryMetricGrid>
  );
}
