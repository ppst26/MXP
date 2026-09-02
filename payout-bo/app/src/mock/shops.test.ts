import { describe, expect, it } from "vitest";
import type { BoUser, MockDb, Payout } from "./types";
import { NOW } from "../lib/bangkok";
import { MERCHANTS } from "./seed";
import { listBoUsers, listShopMembers, listShopUserSummaries } from "./query";

function payout(patch: Partial<Payout> & Pick<Payout, "referenceId" | "status" | "merchantId">): Payout {
  return {
    amount: 1000,
    reservedFee: 15,
    createdAt: NOW,
    confirmedAt: null,
    updatedAt: null,
    ...patch,
  } as Payout;
}

function user(patch: Partial<BoUser> & Pick<BoUser, "id" | "merchantId" | "role">): BoUser {
  return {
    username: patch.id,
    displayName: patch.id,
    kind: "merchant",
    status: "active",
    twoFactor: false,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: NOW,
    ...patch,
  };
}

function db(patch: Partial<MockDb> = {}): Pick<MockDb, "payouts" | "books"> {
  return {
    payouts: [],
    books: {
      "m-acme": { operate: 38250, parking: 0, freeze: 0 },
      "m-nova": { operate: 12400, parking: 3000, freeze: 1500 },
    },
    ...patch,
  };
}

describe("listShopUserSummaries", () => {
  it("lists every DIRECT shop even when there are no accounts", () => {
    const rows = listShopUserSummaries([], {
      merchantId: "",
      q: "",
      db: db(),
    });
    const directs = MERCHANTS.filter((m) => m.role === "DIRECT");
    expect(rows).toHaveLength(directs.length);
    expect(rows.every((r) => merchRole(r.merchantId) === "DIRECT")).toBe(true);
    expect(rows.find((r) => r.merchantId === "m-acme")?.accountCount).toBe(0);
  });

  it("attaches operate and pending holds from the ledger and open payouts", () => {
    const rows = listShopUserSummaries(
      [
        user({ id: "u1", merchantId: "m-acme", role: "shop_admin", lastLoginAt: NOW }),
        user({ id: "u2", merchantId: "m-acme", role: "user" }),
      ],
      {
        merchantId: "",
        q: "",
        db: db({
          payouts: [
            payout({ referenceId: "p1", merchantId: "m-acme", status: "PENDING", amount: 1000, reservedFee: 15 }),
            payout({ referenceId: "p2", merchantId: "m-acme", status: "PROCESSING", amount: 200, reservedFee: 0 }),
            payout({ referenceId: "p3", merchantId: "m-acme", status: "COMPLETED", amount: 9000, reservedFee: 0 }),
            payout({ referenceId: "p4", merchantId: "m-nova", status: "NEEDS_REVIEW", amount: 50, reservedFee: 1 }),
          ],
        }),
      },
    );
    const acme = rows.find((r) => r.merchantId === "m-acme");
    expect(acme).toMatchObject({
      operate: 38250,
      pendingAmount: 1215,
      pendingCount: 2,
      accountCount: 2,
      adminCount: 1,
    });
    const nova = rows.find((r) => r.merchantId === "m-nova");
    expect(nova).toMatchObject({ operate: 12400, pendingAmount: 51, pendingCount: 1 });
  });

  it("limits shops to the selected merchant subtree", () => {
    const rows = listShopUserSummaries([], {
      merchantId: "r-alpha",
      q: "",
      db: db(),
    });
    expect(rows.map((r) => r.merchantId).sort()).toEqual(["m-acme", "m-lotus", "m-nova"]);
  });
});

describe("listShopMembers", () => {
  it("returns shop admins and shop users together", () => {
    const rows = listShopMembers(
      [
        user({ id: "a", merchantId: "m-acme", role: "shop_admin" }),
        user({ id: "u", merchantId: "m-acme", role: "user" }),
        user({ id: "x", merchantId: "m-nova", role: "shop_admin" }),
        {
          ...user({ id: "p", merchantId: null, role: "platform_admin" }),
          kind: "platform",
        },
      ],
      "m-acme",
      "",
    );
    expect(rows.map((u) => u.id).sort()).toEqual(["a", "u"]);
  });
});

describe("listBoUsers platform tab", () => {
  it("does not include shop admins or shop users", () => {
    const rows = listBoUsers(
      [
        {
          ...user({ id: "p", merchantId: null, role: "platform_admin" }),
          kind: "platform",
        },
        user({ id: "a", merchantId: "m-acme", role: "shop_admin" }),
        user({ id: "u", merchantId: "m-acme", role: "user" }),
      ],
      { tab: "admin", merchantId: "", q: "", isAdmin: true },
    );
    expect(rows.map((u) => u.id)).toEqual(["p"]);
  });
});

function merchRole(id: string) {
  return MERCHANTS.find((m) => m.id === id)?.role;
}
