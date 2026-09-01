**Deposit Webhook Callback (QR)** ของระบบ **FLASH-PAY** และ **BIT-PAYZ** เป็นการส่งสัญญาณแจ้งเตือนธุรกรรมฝากเงินผ่าน QR Code แบบ **Asynchronous HTTP POST** จาก Gateway ไปยัง `callbackUrl` ที่ระบุไว้ตอนสร้างรายการฝาก
Deposit Webhook Callback [ QR ] คือ ระบบการส่งสัญญาณแจ้งเตือนธุรกรรมฝากเงินขาเข้าผ่านช่องทาง QR Code แบบอัตโนมัติ (Asynchronous HTTP POST) จากระบบ Gateway ยิงไปที่เซิร์ฟเวอร์หลังบ้านของคุณ (callbackUrl ที่ระบุไว้ในคำขอสร้างรายการฝากเงินตั้งแต่ต้น) 
โดยระบบจะส่งสัญญาณ Callback นี้ทันทีที่สถานะของรายการนั้นสิ้นสุดลงและเปลี่ยนผ่านเข้าสู่สถานะ completed (ลูกค้าโอนสแกนเงินสำเร็จตรงตามเศษสตางค์ที่สุ่มไว้) หรือ expired (ลูกค้าไม่ได้จ่ายภายในเวลา หรือทำรายการโอนมาไม่ตรงเงื่อนไข) 
ด้านล่างนี้คือสรุปรายละเอียด **Deposit Webhook Callback (QR)** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. วัตถุประสงค์และเงื่อนไขการส่ง (Trigger Conditions)

Gateway จะยิง Webhook ทันทีเมื่อสถานะรายการสิ้นสุดและเปลี่ยนเป็น:

- **`completed`** — ลูกค้าสแกนจ่ายสำเร็จ ยอดตรงกับเศษสตางค์ที่สุ่มไว้
- **`expired`** — ลูกค้าไม่ได้จ่ายภายในเวลา หรือโอนไม่ตรงเงื่อนไข

---

### 2. ข้อมูลทางเทคนิค (Webhook Request Specification)

- **HTTP Method:** `POST` (Gateway → Merchant)
- **Request URL:** `callbackUrl` ที่ส่งใน **Create Deposit API**
- **Request Headers:**

  ```http
  Content-Type: application/json
  ```

---

### 3. โครงสร้าง JSON Payload (Request Body)

```json
{
  "referenceId": "w5EIFM4i1M",
  "transactionId": "BZP0PTB01776723e7X1",
  "clientId": "nHUxQbHgEu",
  "merchantId": "VOBM7qzaRH",
  "walletId": "nSSx7LL6X2",
  "bankCode": "074",
  "bankName": "TTB",
  "bankAccountNumber": "62xxxxxx40",
  "bankAccountName": "",
  "amount": 400.64,
  "status": "completed",
  "timestamp": 1728329638,
  "matchTimestamp": 1728329640826,
  "type": "QR",
  "hash": "U2FsdGVkX1/Z6EHf3XX6hmzlnK7TvYoLKsUlyR0F47LIERkRq2fKKhKwpwq3j9wu"
}
```

---

### 4. ความหมายของฟิลด์ Payload (Field Definitions)

| ฟิลด์ | ชนิด | คำอธิบาย |
| :---- | :--- | :------- |
| **`referenceId`** | `string` | เลขอ้างอิงธุรกรรมฝั่ง Gateway |
| **`transactionId`** | `string` | รหัสรายการฝั่งร้านค้าที่ส่งตอน Create Deposit |
| **`clientId`** | `string` | รหัส Client ฝั่งร้านค้า |
| **`merchantId`** | `string` | รหัสร้านค้า / Tenant ID |
| **`walletId`** | `string` | รหัสกระเป๋าเงินที่ผูกกับธุรกรรม |
| **`bankCode`** | `string` | รหัสธนาคาร 3 หลักของลูกค้าผู้โอน (เช่น `"074"` = TTB) |
| **`bankName`** | `string` | ชื่อย่อธนาคารผู้ชำระเงิน (เช่น `"TTB"`) |
| **`bankAccountNumber`** | `string` | เลขบัญชีลูกค้าผู้ชำระ (อาจปิดบังบางส่วน เช่น `"62xxxxxx40"`) |
| **`bankAccountName`** | `string` | ชื่อเจ้าของบัญชีผู้ชำระ (อาจเป็น `""` หากไม่พบใน Statement) |
| **`amount`** | `number` | ยอดชำระจริงหลังสุ่มเศษสตางค์ (เช่น ขอฝาก 400.00 จ่ายจริง 400.64) |
| **`status`** | `string` | สถานะสิ้นสุด — `"completed"` หรือ `"expired"` |
| **`timestamp`** | `integer` | Unix Timestamp (วินาที) ตอนลูกค้าเริ่มทำรายการฝาก |
| **`matchTimestamp`** | `integer` | Unix Timestamp (มิลลิวินาที) ตอน Gateway จับคู่ Statement สำเร็จ |
| **`type`** | `string` | ประเภทธุรกรรม — `"QR"` เสมอ |
| **`hash`** | `string` | ลายเซ็นความปลอดภัย (AES) ของ `transactionId` ด้วย key = `API_KEY + SECRET_KEY` |

