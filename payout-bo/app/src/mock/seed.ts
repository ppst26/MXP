import type { Batch, Merchant, MockDb, Payout, SourceAccount } from "./types";
import { NOW, addMs, fmtD, pad, startOfDay } from "../lib/bangkok";

function rng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260831);
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function code(len = 10): string {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += c[Math.floor(rand() * c.length)];
  return s;
}

function feeOf(amount: number, rate: number): number {
  return Math.round(amount * rate * 10000) / 10000;
}

const BANKS = [
  { code: "006", name: "KTB" },
  { code: "014", name: "SCB" },
  { code: "004", name: "KBANK" },
  { code: "002", name: "BBL" },
  { code: "025", name: "BAY" },
  { code: "011", name: "TMB" },
];

const NAMES: [string, string][] = [
  ["สมชาย ใจดี", "สมชาย ใจดี"],
  ["เฮง ร่ำรวย", "เฮง ร่ำรวย"],
  ["นิด รวย", "นิดา รวย"],
  ["มาลี สุข", "มาลี สุข"],
  ["วิชัย มั่งมี", "วิชัย มั่งมี"],
  ["กมลชนก ศรีสุข", "กมลชนก ศรีสุข"],
  ["ประยุทธ ทองดี", "ประยุทธ์ ทองดี"],
  ["อรุณี แสงทอง", "อรุณี แสงทอง"],
  ["ธนา ตั้งตรง", "ธนา ตั้งตรง"],
  ["ปิยะ เจริญ", "ปิยะ เจริญ"],
];

/** ยอดสมุดที่ไม่ได้มาจากใบถอน — pending_payout คำนวณจากใบที่ยังกันเงิน */
export const BOOK_SEED: Record<string, { operate: number; parking: number; freeze: number }> = {
  "r-alpha": { operate: 8420, parking: 0, freeze: 0 },
  "r-beta": { operate: 6100, parking: 0, freeze: 0 },
  "r-gamma": { operate: 3900, parking: 0, freeze: 0 },
  "m-acme": { operate: 38250, parking: 0, freeze: 0 },
  "m-nova": { operate: 12400, parking: 3000, freeze: 1500 },
  "m-lotus": { operate: 22100, parking: 0, freeze: 0 },
  "m-orbit": { operate: 9800, parking: 0, freeze: 0 },
  "m-zen": { operate: 15600, parking: 0, freeze: 800 },
  "m-fox": { operate: 7400, parking: 0, freeze: 0 },
  "m-river": { operate: 18800, parking: 5000, freeze: 0 },
  "m-peak": { operate: 11200, parking: 0, freeze: 0 },
  "m-dawn": { operate: 6500, parking: 0, freeze: 0 },
};

export const MERCHANTS: Merchant[] = [
  { id: "r-alpha", code: "ALPHA9k2Qx", name: "ตัวแทน อัลฟ่า", role: "RESELLER", parentId: null, rate: 0.007 },
  { id: "r-beta", code: "BETA4mN81p", name: "ตัวแทน เบต้า", role: "RESELLER", parentId: null, rate: 0.008 },
  { id: "r-gamma", code: "GAMMA2pL0s", name: "ตัวแทน แกมมา", role: "RESELLER", parentId: null, rate: 0.006 },
  { id: "m-acme", code: "VOBM7qzaRH", name: "Acme", role: "DIRECT", parentId: "r-alpha", rate: 0.015 },
  { id: "m-nova", code: "NOVA3xK91a", name: "Nova Play", role: "DIRECT", parentId: "r-alpha", rate: 0.018 },
  { id: "m-lotus", code: "LOTUS8dQ2w", name: "Lotus Bet", role: "DIRECT", parentId: "r-alpha", rate: 0.016 },
  { id: "m-orbit", code: "ORBIT5cE3t", name: "Orbit Pay", role: "DIRECT", parentId: "r-beta", rate: 0.014 },
  { id: "m-zen", code: "ZENITH1bR4", name: "Zenith", role: "DIRECT", parentId: "r-beta", rate: 0.017 },
  { id: "m-fox", code: "FOX9pL22k", name: "Fox Wallet", role: "DIRECT", parentId: "r-beta", rate: 0.015 },
  { id: "m-river", code: "RIVER6aM8n", name: "River Club", role: "DIRECT", parentId: "r-gamma", rate: 0.012 },
  { id: "m-peak", code: "PEAK4sT90q", name: "Peak Gaming", role: "DIRECT", parentId: "r-gamma", rate: 0.013 },
  { id: "m-dawn", code: "DAWN2uY11e", name: "Dawn Direct", role: "DIRECT", parentId: "r-gamma", rate: 0.015 },
];

