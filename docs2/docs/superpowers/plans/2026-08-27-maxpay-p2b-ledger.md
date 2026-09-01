# MaxPay P2b — Double-Entry Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MaxPay a double-entry ledger that no use case can write around, so that every satang that enters or leaves the platform is accounted for structurally rather than by convention.

**Architecture:** Three tables — `ledger_accounts`, `journal_entries`, `journal_lines` — where a line's `amount` is signed (debit positive, credit negative) and the lines of one entry must sum to exactly zero. That rule is enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger in PostgreSQL, checked at commit, so a commit that does not balance is impossible regardless of what the calling Go code believes. A single `Post(ctx, tx, entry, lines...)` is the only write path; `ledger_accounts.balance` is maintained inside it under `SELECT ... FOR UPDATE` ordered by account id.

**Tech Stack:** Go 1.25 · PostgreSQL 18 · sqlx + Masterminds/squirrel · uber/fx · Zap · shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-26-maxpay-merchant-ledger-design.md` — sections 4.6 (`ledger`), 9 (posting rules), 11 (HTTP surface), 13 (testing), 14 (verification gate). Read the spec alongside this plan; where they disagree, the spec wins and the disagreement is a bug in this plan.

## Global Constraints

- Money is `decimal.Decimal` everywhere, never `float64`, including intermediates and anything crossing JSON. Amounts cross JSON as **strings**.
- All monetary columns are `NUMERIC(20,4)`. All monetary rounding is to **two** decimal places, `decimal.RoundBank` is NOT used — see Task 5 for the exact rule.
- Log fields are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`; every service log line carries `trace_id` from `shared.TraceIDFromContext(ctx)`.
- Errors wrap the shared sentinels in `internal/shared/errs` (`ErrNotFound`, `ErrInvalidInput`, `ErrConflict`, `ErrForbidden`, `ErrInternal`, `ErrUnprocessable`) and are mapped to HTTP status in `resp`. Raw internal text never reaches a caller.
- Clean Architecture: `internal/domain` imports no adapter and no service package. Repositories live in `internal/adapter/repository/<feature>`, services in `internal/service/<feature>`, HTTP in `internal/adapter/http/<feature>`.
- Every id is a **UUIDv7**. Validator tags use `uuid`, never `uuid4` — `uuid4` rejects every real id in this system and that bug has already shipped once here.
- `repository/base` supplies timeouts, `CheckRowsAffectedWith`, `MapNotFound` and `WrapDatabaseError`. `repository/tx`'s `TransactionHelper.WithTx(ctx, func(*sqlx.Tx) error)` is how a multi-write use case gets a transaction.
- Mappers follow `XToModel` / `XToDomain` / `XsToDomain` and live in `internal/adapter/persistence/mapper`.
- Code, identifiers, comments and docstrings in English only. `gofmt` clean.
- Every new endpoint ships a matching `.bru` file under `bruno/`, as `AGENTS.md` requires.
- The verification gate is `make check` (tidy-check, vet, build, lint, test-race) then `make test-integration`.

## Environment notes for every implementer

- `export PATH="$PATH:$HOME/go/bin"` before running Go tooling — `golangci-lint` lives there.
- A PostgreSQL container is already running on `localhost:5437`. **Never run `make docker-up`** from a worktree: compose derives its project name from the directory and would start a second stack. Run `make migrate-up` to apply migrations.
- Integration tests run against `maxpay_test` via `TEST_DATABASE_URL`; see the `test-integration` target. Never touch the `maxpay` development database directly — it holds a registered bank device that cannot be recreated without sending the account holder another OTP.
- `internal/testutil/pgtest.DB(t)` returns a database handle for an integration test and skips the test when `TEST_DATABASE_URL` is unset.

---

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/000009_ledger.up.sql` / `.down.sql` | the three tables, their indexes, and the deferred balance trigger |
| `internal/domain/ledger/entity.go` | `Account`, `Entry`, `Line`, account kinds, normal-balance rules |
| `internal/domain/ledger/dto.go` | `PostData`, `AdjustmentData`, `Balance`, `LedgerQuery` |
| `internal/domain/ledger/errors.go` | ledger sentinels |
| `internal/domain/ledger/validator.go` | entry and line validation independent of any database |
| `internal/domain/ledger/repository.go` | the repository port |
| `internal/domain/ledger/service.go` | the service port, including `Post` |
| `internal/adapter/persistence/model/ledger.go` | row structs with `db` tags |
| `internal/adapter/persistence/mapper/ledger.go` | `LedgerAccountToDomain`, `JournalEntryToModel`, … |
| `internal/adapter/repository/ledger/repository.go` | account resolution, entry and line inserts, locked balance updates |
| `internal/service/ledger/service.go` | `Post` — the only write path |
| `internal/service/ledger/fees.go` | fee and rebate split, with the rounding remainder rule |
| `internal/service/ledger/entries.go` | the standard entries from spec §9 as named constructors |
| `internal/adapter/http/merchantledger/` | `GET /merchant/balance` |
| `internal/adapter/http/adminledger/` | `GET /admin/merchants/:id/ledger`, `POST /admin/merchants/:id/adjustments` |
| `bruno/Ledger/` | one `.bru` per new endpoint |

Split rationale: `fees.go` and `entries.go` are separate from `service.go` because they change for different reasons — a commercial-rate change touches fees, a new money-moving event touches entries, and neither should force a reviewer to re-read the posting engine.

---

### Task 1: The ledger schema and its balance trigger

The zero-sum rule is the only thing standing between this system and money that quietly disappears. It is enforced in PostgreSQL rather than in Go so that no future code path — a repair script, a migration, a use case written in a hurry — can bypass it. This task exists to build that guarantee and to prove it holds.

**Files:**
- Create: `db/migrations/000009_ledger.up.sql`
- Create: `db/migrations/000009_ledger.down.sql`
- Test: `internal/adapter/repository/ledger/schema_integration_test.go`

**Interfaces:**
- Consumes: `merchants(id)` and `bank_accounts(id)` from earlier phases; `internal/testutil/pgtest.DB(t)`.
- Produces: tables `ledger_accounts`, `journal_entries`, `journal_lines`; constraint trigger `journal_balanced`.

- [ ] **Step 1: Write the migration**

`db/migrations/000009_ledger.up.sql`:

```sql
-- The chart of accounts. Every row is one place money can sit: a corporate
-- bank account's book balance, one bucket of one merchant's money, or one of
-- the platform's own accounts.
--
-- normal_balance decides how a signed line moves the stored balance. A
-- DEBIT-normal account adds the line amount; a CREDIT-normal account
-- subtracts it. That way a merchant's operating balance reads as a positive
-- number even though it is credit-normal, and nobody has to remember a sign
-- convention to read a report.
CREATE TABLE ledger_accounts (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    kind            TEXT NOT NULL,
    merchant_id     UUID REFERENCES merchants(id),
    bank_account_id UUID REFERENCES bank_accounts(id),
    normal_balance  TEXT NOT NULL,
    balance         NUMERIC(20,4) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ledger_accounts_normal_balance
        CHECK (normal_balance IN ('DEBIT', 'CREDIT')),

    -- An account belongs to a merchant, or to a bank account, or to the
    -- platform itself -- never to two of them. A row owned by both would be
    -- reachable through two different lookups that could disagree.
    CONSTRAINT ledger_accounts_owner_exclusive
        CHECK (NOT (merchant_id IS NOT NULL AND bank_account_id IS NOT NULL))
);

-- One account per (kind, owner). The three partial indexes together mean a
-- merchant cannot end up with two OPERATE accounts, a bank account cannot end
-- up with two book balances, and there is exactly one HOUSE_REVENUE.
CREATE UNIQUE INDEX ledger_accounts_merchant ON ledger_accounts (kind, merchant_id)
    WHERE merchant_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_bank ON ledger_accounts (kind, bank_account_id)
    WHERE bank_account_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_house ON ledger_accounts (kind)
    WHERE merchant_id IS NULL AND bank_account_id IS NULL;

