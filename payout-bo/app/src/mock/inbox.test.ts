import { describe, expect, it } from "vitest";
import { NOW } from "../lib/bangkok";
import type { Batch, MockDb, Payout, SourceAccount, TopUpEvent } from "./types";
import { listInbox, type HouseDemo } from "./query";
import { db, TOPUP_SEED } from "./seed";

const demoOff: HouseDemo = {
  sendOff: false,
  staleBalance: false,
  noSource: false,
  queueExceeds: false,
};

function source(patch: Partial<SourceAccount> = {}): SourceAccount {
  return {
    id: "src",
    accountNo: "1",
    accountName: "MaxPay",
    bankCode: "006",
    bankName: "KTB",
    tier: "INBOUND",
    status: "ACTIVE",
    bankBalance: 186400,
    bookBalance: 186400,
    minBalance: 50000,
    dailyTxnCap: 200,
    dailyAmountCap: 500000,
    dailyTxnUsed: 0,
    dailyAmountUsed: 0,
    payoutEnabled: true,
    sendEnabled: true,
    bankBalanceAt: NOW,
    ...patch,
  };
}

function makeDb(patch: Partial<MockDb> = {}): MockDb {
  return {
    now: NOW,
    source: source(),
    merchants: [],
    payouts: [],
    batches: [],
    books: { "m-acme": { operate: 38250, parking: 0, freeze: 0 } },
    ...patch,
  };
}

function payout(patch: Partial<Payout> & Pick<Payout, "referenceId" | "status">): Payout {
  return {
    merchantId: "m-acme",
    amount: 1000,
    createdAt: NOW,
    confirmedAt: null,
    updatedAt: null,
    ...patch,
  } as Payout;
}

function batch(patch: Partial<Batch> & Pick<Batch, "id" | "status">): Batch {
  return {
    itemCount: 1,
    totalAmount: 1000,
    totalFeeQuoted: null,
    sameBankCount: 1,
    interbankCount: 0,
    bankFeeIncurred: 0,
    bankFeeEstimated: false,
    bankBulkOrderId: null,
    packageRefNo: null,
    failureReason: null,
    createdAt: NOW,
    sentAt: null,
    confirmedAt: null,
    settledAt: null,
    stuck: false,
    itemRefs: [],
    ...patch,
  };
}

describe("listInbox admin live", () => {
  it("orders review, pool-low, waiting, queue and badges live only", () => {
    const inbox = listInbox(
      makeDb({
        source: source({ bankBalance: 99000 }),
        batches: [
          batch({ id: "b-q", status: "PENDING" }),
          batch({ id: "b-w", status: "SENDING" }),
          batch({ id: "b-r", status: "NEEDS_REVIEW" }),
        ],
      }),
      { isAdmin: true, merchantId: "", demo: demoOff },
      [],
    );
    expect(inbox.live.map((i) => i.id)).toEqual(["review", "pool-low", "waiting", "queue"]);
    expect(inbox.badgeCount).toBe(4);
    expect(inbox.live.find((i) => i.id === "queue")?.to).toEqual({
      path: "/payouts/batches",
      list: { batchStatus: "PENDING", batchStuck: false },
    });
  });

  it("uses stuck click target for waiting when a batch is stuck", () => {
    const inbox = listInbox(
      makeDb({
        batches: [batch({ id: "b-s", status: "SENT", stuck: true, sentAt: NOW })],
      }),
      { isAdmin: true, merchantId: "", demo: demoOff },
      [],
    );
    const waiting = inbox.live.find((i) => i.id === "waiting");
    expect(waiting?.tone).toBe("warn");
    expect(waiting?.to.list).toEqual({ batchStuck: true });
    const review = inbox.live.find((i) => i.id === "review");
    expect(review?.title).toContain("ส่งแล้วรอธนาคารนาน");
    expect(review?.to.list).toEqual({ batchStuck: true });
  });

  it("shows no-source as pool-low", () => {
    const inbox = listInbox(makeDb(), { isAdmin: true, merchantId: "", demo: { ...demoOff, noSource: true } }, []);
    const pool = inbox.live.find((i) => i.id === "pool-low");
    expect(pool?.title).toBe("ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชี");
    expect(pool?.to).toEqual({ path: "/payouts/overview" });
  });
});

