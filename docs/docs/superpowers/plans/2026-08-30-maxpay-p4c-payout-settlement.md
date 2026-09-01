# P4c — Payout Settlement Through The Bulk Lane · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch payouts into one KTB bulk order and settle each one
independently from the bank's own per-item record.

**Architecture:** Four tickers replace P4b's single sender. A batcher claims
PENDING payouts on a timer or a count cap, resolves every payee name first,
fits the batch to the source account's balance, and writes one
`payout_batches` row. A sender drives the existing bulk service — which gains
the transfer lane's hooks so the bank's order id is recorded before money can
move — and records the bank's reference numbers. A reconciler reads each
item's status from the bank's **detail** endpoint and settles that payout
alone, falling back to the statement when the bank will not answer. A
recoverer returns batches that never reached the bank. The bank's per-item fee
is a platform cost, posted to a new `HOUSE_EXPENSE` ledger account, and never
touches the merchant.

**Tech Stack:** Go 1.25 · Gin · fx · sqlx + squirrel · PostgreSQL 18 · Zap ·
shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-30-maxpay-p4c-payout-settlement-design.md`

## Global Constraints

- Money is `decimal.Decimal`. Never `float64`. No exceptions.
- **Never truncate, drop, or `UPDATE` anything in the `maxpay` development
  database.** It holds a bank device registered against a live corporate
  login that cannot be recreated without sending the account holder another
  OTP. Integration tests use `pgtest.DB(t)` and `pgtest.Truncate`, which point
  at the test database, never `maxpay`.
- Never run `make migrate-up` / `migrate-down` / `migrate-reset` without an
  explicit `DATABASE_URL`. Never run `make docker-up`.
- `export PATH="$PATH:$HOME/go/bin"` before any `make check` — without it
  `golangci-lint` is silently absent and the gate reports green while failing.
- Both gates must pass before every commit: `make check` and
  `make test-integration`. The integration suite needs `-p 1`; the payout
  packages truncate shared tables and lose rows to each other without it.
- Never log or print the PIN, API key, secret key, or any merchant credential.
- No task turns on `payout.send_enabled` or any other money-moving switch.
  Config switches are the operator's.
- No task calls the real bank. Every bank interaction in this plan is faked.
- **Settlement reads the item DETAIL endpoint only.** The list endpoint
  returns a Thai display label under the same field name; comparing it to a
  code silently matches nothing forever. See spec §10.
- **`isCompleted` is never read.** It is `true` at submission time, before the
  money moves.
- **`GET /accounts/cashflow` is never read.** It serves a stale balance. Only
  `overview` informs a money decision.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `db/migrations/000018_house_expense.{up,down}.sql` | Admit `HOUSE_EXPENSE` to the ledger kind CHECK |
| `db/migrations/000019_payout_batches.{up,down}.sql` | `payout_batches`, and three columns on `payouts` |
| `internal/domain/payoutbatch/entity.go` | The `Batch` entity and its statuses |
| `internal/domain/payoutbatch/errors.go` | Sentinel errors |
| `internal/domain/payoutbatch/repository.go` | The repository port |
| `internal/adapter/repository/payoutbatch/repository.go` | Its Postgres implementation |
| `internal/service/payout/batcher.go` | Claims payouts and opens batches |
| `internal/service/payout/batchsender.go` | Sends one batch down the bulk lane |
| `internal/service/payout/reconciler.go` | Settles each payout from the bank's item detail |
| `internal/service/payout/batchproducer.go` | The tickers that drive the batcher, sender and reconciler |
| `internal/service/payout/batchrecoverer.go` | Returns batches that never reached the bank; ungated |

**Modified**

| File | Change |
|---|---|
| `internal/domain/ledger/entity.go` | `KindHouseExpense`, and `NormalBalance` must return `NormalDebit` for it |
| `internal/service/ledger/entries.go` | Bank-fee lines in `PostPayoutCompleted` and `PostPayoutFailed` |
| `internal/service/transfer/bulk.go` | `Bulk` takes `Hooks` |
| `internal/domain/payout/{entity,repository}.go` | Batch columns and the methods that write them |
| `internal/adapter/repository/payout/repository.go` | `payoutColumns` plus the batch-aware queries |
| `internal/shared/config.go`, `config.yaml.example` | The six new `payout:` keys |
| `internal/service/module.go` | Wire the four tickers |

---

## Task 1: `HOUSE_EXPENSE` ledger account kind

**Files:**
- Create: `db/migrations/000018_house_expense.up.sql`
- Create: `db/migrations/000018_house_expense.down.sql`
- Modify: `internal/domain/ledger/entity.go`
- Test: `internal/domain/ledger/validator_test.go`

**Interfaces:**
- Produces: `domainledger.KindHouseExpense Kind = "HOUSE_EXPENSE"`, and
  `Kind.NormalBalance()` returning `NormalDebit` for it.

**Why:** the platform now absorbs the bank's transfer fee. It has to land in
an account, and every existing kind is either a merchant's, a bank account's,
or revenue. Debiting `HOUSE_REVENUE` would work arithmetically and destroy
the ability to answer "what did bank fees cost us" — which is the whole point
of deciding the platform pays them.

- [ ] **Step 1: Write the failing test**

Add to `internal/domain/ledger/validator_test.go`:

```go
// HOUSE_EXPENSE is the second debit-normal kind. Everything else on the books
// is a liability or revenue, which a credit increases; an expense behaves
// like the asset account it is paid out of.
func TestKind_HouseExpenseIsDebitNormal(t *testing.T) {
	assert.Equal(t, ledger.NormalDebit, ledger.KindHouseExpense.NormalBalance())
	assert.Equal(t, ledger.OwnerHouse, ledger.KindHouseExpense.Owner())
}

