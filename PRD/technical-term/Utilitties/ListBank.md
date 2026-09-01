**List Bank API** (การดึงรายการธนาคารทั้งหมดในระบบ) ของ **FLASH-PAY** และ **BIT-PAYZ** เป็นฐานข้อมูลกลาง (Master Data) สำหรับแพลตฟอร์มชำระเงิน ครอบคลุมข้อมูลทางเทคนิค โครงสร้างฟิลด์ ตัวอย่างคำขอ ตัวอย่างผลลัพธ์ตอบกลับ และแนวทางการเขียนด้วย Go Stack (Golang) [cite: 120, 137, 231]

ด้านล่างนี้คือสรุปรายละเอียด **List Bank API** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. วัตถุประสงค์การใช้งาน (Purpose)

API นี้มีไว้เพื่อ**ดึงข้อมูลรหัสธนาคารและรายชื่อธนาคารทั้งหมดที่ระบบชำระเงินรองรับ** [cite: 115, 184] ในการทำระบบชำระเงินอัตโนมัติ (Automated Payment Processing) มีบทบาทสำคัญในสถาปัตยกรรมระดับ Enterprise ดังนี้ [cite: 119, 136, 199, 230]:

1. **ระบบฝากเงิน (Deposit Module):** ค่า `name` ที่ได้จาก API นี้ (เช่น `BBL`, `KBANK`, `KTB`) ต้องถูกนำไประบุในฟิลด์ `bankName` เมื่อส่งคำขอสร้างรายการฝากเงิน (`POST /api/v1/deposit/create`) หากส่งค่าไม่ตรงกับ Master Data รายการจะถูกปฏิเสธทันที [cite: 13, 14, 42, 43, 58, 59, 95, 96, 169, 170, 191, 192, 207, 208]
2. **ระบบโอนออก (Payout Module):** ใช้เป็นข้อมูลอ้างอิงรหัสย่อธนาคารในการส่งคำสั่งจ่ายเงินออกไปยังลูกค้าปลายทางอย่างแม่นยำ [cite: 69, 112, 145, 224, 248]
3. **การเรนเดอร์หน้าบ้าน (Frontend UI):** ฟิลด์ `color`, `name_th`, และ `name_en` ช่วยให้หน้าเว็บวาดปุ่มเลือกธนาคารที่มีสีสันถูกต้องตาม CI ของแต่ละธนาคารได้แบบไดนามิก โดยไม่ต้อง Hardcode ที่หน้าบ้าน [cite: 120, 137, 231]
4. **ใช้ดึงค่าพารามิเตอร์สำหรับ API อื่น:** ค่า `name` หรือ `code` ที่ได้จาก API นี้ ต้องนำไปใช้ในคำขอสร้างรายการฝาก (`POST /api/v1/deposit/create`) หรือสั่งจ่ายเงินโอนออก (`POST /api/v1/payout/create`) ให้ตรงตามที่ Gateway กำหนด [cite: 122, 166]

---

### 2. ข้อมูลการส่งคำขอทาง API (API Request Specification)

