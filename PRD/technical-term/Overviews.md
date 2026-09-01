# Payment Gateway Architecture & Core Concepts (SaaS Enterprise Ready)

เอกสารสรุปและวิเคราะห์แนวคิดหลัก (Core Concepts), โครงสร้างสถาปัตยกรรม (Architecture), และขั้นตอนการทำงาน (Workflow) ของระบบ Payment Gateway โดยอ้างอิงจากเอกสาร API Reference (FLASH-PAY / BIT-PAYZ REST API V.1.5.0) เพื่อนำไปใช้วางโครงสร้างระบบ SaaS Enterprise Financial Platform

---

## 1. ภาพรวมและแนวคิดหลัก (Core Concept & Overview)

Payment Gateway ในระดับ SaaS Enterprise คือระบบตัวกลางที่ทำหน้าที่เชื่อมต่อ, ประมวลผล, และทำให้ธุรกรรมทางการเงินเป็นไปโดยอัตโนมัติ (Automated Financial Processing) ทั้งสองทิศทาง:

1. Inbound / Deposit (ระบบรับชำระเงิน): รับเงินจากลูกค้าผ่าน Dynamic QR หรือ Direct Bank Transfer เข้าสู่ระบบ
2. Outbound / Payout (ระบบจ่ายเงิน/ถอนเงิน): สั่งจ่ายเงินออกจากบัญชีระบบไปยังบัญชีปลายทางของคู่ค้า/ลูกค้า

หัวใจสำคัญ: Automated Matching System (ระบบจับคู่ยอดเงินอัตโนมัติ)
หัวใจของ Gateway คือการระบุว่ายอดเงินที่โอนเข้ามาเป็นของคำสั่งซื้อใดแบบ Real-time โดยไม่ต้องใช้คนตรวจสอบ (Zero Manual Review):
- Dynamic QR Deposit (สุ่มเศษสตางค์): สร้าง Dynamic QR Code พร้อมสุ่มเศษสตางค์ (Floating Amount) ในช่วง ±1.99 บาท เพื่อให้ยอดรวมของรายการนั้นเป็น Unique Amount ในช่วงเวลาที่กำหนด
- Transfer Deposit (จับคู่จากข้อมูลบัญชี): ตรวจสอบยอดเงินโอนเข้าโดยนำข้อมูลบัญชีธนาคารของผู้โอน (Bank Account Number + Name) มาจับคู่กับข้อมูลที่บันทึกไว้ในระบบ

---

## 2. โครงสร้างความปลอดภัยและการยืนยันตัวตน (Security & Authentication)

ระบบ Enterprise Payment ต้องป้องกันปัญหา Replay Attack, Data Tampering, และ Unauthorized Access อย่างรัดกุม:

2.1 ข้อมูลรับรองสิทธิ์ (Credentials & Prerequisites)
Tenant / Merchant แต่ละรายจะได้รับ Credentials ทั้งหมด 4 ตัว (ระดับ Merchant):
- API Key (x-api-key): ส่งผ่าน Request Header เพื่อระบุตัวตนและตรวจสอบสิทธิ์เข้าถึง API
- Secret Key: กุญแจลับฝั่งหลังบ้าน ใช้สำหรับ Sign ข้อมูล (ห้ามเปิดเผยต่อภายนอก)
- Merchant ID: รหัสประจำตัวร้านค้า/องค์กรในระบบ Gateway — **1 Merchant มีได้หลายบัญชี บจก.**
- Client ID: รหัสประจำตัว Client ผู้ส่ง Request

ชั้นบัญชีธนาคารแยกจาก Credentials ของ API:
- **1 Merchant → N บัญชี บจก.** (รับ / จ่าย / สำรอง / Failover)
- **1 บัญชี บจก. → N User** (Master Admin, Maker, Approver, Inquiry)

2.2 กลไก Digital Signature (HMAC-SHA256 / Single-Use Token)
ทุก Request ที่สำคัญ (สร้างรายการฝาก/ถอน) ต้องแนบ Digital Signature ที่คำนวณจาก:
Signature = HS256(Payload(merchantId, clientId, timestamp), Secret Key)

Payload Example:
{
  "clientId": "<YOUR_CLIENT_ID>",
  "merchantId": "<YOUR_MERCHANT_ID>",
  "signature": "<GENERATED_JWT_SIGNATURE>",
  "timestamp": 1728319408897
}

- กฎ Single-Use: ค่า timestamp (หน่วยมิลลิวินาที) ใน Payload จะต้องตรงกับ Claim iat ใน Signature เพื่อให้โทเคนใช้ได้เพียงครั้งเดียว ป้องกันการดักขโมย Request ไปส่งซ้ำ

---

## 3. ขั้นตอนและกระบวนการทำงานของระบบ (Step-by-Step Workflows)

3.1 วงจรการทำงานของระบบรับชำระเงิน (Deposit Flow)

