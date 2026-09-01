# MaxPay P4a — Payout Create and Reserve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant can `POST /api/v1/payout/create`, have its money held in the ledger, and read the payout back — with no part of this phase contacting a bank.

**Architecture:** Clean Architecture over fx, mirroring the deposit feature layer for layer: `internal/domain/payout` (entity, DTOs, errors, validator, ports), `internal/service/payout` (the create use case and the balance guard), `internal/adapter/persistence/{model,mapper}`, `internal/adapter/repository/payout`, `internal/adapter/http/merchantpayout`. The create use case runs entirely inside one `tx.TransactionHelper.WithTx`: lock the merchant's `MERCHANT_OPERATE` ledger account, read its balance under that lock, refuse if it cannot cover amount plus fee, insert the row, post `PostPayoutCreated`, and write the fee it returned back onto the row.

**Tech Stack:** Go 1.25 · Gin · uber/fx · sqlx + Masterminds/squirrel · PostgreSQL 18 · Zap · Viper · shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-29-maxpay-p4a-payout-create-design.md` (Thai companion: `…-design.th.md`; the English file is authoritative)

## Global Constraints

- Go 1.25 · Gin · uber/fx · sqlx + squirrel · PostgreSQL 18 · Zap · Viper
- Money is `decimal.Decimal`, never `float64`, at every layer including the JSON edge. Request amounts decode through `json.Number`; response amounts render as strings.
- `internal/domain/payout` imports no adapter and no service package.
- Every status transition is a guarded `UPDATE` paired with `CheckRowsAffectedWith`.
- Never log the API key, the secret key, or any merchant plaintext credential at any level, including error paths.
- **Nothing in this phase may open a network connection to a bank.** The `transfer` service is not imported anywhere in this plan.
- All code, identifiers, comments and docstrings in English.
- Every sentinel error wraps an `errs` sentinel; no handler chooses an HTTP status code directly.
- `payout.enabled` defaults to `false`.
- Tests never touch the `maxpay` development database. Integration tests use `TEST_DATABASE_URL` (`maxpay_test`) through `pgtest`.

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/000016_payouts.up.sql` / `.down.sql` | the `payouts` table, its CHECKs and indexes |
| `internal/domain/payout/entity.go` | `Payout`, status constants |
| `internal/domain/payout/dto.go` | `CreateData`, `ListQuery` |
| `internal/domain/payout/errors.go` | sentinels |
| `internal/domain/payout/validator.go` | `ValidateCreate` |
| `internal/domain/payout/repository.go` | the `Repository` port |
| `internal/domain/payout/service.go` | the `Service` port |
| `internal/adapter/persistence/model/payout.go` | the DB row struct |
| `internal/adapter/persistence/mapper/payout.go` | `PayoutToDomain` / `PayoutToModel` / `PayoutsToDomain` |
| `internal/adapter/repository/payout/repository.go` | SQL |
| `internal/service/payout/service.go` | `Create`, `GetByReference`, `List` |
| `internal/adapter/http/merchantpayout/{dto,handlers,routes}.go` | the merchant HTTP surface |
| `internal/shared/config.go` | the `Payout` config block |
| `internal/service/module.go`, `internal/adapter/repository/module.go`, `internal/adapter/http/module.go` | fx wiring |

## Task Order and Rationale

Tasks 1–4 build downward from the database with no HTTP surface, so each is testable on its own. Task 5 is the use case and carries the two properties this phase exists to establish (the balance guard and `reserved_fee`). Tasks 6–7 add the HTTP surface. Task 8 wires fx and proves the whole path end to end.

---

### Task 1: The `payouts` table

**Files:**
- Create: `db/migrations/000016_payouts.up.sql`
- Create: `db/migrations/000016_payouts.down.sql`
- Test: `internal/adapter/repository/payout/schema_integration_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: the `payouts` table. Later tasks rely on these exact column names: `id`, `merchant_id`, `client_id`, `reference_id`, `transaction_id`, `status`, `bank_account_id`, `amount`, `reserved_fee`, `recipient_account_no`, `recipient_bank_code`, `recipient_name`, `recipient_phone`, `callback_url`, `bank_order_id`, `confirmed_at`, `failure_reason`, `created_at`, `updated_at`.

- [ ] **Step 1: Write the migration**

`db/migrations/000016_payouts.up.sql`:

```sql
-- One row per payout a merchant has asked us to make.
--
-- P4a only ever writes PENDING. Every other status is admitted by the CHECK
-- now so that P4b and P4c do not have to widen it, which is the same choice
-- deposits_status made for COMPLETED before the matcher existed.
CREATE TABLE payouts (
    id                   UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id          UUID NOT NULL REFERENCES merchants(id),
    client_id            UUID NOT NULL REFERENCES merchant_clients(id),
    reference_id         TEXT NOT NULL UNIQUE,
    transaction_id       TEXT NOT NULL,
    status               TEXT NOT NULL,

    -- The corporate account that will pay, chosen at creation from
    -- payout.source_account_id and never re-chosen. The PRD requires the create
    -- response to name it (systemBankData), so it must be decided here; P4b
    -- then uses the recorded account rather than re-reading config, which
    -- keeps a merchant's stored answer true if the config changes later.
    bank_account_id      UUID NOT NULL REFERENCES bank_accounts(id),

    amount               NUMERIC(20,4) NOT NULL CHECK (amount > 0),

    -- The fee PostPayoutCreated actually reserved. Persisted because
    -- ledger.PayoutInput.ReservedFee's own doc asks for it by name: "The
    -- full fix is P4 persisting this on the payout row." If the merchant's
    -- payout rate moves while this payout is in flight, a fee recomputed at
    -- settlement would release a different figure than the reservation
    -- credited, stranding the difference in MERCHANT_PENDING_PAYOUT forever.
    reserved_fee         NUMERIC(20,4) NOT NULL CHECK (reserved_fee >= 0),

    recipient_account_no TEXT NOT NULL,
    recipient_bank_code  TEXT NOT NULL,
    recipient_name       TEXT NOT NULL,
    recipient_phone      TEXT,

    callback_url         TEXT NOT NULL,

    -- Written by P4b, declared here. The rule they carry is this design's
    -- central invariant and belongs in the schema rather than in a coding
    -- convention a reader can miss:
    --
    --   confirmed_at IS NULL     -- the bank was never told to pay.
    --                               Releasing the reservation is safe.
    --   confirmed_at IS NOT NULL -- the money may already be gone. Only
    --                               positive evidence may resolve it, and
    --                               an absence of evidence is not evidence.
    bank_order_id        TEXT,
    confirmed_at         TIMESTAMPTZ,
    failure_reason       TEXT,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT payouts_status CHECK (status IN (
        'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED',
        'NEEDS_REVIEW')),

    -- A payout cannot be confirmed at the bank without the order it was
    -- confirmed under: the reconciler in P4c has nothing to ask about
    -- otherwise, and a confirmed row with no order id is unresolvable.
    CONSTRAINT payouts_confirmed_needs_order CHECK (
        confirmed_at IS NULL OR bank_order_id IS NOT NULL)
);

-- A merchant's own order id is unique to that merchant, not globally -- the
-- same rule, and the same reasoning, as deposits_merchant_transaction: two
-- merchants may legitimately number their orders the same way.
CREATE UNIQUE INDEX payouts_merchant_transaction
    ON payouts (merchant_id, transaction_id);

-- P4b's worker claims rows through this.
CREATE INDEX payouts_claimable ON payouts (created_at) WHERE status = 'PENDING';

CREATE INDEX payouts_merchant_created ON payouts (merchant_id, id DESC);
```

`db/migrations/000016_payouts.down.sql`:

```sql
DROP TABLE IF EXISTS payouts;
```

- [ ] **Step 2: Apply it and confirm both CHECKs actually refuse**

```bash
make migrate-up
psql "$TEST_DATABASE_URL" -c "\d payouts"
```

Expected: the table exists with both constraints listed.

- [ ] **Step 3: Write the schema integration test**

`internal/adapter/repository/payout/schema_integration_test.go`:

```go
//go:build integration

package payout_test

import (
	"testing"

	"be-maxpay/internal/testutil/pgtest"

	"github.com/stretchr/testify/require"
)