function createDb(): MockDb {
  const source: SourceAccount = {
    id: "src-ktb-01",
    accountNo: "1234567890",
    accountName: "บจก. แม็กซ์เพย์ จำกัด",
    bankCode: "006",
    bankName: "KTB",
    tier: "INBOUND",
    status: "ACTIVE",
    bankBalance: 186400,
    bookBalance: 186150,
    minBalance: 50000,
    dailyTxnCap: 200,
    dailyAmountCap: 500000,
    dailyTxnUsed: 0,
    dailyAmountUsed: 0,
    payoutEnabled: true,
    sendEnabled: true,
    bankBalanceAt: new Date(NOW.getTime() - 2 * 60 * 1000),
  };

  const directs = MERCHANTS.filter((m) => m.role === "DIRECT");
  const payouts: Payout[] = [];
  const batches: Batch[] = [];
  let seq = 1000;
  let day = startOfDay(new Date("2026-08-01T00:00:00+07:00"));
  const lastDay = startOfDay(NOW);

  while (day <= lastDay) {
    const isToday = fmtD(day) === fmtD(NOW);
    const dow = new Date(day).getDay();
    const weekend = dow === 0 || dow === 6;
    let n = weekend ? 4 + Math.floor(rand() * 4) : 8 + Math.floor(rand() * 8);
    if (isToday) n = 14;
    const chunk: Payout[] = [];
    for (let i = 0; i < n; i++) {
      const m = pick(directs);
      const bank = rand() < 0.42 ? BANKS[0]! : pick(BANKS);
      const pair = pick(NAMES);
      const amount = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3500, 5000][Math.floor(rand() * 11)]!;
      const hour = isToday ? Math.floor(rand() * (NOW.getHours() - 7 + 1)) + 7 : Math.floor(rand() * 14) + 8;
      const minute = Math.floor(rand() * 60);
      const created = new Date(
        fmtD(day) + "T" + pad(Math.min(hour, isToday ? NOW.getHours() : 22)) + ":" + pad(minute) + ":00+07:00",
      );
      if (created > NOW) continue;
      const route = bank.code === source.bankCode ? "SAME_BANK" : "INTERBANK";
      const reserved = feeOf(amount, m.rate);
      const mismatch = pair[0] !== pair[1];
      const p: Payout = {
        referenceId: code(10),
        transactionId: "WD" + pad(seq++, 6),
        merchantId: m.id,
        merchantCode: m.code,
        merchantName: m.name,
        clientId: "c" + m.code.slice(0, 8),
        clientName: m.name + " API",
        status: "COMPLETED",
        amount,
        reservedFee: reserved,
        route,
        bankFee: route === "INTERBANK" ? 5 : 0,
        bankFeeEstimated: false,
        recipientAccountNo: String(6000000000 + Math.floor(rand() * 899999999)),
        recipientBankCode: bank.code,
        recipientBankName: bank.name,
        recipientName: pair[0],
        recipientPhone: rand() < 0.3 ? "08" + pad(Math.floor(rand() * 100000000), 8) : "",
        accountToName: pair[1],
        nameMismatch: mismatch,
        sourceAccountNo: source.accountNo,
        sourceBankCode: source.bankCode,
        sourceBankName: source.bankName,
        sourceAccountName: source.accountName,
        batchId: null,
        packageRefNo: null,
        bankOrderId: null,
        bankItemId: null,
        bankBulkOrderId: null,
        failureReason: null,
        createdAt: created,
        confirmedAt: addMs(created, 20000 + Math.floor(rand() * 40000)),
        updatedAt: null,
        attempts: 1,
        nextAttemptAt: null,
        callbackUrl: "https://merchant.example/callback/payout",
        timeline: [],
        journal: [],
      };
      p.updatedAt = p.confirmedAt;
      chunk.push(p);
      payouts.push(p);
    }

    const sorted = chunk.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (isToday) {
      sorted.forEach((p, i) => {
        if (i < 3) {
          p.status = "PENDING";
          p.confirmedAt = null;
          p.updatedAt = p.createdAt;
          p.bankFee = 0;
          p.bankFeeEstimated = p.route === "INTERBANK";
          p.attempts = 0;
        } else if (i < 5) {
          p.status = "PROCESSING";
          p.confirmedAt = addMs(p.createdAt, 15000);
          p.updatedAt = p.confirmedAt;
          p.bankFeeEstimated = p.route === "INTERBANK";
          if (p.route === "INTERBANK") p.bankFee = 0;
        } else if (i === 5) {
          p.status = "NEEDS_REVIEW";
          p.confirmedAt = addMs(p.createdAt, 18000);
          p.failureReason = "bulkItemStatus=UNKNOWN_CODE · transactionErrorDescription=รอตรวจสอบ";
          p.bankFee = 0;
          p.bankFeeEstimated = true;
        } else if (i === 6) {
          p.status = "FAILED";
          p.confirmedAt = null;
          p.batchId = null;
          p.failureReason = "บัญชีปลายทางไม่มีตัว";
          p.bankFee = 0;
          p.attempts = 1;
          if (!p.nameMismatch) p.accountToName = "";
        } else if (i === 7) {
          p.status = "REJECTED";
          p.confirmedAt = null;
          p.failureReason = "ยอดไม่ผ่านเงื่อนไขร้าน";
          p.bankFee = 0;
          p.attempts = 0;
        }
      });
    } else if (fmtD(day) === "2026-08-30") {
      sorted.slice(0, 2).forEach((p) => {
        p.status = "PENDING";
        p.confirmedAt = null;
        p.updatedAt = p.createdAt;
        p.bankFee = 0;
        p.bankFeeEstimated = p.route === "INTERBANK";
        p.attempts = 0;
      });
      const fail = sorted[2];
      if (fail) {
        fail.status = "FAILED";
        fail.confirmedAt = null;
        fail.failureReason = "บัญชีปลายทางไม่มีตัว";
        fail.bankFee = 0;
      }
      const rev = sorted[3];
      if (rev) {
        rev.status = "NEEDS_REVIEW";
        rev.failureReason = "รหัสสถานะรายการย่อยยังไม่อยู่ในแผนที่";
        rev.bankFee = 0;
        rev.bankFeeEstimated = true;
      }
    } else {
      if (rand() < 0.35 && sorted[0]) {
        const f = sorted[0];
        f.status = "FAILED";
        f.confirmedAt = null;
        f.failureReason = "บัญชีปลายทางไม่มีตัว";
        f.bankFee = 0;
        f.batchId = null;
      }
      if (rand() < 0.12 && sorted[1]) {
        const r = sorted[1];
        r.status = "REJECTED";
        r.confirmedAt = null;
        r.failureReason = "ร้านถูกระงับชั่วคราวตอนสร้างใบ";
        r.bankFee = 0;
      }
    }

    const batchable = sorted.filter(
      (p) => p.status === "COMPLETED" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW",
    );
    for (let i = 0; i < batchable.length; i += 4) {
      const items = batchable.slice(i, i + 4);
      if (!items.length) continue;
      const bid = "b-" + fmtD(day).replace(/-/g, "") + "-" + pad(i / 4 + 1, 2);
      const pkg = "PKG-" + fmtD(day).replace(/-/g, "").slice(2) + pad(i / 4 + 1, 2);
      const order = "BULK-" + fmtD(day).replace(/-/g, "") + pad(i / 4 + 1, 2);
      const createdB = items[0]!.createdAt;
      const sent = addMs(createdB, 8 * 60000);
      const confirmed = addMs(sent, 20000);
      let status: Batch["status"] = "SETTLED";
      if (items.some((p) => p.status === "NEEDS_REVIEW")) status = "NEEDS_REVIEW";
      if (items.some((p) => p.status === "PROCESSING")) status = "SENT";
      const inter = items.filter((p) => p.route === "INTERBANK").length;
      const incurred = items.reduce(
        (s, p) => s + (p.status === "COMPLETED" && p.route === "INTERBANK" ? 5 : 0),
        0,
      );
      items.forEach((p, idx) => {
        p.batchId = bid;
        p.packageRefNo = pkg;
        p.bankBulkOrderId = order;
        p.bankItemId = pad(idx + 1, 2);
        p.bankOrderId = order + "-" + p.bankItemId;
        if (p.status === "COMPLETED") {
          p.bankFee = p.route === "INTERBANK" ? 5 : 0;
          p.bankFeeEstimated = false;
        }
        p.timeline = [
          { at: p.createdAt, status: "PENDING" },
          { at: sent, status: "PROCESSING", note: "เข้าชุด" },
        ];
        if (p.confirmedAt) p.timeline.push({ at: p.confirmedAt, status: p.status, note: "confirmed_at" });
        p.journal = [{ type: "PAYOUT_CREATED", at: p.createdAt }];
        if (p.status === "COMPLETED") p.journal.push({ type: "PAYOUT_COMPLETED", at: p.confirmedAt || p.updatedAt! });
        if (p.status === "FAILED") p.journal.push({ type: "PAYOUT_FAILED", at: p.updatedAt! });
      });
      batches.push({
        id: bid,
        status,
        itemCount: items.length,
        totalAmount: items.reduce((s, p) => s + p.amount, 0),
        totalFeeQuoted: status === "SETTLED" ? incurred : null,
        sameBankCount: items.length - inter,
        interbankCount: inter,
        bankFeeIncurred: incurred,
        bankFeeEstimated: status !== "SETTLED",
        bankBulkOrderId: order,
        packageRefNo: pkg,
        failureReason: null,
        createdAt: createdB,
        sentAt: sent,
        confirmedAt: confirmed,
        settledAt: status === "SETTLED" ? addMs(confirmed, 45000) : null,
        stuck: false,
        itemRefs: items.map((p) => p.referenceId),
      });
    }

    day = startOfDay(addMs(day, 24 * 3600 * 1000));
  }

  const pendingBatchItems = payouts
    .filter((p) => p.status === "PENDING" && fmtD(p.createdAt) === fmtD(NOW))
    .slice(0, 4);
  if (pendingBatchItems.length) {
    batches.unshift({
      id: "b-20260831-open",
      status: "PENDING",
      itemCount: pendingBatchItems.length,
      totalAmount: pendingBatchItems.reduce((s, p) => s + p.amount, 0),
      totalFeeQuoted: null,
      sameBankCount: pendingBatchItems.filter((p) => p.route === "SAME_BANK").length,
      interbankCount: pendingBatchItems.filter((p) => p.route === "INTERBANK").length,
      bankFeeIncurred: 0,
      bankFeeEstimated: true,
      bankBulkOrderId: null,
      packageRefNo: null,
      failureReason: null,
      createdAt: addMs(NOW, -25 * 60000),
      sentAt: null,
      confirmedAt: null,
      settledAt: null,
      stuck: false,
      itemRefs: [],
    });
  }

  const sendingRefs = payouts.filter((p) => p.status === "PROCESSING").slice(0, 3).map((p) => p.referenceId);
  const sending: Batch = {
    id: "b-20260831-send",
    status: "SENDING",
    itemCount: 3,
    totalAmount: 1600,
    totalFeeQuoted: null,
    sameBankCount: 1,
    interbankCount: 2,
    bankFeeIncurred: 0,
    bankFeeEstimated: true,
    bankBulkOrderId: "BULK-20260831-SEND",
    packageRefNo: null,
    failureReason: null,
    createdAt: addMs(NOW, -22 * 60000),
    sentAt: addMs(NOW, -20 * 60000),
    confirmedAt: null,
    settledAt: null,
    stuck: false,
    itemRefs: sendingRefs,
  };
  sending.itemRefs.forEach((ref, idx) => {
    const p = payouts.find((x) => x.referenceId === ref);
    if (!p) return;
    p.batchId = sending.id;
    p.bankBulkOrderId = sending.bankBulkOrderId;
    p.bankItemId = pad(idx + 1, 2);
    p.bankOrderId = sending.bankBulkOrderId + "-" + p.bankItemId;
    p.confirmedAt = null;
  });
  batches.unshift(sending);

  batches.push({
    id: "b-20260830-fail",
    status: "FAILED",
    itemCount: 4,
    totalAmount: 2200,
    totalFeeQuoted: null,
    sameBankCount: 2,
    interbankCount: 2,
    bankFeeIncurred: 0,
    bankFeeEstimated: true,
    bankBulkOrderId: null,
    packageRefNo: null,
    failureReason: "บัญชีต้นทางไม่พร้อม · CreateBulkOrder ถูกปฏิเสธ · ใบกลับ PENDING",
    createdAt: new Date("2026-08-30T21:40:00+07:00"),
    sentAt: new Date("2026-08-30T21:40:30+07:00"),
    confirmedAt: null,
    settledAt: null,
    stuck: false,
    itemRefs: [],
  });

  payouts.forEach((p) => {
    if (!p.timeline.length) {
      p.timeline = [{ at: p.createdAt, status: "PENDING" }];
      if (p.confirmedAt) p.timeline.push({ at: p.confirmedAt, status: p.status, note: "confirmed_at" });
      else if (p.status !== "PENDING") p.timeline.push({ at: p.updatedAt || p.createdAt, status: p.status });
    }
    if (!p.journal.length) {
      p.journal = [{ type: "PAYOUT_CREATED", at: p.createdAt }];
      if (p.status === "COMPLETED") p.journal.push({ type: "PAYOUT_COMPLETED", at: p.confirmedAt || p.updatedAt! });
      if (p.status === "FAILED") p.journal.push({ type: "PAYOUT_FAILED", at: p.updatedAt || p.createdAt });
    }
  });

  const STUCK_AFTER = 15 * 60 * 1000;
  batches.forEach((b) => {
    if ((b.status === "SENDING" || b.status === "SENT") && NOW.getTime() - (b.sentAt || b.createdAt).getTime() > STUCK_AFTER) {
      b.stuck = true;
    }
  });

  const usedToday = payouts.filter(
    (p) =>
      fmtD(p.createdAt) === fmtD(NOW) &&
      (p.status === "COMPLETED" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW"),
  );
  source.dailyTxnUsed = usedToday.length;
  source.dailyAmountUsed = usedToday.reduce((s, p) => s + p.amount, 0);

  return { now: NOW, source, merchants: MERCHANTS, payouts, batches, books: BOOK_SEED };
}

export const db: MockDb = createDb();