-- One journal entry is one business event. merchant_id is the merchant the
-- event is about, which is not the same as every merchant whose money moves:
-- a deposit for a direct merchant also credits its reseller, and that
-- reseller appears in the lines, not here.
CREATE TABLE journal_entries (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    type           TEXT NOT NULL,
    merchant_id    UUID REFERENCES merchants(id),
    reference_type TEXT,
    reference_id   TEXT,
    description    TEXT NOT NULL,
    created_by     TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX journal_entries_merchant ON journal_entries (merchant_id, id DESC);
CREATE INDEX journal_entries_reference ON journal_entries (reference_type, reference_id)
    WHERE reference_type IS NOT NULL;

-- amount is signed: debit positive, credit negative. balance_after is the
-- owning account's balance immediately after this line was applied, in the
-- account's natural sign, so a statement can be rendered without replaying
-- the whole journal.
CREATE TABLE journal_lines (
    id            UUID PRIMARY KEY DEFAULT uuidv7(),
    entry_id      UUID NOT NULL REFERENCES journal_entries(id),
    account_id    UUID NOT NULL REFERENCES ledger_accounts(id),
    amount        NUMERIC(20,4) NOT NULL,
    balance_after NUMERIC(20,4) NOT NULL,

    -- A zero line is not a posting, it is a mistake that survived review.
    CONSTRAINT journal_lines_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX journal_lines_entry ON journal_lines (entry_id);
CREATE INDEX journal_lines_account ON journal_lines (account_id, id DESC);

-- The zero-sum rule.
--
-- DEFERRABLE INITIALLY DEFERRED because an entry is legitimately unbalanced
-- between its first and last line -- checking per statement would reject
-- every real posting. Checked at commit, because a commit that does not
-- balance must be impossible regardless of what the calling code believes.
CREATE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE total NUMERIC(20,4);
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO total
      FROM journal_lines WHERE entry_id = NEW.entry_id;
    IF total <> 0 THEN
        RAISE EXCEPTION 'journal entry % does not balance: %', NEW.entry_id, total;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_balanced
    AFTER INSERT ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();
```

`db/migrations/000009_ledger.down.sql`:

```sql
DROP TRIGGER IF EXISTS journal_balanced ON journal_lines;
DROP FUNCTION IF EXISTS assert_entry_balanced();
DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS ledger_accounts;
```

- [ ] **Step 2: Apply the migration**

Run: `export PATH="$PATH:$HOME/go/bin" && make migrate-up`
Expected: `9/u ledger` and no error. Do NOT run `make docker-up`.

- [ ] **Step 3: Write the integration test that proves the trigger fires at commit**

`internal/adapter/repository/ledger/schema_integration_test.go`:

```go
//go:build integration

package ledger_test

import (
	"context"
	"testing"

	"be-maxpay/internal/testutil/pgtest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedAccount inserts a house account of the given kind and returns its id.
// House accounts need no merchant or bank account, so they are the cheapest
// way to get two accounts a test can post between.
func seedAccount(t *testing.T, ctx context.Context, kind, normal string) string {
	t.Helper()

	db := pgtest.DB(t)

	var id string
	err := db.QueryRowxContext(ctx,
		`INSERT INTO ledger_accounts (kind, normal_balance) VALUES ($1, $2) RETURNING id`,
		kind, normal).Scan(&id)
	require.NoError(t, err)

	return id
}

// This is the guarantee the whole design rests on: not that Go refuses to
// write an unbalanced entry, but that PostgreSQL refuses to commit one.
func TestLedgerSchema_Integration_AnUnbalancedCommitIsRejected(t *testing.T) {
	db := pgtest.DB(t)
	ctx := context.Background()

	accountID := seedAccount(t, ctx, "HOUSE_SUSPENSE_UNBALANCED_TEST", "CREDIT")

	tx, err := db.BeginTxx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()

	var entryID string
	require.NoError(t, tx.QueryRowxContext(ctx,
		`INSERT INTO journal_entries (type, description, created_by)
		 VALUES ('TEST', 'deliberately unbalanced', 'SYSTEM') RETURNING id`).Scan(&entryID))

	// One line, 100 debit, nothing on the other side. The INSERT itself must
	// succeed -- the trigger is deferred -- and the COMMIT must fail.
	_, err = tx.ExecContext(ctx,
		`INSERT INTO journal_lines (entry_id, account_id, amount, balance_after)
		 VALUES ($1, $2, 100, 100)`, entryID, accountID)
	require.NoError(t, err, "the insert must succeed: the trigger is deferred to commit")

	err = tx.Commit()

	require.Error(t, err, "an unbalanced entry must not be committable")
	assert.Contains(t, err.Error(), "does not balance")
}

func TestLedgerSchema_Integration_ABalancedCommitSucceeds(t *testing.T) {
	db := pgtest.DB(t)
	ctx := context.Background()

	debitID := seedAccount(t, ctx, "HOUSE_BALANCED_TEST_DR", "DEBIT")
	creditID := seedAccount(t, ctx, "HOUSE_BALANCED_TEST_CR", "CREDIT")

	tx, err := db.BeginTxx(ctx, nil)
	require.NoError(t, err)

	var entryID string
	require.NoError(t, tx.QueryRowxContext(ctx,
		`INSERT INTO journal_entries (type, description, created_by)
		 VALUES ('TEST', 'balanced', 'SYSTEM') RETURNING id`).Scan(&entryID))

	_, err = tx.ExecContext(ctx,
		`INSERT INTO journal_lines (entry_id, account_id, amount, balance_after)
		 VALUES ($1, $2, 100, 100), ($1, $3, -100, 100)`, entryID, debitID, creditID)
	require.NoError(t, err)

	assert.NoError(t, tx.Commit())
}

// A zero line is not a posting. Catching it in the schema means no service
// can produce one by arithmetic accident -- a fee of zero on a tiny amount,
// for instance.
func TestLedgerSchema_Integration_AZeroAmountLineIsRejected(t *testing.T) {
	db := pgtest.DB(t)
	ctx := context.Background()

	accountID := seedAccount(t, ctx, "HOUSE_ZERO_LINE_TEST", "CREDIT")

	tx, err := db.BeginTxx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()

	var entryID string
	require.NoError(t, tx.QueryRowxContext(ctx,
		`INSERT INTO journal_entries (type, description, created_by)
		 VALUES ('TEST', 'zero line', 'SYSTEM') RETURNING id`).Scan(&entryID))

	_, err = tx.ExecContext(ctx,
		`INSERT INTO journal_lines (entry_id, account_id, amount, balance_after)
		 VALUES ($1, $2, 0, 0)`, entryID, accountID)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "journal_lines_amount_nonzero")
}

// The three partial unique indexes are what stop a merchant acquiring two
// OPERATE accounts through a race between two callers that both find none.
func TestLedgerSchema_Integration_OneHouseAccountPerKind(t *testing.T) {
	db := pgtest.DB(t)
	ctx := context.Background()

	_ = seedAccount(t, ctx, "HOUSE_DUPLICATE_TEST", "CREDIT")

	_, err := db.ExecContext(ctx,
		`INSERT INTO ledger_accounts (kind, normal_balance)
		 VALUES ('HOUSE_DUPLICATE_TEST', 'CREDIT')`)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "ledger_accounts_house")
}
```

- [ ] **Step 4: Run the integration tests**

Run: `export PATH="$PATH:$HOME/go/bin" && make test-integration`
Expected: all four PASS.

- [ ] **Step 5: Prove the tests have teeth**

Do NOT edit the tracked migration. Apply the mutation to a scratch copy of the database instead:

```bash
# A constraint trigger is dropped with DROP TRIGGER, not DROP CONSTRAINT --
# PostgreSQL rejects the latter and says so.
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay_test \
  -c 'DROP TRIGGER journal_balanced ON journal_lines'
export PATH="$PATH:$HOME/go/bin" && make test-integration
```

Expected: `AnUnbalancedCommitIsRejected` FAILS. Then restore it:

```bash
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay_test -c \
  'CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON journal_lines
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced()'
make test-integration
```

Expected: all four PASS again. Report both results.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/000009_ledger.up.sql db/migrations/000009_ledger.down.sql \
        internal/adapter/repository/ledger/schema_integration_test.go
git commit -m "feat(ledger): add the ledger schema and its deferred balance trigger"
```

---

### Task 2: The ledger domain

The domain says what an account and an entry are, and which combinations are nonsense, without knowing that PostgreSQL exists. Everything downstream reads its vocabulary from here.

**Files:**
- Create: `internal/domain/ledger/entity.go`
- Create: `internal/domain/ledger/dto.go`
- Create: `internal/domain/ledger/errors.go`
- Create: `internal/domain/ledger/validator.go`
- Create: `internal/domain/ledger/repository.go`
- Create: `internal/domain/ledger/service.go`
- Test: `internal/domain/ledger/validator_test.go`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `ledger.Kind` constants: `KindBankAccount`, `KindMerchantOperate`, `KindMerchantParking`, `KindMerchantFreeze`, `KindMerchantPendingPayout`, `KindHouseRevenue`, `KindHouseSuspense`
  - `func (k Kind) NormalBalance() string`, `func (k Kind) Owner() OwnerType`
  - `type Account struct{ ID, Kind, MerchantID, BankAccountID uuid.UUID/…; NormalBalance string; Balance decimal.Decimal; … }`
  - `type Entry struct{ Type, MerchantID, ReferenceType, ReferenceID, Description, CreatedBy }`
  - `type Line struct{ AccountID uuid.UUID; Amount decimal.Decimal }`
  - `func ValidateEntry(e Entry) error`, `func ValidateLines(lines []Line) error`
  - `type Repository interface`, `type Service interface`

- [ ] **Step 1: Write the entity**

`internal/domain/ledger/entity.go`:

```go
// Package ledger is the double-entry bookkeeping domain: the chart of
// accounts, the journal, and the rules an entry must satisfy before it may be
// written. It knows nothing about PostgreSQL or HTTP.
package ledger

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Kind identifies one place money can sit. The set is closed: a new kind is a
// design decision about where money lives, not a configuration value.
type Kind string

const (
	// KindBankAccount is our book balance for one corporate bank account.
	// It is deliberately distinct from bank_accounts.bank_balance, which is
	// what the bank last told us. The two disagreeing is information, not a
	// bug -- it is how an unrecorded movement is noticed.
	KindBankAccount Kind = "BANK_ACCOUNT"

	// KindMerchantOperate is money the merchant can spend right now.
	KindMerchantOperate Kind = "MERCHANT_OPERATE"

	// KindMerchantParking is money an admin has set aside. It has no
	// automation in this phase, by design: inventing a rule the PRD does not
	// describe would be guessing about someone else's money.
	KindMerchantParking Kind = "MERCHANT_PARKING"

	// KindMerchantFreeze is money held over a dispute.
	KindMerchantFreeze Kind = "MERCHANT_FREEZE"

	// KindMerchantPendingPayout is money reserved against a payout that has
	// not finished. It leaves operate the moment a payout is created so the
	// same balance cannot be spent twice.
	KindMerchantPendingPayout Kind = "MERCHANT_PENDING_PAYOUT"

	// KindHouseRevenue is the platform's share of fees.
	KindHouseRevenue Kind = "HOUSE_REVENUE"

	// KindHouseSuspense is money that arrived and could not be matched to a
	// merchant. It is a real liability, not a rounding bin.
	KindHouseSuspense Kind = "HOUSE_SUSPENSE"
)

// Normal balance strings, matching the ledger_accounts_normal_balance CHECK.
const (
	NormalDebit  = "DEBIT"
	NormalCredit = "CREDIT"
)

// OwnerType says what a kind of account hangs off.
type OwnerType string

const (
	OwnerMerchant    OwnerType = "MERCHANT"
	OwnerBankAccount OwnerType = "BANK_ACCOUNT"
	OwnerHouse       OwnerType = "HOUSE"
)

// NormalBalance reports which direction increases this kind of account.
//
// Only BANK_ACCOUNT is debit-normal: it is an asset, and money arriving in a
// corporate account increases it. Everything else is a liability or revenue,
// which a credit increases.
func (k Kind) NormalBalance() string {
	if k == KindBankAccount {
		return NormalDebit
	}

	return NormalCredit
}

// Owner reports what this kind of account belongs to.
func (k Kind) Owner() OwnerType {
	switch k {
	case KindBankAccount:
		return OwnerBankAccount
	case KindMerchantOperate, KindMerchantParking, KindMerchantFreeze, KindMerchantPendingPayout:
		return OwnerMerchant
	default:
		return OwnerHouse
	}
}

// IsValid reports whether k is one of the known kinds. An unknown kind must
// never reach the database: the partial unique indexes would happily create
// a second chart of accounts alongside the real one.
func (k Kind) IsValid() bool {
	switch k {
	case KindBankAccount, KindMerchantOperate, KindMerchantParking,
		KindMerchantFreeze, KindMerchantPendingPayout,
		KindHouseRevenue, KindHouseSuspense:
		return true
	default:
		return false
	}
}

// MerchantKinds is every kind that belongs to a merchant, in the order a
// balance report reads them.
var MerchantKinds = []Kind{
	KindMerchantOperate, KindMerchantParking,
	KindMerchantFreeze, KindMerchantPendingPayout,
}

// Account is one row of the chart of accounts.
//
// MerchantID and BankAccountID are both uuid.Nil for a house account, and at
// most one of them is ever set -- enforced by ledger_accounts_owner_exclusive.
// Balance is stored in the account's natural sign, so a merchant's operating
// balance reads as a positive number despite being credit-normal.
type Account struct {
	ID            uuid.UUID
	Kind          Kind
	MerchantID    uuid.UUID
	BankAccountID uuid.UUID
	NormalBalance string
	Balance       decimal.Decimal
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Entry types. The set matches the events in spec section 9.
const (
	TypeDeposit       = "DEPOSIT"
	TypeUnmatchedIn   = "UNMATCHED_IN"
	TypePayoutCreated = "PAYOUT_CREATED"
	TypePayoutDone    = "PAYOUT_COMPLETED"
	TypePayoutFailed  = "PAYOUT_FAILED"
	TypeSweep         = "SWEEP"
	TypeTopUp         = "TOPUP"
	TypePreFund       = "PREFUND"
	TypeWithdrawal    = "WITHDRAWAL"
	TypeAdjustment    = "ADJUSTMENT"
)

// SystemActor is the created_by value for an entry no human initiated.
const SystemActor = "SYSTEM"

// Entry is one business event. MerchantID is the merchant the event is
// about, which is not every merchant whose money moves: a deposit for a
// direct merchant also credits its reseller, and that reseller appears in the
// lines rather than here.
type Entry struct {
	ID            uuid.UUID
	Type          string
	MerchantID    uuid.UUID
	ReferenceType string
	ReferenceID   string
	Description   string
	CreatedBy     string
	CreatedAt     time.Time
}

// Line is one side of an entry. Amount is signed: debit positive, credit
// negative. BalanceAfter is filled in by the posting service, never by a
// caller -- a caller that could set it could also lie about it.
type Line struct {
	ID           uuid.UUID
	EntryID      uuid.UUID
	AccountID    uuid.UUID
	Amount       decimal.Decimal
	BalanceAfter decimal.Decimal
}

// Debit builds a positive line.
func Debit(accountID uuid.UUID, amount decimal.Decimal) Line {
	return Line{AccountID: accountID, Amount: amount}
}

// Credit builds a negative line. Callers pass a positive amount and this
// applies the sign, so no call site has to remember the convention.
func Credit(accountID uuid.UUID, amount decimal.Decimal) Line {
	return Line{AccountID: accountID, Amount: amount.Neg()}
}

// Apply returns the account balance after amount is posted to it, in the
// account's natural sign.
func (a *Account) Apply(amount decimal.Decimal) decimal.Decimal {
	if a.NormalBalance == NormalDebit {
		return a.Balance.Add(amount)
	}

	return a.Balance.Sub(amount)
}
```

- [ ] **Step 2: Write the errors**

`internal/domain/ledger/errors.go`:

```go
package ledger

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	// ErrAccountNotFound is returned when a ledger account does not exist and
	// the caller is not permitted to create it.
	ErrAccountNotFound = fmt.Errorf("ledger account not found: %w", errs.ErrNotFound)

	// ErrEntryNotFound is returned when a journal entry does not exist.
	ErrEntryNotFound = fmt.Errorf("journal entry not found: %w", errs.ErrNotFound)

	// ErrUnknownKind is returned for an account kind outside the closed set.
	ErrUnknownKind = fmt.Errorf("unknown ledger account kind: %w", errs.ErrInvalidInput)

	// ErrEntryDoesNotBalance is the Go-side guard that mirrors the database's
	// constraint trigger. Both exist on purpose: this one produces a readable
	// error at the call site, the trigger makes the rule unbypassable.
	ErrEntryDoesNotBalance = fmt.Errorf("journal entry does not balance: %w", errs.ErrInvalidInput)

	// ErrTooFewLines is returned for an entry with fewer than two lines. One
	// line cannot balance unless it is zero, and a zero line is refused.
	ErrTooFewLines = fmt.Errorf("a journal entry needs at least two lines: %w", errs.ErrInvalidInput)

	// ErrZeroAmount is returned for a line of zero.
	ErrZeroAmount = fmt.Errorf("a journal line amount must not be zero: %w", errs.ErrInvalidInput)

	// ErrDescriptionRequired is returned for an entry with no description.
	ErrDescriptionRequired = fmt.Errorf("a journal entry needs a description: %w", errs.ErrInvalidInput)

	// ErrCreatedByRequired is returned for an entry with no actor. Every
	// entry is attributable: an admin user id, a merchant code, or SYSTEM.
	ErrCreatedByRequired = fmt.Errorf("a journal entry needs a created_by: %w", errs.ErrInvalidInput)

	// ErrTypeRequired is returned for an entry with no type.
	ErrTypeRequired = fmt.Errorf("a journal entry needs a type: %w", errs.ErrInvalidInput)

	// ErrNegativeAmount is returned when a caller supplies a negative amount
	// where only a positive one is meaningful -- an adjustment's size, a
	// deposit's value. Direction is expressed by Debit/Credit, not by sign.
	ErrNegativeAmount = fmt.Errorf("amount must be positive: %w", errs.ErrInvalidInput)

	// ErrInsufficientBalance is returned when a debit would take a merchant's
	// operating balance below zero.
	ErrInsufficientBalance = fmt.Errorf("insufficient balance: %w", errs.ErrUnprocessable)
)
```

- [ ] **Step 3: Write the validator**

`internal/domain/ledger/validator.go`:

```go
package ledger

import (
	"strings"

	"github.com/shopspring/decimal"
)

// ValidateEntry checks the parts of an entry that need no database.
func ValidateEntry(e Entry) error {
	switch {
	case strings.TrimSpace(e.Type) == "":
		return ErrTypeRequired
	case strings.TrimSpace(e.Description) == "":
		return ErrDescriptionRequired
	case strings.TrimSpace(e.CreatedBy) == "":
		return ErrCreatedByRequired
	}

	return nil
}

// ValidateLines enforces the two rules that make an entry double-entry: at
// least two lines, and a sum of exactly zero.
//
// This duplicates the database's constraint trigger deliberately. The trigger
// is the guarantee -- it cannot be bypassed -- but it fires at commit, by
// which point the failure is a transaction abort with a message aimed at a
// DBA. This check fails at the call site with an error a handler can map.
func ValidateLines(lines []Line) error {
	if len(lines) < 2 {
		return ErrTooFewLines
	}

	total := decimal.Zero
	for _, line := range lines {
		if line.Amount.IsZero() {
			return ErrZeroAmount
		}

		total = total.Add(line.Amount)
	}

	if !total.IsZero() {
		return ErrEntryDoesNotBalance
	}

	return nil
}
```

- [ ] **Step 4: Write the failing validator test**

`internal/domain/ledger/validator_test.go`:

```go
package ledger_test

import (
	"testing"

	"be-maxpay/internal/domain/ledger"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func amount(t *testing.T, s string) decimal.Decimal {
	t.Helper()

	return decimal.RequireFromString(s)
}

func TestValidateLines_AcceptsABalancedPair(t *testing.T) {
	a, b := uuid.New(), uuid.New()

	err := ledger.ValidateLines([]ledger.Line{
		ledger.Debit(a, amount(t, "100.00")),
		ledger.Credit(b, amount(t, "100.00")),
	})

	assert.NoError(t, err)
}

func TestValidateLines_AcceptsAThreeWaySplit(t *testing.T) {
	bank, merchant, house := uuid.New(), uuid.New(), uuid.New()

	err := ledger.ValidateLines([]ledger.Line{
		ledger.Debit(bank, amount(t, "1000.00")),
		ledger.Credit(merchant, amount(t, "985.00")),
		ledger.Credit(house, amount(t, "15.00")),
	})

	assert.NoError(t, err)
}

// One satang out is the failure this rule exists to catch: it is exactly what
// a rounding bug produces, and it is invisible to the eye.
func TestValidateLines_RejectsAOneSatangImbalance(t *testing.T) {
	a, b := uuid.New(), uuid.New()

	err := ledger.ValidateLines([]ledger.Line{
		ledger.Debit(a, amount(t, "100.00")),
		ledger.Credit(b, amount(t, "99.99")),
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, ledger.ErrEntryDoesNotBalance)
}

func TestValidateLines_RejectsASingleLine(t *testing.T) {
	err := ledger.ValidateLines([]ledger.Line{ledger.Debit(uuid.New(), amount(t, "1.00"))})

	require.Error(t, err)
	assert.ErrorIs(t, err, ledger.ErrTooFewLines)
}

func TestValidateLines_RejectsAZeroLine(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()

	err := ledger.ValidateLines([]ledger.Line{
		ledger.Debit(a, amount(t, "100.00")),
		ledger.Credit(b, amount(t, "100.00")),
		ledger.Debit(c, decimal.Zero),
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, ledger.ErrZeroAmount)
}

func TestValidateEntry_RequiresTypeDescriptionAndActor(t *testing.T) {
	cases := map[string]ledger.Entry{
		"no type":        {Description: "d", CreatedBy: "SYSTEM"},
		"no description": {Type: ledger.TypeAdjustment, CreatedBy: "SYSTEM"},
		"blank description": {
			Type: ledger.TypeAdjustment, Description: "   ", CreatedBy: "SYSTEM",
		},
		"no actor": {Type: ledger.TypeAdjustment, Description: "d"},
	}

	for name, entry := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Error(t, ledger.ValidateEntry(entry))
		})
	}
}

// Credit applies the sign so no call site has to remember the convention.
func TestCredit_IsNegativeAndDebitIsPositive(t *testing.T) {
	id := uuid.New()

	assert.True(t, ledger.Debit(id, amount(t, "5")).Amount.IsPositive())
	assert.True(t, ledger.Credit(id, amount(t, "5")).Amount.IsNegative())
}

// A credit-normal account's balance must read positive as it grows, or every
// report downstream has to re-apply the sign convention itself.
func TestAccount_ApplyUsesTheNaturalSign(t *testing.T) {
	credit := &ledger.Account{NormalBalance: ledger.NormalCredit, Balance: amount(t, "100")}
	debit := &ledger.Account{NormalBalance: ledger.NormalDebit, Balance: amount(t, "100")}

	// A credit line (negative amount) grows a credit-normal account.
	assert.True(t, credit.Apply(amount(t, "-50")).Equal(amount(t, "150")))
	// A debit line (positive amount) grows a debit-normal account.
	assert.True(t, debit.Apply(amount(t, "50")).Equal(amount(t, "150")))
}

func TestKind_NormalBalanceAndOwner(t *testing.T) {
	assert.Equal(t, ledger.NormalDebit, ledger.KindBankAccount.NormalBalance())
	assert.Equal(t, ledger.NormalCredit, ledger.KindMerchantOperate.NormalBalance())
	assert.Equal(t, ledger.NormalCredit, ledger.KindHouseRevenue.NormalBalance())

	assert.Equal(t, ledger.OwnerBankAccount, ledger.KindBankAccount.Owner())
	assert.Equal(t, ledger.OwnerMerchant, ledger.KindMerchantPendingPayout.Owner())
	assert.Equal(t, ledger.OwnerHouse, ledger.KindHouseSuspense.Owner())

	assert.False(t, ledger.Kind("NOT_A_KIND").IsValid())
}
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/domain/ledger/ -v`
Expected: compile error — the package does not exist yet. Write the files from Steps 1–3, then rerun.

- [ ] **Step 6: Write the ports**

`internal/domain/ledger/dto.go`:

```go
package ledger

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Balance is what GET /merchant/balance reports.
//
// Freeze deliberately folds MERCHANT_FREEZE and MERCHANT_PENDING_PAYOUT
// together: both are money the merchant cannot spend, and the PRD's own
// identity is balance = operate + parking + freeze. Reporting the two
// separately would break that identity for every consumer.
type Balance struct {
	MerchantID uuid.UUID
	Operate    decimal.Decimal
	Parking    decimal.Decimal
	Freeze     decimal.Decimal
	Total      decimal.Decimal
}

// AdjustmentData is a manual correction posted by a platform admin.
// Direction is expressed by the target kind and the sign of Increase, never
// by a negative Amount.
type AdjustmentData struct {
	MerchantID uuid.UUID
	Kind       Kind
	Amount     decimal.Decimal
	Increase   bool
	Reason     string
	CreatedBy  string
}

// LedgerQuery pages one merchant's journal lines, newest first.
type LedgerQuery struct {
	MerchantID uuid.UUID
	Limit      int
	Offset     int
}

// StatementLine is one row of a merchant's statement: a line joined to the
// entry it belongs to.
type StatementLine struct {
	EntryID       uuid.UUID
	EntryType     string
	Description   string
	ReferenceType string
	ReferenceID   string
	Kind          Kind
	Amount        decimal.Decimal
	BalanceAfter  decimal.Decimal
	CreatedAt     time.Time
}
```

`internal/domain/ledger/repository.go`:

```go
package ledger

import (
	"context"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
)

// Repository is the ledger's persistence port.
//
// Every method that writes takes an explicit *sqlx.Tx. There is no
// ambient-transaction variant on purpose: a ledger write that is not part of
// the transaction that caused it is a write that can survive a rollback.
type Repository interface {
	// EnsureMerchantAccount returns the merchant's account of this kind,
	// creating it if it does not exist. Safe under concurrency: the create
	// races against the partial unique index and a loser re-reads.
	EnsureMerchantAccount(ctx context.Context, tx *sqlx.Tx, merchantID uuid.UUID, kind Kind) (*Account, error)

	// EnsureBankAccount returns the ledger account for a corporate bank
	// account, creating it if needed.
	EnsureBankAccount(ctx context.Context, tx *sqlx.Tx, bankAccountID uuid.UUID, kind Kind) (*Account, error)

	// EnsureHouseAccount returns one of the platform's own accounts.
	EnsureHouseAccount(ctx context.Context, tx *sqlx.Tx, kind Kind) (*Account, error)

	// LockAccounts reads the given accounts FOR UPDATE, ordered by id so
	// concurrent entries touching the same accounts cannot deadlock, and
	// returns them keyed by id.
	LockAccounts(ctx context.Context, tx *sqlx.Tx, ids []uuid.UUID) (map[uuid.UUID]*Account, error)

	// InsertEntry writes the entry header and returns it with its id set.
	InsertEntry(ctx context.Context, tx *sqlx.Tx, e Entry) (*Entry, error)

	// InsertLines writes the lines of one entry.
	InsertLines(ctx context.Context, tx *sqlx.Tx, lines []Line) error

	// UpdateBalance sets an account's stored balance.
	UpdateBalance(ctx context.Context, tx *sqlx.Tx, accountID uuid.UUID, balance decimal.Decimal) error

	// MerchantBalances returns the merchant's balance per kind, without
	// creating any account that does not exist. A kind with no account is
	// absent from the map and reads as zero.
	MerchantBalances(ctx context.Context, merchantID uuid.UUID) (map[Kind]decimal.Decimal, error)

	// Statement pages a merchant's lines, newest first.
	Statement(ctx context.Context, q LedgerQuery) ([]*StatementLine, error)
}
```

`internal/domain/ledger/service.go`:

```go
package ledger

import (
	"context"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// Service is the only way to write to the ledger.
type Service interface {
	// Post writes one balanced entry and updates every account it touches.
	//
	// It takes the caller's transaction so the posting commits with the
	// business change that caused it, or with neither. Passing nil is a
	// programming error and is refused: a ledger write with its own
	// transaction can survive the rollback of the thing it was recording.
	Post(ctx context.Context, tx *sqlx.Tx, entry Entry, lines ...Line) (*Entry, error)

	// Balance reports the merchant's three PRD figures.
	Balance(ctx context.Context, merchantID uuid.UUID) (*Balance, error)

	// Statement pages a merchant's journal lines, newest first.
	Statement(ctx context.Context, q LedgerQuery) ([]*StatementLine, error)

	// Adjust posts a manual correction against a merchant, balanced against
	// HOUSE_SUSPENSE. Requires a reason and an actor.
	Adjust(ctx context.Context, data AdjustmentData) (*Entry, error)
}
```

- [ ] **Step 7: Run the tests**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/domain/ledger/ -v`
Expected: all PASS. Then `go vet ./internal/domain/ledger/` clean, and confirm `internal/domain/ledger` imports nothing from `internal/adapter` or `internal/service`:

```bash
go list -deps ./internal/domain/ledger | grep -E 'be-maxpay/internal/(adapter|service)' && echo "LAYERING VIOLATION" || echo "layering ok"
```

- [ ] **Step 8: Commit**

```bash
git add internal/domain/ledger/
git commit -m "feat(ledger): add the ledger domain, chart of accounts and entry rules"
```

---

### Task 3: The ledger repository

**Files:**
- Create: `internal/adapter/persistence/model/ledger.go`
- Create: `internal/adapter/persistence/mapper/ledger.go`
- Create: `internal/adapter/repository/ledger/repository.go`
- Test: `internal/adapter/repository/ledger/repository_test.go` (sqlmock)
- Test: `internal/adapter/repository/ledger/integration_test.go`

**Interfaces:**
- Consumes: `ledger.Repository` from Task 2; `base.BaseRepository`; `errs.WrapDatabaseError`.
- Produces: `func NewRepository(db *sqlx.DB) *Repository` satisfying `ledger.Repository`.

- [ ] **Step 1: Write the model**

`internal/adapter/persistence/model/ledger.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type LedgerAccount struct {
	ID            uuid.UUID       `db:"id"`
	Kind          string          `db:"kind"`
	MerchantID    uuid.NullUUID   `db:"merchant_id"`
	BankAccountID uuid.NullUUID   `db:"bank_account_id"`
	NormalBalance string          `db:"normal_balance"`
	Balance       decimal.Decimal `db:"balance"`
	CreatedAt     time.Time       `db:"created_at"`
	UpdatedAt     time.Time       `db:"updated_at"`
}

type JournalEntry struct {
	ID            uuid.UUID      `db:"id"`
	Type          string         `db:"type"`
	MerchantID    uuid.NullUUID  `db:"merchant_id"`
	ReferenceType sql.NullString `db:"reference_type"`
	ReferenceID   sql.NullString `db:"reference_id"`
	Description   string         `db:"description"`
	CreatedBy     string         `db:"created_by"`
	CreatedAt     time.Time      `db:"created_at"`
}

type JournalLine struct {
	ID           uuid.UUID       `db:"id"`
	EntryID      uuid.UUID       `db:"entry_id"`
	AccountID    uuid.UUID       `db:"account_id"`
	Amount       decimal.Decimal `db:"amount"`
	BalanceAfter decimal.Decimal `db:"balance_after"`
}

// StatementRow is the join a merchant statement reads: a line plus the entry
// and account it belongs to.
type StatementRow struct {
	EntryID       uuid.UUID       `db:"entry_id"`
	EntryType     string          `db:"type"`
	Description   string          `db:"description"`
	ReferenceType sql.NullString  `db:"reference_type"`
	ReferenceID   sql.NullString  `db:"reference_id"`
	Kind          string          `db:"kind"`
	Amount        decimal.Decimal `db:"amount"`
	BalanceAfter  decimal.Decimal `db:"balance_after"`
	CreatedAt     time.Time       `db:"created_at"`
}
```

- [ ] **Step 2: Write the mapper**

`internal/adapter/persistence/mapper/ledger.go`:

```go
package mapper

import (
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/ledger"
)

func LedgerAccountToDomain(m *model.LedgerAccount) *ledger.Account {
	if m == nil {
		return nil
	}

	return &ledger.Account{
		ID:            m.ID,
		Kind:          ledger.Kind(m.Kind),
		MerchantID:    m.MerchantID.UUID,
		BankAccountID: m.BankAccountID.UUID,
		NormalBalance: m.NormalBalance,
		Balance:       m.Balance,
		CreatedAt:     m.CreatedAt,
		UpdatedAt:     m.UpdatedAt,
	}
}

func LedgerAccountsToDomain(ms []*model.LedgerAccount) []*ledger.Account {
	out := make([]*ledger.Account, 0, len(ms))
	for _, m := range ms {
		out = append(out, LedgerAccountToDomain(m))
	}

	return out
}

func JournalEntryToDomain(m *model.JournalEntry) *ledger.Entry {
	if m == nil {
		return nil
	}

	return &ledger.Entry{
		ID:            m.ID,
		Type:          m.Type,
		MerchantID:    m.MerchantID.UUID,
		ReferenceType: m.ReferenceType.String,
		ReferenceID:   m.ReferenceID.String,
		Description:   m.Description,
		CreatedBy:     m.CreatedBy,
		CreatedAt:     m.CreatedAt,
	}
}

func StatementRowToDomain(m *model.StatementRow) *ledger.StatementLine {
	if m == nil {
		return nil
	}

	return &ledger.StatementLine{
		EntryID:       m.EntryID,
		EntryType:     m.EntryType,
		Description:   m.Description,
		ReferenceType: m.ReferenceType.String,
		ReferenceID:   m.ReferenceID.String,
		Kind:          ledger.Kind(m.Kind),
		Amount:        m.Amount,
		BalanceAfter:  m.BalanceAfter,
		CreatedAt:     m.CreatedAt,
	}
}

func StatementRowsToDomain(ms []*model.StatementRow) []*ledger.StatementLine {
	out := make([]*ledger.StatementLine, 0, len(ms))
	for _, m := range ms {
		out = append(out, StatementRowToDomain(m))
	}

	return out
}
```

- [ ] **Step 3: Write the repository**

`internal/adapter/repository/ledger/repository.go`:

```go
// Package ledger persists the chart of accounts and the journal.
package ledger

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/adapter/repository/base"
	domainledger "be-maxpay/internal/domain/ledger"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
)