// The invariant this phase rests on, asserted against the database rather
// than trusted to the code that will write these columns in P4b. A
// confirmed payout whose order id is missing is unresolvable: the
// reconciler has nothing to ask the bank about, and nothing may release the
// merchant's money without positive evidence.
func TestSchema_Integration_AConfirmedPayoutMustNameItsOrder(t *testing.T) {
	db := pgtest.DB(t)
	merchantID, clientID, accountID := seedPayoutFixtures(t, db)

	_, err := db.Exec(`
		INSERT INTO payouts (merchant_id, client_id, reference_id, transaction_id,
			status, bank_account_id, amount, reserved_fee,
			recipient_account_no, recipient_bank_code, recipient_name, callback_url,
			confirmed_at)
		VALUES ($1, $2, 'REFCONFIRM', 'tx-confirm', 'PROCESSING', $3, 100, 1,
			'1234567890', 'KTB', 'payee', 'https://example.test/cb', NOW())`,
		merchantID, clientID, accountID)

	require.Error(t, err, "confirmed_at without bank_order_id must be refused")
	require.Contains(t, err.Error(), "payouts_confirmed_needs_order")
}

// Same physical situation, with the order id present: this must be accepted,
// or the constraint above is refusing the legitimate case too and proves
// nothing about the illegitimate one.
func TestSchema_Integration_AConfirmedPayoutWithItsOrderIsAccepted(t *testing.T) {
	db := pgtest.DB(t)
	merchantID, clientID, accountID := seedPayoutFixtures(t, db)

	_, err := db.Exec(`
		INSERT INTO payouts (merchant_id, client_id, reference_id, transaction_id,
			status, bank_account_id, amount, reserved_fee,
			recipient_account_no, recipient_bank_code, recipient_name, callback_url,
			bank_order_id, confirmed_at)
		VALUES ($1, $2, 'REFCONFIRM2', 'tx-confirm-2', 'PROCESSING', $3, 100, 1,
			'1234567890', 'KTB', 'payee', 'https://example.test/cb',
			'ORDER-1', NOW())`,
		merchantID, clientID, accountID)

	require.NoError(t, err)
}

// transaction_id is unique per merchant, not globally. Two merchants
// numbering their orders the same way is ordinary, and a global unique index
// would refuse the second merchant's first payout.
func TestSchema_Integration_TwoMerchantsMayReuseOneTransactionID(t *testing.T) {
	db := pgtest.DB(t)
	merchantA, clientA, accountID := seedPayoutFixtures(t, db)
	merchantB, clientB := seedSecondMerchant(t, db)

	insert := func(merchantID, clientID any, reference string) error {
		_, err := db.Exec(`
			INSERT INTO payouts (merchant_id, client_id, reference_id, transaction_id,
				status, bank_account_id, amount, reserved_fee,
				recipient_account_no, recipient_bank_code, recipient_name, callback_url)
			VALUES ($1, $2, $3, 'shared-order-id', 'PENDING', $4, 100, 1,
				'1234567890', 'KTB', 'payee', 'https://example.test/cb')`,
			merchantID, clientID, reference, accountID)

		return err
	}

	require.NoError(t, insert(merchantA, clientA, "REFA"))
	require.NoError(t, insert(merchantB, clientB, "REFB"),
		"a second merchant must be free to use the same transaction id")
	require.Error(t, insert(merchantA, clientA, "REFC"),
		"the same merchant reusing it must be refused")
}
```

Write `seedPayoutFixtures` and `seedSecondMerchant` in the same file. They insert a merchant, a `merchant_clients` row and a `bank_accounts` row, returning their ids. Copy the column lists from `internal/adapter/repository/deposit/integration_test.go`'s own `seedMerchant`, `seedClient` and `seedBankAccount` helpers — read that file and reuse its exact inserts rather than guessing the columns.

- [ ] **Step 4: Run the tests and confirm they run rather than skip**

```bash
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
go test -tags=integration -count=1 -v -run 'TestSchema_Integration' ./internal/adapter/repository/payout/ 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: three `--- PASS` lines. **`ok` alone is not a pass** — a missing `TEST_DATABASE_URL` makes `pgtest.DB` skip, and a skipped suite still prints `ok`. Check for the `--- PASS` lines by name.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/000016_payouts.up.sql db/migrations/000016_payouts.down.sql internal/adapter/repository/payout/schema_integration_test.go
git commit -m "feat(payout): add the payouts table"
```

---

### Task 2: The payout domain

**Files:**
- Create: `internal/domain/payout/entity.go`
- Create: `internal/domain/payout/dto.go`
- Create: `internal/domain/payout/errors.go`
- Create: `internal/domain/payout/validator.go`
- Create: `internal/domain/payout/repository.go`
- Create: `internal/domain/payout/service.go`
- Test: `internal/domain/payout/validator_test.go`

**Interfaces:**
- Consumes: the table from Task 1.
- Produces: everything below, by these exact names. Later tasks depend on `Payout`, `CreateData`, `ListQuery`, `ValidateCreate`, `Repository`, `Service`, `ReferenceLength`, and the sentinels.

- [ ] **Step 1: Write the entity**

`internal/domain/payout/entity.go`:

```go
package payout

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ReferenceLength is how many base62 characters a payout's reference id
// carries. Ten, the same as a deposit's, and generated by the same
// crypto.RandomCode: a merchant integrating both should not have to learn
// two shapes of identifier.
const ReferenceLength = 10

const (
	// StatusPending is the only status P4a ever writes. The payout has been
	// accepted and its money reserved; nothing has been sent to a bank.
	StatusPending = "PENDING"

	// StatusProcessing onwards are written by P4b and P4c. They are declared
	// here so that the mapper, the DTO and the CHECK constraint all agree on
	// one spelling from the start.
	StatusProcessing = "PROCESSING"
	StatusCompleted  = "COMPLETED"

	// StatusFailed means we asked the bank and it did not pay.
	StatusFailed = "FAILED"

	// StatusRejected means we never asked the bank. Both release the
	// reservation; they tell the merchant different things, and the PRD
	// lists both.
	StatusRejected = "REJECTED"

	// StatusNeedsReview means the outcome is unknown and no automated rule
	// may decide it -- see the spec's section 5.1.
	StatusNeedsReview = "NEEDS_REVIEW"
)

// Payout is one instruction to pay one recipient.
type Payout struct {
	ID            uuid.UUID
	MerchantID    uuid.UUID
	ClientID      uuid.UUID
	ReferenceID   string
	TransactionID string
	Status        string
	BankAccountID uuid.UUID

	Amount decimal.Decimal

	// ReservedFee is what ledger.PostPayoutCreated actually reserved, not a
	// figure this package computed. P4b must hand it back verbatim; see the
	// column's own comment in migration 000016.
	ReservedFee decimal.Decimal

	RecipientAccountNo string
	RecipientBankCode  string
	RecipientName      string
	RecipientPhone     string

	CallbackURL string

	// BankOrderID and ConfirmedAt are written by P4b and are always empty in
	// this phase. ConfirmedAt being non-nil is what forbids releasing this
	// payout's reservation without positive evidence.
	BankOrderID   string
	ConfirmedAt   *time.Time
	FailureReason string

	CreatedAt time.Time
	UpdatedAt time.Time
}
```

- [ ] **Step 2: Write the DTOs**

`internal/domain/payout/dto.go`:

```go
package payout

import (
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// CreateData is what Service.Create needs. MerchantID and ClientID are
// resolved by the handler from the authenticated credential and the
// credential service -- never taken from the request body, which is
// caller-controlled.
type CreateData struct {
	MerchantID    uuid.UUID
	ClientID      uuid.UUID
	TransactionID string

	Amount decimal.Decimal

	RecipientAccountNo string
	RecipientBankCode  string
	RecipientName      string
	RecipientPhone     string

	CallbackURL string
}

// ListQuery pages one merchant's payouts. MerchantID is always set by the
// handler from the authenticated credential; unlike deposit.ListQuery there
// is no AllMerchants escape, because P4a ships no admin surface.
type ListQuery struct {
	MerchantID uuid.UUID
	Status     string
	Limit      int
	Offset     int
}
```

- [ ] **Step 3: Write the errors**

`internal/domain/payout/errors.go`:

```go
package payout

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrNotFound = fmt.Errorf("payout not found: %w", errs.ErrNotFound)

	ErrAmountNotPositive = fmt.Errorf("amount must be greater than zero: %w", errs.ErrInvalidInput)

	// ErrRecipientRequired covers the three fields a transfer cannot be
	// built without. They are refused together rather than one sentinel
	// each: a caller missing any of them has not filled in the recipient,
	// and three near-identical errors would tell it nothing more.
	ErrRecipientRequired = fmt.Errorf("recipient account, bank and name are required: %w", errs.ErrInvalidInput)

	ErrCallbackNotHTTPS = fmt.Errorf("callback url must be https: %w", errs.ErrInvalidInput)

	// ErrDuplicateTransaction is returned when a merchant reuses its own
	// transaction id. It must never be retried: the first payout exists and
	// retrying would create a second one for the same order.
	ErrDuplicateTransaction = fmt.Errorf("transaction id already used for this merchant: %w", errs.ErrConflict)

	// ErrPayoutDisabled is returned while payout.enabled is false. It maps
	// to 503, the same as deposit.ErrQRDisabled: the request is well formed
	// and may succeed later, which is not the same as being wrong.
	ErrPayoutDisabled = fmt.Errorf("payouts are currently disabled: %w", errs.ErrUnavailable)

	// ErrNoSourceAccount is returned when payout.source_account_id names
	// nothing, is not a UUID, or names an account that is not ACTIVE. Also 503, and for the
	// same reason: this is our misconfiguration, not the merchant's mistake,
	// and the merchant's own request was valid.
	ErrNoSourceAccount = fmt.Errorf("no usable payout source account is configured: %w", errs.ErrUnavailable)
)
```

- [ ] **Step 4: Write the failing validator test**

`internal/domain/payout/validator_test.go`:

```go
package payout_test

