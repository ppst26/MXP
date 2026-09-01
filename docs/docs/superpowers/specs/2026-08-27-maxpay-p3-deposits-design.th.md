# Design: MaxPay P3 — การฝากเงิน, PromptPay QR และการจับคู่ statement

วันที่: 2026-08-27
สถานะ: อนุมัติ (design), รอตรวจ spec

> **คำแปล** — ฉบับภาษาอังกฤษที่ `2026-08-27-maxpay-p3-deposits-design.md`
> เป็นฉบับที่ยึดถือ และเป็นฉบับที่ implementer อ่าน ถ้าสองฉบับไม่ตรงกัน
> ให้ถือฉบับภาษาอังกฤษ ชื่อตาราง ชื่อคอลัมน์ ชื่อฟังก์ชัน คีย์ config
> และ SQL คงไว้เป็นภาษาอังกฤษตามมาตรฐานของโปรเจ็ค

## 1. เป้าหมาย

รับเงินเข้า P0–P2b สร้าง merchant, credential, พูลบัญชีธนาคารนิติบุคคล และ
ledger ที่บันทึกว่าเงินเป็นของใคร — แต่ไม่มีอันไหนขยับเงินได้เอง เฟสนี้คือ
เฟสแรกที่ขยับจริง

merchant ขอสร้างรายการฝาก ลูกค้าของเขาโอนเงินเข้าบัญชี KTB ของบริษัท เราเห็น
เงินเข้า เครดิตให้ merchant ใน ledger แล้วแจ้งกลับไป ทุกอย่างในนี้ลงบัญชีผ่าน
`ledger.Service.Post` ไม่มีใครทำบัญชีของตัวเองแยก

สัญญาอ้างอิงคือ PRD ใน `../MaxPay` โดยเฉพาะ
`PRD/technical-term/Deposit/CreateDeposit.md` (ฟิลด์ request และ response),
`PRD/technical-term/Deposit/Deposit.md` (ทั้งสองโฟลว์และ payload ของ webhook) และ
`PRD/technical-term/Deposit/Deposit Webhook Callback.md`

## 2. ขอบเขต

อยู่ในขอบเขต:

- `POST /deposit/create` ทั้งสองรูปแบบ คือ `QR` และ `TRANSFER`
- การสร้าง payload PromptPay EMVCo ที่ชี้ไปยังเลขนิติบุคคล
- การสุ่มเศษสตางค์ โดยกรณีชนกันจะปฏิเสธ ไม่ใช่เดา
- การดึง statement จาก KTB แล้วเก็บลงฐานข้อมูลทีละแถว
- เครื่องจับคู่ที่ fail closed เมื่อแถวหนึ่งเข้าได้หลายทาง
- การลงบัญชีสำหรับรายการที่จับคู่สำเร็จ และสำหรับเงินที่ไม่เข้ากับอะไรเลย
- การหมดอายุของรายการฝาก
- การส่ง webhook ให้ merchant พร้อม AES hash ที่ให้ merchant ตรวจสอบได้ —
  เหตุผลที่ย้ายออกจาก P5 อยู่ใน §9

ไม่อยู่ในขอบเขต:

| สิ่งที่ยังไม่มี | เฟส |
|---|---|
| `POST /payout/create` และการสั่งจ่ายผ่านธนาคาร | P4 |
| ประวัติการส่ง webhook, การยิงซ้ำด้วยมือ, การตั้งค่าปลายทางรายเจ้า | P5 |
| auto-sweep, การหมุนบัญชี, JIT top-up, การเตือนเงินสำรอง | P6 |
| หน้าจอรายการฝากใน back office | P7 |

สิ่งที่พิสูจน์ได้เมื่อ P3 เสร็จ: merchant เซ็นคำขอ `/deposit/create`, ได้ payload
PromptPay กลับไป, คนจริงสแกนด้วยแอปธนาคารแล้วจ่าย และภายในหนึ่งรอบการดึง
statement ยอดใน ledger ของ merchant ขยับ พร้อม webhook ที่เซ็นแล้วไปถึงปลายทาง

## 3. การตัดสินใจที่ทำไปแล้ว