- **HTTP Method:** `GET` [cite: 115, 120, 137, 184, 231]
- **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/client/bank/list/code` [cite: 115, 120, 137, 184, 231]
- **Headers Authentication:**
  ใน Header ของทุกคำขอ จำเป็นต้องแนบ API Key ประจำตัวร้านค้าเพื่อผ่านการตรวจสอบสิทธิ์ [cite: 2, 31, 47, 84, 115, 117, 184, 197]:

  ```http
  x-api-key: {{YOUR_API_KEY}}
  ```

#### **ตัวอย่างคำขอด้วย cURL:**

```bash
curl --location -g '{{API_ENDPOINT}}/api/v1/client/bank/list/code' \
--header 'x-api-key: {{API_KEY}}'
```

---

### 3. โครงสร้างผลลัพธ์ที่ตอบกลับ (Response Payload Structure)

เมื่อเรียกใช้สำเร็จ ระบบจะตอบกลับด้วยสถานะ `200 OK` และส่งข้อมูล JSON Object ที่มีฟิลด์หลักและออบเจกต์ย่อยภายใน `data` ดังนี้ [cite: 115, 120, 137, 184, 231]:

- **`status` (string):** สถานะการดึงข้อมูล (ตอบกลับเป็น `"success"`) [cite: 115, 184]
- **`data` (array):** อาเรย์ของออบเจกต์ข้อมูลธนาคาร โดยในแต่ละธนาคารจะประกอบด้วยฟิลด์หลักดังนี้ [cite: 115, 120, 137, 184, 231]:
  - **`code` (string):** รหัสธนาคารมาตรฐาน 3 หลักที่ใช้ในประเทศไทย (เช่น `"002"` คือกรุงเทพ, `"004"` คือกสิกรไทย) [cite: 115, 120, 137, 184, 231]
  - **`name` (string):** รหัสชื่อย่อภาษาอังกฤษตัวพิมพ์ใหญ่ของธนาคาร ซึ่ง**ต้องนำค่านี้ไปกรอกในฟิลด์ `bankName` ของคำขอฝาก-ถอนเงิน** (เช่น `"KTB"`, `"SCB"`, `"KBANK"`) [cite: 13, 14, 42, 43, 58, 59, 69, 95, 96, 112, 115, 120, 122, 137, 145, 169, 170, 184, 191, 192, 207, 208, 224, 231, 248]
  - **`name_th` (string):** ชื่อเรียกธนาคารภาษาไทยอย่างเป็นทางการ (เช่น `"กรุงไทย"`, `"ไทยพาณิชย์"`) [cite: 115, 120, 137, 184, 231]
  - **`name_en` (string):** ชื่อเรียกธนาคารภาษาอังกฤษอย่างเป็นทางการ (เช่น `"KRUNG THAI BANK"`, `"SIAM COMMERCIAL BANK"`) [cite: 115, 120, 137, 184, 231]
  - **`color` (string):** รหัสสี HEX Code ประจำธนาคาร (เช่น สีฟ้ากรุงไทยคือ `"#1ba5e1"`, สีม่วงไทยพาณิชย์คือ `"#4e2e7f"`) [cite: 115, 120, 137, 184, 231]

#### **ตัวอย่าง Success Response (JSON Payload จากระบบจริง):** [cite: 120, 137, 231]

```json
{
  "status": "success",
  "data": [
    {
      "code": "000",
      "name": "PROMPTPAY",
      "name_th": "พร้อมเพย์",
      "name_en": "PROMPTPAY",
      "color": "#1e4598"
    },
    {
      "code": "002",
      "name": "BBL",
      "name_th": "กรุงเทพ",
      "name_en": "BANGKOK BANK",
      "color": "#1e4598"
    },
    {
      "code": "004",
      "name": "KBANK",
      "name_th": "กสิกรไทย",
      "name_en": "KASIKORNBANK",
      "color": "#138f2d"
    },
    {
      "code": "006",
      "name": "KTB",
      "name_th": "กรุงไทย",
      "name_en": "KRUNG THAI BANK",
      "color": "#1ba5e1"
    },
    {
      "code": "011",
      "name": "TMB",
      "name_th": "ทหารไทย",
      "name_en": "TMB BANK",
      "color": "#1279be"
    },
    {
      "code": "014",
      "name": "SCB",
      "name_th": "ไทยพาณิชย์",
      "name_en": "SIAM COMMERCIAL BANK",
      "color": "#4e2e7f"
    },
    {
      "code": "022",
      "name": "CIMB",
      "name_th": "ซีไอเอ็มบี",
      "name_en": "CIMB THAI BANK",
      "color": "#7e2f36"
    },
    {
      "code": "024",
      "name": "UOB",
      "name_th": "ยูโอบี",
      "name_en": "UNITED OVERSEAS BANK (THAI)",
      "color": "#0b3979"
    },
    {
      "code": "025",
      "name": "BAY",
      "name_th": "กรุงศรี",
      "name_en": "BANK OF AYUDHYA (KRUNGSRI)",
      "color": "#fec43b"
    },
    {
      "code": "030",
      "name": "GSB",
      "name_th": "ออมสิน",
      "name_en": "THE GOVERNMENT SAVINGS BANK",
      "color": "#eb198d"
    },
    {
      "code": "033",
      "name": "GHB",
      "name_th": "อาคารสงเคราะห์",
      "name_en": "THE GOVERNMENT HOUSING BANK",
      "color": "#fc4f1f"
    },
    {
      "code": "034",
      "name": "BAAC",
      "name_th": "ธ.ก.ส.",
      "name_en": "BANK FOR AGRICULTURE AND AGRICULTURAL COOPERATIVES",
      "color": "#4b9b1d"
    },
    {
      "code": "067",
      "name": "TISCO",
      "name_th": "ทิสโก้",
      "name_en": "TISCO BANK",
      "color": "#12549f"
    },
    {
      "code": "069",
      "name": "KKP",
      "name_th": "เกียรตินาคินภัทร",
      "name_en": "KIATNAKIN BANK",
      "color": "#635f98"
    },
    {
      "code": "073",
      "name": "LHBANK",
      "name_th": "แลนด์ แอนด์ เฮ้าส์",
      "name_en": "LAND AND HOUSES BANK",
      "color": "#6d6e71"
    },
    {
      "code": "074",
      "name": "TTB",
      "name_th": "ทีทีบี",
      "name_en": "TMBTHANACHART BANK",
      "color": "#0050f0"
    }
  ]
}
```

---

### 4. รายการรหัสธนาคารมาตรฐานที่ระบบ FLASH-PAY รองรับ

จากเอกสารคู่มือระบบ มีการจัดเก็บและจำแนกรายชื่อรหัสธนาคารในไทยไว้ทั้งหมด **16 รายการ** ดังนี้ [cite: 115, 184]:

| รหัส Code | รหัสชื่อย่อ (Name) | ชื่อธนาคารภาษาไทย (name_th) | รหัสสี (HEX Color) |
| :-------: | :----------------- | :-------------------------- | :----------------- |
|  **000**  | **PROMPTPAY**      | พร้อมเพย์                   | `#1e4598`          |
|  **002**  | **BBL**            | กรุงเทพ                     | `#1e4598`          |
|  **004**  | **KBANK**          | กสิกรไทย                    | `#138f2d`          |
|  **006**  | **KTB**            | กรุงไทย                     | `#1ba5e1`          |
|  **011**  | **TMB**            | ทหารไทย                     | `#1279be`          |
|  **014**  | **SCB**            | ไทยพาณิชย์                  | `#4e2e7f`          |
|  **022**  | **CIMB**           | ซีไอเอ็มบี                  | `#7e2f36`          |
|  **024**  | **UOB**            | ยูโอบี                      | `#0b3979`          |
|  **025**  | **BAY**            | กรุงศรี                     | `#fec43b`          |
|  **030**  | **GSB**            | ออมสิน                      | `#eb198d`          |
|  **033**  | **GHB**            | อาคารสงเคราะห์              | `#fc4f1f`          |
|  **034**  | **BAAC**           | ธ.ก.ส.                      | `#4b9b1d`          |
|  **067**  | **TISCO**          | ทิสโก้                      | `#12549f`          |
|  **069**  | **KKP**            | เกียรตินาคินภัทร            | `#635f98`          |
|  **073**  | **LHBANK**         | แลนด์ แอนด์ เฮ้าส์          | `#6d6e71`          |
|  **074**  | **TTB**            | ทีทีบี                      | `#0050f0`          |

