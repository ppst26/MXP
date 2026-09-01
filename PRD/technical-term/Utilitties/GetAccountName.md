**Get Account Name API** (การสืบค้นชื่อผู้ถือบัญชีธนาคาร) ของ **FLASH-PAY** และ **BIT-PAYZ** เป็น Utility API สำหรับตรวจสอบความถูกต้องของบัญชีปลายทางแบบเรียลไทม์ ก่อนดำเนินการฝากหรือโอนเงิน [cite: 1, 3, 12, 133, 188]

ด้านล่างนี้คือสรุปรายละเอียด **Get Account Name API** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. วัตถุประสงค์และประโยชน์เชิงธุรกิจ (Business Objectives)

การตรวจสอบบัญชีปลายทางผ่าน API นี้ ทำหน้าที่ตอบโจทย์หลัก 2 ด้านในแพลตฟอร์ม [cite: 12, 47, 96, 137, 160, 192, 222, 245, 253]:

1. **ระบบโอนเงินออก (Auto-Payout / Pre-Validation):** ก่อนสั่งโอนเงินออก ระบบต้องยิงเช็กว่าเลขบัญชีตรงกับชื่อผู้รับโอนจริงหรือไม่ เพื่อป้องกัน Human Error และลดโอกาสโอนเงินผิดบัญชี [cite: 1, 4, 117, 172, 247, 248]
2. **ระบบรับเงินเข้า (Inbound Transfer Deposit Matching):** สืบค้นชื่อเจ้าของบัญชีต้นทาง (ผู้ฝากเงิน) เพื่อเก็บเป็น Metadata ผูกกับรายการรอชำระเงิน ก่อนจับคู่กับ Statement จากธนาคารและอัปเดตออเดอร์อัตโนมัติ [cite: 12, 245, 277]

---

### 2. ข้อมูลทางเทคนิคและสเปกการเชื่อมต่อ (API Technical Specifications)

