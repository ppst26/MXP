# MaxPay P4b — Sending the Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the money P4a reserved, and record what the bank told us at the moment it told us — so a crash mid-send is classified rather than guessed.

**Architecture:** The existing KTB rail gains two progress hooks and a typed `Outcome`, because money moves at `ConfirmTransfer` and today's `Transfer()` only reports the order id after the whole sequence returns. A worker then claims one `PENDING` payout per tick with a guarded UPDATE, sends it through that rail, persists `bank_order_id` and `confirmed_at` from inside the hooks, and posts `PostPayoutCompleted` or `PostPayoutFailed` at the terminal states. An outcome the bank never reported is left `PROCESSING` for P4c.

**Tech Stack:** Go 1.25 · Gin · uber/fx · sqlx + Masterminds/squirrel · PostgreSQL 18 · Zap · Viper · shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-29-maxpay-p4b-payout-send-design.md`

## Global Constraints

- Go 1.25 · Gin · uber/fx · sqlx + squirrel · PostgreSQL 18 · Zap · Viper
- Money is `decimal.Decimal`, never `float64`
- Every status transition is a guarded `UPDATE` paired with `CheckRowsAffectedWith`
- `payout.send_enabled` defaults to **false**
- Never log the PIN, the API key, the secret key, or any merchant plaintext credential, at any level including error paths
- The worker sends **one payout at a time per device**, never concurrently — `session.Do` does not serialise its work; `singleflight` covers only login
- All code, identifiers, comments and docstrings in English
- **No test in this phase may call a real bank.** The rail is stubbed at the `domaintransfer.Service` boundary in every test.
- Never run anything against the `maxpay` database. Tests use `maxpay_test` via `TEST_DATABASE_URL`.
- `golangci-lint` is NOT on the default PATH. Run `export PATH="$PATH:$HOME/go/bin"` before `make check`, and read `$?` directly — piping to `head` prints success regardless.
- Integration tests truncate what they write, before they write, and are proven idempotent by running the file twice in one shell with no cleanup between runs.

## File Structure

| File | Responsibility |
|---|---|
| `internal/domain/transfer/dto.go` | `Hooks`, `Outcome`, `OutcomeKind` |
| `internal/domain/transfer/service.go` | the port's new signature |
| `internal/service/transfer/service.go` | fire the hooks; classify the outcome |
| `internal/adapter/http/transfer/handlers.go` | the one existing caller, response unchanged |
| `db/migrations/000017_payout_attempts.{up,down}.sql` | `attempts`, `next_attempt_at`, the claim index |
| `internal/domain/payout/{entity,repository}.go` | the new fields and the six new port methods |
| `internal/adapter/persistence/{model,mapper}/payout.go` | the two new columns |
| `internal/adapter/repository/payout/repository.go` | the six new queries |
| `internal/service/payout/sender.go` | gates, claim, send, classify, post — the judgment |
| `internal/service/payout/producer.go` | the fx-managed ticker loop |
| `internal/shared/config.go`, `config.yaml.example` | `send_enabled`, `send_interval`, `max_attempts` |
| `internal/service/module.go` | fx wiring |

## Task Order

Task 1 changes the rail and nothing else, so it is reviewable on its own against the one existing caller. Tasks 2–3 build the storage the worker needs. Task 4 is the judgment — the gates, the classification, and the postings. Task 5 wires it and proves the loop.

---

### Task 1: The rail reports progress

**Files:**
- Modify: `internal/domain/transfer/dto.go`
- Modify: `internal/domain/transfer/service.go`
- Modify: `internal/service/transfer/service.go`
- Modify: `internal/adapter/http/transfer/handlers.go:64-78`
- Test: `internal/service/transfer/service_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `domaintransfer.Hooks`, `domaintransfer.Outcome`, `domaintransfer.OutcomeKind` with constants `OutcomeCompleted`, `OutcomeFailed`, `OutcomeUnknown`; and `Service.Transfer(ctx, alias string, data Data, hooks Hooks) (*Outcome, error)`.

- [ ] **Step 1: Read the existing flow before changing it**

Read `internal/service/transfer/service.go`'s `runTransfer` end to end. The order is: `CheckName` → `CreateTransferOrder` → `processItem` → `VerifyTransfer` → (more recipients) → `PreConfirmTransfer` → `mfa.Authenticate` → `ConfirmTransfer` → `PollTransfer` → `TransferOrderItems`.

**Money moves at `ConfirmTransfer`.** Everything before it is preparation and moves nothing. That single fact is why this task exists — write it down where you put the hooks.

Note `pendingApprovalBody` at line 32: `{"status":"PENDING_APPROVAL"}`. It is what `finalResult` becomes when `PollTransfer` fails. That is today's only signal for "we do not know", and it is unexported.

- [ ] **Step 2: Write the failing test for the hooks**

`internal/service/transfer/service_test.go`. The package already has fakes for the KTB APIs — read them and reuse them; do not build a second set.

