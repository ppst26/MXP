import { useNavigate } from "react-router-dom";
import { db } from "../../mock/seed";
import { listPayouts, merchById, metrics } from "../../mock/query";
import type { Payout } from "../../mock/types";
import { paginate } from "../../lib/pagination";
import { useClientSort } from "../../hooks/use-client-sort";
import { useFilters } from "../../state/FilterProvider";
import { useScopedMerchantId } from "../../state/use-viewer";
import { DateMerchantFilter } from "../../layout/DateMerchantFilter";
import { PayoutFilterBar } from "./PayoutFilterBar";
import { PayoutSummary } from "./PayoutSummary";
import { PayoutTable } from "./PayoutTable";
import { Zone } from "@/components/metric-card";
import { TablePagination } from "@/components/table-pagination";

const payoutAccessors = {
  createdAt: (p: Payout) => p.createdAt.getTime(),
  merchant: (p: Payout) => p.merchantName,
  referenceId: (p: Payout) => p.referenceId,
  transactionId: (p: Payout) => p.transactionId,
  amount: (p: Payout) => p.amount,
  reservedFee: (p: Payout) => p.reservedFee,
  status: (p: Payout) => p.status,
  bankFee: (p: Payout) => p.bankFee,
  recipient: (p: Payout) => p.recipientAccountNo,
  accountToName: (p: Payout) => p.accountToName ?? "",
  batchId: (p: Payout) => p.batchId ?? "",
  failureReason: (p: Payout) => p.failureReason ?? "",
};

type Props = {
  variant: "admin" | "merchant";
};

export function PayoutsPageContent({ variant }: Props) {
  const nav = useNavigate();
  const isAdmin = variant === "admin";
  const merchantId = useScopedMerchantId();
  const { filters, setFilters } = useFilters();
  const shop = merchById(merchantId);
  const rows = listPayouts(db, {
    from: filters.from,
    to: filters.to,
    merchantId,
    route: filters.route,
    statuses: filters.statuses,
    q: filters.q,
    recipientAccount: filters.recipientAccount,
    nameMismatch: filters.nameMismatch,
    recipientBankCode: filters.recipientBankCode || undefined,
    batchId: filters.batchId || undefined,
  });
  const m = metrics(rows);
  const { sorted, sortKey, sortDir, requestSort } = useClientSort(rows, payoutAccessors);
  const { slice, page, pages, total } = paginate(sorted, filters.listPage, filters.listPageSize);

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <h1 className="page-title">รายการใบถอน</h1>
        <p className="page-description">
          พบ {rows.length} ใบ ตามตัวกรอง ·{" "}
          {isAdmin ? `ทั้งระบบ ${db.payouts.length} ใบ` : `${shop?.name ?? "ร้าน"} · ใบในสายนี้เท่านั้น`}
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-label="ตัวกรอง">
        <DateMerchantFilter />
        <PayoutFilterBar />
      </section>

      <PayoutSummary m={m} showBankFee={isAdmin} />

      <Zone title="ตารางใบ">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          <PayoutTable
            rows={slice}
            relaxed
            showBankFee={isAdmin}
            sort={{ sortKey, sortDir, onSort: requestSort }}
            onOpen={(ref) => nav(`/payouts/${ref}`)}
            onOpenBatch={
              isAdmin
                ? undefined
                : (id) => {
                    setFilters({ batchId: id, listPage: 1 });
                    nav("/payouts");
                  }
            }
          />
        </div>
        <TablePagination
          page={page}
          pages={pages}
          pageSize={filters.listPageSize}
          total={total}
          onPageChange={(listPage) => setFilters({ listPage })}
          onPageSizeChange={(listPageSize) => setFilters({ listPageSize, listPage: 1 })}
        />
      </Zone>
    </div>
  );
}
