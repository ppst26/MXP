import { merchById } from "../../mock/query";
import type { PayoutStatus } from "../../mock/types";
import { OverviewPeriodSection } from "../../features/overview/OverviewPeriodSection";
import { MerchantRealtimeZone } from "../../features/overview/MerchantRealtimeZone";
import { useOverviewData } from "../../features/overview/use-overview-data";
import { useScopedMerchantId } from "../../state/use-viewer";
import { useFilters } from "../../state/FilterProvider";

export function MerchantOverviewPage() {
  const merchantId = useScopedMerchantId();
  const shop = merchById(merchantId);
  const { setFilters, setPreset } = useFilters();
  const data = useOverviewData();

  const goList = (statuses: PayoutStatus[]) => {
    setPreset("d30");
    setFilters({ statuses, listPage: 1 });
    data.nav("/payouts");
  };

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">ภาพรวมเรียลไทม์</h1>
        <p className="page-description">
          {shop?.name ?? "ร้าน"} · DIRECT · ไม่เห็นบัญชีต้นทางและต้นทุนบ้าน
        </p>
      </header>

      <MerchantRealtimeZone
        books={data.books}
        pending={data.pending}
        processing={data.processing}
        review={data.review}
        held={data.held}
        onHeld={() => goList(["PENDING", "PROCESSING", "NEEDS_REVIEW"])}
        onGoList={goList}
      />

      <OverviewPeriodSection
        rows={data.rows}
        m={data.m}
        pm={data.pm}
        ts={data.ts}
        rateTs={data.rateTs}
        grain={data.grain}
        showHouse={false}
        showBatches={false}
        watch={null}
        onGoPayouts={(patch) => {
          setFilters({
            recipientBankCode: "",
            statuses: [],
            nameMismatch: false,
            ...patch,
            listPage: 1,
          });
          data.nav("/payouts");
        }}
        onPickMerchant={() => {}}
      />
    </>
  );
}
