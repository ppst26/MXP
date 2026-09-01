**Create Signature** (การสร้างลายเซ็นดิจิทัล) ของระบบ **FLASH-PAY** และ **BIT-PAYZ** ใช้มาตรฐาน **HS256 JWT** สำหรับยืนยันความถูกต้องของทุกธุรกรรมทางการเงิน ครอบคลุมแนวคิดความปลอดภัย ขั้นตอนการสร้าง ตัวอย่างโค้ด Go/Node.js และ Utility API สำหรับทดสอบ [cite: 3, 4, 23, 60, 61, 93, 94]

ด้านล่างนี้คือสรุปรายละเอียด **Create Signature** สำหรับนำไปประยุกต์ใช้กับระบบ Enterprise SaaS:

---

### 1. วัตถุประสงค์และกลไกความปลอดภัย

ในการเชื่อมต่อกับ Payment Gateway ระบบบังคับให้ทุกธุรกรรมทางการเงิน (เช่น การสร้างยอดฝากและการสั่งโอนเงินออก) แนบลายเซ็นดิจิทัลเพื่อป้องกันภัยคุกคามหลัก 2 ประการ [cite: 3, 41, 75, 96, 120]:

1. **Data Tampering (การป้องกันการแก้ไขข้อมูลกลางทาง):** ป้องกันการดักจับและแก้ไขค่าพารามิเตอร์สำคัญ เช่น เลขบัญชีผู้รับเงิน หรือยอดเงิน (`amount`) [cite: 3, 41, 75, 96]
2. **Replay Attack (การป้องกันการทำธุรกรรมซ้ำซ้อน):** ป้องกันการนำ Request ที่สมบูรณ์แล้วมาส่งยิงซ้ำเพื่อดึงเครดิตออกจากระบบโดยมิชอบ [cite: 8, 46, 80, 101]

---

### 2. โครงสร้าง Signature (HS256 JWT)

ลายเซ็นดิจิทัลใช้มาตรฐาน **JSON Web Token (JWT)** ด้วยอัลกอริทึม **HS256 (HMAC-SHA256)** [cite: 4, 23, 61, 93, 94] โดยต้องมีข้อมูลนำเข้า (Inputs) 4 ส่วนและ Claims 3 ตัวดังนี้ [cite: 3, 41, 75, 96]:

**ตัวแปรหลัก (Core Ingredients):**

- **`YOUR_MERCHANT_ID`:** รหัสประจำตัวร้านค้า/องค์กร (Tenant ID) [cite: 3, 41, 75, 96]
- **`YOUR_CLIENT_ID`:** รหัสประจำไคลเอนต์ผู้เริ่มทำธุรกรรม [cite: 3, 41, 75, 96]
- **`YOUR_SECRET_KEY`:** กุญแจลับส่วนตัว (Private Key) **ต้องเก็บเป็นความลับและห้ามเปิดเผยต่อภายนอกเด็ดขาด** [cite: 3, 8, 41, 46, 75, 80, 96, 101]
- **`TIMESTAMP` (Milliseconds):** เวลาปัจจุบัน ณ ขณะสร้างลายเซ็น (เช่น `1728319408897`) เป็นตัวจำกัดอายุของโทเค็น [cite: 3, 8, 41, 46, 75, 80, 96, 101]

**Claims ภายใน JWT Payload:**

- **`merchantId`:** รหัสประจำตัวร้านค้า [cite: 3, 23, 60, 93]
- **`clientId`:** รหัสประจำระบบย่อยที่ส่งธุรกรรม [cite: 3, 23, 60, 93]
- **`iat` (Issued At):** Unix Timestamp **ในหน่วยมิลลิวินาที (ms) เท่านั้น** — ตัวเลข 13 หลัก (เช่น `1728319408897`) [cite: 3, 8, 23, 46, 60, 80, 93, 101]

---

### 3. ขั้นตอนการสร้าง Signature (Step-by-Step Algorithm)

1. **การประกอบ Payload (Prepare JSON Payload):**
   จัดโครงสร้าง JSON Object โดยใช้คีย์แบบ Case-Sensitive ดังนี้ [cite: 3, 41, 75, 96]:

   ```json
   {
     "merchantId": "YOUR_MERCHANT_ID",
     "clientId": "YOUR_CLIENT_ID",
     "iat": TIMESTAMP
   }
   ```

   > คีย์ **`iat`** ต้องเก็บค่า Timestamp เป็นตัวเลขจำนวนเต็มหลักมิลลิวินาที (ms) เสมอ [cite: 8, 46, 80, 101]

