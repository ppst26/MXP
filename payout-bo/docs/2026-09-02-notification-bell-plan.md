# Notification Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กระดิ่งมุมขวาบนของ MaxPay BO เปิด popover สองช่วง (ต้องลงมือ / ล่าสุด) คนละชุดระหว่างมาสเตอร์กับร้าน กดแถวแล้วไปหน้าพร้อมตัวกรอง

**Architecture:** `listInbox` คำนวณจาก mock `db` เป็นข้อมูลล้วน ไม่รู้ React คอมโพเนนต์ `NotificationBell` อ่าน viewer แล้วเรนเดอร์ popover `Shell` วางปุ่มอย่างเดียว

**Tech Stack:** React 19 · Vite · TypeScript · shadcn Popover/Button · lucide `Bell` · vitest (เพิ่มใหม่ สำหรับ `listInbox`)

**Spec:** `payout-bo/docs/2026-09-02-notification-bell-design.md`

## Global Constraints

- ข้อความไทยยึดคำที่มีในแอปแล้ว `STUCK_BATCH_LABEL` = `ส่งแล้วรอธนาคารนาน` ไม่ตั้งชื่อใหม่ให้เรื่องเดียวกัน
- `listInbox` อยู่ใน mock ห้าม import `FilterProvider` หรือ React
- มาสเตอร์เห็นทั้งบ้าน ไม่ตามตัวเลือกร้านในฟิลเตอร์
- ร้าน scope ที่ `m-acme` ห้ามลิงก์ `/payouts/batches`
- จุดบนกระดิ่ง = `live.length` ไม่นับ `recent`
- popover ไม่ใช่ dialog ไม่มีอ่านแล้ว ไม่มีดูทั้งหมด
- รหัสผ่านผิดซ้ำไม่อยู่ในรอบนี้
- ช่วงล่างรวมเติมเงินแล้วตัดเหลือ 5 แถว
- เรียงช่วงบน: `review` / `pool-low` / `operate-low` แล้ว `waiting` แล้ว `queue`
- ไปหน้ารายการต้อง `setPreset("d30")` และรีเซ็ต `listPage` / `batchListPage` เป็น 1
- ทำงานใน `payout-bo/app` คำสั่งรันจากโฟลเดอร์นั้น

## File Structure

| File | Responsibility |
|---|---|
| `payout-bo/app/src/mock/types.ts` | `InboxItem`, `InboxTarget`, `Inbox`, `TopUpEvent`, `InboxTone` |
| `payout-bo/app/src/mock/query.ts` | `listInbox`, `ListInboxArgs` |
| `payout-bo/app/src/mock/seed.ts` | `TOPUP_SEED`, ลด `bankBalance` ให้ `pool-low` โชว์ |
| `payout-bo/app/src/mock/inbox.test.ts` | เทส `listInbox` |
| `payout-bo/app/src/features/notifications/NotificationBell.tsx` | ปุ่มกระดิ่ง + popover |
| `payout-bo/app/src/layout/Shell.tsx` | วางกระดิ่งซ้ายของ dropdown บทบาท |
| `payout-bo/app/vite.config.ts` | `test.include` ของ vitest |
| `payout-bo/app/package.json` | สคริปต์ `test` |
| `payout-bo/app/tsconfig.app.json` | exclude `src/**/*.test.ts` ไม่ให้ `tsc -b` พัง |

## Task Order

Task 1 สร้างชนิดข้อมูลและ `listInbox` ให้เทสผ่าน Task 2 ปรับ seed ให้เดโมโชว์ยอดใกล้หมดกับเติมเงิน Task 3 วาง UI แล้วตรวจในเบราว์เซอร์

---

### Task 1: `listInbox`

**Files:**
- Modify: `payout-bo/app/package.json`
- Modify: `payout-bo/app/vite.config.ts`
- Modify: `payout-bo/app/tsconfig.app.json`
- Modify: `payout-bo/app/src/mock/types.ts`
- Modify: `payout-bo/app/src/mock/query.ts`
- Create: `payout-bo/app/src/mock/inbox.test.ts`

