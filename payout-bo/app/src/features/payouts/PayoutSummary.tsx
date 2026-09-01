import type { PeriodMetrics } from "../../mock/types";
import { money } from "../../lib/money";
import { Card, CardContent } from "@/components/ui/card";

export function PayoutSummary({ m, showBankFee = true }: { m: PeriodMetrics; showBankFee?: boolean }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-muted-foreground">ใบ</p>
          <p className="font-medium">{m.count}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ยอดโอน</p>
          <p className="font-medium">{money(m.amount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">สำเร็จ</p>
          <p className="font-medium">
            {m.completedCount} · {money(m.completedAmount)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ล้ม</p>
          <p className="font-medium">
            {m.failedCount} · {money(m.failedAmount)}
          </p>
          <p className="text-xs text-muted-foreground">ไม่รับทำ {m.rejectedCount}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ค่าบริการร้าน</p>
          <p className="font-medium">{money(m.reservedFee, 4)}</p>
        </div>
        {showBankFee ? (
          <div>
            <p className="text-xs text-muted-foreground">ค่าโอนธนาคารที่เกิดแล้ว</p>
            <p className="font-medium">{money(m.incurred)}</p>
            <p className="text-xs text-muted-foreground">{m.incurredCount} × 5.00</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
