import type {
  Batch,
  BatchPeriodSummary,
  BoUser,
  Inbox,
  InboxItem,
  InboxTone,
  LoginEvent,
  LoginResult,
  LoginStage,
  Merchant,
  MerchantBooks,
  MerchantWatchRow,
  MerchantPeriodFee,
  MockDb,
  PeriodMetrics,
  Payout,
  PayoutStatus,
  Route,
  SourceAccount,
  TopUpEvent,
} from "./types";
import { MERCHANTS, SETTLEMENT_ACCOUNT_SEED } from "./seed";
import { NOW, addMs, fmtD, pad, prevRange, startOfDay } from "../lib/bangkok";
import { STUCK_BATCH_LABEL } from "../lib/copy";
import { money } from "../lib/money";

export type PayoutFilter = {
  from: Date;
  to: Date;
  merchantId: string;
  route: "" | Route;
  statuses: PayoutStatus[];
  q: string;
  recipientAccount: string;
  nameMismatch: boolean;
  recipientBankCode?: string;
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

const INTERBANK_FEE_ESTIMATE = 5;
export const INTERBANK_FEE = INTERBANK_FEE_ESTIMATE;

function countableBankFeeRows(rows: Payout[]): Payout[] {
  return rows.filter(
    (p) =>
      (p.status === "COMPLETED" && p.route === "INTERBANK") || (p.status === "FAILED" && p.bankFee > 0),
  );
}

function rowBankFee(p: Payout): { amount: number; estimated: boolean } {
  if (p.status === "COMPLETED" && p.route === "INTERBANK") {
    if (!p.bankFeeEstimated) return { amount: p.bankFee, estimated: false };
    return { amount: INTERBANK_FEE_ESTIMATE, estimated: true };
  }
  if (p.status === "FAILED" && p.bankFee > 0) {
    return { amount: p.bankFee, estimated: p.bankFeeEstimated };
  }
  return { amount: 0, estimated: true };
}

export function metrics(rows: Payout[]): PeriodMetrics {
  const completed = rows.filter((p) => p.status === "COMPLETED");
  const failed = rows.filter((p) => p.status === "FAILED");
  const rejected = rows.filter((p) => p.status === "REJECTED");
  const feeRows = countableBankFeeRows(rows);
  const feeParts = feeRows.map(rowBankFee);
  const incurredCount = feeRows.length;
  const incurredEstimate = incurredCount * INTERBANK_FEE_ESTIMATE;
  const incurred = feeParts.reduce((s, f) => s + f.amount, 0);
  const bankFeeAllEstimated = feeParts.every((f) => f.estimated);
  const hasRealBankFee = feeParts.some((f) => !f.estimated);
  const bankFeeDelta = hasRealBankFee ? incurred - incurredEstimate : null;
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
    incurred,
    incurredCount,
    incurredEstimate,
    bankFeeDelta,
    bankFeeAllEstimated: bankFeeAllEstimated || incurredCount === 0,
    sameBank: rows.filter((p) => p.route === "SAME_BANK").length,
    interbank: rows.filter((p) => p.route === "INTERBANK").length,
    exposed: exposed.length * INTERBANK_FEE_ESTIMATE,
  };
}

export function merchantPeriodFees(rows: Payout[]): MerchantPeriodFee[] {
  const map = new Map<string, MerchantPeriodFee>();
  for (const p of rows) {
    const cur = map.get(p.merchantId) ?? {
      id: p.merchantId,
      name: p.merchantName,
      code: p.merchantCode,
      amount: 0,
      reservedFee: 0,
      incurred: 0,
      incurredCount: 0,
      interbankCount: 0,
    };
    cur.amount += p.amount;
    cur.reservedFee += p.reservedFee;
    if (p.route === "INTERBANK") cur.interbankCount += 1;
    if (countableBankFeeRows([p]).length) {
      cur.incurred += rowBankFee(p).amount;
      cur.incurredCount += 1;
    }
    map.set(p.merchantId, cur);
  }
  return [...map.values()];
}