**Interfaces:**
- Consumes: `MockDb`, `houseAlerts`, `effectiveSource`, `queuePayouts`, `booksOf`, `STUCK_BATCH_LABEL`, `HouseDemo`
- Produces: `listInbox(db, args, topUps?)` คืน `Inbox` และชนิดด้านล่าง Task 3 ใช้ชื่อเหล่านี้ตรงตัว

```ts
export type InboxTone = "alert" | "warn" | "default";

export type InboxListPatch = {
  statuses?: PayoutStatus[];
  batchStatus?: string;
  batchStuck?: boolean;
};

export type InboxTarget = {
  path: string;
  list?: InboxListPatch;
};

export type InboxItem = {
  id: string;
  section: "live" | "recent";
  tone: InboxTone;
  title: string;
  detail: string;
  to: InboxTarget;
};

export type Inbox = {
  live: InboxItem[];
  recent: InboxItem[];
  badgeCount: number;
};

export type TopUpEvent = {
  id: string;
  at: Date;
  merchantId: string;
  amount: number;
};

export type ListInboxArgs = {
  isAdmin: boolean;
  merchantId: string;
  demo: HouseDemo;
};

export function listInbox(
  db: MockDb,
  args: ListInboxArgs,
  topUps?: TopUpEvent[],
): Inbox;
```

`booksOf` อ่าน `MERCHANTS` จาก seed ไม่ใช่ `db.merchants` เทสร้านต้องใช้ `merchantId: "m-acme"`

- [ ] **Step 1: ติดตั้ง vitest**

จาก `payout-bo/app`:

```bash
npm install -D vitest
```

ใน `package.json` เพิ่มสคริปต์ `"test": "vitest run"`

ท้าย `vite.config.ts` ในออบเจ็กต์ `defineConfig` เพิ่ม:

```ts
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
```

ใน `tsconfig.app.json` เพิ่ม `"exclude": ["src/**/*.test.ts"]` คู่กับ `"include": ["src"]`

- [ ] **Step 2: เพิ่มชนิดใน `types.ts`**

ต่อท้ายไฟล์ (หลังชนิดที่มีอยู่) ใส่ `InboxTone`, `InboxListPatch`, `InboxTarget`, `InboxItem`, `Inbox`, `TopUpEvent` ตามบล็อก Interfaces ด้านบน import `PayoutStatus` อยู่แล้วในไฟล์นี้

- [ ] **Step 3: เขียนเทสที่ยัง fail**

สร้าง `payout-bo/app/src/mock/inbox.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NOW } from "../lib/bangkok";
import type { Batch, MockDb, Payout, SourceAccount, TopUpEvent } from "./types";
import { listInbox, type HouseDemo } from "./query";

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

function db(patch: Partial<MockDb> = {}): MockDb {
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
      db({
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
      db({
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
    const inbox = listInbox(db(), { isAdmin: true, merchantId: "", demo: { ...demoOff, noSource: true } }, []);
    const pool = inbox.live.find((i) => i.id === "pool-low");
    expect(pool?.title).toBe("ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชี");
    expect(pool?.to).toEqual({ path: "/payouts/overview" });
  });
});

describe("listInbox merchant", () => {
  it("hides pool and batches, shows operate-low and scoped payouts", () => {
    const inbox = listInbox(
      db({
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
      db({
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
});

describe("listInbox admin recent", () => {
  it("lists settled and failed batches not merchant top-ups", () => {
    const inbox = listInbox(
      db({
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
```

- [ ] **Step 4: รันเทสให้ fail**

```bash
npm test
```

Expected: FAIL เพราะยังไม่มี `listInbox` (หรือมีชนิดไม่ครบ)

- [ ] **Step 5: implement `listInbox` ท้าย `query.ts`**

เพิ่ม import ชนิดใหม่จาก `./types` และ `money` จาก `../lib/money`

```ts
import { money } from "../lib/money";
```

