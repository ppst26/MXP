import type { BatchPeriodSummary, MerchantWatchRow, Payout, PeriodMetrics } from "../../mock/types";
import type { successRateTimeseries, timeseries } from "../../mock/query";
import { DateMerchantFilter } from "../../layout/DateMerchantFilter";
import { Zone } from "@/components/metric-card";
import { ComparePairs, type PeriodPayoutPatch } from "./ComparePairs";
import { MerchantWatch } from "./MerchantWatch";
import { PeriodKpis } from "./PeriodKpis";

type Props = {
  rows: Payout[];
  m: PeriodMetrics;
  pm: PeriodMetrics;
  ts: ReturnType<typeof timeseries>;
  rateTs: ReturnType<typeof successRateTimeseries>;
  grain: "hour" | "day";
  showHouse: boolean;
  showBatches: boolean;
  batches?: BatchPeriodSummary;
  watch: MerchantWatchRow[] | null;
  onGoPayouts: (patch: PeriodPayoutPatch) => void;
  onPickMerchant: (id: string) => void;
};

export function OverviewPeriodSection({
  rows,
  m,
  pm,
  ts,
  rateTs,
  grain,
  showHouse,
  showBatches,
  batches,
  watch,
  onGoPayouts,
  onPickMerchant,
}: Props) {
  return (
    <Zone
      title="สรุปตามช่วงเวลา"
      plain
      className="border-t border-border pt-4"
      titleClassName="page-title"
      toolbar={<DateMerchantFilter />}
    >
      <PeriodKpis m={m} pm={pm} batches={batches} showBatches={showBatches} />
      <ComparePairs
        rows={rows}
        ts={ts}
        rateTs={rateTs}
        m={m}
        pm={pm}
        showHouse={showHouse}
        grain={grain}
        onGoPayouts={onGoPayouts}
        onPickMerchant={onPickMerchant}
      />
      {watch ? <MerchantWatch rows={watch} onPick={onPickMerchant} /> : null}
    </Zone>
  );
}