```go
// The hooks exist so a caller can persist what the bank said at the moment
// it said it. Their ORDER and their TIMING relative to ConfirmTransfer are
// the whole point: OnOrderCreated must fire while money still cannot have
// moved, and OnConfirmed must fire before Transfer returns, because a
// process that dies in between leaves money gone with nothing recorded.
func TestTransfer_FiresHooksAroundConfirmation(t *testing.T) {
	var events []string

	svc, fakes := newTestService(t)
	fakes.transfers.onConfirm = func() { events = append(events, "confirm") }

	hooks := domaintransfer.Hooks{
		OnOrderCreated: func(_ context.Context, orderID string) error {
			events = append(events, "order:"+orderID)
			return nil
		},
		OnConfirmed: func(context.Context) error {
			events = append(events, "confirmed")
			return nil
		},
	}

	_, err := svc.Transfer(context.Background(), testAlias, validData(), hooks)
	require.NoError(t, err)

	require.Equal(t, []string{"order:" + testOrderID, "confirm", "confirmed"}, events,
		"the order id must be reported BEFORE the bank is told to pay, and the "+
			"confirmation immediately AFTER it succeeds")
}

// A caller that cannot record the order id must not go on to confirm: that
// is precisely the state nothing can recover from, because the KTB order
// carries no reference of ours to search by afterwards.
func TestTransfer_AFailingOrderHookAbortsBeforeConfirmation(t *testing.T) {
	sentinel := errors.New("cannot persist")

	svc, fakes := newTestService(t)

	_, err := svc.Transfer(context.Background(), testAlias, validData(),
		domaintransfer.Hooks{
			OnOrderCreated: func(context.Context, string) error { return sentinel },
		})

	require.ErrorIs(t, err, sentinel)
	assert.Zero(t, fakes.transfers.confirmCalls, "the bank must never have been told to pay")
}

// A zero Hooks is the existing admin endpoint's call. It must still work.
func TestTransfer_ZeroHooksBehavesAsBefore(t *testing.T) {
	svc, _ := newTestService(t)

	out, err := svc.Transfer(context.Background(), testAlias, validData(), domaintransfer.Hooks{})
	require.NoError(t, err)
	assert.Equal(t, testOrderID, out.TransferOrderID)
	assert.Equal(t, 1, out.Recipients)
}
```

Add `onConfirm func()` and `confirmCalls int` to the existing KTB transfer fake if it does not have them.

- [ ] **Step 3: Write the failing test for the outcome classification**

```go
// Unknown is the case the caller most needs and is most likely to get
// wrong. Today it is signalled by an unexported package variable; after
// this change it is a value in the type system.
func TestTransfer_ClassifiesTheOutcome(t *testing.T) {
	t.Run("the bank answers", func(t *testing.T) {
		svc, fakes := newTestService(t)
		fakes.transfers.pollBody = json.RawMessage(`{"status":"SUCCESS"}`)

		out, err := svc.Transfer(context.Background(), testAlias, validData(), domaintransfer.Hooks{})
		require.NoError(t, err)
		assert.Equal(t, domaintransfer.OutcomeCompleted, out.Kind)
	})

	t.Run("the bank refuses", func(t *testing.T) {
		svc, fakes := newTestService(t)
		fakes.transfers.pollBody = json.RawMessage(`{"status":"FAILED","message":"invalid account"}`)

		out, err := svc.Transfer(context.Background(), testAlias, validData(), domaintransfer.Hooks{})
		require.NoError(t, err)
		assert.Equal(t, domaintransfer.OutcomeFailed, out.Kind)
		assert.Contains(t, out.Reason, "invalid account")
	})

	t.Run("polling fails, so we do not know", func(t *testing.T) {
		svc, fakes := newTestService(t)
		fakes.transfers.pollErr = errors.New("timeout")

		out, err := svc.Transfer(context.Background(), testAlias, validData(), domaintransfer.Hooks{})
		require.NoError(t, err,
			"Unknown is not an error: returning it as one would invite the caller "+
				"to retry, which is the one thing that must never happen after a confirmation")
		assert.Equal(t, domaintransfer.OutcomeUnknown, out.Kind)
		assert.Equal(t, testOrderID, out.TransferOrderID,
			"the order id is what P4c will ask the bank about, so it must survive")
	})
}
```

**The status strings above are placeholders you must replace.** Read what `PollTransfer` actually returns — check `internal/adapter/external/ktb/` for the poll response type and any recorded fixtures under `internal/service/transfer/testdata/`. If the real vocabulary is unknown, classify conservatively: **anything not recognised as a definite success or a definite failure is `Unknown`.** Guessing a success is the expensive mistake; guessing Unknown costs only a reconciliation.

- [ ] **Step 4: Run both tests and watch them fail**

```bash
go test -count=1 ./internal/service/transfer/
```
Expected: FAIL — `Transfer` takes 3 arguments, `Hooks` undefined.

- [ ] **Step 5: Add the types**

`internal/domain/transfer/dto.go`:

```go
// Hooks let a caller persist what the bank has told us at the moment it
// tells us, rather than after the whole sequence returns.
//
// This exists because of three facts about the KTB rail. The transfer order
// carries no field for a reference of ours, so an order cannot be found
// again by asking about a payout. Transfer runs the whole sequence in one
// call, so the order id is otherwise only known after it returns. And money
// moves at ConfirmTransfer. A process that dies between that call
// succeeding and Transfer returning would leave the money gone, nothing
// recorded, and no question the bank could answer -- and the next worker
// pass would send it again.
//
// Both hooks are called synchronously and inline. A hook that returns an
// error ABORTS the transfer: a caller that cannot record the order id must
// not go on to confirm it.
//
// A zero Hooks is valid and means "report nothing".
type Hooks struct {
	// OnOrderCreated fires as soon as the bank returns an order id, which is
	// before any money can move -- an order that is never confirmed
	// transfers nothing.
	OnOrderCreated func(ctx context.Context, orderID string) error

	// OnConfirmed fires immediately after ConfirmTransfer succeeds. From
	// this instant the money may be gone, and nothing may release the
	// caller's reservation without positive evidence.
	OnConfirmed func(ctx context.Context) error
}

// OutcomeKind is what the bank told us, as a value rather than a string
// comparison against an unexported variable.
type OutcomeKind string

const (
	OutcomeCompleted OutcomeKind = "COMPLETED"
	OutcomeFailed    OutcomeKind = "FAILED"

	// OutcomeUnknown means the order was submitted and the bank did not tell
	// us what happened. It is NOT an error: the call succeeded, and its
	// result is that we do not know. Returning it as an error would invite a
	// retry, which after a confirmation is how money gets paid twice.
	OutcomeUnknown OutcomeKind = "UNKNOWN"
)

// Outcome is the result of a transfer-order run.
type Outcome struct {
	Kind            OutcomeKind
	TransferOrderID string
	Recipients      int
	Reason          string          // set for OutcomeFailed
	FinalResult     json.RawMessage // preserved for the audit trail
	TransferDetails json.RawMessage
}
```

