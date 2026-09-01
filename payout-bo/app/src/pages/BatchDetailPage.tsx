import { useNavigate, useParams } from "react-router-dom";
import { db } from "../mock/seed";
import { BatchDetailView } from "../features/batches/BatchDetailView";
import { DetailPageHeader, DetailPageShell } from "@/components/page-back-link";

export function BatchDetailPage() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const b = db.batches.find((x) => x.id === batchId) || db.batches[0];

  if (!b) {
    return (
      <DetailPageShell backTo="/payouts/batches" backLabel="กลับสู่รายการชุดโอน">
        <DetailPageHeader>
          <h1 className="page-title">ไม่พบชุด</h1>
        </DetailPageHeader>
      </DetailPageShell>
    );
  }

  const items = db.payouts.filter((p) => b.itemRefs.includes(p.referenceId));

  return (
    <BatchDetailView
      batch={b}
      items={items}
      source={db.source}
      onOpenPayout={(ref) => nav(`/payouts/${ref}`)}
    />
  );
}
