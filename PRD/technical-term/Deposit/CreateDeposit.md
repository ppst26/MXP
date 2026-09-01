**POST Create Deposit API** ของระบบ **FLASH-PAY** และ **BIT-PAYZ** เป็นหัวใจสำคัญของระบบรับเงินขาเข้า (Inbound Module) รองรับการรับเงิน 2 ช่องทาง โดยใช้ **Automated Matching Engine** เพื่อยืนยันยอดเงินสำเร็จแบบอัตโนมัติ โดยไม่ต้องใช้แรงงานคนตรวจสลิปหรือ Statement

ด้านล่างนี้คือสรุปรายละเอียด **Create Deposit API** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. ประเภทการฝากเงิน (Deposit Types)

#### **QR Deposit (ระบบสแกนคิวอาร์โค้ด)**

- **ข้อกำหนด:** บังคับส่งพารามิเตอร์ `amount` (จำนวนเงินยอดฝากตั้งต้น)
- **หลักการทำงาน:** ระบบ Gateway นำยอดตั้งต้นมาทำ **สุ่มเศษสตางค์ (Floating Amount)** ในช่วง ±1.99 บาท (เช่น ยอดฝาก 100 บาท ระบบอาจเจนยอดจ่ายจริงเป็น 99.58 หรือ 100.73 บาท) เพื่อล็อกเป็นยอดเงินเฉพาะตัวของลูกค้าในช่วงเวลาที่กำหนด (`timeout`) และส่งกลับเป็น **PromptPay QR String** ดิบ เพื่อนำไปเรนเดอร์เป็นภาพคิวอาร์โค้ดให้ลูกค้าสแกนจ่าย

#### **TRANSFER Deposit (ระบบโอนตรงผ่านเลขบัญชีธนาคาร)**

- **ข้อกำหนด:** **ไม่ต้อง** ส่งพารามิเตอร์ `amount`
- **หลักการทำงาน:** ระบบจับคู่จากเลขบัญชีธนาคารต้นทางฝั่งลูกค้าที่กรอกเข้ามา กับความเคลื่อนไหว Statement ในบัญชี บจก. ของระบบ (แนะนำให้ใช้ **Get Account Name API** ตรวจสอบชื่อบัญชีล่วงหน้าก่อนเริ่มโฟลว์นี้)

---

### 2. ข้อมูลจำเพาะทางเทคนิค (API Specifications)