**`Recipients` is on `Outcome` because the existing admin endpoint renders it** (`internal/adapter/http/transfer/handlers.go:73`). The spec's own sketch omitted it; that was an error in the spec, not a decision.

Keep the existing `Result` type — `Bulk` still returns it.

- [ ] **Step 6: Change the port**

`internal/domain/transfer/service.go`:

```go
type Service interface {
	// Transfer runs the transfer-order flow for one or many recipients.
	//
	// hooks may be the zero value. See Hooks' own doc for why a caller that
	// needs to survive a crash mid-sequence must supply them.
	Transfer(ctx context.Context, alias string, data Data, hooks Hooks) (*Outcome, error)

	// Bulk runs the bulk-manual flow.
	Bulk(ctx context.Context, alias string, data Data) (*BulkResult, error)
}
```

- [ ] **Step 7: Fire the hooks and classify**

In `internal/service/transfer/service.go`'s `runTransfer`:

- immediately after `CreateTransferOrder` returns and `orderID` is known, call `hooks.OnOrderCreated` if non-nil and return its error unchanged
- immediately after `ConfirmTransfer` succeeds, call `hooks.OnConfirmed` if non-nil and return its error unchanged
- replace the `Result` return with an `Outcome`, classifying from the poll

Keep every existing comment in that function. They record why polling failure reports pending rather than an error, and why reading the order back is best-effort — both still true and both now feed the classification.

- [ ] **Step 8: Update the one existing caller, response unchanged**

`internal/adapter/http/transfer/handlers.go:64-78`. Pass `domaintransfer.Hooks{}` and read the fields off `Outcome`. **The JSON the admin endpoint returns must not change** — same keys, same values. Add a test asserting the response body if the package does not already have one.

- [ ] **Step 9: Run the gates**

```bash
export PATH="$PATH:$HOME/go/bin"
go test -count=1 ./internal/service/transfer/ ./internal/adapter/http/transfer/
make check    # read $? directly
```

- [ ] **Step 10: Commit**

```bash
git add internal/domain/transfer/ internal/service/transfer/ internal/adapter/http/transfer/
git commit -m "feat(transfer): report order id and confirmation as they happen"
```

---

### Task 2: `attempts` and `next_attempt_at`

**Files:**
- Create: `db/migrations/000017_payout_attempts.up.sql`
- Create: `db/migrations/000017_payout_attempts.down.sql`
- Modify: `internal/domain/payout/entity.go`
- Modify: `internal/adapter/persistence/model/payout.go`
- Modify: `internal/adapter/persistence/mapper/payout.go`
- Test: `internal/adapter/persistence/mapper/payout_test.go`
- Test: `internal/adapter/repository/payout/schema_integration_test.go`

**Interfaces:**
- Consumes: the `payouts` table from P4a (migration `000016`).
- Produces: `Payout.Attempts int` and `Payout.NextAttemptAt *time.Time`; columns `attempts`, `next_attempt_at`; index `payouts_sendable`.

- [ ] **Step 1: Write the migration**

`db/migrations/000017_payout_attempts.up.sql`:

```sql
-- attempts counts how many times the worker has CLAIMED this payout, not
-- how many times it reached the bank. The claim increments it, so a payout
-- whose send died before any bank call still spends one.
--
-- It bounds retries; it does not authorise them. The gate on retrying is
-- always bank_order_id IS NULL, NOT confirmed_at IS NULL: Transfer can fail
-- after ConfirmTransfer succeeded but before the OnConfirmed hook runs, so
-- confirmed_at IS NULL does not prove nothing moved. An order id is recorded
-- before confirmation is ever attempted, so its absence does.
ALTER TABLE payouts
    ADD COLUMN attempts        INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ADD COLUMN next_attempt_at TIMESTAMPTZ;

-- The worker's claim query. NULL means "eligible now", which is what a
-- freshly created payout carries; NULLS FIRST keeps those ahead of
-- rescheduled ones.
CREATE INDEX payouts_sendable ON payouts (next_attempt_at NULLS FIRST)
    WHERE status = 'PENDING';
```

`db/migrations/000017_payout_attempts.down.sql`:

```sql
DROP INDEX IF EXISTS payouts_sendable;
ALTER TABLE payouts
    DROP COLUMN IF EXISTS attempts,
    DROP COLUMN IF EXISTS next_attempt_at;
```

- [ ] **Step 2: Apply it to the TEST database only**

```bash
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
migrate -path db/migrations -database "$TEST_DATABASE_URL" up
```

**Do not use `make migrate-up` without an explicit `DATABASE_URL`** — it defaults at the live `maxpay` database, which holds a bank device that cannot be re-registered without another OTP.

- [ ] **Step 3: Add the fields and the mapping**

`entity.go`:

```go
	// Attempts is how many times the worker has claimed this payout. It
	// bounds retries; it does not authorise them -- confirmed_at does that.
	Attempts int

	// NextAttemptAt is when this payout becomes claimable again. Nil means
	// now, which is what a freshly created payout carries.
	NextAttemptAt *time.Time
```

