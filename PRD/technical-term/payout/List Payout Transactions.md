### **นิยามการทำงาน (Definition)**
**GET List Payout Transactions** คือ ช่องทางการเรียกสืบค้นและรายงานข้อมูลประวัติการทำรายการสั่งจ่ายเงินโอนออก (Outbound Payout / Withdrawal) ของร้านค้า (Merchant) หรือแต่ละ Tenant ในระบบตามเงื่อนไขและช่วงเวลาที่ระบุ [cite: 25, 245] โดยมีจุดประสงค์หลักเพื่อให้นักพัฒนานำข้อมูลไปจัดทำระบบรายงานหลังบ้าน (Report Dashboard) ตรวจสอบสถานะความคล่องตัวของธุรกรรมย้อนหลัง และนำไปเปรียบเทียบกระทบยอดคู่บัญชีรายวัน (Automated Reconciliation) ร่วมกับข้อมูลสเตตเมนต์ธนาคาร (เช่น บัญชีกรุงไทยธุรกิจ บจก.) เพื่อให้มั่นใจว่าบัญชีแยกประเภท (Ledger) ขององค์กรมีความถูกต้อง 100% [cite: 25, 245]

---

### **ขั้นตอนการทำงาน (Workflows)**
กระบวนการรับส่งข้อมูลของระบบในการสืบค้นประวัติ มีโฟลว์การเชื่อมประสานแบบไร้แรงเสียดทาน (Zero Manual Flow) ดังนี้ [cite: 25, 26]:

```
[ Merchant Platform หลังบ้านของคุณ ]                         [ Payment Gateway Engine ]
                │                                                     │
1. กำหนดตัวกรอง (startDate, endDate)                                  │
2. ยิง HTTP GET /api/v1/payout พร้อมแนบ API Key                        │
├────────────────────────────────────────────────────────────────────►│ 3. ตรวจสอบสิทธิ์ API Key 
│                                                                     │    และค้นหา Ledger ในฐานข้อมูล [cite: 25]
│◄───────────────── 200 OKพร้อมข้อมูลประวัติการโอน (JSON Array) ────────┤ 4. สรุปรายงานสถานะ (logs) 
│                                                                     │    และดึงรหัสสลิปยืนยัน (qrcode) [cite: 26]
```

1. **การร้องขอ (Request Initiation):** ระบบหลังบ้านของคุณกำหนดตัวกรองช่วงเวลาที่ต้องการตรวจสอบ (เช่น ช่วง 1-2 วันที่ผ่านมา) จากนั้นสั่งยิง HTTP GET มาที่เอนด์พอยต์เกตเวย์พร้อมแนบ **`x-api-key`** ใน Header [cite: 25]
2. **การคัดกรองสิทธิ์และประมวลผล (Security Filter & Data Retrieval):** เกตเวย์จะตรวจสอบสิทธิ์ความปลอดภัยของ API Key และสืบค้นข้อมูลทรานแซกชันที่ตรงตามเงื่อนไขของ `merchantId` รวมถึงดึงบันทึกการปรับเปลี่ยนสเตตัสในไทม์ไลน์ (State Transition Logs) [cite: 25, 26]
3. **การส่งผลตอบกลับ (Data Response):** ระบบคืนข้อมูลธุรกรรมทั้งหมดกลับมาในรูปแบบ JSON Array เพื่อนำไปแสดงผลหรือตรวจสอบความคล่องตัวทางการเงิน [cite: 26]

---

### **โครงสร้างการรับส่งข้อมูลโดยละเอียด (Data Contracts)**