func TestKind_EverythingElseStaysCreditNormal(t *testing.T) {
	for _, k := range []ledger.Kind{
		ledger.KindMerchantOperate, ledger.KindMerchantParking,
		ledger.KindMerchantFreeze, ledger.KindMerchantPendingPayout,
		ledger.KindHouseRevenue, ledger.KindHouseSuspense,
	} {
		assert.Equal(t, ledger.NormalCredit, k.NormalBalance(), string(k))
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/domain/ledger/... -run HouseExpense -v
```

Expected: FAIL — `KindHouseExpense` is undefined.

- [ ] **Step 3: Add the kind and fix `NormalBalance`**

In `internal/domain/ledger/entity.go`, after `KindHouseSuspense`:

```go
	// KindHouseExpense is a cost the platform pays that is deducted from no
	// merchant. Today that is the bank's per-transfer fee and nothing else.
	// It is kept out of HOUSE_REVENUE deliberately: netting a cost against
	// revenue makes both unanswerable.
	KindHouseExpense Kind = "HOUSE_EXPENSE"
```

`NormalBalance` currently special-cases one kind. It now has two:

```go
// NormalBalance reports which direction increases this kind of account.
//
// BANK_ACCOUNT and HOUSE_EXPENSE are debit-normal: an asset the platform
// holds, and a cost it has paid. Everything else is a liability or revenue,
// which a credit increases.
func (k Kind) NormalBalance() string {
	if k == KindBankAccount || k == KindHouseExpense {
		return NormalDebit
	}

	return NormalCredit
}
```

Confirm `Owner()` returns `OwnerHouse` for it — read the switch and add the
case if the default does not already do so.

- [ ] **Step 4: Write the migration**

`db/migrations/000018_house_expense.up.sql`:

```sql
-- HOUSE_EXPENSE holds costs the platform pays that are deducted from no
-- merchant -- the bank's per-transfer fee, which the platform absorbs.
-- Netting it against HOUSE_REVENUE would make both figures unanswerable.
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_kind;

ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind CHECK (kind IN (
    'BANK_ACCOUNT', 'MERCHANT_OPERATE', 'MERCHANT_PARKING', 'MERCHANT_FREEZE',
    'MERCHANT_PENDING_PAYOUT', 'HOUSE_REVENUE', 'HOUSE_SUSPENSE',
    'HOUSE_EXPENSE'));
```

`db/migrations/000018_house_expense.down.sql`:

```sql
-- Refuses to run while any HOUSE_EXPENSE row exists rather than dropping the
-- constraint and leaving rows the restored CHECK forbids.
DELETE FROM ledger_accounts WHERE kind = 'HOUSE_EXPENSE' AND balance = 0;

ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_kind;

ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind CHECK (kind IN (
    'BANK_ACCOUNT', 'MERCHANT_OPERATE', 'MERCHANT_PARKING', 'MERCHANT_FREEZE',
    'MERCHANT_PENDING_PAYOUT', 'HOUSE_REVENUE', 'HOUSE_SUSPENSE'));
```

- [ ] **Step 5: Run the package and both gates**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/domain/ledger/... && make check && make test-integration
```

- [ ] **Step 6: Commit**

```bash
git add db/migrations/000018_house_expense.up.sql \
        db/migrations/000018_house_expense.down.sql \
        internal/domain/ledger/entity.go \
        internal/domain/ledger/validator_test.go
git commit -m "feat: add the HOUSE_EXPENSE ledger account kind"
```

---

## Task 2: Post the bank's fee against the bank account

**Files:**
- Modify: `internal/service/ledger/entries.go` (`PayoutInput`,
  `PostPayoutCompleted`, `PostPayoutFailed`)
- Test: `internal/service/ledger/entries_test.go`
- Test: `internal/service/ledger/entries_integration_test.go`

**Interfaces:**
- Consumes: `domainledger.KindHouseExpense` from Task 1.
- Produces: `PayoutInput.BankFee decimal.Decimal` — the bank's own charge for
  this payout, zero when there was none.

**Why:** `PostPayoutCompleted` credits `BANK_ACCOUNT` with the payout amount
alone, while the bank debits the amount **plus its fee**. Every interbank
payout therefore moves the ledger's view of the corporate account 5 THB away
from the bank's, and nothing reports the drift. This is the single most
consequential line in the phase.

`BankFee` is a plain `decimal.Decimal` rather than a pointer, unlike
`ReservedFee`: zero is a meaningful, common value here (every same-bank
payout), where a missing reserved fee is a caller bug.

- [ ] **Step 1: Write the failing tests**

```go
// The bank debits the amount AND its fee. Crediting only the amount leaves
// the book balance 5 THB above the real one on every interbank payout, and
// nothing in the system reports the gap.
func TestPostPayoutCompleted_CreditsTheBankTheFeeItActuallyCharged(t *testing.T) {
	// ... build a completed payout with Amount 100.00, ReservedFee 1.00,
	// BankFee 5.00 ...

	entry, err := svc.PostPayoutCompleted(ctx, tx, in)
	require.NoError(t, err)

	assert.True(t, lineFor(entry, bankAccountID).Amount.Equal(decimal.RequireFromString("105.00")),
		"the bank account must be credited what the bank took, not what the payee received")
	assert.True(t, lineFor(entry, houseExpenseID).Amount.Equal(decimal.RequireFromString("5.00")),
		"the fee the platform absorbed must be visible as a cost")
}

// A same-bank payout is charged nothing, and a zero-amount line is refused by
// the ledger schema -- so the fee lines must be absent, not zero.
func TestPostPayoutCompleted_AZeroBankFeePostsNoFeeLines(t *testing.T) {
	// ... same, with BankFee zero ...

	entry, err := svc.PostPayoutCompleted(ctx, tx, in)
	require.NoError(t, err)

	assert.Nil(t, lineFor(entry, houseExpenseID),
		"a zero-amount line is refused by the schema and must not be built")
	assert.True(t, lineFor(entry, bankAccountID).Amount.Equal(decimal.RequireFromString("100.00")))
}

// Whether the bank charges for a failed transfer is unknown -- no failing
// item has ever been observed. The design does not need to know: the fee is
// whatever the bank's own record says, so a charged fee posts and an
// uncharged one produces no lines.
func TestPostPayoutFailed_PostsTheFeeTheBankChargedAnyway(t *testing.T) {
	// ... failed payout, Amount 100.00, ReservedFee 1.00, BankFee 5.00 ...

	entry, err := svc.PostPayoutFailed(ctx, tx, in)
	require.NoError(t, err)

	assert.True(t, lineFor(entry, bankAccountID).Amount.Equal(decimal.RequireFromString("5.00")),
		"a fee the bank kept left the account even though the transfer did not")
	assert.True(t, lineFor(entry, houseExpenseID).Amount.Equal(decimal.RequireFromString("5.00")))
}

func TestPostPayoutFailed_AZeroBankFeeTouchesNoBankAccount(t *testing.T) {
	// ... failed payout, BankFee zero ...

	assert.Nil(t, lineFor(entry, bankAccountID),
		"a failure that cost nothing must not touch the bank account at all")
}
```

Write `lineFor(entry *domainledger.Entry, accountID uuid.UUID) *domainledger.Line`
as a test helper returning nil when no line names that account.

- [ ] **Step 2: Run them and watch them fail**

```bash
go test ./internal/service/ledger/... -run PayoutCompleted -v
```

Expected: FAIL — `BankFee` is not a field of `PayoutInput`.

- [ ] **Step 3: Add the field**

```go
	// BankFee is what the bank itself charged to move this payout, read from
	// its own record at settlement -- never computed here. It is the
	// platform's cost, not the merchant's: it is absent from the reservation,
	// absent from every merchant callback, and does not change what the payee
	// receives.
	//
	// Zero is ordinary: a same-bank transfer is free. Zero must produce no
	// fee lines at all, because the ledger schema refuses a zero-amount line.
	BankFee decimal.Decimal
```

- [ ] **Step 4: Post the lines in `PostPayoutCompleted`**

The bank line becomes the amount plus the fee, and the expense line balances
it:

```go
	lines := []domainledger.Line{
		domainledger.Debit(pending.ID, in.Amount.Add(reservedFee)),
		domainledger.Credit(bank.ID, in.Amount.Add(in.BankFee)),
	}

	// The bank's fee left the corporate account and was deducted from no
	// merchant, so it is the platform's cost. A zero fee -- every same-bank
	// payout -- must add no line: the schema refuses a zero amount.
	if in.BankFee.IsPositive() {
		expense, expErr := s.repo.EnsureHouseAccount(ctx, tx, domainledger.KindHouseExpense)
		if expErr != nil {
			return nil, expErr
		}

		lines = append(lines, domainledger.Debit(expense.ID, in.BankFee))
	}
```

- [ ] **Step 5: Post the same pair in `PostPayoutFailed`**

`PostPayoutFailed` currently touches no bank account, because a failed
transfer moved nothing. That stays true for the amount and becomes false for
the fee only when the bank actually charged one:

```go
	if in.BankFee.IsPositive() {
		bank, bankErr := s.repo.EnsureBankAccount(ctx, tx, in.BankAccountID, domainledger.KindBankAccount)
		if bankErr != nil {
			return nil, bankErr
		}

		expense, expErr := s.repo.EnsureHouseAccount(ctx, tx, domainledger.KindHouseExpense)
		if expErr != nil {
			return nil, expErr
		}

		lines = append(lines,
			domainledger.Credit(bank.ID, in.BankFee),
			domainledger.Debit(expense.ID, in.BankFee),
		)
	}
```

- [ ] **Step 6: Run the package**

```bash
go test ./internal/service/ledger/...
```

Expected: PASS. Existing callers pass a zero `BankFee` by default and their
behaviour is unchanged — that is the point of the zero case.

- [ ] **Step 7: Add an integration test that the entry balances**

In `entries_integration_test.go`, post a completed payout with a non-zero
`BankFee` against a real database and assert the entry's debits equal its
credits. The unit tests check which lines exist; only this checks that the
schema accepts the entry and that both sides total
`amount + reservedFee + bankFee`.

- [ ] **Step 8: Mutation-test the bank line**

Build a modified copy of `entries.go` where
`domainledger.Credit(bank.ID, in.Amount.Add(in.BankFee))` reverts to
`domainledger.Credit(bank.ID, in.Amount)`, and run it under `go test -overlay`.
**Run a sanity mutant first** — `-overlay` fails open, and a `[build failed]`
is not a kill. This mutation must be killed. If it survives, the drift this
task exists to prevent is untested and the task is not done.

- [ ] **Step 9: Both gates, then commit**

```bash
export PATH="$PATH:$HOME/go/bin"
make check && make test-integration
git add internal/service/ledger/
git commit -m "fix: credit the bank account the fee the bank actually charged"
```

---

## Task 3: Give the bulk lane the transfer lane's hooks

**Files:**
- Modify: `internal/service/transfer/bulk.go`
- Modify: `internal/service/payout/sender.go` (its one `Bulk` call site, if any)
- Test: `internal/service/transfer/bulk_test.go`

**Interfaces:**
- Consumes: `domaintransfer.Hooks{OnOrderCreated, OnConfirmed}`, already
  defined in `internal/domain/transfer/dto.go`.
- Produces: `func (s *Service) Bulk(ctx context.Context, alias string, data
  domaintransfer.Data, hooks domaintransfer.Hooks) (*domaintransfer.BulkResult, error)`

**Why:** `Bulk` runs create → add items → verify → pre-confirm → MFA → commit
in one call with no seam. A caller cannot record the bank's order id before
the money can move, which breaks the discipline P4b established and Task 7
depends on: **the bank's identifier is recorded before the call that can move
money**, so a process that dies mid-sequence can ask the bank about that
specific order instead of guessing. Without it there is no recovery story for
a whole batch of payments.

- [ ] **Step 1: Write the failing tests**

```go
// The order id must reach the caller before anything can move money, so a
// sender that dies mid-sequence can still ask the bank about that order.
func TestBulk_OnOrderCreatedFiresBeforeAnythingCommits(t *testing.T) {
	h := newHarness(t, readyDevice())

	var seenAt int
	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	}, domaintransfer.Hooks{
		OnOrderCreated: func(_ context.Context, orderID string) error {
			assert.Equal(t, "BO1", orderID)
			seenAt = len(h.bulk.calls)
			return nil
		},
	})
	require.NoError(t, err)

	assert.NotContains(t, h.bulk.calls[:seenAt], "submit",
		"the hook must fire before any call that can commit the order")
	assert.NotContains(t, h.bulk.calls[:seenAt], "confirm")
}

// A caller that cannot record the order id must not go on to commit: it would
// pay a batch of recipients with no record of which order did it.
func TestBulk_AFailingOnOrderCreatedStopsBeforeCommitting(t *testing.T) {
	h := newHarness(t, readyDevice())

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	}, domaintransfer.Hooks{
		OnOrderCreated: func(context.Context, string) error {
			return errors.New("database down")
		},
	})
	require.Error(t, err)

	assert.NotContains(t, h.bulk.calls, "submit",
		"an unrecorded order must never be committed")
	assert.NotContains(t, h.bulk.calls, "confirm")
}

func TestBulk_OnConfirmedFiresAfterTheCommit(t *testing.T) {
	h := newHarness(t, readyDevice())

	confirmed := false
	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	}, domaintransfer.Hooks{
		OnConfirmed: func(context.Context) error { confirmed = true; return nil },
	})
	require.NoError(t, err)

	assert.True(t, confirmed)
}

// Both hooks are optional; every existing caller passes none.
func TestBulk_NilHooksAreSkipped(t *testing.T) {
	h := newHarness(t, readyDevice())

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	}, domaintransfer.Hooks{})
	require.NoError(t, err)
}
```

- [ ] **Step 2: Run them and watch them fail**

Expected: build failure — `Bulk` takes three arguments.

- [ ] **Step 3: Thread `hooks` through `Bulk` and `runBulk`**

Add the parameter to both signatures and fire the hooks in `runBulk`.
`OnOrderCreated` goes immediately after `bulkOrderID` is assigned and
**before** the existing `noRetryAfterOrder` defer's protected region does any
work — order id first, then everything else. `OnConfirmed` goes immediately
after the submit/confirm block succeeds, before the summary and items are read
back, mirroring `runTransfer`:

```go
	// Money moves at the commit far below; everything between here and there
	// is preparation and moves nothing. Reporting the order id now is what
	// lets a caller that dies mid-sequence ask the bank about this order
	// afterwards. A caller that cannot record it must not go on to commit --
	// on this lane that would be a whole batch of unattributable payments.
	if hooks.OnOrderCreated != nil {
		if hookErr := hooks.OnOrderCreated(ctx, bulkOrderID); hookErr != nil {
			return nil, hookErr
		}
	}
```

- [ ] **Step 4: Update every existing call site**

`grep -rn --include='*.go' '\.Bulk(' internal/` and pass
`domaintransfer.Hooks{}` at each. The HTTP handler for `POST
/transfers/bulk` is one of them.

- [ ] **Step 5: Run the package, then both gates, then commit**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/service/transfer/... && make check && make test-integration
git add internal/service/transfer/ internal/adapter/http/transfer/
git commit -m "feat: fire order-created and confirmed hooks on the bulk lane"
```

---

## Task 4: `payout_batches` — migration, entity, repository

**Files:**
- Create: `db/migrations/000019_payout_batches.up.sql`
- Create: `db/migrations/000019_payout_batches.down.sql`
- Create: `internal/domain/payoutbatch/entity.go`
- Create: `internal/domain/payoutbatch/errors.go`
- Create: `internal/domain/payoutbatch/repository.go`
- Create: `internal/adapter/repository/payoutbatch/repository.go`
- Test: `internal/adapter/repository/payoutbatch/repository_test.go`
- Test: `internal/adapter/repository/payoutbatch/integration_test.go`

**Interfaces:**
- Produces, in `internal/domain/payoutbatch`:

```go
const (
	StatusPending      = "PENDING"
	StatusSending      = "SENDING"
	StatusSent         = "SENT"
	StatusSettled      = "SETTLED"
	StatusNeedsReview  = "NEEDS_REVIEW"
	StatusFailed       = "FAILED"
)

type Batch struct {
	ID              uuid.UUID
	BankAccountID   uuid.UUID
	Status          string
	ItemCount       int
	TotalAmount     decimal.Decimal
	TotalFee        *decimal.Decimal
	BankBulkOrderID string
	PackageRefNo    string
	FailureReason   string
	CreatedAt       time.Time
	SentAt          *time.Time
	ConfirmedAt     *time.Time
	SettledAt       *time.Time
}

type Repository interface {
	Insert(ctx context.Context, tx *sqlx.Tx, b *Batch) (*Batch, error)
	ClaimForSending(ctx context.Context, bankAccountID uuid.UUID, now time.Time) (*Batch, error)
	RecordBankOrder(ctx context.Context, id uuid.UUID, orderID string) error
	RecordConfirmed(ctx context.Context, id uuid.UUID, at time.Time) error
	RecordSent(ctx context.Context, id uuid.UUID, packageRefNo string, totalFee decimal.Decimal) error
	MarkTerminal(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, status, failureReason string, at time.Time) error
	ListUnsettled(ctx context.Context, bankAccountID uuid.UUID) ([]*Batch, error)
	RecoverStuck(ctx context.Context, bankAccountID uuid.UUID, before time.Time) (int64, error)
}
```

**Why:** a batch is the unit the sender claims, so it needs a row to lock. The
whole of P4a and P4b rests on "one row, one guarded update" to stop two
workers taking the same work; a batch modelled as "whatever rows share a
`batch_id`" has nothing to lock and no place to record that the batch is
stuck.

- [ ] **Step 1: Write the migration**

`db/migrations/000019_payout_batches.up.sql`:

```sql
-- A batch is one KTB bulk order carrying many payouts. It exists as its own
-- row because it is the unit a sender claims: "one row, one guarded update"
-- is what stops two senders paying the same recipients, and a batch modelled
-- as a group of payout rows has nothing to lock.
CREATE TABLE payout_batches (
    id                 UUID PRIMARY KEY DEFAULT uuidv7(),
    bank_account_id    UUID NOT NULL REFERENCES bank_accounts(id),
    status             TEXT NOT NULL,
    item_count         INTEGER NOT NULL,
    total_amount       NUMERIC(20,2) NOT NULL,

    -- Null until the bank quotes it. The fee is read from the bank's own
    -- record at settlement, never computed here.
    total_fee          NUMERIC(20,2),

    -- Null for exactly as long as no order exists at the bank, and that null
    -- is the ONLY thing that authorises re-sending this batch.
    bank_bulk_order_id TEXT,
    package_ref_no     TEXT,
    failure_reason     TEXT,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at            TIMESTAMPTZ,
    confirmed_at       TIMESTAMPTZ,
    settled_at         TIMESTAMPTZ,

    CONSTRAINT payout_batches_status CHECK (status IN (
        'PENDING', 'SENDING', 'SENT', 'SETTLED', 'NEEDS_REVIEW', 'FAILED')),
    CONSTRAINT payout_batches_item_count CHECK (item_count > 0),
    CONSTRAINT payout_batches_total_amount CHECK (total_amount > 0),
    CONSTRAINT payout_batches_total_fee CHECK (total_fee IS NULL OR total_fee >= 0),

    -- FAILED means the bank refused before any order existed. Once an order
    -- exists only the bank can say what happened, so the reconciler owns the
    -- row and FAILED is unreachable.
    CONSTRAINT payout_batches_failed_has_no_order
        CHECK (status <> 'FAILED' OR bank_bulk_order_id IS NULL)
);

-- The claim query orders by created_at within one source account.
CREATE INDEX payout_batches_claimable
    ON payout_batches (bank_account_id, created_at)
    WHERE status = 'PENDING';

-- The reconciler and the recoverer both sweep unfinished batches.
CREATE INDEX payout_batches_unsettled
    ON payout_batches (bank_account_id, status)
    WHERE status IN ('SENDING', 'SENT');

ALTER TABLE payouts
    ADD COLUMN batch_id     UUID REFERENCES payout_batches(id),
    ADD COLUMN bank_item_id TEXT,
    -- The bank's own itemTransactionFee for this payout. Copied from the
    -- bank's record at settlement, never computed.
    ADD COLUMN bank_fee     NUMERIC(20,2);

CREATE INDEX payouts_batch ON payouts (batch_id) WHERE batch_id IS NOT NULL;
```

`db/migrations/000019_payout_batches.down.sql`:

```sql
DROP INDEX IF EXISTS payouts_batch;

ALTER TABLE payouts
    DROP COLUMN IF EXISTS batch_id,
    DROP COLUMN IF EXISTS bank_item_id,
    DROP COLUMN IF EXISTS bank_fee;

DROP TABLE IF EXISTS payout_batches;
```

- [ ] **Step 2: Write the domain entity and errors**

`entity.go` carries the constants and the `Batch` struct from the Interfaces
block above, each status with a doc comment saying what it means. `errors.go`
carries `ErrNotFound` and `ErrInvalidStatus`, following
`internal/domain/payout/errors.go`.

- [ ] **Step 3: Write the failing repository test for the claim**

```go
// Two senders must never take the same batch. The guard is the second
// `status = 'PENDING'` in the UPDATE: the subquery's FOR UPDATE SKIP LOCKED
// picks a row, and the outer predicate re-checks it under the lock.
func TestRepository_ClaimForSending_TakesOneBatchAndOnlyOne(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "payouts", "payout_batches")
	// ... insert two PENDING batches for the same account ...

	first, err := repo.ClaimForSending(ctx, accountID, time.Now())
	require.NoError(t, err)
	second, err := repo.ClaimForSending(ctx, accountID, time.Now())
	require.NoError(t, err)

	assert.NotEqual(t, first.ID, second.ID, "a claim must not return the same batch twice")
	assert.Equal(t, payoutbatch.StatusSending, first.Status)

	_, err = repo.ClaimForSending(ctx, accountID, time.Now())
	require.ErrorIs(t, err, payoutbatch.ErrNotFound, "nothing left to claim")
}

// A batch that already has an order at the bank must never be claimed again:
// re-sending it pays every recipient in it twice.
func TestRepository_ClaimForSending_IgnoresBatchesThatAlreadyReachedTheBank(t *testing.T) {
	// ... insert a SENDING batch with bank_bulk_order_id set ...

	_, err := repo.ClaimForSending(ctx, accountID, time.Now())
	require.ErrorIs(t, err, payoutbatch.ErrNotFound)
}
```

- [ ] **Step 4: Run them and watch them fail**

- [ ] **Step 5: Write the repository**

Follow `internal/adapter/repository/payout/repository.go` exactly: a
`batchColumns` const listing every column in struct order, `r.WithTimeout`,
`r.IsNoRowsError`, `errs.WrapDatabaseError`, and `base.CheckRowsAffectedWith`
for the guarded updates. `ClaimForSending` is one statement:

```go
	const q = `
		UPDATE payout_batches SET
			status = 'SENDING',
			sent_at = $2
		WHERE id = (
			SELECT id FROM payout_batches
			WHERE status = 'PENDING'
			  AND bank_account_id = $1
			ORDER BY created_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1)
		  AND status = 'PENDING'
		RETURNING ` + batchColumns
```

`RecoverStuck` returns batches to `PENDING` **only** when
`bank_bulk_order_id IS NULL`:

```go
	const q = `
		UPDATE payout_batches SET status = 'PENDING', sent_at = NULL
		WHERE bank_account_id = $1
		  AND status = 'SENDING'
		  AND sent_at < $2
		  AND bank_bulk_order_id IS NULL`
```

- [ ] **Step 6: Run the tests, then both gates, then commit**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/adapter/repository/payoutbatch/... && make check && make test-integration
git add db/migrations/000019_payout_batches.up.sql \
        db/migrations/000019_payout_batches.down.sql \
        internal/domain/payoutbatch/ internal/adapter/repository/payoutbatch/
git commit -m "feat: add payout_batches and its repository"
```

---

## Task 5: Batch-aware payout repository methods

**Files:**
- Modify: `internal/domain/payout/entity.go` (three fields)
- Modify: `internal/domain/payout/repository.go` (four methods)
- Modify: `internal/adapter/repository/payout/repository.go` (`payoutColumns`
  and the queries)
- Test: `internal/adapter/repository/payout/integration_test.go`

**Interfaces:**
- Consumes: `payoutbatch.Batch` from Task 4.
- Produces, added to `payout.Repository`:

```go
	// ListBatchCandidates returns PENDING payouts for one source account,
	// oldest first, up to limit. It claims nothing.
	ListBatchCandidates(ctx context.Context, bankAccountID uuid.UUID, now time.Time, limit int) ([]*Payout, error)

	// AssignToBatch moves the named payouts into a batch. It is guarded on
	// status = 'PENDING' and returns how many rows it actually moved, so a
	// caller can roll back rather than send a subset.
	AssignToBatch(ctx context.Context, tx *sqlx.Tx, batchID uuid.UUID, ids []uuid.UUID) (int64, error)

	// RecordBankItem stores the bank's per-item id for one payout.
	RecordBankItem(ctx context.Context, id uuid.UUID, bankItemID string) error

	// ListByBatch returns every payout in a batch.
	ListByBatch(ctx context.Context, batchID uuid.UUID) ([]*Payout, error)
```

  and on `payout.Payout`: `BatchID *uuid.UUID`, `BankItemID string`,
  `BankFee *decimal.Decimal`.

**Why:** the batcher must move a set of payouts into a batch atomically and
know whether it got all of them. A partial claim means another batcher took
some, and a batch that quietly sends a subset is worse than one that does not
run — the missing payouts would sit `PENDING` while their batch reported a
count that never matched.

- [ ] **Step 1: Write the failing test for the guarded assignment**

```go
// A batcher that gets only some of the payouts it asked for must be able to
// tell. Sending a subset under a batch whose item_count says otherwise makes
// the batch's own record wrong.
func TestRepository_AssignToBatch_ReportsHowManyItActuallyMoved(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "payouts", "payout_batches")
	// ... insert three payouts: two PENDING, one already PROCESSING ...

	moved, err := repo.AssignToBatch(ctx, tx, batchID, []uuid.UUID{p1, p2, p3})
	require.NoError(t, err)

	assert.EqualValues(t, 2, moved,
		"the PROCESSING payout was claimed by someone else and must not move")
}

func TestRepository_AssignToBatch_SetsBatchAndStatusTogether(t *testing.T) {
	// ... assign one PENDING payout ...

	got, err := repo.GetByReference(ctx, merchantID, reference)
	require.NoError(t, err)
	assert.Equal(t, payout.StatusProcessing, got.Status)
	require.NotNil(t, got.BatchID)
	assert.Equal(t, batchID, *got.BatchID)
}
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Add the columns to the entity and `payoutColumns`**

**`payoutColumns` is a positional list and the model struct must match it.**
Adding a column without adding it here produces a scan that silently reads the
wrong field into the wrong column. Add `batch_id`, `bank_item_id`, `bank_fee`
to both, in the same order.

- [ ] **Step 4: Write the queries**

```go
	const assignQ = `
		UPDATE payouts SET
			batch_id = $1,
			status = 'PROCESSING',
			updated_at = NOW()
		WHERE id = ANY($2)
		  AND status = 'PENDING'`
```

Return `RowsAffected` rather than checking it — the caller decides what a
partial match means.

- [ ] **Step 5: Run the tests, then both gates, then commit**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/adapter/repository/payout/... && make check && make test-integration
git add internal/domain/payout/ internal/adapter/repository/payout/
git commit -m "feat: batch-aware payout repository methods"
```

---

## Task 6: The batcher

**Files:**
- Create: `internal/service/payout/batcher.go`
- Modify: `internal/shared/config.go` (`BatchWindow`, `BatchMaxItems`,
  `InterbankFeeEstimate` -- this task is the first to reference them, so it
  adds them; Task 10 adds the remaining keys and the example file)
- Test: `internal/service/payout/batcher_test.go`
- Test: `internal/service/payout/batcher_integration_test.go`

**Interfaces:**
- Consumes: `payout.Repository` (Task 5), `payoutbatch.Repository` (Task 4),
  `bankaccount.Service`, the KTB account port for `CheckName` and the balance
  read, and `tx` for the atomic open.
- Produces:

```go
func NewBatcher(...) *Batcher
func (b *Batcher) Tick(ctx context.Context) error
```

**Why:** this is where a bad recipient is caught. Resolving every payee before
the order opens is what stops one closed account from killing a batch of
twenty — and because `runBulk` opens its order before it resolves anything, a
recipient that fails inside the bulk flow strands the order too.

- [ ] **Step 1: Write the failing tests**

```go
// The window fires on age, the cap fires on count, and neither fires alone
// when the other is unmet.
func TestBatcher_OpensNothingBeforeEitherTriggerIsMet(t *testing.T) {
	// ... two payouts, both younger than the window, cap of 10 ...
	require.NoError(t, b.Tick(ctx))
	assert.Zero(t, h.batches.inserted, "neither the window nor the cap has been reached")
}

func TestBatcher_TheCapOpensABatchBeforeTheWindowElapses(t *testing.T) {
	// ... cap of 2, two fresh payouts ...
	require.NoError(t, b.Tick(ctx))
	assert.Equal(t, 1, h.batches.inserted)
}

func TestBatcher_TheWindowOpensABatchBelowTheCap(t *testing.T) {
	// ... cap of 10, one payout older than the window ...
	require.NoError(t, b.Tick(ctx))
	assert.Equal(t, 1, h.batches.inserted)
}

// The bank saying an account does not exist is a fact about that payout.
func TestBatcher_APayeeTheBankCannotFindFailsThatPayoutAlone(t *testing.T) {
	// ... three payouts, the second one's CheckName returns "not found" ...
	require.NoError(t, b.Tick(ctx))

	assert.Equal(t, payout.StatusFailed, h.payouts.statusOf(p2))
	assert.Equal(t, 2, h.batches.lastItemCount, "the other two proceed")
}

// Not being able to reach the bank is a fact about us, not about the payout.
func TestBatcher_ACheckNameOutageFailsNoPayout(t *testing.T) {
	// ... CheckName returns a transport error for every payout ...
	require.Error(t, b.Tick(ctx))

	assert.Equal(t, payout.StatusPending, h.payouts.statusOf(p1),
		"a payout is never failed because we could not reach the bank")
	assert.Zero(t, h.batches.inserted)
}

// A batch opened without knowing the balance is a batch the bank may refuse
// in full.
func TestBatcher_ABalanceReadFailureSkipsTheTickEntirely(t *testing.T) {
	// ... overview returns an error ...
	require.Error(t, b.Tick(ctx))
	assert.Zero(t, h.batches.inserted)
}

// FIFO, take-while-it-fits: a large payout at the head must not block the
// small ones behind it forever.
func TestBatcher_SendsWhatFitsAndLeavesTheRestInQueueOrder(t *testing.T) {
	// ... balance 1_000; payouts of 400, 400, 400 to the same bank (fee 0) ...
	require.NoError(t, b.Tick(ctx))

	assert.Equal(t, 2, h.batches.lastItemCount,
		"two fit; the third waits rather than blocking the queue")
}

func TestBatcher_TheEstimatedFeeCountsAgainstTheBalance(t *testing.T) {
	// ... balance 10; one interbank payout of 6, estimated fee 5 ...
	require.NoError(t, b.Tick(ctx))

	assert.Zero(t, h.batches.inserted,
		"6 + 5 exceeds 10: a batch the bank would refuse must not be opened")
}

// A partial claim means another batcher took some. Sending a subset under a
// batch whose item_count disagrees is worse than not running.
func TestBatcher_APartialClaimRollsBackTheWholeBatch(t *testing.T) {
	// ... AssignToBatch returns fewer rows than requested ...
	require.Error(t, b.Tick(ctx))
	assert.Zero(t, h.batches.committed)
}
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Write the batcher**

Order of operations, exactly as spec §6.1: list candidates → check the
trigger → resolve names → read the balance from **overview** → walk in queue
order accumulating `amount + estimatedFee` → open the batch in one
transaction with the guarded assignment.

The estimated fee is the batcher's alone:

```go
// estimateFee is what the batcher uses to decide what fits, and nothing else.
// It is never written to a payout row and never posted -- accounting uses the
// bank's own charge, read at settlement.
//
// It rounds UP rather than down on purpose. Estimating high costs a batch one
// item smaller than it could have been; estimating low means the bank refuses
// the whole batch for insufficient funds and nothing moves at all.
func (b *Batcher) estimateFee(sourceBankCode, recipientBankCode string) decimal.Decimal {
	if sourceBankCode == recipientBankCode {
		return decimal.Zero
	}

	return b.cfg.InterbankFeeEstimate
}
```

When the walk leaves payouts behind, log it at warn with the count and the
shortfall. An under-funded source account is an operational incident, and a
queue that quietly stops draining is how it goes unnoticed.

- [ ] **Step 4: Run the tests**

- [ ] **Step 5: Write the integration test for the race**

Two batchers ticking against the same PENDING rows in a real database. Exactly
one batch is created, and no payout ends up in two batches.

- [ ] **Step 6: Both gates, then commit**

---

## Task 7: The batch sender

**Files:**
- Create: `internal/service/payout/batchsender.go`
- Test: `internal/service/payout/batchsender_test.go`
- Test: `internal/service/payout/batchsender_integration_test.go`

**Interfaces:**
- Consumes: `payoutbatch.Repository` (Task 4), `payout.Repository` (Task 5),
  `transfer.Service.Bulk` with hooks (Task 3).
- Produces:

```go
func NewBatchSender(...) *BatchSender
func (s *BatchSender) SendOne(ctx context.Context) error
```

**Why:** this is the only place in the phase that can move money, so it is the
only place where "record before you commit" matters.

- [ ] **Step 1: Write the failing tests**

```go
// The bank's order id must be durable before anything commits. If it is not,
// a crash leaves a batch of payments nobody can attribute to an order.
func TestBatchSender_RecordsTheBankOrderIdBeforeCommitting(t *testing.T) {
	// ... harness records the order in which repo writes and rail calls happen ...
	require.NoError(t, s.SendOne(ctx))

	assert.Less(t, h.orderRecordedAt, h.committedAt,
		"the order id is written before the call that can move money")
}

// If the order id cannot be stored, the batch must not be committed.
func TestBatchSender_ARecordFailureStopsBeforeTheMoneyMoves(t *testing.T) {
	h.batches.recordOrderErr = errors.New("database down")

	require.Error(t, s.SendOne(ctx))
	assert.False(t, h.rail.committed, "an unrecorded order must never be committed")
}

func TestBatchSender_RecordsThePackageRefAndEveryItemId(t *testing.T) {
	require.NoError(t, s.SendOne(ctx))

	assert.Equal(t, "20260830029000018461", h.batches.packageRefNo)
	assert.Len(t, h.payouts.itemIDs, 3, "every payout carries the bank's id for it")
}

// The fee is the bank's word, read at settlement. Recording it here would
// record what we asked for rather than what we were charged.
func TestBatchSender_RecordsNoPerItemFee(t *testing.T) {
	require.NoError(t, s.SendOne(ctx))

	assert.Empty(t, h.payouts.fees,
		"the fee is read from the bank's record at settlement, not written here")
}

func TestBatchSender_NothingToClaimIsNotAnError(t *testing.T) {
	h.batches.claimErr = payoutbatch.ErrNotFound

	require.NoError(t, s.SendOne(ctx), "an idle tick is not a failure")
}
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Write the sender**

Claim → build recipients from `ListByBatch` → call `Bulk` with hooks that
write `bank_bulk_order_id` and `confirmed_at` → record `package_ref_no` and
each `bank_item_id` → batch to `SENT`.

- [ ] **Step 4: Run the tests, add the integration test, both gates, commit**

The integration test claims one batch with two senders running and asserts
only one of them sends.

---

## Task 8: The reconciler

**Files:**
- Create: `internal/service/payout/reconciler.go`
- Test: `internal/service/payout/reconciler_test.go`
- Test: `internal/service/payout/reconciler_integration_test.go`

**Interfaces:**
- Consumes: `payoutbatch.Repository`, `payout.Repository`, the KTB port's
  bulk item **detail** call, `ledgersvc.Service` with `PayoutInput.BankFee`
  from Task 2.
- Produces:

```go
func NewReconciler(...) *Reconciler
func (r *Reconciler) Tick(ctx context.Context) error

// itemOutcomes maps the bank's per-item status code to what it means.
// It starts with one entry because exactly one has ever been observed.
var itemOutcomes = map[string]string{
	"SUCCESSFUL": payout.StatusCompleted,
}
```

**Why:** this is where a merchant's reservation is released or converted, so
every wrong answer here is either money taken for a payment that never
happened or money paid twice.

- [ ] **Step 1: Write the failing tests**

```go
func TestReconciler_ASuccessfulItemSettlesThatPayout(t *testing.T) {
	h.rail.itemStatus = map[string]string{item1: "SUCCESSFUL"}
	h.rail.itemFee = map[string]decimal.Decimal{item1: decimal.RequireFromString("5.00")}

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusCompleted, h.payouts.statusOf(p1))
	assert.True(t, h.ledger.lastCompleted.BankFee.Equal(decimal.RequireFromString("5.00")),
		"the fee posted is the one the bank charged, read from its own record")
}

// No failing item has ever been observed, so no code is known to mean
// failure. An unrecognised code must never settle and never release.
func TestReconciler_AnUnknownStatusNeedsReviewAndTouchesNoMoney(t *testing.T) {
	h.rail.itemStatus = map[string]string{item1: "RETURNED"}

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusNeedsReview, h.payouts.statusOf(p1))
	assert.Zero(t, h.ledger.completedCalls, "nothing may be settled on a status nobody has seen")
	assert.Zero(t, h.ledger.failedCalls, "and nothing may be released either")
}

// One item's fate must not hold up its siblings.
func TestReconciler_SettlesEachItemIndependently(t *testing.T) {
	h.rail.itemStatus = map[string]string{
		item1: "SUCCESSFUL", item2: "RETURNED", item3: "SUCCESSFUL",
	}

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusCompleted, h.payouts.statusOf(p1))
	assert.Equal(t, payout.StatusNeedsReview, h.payouts.statusOf(p2))
	assert.Equal(t, payout.StatusCompleted, h.payouts.statusOf(p3))
	assert.Equal(t, payoutbatch.StatusNeedsReview, h.batches.statusOf(batchID),
		"a batch with an unresolved item is not settled")
}

func TestReconciler_ABatchWhoseItemsAllSucceededIsSettled(t *testing.T) {
	// ... every item SUCCESSFUL ...
	assert.Equal(t, payoutbatch.StatusSettled, h.batches.statusOf(batchID))
}

// A read failure is not evidence of anything.
func TestReconciler_AnItemReadFailureSettlesNothing(t *testing.T) {
	h.rail.itemErr = errors.New("connection reset")

	require.Error(t, r.Tick(ctx))
	assert.Equal(t, payout.StatusProcessing, h.payouts.statusOf(p1))
}
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Write the reconciler**

For each unsettled batch, for each payout in it, read the **detail** endpoint
and map the code:

```go
// The bank returns bulkItemStatus as a CODE on the item detail endpoint and
// as a Thai display label on the list endpoint -- the same field name, two
// different value spaces. Settlement reads detail and only detail: comparing
// the list's label to a code matches nothing, forever, silently, leaving
// every payout in PROCESSING with no error anywhere.
//
// itemOutcomes holds only codes that have actually been observed. No failing
// item has ever been seen, so nothing maps to FAILED yet, and an unrecognised
// code goes to NEEDS_REVIEW rather than being guessed at. The first real
// failure will need a human, who reads transactionErrorDescription beside it
// and adds one entry here -- exactly how commitRefusalCodes grew when the
// interbank route appeared.
```

- [ ] **Step 4: Run the tests**

- [ ] **Step 5: Mutation-test the outcome map**

Mutations that must all be killed, sanity mutant first:

| Mutation | Killed by |
|---|---|
| unknown status maps to `COMPLETED` | the unknown-status test |
| unknown status maps to `FAILED` | the same test's release assertion |
| the batch settles even with an unresolved item | the independent-settlement test |
| `BankFee` passed as zero regardless of the bank's figure | the successful-item test |

- [ ] **Step 6: Integration test, both gates, commit**

The integration test drives a real database and asserts the ledger entry for a
settled batch balances and that `HOUSE_EXPENSE` carries the fee.

---

## Task 9: The bank-silent evidence path

**Files:**
- Modify: `internal/service/payout/reconciler.go`
- Test: `internal/service/payout/reconciler_test.go`
- Test: `internal/service/payout/reconciler_integration_test.go`

**Interfaces:**
- Consumes: the reconciler from Task 8, and `statement.Service`'s existing
  read of matched and unmatched rows.
- Produces: no new exported symbol — a branch inside `Reconciler.Tick` for
  the case where the bank does not know the order.

**Why:** Task 8 handles every case where the bank answers. This handles the
case where it does not, and it is the case where a wrong answer costs the
most. Spec §9's table is the rule, and its last three rows all say the same
thing: **not seeing a debit is not the same as the debit not happening.**
Releasing a merchant's reservation because the statement poller was down pays
that money twice.

- [ ] **Step 1: Write the failing tests**

```go
// One matching debit is positive evidence: the money left, so the payout
// completed even though the bank will not say so.
func TestReconciler_OneMatchingDebitSettlesAPayoutTheBankIsSilentAbout(t *testing.T) {
	h.rail.itemErr = railErrOrderNotFound
	h.statements.debits = []statement.Row{debitOf("100.00", withinWindow)}

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusCompleted, h.payouts.statusOf(p1))
}

