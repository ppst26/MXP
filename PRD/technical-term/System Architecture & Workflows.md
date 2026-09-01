3. System Architecture & Workflows (โฟลว์การทำงาน Deposit / Payout / Webhook เบื้องต้น )  
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          Merchant Platform (เว็บเดิมพัน)                           │
│  - User Interface / Checkout Screen                                              │
│  - Merchant Backend (HMAC-SHA256 Signature Generator & Webhook Consumer)         │
└────────────────────────────────────────┬──────────────────────────────────────────┘
│ HTTPS (x-api-key, Signature, Timestamp)
▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                             Payment Gateway Engine                                │
│ ┌──────────────────────────┐ ┌──────────────────────────┐ ┌─────────────────────┐ │
│ │ Auth & Validation Filter │ │ Dynamic QR Generator     │ │ Direct Auto-Payout  │ │
│ │ (HS256 / Single-Use Check│ │ (Randomizer ±1.99)       │ │ (No Approval Queue) │ │
│ └──────────────────────────┘ └──────────────────────────┘ └─────────────────────┘ │
│ ┌───────────────────────────────────────────────────────────────────────────────┐ │
│ │                Automated Matching Engine & Reconciliation Worker               │ │
│ └───────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬──────────────────────────────────────────┘
│ Direct Corporate Banking API (KTB)
▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    KTB Corporate Banking Network (บัญชี บจก.)                      │
│ - 1 Merchant มีได้หลายบัญชี บจก. (Inbound / Outbound / Failover)                 │
│ - 1 บัญชี บจก. มีได้หลาย User (Master / Maker / Approver / Inquiry)               │
│ - Inbound Statement Data Feed                                                     │
│ - Direct Outbound Funds Transfer                                                  │
└───────────────────────────────────────────────────────────────────────────────────┘

---

### 3.2 กระบวนการรับชำระเงิน (Inbound / Deposit Workflow)
ระบบรองรับ 2 รูปแบบหลัก โดยเน้นการยืนยันยอดเงินอัตโนมัติ (Zero Manual Review):

#### รูปแบบที่ 1: Dynamic QR Deposit (สุ่มเศษสตางค์ Unique Amount)
1. **Initiate Request:** ลูกค้ากดฝากเงิน -> Merchant Backend ส่งคำขอ `POST /api/v1/deposit/create` (type: `QR`, ระบุยอดเงิน, signature, callbackUrl)
2. **Amount Randomization:** Gateway สุ่มเศษสตางค์ในช่วง $\pm 1.99$ บาท (เช่น ยอด 500 บาท สุ่มเป็น 500.35 บาท) เพื่อสร้าง Unique Amount และตอบกลับ QR String / Payload
3. **Scan & Pay:** ลูกค้าสแกน Dynamic QR ผ่านแอปธนาคารใดก็ได้
4. **Auto-Matching:** เมื่อเงินเข้าบัญชี บจก. ระบบดึงข้อมูล Statement แล้วจับคู่ยอดเงินที่ตรงกับเศษสตางค์ภายในเวลา Timeout
5. **Webhook Dispatch:** Gateway ปรับสถานะเป็น `completed` และยิง Webhook แจ้งเตือนกลับไปยัง Merchant


[ ลูกค้า (Player) ]          [ Merchant Backend ]              [ Payment Gateway ]          [ KTB Corporate ]
│                             │                                 │                          │

กดฝากเงิน                        │                                 │                          │
─────┼────────────────────────────►│ 2. Sign HS256 & ส่งคำขอ          │                          │
│                             ├──── POST /deposit/create ──────►│                          │
│                             │     (type: QR, amount: 500)     │ 3. สุ่มยอดเงิน (500.35)  │
│                             │◄─── 200 OK (QR String) ─────────┤    (สถานะ: pending)      │
│ 4. แสดง QR Code สแกนจ่าย    │                                 │                          │
│◄────────────────────────────┤                                 │                          │
│                             │                                 │                          │

สแกนจ่าย 500.35 บาท             │                                 │                          │
───────────────────────────────────┼─────────────────────────────────┼─────────────────────────►│
│                             │                                 │   6. Event / Statement   │
│                             │                                 │◄─────────────────────────┤
│                             │                                 │ 7. Auto-Match ยอดเงิน    │
│                             │ 8. ยิง Webhook (Status: completed)                         │
│                             │◄──── POST callbackUrl ──────────┤                          │
│ 9. ปรับเครดิตในเกมทันที      ├───── HTTP 200 OK ──────────────►│                          │
│◄────────────────────────────┤                                 │                          │

#### รูปแบบที่ 2: Transfer Deposit (จับคู่จากเลขบัญชีและชื่อผู้โอน)
1. **Account Pre-Validation:** ตรวจสอบชื่อบัญชีผู้โอนล่วงหน้าผ่าน `POST /api/v1/client/bank/verify/bankAccountName`
2. **Create Deposit Session:** Merchant ส่งคำขอ `POST /api/v1/deposit/create` (type: `TRANSFER`, ระบุ bankAccountNumber, bankName, name) โดยไม่ต้องระบุ amount
3. **Transfer Matching:** ลูกค้าโอนเงินเข้าบัญชี บจก. -> Gateway อ่าน Statement ตรงจาก KTB Corporate แล้วนำ **เลขบัญชีผู้โอน + ชื่อผู้โอน + กรอบเวลา** มาจับคู่อัตโนมัติ
4. **Webhook Callback:** เมื่อเงื่อนไขตรงกัน Gateway ส่ง Webhook ปรับยอดเครดิตทันที

---

### 3.3 กระบวนการจ่ายเงิน/โอนออก (Outbound / Direct Auto-Payout Workflow)
ระบบตัดขั้นตอน Manual Review หรือระบบ Approver ทิ้งทั้งหมด เพื่อให้โอนเงินออกจากบัญชี บจก. ได้ทันที:

1. **Verify & Initiate:** Merchant Backend ตรวจสอบความถูกต้องของบัญชีผู้รับ และส่งคำขอ `POST /api/v1/payout/create` พร้อมแนบ Digital Signature และ API Key
2. **Queue & Status Pending:** Gateway รับคำขอ สร้างรายการสถานะ `pending` และส่งคำสั่งต่อไปยัง Direct Banking API ทันที
3. **Core Banking Execution:** ธนาคารประมวลผลการโอนเงิน (สถานะเปลี่ยนเป็น `processing`) และตัดเงินออกจากบัญชี บจก.
4. **Payout Webhook Callback:** เมื่อโอนเงินสำเร็จ (`completed`) หรือล้มเหลว (`failed`) Gateway จะยิง Webhook แจ้ง Merchant พร้อมค่า `hash` (AES-Encrypted) และ Slip Reference ทันที

[ Merchant Backend (เว็บเดิมพัน) ]                 [ Payment Gateway ]                  [ KTB Corporate ]
│                                            │                                  │

สร้าง JWT Signature (HS256)                             │                                  │

ยิงคำสั่งถอนเงินทันที                                   │                                  │
├─────────────── POST /api/v1/payout/create ─────────────►│                                  │
│                (amount, bankInfo, callbackUrl)          │ 3. ตรวจสอบ Signature             │
│◄────────────── 200 OK (Status: pending) ────────────────┤    และส่งคำสั่งโอนทันที          │
│                                                         ├────── Direct Bank Transfer ─────►│
│                                                         │       (Status: processing)       │
│                                                         │                                  │
│                                                         │ 4. ธนาคารโอนเงินสำเร็จ           │
│                                                         │◄─────────────────────────────────┤
│ 5. รับ Webhook แจ้งผล (Status: completed/failed)        │                                  │
│◄────────────── POST callbackUrl ────────────────────────┤                                  │
│    (พร้อม hash AES-Encrypted & Slip Reference)          │                                  │
├─────────────── HTTP 200 OK ────────────────────────────►│                                  │


---

### 3.4 วงจรสถานะของรายการธุรกรรม (Transaction State Lifecycle)

| Feature | State | ความหมายและเงื่อนไข |
| :--- | :--- | :--- |
| **Deposit Lifecycle** | `pending` | รายการถูกสร้างสำเร็จ อยู่ระหว่างรอผู้ใช้โอนเงินเข้า |
| | `completed` | ยอดเงินเข้าบัญชี บจก. และจับคู่ข้อมูลบัญชี/เศษสตางค์ถูกต้องภายในเวลา Timeout |
| | `expired` | หมดเวลาที่กำหนด (Timeout), มีการแก้ไขยอดเงิน, หรือนำ QR เดิมที่หมดอายุมาสแกน |
| **Payout Lifecycle** | `pending` | คำขอถูกรับเข้าสู่ระบบ Gateway |
| | `processing` | คำสั่งถูกส่งเข้า Core Banking API อยู่ระหว่างรอการประมวลผลตัดโอน |
| | `completed` | ธนาคารโอนเงินเข้าบัญชีลูกค้าปลายทางสำเร็จสมบูรณ์ |
| | `failed` / `rejected` | โอนเงินไม่สำเร็จ (เช่น เลขบัญชีปลายทางไม่ถูกต้อง, ปลายทางปิดปรับปรุง) |

---

### 3.5 กลไก Webhook & Anti-Fraud Security
* **Encrypted Hash Verification:** Webhook ทุกรายการจะแนบค่า `hash` (AES-256) ซึ่งสร้างจากการ Hash ค่า `transactionId` ด้วยคีย์ผสมระหว่าง `API_KEY + SECRET_KEY` เพื่อให้ Merchant ยืนยันว่าเป็นสัญญาณจริงจาก Gateway
* **Idempotency Handling:** ฝั่ง Merchant ตรวจสอบ `transactionId` ซ้ำ หากได้รับสถานะ `completed` ของรายการเดิมซ้ำ ต้องไม่เติมเครดิตซ้ำ และต้องตอบกลับ HTTP 200 OK เสมอ
* **Fallback Polling API:** Merchant สามารถเรียกใช้ `GET /api/v1/deposit/:referenceId` หรือ `GET /api/v1/payout/:referenceId` เพื่อดึงสถานะธุรกรรมได้ด้วยตนเองกรณีเกิดปัญหาเครือข่ายขัดข้อง
"""

with open("prd_section_3_workflows.md", "w", encoding="utf-8") as f:
    f.write(markdown_content)

print("Generated prd_section_3_workflows.md successfully")