import (
	"testing"

	"be-maxpay/internal/domain/payout"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func validData() payout.CreateData {
	return payout.CreateData{
		MerchantID:         uuid.New(),
		ClientID:           uuid.New(),
		TransactionID:      "order-1",
		Amount:             decimal.RequireFromString("100.00"),
		RecipientAccountNo: "6640193604",
		RecipientBankCode:  "KTB",
		RecipientName:      "เฮง ร่ำรวย",
		CallbackURL:        "https://merchant.example/callback",
	}
}

func TestValidateCreate_AcceptsAWellFormedRequest(t *testing.T) {
	require.NoError(t, payout.ValidateCreate(validData()))
}

func TestValidateCreate_RefusesANonPositiveAmount(t *testing.T) {
	for _, amount := range []string{"0", "-1", "-0.0001"} {
		d := validData()
		d.Amount = decimal.RequireFromString(amount)
		require.ErrorIs(t, payout.ValidateCreate(d), payout.ErrAmountNotPositive, "amount %s", amount)
	}
}

func TestValidateCreate_RefusesAnIncompleteRecipient(t *testing.T) {
	tests := map[string]func(*payout.CreateData){
		"no account":        func(d *payout.CreateData) { d.RecipientAccountNo = "" },
		"no bank":           func(d *payout.CreateData) { d.RecipientBankCode = "" },
		"no name":           func(d *payout.CreateData) { d.RecipientName = "" },
		"whitespace name":   func(d *payout.CreateData) { d.RecipientName = "   " },
		"whitespace acct":   func(d *payout.CreateData) { d.RecipientAccountNo = "  " },
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			d := validData()
			mutate(&d)
			require.ErrorIs(t, payout.ValidateCreate(d), payout.ErrRecipientRequired)
		})
	}
}

// Matched case-insensitively. "HTTPS://" is a valid HTTPS URL, and refusing
// it would burn the merchant's transactionId on a terminal 400 for nothing
// but letter case -- the same reasoning merchantdeposit's handler records.
func TestValidateCreate_RefusesANonHTTPSCallbackButAcceptsAnyCase(t *testing.T) {
	for _, url := range []string{"http://merchant.example/cb", "ftp://x", "merchant.example/cb", ""} {
		d := validData()
		d.CallbackURL = url
		require.ErrorIs(t, payout.ValidateCreate(d), payout.ErrCallbackNotHTTPS, "url %q", url)
	}

	for _, url := range []string{"https://a.test/cb", "HTTPS://a.test/cb", "HttPs://a.test/cb"} {
		d := validData()
		d.CallbackURL = url
		require.NoError(t, payout.ValidateCreate(d), "url %q", url)
	}
}
```

- [ ] **Step 5: Run it and watch it fail**

```bash
go test -count=1 ./internal/domain/payout/
```

Expected: FAIL — `undefined: payout.ValidateCreate`.

- [ ] **Step 6: Write the validator**

`internal/domain/payout/validator.go`:

```go
package payout

import "strings"

// ValidateCreate checks what a payout cannot be created without. It does not
// look at the merchant's balance or at the source account: both need
// database reads, and both belong to the service.
func ValidateCreate(data CreateData) error {
	if !data.Amount.IsPositive() {
		return ErrAmountNotPositive
	}

	if strings.TrimSpace(data.RecipientAccountNo) == "" ||
		strings.TrimSpace(data.RecipientBankCode) == "" ||
		strings.TrimSpace(data.RecipientName) == "" {
		return ErrRecipientRequired
	}

	// Case-insensitive: "HTTPS://" is a valid HTTPS URL.
	if !strings.HasPrefix(strings.ToLower(data.CallbackURL), "https://") {
		return ErrCallbackNotHTTPS
	}

	return nil
}
```

- [ ] **Step 7: Run it and watch it pass**

```bash
go test -count=1 ./internal/domain/payout/
```

Expected: PASS.

- [ ] **Step 8: Write the two ports**

`internal/domain/payout/repository.go`:

```go
package payout