| เรื่อง | ที่เลือก | เหตุผล |
|---|---|---|
| สถาปัตยกรรมการจับคู่ | แถว statement คือความจริง รายการฝากถูกจับ **เข้ากับ** แถว | เงินที่ไม่เข้ากับอะไรก็ยังมีอยู่จริงและต้องไปลงที่ไหนสักแห่ง การไล่จากฝั่งรายการฝากมองไม่เห็นมัน |
| แถวที่กำกวม | ไม่จับคู่ใคร ทำเครื่องหมายไว้ แจ้งเตือนคน | การเครดิตผิด merchant แก้คืนยากกว่าการให้ลูกค้ารอมาก |
| จังหวะการดึง | เร็วตอนมีรายการค้าง ช้าตลอดเวลาเป็นพื้น | ตัวช้าคือสิ่งที่ค้นพบเงินที่ไม่มีใครขอ ตัวเร็วคือสิ่งที่ทำให้การฝากรู้สึกทันที |
| เป้าหมายของ QR | เลขนิติบุคคล PromptPay 13 หลัก sub-tag `02` | บัญชีนิติบุคคลจดทะเบียน proxy ด้วยเลขผู้เสียภาษี ส่วนเลขบัญชีไม่ใช่เป้าหมายของ PromptPay |
| library ของ QR | สร้างในโปรเซสเอง ไม่พึ่งบริการโฮสต์ | การฝากเงินที่ต้องพึ่งความพร้อมใช้งานของคนอื่น คือ gateway ที่ล่มตามเขา |
| การสุ่มเศษสตางค์ | บวก 0.01–1.99 ไม่ลบ | รายการที่เครดิตเกินที่ขอไม่เคยเป็นเรื่องร้องเรียน ที่เครดิตขาดเป็นเสมอ |
| ยอดชนกัน | ฐานข้อมูลปฏิเสธด้วย partial unique index แล้วสุ่มใหม่ ครบแล้วปฏิเสธไปเลย | การออก QR ที่รู้อยู่แล้วว่าจะจับคู่ไม่ได้ แย่กว่าการไม่ออกให้ |
| webhook | ส่งใน P3 พร้อม hash | merchant ที่ต่อกับ webhook ที่ตรวจสอบไม่ได้ จะเก็บโค้ดนั้นไว้ต่อหลังเราเพิ่ม hash |

## 4. โครงสร้างข้อมูล

สอง package ใหม่: `internal/domain/deposit` และ `internal/domain/statement`
ทั้งคู่มีไฟล์มาตรฐานหกไฟล์ เงินเป็น `decimal.Decimal` ตลอด

สองตารางอ้างถึงกันและกัน — รายการฝากระบุแถวที่ทำให้มันสำเร็จ และ §7 กำหนดว่า
ทั้งคู่ต้องเปลี่ยนใน transaction เดียว migration จึงสร้าง `bank_statement_lines`
ก่อนแล้วค่อย `deposits` ซึ่งกลับด้านกับลำดับที่อธิบายข้างล่างนี้ — ลำดับการอ่าน
เดินตามเส้นทางของ merchant ส่วนลำดับการสร้างเดินตามการพึ่งพา

### 4.1 `deposits`

```sql
CREATE TABLE deposits (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id         UUID NOT NULL REFERENCES merchants(id),
    client_id           UUID NOT NULL REFERENCES merchant_clients(id),
    reference_id        TEXT NOT NULL UNIQUE,
    transaction_id      TEXT NOT NULL,
    type                TEXT NOT NULL,
    status              TEXT NOT NULL,
    bank_account_id     UUID NOT NULL REFERENCES bank_accounts(id),

    requested_amount    NUMERIC(20,4),
    deposit_amount      NUMERIC(20,4),

    customer_account_no TEXT NOT NULL,
    customer_bank_code  TEXT NOT NULL,
    customer_name       TEXT NOT NULL,
    customer_phone      TEXT,

    qr_payload          TEXT,
    callback_url        TEXT NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,

    matched_line_id     UUID REFERENCES bank_statement_lines(id),
    matched_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT deposits_type CHECK (type IN ('QR', 'TRANSFER')),
    CONSTRAINT deposits_status CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED')),

    -- รายการแบบ QR ถูกนิยามด้วยยอดที่ลูกค้าจะจ่าย ส่วนแบบ TRANSFER
    -- ยังไม่มียอดจนกว่าเงินจะมาถึง
    CONSTRAINT deposits_qr_has_amount CHECK (
        type <> 'QR' OR (requested_amount IS NOT NULL AND deposit_amount IS NOT NULL AND qr_payload IS NOT NULL)),

    -- รายการที่สำเร็จต้องระบุแถวที่ทำให้มันสำเร็จ และรายการที่ยังไม่สำเร็จ
    -- ต้องไม่ระบุ
    CONSTRAINT deposits_matched_when_completed CHECK (
        (status = 'COMPLETED') = (matched_line_id IS NOT NULL))
);

CREATE UNIQUE INDEX deposits_merchant_transaction
    ON deposits (merchant_id, transaction_id);

-- กฎที่ทำให้การจับคู่แบบ QR ไม่กำกวม บังคับโดยฐานข้อมูล ไม่ใช่โดยโค้ดที่สุ่มยอด:
-- บัญชีนิติบุคคลหนึ่งใบมีรายการค้างที่ยอดเศษสตางค์เดียวกันสองรายการไม่ได้
CREATE UNIQUE INDEX deposits_pending_amount
    ON deposits (bank_account_id, deposit_amount)
    WHERE status = 'PENDING' AND deposit_amount IS NOT NULL;

CREATE INDEX deposits_pending_expiry ON deposits (expires_at) WHERE status = 'PENDING';
CREATE INDEX deposits_merchant_created ON deposits (merchant_id, id DESC);
```