2. **การเข้ารหัสและสร้าง Signature (Sign Process):**
   นำ JSON Payload และ `Secret Key` เข้าสู่กระบวนการลงนามด้วย **HS256 (HMAC-SHA256)** ผลลัพธ์เป็นสตริง **JWT (JSON Web Token)** [cite: 4, 42, 76, 97]

---

### 4. ตัวอย่างโค้ดสร้าง Signature (Go / Node.js)

#### **Go (Golang) — Local Generation (Production Standard)**

ใน Production ควรเจน Signature บนหลังบ้านเอง โดยไม่ส่งกุญแจลับออกนอกระบบ [cite: 11, 68, 101]:

```go
package security

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateLocalSignature คำนวณและลงลายเซ็นดิจิทัลด้วย HS256
func GenerateLocalSignature(merchantID, clientID, secretKey string, timestampMs int64) (string, error) {
	claims := jwt.MapClaims{
		"merchantId": merchantID,
		"clientId":   clientID,
		"iat":        timestampMs, // บังคับหน่วย Unix Milliseconds (ms)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	signature, err := token.SignedString([]byte(secretKey))
	if err != nil {
		return "", fmt.Errorf("failed to sign token with secret key: %w", err)
	}

	return signature, nil
}

// GenerateGoSignature ตัวช่วยที่ดึง timestamp ปัจจุบันอัตโนมัติ
func GenerateGoSignature(merchantID, clientID, secretKey string) (string, int64, error) {
	timestampMs := time.Now().UnixMilli()
	signature, err := GenerateLocalSignature(merchantID, clientID, secretKey, timestampMs)
	if err != nil {
		return "", 0, err
	}
	return signature, timestampMs, nil
}
```

#### **Node.js (JavaScript with `jsonwebtoken`)** [cite: 4, 42, 76, 97]

```javascript
const jwt = require("jsonwebtoken");

function generateNodeSignature(merchantId, clientId, secretKey) {
  const timestamp = Date.now(); // ดึงเวลามิลลิวินาทีปัจจุบัน

  const payload = {
    merchantId: merchantId,
    clientId: clientId,
    iat: timestamp,
  };

  const signature = jwt.sign(payload, secretKey);
  return { signature, timestamp };
}
```

---

### 5. วิธีการนำ Signature ไปใช้กับ API Request

เมื่อสร้าง Signature สำเร็จแล้ว ในขั้นตอนยิงคำขอเปิดยอดฝาก (`POST /api/v1/deposit/create`) ต้องแนบลายเซ็นและ Timestamp ใน Request Body ดังนี้ [cite: 18, 35, 120]:

```json
{
  "clientId": "nHUxQbHgEu",
  "merchantId": "VOBM7qzaRH",
  "transactionId": "TX_SaaS_202608240001",
  "bankAccountNumber": "3140312345",
  "bankName": "BBL",
  "name": "ทดสอบ ทำรายการ",
  "amount": 1000,
  "callbackUrl": "https://your-domain.com/webhook",
  "type": "TRANSFER",
  "timeout": 15,
  "signature": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtZXJjaGFudElkIjoiVk9CTTdxemFSSCIsImNsaWVudElkIjoibkhVeFFiSGdFdSIsImlhdCI6MTcyODMxOTQwODg5N30.uWitsyCmb_TUHlK9_Od5416jJyGvc0OcaYI7oW6mkxU",
  "timestamp": 1728319408897
}
```

---

### 6. กฎเหล็กด้านความปลอดภัย (Rules of Engagement)

- **คีย์ Timestamp และ iat ต้องเป็นค่าเดียวกัน:** ตัวเลขในคีย์ `"timestamp"` ของ Request Body และค่า `"iat"` ที่ฝังอยู่ใน `"signature"` **ต้องตรงกันหลักต่อหลัก** หากไม่ตรงกัน Gateway จะปฏิเสธรายการทันที [cite: 8, 18, 19, 46, 56, 57, 80, 90, 91, 101, 111, 112]
- **Single-Use Only (ใช้ครั้งเดียว):** ลายเซ็นใช้ได้ครั้งเดียวต่อธุรกรรม เนื่องจาก Timestamp เปลี่ยนในแต่ละคำขอ ห้ามนำลายเซ็นเดิมมาส่งซ้ำ [cite: 8, 28, 46, 65, 80, 98, 101, 142, 183]
- **Backend Only Execution:** กระบวนการสร้างลายเซ็นร่วมกับ `Secret Key` **ต้องประมวลผลบน Server เท่านั้น** ห้ามเขียนตรรกะนี้ใน Frontend หรือ Mobile App [cite: 8, 46, 80, 101]

---

### 7. Utility API: POST Create Signature (UAT / Debug)