import (
	"context"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type Repository interface {
	// Insert writes one payout inside tx. It takes a transaction because the
	// row and the ledger reservation that pays for it must commit together
	// or not at all: a payout with no reservation is money the merchant can
	// spend twice, and a reservation with no payout is money it can never
	// spend again.
	//
	// A merchant reusing its own transaction id surfaces as
	// ErrDuplicateTransaction, mapped from payouts_merchant_transaction.
	Insert(ctx context.Context, tx *sqlx.Tx, p *Payout) (*Payout, error)

	// SetReservedFee records the fee ledger.PostPayoutCreated actually
	// reserved. Separate from Insert because that fee is not known until
	// after the posting, which itself needs the payout's reference id --
	// see the service's own doc on the ordering.
	SetReservedFee(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, fee decimal.Decimal) error

	GetByReference(ctx context.Context, merchantID uuid.UUID, reference string) (*Payout, error)

	List(ctx context.Context, q ListQuery) ([]*Payout, error)
}
```

Add `"github.com/shopspring/decimal"` to that file's imports.

`internal/domain/payout/service.go`:

```go
package payout

import (
	"context"

	domainbank "be-maxpay/internal/domain/bankaccount"

	"github.com/google/uuid"
)

type Service interface {
	// Create reserves the payout's money and records it. It returns the
	// source account alongside the payout because the caller must answer the
	// merchant with that account's own details (systemBankData in the PRD),
	// and looking it up again afterwards is a second call that can fail on
	// its own -- for a payout that, by then, already exists and has already
	// had money reserved against it. The same reasoning as
	// deposit.Service.Create returning its chosen account.
	Create(ctx context.Context, data CreateData) (*Payout, *domainbank.Account, error)

	GetByReference(ctx context.Context, merchantID uuid.UUID, reference string) (*Payout, error)

	List(ctx context.Context, q ListQuery) ([]*Payout, error)
}
```

- [ ] **Step 9: Build and commit**

```bash
go build ./... && go test -count=1 ./internal/domain/payout/
git add internal/domain/payout/
git commit -m "feat(payout): add the payout domain"
```

---

### Task 3: Model, mapper and the repository's reads

**Files:**
- Create: `internal/adapter/persistence/model/payout.go`
- Create: `internal/adapter/persistence/mapper/payout.go`
- Create: `internal/adapter/repository/payout/repository.go`
- Test: `internal/adapter/persistence/mapper/payout_test.go`
- Test: `internal/adapter/repository/payout/repository_test.go`

**Interfaces:**
- Consumes: `domain/payout` from Task 2, the table from Task 1.
- Produces: `payout.NewRepository(db *sqlx.DB) *Repository` implementing `domainpayout.Repository`; `mapper.PayoutToDomain`, `mapper.PayoutToModel`, `mapper.PayoutsToDomain`.

- [ ] **Step 1: Write the model**

Read `internal/adapter/persistence/model/deposit.go` first and match its conventions exactly (`db` tags, `sql.NullString` / `decimal.NullDecimal` usage). Then write `internal/adapter/persistence/model/payout.go` with one field per column from Task 1, in the same order.

Nullable columns: `recipient_phone`, `bank_order_id`, `confirmed_at`, `failure_reason`.

- [ ] **Step 2: Write the failing mapper test**

`internal/adapter/persistence/mapper/payout_test.go`:

```go
package mapper_test

import (
	"testing"
	"time"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Every field is given a DIFFERENT value, and the two money fields are
// deliberately unequal. A fixture where amount equals reserved_fee, or where
// two uuid fields hold one uuid, silently disarms every mutation that swaps
// them: the mapper could read the wrong one of the pair and this test would
// still pass.
func TestPayoutToDomain_CarriesEveryFieldFromItsOwnColumn(t *testing.T) {
	id, merchantID, clientID, accountID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	confirmed := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	created := time.Date(2026, 8, 29, 9, 0, 0, 0, time.UTC)
	updated := time.Date(2026, 8, 29, 11, 0, 0, 0, time.UTC)

	m := &model.Payout{
		ID: id, MerchantID: merchantID, ClientID: clientID, BankAccountID: accountID,
		ReferenceID: "REF0000001", TransactionID: "order-1", Status: "PROCESSING",
		Amount:      decimal.RequireFromString("1000.5000"),
		ReservedFee: decimal.RequireFromString("7.2500"),
		RecipientAccountNo: "6640193604",
		RecipientBankCode:  "KTB",
		RecipientName:      "เฮง ร่ำรวย",
		CallbackURL:        "https://merchant.example/cb",
		CreatedAt:          created,
		UpdatedAt:          updated,
	}
	m.RecipientPhone.String, m.RecipientPhone.Valid = "0812345678", true
	m.BankOrderID.String, m.BankOrderID.Valid = "ORDER-1", true
	m.ConfirmedAt.Time, m.ConfirmedAt.Valid = confirmed, true
	m.FailureReason.String, m.FailureReason.Valid = "bank said no", true

	require.NotEqual(t, m.Amount, m.ReservedFee, "the fixture must keep the two money fields apart")

	got := mapper.PayoutToDomain(m)

	assert.Equal(t, id, got.ID)
	assert.Equal(t, merchantID, got.MerchantID)
	assert.Equal(t, clientID, got.ClientID)
	assert.Equal(t, accountID, got.BankAccountID)
	assert.Equal(t, "REF0000001", got.ReferenceID)
	assert.Equal(t, "order-1", got.TransactionID)
	assert.Equal(t, "PROCESSING", got.Status)
	assert.True(t, got.Amount.Equal(decimal.RequireFromString("1000.5000")), "got %s", got.Amount)
	assert.True(t, got.ReservedFee.Equal(decimal.RequireFromString("7.2500")), "got %s", got.ReservedFee)
	assert.Equal(t, "6640193604", got.RecipientAccountNo)
	assert.Equal(t, "KTB", got.RecipientBankCode)
	assert.Equal(t, "เฮง ร่ำรวย", got.RecipientName)
	assert.Equal(t, "0812345678", got.RecipientPhone)
	assert.Equal(t, "https://merchant.example/cb", got.CallbackURL)
	assert.Equal(t, "ORDER-1", got.BankOrderID)
	require.NotNil(t, got.ConfirmedAt)
	assert.Equal(t, confirmed, *got.ConfirmedAt)
	assert.Equal(t, "bank said no", got.FailureReason)
	assert.Equal(t, created, got.CreatedAt)
	assert.Equal(t, updated, got.UpdatedAt)
}

// A NULL confirmed_at must become a nil pointer, not the zero time: nil is
// "the bank was never told to pay", and a zero time would read as a
// confirmation that happened in year 1.
func TestPayoutToDomain_ANullConfirmedAtBecomesNil(t *testing.T) {
	got := mapper.PayoutToDomain(&model.Payout{})

	assert.Nil(t, got.ConfirmedAt)
	assert.Empty(t, got.BankOrderID)
	assert.Empty(t, got.RecipientPhone)
	assert.Empty(t, got.FailureReason)
}

func TestPayoutToModel_RoundTripsThroughToDomain(t *testing.T) {
	original := mapper.PayoutToDomain(&model.Payout{
		ID: uuid.New(), MerchantID: uuid.New(), ClientID: uuid.New(),
		BankAccountID: uuid.New(),
		ReferenceID:   "REF0000002", TransactionID: "order-2", Status: "PENDING",
		Amount:      decimal.RequireFromString("250.0000"),
		ReservedFee: decimal.RequireFromString("1.7500"),
		RecipientAccountNo: "1112223334", RecipientBankCode: "SCB",
		RecipientName: "payee", CallbackURL: "https://a.test/cb",
	})

	back := mapper.PayoutToDomain(mapper.PayoutToModel(original))

	assert.Equal(t, original, back)
}
```

- [ ] **Step 3: Run it and watch it fail**

```bash
go test -count=1 ./internal/adapter/persistence/mapper/ -run Payout
```

Expected: FAIL — `undefined: mapper.PayoutToDomain`.

- [ ] **Step 4: Write the mapper**

Read `internal/adapter/persistence/mapper/deposit.go` and follow it exactly: a `PayoutToDomain(*model.Payout) *domainpayout.Payout`, a `PayoutToModel(*domainpayout.Payout) *model.Payout`, and a `PayoutsToDomain([]*model.Payout) []*domainpayout.Payout`. Reuse whatever null-handling helpers that file already defines rather than writing new ones.

- [ ] **Step 5: Run it and watch it pass**

```bash
go test -count=1 ./internal/adapter/persistence/mapper/ -run Payout
```

Expected: PASS, all three tests.

- [ ] **Step 6: Write the repository**

`internal/adapter/repository/payout/repository.go`, following `internal/adapter/repository/deposit/repository.go` for structure (embed `*base.BaseRepository`, a `payoutColumns` const, squirrel builders, `errs.WrapDatabaseError`).

`Insert` maps the unique-violation on `payouts_merchant_transaction` to `domainpayout.ErrDuplicateTransaction`. Read how `deposit.Repository.Insert` detects its own constraint violation and use the identical mechanism — do not invent a second way to recognise a PostgreSQL error.

`SetReservedFee` is a guarded update:

```go
// SetReservedFee is guarded on PENDING, not on the id alone. Only a payout
// that is still pending can be having its reservation recorded; if anything
// has already moved it on, this write is from a stale caller and must not
// silently overwrite a settled figure.
func (r *Repository) SetReservedFee(
	ctx context.Context, tx *sqlx.Tx, id uuid.UUID, fee decimal.Decimal,
) error {
	sqlStr, args, err := r.Builder.
		Update("payouts").
		Set("reserved_fee", fee).
		Set("updated_at", squirrel.Expr("NOW()")).
		Where(squirrel.Eq{"id": id, "status": domainpayout.StatusPending}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build set reserved fee query")
	}

	result, err := tx.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "set reserved fee")
	}

	return r.CheckRowsAffectedWith(result, domainpayout.ErrNotFound)
}
```

`GetByReference` filters on `merchant_id` **and** `reference_id` in its own WHERE clause and returns `ErrNotFound` for both "does not exist" and "belongs to someone else". `List` uses `base.ApplyPagination` and orders by `id DESC`.

- [ ] **Step 7: Write the SQL-pinning unit tests**

`internal/adapter/repository/payout/repository_test.go`, using go-sqlmock exactly as `internal/adapter/repository/deposit/repository_test.go` does. Pin the generated SQL for `GetByReference`, `List` and `SetReservedFee` with `ExpectQuery`/`ExpectExec` on the exact query text, and assert the bound arguments.

The `GetByReference` test must assert that **`merchant_id` is in the WHERE clause**, not only `reference_id`. That is the cross-tenant guarantee, and a query missing it would still pass every test that only checks the returned row.

- [ ] **Step 8: Run and commit**

```bash
go test -count=1 ./internal/adapter/persistence/mapper/ ./internal/adapter/repository/payout/
git add internal/adapter/persistence/model/payout.go internal/adapter/persistence/mapper/payout.go internal/adapter/persistence/mapper/payout_test.go internal/adapter/repository/payout/repository.go internal/adapter/repository/payout/repository_test.go
git commit -m "feat(payout): add the payout model, mapper and repository"
```

---

### Task 4: The `payout` config block

**Files:**
- Modify: `internal/shared/config.go` (the `Config` struct, and `setDefaults`)
- Modify: `config.yaml.example` (the TRACKED file — `config.yaml` itself is gitignored, see `.gitignore:32`)
- Test: `internal/shared/config_defaults_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `cfg.Payout.Enabled bool` and `cfg.Payout.SourceAccountID string`.

- [ ] **Step 1: Write the failing defaults test**

Append to `internal/shared/config_defaults_test.go`, matching the file's existing style:

```go
// Off by default, like every money-moving switch since P3. A payout that
// ships enabled would let a merchant reserve money against a phase that has
// no worker to spend it.
func TestDefaults_PayoutIsDisabled(t *testing.T) {
	cfg := loadDefaults(t)

	assert.False(t, cfg.Payout.Enabled, "payout.enabled must default to false")
	assert.Empty(t, cfg.Payout.SourceAccountID, "payout.source_account_id has no safe default")
}
```

Read the file first and use whatever helper it already has for loading defaults instead of `loadDefaults` if the name differs.

- [ ] **Step 2: Run it and watch it fail**

```bash
go test -count=1 ./internal/shared/ -run Payout
```

Expected: FAIL — `cfg.Payout undefined`.

- [ ] **Step 3: Add the config block**

