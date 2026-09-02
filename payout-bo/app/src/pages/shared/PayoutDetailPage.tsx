import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../mock/seed";
import { subtreeIds } from "../../mock/query";
import { useFilters } from "../../state/FilterProvider";
import { useScopedMerchantId, useViewer } from "../../state/use-viewer";
import { PayoutDetailView } from "../../features/payouts/PayoutDetailView";
import { DetailPageHeader, DetailPageShell } from "@/components/page-back-link";

export function PayoutDetailPage() {
  const { referenceId } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useViewer();
  const merchantId = useScopedMerchantId();
  const { setFilters } = useFilters();
  const p = db.payouts.find((x) => x.referenceId === referenceId);

  if (!p) {
    return (
      <DetailPageShell backTo="/payouts" backLabel="กลับรายการใบถอน">
        <DetailPageHeader>
          <h1 className="page-title">404</h1>
          <p className="text-sm text-muted-foreground">ไม่พบใบ</p>
        </DetailPageHeader>
      </DetailPageShell>
    );
  }

  const visible = isAdmin || (subtreeIds(merchantId)?.includes(p.merchantId) ?? false);
  if (!visible) {
    return (
      <DetailPageShell backTo="/payouts" backLabel="กลับรายการใบถอน">
        <DetailPageHeader>
          <h1 className="page-title">404</h1>
          <p className="text-sm text-muted-foreground">ไม่พบใบในสายร้านนี้</p>
        </DetailPageHeader>
      </DetailPageShell>
    );
  }

  const b = p.batchId ? db.batches.find((x) => x.id === p.batchId) ?? null : null;

  return (
    <PayoutDetailView
      payout={p}
      batch={b}
      isAdmin={isAdmin}
      onFilterBatch={(batchId) => {
        setFilters({ batchId, listPage: 1 });
        nav("/payouts");
      }}
    />
  );
}
