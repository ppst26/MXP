## 2. Target Persona & Integration Architecture (สถาปัตยกรรมการเชื่อมต่อและกลุ่มผู้ใช้งาน)

### 2.1 Target Persona & Core Intent
* **Target Customer:** เจ้าของระบบและผู้ดูแลระบบแพลตฟอร์ม (Platform Merchants / System Operators) ที่ต้องการเปลี่ยนผ่านจากการใช้บัญชีบุคคลธรรมดามาใช้บัญชี บจก.
* **Core Intent & Behavior:** 
  * ต้องการระบบเชื่อมต่อง่าย (Plug-and-Play Integration) ผ่าน REST API เส้นเดียว[cite: 1, 4]
  * ปลดล็อกกระบวนการตรวจสอบด้วยมือ โดยไม่มีขั้นตอนการรออนุมัติหลายระดับ (Zero Manual Review & No Approval Hierarchy)
  * คำสั่งจ่ายเงินออก (Payout) ต้องสามารถโอนออกจากบัญชี บจก. ไปยังบัญชีปลายทางได้ทันทีแบบอัตโนมัติ (Direct Auto-Payout)
  * รองรับการส่งสถานะและปรับยอดแบบ Real-time ผ่าน Webhook Callback

---

### 2.2 System-to-System Access Model (โครงสร้างการยืนยันสิทธิ์ API)
เนื่องจากระบบออกแบบมาเพื่อ Direct Execution การเชื่อมต่อ API ใช้การควบคุมสิทธิ์ระดับ **Service-to-Service Credentials** ของ Merchant ส่วนชั้นบัญชีธนาคารแยกเป็น **1 Merchant → หลายบัญชี บจก. → หลาย User** (Master / Maker / Approver / Inquiry) ตามสิทธิ์ของแต่ละบัญชี:

| Credential Element | หน้าที่และการใช้งาน | มาตรฐานความปลอดภัย |
| :--- | :--- | :--- |
| **API Key (`x-api-key`)** | ส่งใน Request Header เพื่อยืนยันสิทธิ์การเข้าถึง Gateway[cite: 1, 4] | Token ประจำระบบ Merchant[cite: 1, 4] |
| **Secret Key** | กุญแจลับฝั่ง Backend สำหรับสร้าง Digital Signature[cite: 1, 4] | จัดเก็บฝั่ง Server ห้ามเปิดเผย[cite: 1, 4] |
| **Merchant ID** | รหัสประจำตัวร้านค้า/ระบบของผู้เชื่อมต่อ[cite: 1, 4] | Unique Identifier[cite: 1, 4] |
| **Client ID** | รหัสประจำตัว Client Application ที่ส่งคำขอ[cite: 1, 4] | Unique Identifier[cite: 1, 4] |
| **Digital Signature** | Token เข้ารหัสด้วย **HS256** ผูกกับ Timestamp (ms) | Single-Use ป้องกัน Replay Attack |

---

### 2.3 Direct Execution Architecture (โฟลว์การทำงานแบบโอนเงินทันที)
[ ระบบฝั่ง Merchant / Platform ]                        [ Payment Gateway Engine ]
│                                                    │
│ 1. สร้าง Signature (HS256 + Timestamp)             │
│ 2. สั่งจ่ายเงินทันที (POST /api/v1/payout/create)   │
├───────────────────────────────────────────────────►│ (ตัดเงินทันที / No Approval Needed)
│                                                    │
│                                                    │ 3. ส่งคำสั่งเข้า Direct Core Banking
│                                                    │    (สถานะ: pending -> processing)[cite: 1, 3]
│                                                    │
│                                                    │ 4. ธนาคารโอนเงินสำเร็จ[cite: 1, 3]
│ 5. รับ Webhook แจ้งผล (POST callbackUrl)           │[cite: 1, 3]
│◄───────────────────────────────────────────────────┤ (สถานะ: completed / failed)[cite: 1, 3]
│    (พร้อมข้อมูล RefID, TransactionId, Time)        │[cite: 1, 3]
├───────────────────────────────────────────────────►│ (HTTP 200 OK)

### 2.4 API Integration Capabilities (ขีดความสามารถของระบบที่เปิดให้เชื่อมต่อ)

* **Direct Auto-Payout:** สั่งโอนเงินออกตามคำขอทันที ไม่ติดเงื่อนไขการสแกนใบหน้า และไม่มีคอขวดขั้นตอนการรอคนกด Approve[cite: 1, 3]
* **Automated Deposit Reconciliation:**
  * **Dynamic QR:** สุ่มเศษสตางค์ ±1.99 บาท พร้อมส่ง Webhook ยืนยันยอดเงินเข้าอัตโนมัติ[cite: 1, 3]
  * **Transfer Matching:** จับคู่จากเลขบัญชี + ชื่อผู้โอนโดยตรงผ่าน Statement Direct API[cite: 1, 12]
* **Full Automation Webhook:** ส่ง Callback แจ้งสถานะของทุกธุรกรรม (`completed`, `failed`, `expired`) ไปยังเซิร์ฟเวอร์ปลายทางทันที[cite: 1, 3]