// Two debits that both match cannot be told apart, and picking one guesses at
// which payment this payout was.
func TestReconciler_SeveralMatchingDebitsNeedReview(t *testing.T) {
	h.rail.itemErr = railErrOrderNotFound
	h.statements.debits = []statement.Row{
		debitOf("100.00", withinWindow), debitOf("100.00", withinWindow),
	}

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusNeedsReview, h.payouts.statusOf(p1))
	assert.Zero(t, h.ledger.completedCalls)
}

// THE most important test in this task. Absence of a debit is not evidence
// the transfer did not happen -- the poller may simply have been down.
func TestReconciler_NoMatchingDebitNeverFailsAPayout(t *testing.T) {
	h.rail.itemErr = railErrOrderNotFound
	h.statements.debits = nil

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusNeedsReview, h.payouts.statusOf(p1),
		"not seeing the debit is not the same as the debit not happening")
	assert.Zero(t, h.ledger.failedCalls,
		"releasing a reservation on absent evidence pays the money twice")
}

// A gap in the statement over the payout's window means the poller missed
// time, so "no matching debit" is not a statement about the bank at all.
func TestReconciler_AStatementGapOverTheWindowNeedsReview(t *testing.T) {
	h.rail.itemErr = railErrOrderNotFound
	h.statements.gapOverWindow = true
	h.statements.debits = nil

	require.NoError(t, r.Tick(ctx))

	assert.Equal(t, payout.StatusNeedsReview, h.payouts.statusOf(p1))
}
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement the branch**

