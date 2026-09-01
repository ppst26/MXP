import { useNavigate } from "react-router-dom";
import { db } from "../mock/seed";
import { listPayouts, merchById, metrics } from "../mock/query";
import { useFilters } from "../state/FilterProvider";
import { useScopedMerchantId, useViewer } from "../state/use-viewer";
import { DateMerchantFilter } from "../layout/DateMerchantFilter";
import { PayoutFilterBar } from "../features/payouts/PayoutFilterBar";
import { PayoutSummary } from "../features/payouts/PayoutSummary";
import { PayoutTable } from "../features/payouts/PayoutTable";
import { Zone } from "@/components/metric-card";
import { Button } from "@/components/ui/button";

export function PayoutsPage() {
  const nav = useNavigate();
  const { isAdmin } = useViewer();
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
  const limit = 20;
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(filters.listPage, pages);
  const slice = rows.slice((page - 1) * limit, page * limit);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="page-title">รายการใบถอน</h1>
        <p className="text-sm text-muted-foreground">
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
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            หน้า {page} / {pages}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilters({ listPage: page - 1 })}>
              ก่อนหน้า
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setFilters({ listPage: page + 1 })}>
              ถัดไป
            </Button>
          </div>
        </div>
      </Zone>
    </div>
  );
}
