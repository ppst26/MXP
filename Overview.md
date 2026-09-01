# Product Requirements & Project Definition: Enterprise Financial Payment Gateway (KTB Corporate Edition)

## 1. นิยามและคอนเซ็ปต์ของโปรเจกต์ (Project Definition & Core Concept)

### Project Concept:

ระบบ Payment Gateway ระดับ SaaS Enterprise ที่พัฒนาขึ้นโดยต่อตรงกับ Direct API ของธนาคารกรุงไทย (KTB Corporate / บัญชี บจก.) เพื่อแก้ปัญหาคอขวดของบัญชีบุคคลธรรมดา (ลดความเสี่ยงบัญชีถูกระงับ/ปลิวจาก Transaction ถี่, ปลดล็อกข้อจำกัดวงเงิน และการติดเงื่อนไขสแกนใบหน้า)

ระบบวางลำดับความสำคัญของกระบวนการตรวจสอบและยืนยันยอดเงิน (Reconciliation Hierarchy) ดังนี้:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│               Hierarchy of Deposit Reconciliation & Matching                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
    [ อันดับที่ 1: Direct Transfer Statement Matching (กลไกหลัก) ]
    • จับคู่จาก Statement ธนาคารตรง (เลขบัญชีผู้โอน + ชื่อผู้โอน + ยอดเงิน)
    • ลูกค้าโอนยอดตรงปกติ ไม่ต้องมีเศษสตางค์ ไม่ต้องแนบสลิป
                                      │
                                      ▼
    [ อันดับที่ 2: Dynamic QR Code / Floating Amount (สุ่มเศษสตางค์) ]
    • สุ่มเศษสตางค์ ±1.99 บาท เช่น 500 -> 500.35 บาท
    • สร้างเป็น PromptPay / Thai QR Payment ล็อกยอดและเวลา Timeout
                                      │
                                      ▼
    [ ฟังก์ชันมาตรฐาน Payment Gateway สากล ]
    • Digital Signature (HS256), Encrypted Webhook, Bank Verification, 
      Multi-tenant Isolation, Virtual Ledger, Idempotency Guarantee
```

## 2. โครงสร้างหลักการทำงานสำคัญ (Core Principles & Workflows)

### 2.1 กระบวนการรับชำระเงิน (Inbound / Deposit Flow)

```
[ ผู้ใช้งาน (Frontend) ]         [ ระบบ Merchant Backend ]           [ Payment Gateway Engine ]         [ KTB Corporate (บจก.) ]
           │                                 │                                    │                                  │
  (เลือกวิธีโอนเงินตรง)                       │                                    │                                  │
           ├────────────────────────────────►│ 1. ยืนยันชื่อ บช. ลูกค้า            │                                  │
           │                                 ├──── POST /bank/verify/name ───────►│                                  │
           │                                 │◄─── 200 OK (Account Name) ─────────┤                                  │
           │                                 │                                    │                                  │
           │                                 │ 2. สร้าง Session รับเงิน           │                                  │
           │                                 ├──── POST /deposit/create ─────────►│                                  │
           │                                 │    (type: TRANSFER / QR)           │ 3. ล็อก Session (pending)        │
           │ 4. แสดงข้อมูลบัญชี / QR สแกน     │◄─── 200 OK (QR String / Pay Info) ─┤                                  │[cite: 5, 8]
           │◄────────────────────────────────┤                                    │                                  │
           │                                                                      │                                  │
    [ โอนเงินเข้าบัญชี ] ───────────────────────────────────────────────────────────────────────────────────────────►│ (Statement Update)
                                                                                  │                                  │
                                                                                  │ 5. อ่าน Inbound Statement        │
                                                                                  │◄─────────────────────────────────┤
                                                                                  │ 6. Matching Engine ประมวลผล:     │
                                                                                  │    - ตรวจเลข บช. + ชื่อผู้โอน      │
                                                                                  │    - ตรวจเศษสตางค์ (กรณี QR)      │[cite: 1, 5]
                                                                                  │ 7. ปรับสถานะเป็น completed       │[cite: 5, 8]
                                             │ 8. ยิง Encrypted Webhook Callback  │                                  │
                                             │◄─── POST callbackUrl ──────────────┤                                  │[cite: 5, 8]
                                             │    (hash AES-256 + TxID)           │                                  │
                                             ├──── HTTP 200 OK ──────────────────►│                                  │
                                             │                                    │                                  │
           │ 9. ปรับยอดเครดิตทันที (Auto)    │                                    │                                  │
           │◄────────────────────────────────┤                                    │                                  │