และใน import type จาก `./types` เพิ่ม `Inbox`, `InboxItem`, `TopUpEvent`

ต่อท้ายไฟล์:

```ts
const OPERATE_LOW = 50_000;
const DEMO_OFF: HouseDemo = {
  sendOff: false,
  staleBalance: false,
  noSource: false,
  queueExceeds: false,
};

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
```

อย่า export `DEMO_OFF` ถ้าไม่ใช้ ลบออกได้ `listInbox` ค่าเริ่ม `topUps = []` เทสส่ง `[]` เอง Task 2 จะส่ง `TOPUP_SEED` จาก UI

แก้ import `InboxTone` ใน `query.ts` ด้วย ถ้าใช้ใน annotation ของ `adminRecent`

- [ ] **Step 6: รันเทสให้ผ่าน**

```bash
npm test
```

Expected: PASS ทุกเคสใน `inbox.test.ts`

ถ้า `pool-low` ไม่โชว์ในเทสแถวแรก เพราะ `99000 < 50000 * 2` ต้องจริง ถ้า fail ให้ตรวจว่า `effectiveSource` ถูกเรียก

- [ ] **Step 7: Commit**

```bash
git add payout-bo/app/package.json payout-bo/app/package-lock.json payout-bo/app/vite.config.ts payout-bo/app/tsconfig.app.json payout-bo/app/src/mock/types.ts payout-bo/app/src/mock/query.ts payout-bo/app/src/mock/inbox.test.ts
git commit -m "$(cat <<'EOF'
Add listInbox so the bell can derive live and recent alerts from mock data.

EOF
)"
```

---

### Task 2: Seed ให้เดโมมีแถวจริง

**Files:**
- Modify: `payout-bo/app/src/mock/seed.ts` — `source.bankBalance` และ `TOPUP_SEED`
- Modify: `payout-bo/app/src/mock/query.ts` — default `topUps` เป็น `TOPUP_SEED`
- Modify: `payout-bo/app/src/mock/inbox.test.ts` — เคสกับ `db` จริง

**Interfaces:**
- Consumes: `listInbox` จาก Task 1, `TopUpEvent`
- Produces: `export const TOPUP_SEED: TopUpEvent[]` และ `listInbox(..., topUps = TOPUP_SEED)`

`BOOK_SEED["m-acme"].operate` เป็น `38250` อยู่แล้ว `< 50000` ห้ามลดซ้ำ

- [ ] **Step 1: เขียนเทส seed**

ต่อท้าย `inbox.test.ts`:

```ts
import { db, TOPUP_SEED } from "./seed";

describe("listInbox against seeded db", () => {
  it("shows pool-low for admin and top-up for Acme", () => {
    const admin = listInbox(db, { isAdmin: true, merchantId: "", demo: demoOff });
    expect(admin.live.some((i) => i.id === "pool-low")).toBe(true);
    const shop = listInbox(db, { isAdmin: false, merchantId: "m-acme", demo: demoOff });
    expect(shop.live.some((i) => i.id === "operate-low")).toBe(true);
    expect(shop.recent.some((i) => i.id === "topup-acme-1")).toBe(true);
    expect(admin.recent.some((i) => i.id.startsWith("topup-"))).toBe(false);
  });
});
```

ระวังวงจร import: `query.ts` import จาก `seed.ts` อยู่แล้ว ถ้า `query.ts` import `TOPUP_SEED` จาก `seed.ts` เป็น default param ตอนโหลดโมดูล ต้องไม่ให้ `seed.ts` import `listInbox`

แบบที่ถูก: `NotificationBell` ส่ง `TOPUP_SEED` เข้า `listInbox` เอง **อย่า** ให้ `query.ts` import `TOPUP_SEED`

แก้เทสเคส fixture ที่ส่ง `[]` ยังเหมือนเดิม เคส seed เรียก `listInbox(db, args, TOPUP_SEED)`

- [ ] **Step 2: รันเทสให้ fail**

```bash
npm test
```

Expected: FAIL ที่ `pool-low` เพราะ `bankBalance` ยัง `186400`