`reference_id` คือรหัสสิบตัวอักษรที่ตอบกลับไปให้ merchant และใช้สำหรับสอบถาม
สถานะย้อนหลัง สร้างด้วยวิธีเดียวกับ `merchants.code`

`transaction_id` คือเลขออเดอร์ของ merchant เอง ไม่ซ้ำ **ภายใน merchant รายนั้น**
ไม่ใช่ทั้งระบบ — merchant สองรายใช้เลขออเดอร์ชุดเดียวกันได้อย่างชอบธรรม

### 4.2 `bank_statement_lines`

```sql
CREATE TABLE bank_statement_lines (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
    fingerprint     TEXT NOT NULL,

    amount          NUMERIC(20,4) NOT NULL,
    direction       TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,

    counterparty_account TEXT,
    counterparty_bank    TEXT,
    counterparty_name    TEXT,

    raw             JSONB NOT NULL,

    match_status    TEXT NOT NULL DEFAULT 'UNMATCHED',
    matched_at      TIMESTAMPTZ,
    settled_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT statement_direction CHECK (direction IN ('CREDIT', 'DEBIT')),
    CONSTRAINT statement_match_status CHECK (
        match_status IN ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'SUSPENSE', 'IGNORED'))
);

-- แถวเดิมที่เห็นซ้ำต้องถูกรู้ว่าเป็นแถวเดิม ดู §6 ว่า fingerprint ประกอบจากอะไร
-- และทำไมยังตัดสินไม่ได้จนกว่าจะ capture response จริงได้
CREATE UNIQUE INDEX statement_lines_fingerprint
    ON bank_statement_lines (bank_account_id, fingerprint);

CREATE INDEX statement_lines_unmatched
    ON bank_statement_lines (bank_account_id, occurred_at)
    WHERE match_status = 'UNMATCHED';
```

`raw` เก็บ JSON ของธนาคารสำหรับแถวนั้นไว้ดิบๆ ราคาถูกและเป็นสิ่งเดียวที่ตอบได้ว่า
"ธนาคารบอกอะไรมาจริงๆ" เมื่อมีข้อพิพาท — เหตุผลเดียวกับที่ทำให้ P2b มี wire capture

ความหมายของ `match_status`:

| ค่า | ความหมาย |
|---|---|
| `UNMATCHED` | ยังไม่ระบุเจ้าของ ตัวจับคู่จะลองใหม่รอบหน้า |
| `MATCHED` | ระบุได้กับรายการฝากเดียว ซึ่งตอนนี้เป็น `COMPLETED` แล้ว |
| `AMBIGUOUS` | เข้าได้กับรายการค้างมากกว่าหนึ่ง ต้องให้คนตัดสิน |
| `SUSPENSE` | เลยเวลาแล้วยังจับคู่ไม่ได้ ลงบัญชีเข้า `HOUSE_SUSPENSE` |
| `IGNORED` | เป็นรายการเงินออก หรือเป็นเงินเข้าจากการโอนภายในของเราเอง |

## 5. การสร้าง PromptPay QR

`internal/service/deposit/promptpay.go` สร้างในโปรเซสเอง

payload คือ EMVCo TLV — แต่ละช่องคือ tag สองหลัก ความยาวสองหลัก แล้วค่า
ต่อกันไปเรื่อยๆ ปิดท้ายด้วย CRC ที่คลุมทุกอย่างรวมถึง tag และความยาวของตัวมันเอง