#### **1. ข้อมูลการส่งคำขอ (Request Specifications)** [cite: 25]
* **HTTP Method:** `GET` [cite: 25]
* **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/payout` [cite: 25]
* **Headers:** [cite: 25]
  * `x-api-key`: API Key ประจำตัวร้านค้าของคุณที่ได้รับสิทธิ์เชื่อมระบบ [cite: 25]

#### **2. พารามิเตอร์สำหรับตัวกรองสืบค้น (Query Parameters)** [cite: 25]
การเรียกใช้งานจะรับพารามิเตอร์ผ่าน Query String แนบไปกับเส้น URL ดังนี้ครับ [cite: 25]:

| พารามิเตอร์ (Query Key) | ชนิดข้อมูล (Type) | ความสำคัญ (Required) | รูปแบบข้อมูล (Format) | คำอธิบายพารามิเตอร์ | ตัวอย่างข้อมูล |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **`startDate`** | `string` | ✅ **บังคับ** | `YYYY-MM-DD` | วันที่เริ่มต้นของทรานแซกชันที่ต้องการเรียกดู [cite: 25] | `"2024-10-07"` [cite: 25] |
| **`endDate`** | `string` | ✅ **บังคับ** | `YYYY-MM-DD` | วันที่สิ้นสุดของทรานแซกชันที่ต้องการเรียกดู [cite: 25] | `"2024-10-08"` [cite: 25] |
| **`merchantId`** | `string` | ✅ **บังคับ** | `string` | รหัสอ้างอิงร้านค้าหรือองค์กรของคุณ (Merchant ID) [cite: 25] | `"VOBM7qzaRH"` [cite: 26] |
| **`pageSize`** | `integer` | ❌ *ทางเลือก* | `number` | จำนวนรายการที่กำหนดให้แสดงผลต่อ 1 หน้า (Default: `20`) [cite: 25] | `20` [cite: 25] |
| **`pageIndex`** | `integer` | ❌ *ทางเลือก* | `number` | ลำดับเลขหน้าที่ต้องการเรียกสำหรับกระบวนการแบ่งหน้า (Pagination) [cite: 25] | `1` [cite: 25] |

---

### **ตัวอย่างการรับส่งข้อมูลจริง (Example Request / Response)**

#### **Example Request (cURL):** [cite: 25]
```bash
curl --location -g 'https://api.flash-pay.io/api/v1/payout?startDate=2024-10-07&endDate=2024-10-08&merchantId=VOBM7qzaRH&pageSize=20&pageIndex=1' \
--header 'x-api-key: SEC_API_KEY_DEMO_01'
```

#### **Example Response (200 OK - JSON Payload):** [cite: 26]
เมื่อประมวลผลสำเร็จ เกตเวย์จะตอบกลับรูปแบบข้อมูลอย่างสมบูรณ์ รวมถึงรายละเอียดสถานะย่อยและประวัติ Webhook ของรายการนั้นย้อนหลัง ดังนี้ครับ [cite: 26]:

```json
{
  "status": "success",
  "data": [
    {
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
      "systemBankAccountName": "ปิยรัฐ แก้วจันทร์",
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
  ],
  "total": 10
}
```

---

### **เจาะลึกความหมายของตัวแปรข้อมูลขากลับ (Key Fields Analysis)**

* **`logs`** *(array)*: ประวัติขั้นตอนการเดินทางของธุรกรรม (State Machine Timeline) ระบุเวลาการเปลี่ยนสเตตัสอย่างละเอียดตั้งแต่ `pending` ➡️ `processing` ➡️ สู่ผลสถานะสิ้นสุด ซึ่งเป็นข้อมูลที่มีค่าอย่างมากในการทำสอบทานความหน่วงในการตอบสนองของเครือข่ายธนาคาร (Transaction Processing Latency) [cite: 26, 245]
* **`accountToName`** *(string)*: **ชื่อสะกดจริงของบัญชีผู้รับโอนเงินปลายทางที่ระบบธนาคารตรวจสอบเจอ** ซึ่งควรถูกดึงไปใช้สืบเทียบกับพารามิเตอร์ `name` ที่ลูกค้าส่งเข้ามาในคำสั่งแรก เพื่อทำการตรวจสอบ Auditing ของฝ่ายการเงิน [cite: 26, 245]
* **`qrcode`** *(string)*: **สตรีมข้อมูลสลิปการโอนเงิน (Mini-slip QR) ที่ออกโดยเครือข่ายธนาคารโดยตรง** ใช้สำหรับให้ลูกค้าสแกนตรวจสอบการโอนเงินผ่านแอปพลิเคชันเพื่อความอุ่นใจในการถอนเงิน [cite: 26]
* **`callbackResponse`** *(object)*: ล็อกผลลัพธ์การยิงสัญญาณ Webhook จากฝั่งเกตเวย์ส่งกลับมาหาระบบร้านค้า [cite: 26] หากรายงานแสดงสถานะความขัดข้อง เช่น `"status": "error"`, `ECONNREFUSED` ทีมโปรแกรมเมอร์จะใช้จุดนี้คัดกรองเพื่อทำการยิง Webhook ซ้ำ (Webhook Retry Mechanism) เพื่อปรับแต้มให้เสร็จสิ้นได้ครับ [cite: 26]
* **`total`** *(integer)*: ตัวเลขจำนวนรายการยอดธุรกรรมรวมทั้งหมดที่สืบค้นเจอ ช่วยให้หลังบ้านคำนวณและแสดงค่าจัดทำระบบ Pagination หน้าบ้านได้อย่างมีประสิทธิภาพ [cite: 26]

---



 