`model.Payout` gets `Attempts int` and `NextAttemptAt sql.NullTime`. The mapper maps both directions — `NextAttemptAt` follows `ConfirmedAt`'s existing pointer/NullTime treatment exactly; read it and match.

**Also update `payoutColumns` in `internal/adapter/repository/payout/repository.go`.** It is the SELECT and RETURNING list every query in that file shares, and it does not update itself when a column is added. Miss it and every read silently returns a zero `Attempts` — harmless until Task 4 compares it against `MaxAttempts`, at which point retries never exhaust. Adding a column and updating that constant are one change, in two files that no single layer owns.

- [ ] **Step 4: Extend the mapper fixtures**

Both mapper tests set every field to a **distinct non-zero value**. Add `Attempts` and `NextAttemptAt` to both, with `Attempts` not equal to any other integer in the fixture and `NextAttemptAt` distinct from `ConfirmedAt`, `CreatedAt` and `UpdatedAt`.

This is not boilerplate. P4a shipped a `PayoutToModel` fixture that left five fields at zero, and a mutation that hard-wired `ConfirmedAt` to NULL — inverting the feature's central invariant — survived every test on the branch. Two fields holding the same value make a swap between them invisible.

- [ ] **Step 5: Add a schema test for the claim index**

Append to `schema_integration_test.go` a test that inserts three PENDING payouts — one with `next_attempt_at` NULL, one in the past, one in the future — and asserts a `SELECT ... WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) ORDER BY next_attempt_at NULLS FIRST` returns exactly the first two, in that order. Truncate `payouts` first.

- [ ] **Step 6: Run and commit**

```bash
export PATH="$PATH:$HOME/go/bin"
go test -count=1 ./internal/adapter/persistence/mapper/
go test -tags=integration -count=1 -v -run TestSchema ./internal/adapter/repository/payout/ 2>&1 | grep -E '^(--- |ok|FAIL)'
```
Confirm `--- PASS` by name — a missing `TEST_DATABASE_URL` skips and still prints `ok`. Then run the file twice in one shell with no cleanup between and confirm identical output.

```bash
git add db/migrations/000017_* internal/domain/payout/entity.go internal/adapter/persistence/
git commit -m "feat(payout): add attempts and next_attempt_at"
```

---

### Task 3: The repository operations the worker needs

**Files:**
- Modify: `internal/domain/payout/repository.go`
- Modify: `internal/adapter/repository/payout/repository.go`
- Test: `internal/adapter/repository/payout/repository_test.go`
- Test: `internal/adapter/repository/payout/integration_test.go`

**Interfaces:**
- Consumes: Task 2's columns.
- Produces, added to `domainpayout.Repository`:

```go
// ClaimForSending atomically takes the oldest claimable PENDING payout for
// this bank account and moves it to PROCESSING, incrementing attempts.
// Returns ErrNotFound when there is nothing to claim.
ClaimForSending(ctx context.Context, bankAccountID uuid.UUID, now time.Time) (*Payout, error)

// RecordBankOrder writes the bank's order id. Guarded on PROCESSING.
RecordBankOrder(ctx context.Context, id uuid.UUID, orderID string) error

// RecordConfirmed stamps confirmed_at. Guarded on PROCESSING AND on
// bank_order_id being present -- payouts_confirmed_needs_order enforces the
// same rule, and this makes the code state it too.
RecordConfirmed(ctx context.Context, id uuid.UUID, at time.Time) error

// Reschedule returns a payout to PENDING for a later attempt. Guarded on
// PROCESSING AND bank_order_id IS NULL -- see the note under Step 2 for why
// that predicate and not confirmed_at.
Reschedule(ctx context.Context, id uuid.UUID, nextAt time.Time) error

// MarkTerminal moves a payout to COMPLETED, FAILED or REJECTED inside tx,
// alongside the ledger posting that releases or settles its reservation.
// Guarded on PROCESSING. `at` binds to updated_at rather than NOW() so the
// row and its ledger entry carry the same instant.
MarkTerminal(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, status, failureReason string, at time.Time) error

// RecoverUnsent moves PROCESSING payouts that never reached a confirmation
// back to PENDING, and returns how many. Guarded on bank_order_id IS NULL.
// See Task 4 Step 3 for why the predicate is exactly that and no wider.
RecoverUnsent(ctx context.Context, bankAccountID uuid.UUID) (int64, error)
```

- [ ] **Step 1: Write the claim, guarded**

The claim is one statement, not a select-then-update:

```go
func (r *Repository) ClaimForSending(
	ctx context.Context, bankAccountID uuid.UUID, now time.Time,
) (*domainpayout.Payout, error) {
	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	// One statement, and SKIP LOCKED, so two workers cannot take the same
	// row and neither blocks behind the other. The subquery picks the row;
	// the outer UPDATE's own status predicate is what makes the claim safe
	// even if the subquery's snapshot went stale.
	const q = `
		UPDATE payouts SET
			status = 'PROCESSING',
			attempts = attempts + 1,
			updated_at = NOW()
		WHERE id = (
			SELECT id FROM payouts
			WHERE status = 'PENDING'
			  AND bank_account_id = $1
			  AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
			ORDER BY next_attempt_at NULLS FIRST, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1)
		  AND status = 'PENDING'
		RETURNING ` + payoutColumns

	var m model.Payout
	if err := r.DB.QueryRowxContext(ctx, q, bankAccountID, now).StructScan(&m); err != nil {
		if r.IsNoRowsError(err) {
			return nil, domainpayout.ErrNotFound
		}

		return nil, errs.WrapDatabaseError(err, "claim payout for sending")
	}

	return mapper.PayoutToDomain(&m), nil
}
```

- [ ] **Step 2: Write the four guarded updates**