```

**Direct Transfer Matching (อันดับ 1):**

ลูกค้าลงทะเบียนเลขบัญชีต้นทาง ระบบตรวจสอบความถูกต้องผ่าน `POST /api/v1/client/bank/verify/bankAccountName`[cite: 5, 8]

เมื่อลูกค้าโอนเงินเข้าบัญชี บจก. Gateway จะดึง Statement จาก Direct API แล้วนำ เลขที่บัญชีผู้โอน (Sender Account), ชื่อผู้โอน (Sender Name), และ ยอดเงิน มาจับคู่กับรายการที่ตั้งไว้แบบ Real-time โดยไม่ต้องพึ่งพาเศษสตางค์[cite: 1, 5]

**Dynamic QR Code (อันดับ 2):**

หากเลือกจ่ายผ่าน QR ระบบจะสุ่มเศษสตางค์ในช่วง $\pm 1.99$ บาท (เช่น 100 บาท เป็น 99.58 หรือ 100.73 บาท) พร้อมล็อกเวลา Timeout (5–15 นาที) เพื่อสร้าง Unique Amount และจับคู่อัตโนมัติทันทีที่เงินเข้า[cite: 5, 8]

**Webhook Reconciliation:**

เมื่อระบบ Match สำเร็จ จะยิง HTTP POST ไปยัง `callbackUrl` พร้อมส่ง Signature/Hash เข้ารหัส เพื่อให้ระบบ Merchant ปรับเครดิตอัตโนมัติทันที (Zero Manual Review 100%)[cite: 1, 5]

### 2.2 กระบวนการจ่ายเงิน/โอนออก (Outbound / Direct Auto-Payout Flow)

ระบบออกแบบมาสำหรับ Plug-and-Play Integration ตัดขั้นตอน Manual Approval ออกทั้งหมด เพื่อให้ระบบหลังบ้านของ Merchant สั่งโอนเงินออกจากบัญชี บจก. ได้ทันทีในระดับวินาที (Direct Execution):

```
[ ระบบ Merchant Backend ]                       [ Payment Gateway Engine ]                   [ KTB Corporate Direct API ]
           │                                                 │                                             │