---

### 5. ข้อควรระวังในการพัฒนา (Developer Warning)

- **การส่งค่าพารามิเตอร์ผิดฟอร์แมต:** ในการเรียกใช้ API ฝาก-ถอนเงินปลายทาง ห้ามกรอกรหัสธนาคารหรือชื่อเรียกตามความเข้าใจของตนเอง (เช่น พิมพ์ `"Kasikorn"`, `"K-Bank"` หรือใช้รหัสตัวเลขแทนชื่อ) ต้องดึงค่าจากฟิลด์ **`name`** ของธนาคารที่ต้องการจาก API นี้ (เช่น **`KBANK`**) ไปส่งเท่านั้น มิฉะนั้นระบบจะปฏิเสธการจับยอดทันที [cite: 122, 123, 166]

---

### 6. การประยุกต์ใช้งานด้วยภาษา Go (Memory Caching Best Practice)

ข้อมูลรายชื่อธนาคารและรหัสธนาคารเป็นข้อมูลประเภท **Static Master Data** ที่ไม่มีการเปลี่ยนแปลงบ่อยครั้ง หากหลังบ้าน Go ส่ง HTTP Request ไปดึงจากเกตเวย์โดยตรงทุกครั้งที่มีผู้ใช้ขอฝาก/ถอน จะทำให้เกิด Latency สะสมโดยไม่จำเป็น [cite: 14]