Each follows P4a's `SetReservedFee` shape — squirrel `Update`, an `Eq` on id **and** the guarded columns, `CheckRowsAffectedWith(result, domainpayout.ErrNotFound)`.

`Reschedule`'s WHERE is `id = $1 AND status = 'PROCESSING' AND bank_order_id IS NULL`.

**The retry gate is `bank_order_id IS NULL`, not `confirmed_at IS NULL`, and the difference matters.** `Transfer` returns an error when its `OnConfirmed` hook fails — for a run in which the money *already moved*. In that state `confirmed_at` was never written, so a gate on `confirmed_at` would happily retry a payout the bank has already paid. An order id, by contrast, is recorded *before* confirmation is ever attempted, so "no order id" is the only predicate that provably means nothing moved.

This is the same predicate `RecoverUnsent` uses. One rule, stated once, in two places that both need it.

`RecordConfirmed`'s WHERE is `id = $1 AND status = 'PROCESSING' AND bank_order_id IS NOT NULL`.

- [ ] **Step 3: Pin the SQL with sqlmock**

`repository_test.go`. For each of the six, assert the exact generated SQL and the bound arguments, following P4a's existing pins in this file.

**Pin the full column list of the claim's `RETURNING`,** and pin `Reschedule`'s and `RecordConfirmed`'s WHERE clauses in full. P4a's review found that reordering an INSERT's `Columns()` survived every test because nothing named the column list; the same gap here would hide a claim that returns the wrong row shape.

- [ ] **Step 4: Prove the guards against a real database**

`integration_test.go`. Truncate `payouts` first in every test.

Required cases:

```go
// The claim is what stops two workers sending one payout twice. sqlmock
// cannot fail this test -- it returns whatever it is told.
func TestClaimForSending_Integration_TwoClaimsCannotTakeOneRow(t *testing.T)

// A confirmed payout is never retried, whatever its attempt count. The
// guard lives in SQL so a caller that forgets it still cannot.
func TestReschedule_Integration_RefusesAConfirmedPayout(t *testing.T)

// payouts_confirmed_needs_order forbids a confirmation without an order id.
// RecordConfirmed must refuse it before the database does, so the caller
// gets ErrNotFound rather than a constraint violation surfacing as a 500.
func TestRecordConfirmed_Integration_RefusesWithoutAnOrderID(t *testing.T)

// Claim order: NULL next_attempt_at first, then oldest scheduled.
func TestClaimForSending_Integration_TakesTheOldestEligibleRow(t *testing.T)

// Another account's payout is not this account's to claim.
func TestClaimForSending_Integration_IsScopedToItsBankAccount(t *testing.T)
```

Write each body in full. For the concurrency one, open two transactions against the real database and assert exactly one gets a row.

- [ ] **Step 5: Run and commit**

```bash
export PATH="$PATH:$HOME/go/bin"
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
go test -count=1 ./internal/adapter/repository/payout/
go test -tags=integration -race -count=1 -v ./internal/adapter/repository/payout/ 2>&1 | grep -E '^(--- |ok|FAIL)'
make check    # read $? directly
```
Run the integration file twice in one shell, no cleanup between, and confirm identical `--- PASS` lines.

```bash
git add internal/domain/payout/repository.go internal/adapter/repository/payout/
git commit -m "feat(payout): add the claim and the send-progress writes"
```

---

### Task 4: The sender

This is the task the phase exists for. Everything about which payout gets sent, what happens when it does not, and what is posted afterwards lives here.

**Files:**
- Create: `internal/service/payout/sender.go`
- Test: `internal/service/payout/sender_test.go`
- Test: `internal/service/payout/sender_integration_test.go`

**Interfaces:**
- Consumes: Task 1's `domaintransfer.Service` and `Hooks`/`Outcome`; Task 3's five repository methods; `ledgersvc.PostPayoutCompleted` / `PostPayoutFailed`, both `(ctx, tx, PayoutInput) (*domainledger.Entry, error)` and both refusing a nil `ReservedFee`.
- Produces:

```go
func NewSender(
    repo domainpayout.Repository,
    accounts domainbank.Service,
    devices device.Repository,   // resolves an account's DeviceID to the rail's alias
    rail domaintransfer.Service,
    ledger ledgerPoster,
    txHelper transactionHelper,
    cfg SenderConfig,
    logger *zap.Logger,
) *Sender

type SenderConfig struct {
    SendEnabled     bool
    SourceAccountID string
    MaxAttempts     int
}

func (s *Sender) SendOne(ctx context.Context) error
func (s *Sender) RecoverUnsent(ctx context.Context) (int, error)
```

**`devices device.Repository` is not optional and is easy to miss.** The rail's `alias` parameter is the *device's* alias; `bankaccount.Account` carries only `DeviceID`. Passing the account's name or id there compiles and fails at the bank.

- [ ] **Step 1: Write `SendOne`'s skeleton with the gates first**

```go
// SendOne claims at most one payout and sends it. It returns nil when
// there was nothing to do -- an idle tick is not an error.
//
// THE GATES ARE CHECKED BEFORE THE CLAIM, AND THAT IS NOT COSMETIC. The
// claim increments attempts, so refusing a payout after claiming it would
// spend one of its retries on a condition it had nothing to do with: a
// merchant's payout could exhaust its attempts purely because the account's
// daily cap was full. It would also re-claim and re-refuse the same row on
// every tick. A gate that belongs to the account or the switch is checked
// against the account or the switch, before any row is touched.
func (s *Sender) SendOne(ctx context.Context) error {
	if !s.cfg.SendEnabled {
		return nil
	}

	account, err := s.sourceAccount(ctx)
	if err != nil {
		return err
	}
	if account.Status != domainbank.StatusActive {
		// PENDING, not REJECTED. An account suspended for ten minutes must
		// not fail every payout queued behind it -- that destroys work that
		// was fine, and REJECTED is for a payout we refuse, not for a
		// condition we expect to be fixed.
		s.logger.Warn("payout source account is not active; sending nothing",
			zap.String("bank_account_id", account.ID.String()),
			zap.String("status", account.Status))

		return nil
	}
	if reached, err := s.dailyCapReached(ctx, account); err != nil || reached {
		return err
	}

	row, err := s.repo.ClaimForSending(ctx, account.ID, time.Now().UTC())
	if errors.Is(err, domainpayout.ErrNotFound) {
		return nil // nothing claimable
	}
	if err != nil {
		return err
	}

	return s.send(ctx, row, account)
}
```

