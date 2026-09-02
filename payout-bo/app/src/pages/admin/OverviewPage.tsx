import type { PayoutStatus } from "../../mock/types";
import { HouseBanners } from "../../features/overview/HouseBanners";
import { OverviewPeriodSection } from "../../features/overview/OverviewPeriodSection";
import { OverviewZone1 } from "../../features/overview/OverviewZone1";
import { OverviewLatestTables } from "../../features/overview/OverviewLatestTables";
import { MerchantBooksCards } from "../../features/overview/MerchantBooksCards";
import { useOverviewData } from "../../features/overview/use-overview-data";
import { useFilters } from "../../state/FilterProvider";
import { Zone } from "@/components/metric-card";

export function AdminOverviewPage() {
  const { setFilters, setPreset } = useFilters();
  const data = useOverviewData();

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">ภาพรวมเรียลไทม์</h1>
      </header>
      <OverviewZone1
        source={data.source}
        pending={data.pending}
        processing={data.processing}
        review={data.review}
        held={data.held}
        open={data.bOpen}
        inFlight={data.bSend}
        needsLook={data.bLook}
        onGoList={(statuses) => {
          setPreset("d30");
          setFilters({ statuses: statuses as PayoutStatus[], listPage: 1 });
          data.nav("/payouts");
        }}
        onGoBatches={(patch) => {
          setPreset("d30");
          setFilters({
            batchStatus: patch.batchStatus || "",
            batchStuck: patch.batchStuck || false,
          });
          data.nav("/payouts/batches");
        }}
      />
      <HouseBanners alerts={data.bannerAlerts} />
      <OverviewLatestTables batches={data.latestBatchRows} />
      {data.books ? (
        <Zone title="โซน 2 — งานค้างตอนนี้">
          <MerchantBooksCards
            books={data.books}
            onHeld={() => {
              setPreset("d30");
              setFilters({ statuses: ["PENDING", "PROCESSING", "NEEDS_REVIEW"], listPage: 1 });
              data.nav("/payouts");
            }}
          />
          <p className="text-xs text-muted-foreground">
            แถวบนเป็นสมุดร้าน ไม่ตัดวันที่ · การ์ดคิวเป็นใบค้าง ไม่ใช่ยอดใช้ได้
          </p>
        </Zone>
      ) : null}
      <OverviewPeriodSection
        rows={data.rows}
        m={data.m}
        pm={data.pm}
        ts={data.ts}
        rateTs={data.rateTs}
        grain={data.grain}
        showHouse
        showBatches
        batches={data.batchSummary}
        watch={data.watch}
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
        onPickMerchant={(id) => setFilters({ merchantId: id })}
      />
    </>
  );
}