- [ ] **Step 3: ปรับ seed**

ใน `createDb` ของ `seed.ts` เปลี่ยน:

```ts
    bankBalance: 99000,
    bookBalance: 98800,
```

เพิ่ม export ใกล้ `BOOK_SEED`:

```ts
import type { TopUpEvent } from "./types";

export const TOPUP_SEED: TopUpEvent[] = [
  {
    id: "topup-acme-1",
    at: new Date("2026-08-31T16:40:00+07:00"),
    merchantId: "m-acme",
    amount: 50000,
  },
];
```

`seed.ts` import type จาก `./types` อยู่แล้ว เติม `TopUpEvent` ใน import นั้น

- [ ] **Step 4: รันเทสให้ผ่าน**

```bash
npm test
```

Expected: PASS รวมเคส seeded db

ถ้า `pool-low` ยังไม่ขึ้น ตรวจ `99000 < 100000` และ `dailyAmountUsed` จาก `createDb` อย่าให้เงื่อนไขอื่นกลืนแถว

- [ ] **Step 5: Commit**

```bash
git add payout-bo/app/src/mock/seed.ts payout-bo/app/src/mock/inbox.test.ts
git commit -m "$(cat <<'EOF'
Seed a low source balance and an Acme top-up so the bell has demo rows.

EOF
)"
```

---

### Task 3: กระดิ่งใน `Shell`

**Files:**
- Create: `payout-bo/app/src/features/notifications/NotificationBell.tsx`
- Modify: `payout-bo/app/src/layout/Shell.tsx`

**Interfaces:**
- Consumes: `listInbox`, `InboxItem`, `db` จาก `mock/seed`, `TOPUP_SEED`, `useViewer`, `useFilters`, `useNavigate`
- Produces: `<NotificationBell />` ไม่มี props

มาสเตอร์ใช้ `merchantId: ""` ห้ามใช้ `useScopedMerchantId()` เพราะตัวนั้นตามฟิลเตอร์ร้าน

- [ ] **Step 1: สร้าง `NotificationBell.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { db, TOPUP_SEED } from "../../mock/seed";
import { listInbox } from "../../mock/query";
import type { InboxItem } from "../../mock/types";
import { useFilters } from "../../state/FilterProvider";
import { useViewer } from "../../state/use-viewer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function InboxRow({ item, onPick }: { item: InboxItem; onPick: (item: InboxItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className={cn(
        "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted",
        item.tone === "alert" && "text-destructive",
        item.tone === "warn" && "text-warning",
      )}
    >
      <span className="text-sm font-medium">{item.title}</span>
      {item.detail ? <span className="text-xs text-muted-foreground">{item.detail}</span> : null}
    </button>
  );
}

export function NotificationBell() {
  const nav = useNavigate();
  const { isAdmin, demo, scopedMerchantId } = useViewer();
  const { setFilters, setPreset } = useFilters();
  const [open, setOpen] = useState(false);

  const inbox = useMemo(
    () =>
      listInbox(
        db,
        { isAdmin, merchantId: isAdmin ? "" : scopedMerchantId, demo },
        TOPUP_SEED,
      ),
    [isAdmin, scopedMerchantId, demo],
  );

  const onPick = (item: InboxItem) => {
    if (item.to.list) {
      setPreset("d30");
      setFilters({
        listPage: 1,
        batchListPage: 1,
        statuses: item.to.list.statuses ?? [],
        batchStatus: item.to.list.batchStatus ?? "",
        batchStuck: item.to.list.batchStuck ?? false,
      });
    }
    setOpen(false);
    nav(item.to.path);
  };

  const empty = inbox.live.length === 0 && inbox.recent.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="แจ้งเตือน">
          <Bell />
          {inbox.badgeCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none text-white">
              {inbox.badgeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>แจ้งเตือน</PopoverTitle>
        </PopoverHeader>
        {empty ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">ไม่มีเรื่องที่ต้องลงมือตอนนี้</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {inbox.live.length ? (
              <div>
                <p className="px-2 pb-1 text-xs text-muted-foreground">ต้องลงมือ</p>
                {inbox.live.map((item) => (
                  <InboxRow key={item.id} item={item} onPick={onPick} />
                ))}
              </div>
            ) : null}
            {inbox.recent.length ? (
              <div>
                <p className="px-2 pb-1 text-xs text-muted-foreground">ล่าสุด</p>
                {inbox.recent.map((item) => (
                  <InboxRow key={item.id} item={item} onPick={onPick} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

ใช้ `PopoverTrigger asChild` แบบเดียวกับ `DateRangePicker.tsx` ปุ่มต้องมี `aria-label="แจ้งเตือน"`

- [ ] **Step 2: วางใน `Shell.tsx`**

import `NotificationBell` แล้วใส่ซ้ายของ `Select` บทบาท:

```tsx
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <Select value={role} onValueChange={(v) => onRoleChange(v as Role)}>
```

- [ ] **Step 3: ตรวจชนิดและเทส**

```bash
npm test
npm run build
```

Expected: เทสผ่าน และ `tsc -b && vite build` สำเร็จ

- [ ] **Step 4: ตรวจในเบราว์เซอร์**

`npm run dev` ที่ `http://localhost:5173`