export function batchPeriodSummary(batches: Batch[]): BatchPeriodSummary {
  return {
    total: batches.length,
    settled: batches.filter((b) => b.status === "SETTLED").length,
    sending: batches.filter((b) => b.status === "SENDING").length,
    sent: batches.filter((b) => b.status === "SENT").length,
    pending: batches.filter((b) => b.status === "PENDING").length,
    needsReview: batches.filter((b) => b.status === "NEEDS_REVIEW").length,
    failed: batches.filter((b) => b.status === "FAILED").length,
    stuck: batches.filter((b) => b.stuck).length,
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
      if (f.recipientBankCode && p.recipientBankCode !== f.recipientBankCode) return false;
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
  const { buckets, step } = timeBuckets(from, to);
  const pr = prevRange(from, to);
  const curRows = payoutsInPeriod(db, { ...f, from, to });
  const prevRows = payoutsInPeriod(db, { ...f, from: pr.from, to: pr.to });
  const completed = (rows: Payout[], start: Date, end: Date) =>
    rows.filter((p) => p.status === "COMPLETED" && p.createdAt >= start && p.createdAt < end);
  const batchCount = (start: Date, end: Date) =>
    db.batches.filter((b) => b.createdAt >= start && b.createdAt < end).length;
  const inBucket = (rows: Payout[], start: Date, end: Date) =>
    rows.filter((p) => p.createdAt >= start && p.createdAt < end);
  return buckets.map((b, i) => {
    const end = addMs(b.t, step);
    const prevStart = addMs(pr.from, i * step);
    const prevEnd = addMs(prevStart, step);
    const cur = completed(curRows, b.t, end);
    const prev = completed(prevRows, prevStart, prevEnd);
    return {
      label: b.label,
      current: cur.reduce((s, p) => s + p.amount, 0),
      previous: prev.reduce((s, p) => s + p.amount, 0),
      countCurrent: cur.length,
      countPrevious: prev.length,
      batchCurrent: batchCount(b.t, end),
      batchPrevious: batchCount(prevStart, prevEnd),
      feeCurrent: inBucket(curRows, b.t, end).reduce((s, p) => s + p.reservedFee, 0),
      feePrevious: inBucket(prevRows, prevStart, prevEnd).reduce((s, p) => s + p.reservedFee, 0),
    };
  });
}

export function successRateTimeseries(db: MockDb, from: Date, to: Date, f: PayoutFilter) {
  const { buckets, step } = timeBuckets(from, to);
  const pr = prevRange(from, to);
  const curRows = payoutsInPeriod(db, { ...f, from, to });
  const prevRows = payoutsInPeriod(db, { ...f, from: pr.from, to: pr.to });
  const ratePct = (rows: Payout[], start: Date, end: Date) => {
    const slice = rows.filter((p) => p.createdAt >= start && p.createdAt < end);
    const completed = slice.filter((p) => p.status === "COMPLETED").length;
    const failed = slice.filter((p) => p.status === "FAILED").length;
    const den = completed + failed;
    return den ? (completed / den) * 100 : null;
  };
  return buckets.map((b, i) => {
    const end = addMs(b.t, step);
    const prevStart = addMs(pr.from, i * step);
    return {
      label: b.label,
      current: ratePct(curRows, b.t, end),
      previous: ratePct(prevRows, prevStart, addMs(prevStart, step)),
    };
  });
}

function timeBuckets(from: Date, to: Date) {
  const hours = to.getTime() - from.getTime() <= 48 * 3600 * 1000;
  const buckets: { t: Date; label: string }[] = [];
  const step = hours ? 3600000 : 86400000;
  if (hours) {
    let t = new Date(from);
    t.setMinutes(0, 0, 0);
    while (t < to) {
      buckets.push({ t: new Date(t), label: `${pad(t.getHours())}:00` });
      t = addMs(t, step);
    }
  } else {
    let t = startOfDay(from);
    while (t < to) {
      buckets.push({ t: new Date(t), label: fmtD(t).slice(8) });
      t = addMs(t, step);
    }
  }
  return { buckets, step, hours };
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
  const settlementAccount = SETTLEMENT_ACCOUNT_SEED[merchantId] ?? null;
  return {
    merchantId,
    operate: seed.operate,
    parking: seed.parking,
    freeze: seed.freeze,
    pendingPayout,
    freezeBalance,
    balance: seed.operate + seed.parking + freezeBalance,
    settlementAccount,
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
      text: `${STUCK_BATCH_LABEL} · ${args.stuckBatchCount} ชุด`,
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

export type BoUserTab = "merchant" | "admin";

export type BoUserFilter = {
  tab: BoUserTab;
  merchantId: string;
  q: string;
  isAdmin: boolean;
};

export type ShopUserSummary = {
  merchantId: string;
  name: string;
  code: string;
  accountCount: number;
  adminCount: number;
  lastLoginAt: Date | null;
};

export function listShopMembers(users: BoUser[], merchantId: string, q: string): BoUser[] {
  const needle = q.trim().toLowerCase();
  return users
    .filter((u) => u.kind === "merchant" && u.merchantId === merchantId)
    .filter((u) => {
      if (!needle) return true;
      return `${u.username} ${u.displayName}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      const ta = a.lastLoginAt?.getTime() ?? 0;
      const tb = b.lastLoginAt?.getTime() ?? 0;
      return tb - ta;
    });
}

export function listShopUserSummaries(
  users: BoUser[],
  args: { merchantId: string; q: string; nameOf?: (merchantId: string) => string },
): ShopUserSummary[] {
  const members = listBoUsers(users, {
    tab: "merchant",
    merchantId: args.merchantId,
    q: "",
    isAdmin: true,
  });
  const grouped = new Map<string, BoUser[]>();
  for (const u of members) {
    if (!u.merchantId) continue;
    const list = grouped.get(u.merchantId);
    if (list) list.push(u);
    else grouped.set(u.merchantId, [u]);
  }
  const needle = args.q.trim().toLowerCase();
  const nameOf = args.nameOf ?? ((id: string) => merchById(id)?.name ?? id);
  return [...grouped.entries()]
    .map(([merchantId, list]) => {
      const shop = merchById(merchantId);
      const lastLoginAt = list.reduce<Date | null>((latest, u) => {
        if (!u.lastLoginAt) return latest;
        if (!latest || u.lastLoginAt.getTime() > latest.getTime()) return u.lastLoginAt;
        return latest;
      }, null);
      return {
        merchantId,
        name: nameOf(merchantId),
        code: shop?.code ?? "",
        accountCount: list.length,
        adminCount: list.filter((u) => u.role === "shop_admin").length,
        lastLoginAt,
      };
    })
    .filter((row) => {
      if (!needle) return true;
      return `${row.name} ${row.code}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      const ta = a.lastLoginAt?.getTime() ?? 0;
      const tb = b.lastLoginAt?.getTime() ?? 0;
      return tb - ta;
    });
}

export function listBoUsers(users: BoUser[], args: BoUserFilter): BoUser[] {
  const q = args.q.trim().toLowerCase();
  const ids = subtreeIds(args.merchantId);
  return users
    .filter((u) => {
      if (args.tab === "admin") {
        if (args.isAdmin) return u.kind === "platform";
        return u.kind === "merchant" && u.role === "shop_admin";
      }
      if (u.kind !== "merchant") return false;
      if (!args.isAdmin && u.role !== "user") return false;
      return true;
    })
    .filter((u) => {
      if (!args.isAdmin) return u.merchantId === MOCK_DIRECT_USER;
      if (args.tab === "admin") return true;
      if (!ids) return true;
      return u.merchantId != null && ids.includes(u.merchantId);
    })
    .filter((u) => {
      if (!q) return true;
      const shop = u.merchantId ? merchById(u.merchantId) : undefined;
      const hay = `${u.username} ${u.displayName} ${shop?.name ?? ""} ${shop?.code ?? ""} แพลตฟอร์ม`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      const ta = a.lastLoginAt?.getTime() ?? 0;
      const tb = b.lastLoginAt?.getTime() ?? 0;
      return tb - ta;
    });
}

export type LoginEventFilter = {
  from: Date;
  to: Date;
  merchantId: string;
  userId: string;
  result: "" | LoginResult;
  stage: "" | LoginStage;
  isAdmin: boolean;
};

export function listLoginEvents(events: LoginEvent[], args: LoginEventFilter): LoginEvent[] {
  const ids = subtreeIds(args.merchantId);
  return events
    .filter((e) => e.at.getTime() >= args.from.getTime() && e.at.getTime() <= args.to.getTime())
    .filter((e) => {
      if (args.userId) return e.userId === args.userId;
      return true;
    })
    .filter((e) => (args.result ? e.result === args.result : true))
    .filter((e) => (args.stage ? e.stage === args.stage : true))
    .filter((e) => {
      if (!args.isAdmin) {
        return e.merchantId === MOCK_DIRECT_USER;
      }
      if (!ids) return true;
      return e.merchantId != null && ids.includes(e.merchantId);
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function passwordFailShops(events: LoginEvent[], min = 3): { merchantId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.result !== "failed" || e.stage !== "password" || !e.merchantId) continue;
    counts.set(e.merchantId, (counts.get(e.merchantId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= min)
    .map(([merchantId, count]) => ({ merchantId, count }))
    .sort((a, b) => b.count - a.count);
}

const OPERATE_LOW = 50_000;

export type ListInboxArgs = {
  isAdmin: boolean;
  merchantId: string;
  demo: HouseDemo;
};

function batchAt(b: Batch): Date {
  return b.settledAt ?? b.confirmedAt ?? b.sentAt ?? b.createdAt;
}

function payoutAt(p: Payout): Date {
  return p.updatedAt ?? p.confirmedAt ?? p.createdAt;
}

function poolLowItem(db: MockDb, demo: HouseDemo): InboxItem | null {
  const source = effectiveSource(db.source, demo, db.now);
  const to = { path: "/payouts/overview" as const };
  if (!source) {
    return {
      id: "pool-low",
      section: "live",
      tone: "alert",
      title: "ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชี",
      detail: "ห้ามเดาบัญชีต้นทาง",
      to,
    };
  }
  const q = queuePayouts(db, "");
  const pending = q.filter((p) => p.status === "PENDING");
  const processing = q.filter((p) => p.status === "PROCESSING");
  const queueAmount = pending.concat(processing).reduce((s, p) => s + p.amount, 0);
  const stuckBatchCount = db.batches.filter((b) => b.stuck).length;
  const alerts = houseAlerts({
    source,
    pendingCount: pending.length,
    queueAmount,
    stuckBatchCount,
    now: db.now,
  });
  const short = alerts.find((a) => a.id === "short");
  const cap = source.dailyAmountCap;
  const dailyLow = cap > 0 && (cap - source.dailyAmountUsed) / cap < 0.2;
  const twiceMin = source.bankBalance < source.minBalance * 2;
  if (!short && !twiceMin && !dailyLow) return null;
  const title = short
    ? short.text
    : twiceMin
      ? "ยอดบัญชีต้นทางใกล้เงินสำรอง"
      : "เพดานโอนวันนี้เหลือต่ำกว่า 20%";
  const detail = `เหลือ ฿ ${money(source.bankBalance)}`;
  return { id: "pool-low", section: "live", tone: "alert", title, detail, to };
}

function adminLive(db: MockDb, demo: HouseDemo): InboxItem[] {
  const pending = db.batches.filter((b) => b.status === "PENDING");
  const sending = db.batches.filter((b) => b.status === "SENDING");
  const sent = db.batches.filter((b) => b.status === "SENT");
  const waiting = sending.concat(sent);
  const stuck = db.batches.filter((b) => b.stuck);
  const needsReview = db.batches.filter((b) => b.status === "NEEDS_REVIEW");
  const reviewRows = db.batches.filter((b) => b.status === "NEEDS_REVIEW" || b.stuck);
  const live: InboxItem[] = [];

  if (reviewRows.length) {
    const title = stuck.length ? STUCK_BATCH_LABEL : "ชุดรอตรวจสอบ";
    const detail = stuck.length && needsReview.length
      ? `ค้าง ${stuck.length} · รอตรวจสอบ ${needsReview.length}`
      : `${reviewRows.length} ชุด`;
    live.push({
      id: "review",
      section: "live",
      tone: "alert",
      title,
      detail,
      to: {
        path: "/payouts/batches",
        list: stuck.length ? { batchStuck: true } : { batchStatus: "NEEDS_REVIEW" },
      },
    });
  }

  const pool = poolLowItem(db, demo);
  if (pool) live.push(pool);

  if (waiting.length) {
    const list = stuck.length
      ? { batchStuck: true }
      : sending.length
        ? { batchStatus: "SENDING" }
        : { batchStatus: "SENT" };
    live.push({
      id: "waiting",
      section: "live",
      tone: stuck.length ? "warn" : "default",
      title: "ชุดรอธนาคาร",
      detail: `${waiting.length} ชุด`,
      to: { path: "/payouts/batches", list },
    });
  }

  if (pending.length) {
    live.push({
      id: "queue",
      section: "live",
      tone: "default",
      title: "ชุดรอส่ง",
      detail: `${pending.length} ชุด`,
      to: {
        path: "/payouts/batches",
        list: { batchStatus: "PENDING", batchStuck: false },
      },
    });
  }
  return live;
}

function merchantLive(db: MockDb, merchantId: string): InboxItem[] {
  const q = queuePayouts(db, merchantId);
  const pending = q.filter((p) => p.status === "PENDING");
  const processing = q.filter((p) => p.status === "PROCESSING");
  const review = q.filter((p) => p.status === "NEEDS_REVIEW");
  const books = booksOf(db, merchantId);
  const live: InboxItem[] = [];

  if (review.length) {
    live.push({
      id: "review",
      section: "live",
      tone: "alert",
      title: "รายการต้องตรวจสอบ",
      detail: `${review.length} ใบ`,
      to: { path: "/payouts", list: { statuses: ["NEEDS_REVIEW"] } },
    });
  }

  if (books && books.operate < OPERATE_LOW) {
    live.push({
      id: "operate-low",
      section: "live",
      tone: "alert",
      title: "ยอดใช้ได้ใกล้หมด",
      detail: `฿ ${money(books.operate)}`,
      to: { path: "/payouts/overview" },
    });
  }

  if (processing.length) {
    live.push({
      id: "waiting",
      section: "live",
      tone: "default",
      title: "กำลังส่ง รอยืนยันจากธนาคาร",
      detail: `${processing.length} ใบ`,
      to: { path: "/payouts", list: { statuses: ["PROCESSING"] } },
    });
  }

  if (pending.length) {
    live.push({
      id: "queue",
      section: "live",
      tone: "default",
      title: "รอส่งเข้าธนาคาร",
      detail: `${pending.length} ใบ`,
      to: { path: "/payouts", list: { statuses: ["PENDING"] } },
    });
  }
  return live;
}

function adminRecent(db: MockDb): InboxItem[] {
  return db.batches
    .filter((b) => b.status === "SETTLED" || b.status === "FAILED")
    .map((b) => {
      const failed = b.status === "FAILED";
      return {
        id: `batch-${b.id}`,
        section: "recent" as const,
        tone: (failed ? "alert" : "default") as InboxTone,
        title: failed ? "ชุดโอนไม่สำเร็จ" : "ชุดโอนสำเร็จ",
        detail: `${b.id} · ฿ ${money(b.totalAmount)}`,
        to: { path: `/payouts/batches/${b.id}` },
        at: batchAt(b),
      };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5)
    .map(({ at: _at, ...item }) => item);
}

function merchantRecent(db: MockDb, merchantId: string, topUps: TopUpEvent[]): InboxItem[] {
  const rows: (InboxItem & { at: Date })[] = db.payouts
    .filter((p) => p.merchantId === merchantId && (p.status === "COMPLETED" || p.status === "FAILED"))
    .map((p) => {
      const failed = p.status === "FAILED";
      return {
        id: `payout-${p.referenceId}`,
        section: "recent" as const,
        tone: (failed ? "alert" : "default") as InboxTone,
        title: failed ? "โอนไม่สำเร็จ" : "โอนสำเร็จ",
        detail: `${p.referenceId} · ฿ ${money(p.amount)}`,
        to: { path: `/payouts/${p.referenceId}` },
        at: payoutAt(p),
      };
    });
  for (const t of topUps.filter((e) => e.merchantId === merchantId)) {
    rows.push({
      id: t.id,
      section: "recent",
      tone: "default",
      title: "เติมเงินเข้าสมุด",
      detail: `฿ ${money(t.amount)}`,
      to: { path: "/payouts/overview" },
      at: t.at,
    });
  }
  return rows
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5)
    .map(({ at: _at, ...item }) => item);
}

export function listInbox(db: MockDb, args: ListInboxArgs, topUps: TopUpEvent[] = []): Inbox {
  const live = args.isAdmin ? adminLive(db, args.demo) : merchantLive(db, args.merchantId);
  const recent = args.isAdmin
    ? adminRecent(db)
    : merchantRecent(db, args.merchantId, topUps);
  return { live, recent, badgeCount: live.length };
}