```text
000201                          payload format indicator
010212                          point of initiation: 12 = ใช้ครั้งเดียว มียอดกำกับ
2937                            ข้อมูลบัญชีผู้รับแบบ PromptPay
    0016A000000677010111        AID
    0213<เลขนิติบุคคล 13 หลัก>   sub-tag 02: เลขบัตรประชาชน / เลขผู้เสียภาษี
5303764                         สกุลเงิน THB
54<len><amount>                 ยอดเงิน ทศนิยมสองตำแหน่ง
5802TH                          ประเทศ
6304<CRC>                       CRC-16/CCITT-FALSE ตัวพิมพ์ใหญ่
```

`010212` ไม่ใช่เรื่องความสวยงาม `11` หมายถึง QR ที่สแกนซ้ำได้ ส่วน `12` หมายถึง
QR ที่มียอดกำกับและใช้ครั้งเดียว การใส่ `11` บน QR ที่มียอด คือการเชิญให้ลูกค้า
จ่ายสองครั้ง แล้วเงินก้อนที่สองจะจับคู่ไม่ได้

**รูปแบบของ PromptPay id เป็นตัวกำหนด sub-tag ฉะนั้นบังคับรูปแบบตอนบันทึก
แทนที่จะเดาตอนสร้าง** `bank_accounts.promptpay_id` รับได้สามรูปแบบเท่านั้น:
10 หลักขึ้นต้นด้วย `0` (เบอร์มือถือ ส่งเป็น sub-tag `01` โดยแปลงเป็น `0066`
ตามด้วยเก้าหลักท้าย), 13 หลัก (เลขบัตรประชาชนหรือเลขผู้เสียภาษี sub-tag `02`
ส่งดิบ), หรือ 15 หลัก (e-wallet, sub-tag `03`) ความยาวจึงตัดสินได้เองโดยไม่ต้อง
เดาอะไร P3 ใช้เลขนิติบุคคล 13 หลัก อีกสองแบบมี validator แต่ยังไม่ได้ใช้

### การตรวจสอบสามชั้น

1. **CRC เทียบกับ test vector ที่ EMVCo เผยแพร่** พิสูจน์อัลกอริทึม checksum
   ซึ่งเป็นจุดเดียวที่ผิดหนึ่งบิตแล้ว QR ทุกใบในระบบสแกนไม่ขึ้น อย่างเงียบๆ
   และไปล้มในมือลูกค้า
2. **อ่านกลับ** ตัวอ่าน TLV อ่าน payload ที่เราสร้างเอง แล้วต้องได้เลขนิติบุคคลเดิม
   ยอดเดิม sub-tag เดิม จับได้ทั้ง tag ผิด ความยาวผิด และลำดับผิด — ซึ่ง CRC
   ไม่รู้สึกเลยสักอย่าง
3. **สแกนจริงหนึ่งครั้ง ก่อนเปิดใช้ฟีเจอร์** สองชั้นแรกพิสูจน์ว่าเราทำตามที่เรา
   เข้าใจ มีแต่แอปธนาคารที่พิสูจน์ว่าเราเข้าใจถูก นี่คือประตูเดียวกับที่ P2b
   เรียนรู้ว่าต้องมีสำหรับ `ParseBankBalance` และไม่ใช่ทางเลือก

**payload ตัวอย่างใน PRD ใช้เป็น test vector ไม่ได้** สตริงของมันระบุยอด `1.54`
(`54041.54`) ขณะที่ฟิลด์ `depositAmount` ของมันเองเขียนว่า `99.54` มันขัดกันเอง
และห้ามใช้ตรวจตัวสร้าง ส่วนการแปลงเบอร์มือถือของมัน — `0955157457` เป็น
`0066955157457` — สอดคล้องกันดีและยืนยันกฎข้อนั้น

### การสุ่มยอด

ยอดที่ merchant ขอ บวกค่าสุ่ม 0.01 ถึง 1.99 PRD เขียนว่า ±1.99 แต่ดีไซน์นี้บวก
อย่างเดียว ด้วยเหตุผลว่าลูกค้าที่จ่ายเกินออเดอร์เล็กน้อยแล้วได้เครดิตเท่าที่จ่าย
ไม่มีอะไรให้โต้แย้ง ส่วนคนที่ได้เครดิตน้อยกว่ามี นั่นทำให้พื้นที่ค่าลดจาก 398
เหลือ 199 ต่อยอดหนึ่งยอด ซึ่งเป็นเหตุผลเดียวที่จะกลับมาทบทวน: ถ้า
`pool.satang_retries` เริ่มหมดบ่อยในการใช้งานจริง การขยายเป็น ± คือคันโยกแรก
และเป็นการแก้ที่ฟังก์ชันเดียว

