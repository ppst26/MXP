import type {
  Batch,
  Merchant,
  MerchantBooks,
  MerchantWatchRow,
  MockDb,
  PeriodMetrics,
  Payout,
  PayoutStatus,
  Route,
  SourceAccount,
} from "./types";
import { MERCHANTS } from "./seed";
import { NOW, addMs, fmtD, pad, prevRange, startOfDay } from "../lib/bangkok";

export type PayoutFilter = {
  from: Date;
  to: Date;
  merchantId: string;
  route: "" | Route;
  statuses: PayoutStatus[];
  q: string;
  recipientAccount: string;
  nameMismatch: boolean;
  batchId?: string;
};

export type BatchFilter = {
  from: Date;
  to: Date;
  status: string;
  q: string;
  stuck: boolean;
};

export function merchById(id: string): Merchant | undefined {
  return MERCHANTS.find((m) => m.id === id);
}

export function subtreeIds(id: string): string[] | null {
  if (!id) return null;
  const m = merchById(id);
  if (!m) return [id];
  if (m.role === "RESELLER") {
    return [id, ...MERCHANTS.filter((x) => x.parentId === id).map((x) => x.id)];
  }
  return [id];
}

function inMerchant(p: Payout, merchantId: string): boolean {
  const ids = subtreeIds(merchantId);
  if (!ids) return true;
  return ids.includes(p.merchantId);
}

export function metrics(rows: Payout[]): PeriodMetrics {
  const completed = rows.filter((p) => p.status === "COMPLETED");
  const failed = rows.filter((p) => p.status === "FAILED");
  const rejected = rows.filter((p) => p.status === "REJECTED");
  const incurredRows = completed.filter((p) => p.route === "INTERBANK");
  const exposed = rows.filter(
    (p) => (p.status === "PENDING" || p.status === "PROCESSING") && p.route === "INTERBANK",
  );
  const successDen = completed.length + failed.length;
  return {
    count: rows.length,
    amount: rows.reduce((s, p) => s + p.amount, 0),
    completedCount: completed.length,
    completedAmount: completed.reduce((s, p) => s + p.amount, 0),
    failedCount: failed.length,
    failedAmount: failed.reduce((s, p) => s + p.amount, 0),
    rejectedCount: rejected.length,
    rejectedAmount: rejected.reduce((s, p) => s + p.amount, 0),
    reservedFee: rows.reduce((s, p) => s + p.reservedFee, 0),
    successRate: successDen ? completed.length / successDen : 0,
    incurred: incurredRows.length * 5,
    incurredCount: incurredRows.length,
    sameBank: rows.filter((p) => p.route === "SAME_BANK").length,
    interbank: rows.filter((p) => p.route === "INTERBANK").length,
    exposed: exposed.length * 5,
  };
}

/** โซน 3 — ตัดช่วงวันที่ + ร้าน + เส้นทาง + สถานะ */
export function payoutsInPeriod(db: MockDb, f: PayoutFilter): Payout[] {
  return db.payouts.filter((p) => {
    if (p.createdAt < f.from || p.createdAt >= f.to) return false;
    if (!inMerchant(p, f.merchantId)) return false;
    if (f.route && p.route !== f.route) return false;
    if (f.statuses.length && !f.statuses.includes(p.status)) return false;
    return true;
  });
}

