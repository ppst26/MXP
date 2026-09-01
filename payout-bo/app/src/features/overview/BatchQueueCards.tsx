import type { Batch } from "../../mock/types";
import { MetricCard } from "@/components/metric-card";

export function BatchQueueCards({
  open,
  inFlight,
  needsLook,
  onGoBatches,
}: {
  open: Batch[];
  inFlight: Batch[];
  needsLook: Batch[];
  onGoBatches: (patch: { batchStatus?: string; batchStuck?: boolean }) => void;
}) {
  const items = open.reduce((s, b) => s + b.itemCount, 0);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <MetricCard
        label="ชุดรอส่ง"
        value={open.length}
        hint={open.length ? `${items} ใบในชุด` : "ไม่มี"}
        tone={open.length ? undefined : "quiet"}
        onClick={() => onGoBatches({ batchStatus: "PENDING" })}
      />
      <MetricCard
        label="ชุดระหว่างทาง"
        value={inFlight.length}
        hint={inFlight.length ? "ห้ามส่งซ้ำถ้ามีเลขออเดอร์" : "ไม่มี"}
        tone={inFlight.length ? "warn" : "quiet"}
        onClick={() => onGoBatches({ batchStatus: "SENT" })}
      />
      <MetricCard
        label="ชุดต้องดู"
        value={needsLook.length}
        hint="รอคนดูหรือค้างเกินเกณฑ์"
        tone={needsLook.length ? "alert" : "quiet"}
        onClick={() => onGoBatches({ batchStuck: true })}
      />
    </div>
  );
}