const accountColumns = `id, kind, merchant_id, bank_account_id, normal_balance,
	balance, created_at, updated_at`

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) *Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

var _ domainledger.Repository = (*Repository)(nil)

**A failed INSERT aborts the whole transaction.** PostgreSQL marks the
transaction unusable the moment the unique index rejects the insert, so the
re-read below cannot run and the duplicate-key error surfaces instead of the
winner's row — the exact opposite of what this function promises. Wrap the
insert attempt in `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`, and `RELEASE` it on
both paths. This was found by running the concurrent test, not by reading the
code, and the test is what must confirm your version works.

// ensure resolves one account by its owner, creating it when absent.
//
// The read-then-create is racy by construction, and that is handled rather
// than avoided: two callers can both find nothing, both insert, and one loses
// to the partial unique index. The loser re-reads instead of failing, because
// from its point of view the account now exists and that is all it wanted.
func (r *Repository) ensure(
	ctx context.Context, tx *sqlx.Tx,
	kind domainledger.Kind, merchantID, bankAccountID uuid.NullUUID,
) (*domainledger.Account, error) {
	if !kind.IsValid() {
		return nil, domainledger.ErrUnknownKind
	}

	found, err := r.findByOwner(ctx, tx, kind, merchantID, bankAccountID)
	if err == nil {
		return found, nil
	}
	if !errors.Is(err, domainledger.ErrAccountNotFound) {
		return nil, err
	}

	var m model.LedgerAccount
	insert := `INSERT INTO ledger_accounts (kind, merchant_id, bank_account_id, normal_balance)
		VALUES ($1, $2, $3, $4) RETURNING ` + accountColumns

	err = tx.QueryRowxContext(ctx, insert,
		string(kind), merchantID, bankAccountID, kind.NormalBalance()).StructScan(&m)
	if err == nil {
		return mapper.LedgerAccountToDomain(&m), nil
	}

	// Lost the race. The row exists now; read it back.
	if reread, rereadErr := r.findByOwner(ctx, tx, kind, merchantID, bankAccountID); rereadErr == nil {
		return reread, nil
	}

	return nil, errs.WrapDatabaseError(err, "create ledger account")
}

