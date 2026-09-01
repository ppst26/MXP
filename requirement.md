# System Requirements & Project Scope: Enterprise Financial Payment Gateway (KTB Corporate Edition)

โครงสร้างข้อกำหนด (Requirements) ทั้งหมดสำหรับการพัฒนาระบบ Payment Gateway ระดับ SaaS Enterprise (เชื่อมต่อ Direct API ธนาคารกรุงไทย / บัญชี บจก.) แบ่งตามมิติเชิงธุรกิจและเชิงเทคนิค พร้อมประมาณการขอบเขตงาน (Scope):

---

## 1. Business Requirements (ข้อกำหนดเชิงธุรกิจ)

* **Zero Manual Review (ระบบอัตโนมัติ 100%):**
  * ปลดล็อกแรงงานคนในการตรวจสอบสเตทเมนต์หรือสลิป
  * ระบบฝากต้องปรับเครดิตอัตโนมัติ $\ge 98\%$ ภายในเวลาไม่เกิน 15 วินาที

* **Direct Auto-Payout (ปลดล็อกคอขวดการถอนเงิน):**
  * ยิงคำสั่งโอนเงินออกจากบัญชี บจก. ไปยังบัญชีลูกค้าปลายทางได้ทันทีผ่าน Direct API
  * ปราศจากระบบกดยืนยันหลายระดับ (No Manual Approval Hierarchy)
  * ขจัดเงื่อนไขการติดสแกนใบหน้าบุคคล

* **Reconciliation Hierarchy (ลำดับการยืนยันยอดเงินฝาก):**
  * **ลำดับที่ 1 (Direct Transfer Matching):** ลูกค้าโอนยอดเงินเต็มปกติ จับคู่โดยตรงจาก Bank Statement (เลขบัญชี + ชื่อผู้โอน + ยอดเงิน)
  * **ลำดับที่ 2 (Dynamic QR Code):** สุ่มเศษสตางค์ $\pm 1.99$ บาท ล็อกเวลา Timeout 5–15 นาที เพื่อสร้าง Unique Amount กรณีลูกค้าไม่ต้องการโอนเงินตรง

* **Account Hierarchy (Merchant → บช. บจก. → Users):**
  * **1 Merchant มีได้หลายบัญชี บจก.** (Inbound / Outbound / Dual) เพื่อกระจายวงเงิน หมุนเวียนบัญชี และลดความเสี่ยงบัญชีถูกระงับ
  * **1 บัญชี บจก. มีได้หลาย User** (Master Admin, Maker, Approver, Inquiry) เพื่อแบ่งสิทธิ์ปฏิบัติการบน Krungthai Business / Gateway
  * Ledger ของ Merchant รวมยอดจากทุกบัญชี บจก. ที่ผูกไว้ แต่ Statement และ Credential ของแต่ละบัญชีต้องแยกอิสระ

* **Virtual Ledger & Multi-Tenancy:**
  * จัดการแยกกระเป๋าเงิน (Tenant Balance), ประวัติธุรกรรม และค่าธรรมเนียมของแต่ละร้านค้าออกจากกัน 100% (Logical Partitioning) แม้เงินจริงจะหมุนเวียนในกองบัญชี บจก. รวม (Shared Pool)

* **Liquidity & Pre-funding Policy:**
  * ระบบควบคุมยอดเงินสำรองขั้นต่ำ (Buffer Balance) ฝั่ง Outbound
  * ส่งการแจ้งเตือนอัตโนมัติเมื่อยอดเงินเหลือต่ำกว่าเกณฑ์ความปลอดภัย เพื่อป้องกันคำสั่ง Payout ติดสถานะล้มเหลว (Failed)

* **Commercial & Fee Deductions:**
  * รองรับการตัดค่าบริการตามเรตส่วนต่าง (เช่น 1.5% – 2.5%) แบบ Real-time รายธุรกรรม หรือหักจาก Prepaid Credit

---

## 2. Technical & Development Requirements (ข้อกำหนดเชิงเทคนิค)