describe("listInbox merchant", () => {
  it("hides pool and batches, shows operate-low and scoped payouts", () => {
    const inbox = listInbox(
      makeDb({
        source: source({ bankBalance: 99000 }),
        payouts: [
          payout({ referenceId: "p-pend", status: "PENDING" }),
          payout({ referenceId: "p-proc", status: "PROCESSING" }),
          payout({ referenceId: "p-rev", status: "NEEDS_REVIEW" }),
          payout({ referenceId: "p-other", status: "PENDING", merchantId: "m-nova" }),
        ],
        batches: [batch({ id: "b-q", status: "PENDING" })],
      }),
      { isAdmin: false, merchantId: "m-acme", demo: demoOff },
      [],
    );
    expect(inbox.live.map((i) => i.id)).toEqual(["review", "operate-low", "waiting", "queue"]);
    expect(inbox.live.some((i) => i.id === "pool-low")).toBe(false);
    expect(inbox.live.find((i) => i.id === "queue")?.to).toEqual({
      path: "/payouts",
      list: { statuses: ["PENDING"] },
    });
    expect(inbox.live.every((i) => !i.to.path.startsWith("/payouts/batches"))).toBe(true);
  });

  it("merges recent payouts and top-up newest first capped at 5", () => {
    const topUps: TopUpEvent[] = [
      { id: "topup-acme-1", at: new Date("2026-08-31T17:00:00+07:00"), merchantId: "m-acme", amount: 50000 },
    ];
    const inbox = listInbox(
      makeDb({
        payouts: [
          payout({
            referenceId: "p-ok",
            status: "COMPLETED",
            confirmedAt: new Date("2026-08-31T16:00:00+07:00"),
          }),
          payout({
            referenceId: "p-fail",
            status: "FAILED",
            updatedAt: new Date("2026-08-31T17:30:00+07:00"),
            failureReason: "bank",
          }),
          payout({
            referenceId: "p-nova",
            status: "COMPLETED",
            merchantId: "m-nova",
            confirmedAt: new Date("2026-08-31T18:00:00+07:00"),
          }),
        ],
      }),
      { isAdmin: false, merchantId: "m-acme", demo: demoOff },
      topUps,
    );
    expect(inbox.recent.map((i) => i.id)).toEqual(["payout-p-fail", "topup-acme-1", "payout-p-ok"]);
    expect(inbox.recent.find((i) => i.id === "topup-acme-1")?.to.path).toBe("/payouts/overview");
    expect(inbox.badgeCount).toBe(inbox.live.length);
  });

  it("keeps 5 newest when 6 recent events exist", () => {
    const times = [10, 11, 12, 13, 14, 15].map(
      (h) => new Date(`2026-08-31T${h}:00:00+07:00`),
    );
    const inbox = listInbox(
      makeDb({
        payouts: times.map((at, i) =>
          payout({
            referenceId: `p-${i}`,
            status: "COMPLETED",
            confirmedAt: at,
          }),
        ),
      }),
      { isAdmin: false, merchantId: "m-acme", demo: demoOff },
      [],
    );
    expect(inbox.recent).toHaveLength(5);
    expect(inbox.recent.map((i) => i.id)).toEqual([
      "payout-p-5",
      "payout-p-4",
      "payout-p-3",
      "payout-p-2",
      "payout-p-1",
    ]);
  });
});

describe("listInbox admin recent", () => {
  it("lists settled and failed batches not merchant top-ups", () => {
    const inbox = listInbox(
      makeDb({
        batches: [
          batch({
            id: "b-ok",
            status: "SETTLED",
            settledAt: new Date("2026-08-31T15:00:00+07:00"),
            totalAmount: 2000,
          }),
          batch({
            id: "b-fail",
            status: "FAILED",
            confirmedAt: new Date("2026-08-31T16:00:00+07:00"),
          }),
        ],
      }),
      { isAdmin: true, merchantId: "", demo: demoOff },
      [{ id: "topup-acme-1", at: NOW, merchantId: "m-acme", amount: 1 }],
    );
    expect(inbox.recent.map((i) => i.id)).toEqual(["batch-b-fail", "batch-b-ok"]);
    expect(inbox.recent[0]?.to.path).toBe("/payouts/batches/b-fail");
  });
});

describe("listInbox against seeded db", () => {
  it("shows pool-low for admin and top-up for Acme", () => {
    const admin = listInbox(db, { isAdmin: true, merchantId: "", demo: demoOff }, TOPUP_SEED);
    expect(admin.live.some((i) => i.id === "pool-low")).toBe(true);
    const shop = listInbox(db, { isAdmin: false, merchantId: "m-acme", demo: demoOff }, TOPUP_SEED);
    expect(shop.live.some((i) => i.id === "operate-low")).toBe(true);
    expect(shop.recent.some((i) => i.id === "topup-acme-1")).toBe(true);
    expect(admin.recent.some((i) => i.id.startsWith("topup-"))).toBe(false);
  });
});