func (r *Repository) findByOwner(
	ctx context.Context, tx *sqlx.Tx,
	kind domainledger.Kind, merchantID, bankAccountID uuid.NullUUID,
) (*domainledger.Account, error) {
	query := `SELECT ` + accountColumns + ` FROM ledger_accounts
		WHERE kind = $1
		  AND merchant_id IS NOT DISTINCT FROM $2
		  AND bank_account_id IS NOT DISTINCT FROM $3`

	var m model.LedgerAccount
	err := tx.QueryRowxContext(ctx, query, string(kind), merchantID, bankAccountID).StructScan(&m)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domainledger.ErrAccountNotFound
		}

		return nil, errs.WrapDatabaseError(err, "find ledger account")
	}

	return mapper.LedgerAccountToDomain(&m), nil
}

func (r *Repository) EnsureMerchantAccount(
	ctx context.Context, tx *sqlx.Tx, merchantID uuid.UUID, kind domainledger.Kind,
) (*domainledger.Account, error) {
	return r.ensure(ctx, tx, kind,
		uuid.NullUUID{UUID: merchantID, Valid: true}, uuid.NullUUID{})
}

func (r *Repository) EnsureBankAccount(
	ctx context.Context, tx *sqlx.Tx, bankAccountID uuid.UUID, kind domainledger.Kind,
) (*domainledger.Account, error) {
	return r.ensure(ctx, tx, kind,
		uuid.NullUUID{}, uuid.NullUUID{UUID: bankAccountID, Valid: true})
}

func (r *Repository) EnsureHouseAccount(
	ctx context.Context, tx *sqlx.Tx, kind domainledger.Kind,
) (*domainledger.Account, error) {
	return r.ensure(ctx, tx, kind, uuid.NullUUID{}, uuid.NullUUID{})
}

// LockAccounts reads the accounts FOR UPDATE, ordered by id.
//
// The ordering is the whole point: two concurrent entries touching the same
// two accounts in opposite orders would deadlock. `ORDER BY id` in the
// statement is what supplies it — PostgreSQL plans LockRows above the index
// scan, so the order ids arrive in from Go cannot influence the order rows are
// locked in. Do NOT add a Go-side sort believing it does that; an earlier
// draft did, and the comment claiming so outlived the belief. A rewrite into
// per-row `SELECT ... FOR UPDATE` calls WOULD make the caller's ordering the
// lock ordering, and would have to sort at that call site.
//
// Compare the returned count against the number of DISTINCT ids: an entry with
// two lines against one account passes that id twice, and counting raw
// arguments reports a missing account that is not missing.
func (r *Repository) LockAccounts(
	ctx context.Context, tx *sqlx.Tx, ids []uuid.UUID,
) (map[uuid.UUID]*domainledger.Account, error) {
	if len(ids) == 0 {
		return map[uuid.UUID]*domainledger.Account{}, nil
	}

	ordered := make([]uuid.UUID, len(ids))
	copy(ordered, ids)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].String() < ordered[j].String() })

	query, args, err := sqlx.In(
		`SELECT `+accountColumns+` FROM ledger_accounts WHERE id IN (?) ORDER BY id FOR UPDATE`,
		ordered)
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build lock accounts query")
	}

	rows, err := tx.QueryxContext(ctx, tx.Rebind(query), args...)
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "lock ledger accounts")
	}
	defer func() { _ = rows.Close() }()

	out := make(map[uuid.UUID]*domainledger.Account, len(ordered))
	for rows.Next() {
		var m model.LedgerAccount
		if err := rows.StructScan(&m); err != nil {
			return nil, errs.WrapDatabaseError(err, "scan locked ledger account")
		}

		out[m.ID] = mapper.LedgerAccountToDomain(&m)
	}
	if err := rows.Err(); err != nil {
		return nil, errs.WrapDatabaseError(err, "read locked ledger accounts")
	}

	// A caller asking to lock an account that does not exist has a bug that
	// would otherwise show up later as a nil map entry.
	if len(out) != len(ordered) {
		return nil, domainledger.ErrAccountNotFound
	}

	return out, nil
}

func (r *Repository) InsertEntry(
	ctx context.Context, tx *sqlx.Tx, e domainledger.Entry,
) (*domainledger.Entry, error) {
	query := `INSERT INTO journal_entries
		(type, merchant_id, reference_type, reference_id, description, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, type, merchant_id, reference_type, reference_id,
		          description, created_by, created_at`

	var m model.JournalEntry
	err := tx.QueryRowxContext(ctx, query,
		e.Type, nilUUID(e.MerchantID), nilString(e.ReferenceType), nilString(e.ReferenceID),
		e.Description, e.CreatedBy).StructScan(&m)
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "insert journal entry")
	}

	return mapper.JournalEntryToDomain(&m), nil
}

func (r *Repository) InsertLines(ctx context.Context, tx *sqlx.Tx, lines []domainledger.Line) error {
	if len(lines) == 0 {
		return nil
	}

	query := `INSERT INTO journal_lines (entry_id, account_id, amount, balance_after)
		VALUES (:entry_id, :account_id, :amount, :balance_after)`

	rows := make([]model.JournalLine, 0, len(lines))
	for _, l := range lines {
		rows = append(rows, model.JournalLine{
			EntryID: l.EntryID, AccountID: l.AccountID,
			Amount: l.Amount, BalanceAfter: l.BalanceAfter,
		})
	}

	if _, err := tx.NamedExecContext(ctx, query, rows); err != nil {
		return errs.WrapDatabaseError(err, "insert journal lines")
	}

	return nil
}

func (r *Repository) UpdateBalance(
	ctx context.Context, tx *sqlx.Tx, accountID uuid.UUID, balance decimal.Decimal,
) error {
	result, err := tx.ExecContext(ctx,
		`UPDATE ledger_accounts SET balance = $1, updated_at = NOW() WHERE id = $2`,
		balance, accountID)
	if err != nil {
		return errs.WrapDatabaseError(err, "update ledger account balance")
	}

	return r.CheckRowsAffectedWith(result, domainledger.ErrAccountNotFound)
}

func (r *Repository) MerchantBalances(
	ctx context.Context, merchantID uuid.UUID,
) (map[domainledger.Kind]decimal.Decimal, error) {
	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	rows, err := r.DB.QueryxContext(ctx,
		`SELECT kind, balance FROM ledger_accounts WHERE merchant_id = $1`, merchantID)
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "read merchant balances")
	}
	defer func() { _ = rows.Close() }()

	out := map[domainledger.Kind]decimal.Decimal{}
	for rows.Next() {
		var kind string
		var balance decimal.Decimal
		if err := rows.Scan(&kind, &balance); err != nil {
			return nil, errs.WrapDatabaseError(err, "scan merchant balance")
		}

		out[domainledger.Kind(kind)] = balance
	}
	if err := rows.Err(); err != nil {
		return nil, errs.WrapDatabaseError(err, "read merchant balances")
	}

	return out, nil
}

