import { useNavigate } from "react-router-dom";
import { db } from "../mock/seed";
import {
  batchPeriodSummary,
  booksOf,
  effectiveSource,
  houseAlerts,
  merchantWatch,
  merchById,
  metrics,
  payoutsInPeriod,
  queueHeldOf,
  queuePayouts,
  timeseries,
  successRateTimeseries,
} from "../mock/query";
import type { PayoutStatus } from "../mock/types";
import { prevRange } from "../lib/bangkok";
import { useFilters } from "../state/FilterProvider";
import { useScopedMerchantId, useViewer } from "../state/use-viewer";
import { DateMerchantFilter } from "../layout/DateMerchantFilter";
import { HouseBanners } from "../features/overview/HouseBanners";
import { OverviewZone1 } from "../features/overview/OverviewZone1";
import { QueueCards } from "../features/overview/QueueCards";
import { MerchantBooksCards } from "../features/overview/MerchantBooksCards";
import { PeriodKpis } from "../features/overview/PeriodKpis";
import { ComparePairs } from "../features/overview/ComparePairs";
import { MerchantWatch } from "../features/overview/MerchantWatch";
import { Zone } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";

export function OverviewPage() {
  const nav = useNavigate();
  const { isAdmin, demo } = useViewer();
  const merchantId = useScopedMerchantId();
  const { filters, setFilters, setPreset } = useFilters();
  const shop = merchById(merchantId);
  const f = {
    from: filters.from,
    to: filters.to,
    merchantId,
    route: filters.route,
    statuses: filters.statuses,
    q: "",
    recipientAccount: "",
    nameMismatch: false,
  };
  const rows = payoutsInPeriod(db, f);
  const pr = prevRange(filters.from, filters.to);
  const prev = payoutsInPeriod(db, { ...f, from: pr.from, to: pr.to });
  const m = metrics(rows);
  const pm = metrics(prev);
  const q = queuePayouts(db, merchantId);
  const held = queueHeldOf(q);
  const books = booksOf(db, merchantId);
  const pending = q.filter((p) => p.status === "PENDING");
  const processing = q.filter((p) => p.status === "PROCESSING");
  const review = q.filter((p) => p.status === "NEEDS_REVIEW");
  const bOpen = db.batches.filter((b) => b.status === "PENDING");
  const bSend = db.batches.filter((b) => b.status === "SENDING" || b.status === "SENT");
  const bLook = db.batches.filter((b) => b.status === "NEEDS_REVIEW" || b.stuck);
  const bPeriod = db.batches.filter((b) => b.createdAt >= filters.from && b.createdAt < filters.to);
  const watch = isAdmin ? merchantWatch(rows, q, merchantId) : null;
  const ts = timeseries(db, filters.from, filters.to, f);
  const rateTs = successRateTimeseries(db, filters.from, filters.to, f);
  const source = isAdmin ? effectiveSource(db.source, demo, db.now) : null;
  const queueAmount = pending.concat(processing).reduce((s, p) => s + p.amount, 0);
  const alerts = isAdmin
    ? houseAlerts({
        source,
        pendingCount: pending.length,
        queueAmount,
        stuckBatchCount: db.batches.filter((b) => b.stuck).length,
        now: db.now,
      })
    : [];
  const bannerAlerts = source ? alerts : alerts.filter((a) => a.id !== "no-source");

  return (
    <>
      <div>
        <h1 className="font-heading text-xl tracking-tight">ภาพรวมโอนออก</h1>
        {isAdmin ? null : (
          <p className="text-sm text-muted-foreground">
            {shop?.name ?? "ร้าน"} · DIRECT · ไม่เห็นบัญชีต้นทางและต้นทุนบ้าน
          </p>
        )}
      </div>
      <DateMerchantFilter />
      {isAdmin ? (
        <OverviewZone1
          source={source}
          pending={pending}
          processing={processing}
          review={review}
          held={held}
          open={bOpen}
          inFlight={bSend}
          needsLook={bLook}
          onGoList={(statuses) => {
            setPreset("d30");
            setFilters({ statuses: statuses as PayoutStatus[], listPage: 1 });
            nav("/payouts");
          }}
          onGoBatches={(patch) => {
            setPreset("d30");
            setFilters({
              batchStatus: patch.batchStatus || "",
              batchStuck: patch.batchStuck || false,
            });
            nav("/payouts/batches");
          }}
        />
      ) : null}
      {isAdmin ? <HouseBanners alerts={bannerAlerts} /> : null}
      {!isAdmin || books ? (
        <Zone
          title="โซน 2 — งานค้างตอนนี้"
          extra={
            !isAdmin ? (
              <Badge variant="success">สแนปชอตคิว ณ ตอนนี้ · ไม่ตามวันที่เลือก · poll 15 วินาที</Badge>
            ) : null
          }
        >
          {books ? (
            <MerchantBooksCards
              books={books}
              onHeld={() => {
                setPreset("d30");
                setFilters({ statuses: ["PENDING", "PROCESSING", "NEEDS_REVIEW"], listPage: 1 });
                nav("/payouts");
              }}
            />
          ) : null}
          {!isAdmin ? (
            <QueueCards
              pending={pending}
              processing={processing}
              review={review}
              held={held}
              showHeld={!books}
              onGoList={(statuses) => {
                setPreset("d30");
                setFilters({ statuses: statuses as PayoutStatus[], listPage: 1 });
                nav("/payouts");
              }}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {books
              ? "แถวบนเป็นสมุดร้าน ไม่ตัดวันที่ · การ์ดคิวเป็นใบค้าง ไม่ใช่ยอดใช้ได้"
              : "ตัวเลขนี้ไม่เปลี่ยนเมื่อกดวันนี้/7 วัน — เป็นคิวค้างในระบบตอนนี้ ไม่ใช่รายงานตามช่วง"}
          </p>
        </Zone>
      ) : null}
      <Zone title="โซน 3 — ยอดช่วงที่เลือก" plain>
          <PeriodKpis
            m={m}
            pm={pm}
            batches={isAdmin ? batchPeriodSummary(bPeriod) : undefined}
            showHouseCost={isAdmin}
            showBatches={isAdmin}
          />
          <ComparePairs rows={rows} queue={q} ts={ts} rateTs={rateTs} m={m} pm={pm} showHouse={isAdmin} />
          {isAdmin ? <MerchantWatch rows={watch} onPick={(id) => setFilters({ merchantId: id })} /> : null}
      </Zone>
    </>
  );
}