ยอดที่สุ่มได้จะถูกยื่นให้ฐานข้อมูล `deposits_pending_amount` เป็นคนรับหรือปฏิเสธ
ถ้าถูกปฏิเสธ service จะลองใหม่จนครบ `pool.satang_retries` (ค่าเริ่มต้น 5) แล้ว
ปฏิเสธรายการนั้นด้วย `409` การปฏิเสธเป็นความตั้งใจ: QR ที่ออกไปทั้งที่รู้ว่าชน
จะสร้างการจ่ายเงินที่เราตัดสินไปแล้วว่าระบุเจ้าของไม่ได้

## 6. การดึง statement

`GET /v1/transaction-history/accounts/{accountRefId}` เป็นแหล่ง statement
แหล่งเดียว และมันกำหนดรูปร่างของดีไซน์นี้สองทาง

**มันใช้ `accountRefId` เป็นกุญแจ** ซึ่งเป็นตัวระบุที่ธนาคารไม่ปิดบัง และ P2b
เก็บไว้ที่ `bank_accounts.account_ref_id` แล้วด้วยเหตุผลประเภทเดียวกันนี้เอง
บัญชีที่ไม่มีค่านี้ดึง statement ไม่ได้ เช่นเดียวกับที่รีเฟรชยอดไม่ได้

**มันไม่มีตัวกรองวันที่** มีแค่ `pageSize`, `pageNumber` และการเรียงจากใหม่ไปเก่า
การดึงจึงอ่านหน้าแรก แล้วเดินย้อนไปเรื่อยๆ ตราบใดที่ยังเจอแถวที่ไม่เคยเก็บ
แล้วหยุดที่หน้าแรกที่รู้จักทั้งหน้า แถวที่ "รู้จัก" คือแถวที่ fingerprint ตรง

### fingerprint ยังไม่ตัดสิน และตั้งใจไม่ตัดสิน

การกันซ้ำต้องมีค่าที่ระบุตัวแถวและไม่เปลี่ยนระหว่างการดึงแต่ละรอบ PRD เสนอ
`checkStr` หน้าตาแบบ `2024-10-08,02:29:21,200,004,13xxxxxxx1` — แต่นั่นมาจาก
webhook ของคู่แข่ง ไม่ใช่จาก KTB และ **ยังไม่เคยมีใคร capture response จริงของ
KTB เลยสักครั้ง**

P2b ใช้เวลาทั้ง task หนึ่งค้นพบว่ารูปแบบ response ที่เดาไว้ผิดทุกจุด: ผิด endpoint
ผิดชื่อฟิลด์ ผิดชนิดข้อมูล และกุญแจจับคู่ถูกปิดบัง นั่นไม่ใช่โชคร้าย แต่เป็นราคา
ของการเดารูปแบบ response ของธนาคาร

spec ฉบับนี้จึงกำหนด **รูปร่าง** ของทางออกไว้ และปฏิเสธที่จะกำหนดเนื้อใน:

- `Fingerprint(raw json.RawMessage) (string, error)` เป็นฟังก์ชันเดียว ขับด้วย
  fixture ที่ capture จากธนาคารจริง
- มันคืน error ไม่ใช่ค่าสำรอง แถวที่คำนวณ fingerprint ไม่ได้คือแถวที่ห้ามเก็บ
  เพราะการเก็บด้วยกุญแจที่เดาเอา แปลว่าอาจได้เครดิตซ้ำหรือพลาดไปเลย
- **ต้อง capture response จริงก่อนเขียนฟังก์ชันนี้** `ktb.capture_path` มีอยู่แล้ว
  และมี device ที่ลงทะเบียนแล้ว

กฎเดียวกันนี้ใช้กับทุกฟิลด์ที่ตัวดึงแยกออกมา — ยอด ทิศทาง เวลา คู่กรณี แต่ละตัว
อ่านด้วย parser ตัวเดียวเทียบกับ fixture ตัวเดียว

**คาดว่าเลขบัญชีคู่กรณีจะถูกปิดบัง** ตัวอย่างใน PRD เองแสดงเป็น `13xxxxxxx1`
ถ้า KTB ปิดบังด้วย การจับคู่แบบ `TRANSFER` จะเทียบกับเลขบัญชีเต็มที่ลูกค้ากรอกไม่ได้
ต้องเทียบเฉพาะหลักที่เปิดเผย ซึ่งอ่อนกว่าการเทียบเท่ากันตรงๆ — และนั่นคือเหตุผลที่
§7 กำหนดให้ยอดและกรอบเวลาต้องตรงด้วย และเหตุผลที่ผลลัพธ์กำกวมต้องปฏิเสธ ไม่ใช่เลือก

### จังหวะการดึง

