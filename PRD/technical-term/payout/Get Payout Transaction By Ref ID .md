### **GET Get Payout Transaction By Ref ID API**

---

### **1. นิยามการทำงาน (Definition)**
**GET Get Payout Transaction By Ref ID** คือ ช่องทางการเรียกสืบค้นและรายงานข้อมูลรายละเอียดของรายการสั่งจ่ายเงินโอนออก (Outbound Payout / Withdrawal) แบบระบุเจาะจงรายรายการผ่านตัวแปรรหัสอ้างอิงหลักของเกตเวย์ (**`referenceId`**) [cite: 16, 27, 46, 113, 129] 

ในสถาปัตยกรรมระดับ Enterprise API เส้นนี้ทำหน้าที่เป็น **Inquiry API (ระบบ Polling สำรอง)** เพื่อใช้สอบทานความเคลื่อนไหวและสถานะความเที่ยงตรงทางการเงิน ในกรณีที่สัญญาสัญญาณ Webhook ขากลับเกิดความล่าช้าจากระบบธนาคาร หรือเซิร์ฟเวอร์หลังบ้านฝั่งร้านค้าขาดการเชื่อมต่อชั่วคราว [cite: 232, 241, 251] เพื่อให้สามารถตรวจทานข้อมูลและปิดออเดอร์ในตารางกระเป๋าเงินจำลองได้อย่างถูกต้องแม่นยำ [cite: 232, 251]

---

### **2. ขั้นตอนการทำงาน (Step-by-Step Workflow)**

```
 [ Merchant Platform ]                    [ Payment Gateway ]                  [ Core Banking ]
          │                                        │                                  │
  1. ยิงคำสั่งสร้าง Payout                         │                                  │
  ├───────────────────────────────────────►│ 2. ประมวลผลและออกรหัส               │
  │◄───────── 200 OK (ได้ referenceId) ─────┤    "referenceId"                 │
  │                                        │                                  │
  │ (กรณีต้องการตรวจสอบสถานะเป็น Polling)    │                                  │
  │                                        │                                  │
  3. ยิง HTTP GET /payout/:referenceId     │                                  │
  ├───────────────────────────────────────►│ 4. สแกนตรวจสอบ Ledger ในดีบี      │
  │◄───────── 200 OK (ข้อมูลทรานแซกชัน) ─────┤    และสเตตัสล่าสุุดจากธนาคาร       │
  │                                        ├────── Direct API Query ─────────►│
  │                                        │◄───── อัปเดตข้อมูลความสำเร็จ ───────┤
```

1. **การบันทึกจัดเก็บสิทธิ์ (`referenceId`):** ทุกครั้งที่คุณริเริ่มทำรายการถอนเงินผ่าน `POST /api/v1/payout/create` สำเร็จ ระบบจะส่งค่ารหัสอ้างอิงระบบชำระเงิน `referenceId` กลับมาใน Response [cite: 20, 21, 106, 155]
2. **การเรียกตรวจสอบ (Inquiry Call):** เมื่อระบบของคุณต้องการตรวจสอบสถานะรายการ (เช่น เมื่อพ้นกรอบเวลา 15 วินาทีแล้วยังไม่ได้รับ Webhook Callback) หลังบ้าน Go จะส่งคำขอแบบ HTTP GET โดยระบุค่า `referenceId` ไว้ใน Path URL และแนบ API Key ความปลอดภัยใน Header [cite: 27, 113, 243]
3. **การค้นหาและคืนผล (Query & Dispatch):** ระบบเกตเวย์จะตรวจสอบสิทธิ์และดึงข้อมูลรายละเอียด Metadata, ประวัติเวลานำเข้า (Timestamp), และสถานะล่าสุดจากเครือข่ายธนาคาร แล้วทำการส่งตอบกลับกลับมาเป็นข้อมูล JSON คลี่โครงสร้างอย่างสมบูรณ์ [cite: 23, 110, 113, 129]

---

### **3. ข้อมูลทางเทคนิคและการรับส่งข้อมูล (Data Contracts)**