```go
// The bank not knowing the order is not the same as the transfer not
// happening. Spec section 9's table is the whole rule, and the direction it
// leans in is deliberate: every uncertain case goes to NEEDS_REVIEW, and
// nothing auto-fails. A payout stuck waiting for a human is recoverable; a
// reservation released for money that did leave is not.
//
// A statement gap over the payout's window disqualifies the evidence
// entirely -- "no debit found" from a poller that was down says nothing.
```

- [ ] **Step 4: Mutation-test the direction**

The mutation that matters: **no-matching-debit maps to `FAILED` instead of
`NEEDS_REVIEW`.** It must be killed. That single flipped branch is the double
payment this whole design refuses, and it must not be possible for the suite
to pass with it in place. Sanity mutant first.

- [ ] **Step 5: Both gates, then commit**

**If `statement.polling_enabled` has never been on in this environment**, the
statement table is empty and every one of these paths reaches NEEDS_REVIEW by
the "no debit found" route. That is correct behaviour, not a broken test —
but say so in the commit message, because a reviewer seeing every payout land
in NEEDS_REVIEW will otherwise read it as a defect.

---

## Task 10: Wiring, configuration, and the recoverer

**Files:**
- Modify: `internal/shared/config.go`
- Modify: `config.yaml.example`
- Modify: `internal/service/module.go`
- Create: `internal/service/payout/batchproducer.go`
- Create: `internal/service/payout/batchrecoverer.go`
- Test: `internal/service/payout/batchproducer_test.go`
- Test: `internal/service/payout/batchrecoverer_test.go`
- Test: `internal/adapter/http/routes_test.go` (the fx smoke test)

