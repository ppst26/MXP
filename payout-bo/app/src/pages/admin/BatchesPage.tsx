import { useNavigate } from "react-router-dom";
import { db } from "../../mock/seed";
import { listBatches } from "../../mock/query";
import type { Batch } from "../../mock/types";
import { paginate } from "../../lib/pagination";
import { useClientSort } from "../../hooks/use-client-sort";
import { useFilters } from "../../state/FilterProvider";
import { BatchFilterBar } from "../../features/batches/BatchFilterBar";
import { BatchSummary, BatchTable } from "../../features/batches/BatchTable";
import { Zone } from "@/components/metric-card";
import { TablePagination } from "@/components/table-pagination";

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

export function AdminBatchesPage() {
  const nav = useNavigate();
  const { filters, setFilters, setPreset } = useFilters();
  const rows = listBatches(db, {
    from: filters.from,
    to: filters.to,
    status: filters.batchStatus,
    q: filters.batchQ,
    stuck: filters.batchStuck,
  });
  const { sorted, sortKey, sortDir, requestSort } = useClientSort(rows, batchAccessors);
  const { slice, page, pages, total } = paginate(sorted, filters.batchListPage, filters.batchListPageSize);

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <h1 className="page-title">รายการชุดโอน</h1>
        <p className="page-description">
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
          setFilters({ batchStuck: true, batchListPage: 1 });
        }}
      />

      <Zone title="ตารางชุด">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          <BatchTable
            rows={slice}
            relaxed
            sort={{ sortKey, sortDir, onSort: requestSort }}
            onOpen={(id) => nav(`/payouts/batches/${id}`)}
          />
        </div>
        <TablePagination
          page={page}
          pages={pages}
          pageSize={filters.batchListPageSize}
          total={total}
          onPageChange={(batchListPage) => setFilters({ batchListPage })}
          onPageSizeChange={(batchListPageSize) => setFilters({ batchListPageSize, batchListPage: 1 })}
        />
        <p className="text-xs text-muted-foreground">แถว FAILED ของชุด ≠ ใบล้ม · ใบถูกปล่อยกลับคิวรอส่ง</p>
      </Zone>
    </div>
  );
}