สองระดับ ขับด้วย outbox worker ที่มีอยู่แล้ว:

| ระดับ | ความถี่ | ครอบคลุม |
|---|---|---|
| Active | `deposit.poll_interval_active` (ค่าเริ่มต้น 10s) | บัญชีที่มีรายการฝากค้างอย่างน้อยหนึ่งรายการ |
| Floor | `deposit.poll_interval_floor` (ค่าเริ่มต้น 3m) | ทุกบัญชี INBOUND ที่ `ACTIVE` ตลอดเวลา |

ตัว floor ไม่ใช่ตัวสำรอง มันคือสิ่งที่ค้นพบเงินที่เข้ามาโดยไม่มีรายการฝากรองรับ —
การจ่ายเกิน ลูกค้าที่จ่าย QR ที่หมดอายุแล้ว การโอนที่ไม่มีใครแจ้ง ถ้าไม่มีมัน
เงินพวกนี้ไม่เคยเข้าบัญชีเลย

แต่ละระดับสร้างงานหนึ่งงานต่อหนึ่งบัญชี และงานเหล่านั้น idempotent: ดึงหน้าเดิม
สองครั้งก็ไม่ได้เก็บอะไรใหม่ เพราะ index ของ fingerprint ปฏิเสธ

## 7. เครื่องจับคู่

ทำงานหลังการดึงแต่ละรอบ ไล่แถวเงินเข้าที่ยัง `UNMATCHED` ของบัญชีนั้น จากเก่าไปใหม่

สำหรับหนึ่งแถว รายการฝากที่เข้าข่ายคือรายการที่ `PENDING`, อยู่บน
`bank_account_id` เดียวกัน, มี `expires_at` ตั้งแต่ `occurred_at` ของแถวเป็นต้นไป
และ:

- **QR** — `deposit_amount` เท่ากับยอดของแถวพอดี
- **TRANSFER** — เลขบัญชีของลูกค้าสอดคล้องกับคู่กรณีของแถวภายใต้กฎการปิดบังใน §6
  และยอดของแถวอยู่ในกรอบที่ merchant ประกาศไว้ถ้ามี

แล้วนี่คือทั้งหมดของเครื่องจับคู่:

| จำนวนที่เข้าข่าย | ผลลัพธ์ |
|---|---|
| หนึ่งเดียว | แถวเป็น `MATCHED` รายการเป็น `COMPLETED` ลงบัญชี และคิว webhook |
| มากกว่าหนึ่ง | แถวเป็น `AMBIGUOUS` **ไม่มีอะไรอื่นเปลี่ยน** และแจ้งเตือน |
| ไม่มีเลย | แถวยัง `UNMATCHED` แล้วลองใหม่รอบหน้า |

แถวที่ยัง `UNMATCHED` เกิน `deposit.suspense_after` (ค่าเริ่มต้น 24 ชั่วโมง) จะถูก
ลงบัญชีเข้า `HOUSE_SUSPENSE` และทำเครื่องหมายเป็น `SUSPENSE` มันไม่ถูกลบและ
ไม่ถูกซ่อน คนยังระบุเจ้าของให้มันได้ และการทำแบบนั้นคือการกลับรายการแล้วลงใหม่
ไม่ใช่การแก้ตัวเลข

**ทุกอย่างที่ตัวจับคู่ทำ อยู่ใน transaction เดียว** — สถานะแถว สถานะรายการฝาก
รายการใน ledger และงาน webhook merchant ได้เครดิตแล้วถูกแจ้ง หรือไม่มีอะไรเกิดขึ้น
เลย ไม่มีระหว่างกลาง การ enqueue แบบอยู่ใน transaction ของ outbox มีไว้เพื่อสิ่งนี้

ตัวจับคู่ยังเล่นซ้ำได้ มันอ่านแถวกับรายการฝากแล้วเขียนการระบุเจ้าของ ไม่เคยถาม
ธนาคารอะไรเลย บั๊กในการจับคู่จึงแก้ด้วยการแก้ตัวจับคู่แล้วรันใหม่ ไม่ใช่ดึงใหม่

## 8. การลงบัญชี

ไม่มีอะไรใหม่ constructor ของ P2b ครอบคลุมทุกกรณีที่นี่แล้ว

