import { describe, expect, it } from "vitest";
import { MERCHANTS } from "./seed";
import { listMerchantBookRows, listPayoutRates, listPayoutRecon } from "./query";
import type { MockDb, Payout } from "./types";
import { NOW } from "../lib/bangkok";

describe("listPayoutRates", () => {
  it("lists shops only and sums reserved_fee as MDR, never bank fee", () => {
    const payouts = [
      { merchantId: "m-acme", reservedFee: 15, bankFee: 5 } as Payout,
      { merchantId: "m-acme", reservedFee: 7.5, bankFee: 5 } as Payout,
      { merchantId: "m-nova", reservedFee: 18, bankFee: 0 } as Payout,
    ];
    const rows = listPayoutRates(MERCHANTS, payouts);

    expect(rows.every((r) => r.role === "DIRECT")).toBe(true);
    expect(rows.find((r) => r.id === "r-alpha")).toBeUndefined();
    expect(rows.find((r) => r.id === "m-acme")).toMatchObject({
      role: "DIRECT",
      parentId: "r-alpha",
      parentRate: 0.007,
      rate: 0.015,
      spread: 0.008,
      mdrSum: 22.5,
    });
    expect(rows.find((r) => r.id === "m-nova")?.mdrSum).toBe(18);
    expect(rows.find((r) => r.id === "m-lotus")?.mdrSum).toBe(0);
  });

  it("keeps shops of the same line together without reseller rows", () => {
    const rows = listPayoutRates(MERCHANTS, []);
    const acmeAt = rows.findIndex((r) => r.id === "m-acme");
    const lotusAt = rows.findIndex((r) => r.id === "m-lotus");
    const novaAt = rows.findIndex((r) => r.id === "m-nova");
    const orbitAt = rows.findIndex((r) => r.id === "m-orbit");
    expect(acmeAt).toBeGreaterThanOrEqual(0);
    expect(lotusAt).toBeGreaterThan(acmeAt);
    expect(novaAt).toBeGreaterThan(acmeAt);
    expect(orbitAt).toBeGreaterThan(lotusAt);
    expect(orbitAt).toBeGreaterThan(novaAt);
  });
});

describe("listMerchantBookRows", () => {
  it("shows every tenant book and pending payout on directs", () => {
    const payout = {
      referenceId: "p1",
      merchantId: "m-acme",
      status: "PENDING",
      amount: 1000,
      reservedFee: 15,
      createdAt: NOW,
    } as Payout;
    const rows = listMerchantBookRows({
      payouts: [payout],
      books: {
        "r-alpha": { operate: 8420, parking: 0, freeze: 0 },
        "m-acme": { operate: 38250, parking: 0, freeze: 0 },
        "m-nova": { operate: 12400, parking: 3000, freeze: 1500 },
      },
    });
    expect(rows.find((r) => r.merchantId === "r-alpha")).toMatchObject({
      role: "RESELLER",
      operate: 8420,
      pendingPayout: 0,
    });
    expect(rows.find((r) => r.merchantId === "m-acme")).toMatchObject({
      role: "DIRECT",
      operate: 38250,
      pendingPayout: 1015,
      freeze: 0,
      balance: 39265,
    });
    expect(rows.find((r) => r.merchantId === "m-nova")).toMatchObject({
      parking: 3000,
      freeze: 1500,
      freezeBalance: 1500,
      balance: 16900,
    });
  });
});

describe("listPayoutRecon", () => {
  it("flags a bank debit without a completed payout as a discrepancy", () => {
    const rows = listPayoutRecon({
      payouts: [
        {
          referenceId: "ok",
          merchantId: "m-acme",
          status: "COMPLETED",
          amount: 1000,
          reservedFee: 15,
          route: "INTERBANK",
          bankFee: 5,
          bankOrderId: "BO-1",
          confirmedAt: NOW,
        } as Payout,
        {
          referenceId: "ghost",
          merchantId: "m-acme",
          status: "FAILED",
          amount: 500,
          reservedFee: 7.5,
          route: "INTERBANK",
          bankFee: 5,
          bankOrderId: "BO-2",
          confirmedAt: NOW,
          failureReason: "ธนาคารตัดเงินแล้ว แต่ใบล้ม",
        } as Payout,
        {
          referenceId: "pending",
          merchantId: "m-acme",
          status: "PENDING",
          amount: 200,
          reservedFee: 3,
          route: "INTERBANK",
          bankFee: 0,
          bankOrderId: null,
          confirmedAt: null,
        } as Payout,
      ],
    } as Pick<MockDb, "payouts">);

    expect(rows.map((r) => r.referenceId)).toEqual(["ghost", "ok"]);
    expect(rows[0]).toMatchObject({ match: "discrepancy", bankFee: 5 });
    expect(rows[1]).toMatchObject({ match: "matched", bankFee: 5 });
  });
});