1. สร้าง Signature (HS256 + iat ms)                          │                                             │[cite: 5, 8]
2. ยิงคำสั่งโอนออกทันที                                      │                                             │
├──────── POST /api/v1/payout/create ───────────────────────►│                                             │[cite: 5, 8]
│         (amount, bankAccountNumber, bankName, name)        │ 3. ตรวจสอบ HS256 & Deduct Virtual Balance   │[cite: 2, 5]
│                                                            │ 4. บันทึกคิว (Status: pending)              │[cite: 5, 8]
│◄─────── 200 OK (Status: pending, refId) ───────────────────┤                                             │[cite: 5, 8]
│                                                            │                                             │
│                                                            │ 5. ส่งคำสั่งโอนเงินออกทันที                 │
│                                                            ├──── Direct Outbound Fund Transfer ─────────►│
│                                                            │    (Status: processing)                     │[cite: 5, 8]
│                                                            │                                             │
│                                                            │ 6. ธนาคารตัดเงินสำเร็จ                      │
│                                                            │◄─── Transfer Success (Bank Ref/Slip) ───────┤[cite: 5, 8]
│                                                            │ 7. อัปเดตสถานะเป็น completed                │[cite: 5, 8]
│ 8. ยิง Webhook Callback ยืนยันผล                           │                                             │
│◄─────── POST callbackUrl (AES-256 Hash + Bank Ref) ────────┤                                             │[cite: 5, 8]
├──────── HTTP 200 OK ──────────────────────────────────────►│                                             │
```

**ขั้นตอนการประมวลผล:**

**Authentication & Validation:** Merchant ส่ง Request พร้อม `x-api-key` และ `signature` (HS256 ผูกกับ timestamp ระดับ millisecond แบบ Single-Use)[cite: 5, 8]

**Direct Dispatch:** Gateway ตรวจสอบความถูกต้องและส่งคำสั่งยิงตรงเข้า KTB Corporate Core Banking ทันทีโดยไม่ต้องรอคนอนุมัติ[cite: 1, 3]

**Real-time Callback:** เมื่อเงินถูกโอนเข้าบัญชีลูกค้าปลายทางสำเร็จ ธนาคารตอบกลับสถานะ Gateway จะยิง Webhook แจ้ง `completed` พร้อมเลข Slip Reference กลับไปยัง Merchant ทันที

## 3. สถาปัตยกรรมสำหรับขยายตัวสู่ระบบ SaaS Enterprise (Scale SaaS Considerations)

เพื่อให้แพลตฟอร์มสามารถขยายตัวรองรับลูกค้าหลายราย (Multi-Tenant) และมีเสถียรภาพสูง จำเป็นต้องวางโครงสร้างเพิ่มเติมดังนี้:

### 3.1 สถาปัตยกรรมการแยก Tenant และบัญชี บจก. (Merchant → Corporate Accounts → Users)

**Cardinality บังคับใช้ทั้งระบบ:**

```
Merchant (Tenant)                    1 ──► N     บัญชี บจก. (Corporate Bank Account)
บัญชี บจก. (Corporate Bank Account)    1 ──► N     User (Sub-User / Staff)
```

- **1 Merchant มีได้หลายบัญชี บจก.:** ใช้กระจายวงเงิน หมุนเวียนบัญชีตาม Daily Limit และ Failover เมื่อบัญชีใดถูกระงับ โดยไม่ต้องแยก Merchant ใหม่
- **1 บัญชี บจก. มีได้หลาย User:** เช่น Master Admin, Maker, Approver, Inquiry — ผูกสิทธิ์กับบัญชี บจก. นั้น ไม่ใช่กับ Merchant ทั้งก้อน
- **รูปแบบบัญชีต่อ 1 บจก. (เลือกได้):**
  - **Option A (Dual Account):** 1 บจก. เปิด Inbound (รับอย่างเดียว) + Outbound (จ่ายอย่างเดียว)
  - **Option B (Single Account):** 1 บัญชีทำทั้งรับและจ่าย สภาพคล่องไหลเวียนทันทีโดยไม่ต้องโยกเงินภายใน

**Virtual Ledger Isolation:** ระบบแยกฐานข้อมูลกระเป๋าเงิน (Tenant Balance), ประวัติธุรกรรม และค่าธรรมเนียมของแต่ละ Merchant ออกจากกันอย่างเด็ดขาด (Logical Data Partitioning) แม้ Merchant นั้นจะผูกบัญชี บจก. หลายบัญชี

### 3.2 ความเสถียรของระบบและการจัดการทราฟฟิก (Queue & Idempotency)

**Event-Driven Message Queue:** ใช้ Message Queue (เช่น Redis, RabbitMQ, Kafka) สำหรับคิวรับ Webhook และคิวสั่ง Payout เพื่อรองรับคำขอพร้อมกัน (Concurrency) ในช่วง Peak Load ได้อย่างราบรื่น ไม่เกิดปัญหา Request ค้างหรือเซิร์ฟเวอร์ล่ม

**Idempotency Control:** ใช้ `transactionId` ที่ส่งมาจาก Merchant ล็อกใน Cache/Database เพื่อป้องกันการสั่งโอนเงินออกซ้ำ (Duplicate Payout) หรือการเติมเครดิตเบิ้ลจากการยิง Webhook ซ้ำ 100%

### 3.3 ระบบความปลอดภัยและการป้องกันการปลอมแปลง (Security & Anti-Tampering)

**Payload Hashing (AES-256):** ทุก Webhook Callback ต้องแนบค่า Hash ที่เข้ารหัสจาก `transactionId` ด้วย Key ลับ เพื่อให้ Merchant ตรวจสอบได้ว่าเป็นสัญญาณจริงจาก Gateway ไม่ใช่การยิงหลอก (Anti-Spoofing)[cite: 2, 5]

**Single-Use Signature Policy:** ค่า Timestamp ใน Payload ต้องตรงกับ Claim `iat` ใน Signature และจำกัดอายุไม่เกิน 30–60 วินาที เพื่อป้องกัน Replay Attack[cite: 5, 8]

### 3.4 การจัดการความเสี่ยงและสภาพคล่อง (Liquidity Management & Fallback)

**Pre-funding & Minimum Balance Alert:** ระบบแจ้งเตือนเมื่อเงินคงเหลือในบัญชีฝั่งจ่าย (Outbound) ต่ำกว่า Buffer ที่กำหนด เพื่อป้องกันธุรกรรม Payout ติดสถานะล้มเหลว (Failed)

**Circuit Breaker & Fallback Polling:** หาก Core Banking ของธนาคารเกิดความล่าช้า ระบบจะมีโหมด Circuit Breaker หยุดรับคำขอชั่วคราว พร้อมมี API สำหรับ Polling (`GET /api/v1/payout/:referenceId`) เพื่อให้ Merchant ตรวจสอบสถานะย้อนหลังได้ตลอดเวลา
