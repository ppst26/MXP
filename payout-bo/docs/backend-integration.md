# คู่มือเชื่อม Backend — Payout BO (P7a)

วันที่: 2026-09-01  
สถานะ: อ้างอิงจาก mock ใน `app/src/mock/` และสัญญา API ใน [design.md § E4](design.md#e4-api-หลังบ้าน)

เอกสารนี้ตอบคำถาม **เรียก API ไหน ส่ง/รับ field อะไร ไปแสดงที่ component ไหน**  
สเปกผลิตภัณฑ์เต็ม (สีสถานะ, UX, สิทธิ์) ยังอยู่ที่ `design.md`

---

## สารบัญ

| หัวข้อ | เรื่อง |
|---|---|
| [1](#1-ภาพรวม) | ภาพรวม mock → API |
| [2](#2-กติกาทั่วไป) | กติกาทั่วไป (ซองคำตอบ, เงิน, เวลา, auth) |
| [3](#3-แหล่งข้อมูล-db) | ตาราง DB ที่อ่าน |
| [4](#4-รายการ-api) | รายการ API |
| [5](#5-ภาพรวม-overview) | หน้าภาพรวม `/payouts/overview` |
| [6](#6-รายการใบ) | หน้ารายการใบ `/payouts` |
| [7](#7-รายละเอียดใบ) | รายละเอียดใบ |
| [8](#8-ชุดโอน) | ชุดโอน (แอดมิน) |
| [9](#9-สิทธิ์ตามบทบาท) | สิทธิ์ตามบทบาท |
| [10](#10-สูตรที่-backend-ต้องตรง) | สูตรที่ backend ต้องตรงกับ mock |
| [11](#11-แผนเปลี่ยน-frontend) | แผนเปลี่ยน frontend จาก mock |

---

## 1. ภาพรวม

ตอนนี้ frontend อ่านจาก `MockDb` ใน `app/src/mock/seed.ts` และคำนวณผ่าน `app/src/mock/query.ts`  
เมื่อเชื่อม backend ให้ **ย้ายสูตรไปฝั่ง API** แล้ว frontend แค่ render

```
┌─────────────────┐     session cookie      ┌──────────────────────────────┐
│  React pages    │ ───────────────────────▶│  GET /api/v1/admin/payouts/* │
│  features/*     │ ◀── JSON { data: … } ───│  (+ merchants ที่มีอยู่แล้ว)   │
└─────────────────┘                         └──────────────────────────────┘
         │                                              │
         │ วันนี้: db, query.ts                         │ อ่าน payouts,
         └──────────────────────────────────────────────┤  payout_batches,
                                                          bank_accounts, ledger…
```

| หน้า | Route | API หลัก |
|---|---|---|
| ภาพรวม | `/payouts/overview` | `GET …/payouts/overview` |
| รายการใบ | `/payouts` | `GET …/payouts` |
| รายละเอียดใบ | `/payouts/:referenceId` | `GET …/payouts/:referenceId` |
| รายการชุด | `/payouts/batches` | `GET …/payouts/batches` |
| รายละเอียดชุด | `/payouts/batches/:id` | `GET …/payouts/batches/:id` |
| ตัวเลือกร้าน | ทุกหน้าที่มี filter | `GET /api/v1/admin/merchants` (มีอยู่แล้ว) |

---

## 2. กติกาทั่วไป

### 2.1 ซองคำตอบ

```json
{
  "success": true,
  "code": 200,
  "data": { }
}
```

- 401 ไม่ได้ล็อกอิน · 404 ไม่พบหรือนอกสิทธิ · 400 ช่วงเกิน 90 วัน / พารามิเตอร์ผิด
- API 500: frontend **ห้าม** แทนที่ด้วยศูนย์ — แสดง error + ปุ่มลองใหม่

### 2.2 เงิน

| ประเภท | รูปแบบ |
|---|---|
| `amount`, `reserved_fee`, ยอดสมุดร้าน | สตริงทศนิยม สเกล **4** เช่น `"1840.0000"` |
| `bank_fee`, ยอดธนาคาร, เพดานยอด | สตริงทศนิยม สเกล **2** เช่น `"5.00"` |
| `success_rate` | สตริง 0–1 สเกล 4 เช่น `"0.8750"` |

ห้ามใช้ `float64` ใน JSON

### 2.3 เวลา

- ตัดช่วงและแสดงผลโซน **Asia/Bangkok**
- ใบ: ตัดช่วงที่ `payouts.created_at`
- ชุด: ตัดช่วงที่ `payout_batches.created_at`
- คิวเรียลไทม์ (โซน 1–2): **ไม่** ตัด `from`/`to`

### 2.4 Auth / ขอบเขตร้าน

- Session auth เหมือน BO อื่น
- `merchantId` ว่าง = ตามสิทธิ์ผู้เรียก (แอดมินทั้งระบบ / ร้านทั้งสาย)
- เลือกโหนดตัวแทน = ได้ทั้งสาย (ดู [design.md A6](design.md#a6-ตัวเลือกร้าน))
- ร้านขอ `merchantId` นอกสาย → **404** ไม่ใช่ลิสต์ว่าง

### 2.5 Pagination (รายการใบ/ชุด)

```json
"pagination": { "page": 1, "limit": 20, "total": 142, "pages": 8 }
```

- `page` เริ่ม 1 · `limit` default 20 สูงสุด 100

### 2.6 Polling

| โซน | ความถี่ |
|---|---|
| โซน 1–2 (คิว, บัญชีต้นทาง) | poll ทุก **15 วินาที** |
| โซน 3 (สรุปช่วง) | โหลดใหม่เมื่อเปลี่ยนตัวกรอง |

ไม่มี WebSocket ในเฟสนี้

---

## 3. แหล่งข้อมูล DB

ห้ามสร้างตารางสรุปแยกสำหรับ dashboard — อ่านจากตารางจริง (ดู [design.md F1](design.md#f1-สิ่งที่มีในฐานข้อมูลวันนี้-กับสิ่งที่รอ-p4c))

| ตาราง / แหล่ง | ใช้กับ |
|---|---|
| `payouts` | ใบถอน, KPI, คิว, ตาราง |
| `payout_batches` | ชุดโอน (หลัง P4c) |
| `bank_accounts` | บัญชีต้นทาง (`payout.source_account_id`) |
| `bank_account_daily_stats` | เพดานวัน `out_count`, `out_amount` |
| `ledger_accounts` | สมุดร้าน (`MERCHANT_OPERATE`, …) |
| config `pool.balance_max_age` | เกณฑ์ยอดธนาคารเก่า (mock: 5 นาที) |

---

## 4. รายการ API

| Method | Path | ใครเรียกได้ | หมายเหตุ |
|---|---|---|---|
| GET | `/api/v1/admin/payouts/overview` | แอดมิน + ร้าน | หน้าภาพรวม |
| GET | `/api/v1/admin/payouts` | แอดมิน + ร้าน | รายการใบ + summary |
| GET | `/api/v1/admin/payouts/:referenceId` | แอดมิน + ร้าน (ในสาย) | รายละเอียดใบ |
| GET | `/api/v1/admin/payouts/batches` | **แอดมินเท่านั้น** | 404 ถ้าเป็นร้าน |
| GET | `/api/v1/admin/payouts/batches/:id` | **แอดมินเท่านั้น** | 404 ถ้าเป็นร้าน |
| GET | `/api/v1/admin/merchants` | มีอยู่แล้ว | ตัวเลือกร้าน |

---

## 5. ภาพรวม `/payouts/overview`

**Endpoint:** `GET /api/v1/admin/payouts/overview`

### 5.1 Query parameters

| พารามิเตอร์ | ใช้กับ | หมายเหตุ |
|---|---|---|
| `from`, `to` | โซน 3 เท่านั้น | ISO 8601 +07:00 · กว้างสุด 90 วัน |
| `merchantId` | โซน 2–3 | ว่าง = ตามสิทธิ์ |
| `route` | โซน 3 | `SAME_BANK` \| `INTERBANK` |
| `status` | โซน 3 | ซ้ำได้ (multi) |

**ไม่รับ** `q`, `recipientAccount`, `batchId` บน overview

### 5.2 โครง `data` (สรุป)

```json
{
  "sourceAccount": { },
  "queue": { },
  "period": { },
  "previousPeriod": { },
  "byRoute": [ ],
  "byRecipientBank": [ ],
  "timeseries": [ ],
  "successRateTimeseries": [ ],
  "grain": "hour",
  "merchantBooks": null,
  "merchantWatch": null
}
```

### 5.3 `sourceAccount` → โซน 1 (`OverviewZone1` / `SourceHeroLeft`)

แสดงเฉพาะ **แพลตฟอร์มแอดมิน** — ร้านได้ `null`

| JSON (API) | TypeScript mock | แสดงบนจอ |
|---|---|---|
| `payout_enabled` | `payoutEnabled` | จุดสถานะ "รับคำสั่ง" |
| `send_enabled` | `sendEnabled` | จุดสถานะ "ส่งเงิน" |
| `bank_code`, `bank_name` | `bankCode`, `bankName` | `KTB · 1234567890` |
| `account_no` | `accountNo` | เลขบัญชี |
| `account_name` | `accountName` | ชื่อบัญชีใต้ยอด |
| `tier` | `tier` | เตือนถ้าไม่ใช่ `OUTBOUND` |
| `status` | `status` | `ACTIVE` / … |
| `bank_balance` | `bankBalance` | ยอดใหญ่ขวาบน |
| `bank_balance_at` | `bankBalanceAt` | "รีเฟรช N นาทีที่แล้ว" |
| `min_balance` | `minBalance` | สำรอง · เทียบคิว |
| `daily_txn_cap` | `dailyTxnCap` | เพดานรายการ |
| `daily_txn_used` | `dailyTxnUsed` | ใบที่ส่งวันนี้ (**นับเป็นใบ** ไม่ใช่ชุด) |
| `daily_amount_cap` | `dailyAmountCap` | เพดานโอนวันนี้ |
| `daily_amount_used` | `dailyAmountUsed` | ยอดโอนวันนี้ |
| `book_balance` | `bookBalance` | เทียบกับยอดธนาคาร (เตือนไม่ตรง) |

**แหล่ง DB:** `bank_accounts` + `bank_account_daily_stats`  
**เพดานรายการ:** `out_count` / `daily_txn_cap` ตาม [design.md B1](design.md#b1-โซน-1--สุขภาพบัญชีต้นทาง)  
mock ประมาณจากใบที่ `created_at` วันนี้ สถานะ `COMPLETED` \| `PROCESSING` \| `NEEDS_REVIEW`

**สถิติ 3 ช่องล่าง (SourceHeroLeft):**

| ช่อง | คำนวณจาก |
|---|---|
| คิวที่กันไว้ | `queue.heldAmount` หรือ `SUM(amount+reserved_fee)` ของ PENDING+PROCESSING ในขอบเขต |
| เพดานโอนวันนี้ | `daily_amount_used` / `daily_amount_cap` |
| เพดานรายการ | `daily_txn_used` / `daily_txn_cap` |

**ด้านขวา (`FollowUpHeroRight`):** ใช้ `queue` + รายการใบจาก DB (ดู 5.4) ไม่ต้องส่งใบเต็มถ้า API ส่ง count แยกแล้ว — mock ส่ง array เพื่อคลิกไปหน้ารายการ

### 5.4 `queue` → โซน 1 ขวา + โซน 2

**ไม่ตัด `from`/`to`** — สแนปชอตคิว ณ ตอนนี้

```json
"queue": {
  "pendingCount": 4,
  "pendingAmount": "1200.0000",
  "oldestPendingAgeSeconds": 180,
  "processingCount": 2,
  "processingUnconfirmedCount": 1,
  "processingConfirmedCount": 0,
  "needsReviewCount": 0,
  "needsReviewAmount": "0.0000",
  "heldAmount": "6900.6000",
  "openCount": 9,
  "batches": {
    "pendingCount": 1,
    "sendingCount": 0,
    "sentCount": 1,
    "needsReviewCount": 0,
    "stuckCount": 0
  }
}
```

| ฟิลด์ | Component | ความหมาย |
|---|---|---|
| `pendingCount`, `pendingAmount`, `oldestPendingAgeSeconds` | `PayoutFocusList` | รอส่ง |
| `processingUnconfirmedCount` | บรรทัดรอง "ห้ามส่งซ้ำ N" | มีเลขออเดอร์แต่ยังไม่ `confirmed_at` |
| `needsReviewCount` | การ์ดรอตรวจ | |
| `heldAmount` | เงินที่กันไว้ | PENDING + PROCESSING เท่านั้น (ไม่รวม NEEDS_REVIEW ใน mock `queueHeldOf`) |
| `queue.batches.*` | `BatchFocusList` | ก่อน P4c ส่ง **`null`** ไม่ใช่ศูนย์ปลอม |

**แบนเนอร์ (`HouseBanners`):** คำนวณฝั่ง frontend จาก `sourceAccount` + `queue` หรือ backend ส่ง `alerts[]` — mock ใช้ `houseAlerts()` ใน `query.ts`

### 5.5 `period` / `previousPeriod` → โซน 3 (`PeriodKpis`, `ComparePairs`)

โครงสอดคล้อง `PeriodMetrics` ใน `app/src/mock/types.ts`:

| JSON | mock field | การ์ด / กราฟ |
|---|---|---|
| `count` | `count` | จำนวนใบ |
| `amount` | `amount` | ยอดโอน |
| `completed_count`, `completed_amount` | `completedCount`, `completedAmount` | สำเร็จ |
| `failed_count`, `failed_amount` | `failedCount`, `failedAmount` | ล้ม |
| `rejected_count`, `rejected_amount` | `rejectedCount`, `rejectedAmount` | ไม่รับทำ (บรรทัดรอง) |
| `success_rate` | `successRate` | อัตราสำเร็จ |
| `reserved_fee` | `reservedFee` | ค่าบริการร้าน |
| `bank_fee.incurred` | `incurred` | ค่าโอนธนาคารที่เกิดแล้ว |
| `bank_fee.incurred_count` | `incurredCount` | N ใบข้ามธนาคารที่คิดแล้ว |
| `bank_fee.exposed` | `exposed` | ประมาณการคิว INTERBANK |
| `bank_fee.delta` | `bankFeeDelta` | ส่วนต่างจาก N×5 |
| `same_bank_count`, `interbank_count` | `sameBank`, `interbank` | คู่ 2 เส้นทาง |
| `batch_count`, `batch_settled_count`, … | `BatchPeriodSummary` | การ์ดชุด (แอดมิน) |

สูตรค่าโอนธนาคาร: [design.md A5](design.md#a5-ค่าธรรมเนียมโอนธนาคาร-ต้นทุนบ้าน) · ต้องตรง `metrics()` ใน `query.ts`

### 5.6 `timeseries` / `successRateTimeseries`

| ฟิลด์ | ใช้กับ |
|---|---|
| `label` | แกน X |
| `current`, `previous` | คู่ 1 ยอด COMPLETED |
| `count_current`, `count_previous` | สลับมุมมองจำนวน |
| `batch_current`, `batch_previous` | จำนวนชุด (แอดมิน) |
| `fee_current`, `fee_previous` | reserved_fee ต่อ bucket |

`grain`: `"hour"` เมื่อช่วง ≤ 48 ชม. · `"day"` นอกนั้น

### 5.7 `merchantBooks` → `MerchantBooksCards`

ส่งเมื่อขอบเขตเป็น **ร้าน DIRECT ร้านเดียว** เท่านั้น

```json
"merchantBooks": {
  "operate": "38250.0000",
  "parking": "0.0000",
  "freeze": "0.0000",
  "pending_payout": "1840.0000",
  "freeze_balance": "1840.0000",
  "balance": "40090.0000"
}
```

| บัญชีสมุด | JSON |
|---|---|
| MERCHANT_OPERATE | `operate` |
| MERCHANT_PARKING | `parking` |
| MERCHANT_FREEZE | `freeze` |
| MERCHANT_PENDING_PAYOUT | `pending_payout` (คำนวณจากใบค้าง) |

### 5.8 `merchantWatch` → `MerchantWatch`

แพลตฟอร์มแอดมินเท่านั้น · สูงสุด **8 แถว** · ร้าน DIRECT เท่านั้น

```json
{
  "merchant_id": "m-acme",
  "name": "Acme",
  "code": "VOBM7qzaRH",
  "completed_count": 12,
  "completed_amount": "18400.0000",
  "failed_count": 1,
  "needs_review_count": 0,
  "pending_count": 2,
  "held_amount": "1500.0000",
  "oldest_pending_age_seconds": 1800
}
```

เรียง `alertScore` ตาม [design.md B4](design.md#b4-ร้านที่ต้องดู-แพลตฟอร์มแอดมินเท่านั้น)

### 5.9 แผนที่ component ↔ ข้อมูล

| Component | ไฟล์ | ข้อมูลจาก |
|---|---|---|
| `OverviewZone1` | `features/overview/OverviewZone1.tsx` | `sourceAccount`, `queue`, batches จาก DB |
| `HouseBanners` | `features/overview/HouseBanners.tsx` | alerts จาก source + queue |
| `MerchantBooksCards` | `features/overview/MerchantBooksCards.tsx` | `merchantBooks` |
| `QueueCards` | `features/overview/QueueCards.tsx` | `queue` (ร้าน) |
| `PeriodKpis` | `features/overview/PeriodKpis.tsx` | `period`, `previousPeriod` |
| `ComparePairs` | `features/overview/ComparePairs.tsx` | period, timeseries, byRoute, byRecipientBank |
| `MerchantWatch` | `features/overview/MerchantWatch.tsx` | `merchantWatch` |

---

## 6. รายการใบ `/payouts`

**Endpoint:** `GET /api/v1/admin/payouts`

### 6.1 Query (ตาม [design.md C1](design.md#c1-ตัวกรอง))

| พารามิเตอร์ | mock (`PayoutFilter`) |
|---|---|
| `from`, `to` | `filters.from`, `filters.to` |
| `merchantId` | `merchantId` (scoped) |
| `route` | `filters.route` |
| `status` (multi) | `filters.statuses[]` |
| `q` | `filters.q` → `reference_id` \| `transaction_id` |
| `recipientAccount` | `filters.recipientAccount` |
| `nameMismatch` | `filters.nameMismatch` |
| `batchId` | `filters.batchId` |
| `sourceAccountId` | (ยังไม่มีใน mock UI) |
| `page`, `limit` | `filters.listPage`, limit=20 |

### 6.2 Response

```json
{
  "data": {
    "items": [ { /* payout row */ } ],
    "summary": { /* PeriodMetrics ย่อ */ },
    "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 }
  }
}
```

`summary` คำนวณจาก **ทั้งชุดที่กรอง** ไม่ใช่แค่หน้าปัจจุบัน → `PayoutSummary`

### 6.3 แถวใบ (`items[]`) → `PayoutTable`

| JSON | mock (`Payout`) | คอลัมน์ |
|---|---|---|
| `created_at` | `createdAt` | เวลาสร้าง |
| `merchant_code`, `merchant_name` | `merchantCode`, `merchantName` | ร้าน |
| `reference_id` | `referenceId` | อ้างอิง (ลิงก์) |
| `transaction_id` | `transactionId` | ออเดอร์ร้าน |
| `amount` | `amount` | ยอด |
| `reserved_fee` | `reservedFee` | ค่าบริการ |
| `status` | `status` | สถานะ |
| `bank_fee`, `bank_fee_estimated` | `bankFee`, `bankFeeEstimated` | ค่าโอน (**ซ่อนร้าน**) |
| `recipient_bank_code` | `recipientBankCode` | โลโก้ + เลข (`BankMark`) |
| `recipient_account_no` | `recipientAccountNo` | |
| `account_to_name` | `accountToName` | ชื่อที่ธนาคารตอบ |
| `batch_id` | `batchId` | ลิงก์ชุด / กรอง |
| `failure_reason` | `failureReason` | สาเหตุ |

**ไม่มี** คอลัมน์เส้นทาง — `route` ใช้ในตัวกรองและหน้ารายละเอียด

`route` คำนวณ: `recipient_bank_code === source.bank_code` → `SAME_BANK` ไม่งั้น `INTERBANK`

---

## 7. รายละเอียดใบ

**Endpoint:** `GET /api/v1/admin/payouts/:referenceId`

### 7.1 Response หลัก

ฟิลด์ครบตาม `Payout` ใน `types.ts` + บล็อก `batch`:

```json
"batch": null
```

หรือ (แอดมิน):

```json
"batch": {
  "id": "batch-…",
  "status": "SENT",
  "package_ref_no": "PKG-…",
  "bank_bulk_order_id": "…",
  "bank_item_id": "…"
}
```

**ร้าน:** ได้ `id`, `package_ref_no`, `status` — **ไม่มี** `bank_bulk_order_id` · **ไม่มี** ยอดรวมชุด

### 7.2 บล็อก UI (`PayoutDetailView`)

| บล็อก | ฟิลด์หลัก |
|---|---|
| หัว | `status`, `amount`, `merchant_name`, `created_at` |
| ผู้รับ | `recipient_*`, `route`, `bank_fee` (แอดมิน) |
| บัญชีต้นทาง | `source_*` ของ**ใบนี้** (snapshot ตอนสร้าง) |
| เงิน | `amount`, `reserved_fee` |
| ชุด | `batch` |
| ธนาคาร | `bank_order_id`, `confirmed_at`, `attempts`, `next_attempt_at` |
| ไทม์ไลน์ | `timeline[]` |
| สมุด | `journal[]` |
| สาเหตุ | `failure_reason` |
| callback | `callback_url` — **แอดมินเท่านั้น** แสดงเป็นข้อความ ไม่ใช่ลิงก์ |

---

## 8. ชุดโอน

**แอดมินเท่านั้น** — ร้านได้ 404 ทั้งหน้า

### 8.1 `GET /api/v1/admin/payouts/batches`

Query: `from`, `to`, `status`, `q` (id / bulk order / package ref), `stuck`, `page`, `limit`

แถว → `Batch` ใน `types.ts` · `BatchTable` + `BatchSummary`

### 8.2 `GET /api/v1/admin/payouts/batches/:id`

= แถวชุด + ยอดรวม + `items[]` (แถวใบย่อ) + `timeline[]`

---

## 9. สิทธิ์ตามบทบาท

| ข้อมูล | แอดมิน | ร้าน / ตัวแทน |
|---|---|---|
| `sourceAccount` | ได้ | `null` |
| `queue.batches` | ได้ (หลัง P4c) | `null` |
| `period.bank_fee` / ค่าโอน | ได้ | `null` |
| `merchantWatch` | ได้ | `null` |
| `bank_fee` ในใบ | ได้ | ไม่ส่ง |
| หน้าชุด | ได้ | 404 |
| `batch` ยอดรวมชุด | ได้ | ไม่ส่ง |

รายละเอียด: [design.md E3](design.md#e3-สิทธิ์)

---

## 10. สูตรที่ backend ต้องตรง

อ้างอิง `app/src/mock/query.ts` — เปลี่ยนที่ใดต้องอัปเดตทั้ง API และเอกสาร

| สูตร | นิยาม |
|---|---|
| อัตราสำเร็จ | `COMPLETED / (COMPLETED + FAILED)` — ไม่รวม REJECTED, PENDING, … |
| `heldAmount` (การ์ดกันไว้) | `SUM(amount + reserved_fee)` ของ PENDING + PROCESSING |
| `pending_payout` (สมุด) | รวม NEEDS_REVIEW ด้วย |
| `incurred` | COMPLETED INTERBANK + FAILED ที่ `bank_fee > 0` |
| `exposed` | COUNT(PENDING\|PROCESSING INTERBANK) × 5.00 |
| INTERBANK ประมาณ | 5.00 บาท/ใบ เมื่อยังไม่มี `bank_fee` จริง |
| เพดานรายการ | นับเป็น **ใบ** (`daily_txn_cap`) ไม่ใช่ชุด |
| ช่วงก่อนหน้า | ตาม [design.md B](design.md#ส่วน-b--dashboard-payoutsoverview) (วันเดียว vs sliding window) |
| `alertScore` | B4 ใน design.md |

---

## 11. แผนเปลี่ยน frontend จาก mock

1. สร้าง `app/src/api/` — client + types จาก JSON (snake_case → camelCase ที่ boundary)
2. แทนที่ `import { db } from "../mock/seed"` ใน pages ด้วย hooks เช่น `useOverview()`, `usePayouts()`
3. เก็บ `query.ts` เป็น reference test หรือ unit test เปรียบเทียบกับ API
4. `FilterProvider` / query string — sync `from`, `to`, `merchantId`, … กับ URL (optional แต่แนะนำ)
5. โซน 1–2: `useQuery` + `refetchInterval: 15000`
6. Error boundary ต่อ zone — 500 ไม่ fallback เป็นศูนย์

| ไฟล์ที่แตะก่อน | เหตุผล |
|---|---|
| `pages/OverviewPage.tsx` | endpoint ใหญ่สุด |
| `pages/PayoutsPage.tsx` | list + pagination |
| `pages/PayoutDetailPage.tsx` | detail |
| `pages/BatchesPage.tsx`, `BatchDetailPage.tsx` | แอดมิน |
| `layout/DateMerchantFilter.tsx` | โหลด merchants จาก API |

---

## เอกสารที่เกี่ยวข้อง

| ไฟล์ | เนื้อหา |
|---|---|
| [design.md](design.md) | สเปกผลิตภัณฑ์ + E4 API contract |
| [app/src/mock/types.ts](../app/src/mock/types.ts) | TypeScript types ปัจจุบัน |
| [app/src/mock/query.ts](../app/src/mock/query.ts) | สูตรคำนวณ mock |
| P4a / P4b / P4c design docs | สร้างใบ / ส่ง / ปิดชุด |