In `internal/shared/config.go`, after the `Deposit` block:

```go
	Payout struct {
		// Enabled gates POST /payout/create entirely. DEFAULTS TO FALSE for
		// the reason deposit.ExpireSweepEnabled does, not the reason
		// statement.polling_enabled does: this switch calls no bank, but the
		// moment it is true a merchant can reserve real money against a
		// phase that has no worker to spend it. It turns on when P4b exists.
		Enabled bool `mapstructure:"enabled"`

		// SourceAccountID is the bank_accounts.id of the corporate account
		// payouts are paid from.
		//
		// The id rather than the name: bankaccount.Service has no lookup by
		// name, and bank_accounts.name -- though unique -- is editable, so a
		// rename in the back office would silently repoint every future
		// payout. GetByID already exists, so this adds no new port method.
		//
		// Named explicitly rather than routed by tier because there is
		// exactly one paying account -- the PRD's systemBankData reflects
		// that -- and because bank_accounts carries UNIQUE (bank_code,
		// account_no), so the one registered development account cannot hold
		// both an INBOUND and an OUTBOUND row. Development points this at
		// that INBOUND account; the service logs a warning and continues.
		// bankaccount.Router.SelectOutbound cannot serve this: it filters on
		// tier = 'OUTBOUND', of which there are none, and needs a balance
		// fresher than a refresh loop that is switched off.
		SourceAccountID string `mapstructure:"source_account_id"`
	} `mapstructure:"payout"`
```

In `setDefaults`:

```go
	v.SetDefault("payout.enabled", false)
	v.SetDefault("payout.source_account_id", "")
```

In **`config.yaml.example`** — not `config.yaml`, which is gitignored and reaches nobody — add the `payout:` block after the existing `deposit:` block, with `enabled: false` and `source_account_id: ""`. Match that file's comment style: its `deposit:` block explains *why* a switch is off, not merely that it is.

- [ ] **Step 4: Run it and watch it pass, then commit**

```bash
go test -count=1 ./internal/shared/
git add internal/shared/config.go internal/shared/config_defaults_test.go config.yaml.example
git commit -m "feat(payout): add the payout config block, disabled by default"
```

---

### Task 5: The create use case

This is the task the phase exists for. Two properties must come out of it correct: the balance guard actually serialises, and `reserved_fee` is what the ledger returned rather than anything this service computed.

**Files:**
- Create: `internal/service/payout/service.go`
- Test: `internal/service/payout/service_test.go`
- Test: `internal/service/payout/service_integration_test.go`

**Interfaces:**
- Consumes: `domainpayout.Repository`, `domainpayout.CreateData`, `domainbank.Service`, `*ledgersvc.Service`, `*tx.TransactionHelper`.
- Produces: `payout.NewService(...) *Service` with `Create`, `GetByReference`, `List`, satisfying `domainpayout.Service`.

- [ ] **Step 1: Write the service**

`internal/service/payout/service.go`:

```go
package payout

import (
	"context"
	"fmt"

	domainbank "be-maxpay/internal/domain/bankaccount"
	domainledger "be-maxpay/internal/domain/ledger"
	domainpayout "be-maxpay/internal/domain/payout"
	ledgersvc "be-maxpay/internal/service/ledger"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/crypto"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"go.uber.org/zap"
)

type Config struct {
	// Enabled gates Create. See shared.Config's own doc on payout.enabled.
	Enabled bool

	// SourceAccountID is the bank_accounts.id of the corporate account
	// payouts are paid from, as a string because config carries it as one.
	SourceAccountID string
}

// ledgerPoster is the slice of ledger.Service this package uses. Declared
// here as an interface, rather than taking *ledgersvc.Service, so the unit
// tests can substitute a fake without a database -- the same shape
// matcher.Service uses for its own ledger dependency.
type ledgerPoster interface {
	EnsureMerchantAccountLocked(
		ctx context.Context, tx *sqlx.Tx, merchantID uuid.UUID, kind domainledger.Kind,
	) (*domainledger.Account, error)

	PostPayoutCreated(
		ctx context.Context, tx *sqlx.Tx, in ledgersvc.PayoutInput,
	) (*domainledger.Entry, decimal.Decimal, error)
}

type Service struct {
	repo     domainpayout.Repository
	accounts domainbank.Service
	ledger   ledgerPoster
	tx       transactionHelper
	cfg      Config
	logger   *zap.Logger
}

// Create reserves a payout's money and records it, and touches no bank.
//
// ORDERING, because it is not free to choose. The reference id is generated
// before the transaction opens because PostPayoutCreated needs it as its
// ledger reference, and the reserved fee is written back in a second
// statement because PostPayoutCreated does not know it until it has run.
// Both writes are inside one transaction: a payout row with no reservation
// is money the merchant can spend twice, and a reservation with no payout
// row is money it can never spend again.
func (s *Service) Create(
	ctx context.Context, data domainpayout.CreateData,
) (*domainpayout.Payout, *domainbank.Account, error) {
	if !s.cfg.Enabled {
		return nil, nil, domainpayout.ErrPayoutDisabled
	}

	if err := domainpayout.ValidateCreate(data); err != nil {
		return nil, nil, err
	}

	account, err := s.sourceAccount(ctx)
	if err != nil {
		return nil, nil, err
	}

	reference, err := crypto.RandomCode(domainpayout.ReferenceLength)
	if err != nil {
		return nil, nil, fmt.Errorf("generate payout reference: %w", errs.ErrInternal)
	}

	var created *domainpayout.Payout

	err = s.tx.WithTx(ctx, func(tx *sqlx.Tx) error {
		// The guard, and the whole reason this runs in a transaction that
		// also does the posting. EnsureMerchantAccountLocked takes a row
		// lock on MERCHANT_OPERATE -- ledger_accounts.balance is a stored
		// column, so this is a real lock on the row PostPayoutCreated is
		// about to update, not an advisory one, and it is the SAME lock that
		// posting takes moments later in this same transaction.
		//
		// Two concurrent creates for one merchant therefore serialise here:
		// the second blocks until the first commits and then reads a balance
		// that already reflects the first reservation. Checking the balance
		// outside this transaction -- which is all ledger.MerchantBalances
		// can do, since it takes no tx -- would let both pass and overdraw.
		operate, err := s.ledger.EnsureMerchantAccountLocked(
			ctx, tx, data.MerchantID, domainledger.KindMerchantOperate)
		if err != nil {
			return err
		}

		row, err := s.repo.Insert(ctx, tx, &domainpayout.Payout{
			MerchantID: data.MerchantID, ClientID: data.ClientID,
			ReferenceID: reference, TransactionID: data.TransactionID,
			Status:        domainpayout.StatusPending,
			BankAccountID: account.ID,
			Amount:        data.Amount,
			// Zero until PostPayoutCreated says otherwise, three lines down.
			// The column is NOT NULL, so it needs a value now.
			ReservedFee:        decimal.Zero,
			RecipientAccountNo: data.RecipientAccountNo,
			RecipientBankCode:  data.RecipientBankCode,
			RecipientName:      data.RecipientName,
			RecipientPhone:     data.RecipientPhone,
			CallbackURL:        data.CallbackURL,
		})
		if err != nil {
			return err
		}

		_, fee, err := s.ledger.PostPayoutCreated(ctx, tx, ledgersvc.PayoutInput{
			MerchantID:    data.MerchantID,
			BankAccountID: account.ID,
			Amount:        data.Amount,
			Reference:     reference,
			// Deliberately nil: nil means "no expectation stated", and this
			// caller has none -- it is asking the ledger what the fee IS.
			// Supplying a figure we computed ourselves is the recomputation
			// ReservedFee exists to forbid.
			ReservedFee: nil,
		})
		if err != nil {
			return err
		}

		// Checked AFTER the posting, because the fee is not knowable before
		// it. The posting is rolled back with everything else when this
		// returns an error, so nothing is left behind -- and the alternative,
		// computing the fee here to check first, is the recomputation the
		// comment above refuses.
		if data.Amount.Add(fee).GreaterThan(operate.Balance) {
			return domainledger.ErrInsufficientBalance
		}

		if err := s.repo.SetReservedFee(ctx, tx, row.ID, fee); err != nil {
			return err
		}

		row.ReservedFee = fee
		created = row

		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	s.logger.Info("payout created",
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
		zap.String("reference_id", created.ReferenceID),
		zap.String("merchant_id", data.MerchantID.String()),
		zap.String("bank_account_id", account.ID.String()),
	)

	return created, account, nil
}

// sourceAccount resolves payout.source_account_id.
//
// A tier that is not OUTBOUND warns rather than refuses. There is no
// OUTBOUND account yet and development pays out of the one registered
// INBOUND account; refusing would make this phase untestable, and accepting
// silently would hide a production misconfiguration. A warning on every
// create is loud enough to notice and cheap enough to ignore in development.
func (s *Service) sourceAccount(ctx context.Context) (*domainbank.Account, error) {
	id, err := uuid.Parse(s.cfg.SourceAccountID)
	if err != nil {
		return nil, domainpayout.ErrNoSourceAccount
	}

	// GetByID, not a lookup by name: no port offers one, and an id cannot be
	// repointed by renaming an account in the back office.
	account, err := s.accounts.GetByID(ctx, id)
	if err != nil {
		return nil, domainpayout.ErrNoSourceAccount
	}
	if account.Status != domainbank.StatusActive {
		return nil, domainpayout.ErrNoSourceAccount
	}

	if account.Tier != domainbank.TierOutbound {
		s.logger.Warn("paying out of an account that is not OUTBOUND",
			zap.String("trace_id", shared.TraceIDFromContext(ctx)),
			zap.String("bank_account_id", account.ID.String()),
			zap.String("tier", string(account.Tier)),
		)
	}

	return account, nil
}
```