มาสเตอร์

1. กระดิ่งอยู่ซ้ายของ «แพลตฟอร์มแอดมิน» มีจุดเท่าจำนวนแถว «ต้องลงมือ»
2. กดแล้วได้ popover ไม่ใช่ dialog กลางจอ
3. มีช่วงต้องลงมือ (อย่างน้อย pool-low / คิวชุด) และช่วงล่าสุดเป็นชุดสำเร็จหรือล้มเหลว
4. กดแถวคิวชุดแล้วไป `/payouts/batches` กรองรอส่ง
5. กดชุดล่าสุดแล้วไปรายละเอียดชุด
6. ไม่มีแถวเติมเงิน

ร้าน — สลับเป็น «ร้าน Acme (DIRECT)»

1. จุดบนกระดิ่งเปลี่ยนชุด
2. ไม่มี pool-low ไม่มีลิงก์ชุดโอน
3. มียอดใช้ได้ใกล้หมด และมีเติมเงินในล่าสุด
4. กดรอส่งแล้วไป `/payouts` กรองรอส่ง
5. กดเติมเงินแล้วไปภาพรวม
6. หน้าที่ไม่มีภาพรวม (เช่น `/users`) ยังมีกระดิ่ง

ถ้ากระดิ่งกดแล้วไม่เปิด popover ให้เทียบกับ `DateRangePicker.tsx` แล้วแก้ อย่าจบทั้งที่กดไม่ได้

- [ ] **Step 5: Commit**

```bash
git add payout-bo/app/src/features/notifications/NotificationBell.tsx payout-bo/app/src/layout/Shell.tsx
git commit -m "$(cat <<'EOF'
Put a notification bell in the shell header that opens an actionable inbox.

EOF
)"
```

---

## Self-review

- Spec ข้อ 3.1 live ทั้งห้า id มีใน Task 1
- Spec ข้อ 3.2 recent + cap 5 + ร้านมี top-up มาสเตอร์ไม่มี มีใน Task 1–2
- Spec ข้อ 4 เกณฑ์ pool / operate และการลด `bankBalance` มีใน Task 1–2 `operate` ของ Acme ไม่ต้องลด
- Spec ข้อ 5 จุดคลิกอยู่ใน `to` ของแต่ละแถว Task 3 แค่ `setPreset` + `setFilters` + `nav`
- Spec ข้อ 6 popover / badge / ข้อความว่าง / ไม่มีอ่านแล้ว มีใน Task 3
- Spec ข้อ 8 สลับบทบาทใช้ `useMemo` ตาม `isAdmin` + `scopedMerchantId` + `demo`
- ไม่มีรหัสผิดซ้ำ ไม่มี dialog
- ชื่อชนิด Task 3 ตรง Task 1 (`InboxItem.to.list`)