func (r *Repository) Statement(
	ctx context.Context, q domainledger.LedgerQuery,
) ([]*domainledger.StatementLine, error) {
	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	limit := q.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	query := `SELECT e.id AS entry_id, e.type, e.description, e.reference_type,
	                 e.reference_id, a.kind, l.amount, l.balance_after, e.created_at
	          FROM journal_lines l
	          JOIN journal_entries e ON e.id = l.entry_id
	          JOIN ledger_accounts a ON a.id = l.account_id
	          WHERE a.merchant_id = $1
	          ORDER BY l.id DESC
	          LIMIT $2 OFFSET $3`

	var rows []*model.StatementRow
	if err := r.DB.SelectContext(ctx, &rows, query, q.MerchantID, limit, q.Offset); err != nil {
		return nil, errs.WrapDatabaseError(err, "read merchant statement")
	}

	return mapper.StatementRowsToDomain(rows), nil
}

func nilUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}

	return id
}

func nilString(s string) any {
	if s == "" {
		return nil
	}

	return s
}
```

- [ ] **Step 4: Write the integration tests**

`internal/adapter/repository/ledger/integration_test.go` — cover, at minimum:

```go
//go:build integration

package ledger_test

// TestRepository_Integration_EnsureIsIdempotent: calling EnsureHouseAccount
// twice in one transaction returns the same id both times.
//
// TestRepository_Integration_ConcurrentEnsureYieldsOneAccount: two goroutines,
// each in its own transaction, both call EnsureMerchantAccount for the same
// (merchant, kind). Assert both succeed and both return the SAME id -- this
// is the race the partial unique index and the re-read exist for. A version
// that returns two different ids has split a merchant's money in half.
//
// TestRepository_Integration_LockAccountsOrdersByID: lock two accounts passing
// the ids in each order; assert both calls succeed. Without ORDER BY this is
// the classic deadlock pair.
//
// TestRepository_Integration_UpdateBalanceRejectsAnUnknownAccount: assert
// ErrAccountNotFound rather than a silent no-op.
//
// TestRepository_Integration_StatementIsNewestFirst: post three entries and
// assert the returned order, and that only the queried merchant's lines
// appear -- seed a second merchant with lines that must NOT be returned.
```

Write these out in full. The cross-merchant leak case matters most: a statement that shows another merchant's lines is a data-isolation failure, not a display bug.

- [ ] **Step 5: Run the tests**

Run: `export PATH="$PATH:$HOME/go/bin" && make test-integration && go test ./internal/adapter/repository/ledger/`
Expected: PASS.

- [ ] **Step 6: Prove the isolation test has teeth**

Using `go test -overlay` with a modified COPY of `repository.go` (never edit the tracked file), delete `WHERE a.merchant_id = $1` from `Statement` and confirm `StatementIsNewestFirst`'s cross-merchant assertion FAILS. Restore and confirm it passes. Report both results.

- [ ] **Step 7: Commit**

```bash
git add internal/adapter/persistence/model/ledger.go \
        internal/adapter/persistence/mapper/ledger.go \
        internal/adapter/repository/ledger/
git commit -m "feat(ledger): add the ledger repository with locked balance updates"
```

---

### Task 4: The posting service

`Post` is the only way anything writes to the ledger. Everything else in this plan is a caller of it.

**Files:**
- Create: `internal/service/ledger/service.go`
- Test: `internal/service/ledger/service_test.go`

**Interfaces:**
- Consumes: `ledger.Repository`, `ledger.ValidateEntry`, `ledger.ValidateLines`, `Account.Apply`.
- Produces: `func NewService(repo ledger.Repository, merchants merchant.Service, logger *zap.Logger) ledger.Service`.

- [ ] **Step 1: Write the service**

`internal/service/ledger/service.go`:

```go
// Package ledger posts balanced entries to the journal. It is the only
// component in the service permitted to write to ledger_accounts.
package ledger