**Interfaces:**
- Consumes: `Batcher`, `BatchSender`, `Reconciler`.
- Produces: the tickers, and `payout.Config` gaining
  `BatchWindow`, `BatchMaxItems`, `BatchInterval`, `ReconcileInterval`,
  `StuckBatchAfter`, `InterbankFeeEstimate`.

**Why:** P4b's producer was wired into the wrong fx module during review and
would have stopped after the database pool closed. `OnStop` runs in **reverse**
registration order; a ticker that outlives its pool logs errors on the way
down.

- [ ] **Step 1: Write the failing config test**

```go
// Every one of these defaults to a value that sends nothing. A batcher that
// runs by default would open batches against a source account nobody chose.
func TestConfig_BatchDefaultsSendNothing(t *testing.T) {
	cfg := loadExampleConfig(t)

	assert.False(t, cfg.Payout.SendEnabled)
	assert.Positive(t, cfg.Payout.BatchWindow)
	assert.Positive(t, cfg.Payout.BatchMaxItems)
}

// No bulk order with more than four recipients has ever been sent and the
// bank's own limit is unknown. The default must not be a guess at a large
// number.
func TestConfig_BatchMaxItemsStartsSmall(t *testing.T) {
	cfg := loadExampleConfig(t)

	assert.LessOrEqual(t, cfg.Payout.BatchMaxItems, 10,
		"raise this against a measured bank limit, not a guess")
}
```