| เหตุการณ์ | การลงบัญชี |
|---|---|
| สร้างรายการฝาก | ไม่มี — เงินยังไม่ขยับ |
| จับคู่สำเร็จ | `PostDepositMatched`: `DR bank_account / CR merchant:operate` ยอดสุทธิ พร้อมบรรทัด rebate และ house |
| รายการหมดอายุ | ไม่มี |
| แถวเลยเวลาเข้า suspense | `PostUnmatchedIn`: `DR bank_account / CR house_suspense` |
| แถวใน suspense ถูกระบุเจ้าของภายหลัง | กลับรายการ suspense แล้วค่อย `PostDepositMatched` |

แถวสุดท้ายคือเหตุผลที่ `SUSPENSE` เป็นสถานะ ไม่ใช่การลบทิ้ง

## 9. Webhook

spec ของ P1+P2 วาง webhook dispatcher ไว้ที่ P5 ดีไซน์นี้ย้ายการส่ง — และเฉพาะ
การส่ง — มาไว้ที่ P3 ด้วยเหตุผลสามข้อ

รายการฝากที่สำเร็จโดยไม่ได้บอก merchant จากมุมของ merchant ก็เท่ากับไม่เคยเกิดขึ้น
P3 ที่ไม่มีการส่งจึงไม่ใช่เฟสที่ใช้งานได้ กลไก retry ที่ P5 จะสร้างนั้นมีอยู่แล้วใน
outbox worker ของ P2a: จำนวนครั้ง การถอยแบบทวีคูณ และการฝังหลังครบ
`outbox.max_attempts` และ merchant ที่ต่อกับ webhook ที่ตรวจสอบไม่ได้ จะเขียนโค้ด
ที่ไม่ตรวจสอบ แล้วเก็บโค้ดนั้นไว้หลังจากเราเพิ่ม hash ทีหลัง — ช่องโหว่นั้นไม่ได้
ปิดด้วยการเพิ่มฟิลด์

P5 ยังเก็บประวัติการส่ง การยิงซ้ำด้วยมือ inquiry API และการตั้งค่าปลายทางรายเจ้า
ทั้งหมดนั้นเป็นงานจริงและยังจำเป็น

payload เดินตาม PRD ทุกตัวอักษร รวมถึง `hash`: AES-256 ของ `transactionId`
โดยใช้กุญแจจาก `API_KEY + SECRET_KEY` ต่อกัน merchant จึงถอดรหัสได้ด้วย
credential ที่มีแต่เขากับเราถืออยู่

การส่งเป็นงาน outbox ชนิด `deliver_deposit_webhook` การตอบที่ไม่ใช่ 2xx จะคืน
error แล้ว backoff ของ worker เป็นคนตัดสินว่าจะลองใหม่เมื่อไร `callback_url`
ต้องเป็น HTTPS ตรวจตอนสร้างรายการ ไม่ใช่ตอนส่ง

## 10. HTTP

ฝั่ง merchant ใช้ `x-api-key` บวกลายเซ็น HS256 แบบใช้ครั้งเดียวในจุดที่มีเงินเกี่ยวข้อง:

```text
POST /api/v1/deposit/create
GET  /api/v1/deposit/:reference_id
GET  /api/v1/deposits
```

ฝั่ง back office ใช้ session:

```text
GET  /api/v1/admin/statement-lines
POST /api/v1/admin/statement-lines/:id/attribute
GET  /api/v1/admin/deposits
```

`attribute` คือวิธีที่คนแก้แถวที่เป็น `AMBIGUOUS` หรือ `SUSPENSE` เฉพาะ platform
administrator เท่านั้น — reseller อ่านรายการฝากใน subtree ของตัวเองได้ แต่การระบุ
เจ้าของเงินเป็นการกระทำของแพลตฟอร์ม เป็นเส้นแบ่งเดียวกับที่ P2b ขีดไว้ระหว่างการ
อ่าน ledger กับการปรับปรุงยอด

ฟิลด์ request และ response ของ `/deposit/create` เดินตาม
`PRD/technical-term/Deposit/CreateDeposit.md` ทุกประการ รวมถึงรูปของ
`data.referenceId`, `data.depositAmount`, `data.qrcode`, `data.expireDate` และ
`data.customerData` เพื่อให้ merchant ที่ต่อกับ PRD ไว้แล้วไม่ต้องแก้อะไร

ทุก endpoint ใหม่มีไฟล์ `.bru` กำกับ

## 11. Configuration

```yaml
deposit:
  poll_interval_active: 10s
  poll_interval_floor: 3m
  suspense_after: 24h
  min_timeout: 5m
  max_timeout: 60m
  qr_enabled: false        # ปิดไว้จนกว่าจะมีการสแกนจริงสำเร็จหนึ่งครั้ง
```