- [ ] **Step 2: Write `send`, with the hooks wired to the repository**

```go
func (s *Sender) send(ctx context.Context, row *domainpayout.Payout, account *domainbank.Account) error {
	hooks := domaintransfer.Hooks{
		OnOrderCreated: func(ctx context.Context, orderID string) error {
			return s.repo.RecordBankOrder(ctx, row.ID, orderID)
		},
		OnConfirmed: func(ctx context.Context) error {
			return s.repo.RecordConfirmed(ctx, row.ID, time.Now().UTC())
		},
	}

	// The rail is addressed by the DEVICE's alias, not by anything on the
	// bank account. bankaccount.Account carries only DeviceID, a foreign key,
	// and device.Repository.GetByID exists for exactly this resolution --
	// statement.Ingester and bankaccount.BalanceRefresher both do it the same
	// way, and their comments say why.
	dev, err := s.devices.GetByID(ctx, account.DeviceID)
	if err != nil {
		return fmt.Errorf("resolve device for account %s: %w", account.ID, err)
	}

	outcome, err := s.rail.Transfer(ctx, dev.Alias, transferDataFor(row), hooks)
	if err != nil {
		// The send never reached a conclusion. Whether it may be retried is
		// decided by confirmed_at, not by this error -- and Reschedule's own
		// WHERE clause enforces that, so a confirmed payout stays put here
		// even though this branch cannot tell.
		return s.failOrRetry(ctx, row, err.Error())
	}

	switch outcome.Kind {
	case domaintransfer.OutcomeCompleted:
		return s.settle(ctx, row, domainpayout.StatusCompleted, "")
	case domaintransfer.OutcomeFailed:
		// The bank actively said no. There is nothing to retry and nothing
		// to reconcile, whatever attempts remain.
		return s.settle(ctx, row, domainpayout.StatusFailed, outcome.Reason)
	default:
		// Unknown. The row keeps PROCESSING, its bank_order_id and its
		// confirmed_at, which is exactly what P4c needs. Nothing is posted:
		// releasing a reservation here would pay a merchant back for money
		// that may already have left.
		s.logger.Warn("payout outcome unknown; leaving it for reconciliation",
			zap.String("payout_id", row.ID.String()),
			zap.String("bank_order_id", outcome.TransferOrderID))

		return nil
	}
}
```

`settle` opens a transaction, calls `MarkTerminal` and the matching ledger post together, and commits. `failOrRetry` reschedules when `row.Attempts < s.cfg.MaxAttempts`, otherwise settles as `FAILED`.

Both postings take `ReservedFee: &row.ReservedFee` — the figure P4a persisted. `PayoutInput.ReservedFee`'s own doc explains why recomputing is forbidden, and both functions refuse a nil.

- [ ] **Step 3: Write the startup recovery**

The spec's §6 says a payout found `PROCESSING` with **no** `bank_order_id`
is safe to retry, because an order that was never confirmed moves no money.
Nothing has returned those rows to `PENDING` yet, so without this they stay
`PROCESSING` forever and the spec's own table is a lie.

```go
// RecoverUnsent returns payouts stranded mid-claim by a crash to PENDING,
// and ONLY those that provably never reached a confirmation.
//
// The predicate is bank_order_id IS NULL, and it is safe for one reason:
// money moves at ConfirmTransfer, and an order id is recorded before
// confirmation is ever attempted. A row with no order id therefore cannot
// have been confirmed, so nothing moved and retrying pays nobody twice.
//
// A PROCESSING row WITH an order id is deliberately left alone. It may or
// may not have been confirmed, and only P4c -- which can ask the bank about
// that order -- may decide. Widening this predicate is how money gets paid
// twice.
//
// Called once at producer start, not per tick: these rows are the residue
// of a crash, and a running worker creates no more of them.
func (s *Sender) RecoverUnsent(ctx context.Context) (int, error)
```

Add to `domainpayout.Repository` in Task 3:

```go
// RecoverUnsent moves PROCESSING payouts that never reached a confirmation
// back to PENDING, and returns how many. Guarded on bank_order_id IS NULL.
RecoverUnsent(ctx context.Context, bankAccountID uuid.UUID) (int64, error)
```

Its SQL is `UPDATE payouts SET status = 'PENDING', updated_at = NOW() WHERE
status = 'PROCESSING' AND bank_account_id = $1 AND bank_order_id IS NULL`.
It does not reset `attempts` — the attempt was spent, and a crash loop must
still terminate.

- [ ] **Step 4: Write the unit tests**

Fakes for the repository, the rail, the bank account service, the device
repository, the ledger and the transaction helper. Required coverage, each its own test:

- `send_enabled` false → nothing claimed
- source account not ACTIVE → nothing claimed, a warning logged, **no payout moved to REJECTED**
- daily cap reached → nothing claimed
- **each gate refuses before `ClaimForSending` is called** — assert the fake repository's claim count is zero. This is the ordering the doc comment argues for; a test that only checks the outcome would pass with the gates after the claim.
- nothing claimable → nil error, rail never called
- `OutcomeCompleted` → `MarkTerminal(COMPLETED)` and `PostPayoutCompleted`, both inside one transaction
- `OutcomeFailed` → `MarkTerminal(FAILED)` with the reason, and `PostPayoutFailed`
- `OutcomeUnknown` → **nothing posted, status untouched**, and a warning naming the order id
- rail error with attempts remaining → `Reschedule` with a later time, nothing posted
- rail error with attempts exhausted → `MarkTerminal(FAILED)` and `PostPayoutFailed`
- the hooks call `RecordBankOrder` and `RecordConfirmed` with this row's id
- **the fee posted is `row.ReservedFee`** — the fake ledger records what it was given, and the fixture's reserved fee is non-zero and different from the amount

The rail fake must never make a network call. It returns canned `Outcome`s.

- [ ] **Step 5: Write the integration test that mocks cannot fake**

`sender_integration_test.go`, build tag `integration`, truncating what it writes.

```go
// Two senders running against one account must not send one payout twice.
// The claim is a single guarded UPDATE with SKIP LOCKED; this proves it
// against a real database with two real transactions, under -race.
func TestSendOne_Integration_TwoSendersCannotSendOnePayoutTwice(t *testing.T)

// A payout whose outcome is unknown keeps its money reserved. This is the
// phase's most important negative: the merchant's balance must not move.
func TestSendOne_Integration_AnUnknownOutcomeReleasesNothing(t *testing.T)

// A completed payout releases the reservation exactly once, and the figure
// released is the stored reserved_fee.
func TestSendOne_Integration_CompletionSettlesTheStoredFee(t *testing.T)

// Crash recovery, against real rows: a PROCESSING payout with no order id
// returns to PENDING; one WITH an order id does not move, because only P4c
// may decide whether it was confirmed.
func TestRecoverUnsent_Integration_LeavesConfirmableRowsAlone(t *testing.T)
```

Write each in full. The second asserts `MERCHANT_PENDING_PAYOUT` and `MERCHANT_OPERATE` are unchanged after an `Unknown` outcome — assert the balances, not just the status.

- [ ] **Step 6: Run everything**

```bash
export PATH="$PATH:$HOME/go/bin"
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
go test -count=1 ./internal/service/payout/
go test -tags=integration -race -count=1 -v -run Integration ./internal/service/payout/ 2>&1 | grep -E '^(--- |ok|FAIL)'
make check    # read $? directly
```

- [ ] **Step 7: Commit**

```bash
git add internal/service/payout/ internal/domain/payout/repository.go internal/adapter/repository/payout/
git commit -m "feat(payout): send a claimed payout and settle its outcome"
```

---

### Task 5: The loop, the config and the wiring

**Files:**
- Create: `internal/service/payout/producer.go`
- Test: `internal/service/payout/producer_test.go`
- Modify: `internal/shared/config.go`, `config.yaml.example`
- Modify: `internal/shared/config_defaults_test.go`
- Modify: `internal/service/module.go`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 4's `Sender.SendOne`.
- Produces: `payout.NewSendProducer(...)` registered with fx.

- [ ] **Step 1: Add the config**

`internal/shared/config.go`, inside the existing `Payout` block:

```go
		// SendEnabled gates the sending worker, separately from
		// payout.enabled which gates POST /payout/create. Both default
		// false, and they turn on in that order: a merchant creating
		// payouts nobody sends is a recoverable state, while a worker
		// sending payouts nobody created is not a state at all.
		//
		// Turning this on is the first time this system moves money out of
		// the company's bank account.
		SendEnabled bool `mapstructure:"send_enabled"`

		// SendInterval is how often the worker looks for a claimable
		// payout. One payout is sent per tick, so this is also the ceiling
		// on how fast this service will ever call the bank for payouts.
		SendInterval time.Duration `mapstructure:"send_interval"`

		// MaxAttempts bounds how many times a payout that never reached the
		// bank is retried. It does not authorise retrying -- confirmed_at
		// does that.
		MaxAttempts int `mapstructure:"max_attempts"`
```

Defaults: `payout.send_enabled` false, `payout.send_interval` `30 * time.Second`, `payout.max_attempts` 3. Add all three to the `BindEnv` list beside the existing payout keys.

In `config.yaml.example`, add them to the existing `payout:` block with the comments from the spec's §10, including why 30s is deliberately slow.

- [ ] **Step 2: Pin the config, both defaults and binding**

Append two tests to `config_defaults_test.go`, following the pattern P4a established there:

```go
func TestDefaults_PayoutSendingIsDisabled(t *testing.T) {
	cfg := loadDefaults(t)

	assert.False(t, cfg.Payout.SendEnabled, "payout.send_enabled must default to false")
	assert.Equal(t, 30*time.Second, cfg.Payout.SendInterval)
	assert.Equal(t, 3, cfg.Payout.MaxAttempts)
}
```

And extend the existing binding test to set `payout.send_enabled: true`, `payout.send_interval: 90s` and `payout.max_attempts: 7` and assert all three arrive.

**The binding test is not optional.** A defaults-only test asserting `false` and `0` cannot fail: a mapstructure tag that stops matching leaves the field at its zero value, indistinguishable from a correct default. P4a shipped exactly that bug and three mutations survived it, including deleting a `SetDefault` line outright.

- [ ] **Step 3: Write the producer**

Model it on `internal/service/statement/producer.go` — read that file first. A ticker, an `enabled` gate, `OnStart`/`OnStop` fx hooks, and the tick body calling `SendOne` once. A `SendOne` error is logged and the loop continues; one bad payout must not stop the worker.