[ ผู้ใช้งาน (Frontend) ]         [ ระบบ Backend (SaaS Core) ]          [ Payment Gateway API ]
           │                                 │                                 │
           │ 1. สั่งซื้อ / ขอชำระเงิน          │                                 │
           ├────────────────────────────────►│ 2. ตรวจสอบบัญชีผู้โอน (ถ้าจำเป็น) │
           │                                 ├────── POST /bank/verify ───────►│
           │                                 │◄───── 200 OK (Account Name) ────┤
           │                                 │                                 │
           │                                 │ 3. สร้าง Signature (HS256)       │
           │                                 │ 4. ส่งคำขอสร้างรายการชำระเงิน      │
           │                                 ├────── POST /deposit/create ────►│
           │                                 │                                 │ (สุ่มยอดเงิน ±1.99)
           │                                 │◄───── 200 OK (QR Payload / Ref) ┤ (สถานะ: pending)
           │ 5. นำ QR Payload ไป Render QR   │                                 │
           │◄────────────────────────────────┤                                 │
           │                                 │                                 │
     [ ลูกค้าสแกนชำระเงิน ]                     │                                 │
           │                                 │                                 │
           ▼                                 │                                 │
     [ เครือข่ายธนาคาร ] ──────────────────────────────────────────────────────►│ (รับ Statement เงินเข้า)
                                             │                                 │
                                             │                                 │ 6. ระบบ Gateway ทำ Auto-Match
                                             │ 7. ยิง Webhook แจ้งเตือนสถานะ   │
                                             │◄───── POST callbackUrl ─────────┤ (สถานะ: completed / expired)
                                             ├────── HTTP 200 OK ─────────────►│
                                             │
                                             │ 8. ปลดล็อกคำสั่งซื้อ / เพิ่มยอด
           │◄────────────────────────────────┤
     [ ชำระเงินสำเร็จ ]

สถานะรายการฝาก (Deposit Statuses):
- pending: รายการถูกสร้างสำเร็จ อยู่ระหว่างรอผู้ใช้โอนเงิน
- completed: ตรวจพบเงินเข้าตรงยอด และโอนมาจากบัญชีที่ระบุ ภายในเวลา Timeout
- expired: หมดเวลาที่กำหนด, มีการแก้ไขยอดเงิน, หรือนำ QR ที่หมดอายุมาสแกนจ่าย

---

3.2 วงจรการทำงานของระบบจ่ายเงิน / โอนออก (Payout Flow)

ในระดับ SaaS Enterprise ระบบ Payout มักรองรับมาตรฐาน Dual Control (Maker & Approver) เพื่อความปลอดภัยทางการเงิน:

[ พนักงาน Maker ]               [ ผู้อนุมัติ Approver ]             [ SaaS Backend ]           [ Gateway API ]
        │                                │                                │                         │
 1. สร้างรายการขอโอน                     │                                │                         │
 ────────────────────────────────────────┼───────────────────────────────►│ (สถานะ: รออนุมัติ)       │
                                         │                                │                         │
                                  2. ตรวจสอบ & กดยืนยัน (2FA/OTP)         │                         │
                                  ───────────────────────────────────────►│ (สถานะ: อนุมัติแล้ว)      │
                                                                          │                         │
                                                                          │ 3. Sign & ยิงคำขอ Payout│
                                                                          ├──── POST /payout/create►│
                                                                          │◄─── 200 OK (pending) ───┤
                                                                          │                         │
                                                                          │                         │ [ ธนาคารประมวลผล ]
                                                                          │ 4. Webhook แจ้งผลโอนเงิน │
                                                                          │◄─── POST callbackUrl ───┤
                                                                          │    (completed/failed)   │
                                                                          ├──── HTTP 200 OK ───────►│

สถานะรายการจ่าย (Payout Statuses):
- pending: รายการถูกสร้างและรอเข้าคิวประมวลผล
- processing: ธนาคารกำลังดำเนินการตัดยอดและโอนเงิน
- completed: เงินโอนเข้าบัญชีปลายทางสำเร็จ
- failed / rejected: โอนไม่สำเร็จ (เช่น เลขบัญชีไม่ถูกต้อง, บัญชีปลายทางติดล็อค)

---

## 4. กลไก Webhook, Security Verification และ Idempotency

4.1 การตรวจสอบความถูกต้องของ Webhook (Signature & Hash Verification)
- ข้อมูล Webhook ของรายการ QR จะมีค่า hash (AES-Encrypted) แนบมาด้วย โดยเกิดจากการเข้ารหัส transactionId ด้วย Key ผสมระหว่าง API_KEY + SECRET_KEY
- ฝั่ง Backend ของเราต้องนำค่ามาถอดรหัสเพื่อยืนยันว่าเป็น Webhook จาก Gateway จริง ป้องกันการปลอมแปลงยอดเงิน (Anti-Spoofing)

4.2 การจัดการความซ้ำซ้อน (Idempotency Handling)
- ระบบปลายทางต้องออกแบบให้เป็น Idempotent กล่าวคือ หาก Gateway ยิง Webhook ซ้ำด้วย transactionId เดิม ระบบต้องไม่ปลดล็อกออเดอร์หรือเครดิตซ้ำซ้อน และต้องตอบกลับ HTTP 200 OK เสมอ

---

## 5. การต่อยอดสู่สถาปัตยกรรม SaaS Enterprise (Enterprise Architectural Considerations)

1. Multi-Tenancy Isolation: จัดเก็บ Credentials (API_KEY, Secret Key, Merchant ID) และแยก Ledger ของแต่ละ Merchant ให้เป็นอิสระต่อกัน — **1 Merchant มีได้หลายบัญชี บจก.** และ **1 บัญชี บจก. มีได้หลาย User**
2. Asynchronous Webhook Queue: เมื่อได้รับ Webhook เข้ามา ให้ตอบกลับ 200 OK ทันที แล้วผลัก Event เข้าสู่ Message Queue (เช่น Redis, RabbitMQ, Kafka) เพื่อให้ Worker ทำการ Reconcile ยอดเงินแบบ Asynchronous ป้องกันปัญหา Request ค้างเมื่อทราฟฟิกสูง
3. Audit Trail & Financial Ledger: บันทึก State Transition และ Raw Payload ของทุก Request/Response ไว้เป็นหลักฐานเพื่อทำ Daily Reconciliation กับ Statement ของแต่ละบัญชี บจก. ได้อย่างสมบูรณ์