### 2.1 Authentication & Anti-Replay Engine
* **Service Credentials:** ยืนยันตัวตนด้วย Credentials 4 ค่าหลัก ได้แก่ `x-api-key`, `Secret Key`, `Merchant ID`, และ `Client ID` (ระดับ Merchant)
* **Corporate Account Mapping:** 1 Merchant ผูกบัญชี บจก. ได้หลายบัญชี แต่ละบัญชีมี User ได้หลายคน (Master / Maker / Approver / Inquiry)
* **Single-Use Signature:** คำนวณ Digital Signature ด้วย JWT `HS256` ผูกกับ timestamp (หน่วย ms) และจำกัดอายุไม่เกิน 30–60 วินาที เพื่อป้องกัน Replay Attack

### 2.2 Inbound & Outbound Core API
* **Deposit Creation:** `POST /api/v1/deposit/create` (รองรับทั้ง `type: TRANSFER` และ `type: QR`)
* **Payout Creation:** `POST /api/v1/payout/create` (ยิงเข้า Core Banking ทันที, จัดการ State Machine: `pending` $\rightarrow$ `processing` $\rightarrow$ `completed` / `failed`)
* **Bank Utilities:** `POST /api/v1/client/bank/verify/bankAccountName` และ API ดึงรายชื่อ/รหัสธนาคาร
* **Fallback Inquiry API:** `GET /api/v1/deposit/:id` และ `GET /api/v1/payout/:id` สำหรับตรวจสอบและ Reconcile สถานะย้อนหลัง

### 2.3 Webhook Dispatcher & Security
* **Encrypted Payload:** ส่ง HTTP POST Callback แจ้งผลแบบ Asynchronous พร้อมแนบค่า Hash เข้ารหัส (AES-256 Encrypted) เพื่อป้องกัน Fake Webhook / Spoofing
* **Retry Policy:** มีระบบ Retry Backoff อัตโนมัติกรณีฝั่ง Merchant ตอบกลับช้าหรือไม่ตอบกลับ `HTTP 200 OK`

### 2.4 Idempotency & Concurrency Management
* **Idempotency Guarantee:** ควบคุมด้วย `transactionId` ป้องกันการสั่งโอนเงินออกซ้ำ (Duplicate Payout) หรือการเติมเครดิตเบิ้ล 100%
* **Message Queue & Workers:** ใช้ Message Queue (Redis / BullMQ / Kafka) บริหาร Worker ในการประมวลผล Payout และ Statement Matching เพื่อรองรับ Peak Load Concurrency

### 2.5 Infrastructure & Security
* **Network Security:** กำหนดระบบ IP Whitelisting ระหว่าง Application Server และระบบธนาคารกรุงไทย
* **Data Encryption:** บังคับใช้โปรโตคอล HTTPS / TLS และเข้ารหัสการจัดเก็บข้อมูลสำคัญ (Secrets & Sensitive Data) ด้วยมาตรฐาน AES-256

---

## 3. ประมาณการขอบเขตงานและระยะเวลา (Scope & Timeline)

| ส่วนงาน (Module Scope) | รายละเอียดสิ่งที่ต้องส่งมอบ (Deliverables) | ระยะเวลาประเมิน |
| :--- | :--- | :---: |
| **1. Foundation & Security** | ติดตั้ง Scaffolding, IP Whitelist, Vault เก็บ Credentials, HS256 Signature Engine | 1–2 วัน |
| **2. Core Deposit Engine** | Inbound Statement Matching (เลข บช. + ชื่อ) และ Dynamic QR สุ่มเศษสตางค์ $\pm 1.99$ | 2–3 วัน |
| **3. Direct Payout Engine** | Direct Auto-Payout เชื่อม API ธนาคาร, API ตรวจสอบบัญชีปลายทาง (`/bank/verify`) | 1–2 วัน |
| **4. Queue & Webhook System** | Redis/Queue Dispatcher, AES-256 Webhook Hash, Idempotency Controller, Fallback API | 2 วัน |
| **5. Multi-Tenant & Virtual Ledger** | Virtual Balance แยกตาม Merchant ID, ผูก 1 Merchant → หลาย บช. บจก. → หลาย User, Fee Deduction, Liquidity Alert | 1–2 วัน |
| **6. Testing & Hardening** | Concurrency Load Test, Replay Attack / Edge Cases Testing, Production Deployment | 2 วัน |
| **รวมระยะเวลาทั้งหมด** | **พร้อมขึ้น Production (Go-Live Ready)** | **~7–12 วัน** |
