# MaxPay P3a — Deposit Creation and PromptPay QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant create a deposit and receive a PromptPay QR payload that a real banking app can scan and pay.

**Architecture:** A deposit is a row with a status, an expiry and — for `QR` — a randomised satang amount that must be unique among the pending deposits on its corporate bank account. Uniqueness is enforced by a partial unique index rather than by the code that generates the amount; the service offers an amount, the database accepts or refuses it, and the service retries down the list of candidate accounts that P2a's inbound router already returns. The PromptPay payload is EMVCo TLV built in-process, with no external service in the request path.

**Tech Stack:** Go 1.25 · PostgreSQL 18 · Gin · sqlx + Masterminds/squirrel · uber/fx · Zap · shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-27-maxpay-p3-deposits-design.md` (Thai translation alongside it; the English document is authoritative). Sections 4.1, 5, 10, 11, 12, 13, 14. Read the spec with this plan.

**Scope boundary — what this plan deliberately does NOT build:** statement ingestion, the fingerprint, the matching engine, ledger postings and webhook delivery. Those are P3b, which is blocked until a real KTB statement response has been captured. A deposit created here reaches `COMPLETED` only once P3b exists; in P3a it is created, it can be read, and it expires.

## Global Constraints

- Money is `decimal.Decimal`, never `float64`, on every path including intermediates. Amounts cross JSON as **strings** rendered with `StringFixed(2)`; `decimal.Decimal.String()` trims trailing zeros and turns `0.10` into `"0.1"`.
- Every monetary column is `NUMERIC(20,4)`. `ledger.ValidateLines` refuses more than two decimal places, so no amount produced here may carry more.
- Every id is a **UUIDv7**. Validator tags use `uuid`, never `uuid4` — `uuid4` rejects every real id in this system and that bug has shipped here once already.
- Log fields are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`; service log lines carry `trace_id` from `shared.TraceIDFromContext(ctx)`.
- Errors wrap the sentinels in `internal/shared/errs` and map to HTTP status through `resp`. Raw internal text never reaches a caller.
- Clean Architecture: `internal/domain` imports no adapter and no service package.
- `repository/base` supplies timeouts and `CheckRowsAffectedWith`; `repository/tx`'s `TransactionHelper.WithTx` is how a multi-write use case gets a transaction.
- Mappers follow `XToModel` / `XToDomain` / `XsToDomain` in `internal/adapter/persistence/mapper`.
- Every new endpoint ships a matching `.bru` file under `bruno/`.
- Code, identifiers, comments and docstrings in English only. `gofmt` clean.
- The gate is `make check` then `make test-integration`.

## Environment notes for every implementer

- `export PATH="$PATH:$HOME/go/bin"` before Go tooling — `golangci-lint` lives there.
- A PostgreSQL container is already running. **Never run `make docker-up`** from a worktree: compose derives its project name from the directory and would start a second stack. `make migrate-up` applies migrations.
- Integration tests run against `maxpay_test` via `TEST_DATABASE_URL`; `make test-integration` runs with `-race -p 1` deliberately. **Never truncate or drop anything in the `maxpay` development database** — it holds a bank device registered against a live corporate banking login that cannot be recreated without sending the account holder another OTP.
- `internal/testutil/pgtest.DB(t)` returns a handle and skips when `TEST_DATABASE_URL` is unset; `pgtest.Truncate(t, db, ...)` empties named tables.

---

## Interfaces this plan consumes

These exist and are current. Read them before writing against them.

```go
// internal/domain/bankaccount — P2a's inbound router.
// SelectInbound returns EVERY candidate account, least loaded first,
// specifically so a caller can retry down the list when an amount collides.
SelectInbound(ctx context.Context, q InboundQuery) ([]*Account, error)
func InboundQueryFor(m *merchant.Merchant, now time.Time) InboundQuery
var ErrNoAccountAvailable // returned when the list would be empty

// internal/domain/signature — P1
Verify(ctx context.Context, merchantID uuid.UUID, in VerifyInput) error
type VerifyInput struct {
    Token, SecretKey, MerchantCode, ClientCode, CredentialMerchantCode string
    BodyTimestampMS int64
}

// internal/domain/idempotency — P1
Begin(ctx context.Context, merchantID uuid.UUID, transactionID string, body []byte) (*Replay, error)
Finish(ctx context.Context, merchantID uuid.UUID, transactionID string, code int, body []byte) error
type Replay struct { IsReplay bool; Code int; Body []byte }

// internal/adapter/http/routing — MerchantGroup was added in P2b
func MerchantGroup(r *gin.Engine, creds credential.Service, merchants merchant.Service) *gin.RouterGroup

// internal/shared/crypto
func RandomCode(n int) (string, error)   // base62, cryptographic source

// internal/service/outbox — the worker; P3a registers one new job kind
func (w *Worker) Register(kind string, h domainoutbox.Handler)
```

## File Structure

| File | Responsibility |
|---|---|
| `internal/service/deposit/promptpay.go` | EMVCo TLV encode, CRC-16, PromptPay payload |
| `internal/service/deposit/promptpay_parse.go` | TLV decode — used only by tests and by the admin tooling that verifies a payload |
| `db/migrations/000010_deposits.up.sql` / `.down.sql` | the `deposits` table and its indexes |
| `internal/domain/deposit/{entity,dto,errors,validator,repository,service}.go` | the deposit domain |
| `internal/adapter/persistence/model/deposit.go`, `mapper/deposit.go` | row struct and mappers |
| `internal/adapter/repository/deposit/repository.go` | insert with collision detection, reads, the expiry sweep |
| `internal/service/deposit/service.go` | `Create`, `GetByReference`, `List` |
| `internal/service/deposit/expiry.go` | the outbox handler that expires overdue deposits |
| `internal/adapter/http/merchantdeposit/{handler,handlers,routes,dto}.go` | the three merchant endpoints |
| `bruno/Deposit/*.bru` | one per endpoint |

`promptpay.go` is separate from `service.go` because it is a pure function of its inputs with no database and no clock, and it is the piece most likely to be read by someone who does not care about deposits at all.

---

### Task 1: The PromptPay payload generator

This is first because it is the riskiest thing in the plan and it needs nothing else. A CRC that is wrong by one bit produces a QR that fails silently, in a customer's hand, every single time.

**Files:**
- Create: `internal/service/deposit/promptpay.go`
- Create: `internal/service/deposit/promptpay_parse.go`
- Test: `internal/service/deposit/promptpay_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `func PromptPayPayload(promptPayID string, amount decimal.Decimal) (string, error)`
  - `func ParseTLV(payload string) (map[string]string, error)`
  - `func CRC16(s string) string`
  - `var ErrPromptPayIDFormat`, `var ErrPayloadMalformed`

- [ ] **Step 1: Write the failing tests**

`internal/service/deposit/promptpay_test.go`:

```go
package deposit_test