Add `"github.com/shopspring/decimal"` to the imports. Define `transactionHelper` as a one-method interface over `WithTx(ctx, func(*sqlx.Tx) error) error`, and write `NewService`, `GetByReference` and `List` (both plain delegations to the repository) following `internal/service/deposit/service.go`.

**`EnsureMerchantAccountLocked` does not exist yet.** Add it to `internal/service/ledger/service.go` as a thin composition of the two methods the repository already has:

```go
// EnsureMerchantAccountLocked ensures a merchant's account exists and
// returns it with a row lock held for the rest of tx, so its Balance can be
// read and acted on without another transaction moving it underneath.
//
// LockAccounts' own doc warns about lock ordering. One account is locked
// here, and it is always MERCHANT_OPERATE for the caller that needs this, so
// every contender takes the same first lock and they queue rather than
// deadlock. A caller locking several accounts this way must take them in id
// order, as LockAccounts itself does.
func (s *Service) EnsureMerchantAccountLocked(
	ctx context.Context, tx *sqlx.Tx, merchantID uuid.UUID, kind domainledger.Kind,
) (*domainledger.Account, error) {
	account, err := s.repo.EnsureMerchantAccount(ctx, tx, merchantID, kind)
	if err != nil {
		return nil, err
	}

	locked, err := s.repo.LockAccounts(ctx, tx, []uuid.UUID{account.ID})
	if err != nil {
		return nil, err
	}

	got, ok := locked[account.ID]
	if !ok {
		return nil, fmt.Errorf("ledger account %s vanished between ensure and lock: %w",
			account.ID, errs.ErrInternal)
	}

	return got, nil
}
```

- [ ] **Step 2: Write the unit tests**

`internal/service/payout/service_test.go`. Build fakes for the repository, the bank account service, the ledger and the transaction helper, following `internal/service/deposit/service_test.go`'s fakes. The ledger fake is the one that matters:

```go
// fakeLedger returns a fee that is neither zero nor equal to any amount the
// tests use. A fake returning zero makes "amount + fee > balance"
// indistinguishable from "amount > balance", and every mutation between the
// two survives; a fake returning the amount makes a mutation that reserves
// the amount twice invisible.
type fakeLedger struct {
	balance decimal.Decimal
	fee     decimal.Decimal

	lockedKind domainledger.Kind
	postedIn   *ledgersvc.PayoutInput
	postErr    error
}

func (f *fakeLedger) EnsureMerchantAccountLocked(
	_ context.Context, _ *sqlx.Tx, merchantID uuid.UUID, kind domainledger.Kind,
) (*domainledger.Account, error) {
	f.lockedKind = kind

	return &domainledger.Account{
		ID: uuid.New(), MerchantID: merchantID, Kind: kind, Balance: f.balance,
	}, nil
}

func (f *fakeLedger) PostPayoutCreated(
	_ context.Context, _ *sqlx.Tx, in ledgersvc.PayoutInput,
) (*domainledger.Entry, decimal.Decimal, error) {
	f.postedIn = &in
	if f.postErr != nil {
		return nil, decimal.Zero, f.postErr
	}

	return &domainledger.Entry{ID: uuid.New()}, f.fee, nil
}
```

One test written out in full, because it is the boundary the guard turns on:

```go
// The comparison is GreaterThan, not GreaterThanOrEqual: a merchant whose
// balance is exactly amount + fee can afford this payout and must not be
// refused. Both sides of the boundary are asserted, because a test that only
// checks the failing side passes against a guard that refuses everything.
func TestCreate_TheBalanceBoundaryIsInclusive(t *testing.T) {
	const amount = "100.00"
	fee := decimal.RequireFromString("2.50")

	exactly := decimal.RequireFromString(amount).Add(fee)
	oneSatangShort := exactly.Sub(decimal.RequireFromString("0.01"))

	t.Run("exactly enough succeeds", func(t *testing.T) {
		svc, repo, _ := newTestService(t, &fakeLedger{balance: exactly, fee: fee})

		created, _, err := svc.Create(context.Background(), createDataWithAmount(amount))
		require.NoError(t, err)
		assert.True(t, created.ReservedFee.Equal(fee),
			"the payout must carry the fee the ledger returned, got %s", created.ReservedFee)
		require.Len(t, repo.setFees, 1)
		assert.True(t, repo.setFees[0].Equal(fee),
			"SetReservedFee must be given the ledger's own figure")
	})

	t.Run("one satang short is refused", func(t *testing.T) {
		svc, repo, _ := newTestService(t, &fakeLedger{balance: oneSatangShort, fee: fee})

		_, _, err := svc.Create(context.Background(), createDataWithAmount(amount))
		require.ErrorIs(t, err, domainledger.ErrInsufficientBalance)
		assert.Empty(t, repo.setFees, "a refused payout must not have its fee recorded")
	})
}
```

Write `newTestService` and `createDataWithAmount` in the same file. The remaining coverage, each as its own test:

- `payout.enabled` false → `ErrPayoutDisabled`, and **the repository is never called**
- `source_account_id` empty, not a UUID, unknown, or not ACTIVE → `ErrNoSourceAccount`, repository never called
- a non-OUTBOUND tier → succeeds, and a warning is logged (assert with `zaptest`/`observer`)
- a validation failure → the matching sentinel, repository never called
- success → the returned payout carries the fee the fake ledger returned, and `SetReservedFee` was called with that same figure
- `EnsureMerchantAccountLocked` is called with `KindMerchantOperate`, not another kind
- `PostPayoutCreated` is given `ReservedFee: nil` — supplying a figure this service computed is the recomputation the field exists to forbid
- the reference id passed to `PostPayoutCreated` is the one written onto the row

- [ ] **Step 3: Run them**

```bash
go test -count=1 ./internal/service/payout/ ./internal/service/ledger/
```

Expected: PASS.

- [ ] **Step 4: Write the integration test that mocks cannot fake**

`internal/service/payout/service_integration_test.go`:

```go
//go:build integration
```

Two tests against a real database:

1. **`TestCreate_Integration_TwoConcurrentPayoutsCannotOverdrawOneMerchant`** — seed a merchant whose `MERCHANT_OPERATE` balance covers exactly one payout of the test amount plus its fee. Start two `Create` calls in two goroutines. Wait for both. Assert: exactly one returns nil error, exactly one returns `ErrInsufficientBalance`, `SELECT count(*) FROM payouts` is 1, and the merchant's operate balance afterwards is what one reservation leaves. Run it with `-race`. **A mock cannot fail this test** — it is the reason this test exists.

2. **`TestCreate_Integration_AFailureLeavesNoRowAndNoEntry`** — make the insufficient-balance branch fire, then assert `payouts` is empty **and** no `journal_entries` row carries this reference. The posting happens before the check, so this proves the rollback rather than assuming it.

- [ ] **Step 5: Run them and confirm they run rather than skip**

```bash
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
go test -tags=integration -race -count=1 -v -run 'TestCreate_Integration' ./internal/service/payout/ 2>&1 | grep -E '^(--- |ok|FAIL)'
```

Expected: two `--- PASS` lines. Not `ok` alone.

- [ ] **Step 6: Commit**

```bash
git add internal/service/payout/ internal/service/ledger/
git commit -m "feat(payout): reserve a payout's money behind a locked balance check"
```

---

### Task 6: The HTTP DTOs

**Files:**
- Create: `internal/adapter/http/merchantpayout/dto.go`
- Test: `internal/adapter/http/merchantpayout/dto_test.go`