Gateway จัดเตรียม Endpoint สำหรับทดสอบความถูกต้องของการสร้างลายเซ็นในช่วงพัฒนา (UAT/Debug) **ไม่ควรใช้ใน Production** [cite: 10, 11, 49, 83, 104]:

- **HTTP Method:** `POST` [cite: 11, 49, 83, 104]
- **Request URL Endpoint:** `{{API_ENDPOINT}}/api/v1/jwt/create` [cite: 11, 49, 83, 104]

**Request Headers:**

```http
x-api-key: {{YOUR_API_KEY}}
Content-Type: application/json
```

**Request Body:**

```json
{
  "secretKey": "{{YOUR_SECRET_KEY}}",
  "timestamp": 1728319408897,
  "payload": {
    "merchantId": "{{YOUR_MERCHANT_ID}}",
    "clientId": "{{YOUR_CLIENT_ID}}"
  }
}
```

**Response Body (200 OK):**

```json
{
  "status": "success",
  "signature": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtZXJjaGFudElkIjoiVk9CTTdxemFSSCIsImNsaWVudElkIjoibkhVeFFiSGdFdSIsImlhdCI6MTcyODMxOTQwODg5N30.uWitsyCmb_TUHlK9_Od5416jJyGvc0OcaYI7oW6mkxU",
  "timestamp": 1728319408897
}
```

#### **ตัวอย่างคำขอด้วย cURL:**

```bash
curl --location -g '{{API_ENDPOINT}}/api/v1/jwt/create' \
--header 'x-api-key: {{API_KEY}}' \
--header 'Content-Type: application/json' \
--data '{
    "secretKey": "{{YOUR_SECRET_KEY}}",
    "timestamp": 1728319408897,
    "payload": {
        "merchantId": "{{YOUR_MERCHANT_ID}}",
        "clientId": "{{YOUR_CLIENT_ID}}"
    }
}'
```

---

### 8. Go HTTP Client สำหรับ Utility API (UAT / Debug)

โค้ด Go สำหรับยิง Utility API เพื่อขอรับลายเซ็นมาเปรียบเทียบค่าความถูกต้องในช่วงทดสอบ:

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type SignaturePayload struct {
	MerchantID string `json:"merchantId"`
	ClientID   string `json:"clientId"`
}

type SignatureReq struct {
	SecretKey string           `json:"secretKey"`
	Timestamp int64            `json:"timestamp"`
	Payload   SignaturePayload `json:"payload"`
}

type SignatureResp struct {
	Status    string `json:"status"`
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
}

type ClientUtils struct {
	APIEndpoint string
	APIKey      string
	HTTPClient  *http.Client
}

func NewClientUtils(endpoint, apiKey string) *ClientUtils {
	return &ClientUtils{
		APIEndpoint: endpoint,
		APIKey:      apiKey,
		HTTPClient: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
}

func (u *ClientUtils) RequestSignatureFromGateway(ctx context.Context, secretKey, merchantID, clientID string, timestamp int64) (*SignatureResp, error) {
	reqBody := SignatureReq{
		SecretKey: secretKey,
		Timestamp: timestamp,
		Payload: SignaturePayload{
			MerchantID: merchantID,
			ClientID:   clientID,
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request payload: %w", err)
	}

	reqURL := fmt.Sprintf("%s/api/v1/jwt/create", u.APIEndpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to build http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", u.APIKey)

	resp, err := u.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("connection to gateway failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gateway responded with http status code: %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response bytes: %w", err)
	}

	var sigResp SignatureResp
	if err := json.Unmarshal(bodyBytes, &sigResp); err != nil {
		return nil, fmt.Errorf("failed to decode json response: %w", err)
	}

	return &sigResp, nil
}

func main() {
	endpoint := "https://api.flash-pay.io"
	apiKey := "YOUR_API_KEY"
	secretKey := "YOUR_SECRET_KEY"
	merchantID := "VOBM7qzaRH"
	clientID := "nHUxQbHgEu"

	utils := NewClientUtils(endpoint, apiKey)
	currentTimeMs := time.Now().UnixMilli()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := utils.RequestSignatureFromGateway(ctx, secretKey, merchantID, clientID, currentTimeMs)
	if err != nil {
		fmt.Printf("❌ สร้างลายเซ็นผ่าน Utility API ล้มเหลว: %v\n", err)
		return
	}

	fmt.Println("=== ผลการดึงลายเซ็นดิจิทัลจากเกตเวย์ ===")
	fmt.Printf("สถานะการร้องขอ: %s\n", res.Status)
	fmt.Printf("ตัวแปรเวลา (ms): %d\n", res.Timestamp)
	fmt.Printf("คีย์ลายเซ็น (JWT):  %s\n", res.Signature)
}
```

---