---

### 5. ตัวอย่างคำขอทดสอบ (Example cURL)

ใช้ทดสอบ Webhook Controller บนเซิร์ฟเวอร์หลังบ้าน:

```bash
curl --location -g 'https://your-domain.com/deposit/callback' \
--header 'Content-Type: application/json' \
--data '{
    "referenceId": "w5EIFM4i1M",
    "transactionId": "BZP0PTB01776723e7X1",
    "clientId": "nHUxQbHgEu",
    "merchantId": "VOBM7qzaRH",
    "walletId": "nSSx7LL6X2",
    "bankCode": "074",
    "bankName": "TTB",
    "bankAccountNumber": "62xxxxxx40",
    "bankAccountName": "",
    "amount": 400.64,
    "status": "completed",
    "timestamp": 1728329638,
    "matchTimestamp": 1728329640826,
    "type": "QR",
    "hash": "U2FsdGVkX1/Z6EHf3XX6hmzlnK7TvYoLKsUlyR0F47LIERkRq2fKKhKwpwq3j9wu"
}'
```

---

### 6. Response ที่ Merchant ต้องตอบกลับ (Expected Response)

เมื่อประมวลผล Webhook สำเร็จ ระบบหลังบ้านต้องตอบกลับตามมาตรฐาน Gateway:

| รายการ | ค่าที่ต้องส่ง |
| :----- | :------------ |
| **HTTP Status Code** | `200 OK` |
| **Response Body** | ว่างเปล่า — **ห้าม** คืน JSON หรือข้อความใด ๆ |
| **Response Headers** | **ห้าม** ระบุ Headers เพิ่มเติม |

---

### 7. แนวปฏิบัติด้านความปลอดภัย (Developer Guide)

1. **Anti-Spoofing (ตรวจสอบ `hash`):** ถอดรหัส AES ด้วย key = `API_KEY + SECRET_KEY` แล้วตรวจว่า `transactionId` ที่ได้ตรงกับค่าใน Payload — หากไม่ตรง ตอบ `401 Unauthorized` ทันที
2. **Idempotency:** ก่อนอัปเดตเครดิต ตรวจสถานะใน DB — หากเป็น `completed` แล้ว ให้ตอบ `200 OK` (body ว่าง) โดยไม่ประมวลผลซ้ำ เพื่อรองรับ Webhook retry จาก Gateway
3. **HTTPS Only:** `callbackUrl` ต้องเป็น HTTPS เสมอ (กำหนดตอน Create Deposit)

---

⚠️ กฎความปลอดภัยและการหลีกเลี่ยงข้อผิดพลาด (Go Stack Implementation)
กลไกแกะรหัสเพื่อพิสูจน์สิทธิ์ (Anti-Spoofing Check): หลังบ้าน Go ของคุณต้องนำ hash ขากลับมาทำการถอดรหัส AES ด้วยกุญแจ API_KEY + SECRET_KEY [cite: 24, 25] จากนั้นตรวจสอบว่าค่า transactionId ที่อยู่ในโค้ดหลังแกะล็อก มีค่าตรงกับตัวแปรที่ส่งมาเปล่าๆ นอกรหัสหรือไม่ หากไม่ตรงระบบต้องตีรหัสเป็น StatusUnauthorized (401) ทันทีเพื่อความปลอดภัยของระบบเงินฝาก
ระบบหลีกเลี่ยงการอัปเดตเครดิตซ้ำ (Idempotency Handling): เพื่อป้องกันระบบเครดิตในเกมบวมขึ้นจากเคสเน็ตเวิร์กหน่วงแล้วเกตเวย์ส่ง Webhook ย้ำซ้ำรอบสอง เมื่อหลังบ้าน Go รับค่าให้สืบค้นตรวจสถานะออเดอร์ใน Database ก่อน [cite: 25] หากสถานะใน DB ถูกตั้งค่าเป็น completed ไปแล้วเรียบร้อย ให้ระบบทำการหยุดการประมวลผลทันทีและตอบกลับ HTTP Status 200 OK แบบว่างเปล่า เพื่อเคลียร์การจัดส่ง Callback ของเกตเวย์ครับ [cite: 26]
💡 เพื่อความคล่องตัวในการปิดโปรเจกต์สถาปัตยกรรมตัวนี้ของหลังบ้าน Go คุณต้องการให้ผมช่วยร่างตัวอย่าง Database Schema (SQL) ของตารางจัดเก็บทรานแซกชันรับชำระและ Logs Webhook เพื่อให้สอดรับกับค่าตัวแปรเศษสตางค์สุ่มและ Hash AES จาก Gateway ทั้งหมดนี้เลยไหมครับ?