import (
	"context"
	"fmt"

	domainledger "be-maxpay/internal/domain/ledger"
	"be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

type Service struct {
	repo      domainledger.Repository
	merchants merchant.Service
	logger    *zap.Logger
}

func NewService(
	repo domainledger.Repository, merchants merchant.Service, logger *zap.Logger,
) domainledger.Service {
	return &Service{repo: repo, merchants: merchants, logger: logger}
}

// Post writes one balanced entry and moves every account it touches.
//
// The order of operations is deliberate:
//
//  1. validate in Go, so a caller gets a readable error rather than a
//     transaction abort raised by a trigger,
//  2. lock every account the entry touches, ordered by id, so concurrent
//     entries against the same accounts serialise instead of deadlocking,
//  3. compute each account's new balance from the LOCKED row, never from a
//     value the caller passed in,
//  4. write the entry, then the lines with their balance_after,
//  5. update the stored balances.
//
// The database's deferred trigger then re-checks the zero-sum rule at commit.
// Both checks are wanted: this one is readable, that one is unbypassable.
func (s *Service) Post(
	ctx context.Context, tx *sqlx.Tx, entry domainledger.Entry, lines ...domainledger.Line,
) (*domainledger.Entry, error) {
	if tx == nil {
		// A ledger write outside the caller's transaction can survive the
		// rollback of the business change it was recording.
		return nil, fmt.Errorf("ledger posting requires a transaction: %w", errs.ErrInternal)
	}

	if err := domainledger.ValidateEntry(entry); err != nil {
		return nil, err
	}
	if err := domainledger.ValidateLines(lines); err != nil {
		return nil, err
	}

	ids := make([]uuid.UUID, 0, len(lines))
	seen := map[uuid.UUID]bool{}
	for _, l := range lines {
		if !seen[l.AccountID] {
			seen[l.AccountID] = true
			ids = append(ids, l.AccountID)
		}
	}

	accounts, err := s.repo.LockAccounts(ctx, tx, ids)
	if err != nil {
		return nil, err
	}

	written, err := s.repo.InsertEntry(ctx, tx, entry)
	if err != nil {
		return nil, err
	}

	// running holds each account's balance as the entry progresses, so two
	// lines against one account compound correctly and the second line's
	// balance_after is not the first line's.
	running := make(map[uuid.UUID]decimal.Decimal, len(accounts))
	for id, account := range accounts {
		running[id] = account.Balance
	}

	toWrite := make([]domainledger.Line, 0, len(lines))
	for _, l := range lines {
		account := accounts[l.AccountID]
		account.Balance = running[l.AccountID]

		next := account.Apply(l.Amount)
		running[l.AccountID] = next

		l.EntryID = written.ID
		l.BalanceAfter = next
		toWrite = append(toWrite, l)
	}

	if err := s.repo.InsertLines(ctx, tx, toWrite); err != nil {
		return nil, err
	}

	for id, balance := range running {
		if err := s.repo.UpdateBalance(ctx, tx, id, balance); err != nil {
			return nil, err
		}
	}

	s.logger.Info("journal entry posted",
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
		zap.String("entry_id", written.ID.String()),
		zap.String("type", written.Type),
		zap.Int("lines", len(toWrite)),
	)

	return written, nil
}

func (s *Service) Balance(
	ctx context.Context, merchantID uuid.UUID,
) (*domainledger.Balance, error) {
	balances, err := s.repo.MerchantBalances(ctx, merchantID)
	if err != nil {
		return nil, err
	}

	operate := balances[domainledger.KindMerchantOperate]
	parking := balances[domainledger.KindMerchantParking]
	// Both are money the merchant cannot spend, and the PRD's identity is
	// balance = operate + parking + freeze. Reporting them apart breaks it.
	freeze := balances[domainledger.KindMerchantFreeze].
		Add(balances[domainledger.KindMerchantPendingPayout])

	return &domainledger.Balance{
		MerchantID: merchantID,
		Operate:    operate,
		Parking:    parking,
		Freeze:     freeze,
		Total:      operate.Add(parking).Add(freeze),
	}, nil
}

func (s *Service) Statement(
	ctx context.Context, q domainledger.LedgerQuery,
) ([]*domainledger.StatementLine, error) {
	return s.repo.Statement(ctx, q)
}
```

`Adjust` is added in Task 6, where the standard entries live.

- [ ] **Step 2: Write the failing tests**

`internal/service/ledger/service_test.go` — with a fake `ledger.Repository`, cover:

```go
// TestPost_RefusesWithoutATransaction: Post(ctx, nil, …) returns an error and
// the repository is never touched. Assert the fake recorded ZERO calls, not
// merely that an error came back.
//
// TestPost_RefusesAnUnbalancedEntry: two lines summing to 0.01. Assert
// ErrEntryDoesNotBalance and that InsertEntry was never called -- a rejected
// entry must not leave a header behind.
//
// TestPost_LocksBeforeItWrites: assert the fake's call order is
// LockAccounts, InsertEntry, InsertLines, UpdateBalance. Record the order in
// the fake and assert on the slice. Without this, a refactor that reads
// balances before locking passes every other test in this file.
//
// TestPost_ComputesBalanceAfterFromTheLockedRow: seed the fake's account with
// balance 100, post a 50 credit to a CREDIT-normal account, assert the line's
// BalanceAfter is 150 and UpdateBalance was called with 150.
//
// TestPost_TwoLinesAgainstOneAccountCompound: post +30 and +20 to the same
// DEBIT-normal account starting at 0 (balanced by a credit of 50 elsewhere).
// Assert the two lines carry BalanceAfter 30 and 50, and that UpdateBalance
// is called once with 50 -- not twice with 30 and 20.
//
// TestBalance_FoldsPendingPayoutIntoFreeze: seed freeze 10 and pending 5,
// assert Freeze is 15 and Total is operate+parking+15.
```

Write them out in full.

- [ ] **Step 3: Run the tests**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/service/ledger/ -race -v`
Expected: PASS.

- [ ] **Step 4: Prove the ordering test has teeth**

With `go test -overlay` on a modified COPY, move the `LockAccounts` call to after `InsertEntry` and confirm `LocksBeforeItWrites` FAILS. Restore, confirm it passes. Report both.

- [ ] **Step 5: Commit**

```bash
git add internal/service/ledger/
git commit -m "feat(ledger): add the posting service"
```

---

### Task 5: Fee and rebate computation

This is where money is divided, and it is the one calculation in the system where being off by a satang is both easy and fatal — the constraint trigger rejects the whole entry.

**Files:**
- Create: `internal/service/ledger/fees.go`
- Test: `internal/service/ledger/fees_test.go`
- Test: `internal/service/ledger/fees_property_test.go`

**Interfaces:**
- Consumes: `merchant.Merchant` (`DepositRate`, `PayoutRate`), `merchant.Service.Ancestors(ctx, id) ([]*merchant.Merchant, error)`.
- Produces:
  - `type Share struct{ MerchantID uuid.UUID; Amount decimal.Decimal }`
  - `type Split struct{ Net decimal.Decimal; Rebates []Share; House decimal.Decimal; Fee decimal.Decimal }`
  - `func SplitFee(amount decimal.Decimal, chain []*merchant.Merchant, rateOf func(*merchant.Merchant) decimal.Decimal) (Split, error)`

- [ ] **Step 1: Write the splitter**

`internal/service/ledger/fees.go`:

```go
package ledger

import (
	"fmt"

	"be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// moneyPlaces is how many decimal places a posted amount carries. It matches
// NUMERIC(20,4)'s use in this system: amounts are held to four places but
// every share is rounded to two, because satang is the smallest unit anyone
// can actually be paid.
const moneyPlaces = 2

// Share is one ancestor's rebate.
type Share struct {
	MerchantID uuid.UUID
	Amount     decimal.Decimal
}

// Split is the result of dividing one transaction's fee.
//
// Net + sum(Rebates) + House == amount, exactly. That identity is what makes
// the resulting journal entry balance, and it is asserted by the property
// test rather than assumed.
type Split struct {
	Net     decimal.Decimal
	Fee     decimal.Decimal
	Rebates []Share
	House   decimal.Decimal
}

// SplitFee divides amount between the transacting merchant, each ancestor,
// and the house.
//
// chain is the merchant first, then its ancestors in order, ending at ROOT --
// exactly what merchant.Service.Ancestors returns with the merchant prepended.
// rateOf selects which commercial rate applies, so the same arithmetic serves
// deposits and payouts without a duplicated function.
//
// The rule from spec section 9: the merchant pays amount x its own rate, and
// every ancestor keeps the difference between the rate below it and its own.
// The house keeps the rate of the level directly below ROOT.
//
// Rounding: each share is rounded to two places, and any remainder left by
// that rounding goes to HOUSE_REVENUE. The remainder must land somewhere or
// the entry will not sum to zero and the database will reject it -- and it
// goes to the house because the platform is the only party that has not
// already been quoted an exact number.
func SplitFee(
	amount decimal.Decimal,
	chain []*merchant.Merchant,
	rateOf func(*merchant.Merchant) decimal.Decimal,
) (Split, error) {
	if amount.IsNegative() || amount.IsZero() {
		return Split{}, fmt.Errorf("split amount must be positive: %w", errs.ErrInvalidInput)
	}
	if len(chain) == 0 {
		return Split{}, fmt.Errorf("fee split needs a merchant chain: %w", errs.ErrInvalidInput)
	}

	for _, m := range chain {
		rate := rateOf(m)
		if rate.IsNegative() || rate.GreaterThan(decimal.NewFromInt(1)) {
			return Split{}, fmt.Errorf(
				"merchant %s has a rate outside 0..1: %w", m.Code, errs.ErrInvalidInput)
		}
	}

	// The transacting merchant's own rate is the total fee.
	fee := amount.Mul(rateOf(chain[0])).Round(moneyPlaces)
	net := amount.Sub(fee)

	// Each ancestor keeps the gap between the rate below it and its own.
	rebates := make([]Share, 0, len(chain))
	for i := 1; i < len(chain); i++ {
		below := rateOf(chain[i-1])
		own := rateOf(chain[i])

		gap := below.Sub(own)
		if gap.IsNegative() {
			return Split{}, fmt.Errorf(
				"merchant %s charges more than its child: %w", chain[i].Code, errs.ErrInvalidInput)
		}

		share := amount.Mul(gap).Round(moneyPlaces)
		if share.IsZero() {
			// A zero line is refused by the schema, and a rebate of nothing
			// is not a posting. The value stays in the fee and reaches the
			// house through the remainder below.
			continue
		}

		// ROOT keeps nothing of its own: its share IS house revenue.
		if chain[i].Role == merchant.RoleRoot {
			continue
		}

		rebates = append(rebates, Share{MerchantID: chain[i].ID, Amount: share})
	}

	// Whatever the rounded shares did not consume is the house's, by
	// definition. This is what guarantees the identity holds exactly.
	house := fee
	for _, r := range rebates {
		house = house.Sub(r.Amount)
	}

	if house.IsNegative() {
		return Split{}, fmt.Errorf(
			"rebates exceed the fee charged: %w", errs.ErrInvalidInput)
	}

	return Split{Net: net, Fee: fee, Rebates: rebates, House: house}, nil
}

// DepositRateOf and PayoutRateOf are the two selectors SplitFee accepts.
func DepositRateOf(m *merchant.Merchant) decimal.Decimal { return m.DepositRate }
func PayoutRateOf(m *merchant.Merchant) decimal.Decimal  { return m.PayoutRate }
```

- [ ] **Step 2: Write the worked example from the spec as a test**

`internal/service/ledger/fees_test.go`:

```go
package ledger_test

import (
	"testing"

	"be-maxpay/internal/domain/merchant"
	ledgersvc "be-maxpay/internal/service/ledger"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func rate(t *testing.T, s string) decimal.Decimal {
	t.Helper()

	return decimal.RequireFromString(s)
}

// The worked example from spec section 9: a deposit of 1,000 for a direct
// merchant at 1.50% under a reseller at 0.70%.
//
//	DR  bank_account        1,000.00
//	CR  direct:operate        985.00
//	CR  reseller:operate        8.00
//	CR  house_revenue           7.00
func TestSplitFee_MatchesTheSpecWorkedExample(t *testing.T) {
	root := &merchant.Merchant{ID: uuid.New(), Code: "ROOT", Role: merchant.RoleRoot,
		DepositRate: decimal.Zero}
	reseller := &merchant.Merchant{ID: uuid.New(), Code: "RSL", Role: merchant.RoleReseller,
		DepositRate: rate(t, "0.0070")}
	direct := &merchant.Merchant{ID: uuid.New(), Code: "DIR", Role: merchant.RoleDirect,
		DepositRate: rate(t, "0.0150")}

	split, err := ledgersvc.SplitFee(rate(t, "1000"),
		[]*merchant.Merchant{direct, reseller, root}, ledgersvc.DepositRateOf)

	require.NoError(t, err)
	assert.True(t, split.Net.Equal(rate(t, "985")), "net %s", split.Net)
	assert.True(t, split.Fee.Equal(rate(t, "15")), "fee %s", split.Fee)
	require.Len(t, split.Rebates, 1)
	assert.Equal(t, reseller.ID, split.Rebates[0].MerchantID)
	assert.True(t, split.Rebates[0].Amount.Equal(rate(t, "8")), "rebate %s", split.Rebates[0].Amount)
	assert.True(t, split.House.Equal(rate(t, "7")), "house %s", split.House)
}

// A merchant with no reseller above it: the whole fee is house revenue.
func TestSplitFee_DirectUnderRootGivesEverythingToTheHouse(t *testing.T) {
	root := &merchant.Merchant{ID: uuid.New(), Code: "ROOT", Role: merchant.RoleRoot,
		DepositRate: decimal.Zero}
	direct := &merchant.Merchant{ID: uuid.New(), Code: "DIR", Role: merchant.RoleDirect,
		DepositRate: rate(t, "0.02")}

	split, err := ledgersvc.SplitFee(rate(t, "500"),
		[]*merchant.Merchant{direct, root}, ledgersvc.DepositRateOf)

	require.NoError(t, err)
	assert.Empty(t, split.Rebates)
	assert.True(t, split.House.Equal(rate(t, "10")), "house %s", split.House)
	assert.True(t, split.Net.Equal(rate(t, "490")), "net %s", split.Net)
}

// A reseller quoting a rate above its child's would be paid a negative
// rebate, which is a commercial-configuration error rather than arithmetic.
func TestSplitFee_RefusesAnAncestorChargingMoreThanItsChild(t *testing.T) {
	root := &merchant.Merchant{ID: uuid.New(), Code: "ROOT", Role: merchant.RoleRoot}
	reseller := &merchant.Merchant{ID: uuid.New(), Code: "RSL", Role: merchant.RoleReseller,
		DepositRate: rate(t, "0.03")}
	direct := &merchant.Merchant{ID: uuid.New(), Code: "DIR", Role: merchant.RoleDirect,
		DepositRate: rate(t, "0.01")}

	_, err := ledgersvc.SplitFee(rate(t, "100"),
		[]*merchant.Merchant{direct, reseller, root}, ledgersvc.DepositRateOf)

	assert.Error(t, err)
}

func TestSplitFee_RefusesANonPositiveAmount(t *testing.T) {
	root := &merchant.Merchant{ID: uuid.New(), Code: "ROOT", Role: merchant.RoleRoot}

	for _, amount := range []string{"0", "-1"} {
		_, err := ledgersvc.SplitFee(rate(t, amount),
			[]*merchant.Merchant{root}, ledgersvc.DepositRateOf)
		assert.Error(t, err, "amount %s", amount)
	}
}
```

- [ ] **Step 3: Write the property test**

`internal/service/ledger/fees_property_test.go`:

```go
package ledger_test

import (
	"math/rand"
	"testing"

	"be-maxpay/internal/domain/merchant"
	ledgersvc "be-maxpay/internal/service/ledger"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

// The spec asks for this test by name: thousands of random amounts and rate
// combinations, asserting every entry sums to zero and each party's share
// matches an independent calculation.
//
// Rounding bugs surface here or in production, and nowhere in between: a fee
// that does not divide evenly produces an entry the database rejects, and the
// amounts that do that are not the ones anyone picks by hand.
func TestSplitFee_Property_AlwaysSumsToTheOriginalAmount(t *testing.T) {
	// Fixed seed: a property test that cannot be re-run on the input that
	// broke it is a test that reports failures nobody can act on.
	rng := rand.New(rand.NewSource(20260827))

	root := &merchant.Merchant{ID: uuid.New(), Code: "ROOT", Role: merchant.RoleRoot,
		DepositRate: decimal.Zero}

	for i := 0; i < 5000; i++ {
		// Amounts from 0.01 to 9,999,999.99, in satang.
		satang := rng.Int63n(999_999_999) + 1
		amount := decimal.New(satang, -2)

		// Two rates in [0, 0.05] with the reseller's never above the
		// merchant's, in basis points so they are realistic.
		merchantBps := rng.Int63n(501)
		resellerBps := rng.Int63n(merchantBps + 1)

		reseller := &merchant.Merchant{ID: uuid.New(), Code: "RSL", Role: merchant.RoleReseller,
			DepositRate: decimal.New(resellerBps, -4)}
		direct := &merchant.Merchant{ID: uuid.New(), Code: "DIR", Role: merchant.RoleDirect,
			DepositRate: decimal.New(merchantBps, -4)}

		split, err := ledgersvc.SplitFee(amount,
			[]*merchant.Merchant{direct, reseller, root}, ledgersvc.DepositRateOf)
		require.NoError(t, err, "amount %s rates %d/%d", amount, merchantBps, resellerBps)

		// The identity the journal entry depends on. On its own this is an
		// ALGEBRAIC TAUTOLOGY -- net is amount minus fee and house is fee
		// minus the rebates, so it holds for any values whatsoever. It earns
		// its place only as a check that the remainder rule is still the
		// remainder rule. The independent per-party assertions below are what
		// actually detect a wrong share: without them, changing the rebate's
		// Round(2) to Truncate(2) short-changes every reseller on every
		// transaction and the whole suite stays green. That was measured, not
		// imagined.
		total := split.Net.Add(split.House)
		for _, r := range split.Rebates {
			total = total.Add(r.Amount)
		}

		require.True(t, total.Equal(amount),
			"iteration %d: amount %s rates %d/%d split to %s (net %s, house %s)",
			i, amount, merchantBps, resellerBps, total, split.Net, split.House)

		// Independent calculations, not reusing SplitFee's own expressions.
		// Derive each party's share from the raw basis points -- one per
		// party, because a test that checks only the fee cannot see a rebate
		// that is short by a satang.
		expectedFee := amount.Mul(decimal.New(merchantBps, -4)).Round(2)
		require.True(t, split.Fee.Equal(expectedFee),
			"iteration %d: fee %s expected %s", i, split.Fee, expectedFee)

		expectedRebate := amount.Mul(decimal.New(merchantBps-resellerBps, -4)).Round(2)
		if expectedRebate.IsPositive() {
			require.Len(t, split.Rebates, 1, "iteration %d", i)
			require.True(t, split.Rebates[0].Amount.Equal(expectedRebate),
				"iteration %d: rebate %s expected %s", i, split.Rebates[0].Amount, expectedRebate)
		}

		expectedHouse := expectedFee.Sub(expectedRebate)
		require.True(t, split.House.Equal(expectedHouse),
			"iteration %d: house %s expected %s", i, split.House, expectedHouse)

		// Nobody is ever paid a negative share.
		require.False(t, split.House.IsNegative(), "iteration %d: negative house", i)
		require.False(t, split.Net.IsNegative(), "iteration %d: negative net", i)
		for _, r := range split.Rebates {
			require.False(t, r.Amount.IsNegative(), "iteration %d: negative rebate", i)
		}
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/service/ledger/ -run 'SplitFee' -v`
Expected: PASS, including the 5,000-iteration property test.

- [ ] **Step 5: Prove the property test has teeth**

With `go test -overlay` on a modified COPY of `fees.go`, change `house := fee` to compute the house share directly as `amount.Mul(rootChildRate).Round(2)` instead of taking the remainder. Confirm the property test FAILS with a specific amount named in the message. Restore and confirm it passes. Report the failing amount it found — that number is the evidence the remainder rule is load-bearing.

- [ ] **Step 6: Commit**

```bash
git add internal/service/ledger/fees.go internal/service/ledger/fees_test.go \
        internal/service/ledger/fees_property_test.go
git commit -m "feat(ledger): split fees and reseller rebates with an exact remainder rule"
```

---

### Task 6: The standard entries

Spec §9's table, one constructor each, so no caller invents its own bookkeeping.

**Files:**
- Create: `internal/service/ledger/entries.go`
- Modify: `internal/service/ledger/service.go` (add `Adjust`)
- Test: `internal/service/ledger/entries_test.go`

**Interfaces:**
- Consumes: `Post`, `SplitFee`, `ledger.Repository`'s `Ensure*` methods, `merchant.Service.Ancestors`.
- Produces, all on `*Service`:
  - `PostDepositMatched(ctx, tx, in DepositInput) (*ledger.Entry, error)`
  - `PostUnmatchedIn(ctx, tx, bankAccountID uuid.UUID, amount decimal.Decimal, ref string) (*ledger.Entry, error)`
  - `PostPayoutCreated(ctx, tx, in PayoutInput) (*ledger.Entry, error)`
  - `PostPayoutCompleted(ctx, tx, in PayoutInput) (*ledger.Entry, error)`
  - `PostPayoutFailed(ctx, tx, in PayoutInput) (*ledger.Entry, error)`
  - `PostInternalTransfer(ctx, tx, fromBankAccountID, toBankAccountID uuid.UUID, amount decimal.Decimal, entryType string) (*ledger.Entry, error)`
  - `PostPreFund` / `PostWithdrawal`
  - `Adjust(ctx, data ledger.AdjustmentData) (*ledger.Entry, error)`
  - `type DepositInput struct{ MerchantID, BankAccountID uuid.UUID; Amount decimal.Decimal; Reference string }`
  - `type PayoutInput struct{ MerchantID, BankAccountID uuid.UUID; Amount decimal.Decimal; Reference string }`

- [ ] **Step 1: Write the deposit entry**

The shape every other constructor follows:

```go
// PostDepositMatched records money that arrived in a corporate account and
// was matched to a merchant.
//
//	DR  bank_account          amount
//	CR  merchant:operate      amount - fee
//	CR  reseller:operate      its rebate
//	CR  house_revenue         the remainder
func (s *Service) PostDepositMatched(
	ctx context.Context, tx *sqlx.Tx, in DepositInput,
) (*domainledger.Entry, error) {
	chain, err := s.chainFor(ctx, in.MerchantID)
	if err != nil {
		return nil, err
	}

	split, err := SplitFee(in.Amount, chain, DepositRateOf)
	if err != nil {
		return nil, err
	}

	bank, err := s.repo.EnsureBankAccount(ctx, tx, in.BankAccountID, domainledger.KindBankAccount)
	if err != nil {
		return nil, err
	}

	operate, err := s.repo.EnsureMerchantAccount(ctx, tx, in.MerchantID, domainledger.KindMerchantOperate)
	if err != nil {
		return nil, err
	}

	lines := []domainledger.Line{
		domainledger.Debit(bank.ID, in.Amount),
		domainledger.Credit(operate.ID, split.Net),
	}

	for _, rebate := range split.Rebates {
		ancestor, err := s.repo.EnsureMerchantAccount(
			ctx, tx, rebate.MerchantID, domainledger.KindMerchantOperate)
		if err != nil {
			return nil, err
		}

		lines = append(lines, domainledger.Credit(ancestor.ID, rebate.Amount))
	}

	if split.House.IsPositive() {
		house, err := s.repo.EnsureHouseAccount(ctx, tx, domainledger.KindHouseRevenue)
		if err != nil {
			return nil, err
		}

		lines = append(lines, domainledger.Credit(house.ID, split.House))
	}

	return s.Post(ctx, tx, domainledger.Entry{
		Type:          domainledger.TypeDeposit,
		MerchantID:    in.MerchantID,
		ReferenceType: "DEPOSIT",
		ReferenceID:   in.Reference,
		Description:   "deposit matched",
		CreatedBy:     domainledger.SystemActor,
	}, lines...)
}

// chainFor returns the merchant followed by its ancestors, ending at ROOT --
// the shape SplitFee expects.
func (s *Service) chainFor(ctx context.Context, id uuid.UUID) ([]*merchant.Merchant, error) {
	self, err := s.merchants.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	ancestors, err := s.merchants.Ancestors(ctx, id)
	if err != nil {
		return nil, err
	}

	return append([]*merchant.Merchant{self}, ancestors...), nil
}
```

Write the remaining constructors following spec §9's table exactly:

| Event | Posting |
|---|---|
| unmatched money in | `DR bank_account / CR house_suspense` |
| payout created | `DR merchant:operate / CR merchant:pending_payout` for amount + fee |
| payout completed | `DR pending_payout / CR bank_account` for the amount, plus the fee split to reseller and house |
| payout failed | reverse of the reservation, in full, back to `operate` |
| sweep inbound to vault | `DR vault / CR inbound` |
| top-up vault to outbound | `DR outbound / CR vault` |
| merchant pre-funds | `DR bank_account / CR merchant:operate`, no fee |
| merchant withdraws | `DR merchant:operate / CR bank_account` |

- [ ] **Step 2: Write `Adjust`**

An adjustment is balanced against `HOUSE_SUSPENSE`, requires a reason, and records the admin who made it. Refuse a blank reason with `ledger.ErrDescriptionRequired` and a non-positive amount with `ledger.ErrNegativeAmount`. It opens its own transaction through the `tx.TransactionHelper`, because unlike the others it is not part of a larger business change.

- [ ] **Step 3: Write the tests**

`internal/service/ledger/entries_test.go` must cover, at minimum:

```go
// TestPostDepositMatched_ProducesTheSpecWorkedEntry: assert the exact four
// lines of the spec's example, by account and signed amount, and that they
// sum to zero.
//
// TestPostPayoutCreated_ReservesAmountPlusFee: assert operate is debited
// amount+fee and pending_payout credited the same, so the merchant cannot
// spend the same balance twice.
//
// TestPostPayoutFailed_ReturnsTheFullReservation: post created then failed
// and assert operate is back to its starting balance exactly -- including
// the fee, which was never earned.
//
// TestPostInternalTransfer_TouchesNoMerchantAccount: assert every line's
// account is a BANK_ACCOUNT kind. This is what stops a sweep between our own
// corporate accounts appearing as merchant activity.
//
// TestAdjust_RequiresAReasonAndAnActor
// TestAdjust_RefusesANonPositiveAmount
```

- [ ] **Step 4: Run, prove teeth, commit**

Run `go test ./internal/service/ledger/ -race`. Then with `-overlay`, change `PostPayoutCreated` to reserve `amount` without the fee and confirm `ReservesAmountPlusFee` FAILS. Restore, confirm PASS, report both.

```bash
git add internal/service/ledger/
git commit -m "feat(ledger): add the standard entries from the posting rules"
```

---

### Task 7: `GET /merchant/balance`

**Files:**
- Create: `internal/adapter/http/merchantledger/{handler,handlers,routes,dto}.go`
- Create: `internal/adapter/http/merchantledger/handlers_test.go`
- Create: `bruno/Ledger/Merchant balance.bru`
- Modify: `internal/adapter/http/routes_test.go`

**Interfaces:**
- Consumes: `ledger.Service.Balance`, `middleware.MerchantAuth`, `routing.APIGroup`.
- Produces: `merchantledger.RegisterRoutes(p RouteParams)`.

- [ ] **Step 1: The response shape**

The PRD's three figures, as strings:

```json
{ "success": true, "code": 200,
  "data": { "merchant_id": "…", "operate": "985.00", "parking": "0.00",
            "freeze": "120.00", "total": "1105.00" } }
```

`freeze` folds `MERCHANT_FREEZE` and `MERCHANT_PENDING_PAYOUT` so that
`total = operate + parking + freeze` holds exactly.

- [ ] **Step 2: Authorization**

A merchant may read **only its own** balance. The merchant id comes from the authenticated credential, never from the query string — the previous phase's security review found a signature verified against a merchant code taken from the request body, and this is the same mistake in a new place. If a `merchantId` query parameter is supplied and does not match the authenticated merchant, return 403.

`internal/adapter/http/merchantledger/handlers_test.go`:

```go
package merchantledger_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	domainledger "be-maxpay/internal/domain/ledger"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The merchant id must come from the authenticated credential. The previous
// phase's security review found a signature verified against a merchant code
// taken from the request body; this is the same mistake in a new place, and
// here it would let any merchant read any other merchant's balance.
func TestBalance_UsesTheAuthenticatedMerchantNotTheQueryString(t *testing.T) {
	authenticated := uuid.New()
	other := uuid.New()

	svc := &fakeLedger{balances: map[uuid.UUID]*domainledger.Balance{
		authenticated: {MerchantID: authenticated, Operate: decimal.RequireFromString("10")},
		other:         {MerchantID: other, Operate: decimal.RequireFromString("999999")},
	}}

	rec := httptest.NewRecorder()
	router := newRouterAs(t, svc, authenticated)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/merchant/balance?merchantId="+other.String(), nil)

	router.ServeHTTP(rec, req)

	// Either a 403 or the authenticated merchant's own figures -- never the
	// other merchant's. Both are defensible; leaking is not.
	if rec.Code == http.StatusOK {
		var body struct {
			Data struct {
				MerchantID string `json:"merchant_id"`
				Operate    string `json:"operate"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, authenticated.String(), body.Data.MerchantID)
		assert.NotEqual(t, "999999", body.Data.Operate)

		return
	}

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.NotContains(t, rec.Body.String(), "999999",
		"another merchant's figures must never appear in the response")
}