- [ ] **Step 2: Add the fields with doc comments**

Each field's comment says what it does **and what happens if it is wrong**,
matching the density of the existing `Payout` config block. `BatchMaxItems`
carries the note that the bank's limit is unmeasured.

- [ ] **Step 3: Write the recoverer and its failing tests**

Spec §6.4. It is the only loop here that is **deliberately ungated** — a crash
must not need a config switch to recover from, which is why
`RecoverUnsent` is ungated too.

```go
// A batch that never reached the bank is safe to send: nothing exists there
// to duplicate.
func TestBatchRecoverer_ReturnsBatchesWithNoOrderToPending(t *testing.T) {
	// ... one SENDING batch, sent_at past the threshold, no order id ...
	require.NoError(t, rec.Tick(ctx))

	assert.Equal(t, payoutbatch.StatusPending, h.batches.statusOf(batchID))
}

// THE test in this task. A batch that reached the bank must never be sent
// again -- re-sending pays every recipient in it a second time.
func TestBatchRecoverer_NeverTouchesABatchThatReachedTheBank(t *testing.T) {
	// ... one SENDING batch, past the threshold, WITH an order id ...
	require.NoError(t, rec.Tick(ctx))

	assert.Equal(t, payoutbatch.StatusSending, h.batches.statusOf(batchID),
		"only the bank can say what happened to an order that exists; the reconciler asks it")
}

// It runs whether or not sending is enabled: recovery is not sending.
func TestBatchRecoverer_RunsWithSendDisabled(t *testing.T) {
	// ... cfg.SendEnabled = false, one recoverable batch ...
	require.NoError(t, rec.Tick(ctx))

	assert.Equal(t, payoutbatch.StatusPending, h.batches.statusOf(batchID))
}
```

