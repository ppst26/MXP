import { useNavigate } from "react-router-dom";
import { db } from "../mock/seed";
import { houseAlerts, listBatches, queuePayouts } from "../mock/query";
import { useFilters } from "../state/FilterProvider";
import { BatchFilterBar } from "../features/batches/BatchFilterBar";
import { BatchSummary, BatchTable } from "../features/batches/BatchTable";
import { HouseBanners } from "../features/overview/HouseBanners";
import { Zone } from "@/components/metric-card";

export function BatchesPage() {
  const nav = useNavigate();
  const { filters } = useFilters();
  const rows = listBatches(db, {
    from: filters.from,
    to: filters.to,
    status: filters.batchStatus,
    q: filters.batchQ,
    stuck: filters.batchStuck,
  });
  const pending = queuePayouts(db, "").filter((p) => p.status === "PENDING");
  const processing = queuePayouts(db, "").filter((p) => p.status === "PROCESSING");
  const alerts = houseAlerts({
    source: db.source,
    pendingCount: pending.length,
    queueAmount: pending.concat(processing).reduce((s, p) => s + p.amount, 0),
    stuckBatchCount: db.batches.filter((b) => b.stuck).length,
    now: db.now,
  }).filter((a) => a.id === "stuck");
  return (
    <>
      <div>
        <h1 className="font-heading text-xl tracking-tight">รายการชุดโอน</h1>
        <p className="text-sm text-muted-foreground">
          /payouts/batches · แพลตฟอร์มแอดมิน · หนึ่งแถว = หนึ่งออเดอร์ธนาคาร · ทั้งระบบ {db.batches.length} ชุด
        </p>
      </div>
      <HouseBanners alerts={alerts} />
      <BatchFilterBar />
      <BatchSummary rows={rows} />
      <Zone title="ตารางชุด">
        <div className="overflow-auto">
          <BatchTable rows={rows} onOpen={(id) => nav(`/payouts/batches/${id}`)} />
        </div>
        <p className="text-xs text-muted-foreground">แถว FAILED ของชุด ≠ ใบล้ม · ใบถูกปล่อยกลับคิวรอส่ง</p>
      </Zone>
    </>
  );
}
