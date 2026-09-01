**GET List Deposit Transactions API** ของระบบ **FLASH-PAY** และ **BIT-PAYZ** เป็นโมดูลสำคัญสำหรับดึงประวัติและรายการทรานแซกชันฝากเงินทั้งหมด ช่วยให้ระบบหลังบ้านทำ **Report Generator** และ **Automated Reconciliation** เพื่อตรวจสอบความถูกต้องของ Ledger แต่ละ Tenant

ด้านล่างนี้คือสรุปรายละเอียด **List Deposit Transactions API** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. ข้อมูลจำเพาะทางเทคนิค (API Specifications)

- **HTTP Method:** `GET`
- **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/deposit`
- **Request Headers:**

  ```http
  x-api-key: {{YOUR_API_KEY}}
  ```

---

### 2. พารามิเตอร์สำหรับตัวกรองสืบค้น (Query Parameters)

การเรียกรายงานต้องระบุ Query Parameters แนบไปกับ URL ดังนี้:

| Parameter Name | ชนิดข้อมูล (Type) | สถานะ (Required) | รูปแบบ (Format) | คำอธิบายพารามิเตอร์ | ตัวอย่างข้อมูล |
| :------------- | :---------------: | :--------------: | :-------------: | :------------------- | :------------- |
| **`startDate`** |     `string`      |  ✅ **บังคับ**   |  `YYYY-MM-DD`   | วันที่เริ่มต้นของช่วงธุรกรรมที่ต้องการสืบค้น | `"2024-10-01"` |
| **`endDate`**   |     `string`      |  ✅ **บังคับ**   |  `YYYY-MM-DD`   | วันที่สิ้นสุดของช่วงธุรกรรมที่ต้องการสืบค้น   | `"2024-10-07"` |
| **`merchantId`**|     `string`      |  ✅ **บังคับ**   |    `string`     | รหัส Merchant / Tenant ID                    | `"VOBM7qzaRH"` |
| **`pageSize`**  |    `integer`      |  ❌ **ทางเลือก** |    `number`     | จำนวนรายการต่อหน้า (Default: `20`)           | `2`            |
| **`pageIndex`** |    `integer`      |  ❌ **ทางเลือก** |    `number`     | ลำดับหน้าสำหรับ Pagination (เริ่มที่ `1`)    | `1`            |

---

### 3. ตัวอย่างคำขอ (Example Request)

#### **cURL:**

```bash
curl --location -g '{{API_ENDPOINT}}/api/v1/deposit?startDate=2024-10-01&endDate=2024-10-07&merchantId=VOBM7qzaRH&pageSize=2&pageIndex=1' \
--header 'x-api-key: {{API_KEY}}'
```

---

### 4. ตัวอย่างผลลัพธ์ตอบกลับ (Example Response — 200 OK)

เมื่อเรียกค้นข้อมูลสำเร็จ ระบบตอบกลับ `200 OK` พร้อมรายการธุรกรรมใน `data` และจำนวนรวมใน `total` สำหรับ Pagination:

```json
{
  "status": "success",
  "data": [
    {
      "referenceId": "1z8GmtI2g5",
      "expireDate": {
        "__type": "Date",
        "iso": "2024-10-07T17:31:57.473Z"
      },
      "clientId": "nHUxQbHgEu",
      "clientName": "demo2",
      "transactionId": "BZP0PTB01776723e7X2",
      "bankAccountNumber": "3140312345",
      "bankName": "BBL",
      "bankCode": "002",
      "name": "บจ.ค้าขาย ร่ำรวย จำกัด",
      "callbackUrl": "https://your-domain.com/callback",
      "ipAddress": "184.22.36.35",
      "type": "TRANSFER",
      "bankId": "nSSx7LL6X2",
      "bank": {
        "__type": "Pointer",
        "className": "Bank",
        "objectId": "nSSx7LL6X2"
      },
      "status": "expired",
      "systemPromptpayNumber": "0955157457",
      "systemBankAccountNumber": "1714436599",
      "systemBankCode": "014",
      "systemBankName": "SCB",
      "systemBankAccountName": "อุ่นใจ อุ่นจัง",
      "timestamp": 1728321993142,
      "merchantId": "VOBM7qzaRH",
      "merchantName": "demo2",
      "createdAt": "2024-10-07T17:26:57.637Z",
      "updatedAt": "2024-10-07T17:32:00.116Z",
      "webhookData": {
        "referenceId": "1z8GmtI2g5",
        "transactionId": "BZP0PTB01776723e7X2",
        "status": "expired",
        "timestamp": 1728322320053,
        "hash": "U2FsdGVkX1/hJCbep+Yy8xxRNRailfYcm0vbi3uBNyzoT8lwkHA+W1zf+WKoYmag"
      }
    },
    {
      "referenceId": "w5EIFM4i1M",
      "expireDate": {
        "__type": "Date",
        "iso": "2024-10-07T17:30:34.581Z"
      },
      "clientId": "nHUxQbHgEu",
      "clientName": "demo2",
      "transactionId": "BZP0PTB01776723e7X1",
      "amount": 2,
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
      "status": "expired",
      "systemPromptpayNumber": "0955157457",
      "systemBankAccountNumber": "1714436599",
      "systemBankCode": "014",
      "systemBankName": "SCB",
      "systemBankAccountName": "อุ่นใจ อุ่นจัง",
      "timestamp": 1728319408897,
      "merchantId": "VOBM7qzaRH",
      "merchantName": "demo2",
      "depositAmount": 1.54,
      "qrcode": "00020101021129370016A00000067701011101130066955157457530376454041.545802TH6304A299",
      "createdAt": "2024-10-07T17:25:34.776Z",
      "updatedAt": "2024-10-07T17:30:42.498Z",
      "webhookData": {
        "referenceId": "w5EIFM4i1M",
        "transactionId": "BZP0PTB01776723e7X1",
        "status": "expired",
        "timestamp": 1728322240045,
        "hash": "U2FsdGVkX19ikrgBKH81gFVP18riN1rjEGACfcuGVra2+AbgePiEj11ZHZ5RBVzi"
      }
    }
  ],
  "total": 92
}
```

---

### 5. ความหมายของฟิลด์ Response (Response Field Definitions)

| ฟิลด์ | คำอธิบาย |
| :---- | :------- |
| **`type`** | ช่องทางการชำระเงิน — `"TRANSFER"` (โอนตรง) หรือ `"QR"` (สแกนจ่าย) |
| **`status`** | สถานะรายการฝาก ณ ปัจจุบัน เช่น `"completed"`, `"expired"`, `"pending"` |
| **`depositAmount`** | ยอดชำระจริงหลังสุ่มเศษสตางค์ — มีเฉพาะ `type: "QR"` |
| **`systemBankAccountName`** | ชื่อบัญชีผู้รับ (บจก. ปลายทาง) สำหรับ Audit |
| **`systemBankAccountNumber`** | เลขบัญชีผู้รับ (บจก. ปลายทาง) สำหรับ Audit |
| **`webhookData`** | บันทึกประวัติ Webhook ที่ยิงไปหลังบ้าน รวม `hash` (AES-256) สำหรับตรวจสอบความปลอดภัย |
| **`total`** | จำนวนรายการทั้งหมดตามตัวกรอง — ใช้คำนวณ Pagination |

---

### 6. แนวปฏิบัติระดับ Enterprise สำหรับผู้พัฒนา (Developer Guide)

1. **Pagination & Memory Control:** บังคับกำหนด `pageSize` ที่เหมาะสม (เช่น ไม่เกิน 50 รายการต่อหน้า) เพื่อหลีกเลี่ยงคอขวด Database และการบวม Heap Memory บน Server
2. **Isolated Worker Pools:** สำหรับหลาย Tenant ควรแยก Worker/Cron ดึงข้อมูลและคัดแยก Ledger ต่อ Tenant โดยใช้ Concurrency ของ Go (goroutine + channel) เพื่อหลีกเลี่ยงข้อมูลชนกัน

---