import (
	"strings"
	"testing"

	depositsvc "be-maxpay/internal/service/deposit"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// CRC-16/CCITT-FALSE has published check values. "123456789" is the standard
// check string for every CRC variant, and CCITT-FALSE gives 0x29B1. Pinning it
// here means the algorithm is verified independently of any payload we build.
func TestCRC16_MatchesThePublishedCheckValue(t *testing.T) {
	assert.Equal(t, "29B1", depositsvc.CRC16("123456789"))
}

func TestPromptPayPayload_BuildsTheDocumentedStructure(t *testing.T) {
	payload, err := depositsvc.PromptPayPayload("1234567890123", decimal.RequireFromString("500.35"))
	require.NoError(t, err)

	fields, err := depositsvc.ParseTLV(payload)
	require.NoError(t, err)

	assert.Equal(t, "01", fields["00"], "payload format indicator")
	// 12 is single-use. 11 would let a customer pay an amount-bearing QR
	// twice, and the second payment would match nothing.
	assert.Equal(t, "12", fields["01"], "point of initiation must be dynamic")
	assert.Equal(t, "764", fields["53"], "currency must be THB")
	assert.Equal(t, "500.35", fields["54"], "amount")
	assert.Equal(t, "TH", fields["58"], "country")

	merchant, err := depositsvc.ParseTLV(fields["29"])
	require.NoError(t, err)
	assert.Equal(t, "A000000677010111", merchant["00"], "PromptPay AID")
	assert.Equal(t, "1234567890123", merchant["02"], "a 13-digit id is sub-tag 02, sent verbatim")
	assert.NotContains(t, merchant, "01", "a tax id must not be emitted as a mobile number")
}

// A 10-digit mobile becomes 0066 plus its last nine digits. This rule is the
// one thing the PRD's own sample payload confirms: 0955157457 appears there as
// 0066955157457.
func TestPromptPayPayload_RewritesAMobileNumber(t *testing.T) {
	payload, err := depositsvc.PromptPayPayload("0955157457", decimal.RequireFromString("1.00"))
	require.NoError(t, err)

	fields, err := depositsvc.ParseTLV(payload)
	require.NoError(t, err)

	merchant, err := depositsvc.ParseTLV(fields["29"])
	require.NoError(t, err)
	assert.Equal(t, "0066955157457", merchant["01"])
	assert.NotContains(t, merchant, "02")
}

func TestPromptPayPayload_RoundTripsEveryField(t *testing.T) {
	const id = "1234567890123"

	payload, err := depositsvc.PromptPayPayload(id, decimal.RequireFromString("1234.05"))
	require.NoError(t, err)

	fields, err := depositsvc.ParseTLV(payload)
	require.NoError(t, err)

	// The CRC covers everything before it INCLUDING its own tag and length.
	body := payload[:len(payload)-4]
	assert.Equal(t, depositsvc.CRC16(body), fields["63"],
		"the checksum must cover the payload up to and including \"6304\"")
}

func TestPromptPayPayload_RefusesAnIDItCannotClassify(t *testing.T) {
	for name, id := range map[string]string{
		"eleven digits":  "12345678901",
		"twelve digits":  "123456789012",
		"nine digits":    "123456789",
		"has a letter":   "12345678901A",
		"empty":          "",
		"mobile without leading zero": "9551574571",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := depositsvc.PromptPayPayload(id, decimal.RequireFromString("1.00"))
			assert.ErrorIs(t, err, depositsvc.ErrPromptPayIDFormat)
		})
	}
}

// Two decimal places always, because ledger.ValidateLines refuses more and
// because a bank app renders what it is given.
func TestPromptPayPayload_AmountAlwaysCarriesTwoDecimals(t *testing.T) {
	cases := map[string]string{"500": "500.00", "0.1": "0.10", "1234.5": "1234.50"}

	for in, want := range cases {
		payload, err := depositsvc.PromptPayPayload("1234567890123", decimal.RequireFromString(in))
		require.NoError(t, err)

		fields, err := depositsvc.ParseTLV(payload)
		require.NoError(t, err)
		assert.Equal(t, want, fields["54"], "input %s", in)
	}
}

func TestPromptPayPayload_RefusesANonPositiveAmount(t *testing.T) {
	for _, amount := range []string{"0", "-1.00"} {
		_, err := depositsvc.PromptPayPayload("1234567890123", decimal.RequireFromString(amount))
		assert.Error(t, err, "amount %s", amount)
	}
}

func TestParseTLV_RefusesATruncatedField(t *testing.T) {
	// Declares a length of 10 but supplies four characters.
	_, err := depositsvc.ParseTLV("0010ABCD")
	assert.ErrorIs(t, err, depositsvc.ErrPayloadMalformed)
}

func TestParseTLV_RefusesANonNumericLength(t *testing.T) {
	_, err := depositsvc.ParseTLV("00XX01")
	assert.ErrorIs(t, err, depositsvc.ErrPayloadMalformed)
}