- **HTTP Method:** `POST` [cite: 9, 12, 47, 96, 101, 118, 137, 139, 160, 161, 187, 192, 207, 222, 253]
- **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/client/bank/verify/bankAccountName` [cite: 9, 12, 47, 96, 101, 118, 137, 139, 160, 161, 187, 192, 207, 222, 253]
- **Headers:**
  ใน Header ของคำขอจะต้องระบุคีย์ตรวจสอบสิทธิ์ประจำตัว Tenant เสมอ [cite: 9, 12, 47, 96, 101, 118, 137, 139, 160, 161, 187, 192, 207, 222, 253]:

  ```http
  x-api-key: {{YOUR_API_KEY}}
  Content-Type: application/json
  ```

#### **พารามิเตอร์ใน Request Body (JSON):** [cite: 9, 12, 47, 96, 101, 118, 137, 139, 160, 161, 187, 192, 207, 222, 253]

| Parameter Name          | ชนิดข้อมูล (Type) | สถานะ (Required) | คำอธิบายและเงื่อนไขพารามิเตอร์                                                                                                                     | ตัวอย่างข้อมูล |
| :---------------------- | :---------------: | :--------------: | :------------------------------------------------------------------------------------------------------------------------------------------------- | :------------- |
| **`bankAccountNumber`** |     `string`      |  ✅ **บังคับ**   | เลขที่บัญชีธนาคารที่ต้องการสืบค้น (ต้องส่งเป็น String เพื่อป้องกันตัวเลข 0 นำหน้าหลุดหาย)                                                         | `"1234567890"` |
| **`bankName`**          |     `string`      |  ✅ **บังคับ**   | รหัสชื่อย่อภาษาอังกฤษของธนาคารปลายทาง **ซึ่งต้องเป็นค่าที่ดึงมาจาก List Bank API เท่านั้น** (เช่น `SCB`, `KBANK`, `KTB`) [cite: 17, 122, 198, 259] | `"SCB"`        |

#### **ตัวอย่างคำขอด้วย cURL:**

```bash
curl --location -g '{{API_ENDPOINT}}/api/v1/client/bank/verify/bankAccountName' \
--header 'x-api-key: {{API_KEY}}' \
--header 'Content-Type: application/json' \
--data '{
    "bankAccountNumber": "1234567890",
    "bankName": "SCB"
}'
```

---

### 3. โครงสร้างผลลัพธ์ตอบกลับ (Response Payload Specification)

เมื่อระบบค้นหาข้อมูลในเครือข่ายธนาคารสำเร็จ จะตอบกลับสถานะ HTTP `200 OK` พร้อมข้อมูล JSON ดังนี้ [cite: 10, 13, 48, 97, 103, 119, 139, 140, 162, 188, 194, 208, 224, 255]:

#### **ตัวอย่าง Success Response — บุคคลธรรมดา:**

```json
{
  "status": "success",
  "data": "นาย เฮง ร่ำรวย"
}
```

#### **ตัวอย่าง Success Response — นิติบุคคล:**

```json
{
  "status": "success",
  "data": "บจ.ค้าขาย ร่ำรวย จำกัด"
}
```

- **`status` (string):** สถานะตอบกลับ จะเป็น `"success"` เมื่อระบบเชื่อมต่อและสืบค้นเลขบัญชีพบบนระบบธนาคาร [cite: 13, 48, 97, 139, 162, 194, 224, 255]
- **`data` (string):** ชื่อบุคคลธรรมดาหรือนิติบุคคลผู้เป็นเจ้าของบัญชี เป็นภาษาไทยหรือภาษาอังกฤษ (ส่งกลับจากฐานข้อมูลธนาคารโดยตรง) [cite: 13, 48, 97, 103, 119, 139, 140, 162, 188, 194, 208, 224, 255]

---

### 4. ตัวอย่างการเขียน Go Stack Implementation

โค้ด Go สำหรับเรียก API พร้อม Sanitization เลขบัญชีและ Context timeout:

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type AccountVerifyReq struct {
	BankAccountNumber string `json:"bankAccountNumber"`
	BankName          string `json:"bankName"`
}

type AccountVerifyResp struct {
	Status string `json:"status"`
	Data   string `json:"data"`
}

type VerificationClient struct {
	APIEndpoint string
	APIKey      string
	HTTPClient  *http.Client
}

func NewVerificationClient(endpoint, apiKey string) *VerificationClient {
	return &VerificationClient{
		APIEndpoint: endpoint,
		APIKey:      apiKey,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func SanitizeAccountNumber(accNo string) string {
	reg := regexp.MustCompile(`[^0-9]`)
	return reg.ReplaceAllString(accNo, "")
}

func (c *VerificationClient) VerifyAccountName(ctx context.Context, accNo, bankName string) (string, error) {
	cleanAccNo := SanitizeAccountNumber(accNo)
	if cleanAccNo == "" {
		return "", fmt.Errorf("invalid account number after sanitization")
	}

	reqPayload := AccountVerifyReq{
		BankAccountNumber: cleanAccNo,
		BankName:          strings.ToUpper(bankName),
	}

	jsonData, err := json.Marshal(reqPayload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	reqURL := fmt.Sprintf("%s/api/v1/client/bank/verify/bankAccountName", c.APIEndpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.APIKey)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("http connection error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("api responded with status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	var verifyResult AccountVerifyResp
	if err := json.Unmarshal(bodyBytes, &verifyResult); err != nil {
		return "", fmt.Errorf("failed to parse response json: %w", err)
	}

	if verifyResult.Status != "success" {
		return "", fmt.Errorf("verification failed status: %s", verifyResult.Status)
	}

	return verifyResult.Data, nil
}

func main() {
	endpoint := "https://api.flash-pay.io"
	apiKey := "YOUR_SaaS_MERCHANT_API_KEY"

	client := NewVerificationClient(endpoint, apiKey)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	accountNo := "123-4-56789-0"
	bankName := "SCB"

	name, err := client.VerifyAccountName(ctx, accountNo, bankName)
	if err != nil {
		fmt.Printf("❌ ไม่สามารถตรวจสอบชื่อบัญชีได้: %v\n", err)
		return
	}

	fmt.Println("=== ผลการตรวจสอบบัญชีสำเร็จ (Go Stack) ===")
	fmt.Printf("ผลการค้นหา:     %s\n", accountNo)
	fmt.Printf("ธนาคารย่อ:       %s\n", bankName)
	fmt.Printf("ชื่อผู้ถือบัญชี: %s\n", name)
}
```

---

### 5. แนวทางสถาปัตยกรรมและการจำกัดต้นทุน (Enterprise Integration Patterns)

เนื่องจาก API นี้อาจมี **ค่าบริการต่อคำขอ (Fee per Transaction)** และ **Rate Limit** จาก Gateway/ธนาคาร แนะนำให้วางมาตรการดังนี้:

1. **ดักกรองฟอร์แมตหน้าบ้าน (Regex Pre-filter):** ตรวจสอบความยาวเลขบัญชีและรูปแบบตัวเลขก่อนยิง API เพื่อหลีกเลี่ยงค่าใช้จ่ายจากข้อมูลผิดพลาด
2. **Caching (Redis / Memory Cache):**
   - Payout ที่โอนซ้ำหาบัญชีเดิม: cache ผลลัพธ์ **24 ชั่วโมง–7 วัน**
   - หน้า Checkout ที่กรอกเลขเดิมซ้ำ: cache ชั่วคราว **5–10 นาที** [cite: 241]
3. **Anti-Brute Force:** จำกัดการเรียกใช้งานต่อ IP (Rate Limiting) หรือใช้ Captcha บน Frontend ก่อนส่ง Request เข้าหลังบ้าน เพื่อป้องกันการสุ่มเดาเลขบัญชี (Data Scraping)
4. **Dual-Track Matching:** เมื่อใช้ร่วมกับ Inbound Transfer Matching ให้ normalize ชื่อก่อนบันทึก — ตัดช่องว่างและลบคำนำหน้า `"นาย/นาง/นางสาว"` — เพื่อให้จับคู่กับ Statement (เช่น KTB) ได้แม่นยำ [cite: 12]

---