**Interfaces:**
- Consumes: `domainpayout.Payout`, `domainbank.Account`.
- Produces: `createPayoutRequest`, `toCreatePayoutResponse(req createPayoutRequest, p *domainpayout.Payout, account *domainbank.Account) createPayoutResponse`, `toPayoutResponse(p *domainpayout.Payout, account *domainbank.Account) payoutData`.

- [ ] **Step 1: Write the DTOs**

Read `internal/adapter/http/merchantdeposit/dto.go` first and match its tag style and `json.Number` handling. Then:

```go
type createPayoutRequest struct {
	ClientID      string `json:"clientId" validate:"required"`
	MerchantID    string `json:"merchantId" validate:"required"`
	TransactionID string `json:"transactionId" validate:"required,max=128"`

	BankAccountNumber string `json:"bankAccountNumber" validate:"required,max=64"`
	// Amount is decoded through json.Number, never float64. The PRD sends it
	// as a number; float64 cannot represent every satang exactly, and this
	// is money.
	Amount   json.Number `json:"amount"`
	BankName string      `json:"bankName" validate:"required,max=32"`
	Name     string      `json:"name" validate:"required,max=200"`
	Phone    string      `json:"phone" validate:"omitempty,max=32"`

	CallbackURL string `json:"callbackUrl" validate:"required,max=2048"`
}
```

The response mirrors the PRD exactly: an outer `{status, message, data}` where `data` holds `clientId`, `merchantId`, `referenceId`, `transactionId`, `amount` (**string**), `status` (**lowercase**), `customerData{bankAccountNumber, bankName, name, phone}` and `systemBankData{bankAccountNumber, bankName, bankCode, name}`.

`status` lowercases the domain constant with `strings.ToLower`. Do not maintain a second table of lowercase spellings — one that drifts from the domain's is a bug nobody sees until a merchant does.

- [ ] **Step 2: Write the DTO tests**

`internal/adapter/http/merchantpayout/dto_test.go`:

```go
package merchantpayout

// Same package, not _test: these constructors are unexported.

import (
	"encoding/json"
	"testing"

	domainbank "be-maxpay/internal/domain/bankaccount"
	domainpayout "be-maxpay/internal/domain/payout"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The recipient's bank and the source account's bank are DIFFERENT here, and
// so are the two account numbers and the two names. If any pair coincided, a
// response that rendered the source account into customerData -- or the
// recipient into systemBankData -- would pass unnoticed.
func responseFixture() (createPayoutRequest, *domainpayout.Payout, *domainbank.Account) {
	req := createPayoutRequest{
		ClientID: "nHUxQbHgEu", MerchantID: "VOBM7qzaRH",
		TransactionID: "POP0PTB01776723e7X1",
	}
	p := &domainpayout.Payout{
		ID: uuid.New(), ReferenceID: "qS4EDxSWCO",
		TransactionID: "POP0PTB01776723e7X1",
		Status:        domainpayout.StatusPending,
		Amount:        decimal.RequireFromString("1000.5000"),
		RecipientAccountNo: "6640193604",
		RecipientBankCode:  "KTB",
		RecipientName:      "เฮง ร่ำรวย",
		RecipientPhone:     "",
	}
	account := &domainbank.Account{
		ID: uuid.New(), AccountNo: "1234567890",
		BankCode: "014", BankName: "SCB", AccountName: "บริษัท แม็กซ์เพย์ จำกัด",
	}

	return req, p, account
}

// The wire shape is a contract with an integrator who cannot be asked to
// change it, so this asserts the exact JSON against the PRD's own example
// rather than that the struct has fields with plausible names.
func TestToCreatePayoutResponse_MatchesThePRDShape(t *testing.T) {
	req, p, account := responseFixture()
	require.NotEqual(t, p.RecipientBankCode, account.BankCode,
		"the fixture must keep the recipient's bank and the source bank apart")

	body, err := json.Marshal(toCreatePayoutResponse(req, p, account))
	require.NoError(t, err)

	assert.JSONEq(t, `{
	  "status": "success",
	  "message": "Create Success",
	  "data": {
	    "clientId": "nHUxQbHgEu",
	    "merchantId": "VOBM7qzaRH",
	    "referenceId": "qS4EDxSWCO",
	    "transactionId": "POP0PTB01776723e7X1",
	    "amount": "1000.5",
	    "status": "pending",
	    "customerData": {
	      "bankAccountNumber": "6640193604",
	      "bankName": "KTB",
	      "name": "เฮง ร่ำรวย",
	      "phone": ""
	    },
	    "systemBankData": {
	      "bankAccountNumber": "1234567890",
	      "bankName": "SCB",
	      "bankCode": "014",
	      "name": "บริษัท แม็กซ์เพย์ จำกัด"
	    }
	  }
	}`, string(body))
}

// PENDING in the database, "pending" on the wire. Asserted for more than one
// status so a hardcoded "pending" cannot pass.
func TestToCreatePayoutResponse_LowercasesTheStatus(t *testing.T) {
	for domainStatus, wire := range map[string]string{
		domainpayout.StatusPending:   "pending",
		domainpayout.StatusCompleted: "completed",
		domainpayout.StatusRejected:  "rejected",
	} {
		req, p, account := responseFixture()
		p.Status = domainStatus

		got := toCreatePayoutResponse(req, p, account)
		assert.Equal(t, wire, got.Data.Status)
	}
}

// Money crosses the JSON edge as a string, so no satang is ever lost to a
// float. json.Marshal of a float64 1000.5000 would also render "1000.5",
// which is why the assertion above cannot stand alone: this one proves the
// field's Go type is a string before any encoder sees it.
func TestToCreatePayoutResponse_RendersTheAmountAsAString(t *testing.T) {
	req, p, account := responseFixture()
	p.Amount = decimal.RequireFromString("0.0001")

	got := toCreatePayoutResponse(req, p, account)

	assert.Equal(t, "0.0001", got.Data.Amount,
		"the smallest representable amount must survive the edge intact")
}
```

**`domainbank.Account` has no `BankName` field** — verified against
`internal/domain/bankaccount/entity.go:55`. Its real fields here are
`AccountNo`, `BankCode` and `AccountName`. The fixture above is wrong on
that point; correct it when implementing.

`bankName` comes from `bank.Mnemonic(account.BankCode)`
(`internal/shared/bank/mnemonic.go`), which is exactly what
`merchantdeposit/dto.go:141` already does for the deposit response. Follow
that precedent rather than introducing a second code-to-name mapping.

So `systemBankData` maps: `bankAccountNumber` ← `account.AccountNo`,
`bankName` ← `bank.Mnemonic(account.BankCode)`, `bankCode` ←
`account.BankCode`, `name` ← `account.AccountName`.

The fixture requirement stands regardless: no two fields in it may share a
value.

- [ ] **Step 3: Run and commit**

```bash
go test -count=1 ./internal/adapter/http/merchantpayout/
git add internal/adapter/http/merchantpayout/
git commit -m "feat(payout): add the merchant payout HTTP DTOs"
```

---

### Task 7: The HTTP handlers and routes

**Files:**
- Create: `internal/adapter/http/merchantpayout/handlers.go`
- Create: `internal/adapter/http/merchantpayout/routes.go`
- Test: `internal/adapter/http/merchantpayout/handlers_test.go`

**Interfaces:**
- Consumes: Task 6's DTOs, `domainpayout.Service`, `domainidempotency.Service`, `domaincredential.Service`.
- Produces: `NewHandler(...) *Handler`, `RegisterRoutes(p RouteParams)`.

- [ ] **Step 1: Write the handler**

Open `internal/adapter/http/merchantdeposit/handlers.go` and follow `create` **step for step**. Every guard in it was found by a security review, not designed in, and this endpoint needs each one:

1. `middleware.MerchantFromContext` → 401 if absent
2. `middleware.SignedBodyFromContext` → 401 if absent; this is the exact byte sequence `Begin` and `Finish` must agree on
3. `json.Unmarshal` into `createPayoutRequest` → `errs.ErrInvalidJSON`
4. `h.v.Struct(req)` → 400 with `shared.FormatValidationErrorsToString`
5. refuse a non-HTTPS `callbackUrl` case-insensitively, **before** the service
6. `req.MerchantID != authenticated.Code` → `errs.ErrForbidden`
7. `h.creds.GetClient(ctx, req.ClientID)`, then `client.MerchantID != authenticated.ID` → `errs.ErrForbidden`
8. `parseAmount(req.Amount)` → `fmt.Errorf("amount: %w", errs.ErrInvalidInput)`
9. `h.idem.Begin(ctx, authenticated.ID, req.TransactionID, body)`; on `IsReplay`, `c.Data(replay.Code, "application/json; charset=utf-8", replay.Body)` and return
10. `h.payout.Create(ctx, ...)`
11. on error: `resp.ErrorBody(err)`, then `Release` for retryable failures and `Finish` for terminal ones, then `resp.Error(c, err)`
12. on success: marshal, `c.Data(http.StatusCreated, ...)`, then best-effort `Finish` with `_ = c.Error(...)` on failure