// The generator must never emit a field whose value is longer than two digits
// can express, because the length prefix would silently wrap.
func TestPromptPayPayload_RefusesAnOverlongValue(t *testing.T) {
	_, err := depositsvc.PromptPayPayload(strings.Repeat("1", 13),
		decimal.RequireFromString("99999999999999.99"))
	assert.Error(t, err)
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/service/deposit/ -v`
Expected: compile error — the package does not exist.

- [ ] **Step 3: Write the generator**

`internal/service/deposit/promptpay.go`:

```go
// Package deposit creates deposits and the PromptPay payloads customers pay
// against.
package deposit

import (
	"fmt"
	"regexp"
	"strings"

	"be-maxpay/internal/shared/errs"

	"github.com/shopspring/decimal"
)

// EMVCo tags used by a PromptPay credit-transfer payload.
const (
	tagFormat      = "00"
	tagInitiation  = "01"
	tagPromptPay   = "29"
	tagCurrency    = "53"
	tagAmount      = "54"
	tagCountry     = "58"
	tagCRC         = "63"

	subAID      = "00"
	subMobile   = "01"
	subNationalID = "02"
	subEWallet  = "03"
)

const (
	formatIndicator = "01"

	// initiationDynamic marks a payload that carries an amount and is meant
	// to be paid once. The static value, "11", marks a reusable QR -- putting
	// it on an amount-bearing payload invites a second payment that matches
	// no deposit.
	initiationDynamic = "12"

	promptPayAID = "A000000677010111"
	currencyTHB  = "764"
	countryTH    = "TH"

	// moneyPlaces is fixed at two: a bank app renders exactly what it is
	// given, and ledger.ValidateLines refuses anything finer.
	moneyPlaces = 2
)

var (
	// ErrPromptPayIDFormat is returned for an id that is none of the three
	// shapes the standard defines. It is deliberately not a "best guess":
	// a 13-digit value could be a tax id or a 0066-prefixed mobile, and
	// emitting the wrong sub-tag points the QR at an identity that does not
	// exist.
	ErrPromptPayIDFormat = fmt.Errorf("promptpay id must be 10, 13 or 15 digits: %w", errs.ErrInvalidInput)

	// ErrPayloadMalformed is returned by ParseTLV.
	ErrPayloadMalformed = fmt.Errorf("payload is not valid EMVCo TLV: %w", errs.ErrInvalidInput)
)

var digitsOnly = regexp.MustCompile(`^\d+$`)

// PromptPayPayload builds the EMVCo payload a customer scans.
//
// promptPayID selects its own sub-tag by length, which is why the stored value
// is constrained on the way in rather than classified on the way out:
//
//	10 digits beginning 0 -> mobile, rewritten to 0066 + the last nine
//	13 digits             -> national or tax id, verbatim
//	15 digits             -> e-wallet id, verbatim
func PromptPayPayload(promptPayID string, amount decimal.Decimal) (string, error) {
	if !amount.IsPositive() {
		return "", fmt.Errorf("amount must be positive: %w", errs.ErrInvalidInput)
	}

	subTag, value, err := classify(promptPayID)
	if err != nil {
		return "", err
	}

	merchantInfo, err := field(subAID, promptPayAID)
	if err != nil {
		return "", err
	}

	idField, err := field(subTag, value)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	for _, f := range []struct{ tag, value string }{
		{tagFormat, formatIndicator},
		{tagInitiation, initiationDynamic},
		{tagPromptPay, merchantInfo + idField},
		{tagCurrency, currencyTHB},
		{tagAmount, amount.StringFixed(moneyPlaces)},
		{tagCountry, countryTH},
	} {
		encoded, err := field(f.tag, f.value)
		if err != nil {
			return "", err
		}

		b.WriteString(encoded)
	}

	// The checksum covers everything before it, including its own tag and
	// its own length -- so the tag and length go in first, then the CRC of
	// what is now there.
	b.WriteString(tagCRC)
	b.WriteString("04")

	return b.String() + CRC16(b.String()), nil
}

func classify(id string) (subTag, value string, err error) {
	if !digitsOnly.MatchString(id) {
		return "", "", ErrPromptPayIDFormat
	}

	switch {
	case len(id) == 10 && strings.HasPrefix(id, "0"):
		return subMobile, "0066" + id[1:], nil
	case len(id) == 13:
		return subNationalID, id, nil
	case len(id) == 15:
		return subEWallet, id, nil
	default:
		return "", "", ErrPromptPayIDFormat
	}
}

// field encodes one TLV entry. A value longer than 99 characters cannot be
// expressed by a two-digit length and is refused rather than truncated -- a
// wrapped length produces a payload that parses into something else entirely.
func field(tag, value string) (string, error) {
	if len(value) > 99 {
		return "", fmt.Errorf("value for tag %s is too long to encode: %w", tag, errs.ErrInvalidInput)
	}

	return fmt.Sprintf("%s%02d%s", tag, len(value), value), nil
}

// CRC16 is CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no
// input or output reflection, no final XOR. It returns four uppercase hex
// digits, which is what the standard puts in tag 63.
func CRC16(s string) string {
	crc := uint16(0xFFFF)

	for i := 0; i < len(s); i++ {
		crc ^= uint16(s[i]) << 8

		for bit := 0; bit < 8; bit++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}

	return fmt.Sprintf("%04X", crc)
}
```

- [ ] **Step 4: Write the parser**

`internal/service/deposit/promptpay_parse.go`:

```go
package deposit

import "strconv"

// ParseTLV reads an EMVCo payload into its fields.
//
// It exists to test the generator against itself: a wrong tag, a wrong length
// prefix or a wrong field order all produce a payload with a perfectly valid
// CRC, so the checksum cannot catch any of them. Reading our own output back
// and comparing it to what we meant can.
//
// A repeated tag keeps its first occurrence, which matches how a reader
// encountering a malformed payload would behave and keeps the function total.
func ParseTLV(payload string) (map[string]string, error) {
	fields := map[string]string{}

	for i := 0; i < len(payload); {
		if i+4 > len(payload) {
			return nil, ErrPayloadMalformed
		}

		tag := payload[i : i+2]

		length, err := strconv.Atoi(payload[i+2 : i+4])
		if err != nil || length < 0 {
			return nil, ErrPayloadMalformed
		}

		start := i + 4
		if start+length > len(payload) {
			return nil, ErrPayloadMalformed
		}

		if _, seen := fields[tag]; !seen {
			fields[tag] = payload[start : start+length]
		}

		i = start + length
	}

	return fields, nil
}
```

- [ ] **Step 5: Run the tests**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/service/deposit/ -v`
Expected: all PASS.

- [ ] **Step 6: Prove the tests have teeth**

Using `go test -overlay` with modified COPIES — never edit a tracked file — confirm each of these fails the test named for it, then restore:

| Mutation | Must fail |
|---|---|
| `initiationDynamic` changed to `"11"` | `BuildsTheDocumentedStructure` |
| CRC initial value changed from `0xFFFF` to `0x0000` | `MatchesThePublishedCheckValue` |
| the CRC computed over the body **without** `"6304"` | `RoundTripsEveryField` |
| `classify` returning `subNationalID` for a 10-digit mobile | `RewritesAMobileNumber` |
| `field` using `%d` instead of `%02d` for the length | `BuildsTheDocumentedStructure` or `RoundTripsEveryField` |

Report each result. A mutation that fails nothing is a finding about the tests, not about the mutation.

- [ ] **Step 7: Commit**

```bash
git add internal/service/deposit/promptpay.go internal/service/deposit/promptpay_parse.go \
        internal/service/deposit/promptpay_test.go
git commit -m "feat(deposit): generate PromptPay EMVCo payloads"
```

---

### Task 2: The deposits table and the deposit domain

**Files:**
- Create: `db/migrations/000010_deposits.up.sql`, `db/migrations/000010_deposits.down.sql`
- Create: `internal/domain/deposit/{entity,dto,errors,validator,repository,service}.go`
- Test: `internal/domain/deposit/validator_test.go`

**Interfaces:**
- Consumes: `merchants(id)`, `merchant_clients(id)`, `bank_accounts(id)`.
- Produces: `deposit.Deposit`, `deposit.CreateData`, `deposit.ListQuery`, `deposit.Repository`, `deposit.Service`, the status and type constants, and `ValidateCreate`.

**A note on the schema, which differs from the spec on purpose.** Spec §4.1 gives `deposits` a `matched_line_id` referencing `bank_statement_lines`, and a CHECK tying it to `COMPLETED`. That table is P3b's. This migration omits both columns and that constraint; P3b's migration adds them alongside the table they point at. The `status` CHECK still admits `COMPLETED` from the start — it is simply unreachable until P3b, and widening a CHECK later costs another migration for no benefit.

- [ ] **Step 1: Write the migration**

`db/migrations/000010_deposits.up.sql`:

```sql
-- One row per deposit a merchant has asked us to expect.
--
-- A QR deposit is defined by the exact satang amount its customer will pay;
-- that amount is what P3b's matcher will look for in a bank statement. A
-- TRANSFER deposit has no amount until the money arrives, and is matched on
-- the customer's own account number instead.
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

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT deposits_type CHECK (type IN ('QR', 'TRANSFER')),

    -- COMPLETED is unreachable until P3b's matcher exists. It is admitted
    -- now so that adding the matcher does not require widening this CHECK.
    CONSTRAINT deposits_status CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED')),

    CONSTRAINT deposits_qr_has_amount CHECK (
        type <> 'QR' OR (requested_amount IS NOT NULL
                     AND deposit_amount IS NOT NULL
                     AND qr_payload IS NOT NULL)),

    CONSTRAINT deposits_amounts_positive CHECK (
        (requested_amount IS NULL OR requested_amount > 0)
    AND (deposit_amount IS NULL OR deposit_amount > 0))
);

-- A merchant's own order id is unique to that merchant, not globally: two
-- merchants may legitimately number their orders the same way.
CREATE UNIQUE INDEX deposits_merchant_transaction
    ON deposits (merchant_id, transaction_id);

-- The rule that makes QR matching unambiguous, and the reason the service
-- offers an amount to the database rather than trusting its own randomiser:
-- one corporate account cannot hold two pending deposits for the same amount.
CREATE UNIQUE INDEX deposits_pending_amount
    ON deposits (bank_account_id, deposit_amount)
    WHERE status = 'PENDING' AND deposit_amount IS NOT NULL;

CREATE INDEX deposits_pending_expiry ON deposits (expires_at) WHERE status = 'PENDING';
CREATE INDEX deposits_merchant_created ON deposits (merchant_id, id DESC);
```

`db/migrations/000010_deposits.down.sql`:

```sql
DROP TABLE IF EXISTS deposits;
```

- [ ] **Step 2: Apply it**

Run: `export PATH="$PATH:$HOME/go/bin" && make migrate-up`
Expected: `10/u deposits`. Do NOT run `make docker-up`.

- [ ] **Step 3: Write the entity and the constants**

`internal/domain/deposit/entity.go`:

```go
// Package deposit is the money-in domain: what a merchant asked us to expect,
// and what state that expectation is in.
package deposit

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Types. The set is closed and matches the deposits_type CHECK.
const (
	// TypeQR is paid by scanning a PromptPay payload for an exact amount.
	TypeQR = "QR"
	// TypeTransfer is paid by an ordinary bank transfer and is matched on the
	// customer's own account number. It carries no amount until money lands.
	TypeTransfer = "TRANSFER"
)

// Statuses, matching the deposits_status CHECK.
const (
	StatusPending   = "PENDING"
	StatusCompleted = "COMPLETED"
	StatusExpired   = "EXPIRED"
)

// ReferenceLength is how many base62 characters a reference id carries. Ten
// matches the merchant code and the PRD's own examples.
const ReferenceLength = 10

// Deposit is one expectation of money.
//
// RequestedAmount is what the merchant asked for; DepositAmount is what the
// customer must actually pay, which for a QR deposit is the requested amount
// plus a random satang offset. Both are zero for a TRANSFER deposit, whose
// amount is not known until it arrives.
type Deposit struct {
	ID            uuid.UUID
	MerchantID    uuid.UUID
	ClientID      uuid.UUID
	ReferenceID   string
	TransactionID string
	Type          string
	Status        string
	BankAccountID uuid.UUID

	RequestedAmount decimal.Decimal
	DepositAmount   decimal.Decimal

	CustomerAccountNo string
	CustomerBankCode  string
	CustomerName      string
	CustomerPhone     string

	QRPayload   string
	CallbackURL string
	ExpiresAt   time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (d *Deposit) IsPending() bool { return d.Status == StatusPending }

// IsExpiredAt reports whether this deposit's window has closed. It takes the
// instant rather than reading the clock so that the expiry sweep and any test
// asking the same question get the same answer.
func (d *Deposit) IsExpiredAt(now time.Time) bool {
	return d.Status == StatusPending && !now.Before(d.ExpiresAt)
}
```

- [ ] **Step 4: Write the errors**

`internal/domain/deposit/errors.go`:

```go
package deposit

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrNotFound = fmt.Errorf("deposit not found: %w", errs.ErrNotFound)

	ErrUnknownType = fmt.Errorf("deposit type must be QR or TRANSFER: %w", errs.ErrInvalidInput)

	// ErrAmountRequired is returned for a QR deposit with no amount. A QR is
	// defined by the amount it asks for; without one there is nothing to
	// randomise and nothing for the matcher to look for.
	ErrAmountRequired = fmt.Errorf("a QR deposit needs an amount: %w", errs.ErrInvalidInput)

	// ErrAmountNotAllowed is returned for a TRANSFER deposit carrying an
	// amount. Accepting it would imply we match on it, which we do not.
	ErrAmountNotAllowed = fmt.Errorf("a TRANSFER deposit must not carry an amount: %w", errs.ErrInvalidInput)

	ErrCallbackNotHTTPS = fmt.Errorf("callback url must be https: %w", errs.ErrInvalidInput)

	ErrTimeoutOutOfRange = fmt.Errorf("timeout is outside the permitted range: %w", errs.ErrInvalidInput)

	ErrCustomerRequired = fmt.Errorf("customer account, bank and name are required: %w", errs.ErrInvalidInput)

	// ErrAmountUnavailable is returned when every randomised amount collided
	// on every candidate account. It maps to 409: the request was valid and
	// may succeed if retried, which is not the same as being wrong.
	ErrAmountUnavailable = fmt.Errorf("could not allocate a unique deposit amount: %w", errs.ErrConflict)
)
```

- [ ] **Step 5: Write the DTOs and ports**

`internal/domain/deposit/dto.go`:

```go
package deposit

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// CreateData is one merchant's request, already authenticated and resolved:
// MerchantID and ClientID are ids, not the codes the wire carried.
type CreateData struct {
	MerchantID    uuid.UUID
	ClientID      uuid.UUID
	TransactionID string
	Type          string

	Amount decimal.Decimal

	CustomerAccountNo string
	CustomerBankCode  string
	CustomerName      string
	CustomerPhone     string

	CallbackURL string
	Timeout     time.Duration
}

// ListQuery pages one merchant's deposits, newest first. Status is optional.
type ListQuery struct {
	MerchantID uuid.UUID
	Status     string
	Limit      int
	Offset     int
}
```

`internal/domain/deposit/repository.go`:

```go
package deposit

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ErrAmountTaken is returned by Insert when deposits_pending_amount rejects
// the row. It is a signal to the service to try another amount or another
// account, not an error to surface -- see Service.Create.
var ErrAmountTaken = errAmountTaken

type Repository interface {
	// Insert writes one deposit. It returns ErrAmountTaken when the partial
	// unique index refuses the amount, which is how a collision is detected:
	// the database decides, not the randomiser.
	Insert(ctx context.Context, d *Deposit) (*Deposit, error)

	GetByReference(ctx context.Context, merchantID uuid.UUID, reference string) (*Deposit, error)

	// GetByTransactionID resolves a merchant's own order id.
	GetByTransactionID(ctx context.Context, merchantID uuid.UUID, transactionID string) (*Deposit, error)

	List(ctx context.Context, q ListQuery) ([]*Deposit, error)

	// ClaimExpired marks up to limit overdue pending deposits EXPIRED and
	// returns them, so the caller can act on each exactly once.
	ClaimExpired(ctx context.Context, now time.Time, limit int) ([]*Deposit, error)
}
```

`internal/domain/deposit/service.go`:

```go
package deposit

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	// Create allocates an account and, for a QR deposit, a unique amount and
	// its PromptPay payload.
	Create(ctx context.Context, data CreateData) (*Deposit, error)

	GetByReference(ctx context.Context, merchantID uuid.UUID, reference string) (*Deposit, error)

	List(ctx context.Context, q ListQuery) ([]*Deposit, error)
}
```

Add to `errors.go`:

```go
var errAmountTaken = fmt.Errorf("deposit amount already pending on this account: %w", errs.ErrConflict)
```

- [ ] **Step 6: Write the validator and its failing test**

`internal/domain/deposit/validator.go`:

```go
package deposit

import (
	"strings"
	"time"
)

// ValidateCreate checks everything that needs no database and no clock.
//
// minTimeout and maxTimeout come from configuration rather than from
// constants here: how long a merchant may hold an account's amount reserved
// is an operator's policy, not a property of the domain.
func ValidateCreate(data CreateData, minTimeout, maxTimeout time.Duration) error {
	switch data.Type {
	case TypeQR:
		if !data.Amount.IsPositive() {
			return ErrAmountRequired
		}
	case TypeTransfer:
		if !data.Amount.IsZero() {
			return ErrAmountNotAllowed
		}
	default:
		return ErrUnknownType
	}

	switch {
	case strings.TrimSpace(data.CustomerAccountNo) == "",
		strings.TrimSpace(data.CustomerBankCode) == "",
		strings.TrimSpace(data.CustomerName) == "":
		return ErrCustomerRequired
	}

	// HTTPS is checked here rather than at delivery so a merchant learns
	// about a bad callback while it is still watching the response, not
	// hours later when a webhook silently fails.
	if !strings.HasPrefix(data.CallbackURL, "https://") {
		return ErrCallbackNotHTTPS
	}

	if data.Timeout < minTimeout || data.Timeout > maxTimeout {
		return ErrTimeoutOutOfRange
	}

	return nil
}
```

`internal/domain/deposit/validator_test.go`:

```go
package deposit_test

import (
	"testing"
	"time"

	"be-maxpay/internal/domain/deposit"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
)

const (
	minTimeout = 5 * time.Minute
	maxTimeout = 60 * time.Minute
)

func validQR() deposit.CreateData {
	return deposit.CreateData{
		Type:              deposit.TypeQR,
		Amount:            decimal.RequireFromString("500.00"),
		CustomerAccountNo: "3140312345",
		CustomerBankCode:  "BBL",
		CustomerName:      "เฮง ร่ำรวย",
		CallbackURL:       "https://merchant.example/callback",
		Timeout:           10 * time.Minute,
	}
}

func TestValidateCreate_AcceptsAWellFormedQRRequest(t *testing.T) {
	assert.NoError(t, deposit.ValidateCreate(validQR(), minTimeout, maxTimeout))
}

func TestValidateCreate_AcceptsATransferWithNoAmount(t *testing.T) {
	data := validQR()
	data.Type = deposit.TypeTransfer
	data.Amount = decimal.Zero

	assert.NoError(t, deposit.ValidateCreate(data, minTimeout, maxTimeout))
}

func TestValidateCreate_RefusesAQRWithoutAnAmount(t *testing.T) {
	data := validQR()
	data.Amount = decimal.Zero

	assert.ErrorIs(t, deposit.ValidateCreate(data, minTimeout, maxTimeout), deposit.ErrAmountRequired)
}

// A TRANSFER deposit is matched on the customer's account, never on an
// amount. Accepting one would promise a match we do not perform.
func TestValidateCreate_RefusesATransferCarryingAnAmount(t *testing.T) {
	data := validQR()
	data.Type = deposit.TypeTransfer

	assert.ErrorIs(t, deposit.ValidateCreate(data, minTimeout, maxTimeout), deposit.ErrAmountNotAllowed)
}

func TestValidateCreate_RefusesAPlainHTTPCallback(t *testing.T) {
	data := validQR()
	data.CallbackURL = "http://merchant.example/callback"

	assert.ErrorIs(t, deposit.ValidateCreate(data, minTimeout, maxTimeout), deposit.ErrCallbackNotHTTPS)
}

func TestValidateCreate_RefusesATimeoutOutsideTheRange(t *testing.T) {
	for name, d := range map[string]time.Duration{
		"too short": time.Minute,
		"too long":  2 * time.Hour,
		"zero":      0,
	} {
		t.Run(name, func(t *testing.T) {
			data := validQR()
			data.Timeout = d

			assert.ErrorIs(t, deposit.ValidateCreate(data, minTimeout, maxTimeout), deposit.ErrTimeoutOutOfRange)
		})
	}
}

func TestValidateCreate_RefusesAnUnknownType(t *testing.T) {
	data := validQR()
	data.Type = "CHEQUE"

	assert.ErrorIs(t, deposit.ValidateCreate(data, minTimeout, maxTimeout), deposit.ErrUnknownType)
}

func TestValidateCreate_RequiresTheCustomerFields(t *testing.T) {
	for name, mutate := range map[string]func(*deposit.CreateData){
		"no account": func(d *deposit.CreateData) { d.CustomerAccountNo = "" },
		"no bank":    func(d *deposit.CreateData) { d.CustomerBankCode = " " },
		"no name":    func(d *deposit.CreateData) { d.CustomerName = "" },
	} {
		t.Run(name, func(t *testing.T) {
			data := validQR()
			mutate(&data)

			assert.ErrorIs(t, deposit.ValidateCreate(data, minTimeout, maxTimeout), deposit.ErrCustomerRequired)
		})
	}
}

func TestIsExpiredAt_OnlyPendingDepositsExpire(t *testing.T) {
	past := time.Now().Add(-time.Minute)

	pending := &deposit.Deposit{Status: deposit.StatusPending, ExpiresAt: past}
	completed := &deposit.Deposit{Status: deposit.StatusCompleted, ExpiresAt: past}

	assert.True(t, pending.IsExpiredAt(time.Now()))
	assert.False(t, completed.IsExpiredAt(time.Now()), "a completed deposit never expires")
}
```

- [ ] **Step 7: Run the tests and the layering check**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/domain/deposit/ -v`
Expected: all PASS.

Then confirm the domain imports nothing it must not:

```bash
go list -deps ./internal/domain/deposit | grep -E 'be-maxpay/internal/(adapter|service)' && echo "LAYERING VIOLATION" || echo "layering ok"
```

- [ ] **Step 8: Prove the tests have teeth**

With `go test -overlay` on modified COPIES: delete the TRANSFER-carrying-an-amount branch, and change the HTTPS prefix check to accept `http://`. Each must fail the test named for it. Report both.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/000010_deposits.up.sql db/migrations/000010_deposits.down.sql \
        internal/domain/deposit/
git commit -m "feat(deposit): add the deposits table and the deposit domain"
```

---

### Task 3: The deposit repository

**Files:**
- Create: `internal/adapter/persistence/model/deposit.go`, `internal/adapter/persistence/mapper/deposit.go`
- Create: `internal/adapter/repository/deposit/repository.go`
- Test: `internal/adapter/repository/deposit/repository_test.go` (sqlmock)
- Test: `internal/adapter/repository/deposit/integration_test.go`

**Interfaces:**
- Consumes: `deposit.Repository`, `base.BaseRepository`, `errs.WrapDatabaseError`.
- Produces: `func NewRepository(db *sqlx.DB) *Repository` satisfying `deposit.Repository`.

Follow `internal/adapter/repository/bankaccount/repository.go` for house style.

**The one thing this task exists to get right:** `Insert` must distinguish the amount collision from every other database error. The service's retry loop depends on it, and a collision reported as a generic failure turns a recoverable request into a 500. PostgreSQL raises SQLSTATE `23505` with the constraint name `deposits_pending_amount`; match on the constraint name, not on the message text.

- [ ] **Step 1: Write the model and mapper**

`internal/adapter/persistence/model/deposit.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Deposit struct {
	ID            uuid.UUID `db:"id"`
	MerchantID    uuid.UUID `db:"merchant_id"`
	ClientID      uuid.UUID `db:"client_id"`
	ReferenceID   string    `db:"reference_id"`
	TransactionID string    `db:"transaction_id"`
	Type          string    `db:"type"`
	Status        string    `db:"status"`
	BankAccountID uuid.UUID `db:"bank_account_id"`

	RequestedAmount decimal.NullDecimal `db:"requested_amount"`
	DepositAmount   decimal.NullDecimal `db:"deposit_amount"`

	CustomerAccountNo string         `db:"customer_account_no"`
	CustomerBankCode  string         `db:"customer_bank_code"`
	CustomerName      string         `db:"customer_name"`
	CustomerPhone     sql.NullString `db:"customer_phone"`

	QRPayload   sql.NullString `db:"qr_payload"`
	CallbackURL string         `db:"callback_url"`
	ExpiresAt   time.Time      `db:"expires_at"`

	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}
```

`internal/adapter/persistence/mapper/deposit.go`:

```go
package mapper

import (
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/deposit"
)

func DepositToModel(d *deposit.Deposit) *model.Deposit {
	if d == nil {
		return nil
	}

	return &model.Deposit{
		ID: d.ID, MerchantID: d.MerchantID, ClientID: d.ClientID,
		ReferenceID: d.ReferenceID, TransactionID: d.TransactionID,
		Type: d.Type, Status: d.Status, BankAccountID: d.BankAccountID,
		// A TRANSFER deposit has no amount, and a zero amount is not the same
		// as no amount -- the partial unique index skips NULL and would treat
		// a stored zero as a real reservation every TRANSFER deposit shared.
		RequestedAmount: nullDecimalIfPositive(d.RequestedAmount),
		DepositAmount:   nullDecimalIfPositive(d.DepositAmount),
		CustomerAccountNo: d.CustomerAccountNo,
		CustomerBankCode:  d.CustomerBankCode,
		CustomerName:      d.CustomerName,
		CustomerPhone:     nullString(d.CustomerPhone),
		QRPayload:         nullString(d.QRPayload),
		CallbackURL:       d.CallbackURL,
		ExpiresAt:         d.ExpiresAt,
		CreatedAt:         d.CreatedAt, UpdatedAt: d.UpdatedAt,
	}
}

func DepositToDomain(m *model.Deposit) *deposit.Deposit {
	if m == nil {
		return nil
	}

	return &deposit.Deposit{
		ID: m.ID, MerchantID: m.MerchantID, ClientID: m.ClientID,
		ReferenceID: m.ReferenceID, TransactionID: m.TransactionID,
		Type: m.Type, Status: m.Status, BankAccountID: m.BankAccountID,
		RequestedAmount: m.RequestedAmount.Decimal,
		DepositAmount:   m.DepositAmount.Decimal,
		CustomerAccountNo: m.CustomerAccountNo,
		CustomerBankCode:  m.CustomerBankCode,
		CustomerName:      m.CustomerName,
		CustomerPhone:     m.CustomerPhone.String,
		QRPayload:         m.QRPayload.String,
		CallbackURL:       m.CallbackURL,
		ExpiresAt:         m.ExpiresAt,
		CreatedAt:         m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

func DepositsToDomain(ms []*model.Deposit) []*deposit.Deposit {
	out := make([]*deposit.Deposit, 0, len(ms))
	for _, m := range ms {
		out = append(out, DepositToDomain(m))
	}

	return out
}

func nullDecimalIfPositive(d decimal.Decimal) decimal.NullDecimal {
	return decimal.NullDecimal{Decimal: d, Valid: d.IsPositive()}
}
```

`nullString` already exists in the mapper package; reuse it rather than redefining it. Add the `decimal` import.

- [ ] **Step 2: Write the repository**

Key requirements, in full:

```go
// Insert writes one deposit.
//
// A rejection from deposits_pending_amount is returned as ErrAmountTaken and
// nothing else, because the service's retry loop is the only correct response
// to it: another amount, or another account. Reporting it as a generic
// database failure would turn a request that merely needs retrying into a 500.
func (r *Repository) Insert(ctx context.Context, d *domaindeposit.Deposit) (*domaindeposit.Deposit, error) {
	// ... build the INSERT ... RETURNING with squirrel ...

	var m model.Deposit
	err := r.DB.QueryRowxContext(ctx, sqlStr, args...).StructScan(&m)
	if err != nil {
		if isUniqueViolation(err, "deposits_pending_amount") {
			return nil, domaindeposit.ErrAmountTaken
		}
		if isUniqueViolation(err, "deposits_merchant_transaction") {
			return nil, domaindeposit.ErrDuplicateTransaction
		}

		return nil, errs.WrapDatabaseError(err, "insert deposit")
	}

	return mapper.DepositToDomain(&m), nil
}

// isUniqueViolation matches on SQLSTATE and the constraint's own name, never
// on the message text, which is localisable and version-dependent.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
```

Add `ErrDuplicateTransaction` to the domain's errors, wrapping `errs.ErrConflict`.

`ClaimExpired` must mark and return in one statement so two workers cannot both act on the same deposit:

```go
const claimExpiredQuery = `
	UPDATE deposits SET status = $1, updated_at = NOW()
	WHERE id IN (
	    SELECT id FROM deposits
	    WHERE status = $2 AND expires_at <= $3
	    ORDER BY expires_at ASC
	    LIMIT $4
	    FOR UPDATE SKIP LOCKED
	)
	RETURNING ` + depositColumns
```

`SKIP LOCKED` is what lets two workers run without either waiting for the other or both expiring the same row. It is the same pattern the outbox uses, and it is the reason expiry can be an ordinary background job.

`GetByReference` and `GetByTransactionID` both filter on `merchant_id` as well as their own key. A deposit reference is not a secret, and a merchant that can read another merchant's deposit by guessing a reference is a cross-tenant leak of the kind the previous phase's security review found three times.

- [ ] **Step 3: Write the sqlmock tests**

Cover: `Insert` mapping a `deposits_pending_amount` violation to `ErrAmountTaken`; `Insert` mapping a `deposits_merchant_transaction` violation to `ErrDuplicateTransaction`; `Insert` mapping any other error through `WrapDatabaseError`; `GetByReference` including `merchant_id` in its WHERE; `ClaimExpired` issuing `FOR UPDATE SKIP LOCKED`.

- [ ] **Step 4: Write the integration tests**

Every one begins with `pgtest.Truncate(t, db, "deposits")` — that table only. `merchants`, `merchant_clients` and `bank_accounts` carry fixtures other suites depend on.

Cover, in full:

```go
// TestRepository_Integration_TwoPendingDepositsCannotShareAnAmount:
// insert one PENDING deposit at 500.35 on an account, then attempt a second
// at the same amount on the SAME account. The second must return
// ErrAmountTaken. Then insert 500.35 on a DIFFERENT account and assert it
// succeeds -- the constraint is per account, and the service's retry loop
// depends on that being true.
//
// TestRepository_Integration_ACompletedDepositReleasesItsAmount:
// insert 500.35 PENDING, mark it COMPLETED with a direct UPDATE, then insert
// 500.35 PENDING again on the same account. It must succeed: the index is
// partial on status, and a settled deposit must not reserve an amount forever.
//
// TestRepository_Integration_ATransferDepositReservesNoAmount:
// insert three TRANSFER deposits on one account. All must succeed. A stored
// zero rather than NULL would make the second collide with the first.
//
// TestRepository_Integration_GetByReferenceIsScopedToItsMerchant:
// insert a deposit for merchant A, then read it as merchant B. Must return
// ErrNotFound, not the row.
//
// TestRepository_Integration_ClaimExpiredMarksAndReturnsOnlyOverdueOnes:
// insert one deposit expiring in the past and one in the future, claim, and
// assert exactly the overdue one comes back and its stored status is EXPIRED.
```

- [ ] **Step 5: Run the tests**

Run: `export PATH="$PATH:$HOME/go/bin" && make test-integration && go test ./internal/adapter/repository/deposit/`

- [ ] **Step 6: Prove the teeth**

With `go test -overlay` on modified COPIES:

| Mutation | Must fail |
|---|---|
| drop `merchant_id` from `GetByReference`'s WHERE | `GetByReferenceIsScopedToItsMerchant` |
| map every `23505` to `ErrAmountTaken` regardless of constraint | the duplicate-transaction test |
| store a zero `DepositAmount` instead of NULL for TRANSFER | `ATransferDepositReservesNoAmount` |
| drop `SKIP LOCKED` | say honestly whether anything fails; if nothing does, report that rather than claiming coverage |

- [ ] **Step 7: Commit**

```bash
git add internal/adapter/persistence/model/deposit.go internal/adapter/persistence/mapper/deposit.go \
        internal/adapter/repository/deposit/
git commit -m "feat(deposit): add the deposit repository"
```

---

### Task 4: The create service, with the collision retry

**Files:**
- Create: `internal/service/deposit/service.go`
- Test: `internal/service/deposit/service_test.go`

**Interfaces:**
- Consumes: `deposit.Repository`, `bankaccount.Router.SelectInbound`, `merchant.Service.GetByID`, `PromptPayPayload`, `crypto.RandomCode`.
- Produces: `func NewService(repo deposit.Repository, router bankaccount.Router, merchants merchant.Service, cfg Config, logger *zap.Logger) *Service` and `type Config struct { SatangRetries int; MinTimeout, MaxTimeout time.Duration; QREnabled bool }`.

**The retry loop is the whole task.** P2a's `SelectInbound` returns *every* candidate account, least loaded first, and its doc comment says why: "the caller retries down it when a randomised amount collides; that retry loop arrives with deposits in P3." This is that loop.

- [ ] **Step 1: Write the service**

```go
// Create allocates an account and, for a QR deposit, an amount no other
// pending deposit on that account is already holding.
//
// The randomiser proposes and the database disposes. Every proposed amount is
// offered to deposits_pending_amount, and a rejection is a signal rather than
// a failure: try another amount on the same account, and when the attempts for
// one account are spent, try the next account the router offered. Only when
// every account has refused every attempt does the request fail, with a 409 --
// the request was well formed and may succeed later, which is not the same as
// being wrong.
//
// Issuing a QR whose amount we already know is ambiguous would be worse than
// refusing: the customer would pay, and the money could not be attributed.
func (s *Service) Create(ctx context.Context, data domaindeposit.CreateData) (*domaindeposit.Deposit, error) {
	if err := domaindeposit.ValidateCreate(data, s.cfg.MinTimeout, s.cfg.MaxTimeout); err != nil {
		return nil, err
	}

	if data.Type == domaindeposit.TypeQR && !s.cfg.QREnabled {
		// A generator no banking app has ever scanned is not known to work,
		// and a QR that cannot be scanned fails in a customer's hand rather
		// than in ours. See the spec's verification gate.
		return nil, domaindeposit.ErrQRDisabled
	}

	m, err := s.merchants.GetByID(ctx, data.MerchantID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	accounts, err := s.router.SelectInbound(ctx, domainbank.InboundQueryFor(m, now))
	if err != nil {
		return nil, err
	}

	reference, err := crypto.RandomCode(domaindeposit.ReferenceLength)
	if err != nil {
		return nil, fmt.Errorf("generate deposit reference: %w", errs.ErrInternal)
	}

	base := &domaindeposit.Deposit{
		MerchantID: data.MerchantID, ClientID: data.ClientID,
		ReferenceID: reference, TransactionID: data.TransactionID,
		Type: data.Type, Status: domaindeposit.StatusPending,
		RequestedAmount:   data.Amount,
		CustomerAccountNo: data.CustomerAccountNo,
		CustomerBankCode:  data.CustomerBankCode,
		CustomerName:      data.CustomerName,
		CustomerPhone:     data.CustomerPhone,
		CallbackURL:       data.CallbackURL,
		ExpiresAt:         now.Add(data.Timeout),
	}

	for _, account := range accounts {
		created, err := s.tryAccount(ctx, base, account, data)
		switch {
		case err == nil:
			return created, nil
		case errors.Is(err, domaindeposit.ErrAmountTaken):
			continue // every attempt on this account collided; try the next
		default:
			return nil, err
		}
	}

	return nil, domaindeposit.ErrAmountUnavailable
}

// tryAccount makes up to SatangRetries attempts on one account. A TRANSFER
// deposit reserves no amount, so it gets exactly one attempt.
func (s *Service) tryAccount(
	ctx context.Context, base *domaindeposit.Deposit,
	account *domainbank.Account, data domaindeposit.CreateData,
) (*domaindeposit.Deposit, error) {
	attempts := s.cfg.SatangRetries
	if data.Type == domaindeposit.TypeTransfer {
		attempts = 1
	}

	for i := 0; i < attempts; i++ {
		candidate := *base
		candidate.BankAccountID = account.ID

		if data.Type == domaindeposit.TypeQR {
			offset, err := randomSatang()
			if err != nil {
				return nil, err
			}

			candidate.DepositAmount = data.Amount.Add(offset)

			payload, err := PromptPayPayload(account.PromptPayID, candidate.DepositAmount)
			if err != nil {
				return nil, err
			}

			candidate.QRPayload = payload
		}

		created, err := s.repo.Insert(ctx, &candidate)
		if err == nil {
			return created, nil
		}
		if !errors.Is(err, domaindeposit.ErrAmountTaken) {
			return nil, err
		}
	}

	return nil, domaindeposit.ErrAmountTaken
}

// randomSatang returns 0.01 to 1.99 from a cryptographic source.
//
// Upward only. The PRD describes plus-or-minus 1.99; adding only means a
// customer may pay a little more than the order and is credited what they
// paid, which nobody disputes, rather than a little less, which everybody
// does. The cost is halving the value space from 398 to 199, and if
// SatangRetries starts running out in practice that is the first lever to
// pull -- it is a change to this function alone.
func randomSatang() (decimal.Decimal, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(199))
	if err != nil {
		return decimal.Zero, fmt.Errorf("generate satang offset: %w", errs.ErrInternal)
	}

	return decimal.New(n.Int64()+1, -2), nil
}
```

Add `ErrQRDisabled` to the domain's errors, wrapping `errs.ErrUnavailable`.

- [ ] **Step 2: Write the tests**

With a fake repository and a fake router, cover in full:

```go
// TestCreate_RetriesAnotherAmountOnTheSameAccount: the fake repository
// refuses the first two inserts with ErrAmountTaken and accepts the third.
// Assert the deposit is created on the FIRST account and that the three
// attempted amounts were all different -- a retry that proposes the same
// amount is not a retry.
//
// TestCreate_MovesToTheNextAccountWhenOneIsExhausted: the repository refuses
// every insert for account A and accepts for account B. Assert the created
// deposit's BankAccountID is B, and that exactly SatangRetries attempts were
// made against A. This is the behaviour P2a returned a list for.
//
// TestCreate_RefusesWhenEveryAccountIsExhausted: every insert refused.
// Assert ErrAmountUnavailable, and assert the number of attempts equals
// SatangRetries times the number of accounts -- neither fewer nor more.
//
// TestCreate_ATransferGetsOneAttemptAndNoAmount: assert exactly one insert,
// a zero DepositAmount and an empty QRPayload.
//
// TestCreate_RefusesQRWhenDisabled: with QREnabled false, assert
// ErrQRDisabled and that the repository was never called at all.
//
// TestCreate_ARepositoryFailureIsNotRetried: the repository returns a
// database error. Assert it propagates immediately and that exactly one
// attempt was made -- retrying a real failure hides it.
//
// TestCreate_TheAmountIsAlwaysAboveTheRequestedOne: run 200 creates and
// assert every DepositAmount is greater than RequestedAmount and at most
// 1.99 above it, with at most two decimal places.
//
// TestCreate_ExpiryIsStampedNotStored: assert ExpiresAt is within a second
// of now plus the requested timeout.
```

- [ ] **Step 3: Run, prove teeth, commit**

Run `go test ./internal/service/deposit/ -race`. Then with `-overlay`:

| Mutation | Must fail |
|---|---|
| `tryAccount` breaking out of the account loop on the first collision | `MovesToTheNextAccountWhenOneIsExhausted` |
| `randomSatang` returning a constant | `RetriesAnotherAmountOnTheSameAccount` |
| retrying on a generic repository error too | `ARepositoryFailureIsNotRetried` |
| `randomSatang` returning `decimal.New(n.Int64(), -2)` (allowing zero) | `TheAmountIsAlwaysAboveTheRequestedOne` |

```bash
git add internal/service/deposit/service.go internal/service/deposit/service_test.go
git commit -m "feat(deposit): create deposits, retrying amounts and accounts on collision"
```

---

### Task 5: `POST /deposit/create`

**Files:**
- Create: `internal/adapter/http/merchantdeposit/{handler,handlers,routes,dto}.go`
- Create: `internal/adapter/http/merchantdeposit/handlers_test.go`
- Create: `bruno/Deposit/Create deposit.bru`
- Modify: `internal/adapter/http/routes_test.go`

**Interfaces:**
- Consumes: `deposit.Service`, `signature.Service.Verify`, `idempotency.Service`, `middleware.MerchantFromContext`, `routing.MerchantGroup`.
- Produces: `merchantdeposit.RegisterRoutes(p RouteParams)`.

Follow `internal/adapter/http/merchantledger` for package shape.

**Three things this endpoint must get right.**

**The merchant comes from the credential.** `merchantId` and `clientId` arrive in the body because the PRD puts them there, and they are checked against the authenticated merchant — never trusted in place of it. The previous phase found a signature verified against a merchant code taken from the request body; this is the same shape.

**Idempotency wraps the whole handler.** `Begin` before any work; if it reports a replay, return the stored code and body verbatim. `Finish` after a successful create. A merchant that retries after a timeout must receive the original QR, not a second one with a different amount — two live QRs for one order is exactly the ambiguity the whole design refuses.

**Money crosses JSON as strings.** `amount` arrives as a JSON number because the PRD says so; parse it through `decimal.NewFromString(json.Number)`, never through `float64`. It leaves as a string via `StringFixed(2)`.

- [ ] **Step 1: The response shape**

Follows the PRD exactly:

```json
{ "status": "success", "message": "Create Success",
  "data": { "clientId": "...", "merchantId": "...", "referenceId": "w5EIFM4i1M",
            "transactionId": "...", "status": "pending", "amount": "500.00",
            "depositAmount": "500.35", "qrcode": "0002010102121129...",
            "bankAccountNumber": "...", "bankAccountName": "...",
            "bankName": "KTB", "bankCode": "006", "promptpayNumber": "...",
            "expireDate": "2026-08-27T17:30:34.581Z",
            "customerData": { "bankAccountNumber": "...", "bankName": "...", "name": "..." } } }
```

- [ ] **Step 2: Write the tests**

Cover in full: a well-formed QR request returns 201 with a payload that `ParseTLV` can read; a `merchantId` in the body that differs from the authenticated merchant returns 403 and the service is never called; a replayed `transactionId` returns the original body byte for byte and the service is called once across both requests; `amount` is rendered as a string and never as a JSON number; a plain-HTTP `callbackUrl` returns 400 before the service is called; `ErrAmountUnavailable` maps to 409; `ErrNoAccountAvailable` maps to 503; ids validate with the `uuid` tag and not `uuid4`.

- [ ] **Step 3: Run, prove teeth, commit**

With `-overlay`: make the handler take the merchant id from the body, and confirm the authorization test fails **because another merchant's deposit was created**, not merely because a status changed. Then skip the `Begin` call and confirm the replay test fails.

```bash
git add internal/adapter/http/merchantdeposit/ bruno/Deposit/ internal/adapter/http/routes_test.go
git commit -m "feat(deposit): add POST /deposit/create"
```

---

### Task 6: The two read endpoints

**Files:**
- Modify: `internal/adapter/http/merchantdeposit/{handlers,routes,dto}.go`
- Modify: `internal/adapter/http/merchantdeposit/handlers_test.go`
- Create: `bruno/Deposit/Get deposit.bru`, `bruno/Deposit/List deposits.bru`
- Modify: `internal/adapter/http/routes_test.go`

```text
GET /api/v1/deposit/:reference_id
GET /api/v1/deposits
```

Both scoped to the authenticated merchant. `GET /deposits` pages with `limit` and `offset`, both clamped in the handler — a negative offset reaches PostgreSQL as `OFFSET must not be negative` and becomes a 500 for what is a bad request. An optional `status` filter accepts only the three known values.

Test that merchant B reading merchant A's reference gets 404 and not 403 — a 403 confirms the reference exists, which is itself a leak.

Prove the teeth by removing the merchant scope from each handler and confirming the isolation test fails with the other merchant's data present in the body.

```bash
git add internal/adapter/http/merchantdeposit/ bruno/Deposit/ internal/adapter/http/routes_test.go
git commit -m "feat(deposit): add the deposit read endpoints"
```

---

### Task 7: Expiry

**Files:**
- Create: `internal/service/deposit/expiry.go`
- Test: `internal/service/deposit/expiry_test.go`

**Interfaces:**
- Consumes: `deposit.Repository.ClaimExpired`, the outbox worker's `Register`.
- Produces: `func NewExpirer(repo deposit.Repository, batch int, logger *zap.Logger) *Expirer` with `Handle(ctx, payload) error` and `ExpireDue(ctx) (int, error)`.

Expiry is an event, not an interpretation. A deposit that has passed its window must be *marked*, because P3b will send a webhook for it and because a status computed at read time cannot be delivered to anyone.

`ClaimExpired` already marks and returns in one statement under `SKIP LOCKED`, so `ExpireDue` is a thin loop over what it returns. In P3a it logs; P3b enqueues the webhook there.

Register the handler with the worker. Like P2b's balance refresher, **nothing schedules it in P3a** — there is no producer, and adding one belongs with the P3b work that gives expiry an observable consequence. Say so in the code comment, and make it visible rather than mysterious.

Test with a fake repository: a batch of three claimed deposits produces three log lines and returns 3; a repository error propagates; an empty batch returns 0 and does nothing.

```bash
git add internal/service/deposit/expiry.go internal/service/deposit/expiry_test.go
git commit -m "feat(deposit): expire overdue deposits"
```

---

### Task 8: Wire it up and prove it against a real database

**Files:**
- Modify: `internal/adapter/repository/module.go`, `internal/service/module.go`, `internal/adapter/http/module.go`, `internal/service/outbox/module.go`
- Modify: `internal/shared/config.go`, `config.yaml`, `config.yaml.example`
- Modify: `README.md`, `AGENTS.md`
- Modify: `bruno/environments/local.bru`

- [ ] **Step 1: Config**

```yaml
deposit:
  min_timeout: 5m
  max_timeout: 60m
  qr_enabled: false
```

`qr_enabled` defaults to false, with a comment saying exactly what turns it on: one successful scan of a generated payload by a real banking app. `pool.satang_retries` already exists and is reused.

- [ ] **Step 2: Register everything**

`fx.Annotate` the repository and service to their ports, add `merchantdeposit.RegisterRoutes` to `http.Module`'s `fx.Invoke`, and register the expiry handler with the worker in `outbox.Module`.

**Do not change the module ordering in `internal/app/module.go`.** Its comment explains why the order is load-bearing: fx stops hooks in reverse registration order, so database → worker → HTTP gives the stop order HTTP → worker → database. Adding a provider is safe; reordering the options is not.

- [ ] **Step 3: Verify the wiring against a RUNNING application**

`routes_test.go` passes for a route that was never added to `fx.Invoke`, because `buildTestEngine` registers packages by hand. That suite structurally cannot catch missing wiring.

So start the service and call the endpoints over HTTP. Paste the boot log lines showing gin registering all three routes, and the verbatim output of every request.

- [ ] **Step 4: Prove it end to end**

Against the development database, with `qr_enabled` temporarily true:

```bash
# 1. sign in as the platform admin, create a merchant and a client credential
# 2. attach an INBOUND bank account with a promptpay_id of 13 digits
# 3. sign a /deposit/create request and post it
# 4. read GET /api/v1/deposit/<referenceId> back
# 5. read GET /api/v1/deposits
# 6. post the SAME transactionId again and confirm the identical body returns
```

Expected: step 3 returns 201 with a `qrcode` string beginning `00020101021229`, a `depositAmount` between 0.01 and 1.99 above the requested amount, and an `expireDate` matching the requested timeout. Step 6 must return the same `referenceId` and the same `qrcode` — not a second deposit.

Then confirm the collision rule holds in the real database:

```sql
SELECT bank_account_id, deposit_amount, COUNT(*)
FROM deposits WHERE status = 'PENDING' AND deposit_amount IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) > 1;
```

Expected: zero rows, always.

- [ ] **Step 5: The scan gate**

Render one generated `qrcode` as an image and **scan it with a real banking app.** Record what the app displayed: the recipient name and the amount. This is the gate the spec requires before `qr_enabled` may be true anywhere.

If it does not scan, that is the finding this whole task exists to surface — report exactly what the app said and stop. Do not adjust the generator to match a guess about why.

Set `qr_enabled` back to `false` in `config.yaml` afterwards.

- [ ] **Step 6: Documentation**

README gains a Deposits section: the two types, the satang rule and why it only adds, the collision query above, the `deposit` config block, and a plain statement that `qr_enabled` stays false until a real scan has succeeded. `AGENTS.md` gains the rule: a deposit amount is proposed by the service and accepted or refused by `deposits_pending_amount`; no code path may assume its randomiser produced a unique value.

- [ ] **Step 7: Full gate and commit**

```bash
export PATH="$PATH:$HOME/go/bin" && make check && make test-integration
git add -A
git commit -m "feat(deposit): wire deposit creation into the application"
```

---

## Self-Review

**Spec coverage.** §4.1 → Task 2 (minus the two P3b columns, noted there). §5 → Task 1, with the scan gate in Task 8. §10's three merchant endpoints → Tasks 5 and 6; the admin endpoints are P3b's, since they exist to resolve statement rows. §11 → Task 8. §12's new error cases → Tasks 2, 4 and 5. §13's QR requirements → Task 1; its matcher and ingestion requirements are P3b's. §14 → Task 8.

Not covered here, deliberately and named in the plan header: statement ingestion, the fingerprint, the matching engine, ledger postings and webhook delivery.

**Placeholder scan.** Tasks 1 to 4 carry their code and tests in full. Tasks 5, 6 and 7 name each required test with its concrete assertion and give the response shape verbatim, but not every test body — they are mechanical variations of Task 4's, and of `merchantledger`'s existing tests, which are in the tree and are good models. Task 8 is a wiring and verification task whose steps are commands, not code.

**Type consistency.** `Deposit`, `CreateData`, `ListQuery`, `Repository`, `Service` are defined in Task 2 and used with those names in Tasks 3 to 8. `PromptPayPayload(promptPayID string, amount decimal.Decimal) (string, error)` has one signature at its definition in Task 1 and its call site in Task 4. `ErrAmountTaken` is produced by Task 3's `Insert` and consumed by Task 4's retry loop. `SelectInbound` returns `[]*Account`, and Task 4 iterates it — the plural is the point.

**One dependency on reality.** Task 8's scan gate cannot be satisfied by any amount of code review. If it fails, the finding belongs to the generator and the plan is not complete, whatever the test suite says.