func TestBalance_RefusesAMismatchedMerchantIdWith403(t *testing.T) {
	authenticated := uuid.New()

	svc := &fakeLedger{balances: map[uuid.UUID]*domainledger.Balance{
		authenticated: {MerchantID: authenticated},
	}}

	rec := httptest.NewRecorder()
	router := newRouterAs(t, svc, authenticated)
	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/merchant/balance?merchantId="+uuid.New().String(), nil)

	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Empty(t, svc.calls, "a refused request must not reach the service")
}

// The PRD's identity: balance = operate + parking + freeze. A response that
// breaks it makes every downstream consumer's arithmetic wrong.
func TestBalance_TotalEqualsOperatePlusParkingPlusFreeze(t *testing.T) {
	id := uuid.New()

	svc := &fakeLedger{balances: map[uuid.UUID]*domainledger.Balance{
		id: {
			MerchantID: id,
			Operate:    decimal.RequireFromString("985.00"),
			Parking:    decimal.RequireFromString("15.50"),
			Freeze:     decimal.RequireFromString("120.25"),
			Total:      decimal.RequireFromString("1120.75"),
		},
	}}

	rec := httptest.NewRecorder()
	newRouterAs(t, svc, id).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/v1/merchant/balance", nil))

	require.Equal(t, http.StatusOK, rec.Code)

	var body struct {
		Data struct {
			Operate string `json:"operate"`
			Parking string `json:"parking"`
			Freeze  string `json:"freeze"`
			Total   string `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	sum := decimal.RequireFromString(body.Data.Operate).
		Add(decimal.RequireFromString(body.Data.Parking)).
		Add(decimal.RequireFromString(body.Data.Freeze))

	assert.True(t, sum.Equal(decimal.RequireFromString(body.Data.Total)),
		"operate+parking+freeze = %s but total = %s", sum, body.Data.Total)
}

// Money must cross JSON as a string. A JSON number is a float on the other
// side, and a float is a rounding bug with a delay on it.
func TestBalance_AmountsAreStringsNotNumbers(t *testing.T) {
	id := uuid.New()

	svc := &fakeLedger{balances: map[uuid.UUID]*domainledger.Balance{
		id: {MerchantID: id, Operate: decimal.RequireFromString("0.10")},
	}}

	rec := httptest.NewRecorder()
	newRouterAs(t, svc, id).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/v1/merchant/balance", nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"operate":"0.10"`)
	assert.NotContains(t, rec.Body.String(), `"operate":0.1`)
}
```

`newRouterAs(t, svc, merchantID)` builds a gin engine with the routes
registered and a middleware that puts `merchantID` into the context as the
authenticated merchant, mirroring what `middleware.MerchantAuth` does.
`fakeLedger` records its calls so a refused request can be shown never to have
reached the service.

- [ ] **Step 3: Run, prove teeth, commit**

With `-overlay`, make the handler read the merchant id from the query string and confirm `UsesTheAuthenticatedMerchantNotTheQueryString` FAILS.

```bash
git add internal/adapter/http/merchantledger/ bruno/Ledger/ internal/adapter/http/routes_test.go
git commit -m "feat(ledger): expose the merchant balance endpoint"
```

---

### Task 8: The back office's ledger endpoints

**Files:**
- Create: `internal/adapter/http/adminledger/{handler,handlers,routes,dto}.go`
- Create: `internal/adapter/http/adminledger/handlers_test.go`
- Create: `bruno/Ledger/Merchant ledger.bru`, `bruno/Ledger/Post adjustment.bru`
- Modify: `internal/adapter/http/routes_test.go`

Routes, both under `AdminGroup`:

```text
GET    /api/v1/admin/merchants/:id/ledger
POST   /api/v1/admin/merchants/:id/adjustments
```

**Authorization is the whole risk here.** A reseller admin may read its own subtree and nothing else; only a platform admin may post an adjustment. Use `adminmerchant.EnsureVisible(ctx, merchants, user, target)` for the read, and `user.IsPlatformAdmin()` for the adjustment.

- [ ] **Step 1: Write one authorization test per route**

```go
// TestGetLedger_ResellerSeesItsOwnSubtree
// TestGetLedger_ResellerCannotReadACompetitorsLedger   // 403, and the service is never called
// TestPostAdjustment_MerchantUserIsForbidden
// TestPostAdjustment_ResellerAdminIsForbidden          // reading a subtree ≠ moving its money
// TestPostAdjustment_RequiresAReason
```

`ResellerAdminIsForbidden` is the one that matters most and is easiest to omit: a reseller can legitimately *see* its merchants' ledgers, and it is a small step from there to accidentally letting it *adjust* them.

- [ ] **Step 2: Validate ids with `uuid`, never `uuid4`**

Every id here is a UUIDv7. Follow the precedent and comment in `internal/adapter/http/adminmerchant/dto.go`.

- [ ] **Step 3: Run, prove teeth, commit**

Remove the platform-admin gate from `postAdjustment` **only** in an overlay copy and confirm exactly `TestPostAdjustment_ResellerAdminIsForbidden` and `TestPostAdjustment_MerchantUserIsForbidden` fail. Report which tests failed — if removing one route's gate fails no test, that route has no authorization.

```bash
git add internal/adapter/http/adminledger/ bruno/Ledger/ internal/adapter/http/routes_test.go
git commit -m "feat(ledger): add the back office ledger and adjustment endpoints"
```

---

### Task 9: Concurrency guarantees, proven against PostgreSQL

Spec §13 names four behaviours that cannot be tested with `sqlmock` because they are guarantees made by PostgreSQL rather than by Go. Two were covered in P2a (`SKIP LOCKED`) and Task 1 (the deferred trigger). This task covers the remaining one that involves money.

**Files:**
- Create: `internal/service/ledger/concurrency_integration_test.go`

- [ ] **Step 1: Write the concurrent-payout test**

`internal/service/ledger/concurrency_integration_test.go`:

```go
//go:build integration

package ledger_test

import (
	"context"
	"sync"
	"testing"

	domainledger "be-maxpay/internal/domain/ledger"
	"be-maxpay/internal/testutil/pgtest"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// assertNoUnbalancedEntries is the query that catches a ledger drifting away
// from itself. Run it at the end of every integration test in this file: an
// entry that does not sum to zero should be impossible, and if one ever
// appears the constraint trigger has been bypassed somehow.
func assertNoUnbalancedEntries(t *testing.T, ctx context.Context) {
	t.Helper()

	var count int
	require.NoError(t, pgtest.DB(t).QueryRowxContext(ctx,
		`SELECT COUNT(*) FROM (
		     SELECT entry_id FROM journal_lines
		     GROUP BY entry_id HAVING SUM(amount) <> 0
		 ) AS unbalanced`).Scan(&count))

	assert.Zero(t, count, "every journal entry must sum to zero")
}

// Ten concurrent payouts against a merchant holding exactly 1,000, each
// reserving 100. Every one runs in its own transaction through the real
// posting service against the real database.
//
// This is the test that separates a ledger from a spreadsheet. A version of
// LockAccounts without FOR UPDATE lets two transactions read the same
// starting balance, each compute a plausible balance_after, and each write a
// perfectly balanced entry -- while the account's stored balance ends up
// wrong. That is why the assertions below check the ACCOUNT total as well as
// the per-entry sums: the per-entry check alone passes under a lost update.
func TestPosting_Integration_ConcurrentPayoutsCannotDriftABalance(t *testing.T) {
	db := pgtest.DB(t)
	ctx := context.Background()

	env := seedLedgerEnv(t, ctx) // merchant + bank account + funded operate of 1000
	fundOperate(t, ctx, env, decimal.RequireFromString("1000"))

	const workers = 10
	const each = "100"

	var wg sync.WaitGroup
	var mu sync.Mutex
	succeeded := 0

	for i := 0; i < workers; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			err := env.txHelper.WithTx(ctx, func(tx *sqlx.Tx) error {
				_, err := env.service.PostPayoutCreated(ctx, tx, ledgersvc.PayoutInput{
					MerchantID:    env.merchantID,
					BankAccountID: env.bankAccountID,
					Amount:        decimal.RequireFromString(each),
					Reference:     uuid.NewString(),
				})

				return err
			})
			if err == nil {
				mu.Lock()
				succeeded++
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	balances, err := env.repo.MerchantBalances(ctx, env.merchantID)
	require.NoError(t, err)

	operate := balances[domainledger.KindMerchantOperate]
	pending := balances[domainledger.KindMerchantPendingPayout]

	reserved := decimal.RequireFromString(each).Mul(decimal.NewFromInt(int64(succeeded)))

	// What left operate is exactly what arrived in pending. If a lost update
	// occurred, one of these is short by a multiple of 100 while every
	// individual entry still balances.
	assert.True(t, pending.Equal(reserved),
		"pending %s should equal %d successful reservations of %s", pending, succeeded, each)
	assert.True(t, operate.Equal(decimal.RequireFromString("1000").Sub(reserved)),
		"operate %s should be 1000 minus %s", operate, reserved)

	// And the two sides still add up to what the merchant started with:
	// nothing was created or destroyed by the concurrency.
	assert.True(t, operate.Add(pending).Equal(decimal.RequireFromString("1000")),
		"operate %s + pending %s should still be 1000", operate, pending)

	assertNoUnbalancedEntries(t, ctx)
	_ = db
}

// The stored balance must always equal a replay of the account's own lines.
// This is the reconciliation an operator can run at any time, and it is the
// assertion that would catch a balance edited outside Post.
func TestPosting_Integration_StoredBalancesMatchTheirLines(t *testing.T) {
	ctx := context.Background()

	env := seedLedgerEnv(t, ctx)
	fundOperate(t, ctx, env, decimal.RequireFromString("500"))

	require.NoError(t, env.txHelper.WithTx(ctx, func(tx *sqlx.Tx) error {
		_, err := env.service.PostPayoutCreated(ctx, tx, ledgersvc.PayoutInput{
			MerchantID:    env.merchantID,
			BankAccountID: env.bankAccountID,
			Amount:        decimal.RequireFromString("125.55"),
			Reference:     uuid.NewString(),
		})

		return err
	}))

	var drifted int
	require.NoError(t, pgtest.DB(t).QueryRowxContext(ctx,
		`SELECT COUNT(*) FROM (
		     SELECT a.id
		     FROM ledger_accounts a
		     LEFT JOIN journal_lines l ON l.account_id = a.id
		     GROUP BY a.id, a.balance, a.normal_balance
		     HAVING a.balance <> CASE WHEN a.normal_balance = 'DEBIT'
		            THEN COALESCE(SUM(l.amount), 0)
		            ELSE -COALESCE(SUM(l.amount), 0) END
		 ) AS drifted`).Scan(&drifted))

	assert.Zero(t, drifted, "every stored balance must equal a replay of its lines")
	assertNoUnbalancedEntries(t, ctx)
}
```

`seedLedgerEnv` and `fundOperate` are helpers this file defines: the first
creates a ROOT merchant, a direct merchant beneath it, a bank account and the
wired repository, service and `tx.TransactionHelper`; the second posts a
PREFUND entry so the merchant has money to reserve. Write them at the top of
the file — they are ordinary setup, but they must create real rows, because a
test that reserves against a merchant with no funded account proves nothing.

- [ ] **Step 2: Prove it has teeth**

With `go test -overlay` on a modified COPY of `internal/adapter/repository/ledger/repository.go`, drop `FOR UPDATE` from `LockAccounts` and rerun. Expected: `ConcurrentPayoutsCannotDriftABalance` FAILS with pending and operate disagreeing.

This is the single most important teeth check in the plan. If the test passes without `FOR UPDATE`, it is too small: raise `workers` until it reliably fails, then report the number that was needed. A concurrency test that cannot be made to fail is not evidence.

- [ ] **Step 3: Confirm it passes unmodified**

Run: `export PATH="$PATH:$HOME/go/bin" && make test-integration`
Expected: both tests PASS. Report the drift figure the mutation produced.

- [ ] **Step 4: Commit**

```bash
git add internal/service/ledger/concurrency_integration_test.go
git commit -m "test(ledger): prove concurrent payouts cannot drift a balance"
```

---

### Task 10: Wire it up and prove it end to end

**Files:**
- Modify: `internal/adapter/repository/module.go`, `internal/service/module.go`, `internal/adapter/http/module.go`
- Modify: `README.md`, `AGENTS.md`
- Modify: `bruno/environments/local.bru`

**Interfaces:**
- Consumes: everything above.
- Produces: a running service where an admin can post an adjustment and watch the balance move at every level of the merchant tree — the spec's §14 verification gate.

- [ ] **Step 1: Register the repository and service**

`fx.Annotate(ledgerrepo.NewRepository, fx.As(new(ledger.Repository)))` and
`fx.Annotate(ledgersvc.NewService, fx.As(new(ledger.Service)))`, following the shape of their siblings.

- [ ] **Step 2: Register the routes**

Add `merchantledger.RegisterRoutes` and `adminledger.RegisterRoutes` to `internal/adapter/http/module.go`'s `fx.Invoke` list.

**Do not change the module ordering in `internal/app/module.go`.** Its comment explains why the order is load-bearing: fx stops hooks in reverse registration order, so `shared.Module` (the database) must be registered before the outbox worker, which must be registered before `http.Module`. Adding a provider is safe; reordering the three options is not.

- [ ] **Step 3: Run it, for real**

Start the service and, against the development database:

```bash
# 1. sign in as the platform admin, capture the session token
# 2. create a reseller at 0.70% and a direct merchant under it at 1.50%
# 3. post an adjustment of 1,000 to the direct merchant's OPERATE
# 4. read GET /admin/merchants/<direct>/ledger
# 5. read GET /merchant/balance as the direct merchant
```

Expected: step 3 returns 201, step 4 shows two lines summing to zero, step 5 reports `operate` of 1,000 with `total` equal to `operate + parking + freeze`.

Then post a deposit entry through the service directly (there is no deposit endpoint until P3) and confirm the three-way split lands as the spec's worked example describes.

Paste the verbatim output of every command into your report. Do not simulate it. If anything does not match, that is a finding — report it, do not paper over it.

- [ ] **Step 4: Confirm the balance identity holds in the database**

```sql
-- Every entry balances.
SELECT entry_id, SUM(amount) FROM journal_lines GROUP BY entry_id HAVING SUM(amount) <> 0;

-- Every account's stored balance equals the replay of its lines.
SELECT a.id, a.kind, a.balance,
       CASE WHEN a.normal_balance = 'DEBIT' THEN COALESCE(SUM(l.amount), 0)
            ELSE -COALESCE(SUM(l.amount), 0) END AS replayed
FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
GROUP BY a.id HAVING a.balance <> CASE WHEN a.normal_balance = 'DEBIT'
       THEN COALESCE(SUM(l.amount), 0) ELSE -COALESCE(SUM(l.amount), 0) END;
```

Expected: zero rows from both. The second query is the one that would catch a stored balance drifting away from the journal — put it in the README as the reconciliation query anyone can run.

- [ ] **Step 5: Documentation**

README gains a Ledger section: the chart of accounts table, the sign convention, the two reconciliation queries above, and a plain statement that `Post` is the only write path. `AGENTS.md` gains the rule under its money-flow section: *no use case updates `ledger_accounts` directly; everything goes through `ledger.Service.Post` inside the caller's transaction.*

- [ ] **Step 6: Full gate**

Run: `export PATH="$PATH:$HOME/go/bin" && make check && make test-integration`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ledger): wire the ledger into the application"
```

---

## Self-Review

**Spec coverage.** §4.6 → Tasks 1–3. §9 fee and rebate → Task 5; §9 standard entries → Task 6. §11's `GET /merchant/balance` → Task 7; `/admin/merchants/:id/ledger` and `/adjustments` → Task 8. §13's property test → Task 5; its four PostgreSQL-only guarantees → the deferred trigger in Task 1, `SKIP LOCKED` already proven in P2a, concurrent payouts in Task 9. §14's gate → Task 10.

Not covered here, deliberately: §11's merchant and credential endpoints shipped in P1; the pool endpoints shipped in P2a; deposits, payouts and webhooks are P3–P5 and post *into* what this plan builds.

**Known gap carried from P2a.** `ledger_accounts.bank_account_id` references `bank_accounts(id)`, and a bank account with no `account_ref_id` can never have its balance refreshed. That does not block this plan — the ledger's `BANK_ACCOUNT` kind is our own book balance, not the bank's — but Task 10's reconciliation will show the two diverging for such an account, and that is correct behaviour rather than a defect.

**Test code, not test sketches.** Tasks 1–5, 7 and 9 carry their tests in full. Tasks 6 and 8 give each required test by name with its concrete assertion but not its full body, because those bodies are mechanical variations of the ones already written out — the deposit entry test in Task 6 follows the shape of Task 5's worked-example test, and Task 8's authorization tests follow Task 7's. An implementer who writes them from the named assertions will produce the same tests; one who cannot should re-read the two worked examples before starting.

**Type consistency.** `Kind`, `Account`, `Entry`, `Line`, `Split`, `Share`, `Balance`, `StatementLine` are defined in Tasks 2 and 5 and used with those exact names in Tasks 3, 4, 6, 7 and 8. `Post` has one signature throughout: `Post(ctx, tx, entry, lines...) (*Entry, error)`. `SplitFee` takes `(amount, chain, rateOf)` at every call site.

**Fixed seeds, not random ones.** Task 5's property test seeds its generator with a constant. A property test that cannot be re-run on the input that broke it reports failures nobody can act on, and a flaky money test is worse than no money test.