`qr_enabled` เริ่มต้นเป็น false ด้วยเหตุผลเดียวกับ `pool.balance_refresh_enabled`:
ตัวสร้างที่ยังไม่เคยถูกแอปธนาคารจริงสแกน คือตัวที่ยังไม่รู้ว่าใช้ได้ และ QR ที่
สแกนไม่ขึ้นจะไปล้มในมือลูกค้า ไม่ใช่ในมือเรา

## 12. สัญญาเรื่องข้อผิดพลาด

ไม่ต่างจาก P1 การปฏิเสธที่ส่งถึง merchant เป็น 4xx ที่ห่อ sentinel ร่วม ส่วนการ
ปฏิเสธจากธนาคารเป็น `502` ที่พาสถานะและรหัสของธนาคารมาด้วยแต่ไม่เคยพา body มา
กรณีใหม่:

| กรณี | สถานะ |
|---|---|
| `transactionId` นี้ merchant รายนี้เคยใช้แล้ว | 200 พร้อมรายการเดิม — เป็น idempotent ไม่ใช่ข้อผิดพลาด |
| ยอดชนกันจนครบ `satang_retries` | 409 |
| ไม่มีบัญชี INBOUND ที่ให้บริการ merchant รายนี้ได้ | 503 |
| `callbackUrl` ไม่ใช่ HTTPS | 400 |
| `timeout` อยู่นอกช่วง `min_timeout`..`max_timeout` | 400 |

## 13. การทดสอบ

unit test สำหรับ validator ของ domain, พฤติกรรมของ service และ repository ด้วย
`sqlmock` ตามมาตรฐาน นอกจากนั้นมีสี่อย่างที่เฟสนี้เชื่อถือไม่ได้ถ้าขาดไป:

1. **ตัวสร้าง QR เทียบกับ test vector ที่ EMVCo เผยแพร่** บวกเทสต์อ่านกลับ
   บวกบันทึกการสแกนจริง
2. **fingerprint และ parser ของแถว เทียบกับ response ของ KTB ที่ capture มาจริง**
   ไม่ใช่ fixture ที่เขียนด้วยมือ — ต้องเป็นของจริง ถ้ายังไม่มี ก็ยังไม่เขียน parser
3. **ผลลัพธ์สามทางของตัวจับคู่** แต่ละทางต้องมีเทสต์ที่ล้มเมื่อผลลัพธ์นั้นถูกเปลี่ยน:
   เข้าข่ายหนึ่งเดียวต้องเครดิตให้ merchant เดียว, เข้าข่ายสองต้องไม่เครดิตให้ใคร,
   ไม่เข้าข่ายเลยต้องไม่แตะแถวนั้น
4. **ความ idempotent ของการดึง เทียบกับฐานข้อมูลจริง** ดึงหน้าเดิมสองครั้งต้องไม่
   เก็บอะไรในครั้งที่สอง และนั่นเป็นคำสัญญาของ unique index ไม่ใช่ของโค้ด Go

harness สำหรับ integration ที่ใช้ `-tags=integration` กับ `-race -p 1` มีอยู่แล้ว

## 14. เกณฑ์การตรวจรับ

`make check` แล้ว `make test-integration` แล้วอัปเดต Bruno collection ให้ครบทุก
endpoint ใหม่ แล้ว — ก่อนเปิด `qr_enabled` ที่ไหนก็ตาม — ต้องมีคนสแกน QR ที่ระบบ
สร้างด้วยแอปธนาคารจริง แล้วเห็นผู้รับและยอดเงินที่ถูกต้อง

## 15. งานที่ตามมา

- กฎเรื่องการปิดบังเลขบัญชีคู่กรณีสรุปไม่ได้จนกว่าจะมีแถว statement จริงอยู่ในมือ
  ถ้า KTB ปิดบังหนักกว่าที่ PRD บอกใบ้ การจับคู่แบบ `TRANSFER` อาจต้องให้ merchant
  ประกาศยอดที่คาดไว้ ซึ่งเป็นการเปลี่ยนสัญญาและควรมีการตัดสินใจของตัวเอง
- แถว statement สะสมไปเรื่อยๆ ไม่มีขอบเขต นโยบายการเก็บต้องมาจากการวัด
  ไม่ใช่การเดาตอนนี้
- `deposit.poll_interval_active` ที่ 10 วินาที เป็นจุดตั้งต้นที่เลือกเพื่อความรู้สึกทันใจ
  ไม่ได้มาจากการวัดความอดทนของ KTB ควรขยับขึ้นทันทีที่มีสัญญาณว่าถูกจำกัด และ
  wire capture คือทางที่จะเห็นสัญญาณนั้น
