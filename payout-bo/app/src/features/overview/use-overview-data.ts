import { useNavigate } from "react-router-dom";
import { db } from "../../mock/seed";
import {
  batchPeriodSummary,
  booksOf,
  effectiveSource,
  houseAlerts,
  latestBatches,
  merchantWatch,
  metrics,
  payoutsInPeriod,
  queueHeldOf,
  queuePayouts,
  timeseries,
  successRateTimeseries,
} from "../../mock/query";
import { prevRange } from "../../lib/bangkok";
import { useFilters } from "../../state/FilterProvider";
import { useScopedMerchantId, useViewer } from "../../state/use-viewer";

export function useOverviewData() {
  const nav = useNavigate();
  const { demo } = useViewer();
  const merchantId = useScopedMerchantId();
  const { filters, setFilters, setPreset } = useFilters();

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
  const watch = merchantWatch(rows, q, merchantId);
  const ts = timeseries(db, filters.from, filters.to, f);
  const rateTs = successRateTimeseries(db, filters.from, filters.to, f);
  const source = effectiveSource(db.source, demo, db.now);
  const queueAmount = pending.concat(processing).reduce((s, p) => s + p.amount, 0);
  const alerts = houseAlerts({
    source,
    pendingCount: pending.length,
    queueAmount,
    stuckBatchCount: db.batches.filter((b) => b.stuck).length,
    now: db.now,
  });
  const bannerAlerts = (source ? alerts : alerts.filter((a) => a.id !== "no-source")).filter((a) => a.id !== "stuck");
  const grain = filters.to.getTime() - filters.from.getTime() <= 48 * 3600 * 1000 ? ("hour" as const) : ("day" as const);
  const latestBatchRows = latestBatches(db, 10);

  return {
    nav,
    filters,
    setFilters,
    setPreset,
    rows,
    m,
    pm,
    ts,
    rateTs,
    held,
    books,
    pending,
    processing,
    review,
    bOpen,
    bSend,
    bLook,
    bPeriod,
    batchSummary: batchPeriodSummary(bPeriod),
    watch,
    source,
    bannerAlerts,
    grain,
    latestBatchRows,
  };
}