**`OnStart` calls `RecoverUnsent` once, before the ticker begins**, and logs how many rows it returned to `PENDING`.

**Pin the call site with a test**, because the placement is load-bearing and a reviewer proved the unsafe version passes everything else. `bank_order_id IS NULL` proves nothing moved only for a *crashed* sender. Against a *live* one, recovering per tick opens a race: instance A claims a payout and sits between the claim and `OnOrderCreated`; B recovers A's row to `PENDING`, claims it, creates its own order and confirms; A then confirms its own. One payout, two payments. The recovery SQL now also carries an age predicate as defence in the data, but the call site must be pinned too: assert `RecoverUnsent` is called exactly once at start and **never** from the tick body. A non-zero count means the last run crashed mid-send; that deserves a log line an operator will find. A `RecoverUnsent` error must not stop startup — log it and carry on, because the alternative is a service that will not boot after a crash.

- [ ] **Step 4: Test the producer without a goroutine or a sleep**

Follow the statement producer's own test approach — call the tick function directly. Cover: disabled produces no call; enabled calls `SendOne` once per tick; a `SendOne` error does not stop the loop; **`RecoverUnsent` is called exactly once at start and never per tick**; a `RecoverUnsent` error does not prevent the ticker starting.

- [ ] **Step 5: Wire it into fx**

`internal/service/module.go`, beside `NewPayoutService`:

```go
// NewPayoutSender reads the operator policy for sending from config, for
// the reason NewDepositService's own comment gives.
func NewPayoutSender(
	repo payout.Repository, accounts bankaccount.Service, rail transfer.Service,
	ledgerSvc *ledgersvc.Service, txHelper *tx.TransactionHelper,
	cfg *shared.Config, logger *zap.Logger,
) *payoutsvc.Sender {
	return payoutsvc.NewSender(repo, accounts, rail, ledgerSvc, txHelper, payoutsvc.SenderConfig{
		SendEnabled:     cfg.Payout.SendEnabled,
		SourceAccountID: cfg.Payout.SourceAccountID,
		MaxAttempts:     cfg.Payout.MaxAttempts,
	}, logger)
}
```

Add `NewPayoutSender` and `payoutsvc.NewSendProducer` to the provide list, and the producer to the invoke list so fx starts it.

**Add a test in `module_test.go` that constructs `NewPayoutSender` and asserts every config field arrives** — not just one. P4a's reviewer found that pinning `Enabled` while leaving `SourceAccountID` unpinned let a hardcoded constant survive the entire suite.

- [ ] **Step 6: Prove the app still starts**

```bash
go build ./...
# Point the DSN at maxpay_test, start it, confirm it reaches "listening"
# and that the payout send producer logged its start, then stop it.
```
Every money-moving switch is false, so this contacts no bank. If the fx graph fails, that is a finding — report it rather than working around it.

- [ ] **Step 7: Document it**

Extend README's Payouts section: the worker, the three new config keys, that `send_enabled` is the first switch that moves money out, and that it should follow `statement.polling_enabled` having proven the channel's tolerance. State that an `Unknown` outcome leaves the payout `PROCESSING` with its money reserved until P4c exists — an operator must not read that as a stuck job.

- [ ] **Step 8: Run the full gates and commit**

```bash
export PATH="$PATH:$HOME/go/bin"
make check
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable"
make test-integration
```
Both must exit 0.

```bash
git add internal/service/payout/ internal/shared/ internal/service/module.go config.yaml.example README.md
git commit -m "feat(payout): run the sender on a ticker, disabled by default"
```

---

## Verification Discipline

**Reviewers design their own mutations.** There is deliberately no mutation table in this plan. Aim at whatever you judge least well pinned, run at least two of your own, and treat a survivor as a finding about the tests.

Run them with `go test -overlay` against **modified copies**, never edits to tracked files. **Run a sanity mutant first** — `-overlay` fails open, and a stale path silently tests the original file and reports a false kill.

**A `[build failed]` is NOT a kill.** Add blank assignments (`_ = x`) so the mutant compiles, and confirm no `#` compile-error line before counting it either way.

Measured history from P4a, so this is taken seriously — in every case the implementer believed it was finished:

- a fixture left five fields at their zero values, and a mutation hard-wiring `ConfirmedAt` to NULL — inverting the feature's central invariant — survived every test on the branch
- a defaults test asserted Go zero values, so three mutations survived it including deleting a `SetDefault` line outright
- an implementer killed eight of its own mutations; a reviewer found two more, one a silently swallowed error on the only write with no test behind it
- an implementer found and fixed a wiring bug, and a reviewer found the identical bug in the field on the very next line

Traps this codebase has hit, worth checking directly:

- **Fixtures that make two values coincide disarm every swap mutation between them.** Here: `send_interval` equal to a retry interval, `attempts` equal to `max_attempts`, `next_attempt_at` equal to `confirmed_at`, the reserved fee equal to the amount.
- **Assertions satisfied by a Go zero value pin nothing.**
- **`SKIP` is reported as `ok`.** Confirm `--- PASS` by name.
- **A test can pass for a reason unrelated to the code** — check that each failure is for the reason it claims.

## Notes for the executor

- Never run anything against the `maxpay` database. It holds a bank device registered against a live corporate banking login that cannot be recreated without sending the account holder another OTP, plus real money. `make migrate-up` defaults there — always pass an explicit `DATABASE_URL`.
- Never run `make docker-up`.
- **No test may call a real bank.** Stub at `domaintransfer.Service`.
- `go build ./... | head -5 && echo OK` prints OK regardless of the build result, because `head` succeeds. Capture the output and test it for emptiness.
- When the plan text disagrees with the code you find, the spec is the authority and the plan is its argument. Say so in your report rather than silently picking one.