/** โซน 2 — คิวตอนนี้ ไม่ตัด from/to */
export function queuePayouts(db: MockDb, merchantId: string): Payout[] {
  return db.payouts.filter(
    (p) =>
      inMerchant(p, merchantId) &&
      (p.status === "PENDING" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW"),
  );
}

export function listPayouts(db: MockDb, f: PayoutFilter): Payout[] {
  return db.payouts
    .filter((p) => {
      if (p.createdAt < f.from || p.createdAt >= f.to) return false;
      if (!inMerchant(p, f.merchantId)) return false;
      if (f.route && p.route !== f.route) return false;
      if (f.statuses.length && !f.statuses.includes(p.status)) return false;
      if (f.q) {
        const q = f.q.trim();
        if (p.referenceId !== q && p.transactionId !== q) return false;
      }
      if (f.recipientAccount && p.recipientAccountNo !== f.recipientAccount.trim()) return false;
      if (f.nameMismatch && !p.nameMismatch) return false;
      if (f.batchId && p.batchId !== f.batchId) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function listBatches(db: MockDb, f: BatchFilter): Batch[] {
  return db.batches
    .filter((b) => {
      if (b.createdAt < f.from || b.createdAt >= f.to) return false;
      if (f.status && b.status !== f.status) return false;
      if (f.stuck && !b.stuck && b.status !== "NEEDS_REVIEW") return false;
      if (f.q) {
        const q = f.q.trim();
        if (b.id !== q && b.bankBulkOrderId !== q && b.packageRefNo !== q) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function merchantWatch(periodRows: Payout[], queueRows: Payout[], merchantId: string): MerchantWatchRow[] | null {
  const selected = merchById(merchantId);
  if (selected?.role === "DIRECT") return null;
  const directs = MERCHANTS.filter((m) => {
    if (m.role !== "DIRECT") return false;
    if (!merchantId) return true;
    return subtreeIds(merchantId)?.includes(m.id);
  });
  return directs
    .map((m) => {
      const period = periodRows.filter((p) => p.merchantId === m.id);
      const qq = queueRows.filter((p) => p.merchantId === m.id);
      const met = metrics(period);
      const pending = qq.filter((p) => p.status === "PENDING");
      const review = qq.filter((p) => p.status === "NEEDS_REVIEW");
      const held = qq
        .filter((p) => p.status === "PENDING" || p.status === "PROCESSING")
        .reduce((s, p) => s + p.amount + p.reservedFee, 0);
      const oldest = pending.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      const oldestMin = oldest ? Math.round((NOW.getTime() - oldest.createdAt.getTime()) / 60000) : null;
      const alertScore =
        review.length * 100 + (oldestMin != null && oldestMin >= 30 ? 50 : 0) + met.failedCount * 10 + pending.length;
      return {
        id: m.id,
        name: m.name,
        code: m.code,
        completedCount: met.completedCount,
        completedAmount: met.completedAmount,
        failed: met.failedCount,
        review: review.length,
        pending: pending.length,
        held,
        oldestMin,
        alertScore,
      };
    })
    .sort((a, b) => b.alertScore - a.alertScore || b.completedAmount - a.completedAmount)
    .slice(0, 8);
}

export function timeseries(db: MockDb, from: Date, to: Date, f: PayoutFilter) {
  const hours = to.getTime() - from.getTime() <= 48 * 3600 * 1000;
  const buckets: { t: Date; label: string }[] = [];
  if (hours) {
    let t = new Date(from);
    t.setMinutes(0, 0, 0);
    while (t < to) {
      buckets.push({ t: new Date(t), label: pad(t.getHours()) + "น." });
      t = addMs(t, 3600000);
    }
  } else {
    let t = startOfDay(from);
    while (t < to) {
      buckets.push({ t: new Date(t), label: fmtD(t).slice(8) });
      t = addMs(t, 86400000);
    }
  }
  const pr = prevRange(from, to);
  const curRows = payoutsInPeriod(db, { ...f, from, to });
  const prevRows = payoutsInPeriod(db, { ...f, from: pr.from, to: pr.to });
  const step = hours ? 3600000 : 86400000;
  const amt = (rows: Payout[], start: Date, end: Date) =>
    rows
      .filter((p) => p.status === "COMPLETED" && p.createdAt >= start && p.createdAt < end)
      .reduce((s, p) => s + p.amount, 0);
  return buckets.map((b, i) => {
    const end = addMs(b.t, step);
    const prevStart = addMs(pr.from, i * step);
    return { label: b.label, current: amt(curRows, b.t, end), previous: amt(prevRows, prevStart, addMs(prevStart, step)) };
  });
}

export function queueAge(rows: Payout[], now = NOW) {
  const buckets = [
    { label: "< 1 น.", max: 60 },
    { label: "1–5 น.", max: 300 },
    { label: "5–30 น.", max: 1800 },
    { label: "30 น.–2 ชม.", max: 7200 },
    { label: "> 2 ชม.", max: Infinity },
  ];
  const open = rows.filter(
    (p) => p.status === "PENDING" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW",
  );
  return buckets.map((b, i) => {
    const min = i === 0 ? 0 : buckets[i - 1]!.max;
    const count = open.filter((p) => {
      const sec = (now.getTime() - p.createdAt.getTime()) / 1000;
      return sec >= min && sec < b.max;
    }).length;
    return { ...b, count };
  });
}

export function sumAmt(rows: Payout[]): number {
  return rows.reduce((s, p) => s + p.amount, 0);
}

const HOLDS = new Set<PayoutStatus>(["PENDING", "PROCESSING", "NEEDS_REVIEW"]);

/** กันเงินในสมุด = ใบที่ยังไม่จบและยังไม่คืน operate */
export function pendingPayoutOf(payouts: Payout[], merchantId: string): number {
  return payouts
    .filter((p) => p.merchantId === merchantId && HOLDS.has(p.status))
    .reduce((s, p) => s + p.amount + p.reservedFee, 0);
}

/** การ์ดคิว B2.1 — ยังไม่รวม NEEDS_REVIEW */
export function queueHeldOf(rows: Payout[]): number {
  return rows
    .filter((p) => p.status === "PENDING" || p.status === "PROCESSING")
    .reduce((s, p) => s + p.amount + p.reservedFee, 0);
}

/** สมุดร้าน DIRECT ร้านเดียว — ตัวแทน/ทุกร้าน = null ห้ามบวกข้ามร้าน */
export function booksOf(db: MockDb, merchantId: string): MerchantBooks | null {
  if (!merchantId) return null;
  const m = merchById(merchantId);
  if (!m || m.role !== "DIRECT") return null;
  const seed = db.books[merchantId];
  if (!seed) return null;
  const pendingPayout = pendingPayoutOf(db.payouts, merchantId);
  const freezeBalance = seed.freeze + pendingPayout;
  return {
    merchantId,
    operate: seed.operate,
    parking: seed.parking,
    freeze: seed.freeze,
    pendingPayout,
    freezeBalance,
    balance: seed.operate + seed.parking + freezeBalance,
  };
}

export const BALANCE_MAX_AGE_MS = 5 * 60 * 1000;

export type HouseDemo = {
  sendOff: boolean;
  staleBalance: boolean;
  noSource: boolean;
  queueExceeds: boolean;
};

export type HouseAlert = { id: string; level: "warn" | "alert"; text: string };

export function effectiveSource(source: SourceAccount, demo: HouseDemo, now: Date): SourceAccount | null {
  if (demo.noSource) return null;
  return {
    ...source,
    sendEnabled: source.sendEnabled && !demo.sendOff,
    bankBalanceAt: demo.staleBalance ? new Date(now.getTime() - 2 * 3600 * 1000) : source.bankBalanceAt,
    bankBalance: demo.queueExceeds ? 1000 : source.bankBalance,
  };
}

export function houseAlerts(args: {
  source: SourceAccount | null;
  pendingCount: number;
  queueAmount: number;
  stuckBatchCount: number;
  now: Date;
}): HouseAlert[] {
  const out: HouseAlert[] = [];
  if (!args.source) {
    out.push({ id: "no-source", level: "alert", text: "ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชี" });
    return out;
  }
  const src = args.source;
  if (!src.sendEnabled && args.pendingCount > 0) {
    out.push({
      id: "send-off",
      level: "warn",
      text: `ส่งเงินปิดอยู่ แต่มีใบรอส่ง ${args.pendingCount} ใบ คิวจะไม่ถูกหยิบ`,
    });
  }
  if (args.now.getTime() - src.bankBalanceAt.getTime() > BALANCE_MAX_AGE_MS) {
    out.push({ id: "stale", level: "warn", text: "ยอดธนาคารเก่ากว่าเกณฑ์ ห้ามอ่านว่าพอจ่าย" });
  }
  if (args.stuckBatchCount > 0) {
    out.push({
      id: "stuck",
      level: "alert",
      text: `มีชุด SENDING/SENT ค้างเกินเกณฑ์ ${args.stuckBatchCount} ชุด`,
    });
  }
  if (src.bankBalance < args.queueAmount + src.minBalance) {
    out.push({
      id: "short",
      level: "alert",
      text: "บัญชีต้นทางไม่พอจ่ายทั้งคิว + เงินสำรอง — จะส่งเท่าที่พอ คิวที่เหลือจะนิ่ง",
    });
  }
  return out;
}

export const MOCK_DIRECT_USER = "m-acme";