แนวทางระดับ Enterprise ที่ถูกต้องคือ **การดึงข้อมูลมาเก็บไว้ในหน่วยความจำ (In-Memory Cache)** ตอนเริ่ม Start Application และเปิดฟังก์ชันตรวจสอบความถูกต้องแบบ On-the-fly ดังตัวอย่างโค้ดชุดนี้:

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// Bank เก็บข้อมูลธนาคารรายสถาบัน
type Bank struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	NameTH string `json:"name_th"`
	NameEN string `json:"name_en"`
	Color  string `json:"color"`
}

// ListBankResponse สำหรับจับ JSON ตอบกลับ
type ListBankResponse struct {
	Status string `json:"status"`
	Data   []Bank `json:"data"`
}

// BankCache ตัวจัดการระบบ Cache รายการธนาคารในหน่วยความจำ
type BankCache struct {
	sync.RWMutex
	banks       map[string]Bank // คีย์เป็นชื่อย่อ เช่น "SCB", "KTB"
	apiEndpoint string
	apiKey      string
}

func NewBankCache(endpoint, apiKey string) *BankCache {
	return &BankCache{
		banks:       make(map[string]Bank),
		apiEndpoint: endpoint,
		apiKey:      apiKey,
	}
}

// LoadCache ดึงข้อมูลจาก API ของเกตเวย์มาเก็บไว้ในหน่วยความจำ
func (bc *BankCache) LoadCache(ctx context.Context) error {
	client := &http.Client{Timeout: 10 * time.Second}
	reqURL := fmt.Sprintf("%s/api/v1/client/bank/list/code", bc.apiEndpoint)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("failed to build request: %w", err)
	}

	req.Header.Set("x-api-key", bc.apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to execute http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("api responded with status: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	var res ListBankResponse
	if err := json.Unmarshal(bodyBytes, &res); err != nil {
		return fmt.Errorf("failed to parse json: %w", err)
	}

	bc.Lock()
	defer bc.Unlock()
	for _, bank := range res.Data {
		bc.banks[bank.Name] = bank // แมปเก็บโดยใช้ฟิลด์ชื่อย่อเป็น Key
	}

	return nil
}

// ValidateBank ยืนยันความถูกต้องของชื่อย่อธนาคาร (เช่น ตรวจสอบ SCB, KBANK ว่าอยู่ในฐานข้อมูลเกตเวย์หลักไหม)
func (bc *BankCache) ValidateBank(bankName string) (Bank, bool) {
	bc.RLock()
	defer bc.RUnlock()
	bank, exists := bc.banks[bankName]
	return bank, exists
}

func main() {
	endpoint := "https://api.flash-pay.io"
	apiKey := "YOUR_SaaS_MERCHANT_API_KEY"

	cache := NewBankCache(endpoint, apiKey)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	// โหลดข้อมูลเข้า Cache ตอนเริ่มต้นรันแอปฯ
	fmt.Println("⏳ กำลังเตรียมการโหลดรายการธนาคารเข้าสู่ Memory...")
	if err := cache.LoadCache(ctx); err != nil {
		fmt.Printf("❌ โหลด Cache ล้มเหลว: %v\n", err)
		return
	}
	fmt.Println("✅ โหลด Master Bank Data สำเร็จ!")

	// ตัวอย่างการตรวจสอบความถูกต้องก่อนยิงคำขอจริง
	testInputBank := "KBANK"
	bankMeta, isValid := cache.ValidateBank(testInputBank)
	if !isValid {
		fmt.Printf("❌ ธนาคาร '%s' ไม่ได้รับการสนับสนุนโดยเกตเวย์\n", testInputBank)
		return
	}

	fmt.Println("\n=== ผลการตรวจสอบความสมบูรณ์ ===")
	fmt.Printf("ชื่อระบบย่อ: %s\n", bankMeta.Name)
	fmt.Printf("ชื่อภาษาไทย: %s\n", bankMeta.NameTH)
	fmt.Printf("รหัสโค้ด:   %s\n", bankMeta.Code)
	fmt.Printf("สีสไตล์ UI:  %s\n", bankMeta.Color)
}
```

---