- **HTTP Method:** `POST`
- **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/deposit/create`
- **Request Headers:**

  ```http
  Content-Type: application/json
  x-api-key: {{YOUR_API_KEY}}
  ```

---

### 3. รายละเอียดพารามิเตอร์ Request Body (JSON Parameters)

| Parameter Name        | ชนิดข้อมูล (Type) | สถานะ (Required) | คำอธิบายพารามิเตอร์                                                                                              | ตัวอย่างข้อมูล              |
| :-------------------- | :---------------: | :--------------: | :--------------------------------------------------------------------------------------------------------------- | :-------------------------- |
| **`clientId`**        |     `string`      |  ✅ **บังคับ**   | รหัสเฉพาะสำหรับระบุฝั่งไคลเอนต์ผู้ทำคำขอธุรกรรมฝากเงิน                                                          | `"nHUxQbHgEu"`              |
| **`merchantId`**      |     `string`      |  ✅ **บังคับ**   | รหัสเฉพาะร้านค้า/พาร์ทเนอร์ในระบบ Gateway (Tenant ID)                                                            | `"VOBM7qzaRH"`              |
| **`transactionId`**   |     `string`      |  ✅ **บังคับ**   | รหัสอ้างอิงธุรกรรมที่ระบบหลังบ้านเจนขึ้นเพื่อระบุเลขออเดอร์ (**ต้องไม่ซ้ำ**)                                    | `"BZP0PTB01776723e7X1"`     |
| **`bankAccountNumber`**|    `string`      |  ✅ **บังคับ**   | เลขบัญชีธนาคารฝั่งลูกค้าที่ใช้สแกนจ่ายหรือโอนเงิน                                                                | `"3140312345"`              |
| **`bankName`**        |     `string`      |  ✅ **บังคับ**   | ชื่อย่อภาษาอังกฤษของธนาคารลูกค้า (ต้องตรงกับ `name` จาก **List Bank API**)                                       | `"BBL"`                     |
| **`name`**            |     `string`      |  ✅ **บังคับ**   | ชื่อ-นามสกุลจริงของผู้ถือบัญชีธนาคารฝั่งลูกค้า                                                                  | `"เฮง ร่ำรวย"`              |
| **`phone`**           |     `string`      |  ❌ **ทางเลือก** | เบอร์มือถือของลูกค้า (หากไม่มีข้อมูลให้ส่งเป็นสตริงว่าง `""`)                                                    | `""`                        |
| **`callbackUrl`**     |     `string`      |  ✅ **บังคับ**   | URL หลังบ้านฝั่งร้านค้าเพื่อรับ Webhook Callback (**ต้องใช้ HTTPS**)                                              | `"https://your-domain.com/deposit/callback"` |
| **`type`**            |     `string`      |  ✅ **บังคับ**   | ประเภทช่องทางการฝาก — `"QR"` หรือ `"TRANSFER"`                                                                  | `"QR"`                      |
| **`timeout`**         |    `integer`      |  ✅ **บังคับ**   | เวลาหมดอายุคำสั่งซื้อ (หน่วย: นาที) แนะนำ ≥ 5 นาที                                                               | `5`                         |
| **`signature`**       |     `string`      |  ✅ **บังคับ**   | ลายเซ็นดิจิทัล HS256 JWT ที่สร้างจาก Secret Key (ดู **Create Signature**)                                       | `"<JWT_TOKEN_SIGNATURE>"`   |
| **`timestamp`**       |    `integer`      |  ✅ **บังคับ**   | เวลาที่ใช้เจนลายเซ็น (Unix Milliseconds) **ต้องตรงกับ `iat` ใน signature**                                      | `1728319408897`             |
| **`amount`**          | `float` / `integer`| ⚠️ **เงื่อนไข** | บังคับเมื่อ `type: "QR"` — **ไม่ต้องส่ง** เมื่อ `type: "TRANSFER"`                                              | `100`                       |

---

### 4. ตัวอย่างคำขอ (Example Request)

#### **cURL (QR Deposit):**

```bash
curl --location -g '{{API_ENDPOINT}}/api/v1/deposit/create' \
--header 'x-api-key: {{API_KEY}}' \
--header 'Content-Type: application/json' \
--data '{
    "clientId": "nHUxQbHgEu",
    "merchantId": "VOBM7qzaRH",
    "transactionId": "BZP0PTB01776723e7X1",
    "bankAccountNumber": "3140312345",
    "bankName": "BBL",
    "name": "เฮง ร่ำรวย",
    "amount": 100,
    "callbackUrl": "https://your-domain.com/deposit/callback",
    "type": "QR",
    "timeout": 5,
    "signature": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtZXJjaGFudElkIjoiVk9CTTdxemFSSCIsImNsaWVudElkIjoibkhVeFFiSGdFdSIsImlhdCI6MTcyODMxOTQwODg5N30.uWitsyCmb_TUHlK9_Od5416jJyGvc0OcaYI7oW6mkxU",
    "timestamp": 1728319408897
}'
```

---

### 5. ตัวอย่างผลลัพธ์ตอบกลับ (Example Response — 200 OK)

เมื่อระบบบันทึกธุรกรรมเป็น `pending` เรียบร้อย จะตอบกลับ JSON ดังนี้:

```json
{
  "status": "success",
  "message": "Create Success",
  "data": {
    "clientId": "nHUxQbHgEu",
    "merchantId": "VOBM7qzaRH",
    "referenceId": "w5EIFM4i1M",
    "transactionId": "BZP0PTB01776723e7X1",
    "status": "pending",
    "amount": 100,
    "depositAmount": 99.54,
    "qrcode": "00020101021129370016A00000067701011101130066955157457530376454041.545802TH6304A299",
    "bankAccountNumber": "1714436599",
    "bankAccountName": "อุ่นใจ อุ่นจัง",
    "bankName": "SCB",
    "bankCode": "014",
    "promptpayNumber": "0955157457",
    "expireDate": "2024-10-07T17:30:34.581Z",
    "customerData": {
      "bankAccountNumber": "3140312345",
      "bankName": "BBL",
      "name": "เฮง ร่ำรวย"
    }
  }
}
```

---

### 6. ความหมายของฟิลด์ Response (Response Field Definitions)

| ฟิลด์ | คำอธิบาย |
| :---- | :------- |
| **`data.referenceId`** | เลขอ้างอิงธุรกรรมของ Gateway — ต้องเซฟคู่กับ `transactionId` ลง DB เพื่อใช้ Inquiry ดึงสถานะย้อนหลัง |
| **`data.status`** | สถานะเริ่มต้นของธุรกรรม — ค่า `"pending"` (รอลูกค้าสแกนจ่ายหรือโอนเงิน) |
| **`data.depositAmount`** | ยอดชำระจริงหลังสุ่มเศษสตางค์ — มีค่าเมื่อ `type: "QR"` เท่านั้น (เช่น ขอฝาก 100 บาท แต่ลูกค้าจ่ายจริง 99.54 บาท) |
| **`data.qrcode`** | สตริง PromptPay QR Code — มีค่าเมื่อ `type: "QR"` นำไปเรนเดอร์เป็นภาพคิวอาร์โค้ด |
| **`data.bankAccountNumber`** | เลขบัญชีธนาคารผู้รับ (บจก. ปลายทาง) |
| **`data.bankAccountName`** | ชื่อบัญชีธนาคารผู้รับ (บจก. ปลายทาง) |
| **`data.expireDate`** | เวลาสิ้นสุด (ISO 8601) — หากลูกค้าไม่ชำระภายในเวลานี้ สถานะจะเปลี่ยนเป็น `expired` |

---

### 7. แนวปฏิบัติระดับ Enterprise สำหรับผู้พัฒนา (Developer Guide)

1. **1:N Account Isolation Model:** สถาปัตยกรรม Enterprise SaaS ทำงานแบบ **1 Merchant มีได้หลายบัญชี บจก.** และ **1 บัญชี บจก. มีได้หลาย User** — ค่า `merchantId` และ `clientId` ต้องตรงตาม Tenant Configuration จากนั้น Gateway เลือกบัญชี บจก. ที่จะรับเงินจากพูลของ Merchant นั้น (ตาม Routing / Round-Robin / Failover) เพื่อป้องกันยอดเงินปะปนข้าม Merchant
2. **Signature & Timestamp Sync:** ค่า `timestamp` (ms) ใน Request Body ต้องตรงกับ `iat` ที่ใช้สร้าง `signature` (JWT) — หากไม่ตรงหรือล่าช้าเกินกำหนด Gateway จะปฏิเสธคำขอทันที (Anti-Replay Attack)
3. **Backend Only:** การสร้าง `signature` ต้องทำบน Server เท่านั้น ห้าม expose `Secret Key` ที่ Frontend

---