#### **Request Specifications** [cite: 27, 113]
* **HTTP Method:** `GET` [cite: 27, 113]
* **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/payout/:referenceId` [cite: 27, 113]
* **Request Headers:**
  * `x-api-key`: API Key ประจำตัวร้านค้า/Tenant ของคุณในการเข้าเชื่อมต่อ [cite: 27, 113]
* **Path Variables (ตัวแปรในเส้น URL):**
  * `referenceId` *(string, ✅ **บังคับ**)*: รหัสอ้างอิงของทรานแซกชันฝั่ง Gateway ที่ต้องการตรวจสอบ [cite: 27, 113]

---

### **4. ตัวอย่างการส่งคำขอและผลลัพธ์ตอบกลับ (Example Request / Response)** [cite: 23, 27, 113, 129]

#### **Example Request (cURL):** [cite: 27, 113]
```bash
curl --location -g 'https://api.flash-pay.io/api/v1/payout/qS4EDxSWCO' \
--header 'x-api-key: SEC_API_KEY_DEMO_01'
```

#### **Example Response (200 OK - JSON Payload):** [cite: 23, 129]
```json
{
  "status": "success",
  "data": {
    "referenceId": "qS4EDxSWCO",
    "logs": [
      {
        "status": "pending",
        "timestamp": 1728321993142
      },
      {
        "status": "processing",
        "timestamp": 1728331815513
      },
      {
        "status": "completed",
        "timestamp": 1728331819650
      }
    ],
    "clientId": "nHUxQbHgEu",
    "clientName": "demo2",
    "transactionId": "POP0PTB01776723e7X1",
    "amount": 1,
    "bankAccountNumber": "6640193604",
    "bankName": "KTB",
    "bankCode": "006",
    "name": "เฮง ร่ำรวย",
    "phone": "",
    "callbackUrl": "https://xxxx.com/callback",
    "ipAddress": "184.22.36.35",
    "bankId": "nSSx7LL6X2",
    "status": "completed",
    "systemPromptpayNumber": "0955157457",
    "systemBankAccountNumber": "1714436599",
    "systemBankCode": "014",
    "systemBankName": "SCB",
    "systemBankAccountName": "อุ่นใจ อุ่นจัง",
    "timestamp": 1728321993142,
    "merchantId": "VOBM7qzaRH",
    "merchantName": "demo2",
    "createdAt": "2024-10-07T20:10:15.309Z",
    "updatedAt": "2024-10-07T20:10:20.466Z",
    "callbackResponse": {
      "status": "error",
      "message": "connect ECONNREFUSED 54.153.216.130:443"
    },
    "accountToName": "บจ. ค้าขาย ร่ำรวย จำกัด",
    "message": "โอนเรียบร้อย",
    "processTime": 4,
    "qrcode": "0046000600000101030140225202410085HxTHZUSiu7AEZ3DE5102TH9104E769"
  }
}
```

---

### **5. เจาะลึกโครงสร้างตัวแปรขากลับที่สำคัญ (Response Fields Analysis)**

* **`data.status`** *(string)*: แสดงสเตตัสปัจจุบันของยอดจ่ายเงินออก ซึ่งจะช่วยยืนยันสถานะความสำเร็จทางการเงิน โดยมีวงจรสเตตัสคือ [cite: 19, 53, 54, 105, 129, 154, 181]:
  * `pending`: รายการถูกสร้างสำเร็จและค้างรออยู่ในระบบคิว [cite: 19, 53, 105, 153, 180]
  * `processing`: อยู่ระหว่างเครือข่ายธนาคารดำเนินการหักบัญชีและตัดโอนเงิน [cite: 19, 54, 105, 154, 181]
  * `completed`: ธนาคารดำเนินการโอนเงินเข้าสู่บัญชีลูกค้าปลายทางสำเร็จเสร็จสิ้น [cite: 19, 23, 54, 105, 129, 154, 181]
  * `failed` / `rejected`: การสั่งจ่ายล้มเหลว (เช่น สถานะบัญชีปลายทางไม่พร้อมรับยอด หรือปิดปรับปรุง) [cite: 19, 24, 54, 105, 110, 154, 181]
* **`data.logs`** *(array)*: ประวัติทรานสิชันเวลาการเปลี่ยนสถานะของระบบ (State Machine Timeline) แนบเวลาเป็น Unix Timestamp (ms) ช่วยวิเคราะห์ความเร็วของสเตจธนาคาร (Latency Checking) [cite: 23, 109, 129]
* **`data.accountToName`** *(string)*: **ชื่อสะกดจริงบนบัญชีธนาคารปลายทางที่ระบบธนาคารตรวจสอบเจอและได้รับเงินจริง** (ใช้สำหรับดึงมาสอบทานและยันความถูกต้องกับคีย์ `name` เพื่อทำ Audit) [cite: 23, 109, 129]
* **`data.qrcode`** *(string)*: **รหัสยืนยันการโอนเงิน (Mini-slip QR) ออกโดยธนาคาร** สำหรับใช้เจนภาพ QR Code ใบเสร็จให้ลูกค้าบันทึกเก็บไว้ [cite: 23, 109, 129]
* **`data.callbackResponse`** *(object)*: บันทึกรายงานการจัดส่ง Webhook ไปยังระบบพาร์ทเนอร์ [cite: 23, 109, 129] หากพบว่ามีข้อความระบุความขัดข้องของเน็ตเวิร์ก เช่น `ECONNREFUSED` ทีมดูแลระบบหลังบ้านจะใช้จุดนี้คัดกรองเพื่อสั่งยิง Webhook ซ้ำรอบใหม่ได้ทันทีครับ [cite: 23, 109, 129]

---

📊 สำหรับข้อมูลสเปก โครงสร้างการเชื่อมต่อ และการรับส่งข้อมูลของ Payout API ทรานแซกชันรายรายการนี้ มีความเสร็จสิ้นครบถ้วน 100% เรียบร้อยแล้วครับ

