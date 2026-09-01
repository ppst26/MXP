**GET Get Deposit Transaction By Ref ID API** ของระบบ **FLASH-PAY** และ **BIT-PAYZ** ใช้สืบค้าสถานะและรายละเอียดธุรกรรมฝากเงินรายการเดียวจาก `referenceId` ที่ Gateway ส่งกลับตอนสร้างรายการ เป็น **Fallback Polling API** เมื่อ Webhook ไม่ถึงหรือเครือข่ายขัดข้อง

ด้านล่างนี้คือสรุปรายละเอียด **Get Deposit Transaction By Ref ID API** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. วัตถุประสงค์การใช้งาน (Purpose)

- **Inquiry / Status Check:** ดึงสถานะปัจจุบันของรายการฝาก (`pending`, `completed`, `expired`) จาก Gateway โดยตรง
- **Fallback Polling:** ใช้เมื่อ `callbackUrl` ไม่ได้รับ Webhook หรือต้องการยืนยันสถานะก่อนอัปเดตเครดิตลูกค้า
- **Reconciliation:** ตรวจสอบข้อมูลย้อนหลังคู่กับ `transactionId` ที่ระบบหลังบ้านบันทึกไว้

> `referenceId` ได้จาก Response ของ **Create Deposit API** — ต้องเซฟคู่กับ `transactionId` ลง DB ทุกครั้ง

---

### 2. ข้อมูลจำเพาะทางเทคนิค (API Specifications)

- **HTTP Method:** `GET`
- **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/deposit/{{referenceId}}`
- **Request Headers:**

  ```http
  x-api-key: {{YOUR_API_KEY}}
  ```

---

### 3. พารามิเตอร์ Path (Path Parameters)

| Parameter Name   | ชนิดข้อมูล (Type) | สถานะ (Required) | คำอธิบายพารามิเตอร์ | ตัวอย่างข้อมูล   |
| :--------------- | :---------------: | :--------------: | :------------------- | :--------------- |
| **`referenceId`**|     `string`      |  ✅ **บังคับ**   | รหัสอ้างอิงธุรกรรมจาก Gateway (ได้ตอน Create Deposit) | `"w5EIFM4i1M"` |

---

### 4. ตัวอย่างคำขอ (Example Request)

#### **cURL:**

```bash
curl --location -g '{{API_ENDPOINT}}/api/v1/deposit/w5EIFM4i1M' \
--header 'x-api-key: {{API_KEY}}'
```

---

### 5. ตัวอย่างผลลัพธ์ตอบกลับ (Example Response — 200 OK)

เมื่อพบรายการ ระบบตอบกลับ `200 OK` พร้อมออบเจกต์ธุรกรรมใน `data`:

```json
{
  "status": "success",
  "data": {
    "referenceId": "w5EIFM4i1M",
    "expireDate": {
      "__type": "Date",
      "iso": "2024-10-07T17:30:34.581Z"
    },
    "clientId": "nHUxQbHgEu",
    "clientName": "demo2",
    "transactionId": "BZP0PTB01776723e7X1",
    "amount": 2,
    "depositAmount": 1.54,
    "qrcode": "00020101021129370016A00000067701011101130066955157457530376454041.545802TH6304A299",
    "bankAccountNumber": "3140312345",
    "bankName": "BBL",
    "bankCode": "002",
    "name": "อุ่นใจ อุ่นจัง",
    "callbackUrl": "https://your-domain.com/callback",
    "ipAddress": "184.22.36.35",
    "type": "QR",
    "bankId": "nSSx7LL6X2",
    "bank": {
      "__type": "Pointer",
      "className": "Bank",
      "objectId": "nSSx7LL6X2"
    },
    "status": "completed",
    "systemPromptpayNumber": "0955157457",
    "systemBankAccountNumber": "1714436599",
    "systemBankCode": "014",
    "systemBankName": "SCB",
    "systemBankAccountName": "อุ่นใจ อุ่นจัง",
    "timestamp": 1728319408897,
    "merchantId": "VOBM7qzaRH",
    "merchantName": "demo2",
    "createdAt": "2024-10-07T17:25:34.776Z",
    "updatedAt": "2024-10-07T17:30:42.498Z",
    "webhookData": {
      "referenceId": "w5EIFM4i1M",
      "transactionId": "BZP0PTB01776723e7X1",
      "status": "completed",
      "timestamp": 1728322240045,
      "hash": "U2FsdGVkX19ikrgBKH81gFVP18riN1rjEGACfcuGVra2+AbgePiEj11ZHZ5RBVzi"
    }
  }
}
```

---

### 6. ความหมายของฟิลด์ Response (Response Field Definitions)

| ฟิลด์ | คำอธิบาย |
| :---- | :------- |
| **`referenceId`** | รหัสอ้างอิงฝั่ง Gateway — ใช้เป็น key หลักในการ Inquiry |
| **`transactionId`** | รหัสอ้างอิงฝั่งร้านค้า — จับคู่กับออเดอร์ในระบบ |
| **`status`** | สถานะปัจจุบัน — `"pending"`, `"completed"`, `"expired"` |
| **`type`** | ช่องทางการฝาก — `"QR"` หรือ `"TRANSFER"` |
| **`amount`** | ยอดเงินตั้งต้นที่ร้องขอฝาก |
| **`depositAmount`** | ยอดชำระจริงหลังสุ่มเศษสตางค์ — มีเฉพาะ `type: "QR"` |
| **`qrcode`** | PromptPay QR String — มีเฉพาะ `type: "QR"` |
| **`expireDate`** | เวลาหมดอายุรายการ (ISO 8601) |
| **`systemBankAccountNumber`** | เลขบัญชีผู้รับ (บจก. ปลายทาง) |
| **`systemBankAccountName`** | ชื่อบัญชีผู้รับ (บจก. ปลายทาง) |
| **`webhookData`** | บันทึก Webhook ที่ส่งไปหลังบ้าน รวม `hash` (AES-256) |

---

### 7. แนวปฏิบัติระดับ Enterprise สำหรับผู้พัฒนา (Developer Guide)

1. **Webhook เป็นหลัก, Polling เป็นสำรอง:** ใช้ API นี้เมื่อ Webhook ไม่มาภายในเวลาที่กำหนด ไม่ควร Poll ถี่เกินไป (แนะนำ interval 5–15 วินาที และหยุดเมื่อ `status` ไม่ใช่ `pending`)
2. **Idempotent Credit Update:** ก่อนอัปเดตเครดิตจากผล Polling ตรวจสอบว่ารายการยังไม่ถูกประมวลผลจาก Webhook แล้ว
3. **เก็บ `referenceId` ทุกครั้ง:** บันทึก `referenceId` คู่กับ `transactionId` ตอน Create Deposit สำเร็จ เพื่อให้เรียก Inquiry ได้ทันที

---