The implementation is one call to `RecoverStuck` from Task 4, whose `WHERE`
already carries `bank_bulk_order_id IS NULL`. **Mutation-test that predicate**
— dropping it must be killed by the second test above.

- [ ] **Step 4: Wire the four tickers into the same fx module as the existing
      payout producer**

Read `internal/service/module.go:174-212` and follow it exactly. The tickers
must be invoked from the module that owns the database pool's lifecycle, not
from the root module: `OnStop` runs in **reverse** registration order, and a
ticker registered above the pool outlives it and logs errors all the way down.
P4b's producer was wired into the wrong module during review for exactly this
reason.

The batcher, sender and reconciler are gated on `payout.send_enabled`. The
recoverer is not.

- [ ] **Step 5: Run the fx smoke test**

```bash
go test ./internal/adapter/http/... -run Routes
```

The app must still start with every switch off.

- [ ] **Step 6: Both gates, then commit**

---

## Task 11: Remove the single-payout send path

**Files:**
- Modify: `internal/service/payout/sender.go`
- Modify: `internal/service/payout/producer.go`
- Modify: `internal/domain/payout/repository.go`
- Modify: `internal/adapter/repository/payout/repository.go`
- Modify: `internal/service/module.go`
- Test: delete the tests that only covered the removed methods

