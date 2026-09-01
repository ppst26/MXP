import type { Payout } from "../../mock/types";
import { money } from "../../lib/money";
import { NOW } from "../../lib/bangkok";
import { sumAmt } from "../../mock/query";
import { MetricCard } from "@/components/metric-card";

export function QueueCards({
  pending,
  processing,
  review,
  held,
  showHeld = true,
  onGoList,
}: {
  pending: Payout[];
  processing: Payout[];
  review: Payout[];
  held: number;
  showHeld?: boolean;
  onGoList: (statuses: string[]) => void;
}) {
  const oldest = pending.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const oldestMin = oldest ? Math.round((NOW.getTime() - oldest.createdAt.getTime()) / 60000) : 0;
  const unconf = processing.filter((p) => (p.bankBulkOrderId || p.bankOrderId) && !p.confirmedAt);
  const conf = processing.filter((p) => p.confirmedAt);

  return (
    <div className={`grid gap-2 ${showHeld ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3"}`}>
      <MetricCard
        label="รอส่ง"
        value={pending.length}
        hint={money(sumAmt(pending)) + (oldest ? ` · เก่าสุด ${oldestMin} น.` : "")}
        tone={pending.length ? undefined : "quiet"}
        onClick={() => onGoList(["PENDING"])}
      />
      <MetricCard
        label="กำลังส่ง"
        value={processing.length}
        hint={(unconf.length ? `ห้ามส่งซ้ำ ${unconf.length}` : "ในชุด/กำลังโอน") + (conf.length ? ` · รอผล ${conf.length}` : "")}
        tone={unconf.length ? "warn" : processing.length ? undefined : "quiet"}
        onClick={() => onGoList(["PROCESSING"])}
      />
      <MetricCard
        label="รอคนดู"
        value={review.length}
        hint={review.length ? money(sumAmt(review)) : "ไม่มีใบค้างตรวจ"}
        tone={review.length ? "alert" : "quiet"}
        onClick={() => onGoList(["NEEDS_REVIEW"])}
      />
      {showHeld ? (
        <MetricCard
          label="เงินที่กันไว้"
          value={money(held)}
          hint="PENDING + PROCESSING · ผลรวมใบ ไม่ใช่สมุดร้าน"
          tone="quiet"
          onClick={() => onGoList(["PENDING", "PROCESSING"])}
        />
      ) : null}
    </div>
  );
}
