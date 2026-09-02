import { Link, useNavigate } from "react-router-dom";
import type { Batch } from "../../mock/types";
import { BatchTable } from "../batches/BatchTable";
import { useClientSort } from "../../hooks/use-client-sort";
import { Button } from "@/components/ui/button";
import { Zone } from "@/components/metric-card";

const batchAccessors = {
  createdAt: (b: Batch) => b.createdAt.getTime(),
  status: (b: Batch) => b.status,
  itemCount: (b: Batch) => b.itemCount,
  totalAmount: (b: Batch) => b.totalAmount,
  routes: (b: Batch) => b.sameBankCount + b.interbankCount,
  bankFeeIncurred: (b: Batch) => b.bankFeeIncurred,
  bankBulkOrderId: (b: Batch) => b.bankBulkOrderId ?? "",
  packageRefNo: (b: Batch) => b.packageRefNo ?? "",
  failureReason: (b: Batch) => b.failureReason ?? "",
};

export function OverviewLatestTables({ batches }: { batches: Batch[] }) {
  const nav = useNavigate();
  const { sorted, sortKey, sortDir, requestSort } = useClientSort(batches, batchAccessors);

  return (
    <Zone
      title="ชุดล่าสุด"
      extra={
        <Button type="button" variant="outline" size="sm" className="type-label h-7" asChild>
          <Link to="/payouts/batches">ดูทั้งหมด</Link>
        </Button>
      }
    >
      <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
        <BatchTable
          rows={sorted}
          relaxed
          sort={{ sortKey, sortDir, onSort: requestSort }}
          onOpen={(id) => nav(`/payouts/batches/${id}`)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        10 ชุดใหม่สุดทั้งระบบ · ไม่ตามวันที่เลือก · สแนปชอตคิว ณ ตอนนี้ · poll 15 วินาที
      </p>
    </Zone>
  );
}