**Interfaces:**
- Removes: `Sender.SendOne`, `SendProducer`, `Repository.ClaimForSending`,
  `Repository.RecordBankOrder`, `Repository.RecordConfirmed`.
- Keeps: `Repository.RecoverUnsent` and `Sender.RecoverUnsent`.

**Why:** two sending paths against one source account is two ways to pay the
same payout. But **this is the last task on purpose**: until the batch path
has moved real money, the old path is the fallback, and deleting it earlier
removes the only working sender the service has.

- [ ] **Step 1: Confirm the batch path has been exercised end to end**

Both gates green, and Task 8's integration test settling a batch against a
real database. Do not start this task otherwise.

- [ ] **Step 2: Delete the methods and their call sites**

`RecoverUnsent` stays on both the repository and the sender. Its doc comment
says it is deliberately not gated on `send_enabled` or on the account being
ACTIVE — keep that comment, and keep the behaviour.

- [ ] **Step 3: Delete only the tests that covered removed behaviour**

A test that still describes something the batch path does keeps its subject
and moves; a test whose subject no longer exists goes.

- [ ] **Step 4: Both gates, then commit**

```bash
export PATH="$PATH:$HOME/go/bin"
make check && make test-integration
git add -A
git commit -m "refactor: remove the single-payout send path"
```

---

## Order, and what blocks what

```
Task 1 (HOUSE_EXPENSE) ──> Task 2 (ledger fee lines) ──┐
Task 3 (bulk hooks) ───────────────────────> Task 7 ───┤
Task 4 (batches table) ──> Task 5 (payout cols) ──> Task 6 ──> Task 7 ──> Task 8 ──> Task 9 ──> Task 10
```

Tasks 1–2, 3, and 4–5 are independent of each other and can be done in any
order. Task 10 is last, and only after Task 8 has settled a batch for real.

## Before `payout.send_enabled` is ever turned on

Not part of this plan, and it gates the switch:

- The terminal poll body must be captured for both a same-bank and an
  interbank recipient, and the poll allow-list re-checked against it. The
  first live body carried no `status` field at all.
- The bank's maximum recipients per bulk order must be measured, and
  `batch_max_items` raised against it rather than guessed.
- The orphaned DRAFT orders left at the bank by the diagnosis attempts should
  be discarded by an operator. Nothing in this codebase should gain the
  ability to discard bank instructions in bulk.
