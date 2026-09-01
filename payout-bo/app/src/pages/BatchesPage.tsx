import { useNavigate } from "react-router-dom";
import { db } from "../mock/seed";
import { listBatches } from "../mock/query";
import { useFilters } from "../state/FilterProvider";
import { BatchFilterBar } from "../features/batches/BatchFilterBar";
import { BatchSummary, BatchTable } from "../features/batches/BatchTable";
import { Zone } from "@/components/metric-card";

export function BatchesPage() {
  const nav = useNavigate();
  const { filters, setFilters, setPreset } = useFilters();
  const rows = listBatches(db, {
    from: filters.from,
    to: filters.to,
    status: filters.batchStatus,
    q: filters.batchQ,
    stuck: filters.batchStuck,
  });

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="page-title">รายการชุดโอน</h1>
        <p className="text-sm text-muted-foreground">
          แพลตฟอร์มแอดมิน · หนึ่งแถว = หนึ่งออเดอร์ธนาคาร · ทั้งระบบ {db.batches.length} ชุด · พบ {rows.length}{" "}
          ชุดตามตัวกรอง
        </p>
      </header>

      <section aria-label="ตัวกรอง">
        <BatchFilterBar />
      </section>

      <BatchSummary
        rows={rows}
        onStuckClick={() => {
          setPreset("d30");
          setFilters({ batchStuck: true });
        }}
      />

      <Zone title="ตารางชุด">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          <BatchTable rows={rows} relaxed onOpen={(id) => nav(`/payouts/batches/${id}`)} />
        </div>
        <p className="text-xs text-muted-foreground">แถว FAILED ของชุด ≠ ใบล้ม · ใบถูกปล่อยกลับคิวรอส่ง</p>
      </Zone>
    </div>
  );
}