`isRetryable` for payouts: `ErrPayoutDisabled` and `ErrNoSourceAccount` are retryable (no row exists, and the condition is ours to fix). `ErrInsufficientBalance` is **also retryable** — no payout row exists behind it, and the merchant can top up and try the same order again. Everything else is terminal.

`getByReference` and `list` follow `merchantdeposit`'s own, including the reason its doc gives for **not** adding an ownership check on the result: a mismatch answering 403 instead of 404 would confirm that another merchant's reference id is real.

- [ ] **Step 2: Write the routes**

```go
func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Payouts, p.Idem, p.Creds, p.V)

	root := routing.MerchantGroup(p.Router, p.Creds, p.Merchants)

	payout := root.Group("/payout")
	{
		// SignatureRequired guards only this route: money moves here.
		payout.POST("/create", middleware.SignatureRequired(p.Sigs, p.Creds), h.create)
		payout.GET("/:reference_id", h.getByReference)
	}

	// Registered on root directly: "payouts" is not a child path of
	// "/payout", so there is no group to nest it under -- the same shape
	// merchantdeposit uses for GET /deposits.
	root.GET("/payouts", h.list)
}
```

- [ ] **Step 3: Write the handler tests**

`internal/adapter/http/merchantpayout/handlers_test.go`, following `merchantdeposit/handlers_test.go`'s router harness. Required coverage:

- a valid create → 201 and the PRD body
- `merchantId` naming another merchant → 403, **and the service is never called**
- `clientId` belonging to another merchant → 403, **and the service is never called**
- `http://` callback → 400, service never called
- a replayed `transactionId` → the recorded response, and `Create` is called **once** across both requests
- `ErrInsufficientBalance` → 422 and the claim is **released**, so a second attempt reaches `Create` again
- a terminal error → the claim is **finished**, so a second attempt replays instead of re-running
- **`TestGetByReference_CrossTenantReadReturns404NotForbidden`** — another merchant's reference must answer 404, never 403

- [ ] **Step 4: Run and commit**

```bash
go test -count=1 ./internal/adapter/http/merchantpayout/
git add internal/adapter/http/merchantpayout/
git commit -m "feat(payout): add POST /payout/create and the two read endpoints"
```

---

### Task 8: fx wiring and the end-to-end proof

**Files:**
- Modify: `internal/adapter/repository/module.go`
- Modify: `internal/service/module.go`
- Modify: `internal/adapter/http/module.go`
- Test: `internal/adapter/http/merchantpayout/e2e_integration_test.go`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a running application serving the three routes.

- [ ] **Step 1: Wire the repository**

In `internal/adapter/repository/module.go`, add `fx.Annotate(payoutrepo.NewRepository, fx.As(new(payout.Repository)))` alongside the deposit repository's line.

- [ ] **Step 2: Wire the service**

In `internal/service/module.go`, add the constructor beside `NewDepositService`:

```go
// NewPayoutService reads the operator policy for payout creation from
// config, for the reason NewDepositService's own comment gives.
func NewPayoutService(
	repo payout.Repository, accounts bankaccount.Service, ledgerSvc *ledgersvc.Service,
	txHelper *tx.TransactionHelper, cfg *shared.Config, logger *zap.Logger,
) payout.Service {
	return payoutsvc.NewService(repo, accounts, ledgerSvc, txHelper, payoutsvc.Config{
		Enabled:         cfg.Payout.Enabled,
		SourceAccountID: cfg.Payout.SourceAccountID,
	}, logger)
}
```

and `fx.Annotate(NewPayoutService, fx.As(new(payout.Service)))` to the provide list.

- [ ] **Step 3: Wire the routes**

In `internal/adapter/http/module.go`, invoke `merchantpayout.RegisterRoutes` beside `merchantdeposit.RegisterRoutes`.

- [ ] **Step 4: Prove the app still starts**

```bash
go build ./... && go run ./cmd/api --help 2>&1 | head -5
```

Expected: no fx graph error. If the binary has no `--help`, start it and confirm it reaches "listening" in the log, then stop it.

- [ ] **Step 5: Write the end-to-end integration test**

`internal/adapter/http/merchantpayout/e2e_integration_test.go`, build tag `integration`, following whatever end-to-end harness `merchantdeposit` already has. One test, the whole path: a real signed request against a real database creates a payout, the response matches the PRD shape, `payouts` holds one `PENDING` row, and the merchant's `MERCHANT_PENDING_PAYOUT` balance equals amount plus the reserved fee while `MERCHANT_OPERATE` has fallen by the same figure.

Assert the two ledger balances explicitly. A test that only checks the HTTP response proves the endpoint answers, not that the money moved.

- [ ] **Step 6: Document it**

Add a "Payouts" section to `README.md` next to the Deposits section: the three endpoints, `payout.enabled` and `payout.source_account_id`, that P4a never contacts a bank, and that a created payout stays `PENDING` with its money reserved until P4b exists.

- [ ] **Step 7: Run the full gates**

```bash
make check
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
make test-integration
```

Expected: both exit 0, no `FAIL` lines.

- [ ] **Step 8: Commit**

```bash
git add internal/adapter/repository/module.go internal/service/module.go internal/adapter/http/module.go internal/adapter/http/merchantpayout/e2e_integration_test.go README.md
git commit -m "feat(payout): wire the payout feature into the application"
```

---

## Integration test hygiene

**Every integration test truncates what it writes, before it writes.** Call
`pgtest.Truncate(t, db, ...)` immediately after `pgtest.DB(t)`, following
whatever tables and order `internal/adapter/repository/deposit/integration_test.go`
already uses for the same problem — including how it handles the foreign keys
from `payouts` to `merchants`, `merchant_clients` and `bank_accounts`.

This was found the hard way in Task 1: tests with fixed literal
`reference_id` values and no truncate pass once and then fail on
`payouts_reference_id_key` on every run after, which looks like a broken
assertion and is not one. **Prove idempotence by running the file twice in
the same shell with no manual cleanup between runs**, and confirm both runs
print the same `--- PASS` lines. A single green run does not demonstrate it.

## Verification Discipline

This applies to every task and to every reviewer, and it is the practice that found nearly every real defect through P3.

**Reviewers design their own mutations.** Do not work from a list in this plan — there deliberately is none. Aim at whatever you judge least well pinned, run at least two mutations of your own, and treat a survivor as a finding about the tests, not about the code.

Measured history, so the instruction is taken seriously: one P3 task shipped with a clean mandated mutation table and a 19-test suite; a reviewer told to invent its own found **four survivors, none on the list** — including one that turned every customer deposit into a debit. Another survived all 27 tests including `-tags=integration`.

Run mutations with `go test -overlay` against **modified copies**, never edits to tracked files:

```bash
cp internal/service/payout/service.go /tmp/mut.go
# edit /tmp/mut.go
echo '{"Replace": {"'$PWD'/internal/service/payout/service.go": "/tmp/mut.go"}}' > /tmp/mut.json
go test -count=1 -overlay=/tmp/mut.json ./internal/service/payout/
```

**Traps this codebase has actually hit, all worth checking directly:**

- **A fixture that makes two values coincide silently disarms every swap mutation between them.** The most frequent trap of all. Here that means: amount equal to reserved fee, the recipient's bank equal to the source account's bank, two uuid fields holding one uuid. Assert the difference with `require.NotEqual` so a later edit cannot quietly re-align them.
- **An assertion satisfied by Go's zero value pins nothing.** `assert.Empty`, `assert.False`, `assert.Zero` on a field that is never set will pass against a mapper that ignores the column entirely.
- **`SKIP` is reported as `ok`.** A missing `TEST_DATABASE_URL` skips every integration test and the package still prints `ok`. Always confirm `--- PASS` lines by name.
- **An integration test can pass for a reason unrelated to the code.** Run `EXPLAIN` before believing any claim that an index serves a query.
- **A test that builds its expected value by calling the function under test proves only that the function is deterministic.**

## Notes for the executor

- Never run anything against the `maxpay` development database. It holds a bank device registered against a live corporate login that cannot be recreated without sending the account holder another OTP. Tests use `maxpay_test` through `TEST_DATABASE_URL`.
- Never run `make docker-up` from a worktree.
- `go build ./... | head -5 && echo OK` prints OK regardless of the build result, because `head` succeeds. Capture the output and test it for emptiness instead.
- When a task's plan text disagrees with the code you find, the spec is the authority and the plan is its argument. Say so in your report rather than silently picking one.
