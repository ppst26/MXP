# MaxPay P3b-2 — Matching, Ledger Postings and Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide whose money a credit is, credit the merchant's ledger, and tell the merchant — atomically, or not at all.

**Architecture:** After each ingestion pass, a matcher walks that account's `UNMATCHED` credit rows oldest-first and counts candidate deposits. Exactly one candidate credits exactly one merchant; more than one credits nobody and raises an alert; none leaves the row alone for the next pass. Everything a match does — the row's status, the deposit's status, the ledger entry and the webhook job — happens in one transaction, so a merchant is either credited and told, or nothing happened.

**Tech Stack:** Go 1.25 · Gin · uber/fx · sqlx + Masterminds/squirrel · PostgreSQL 18 · Zap · Viper · shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-27-maxpay-p3-deposits-design.md`, sections 7, 8, 9, 10 and 12. **The spec is the binding authority where it and this plan disagree** — this plan is an argument, and P3b-1's was wrong fifteen times.

**Carried obligations:** `docs/context/p3b2-carried-obligations.md`. Task 1 discharges the blocking one.

## What P3b-1 already built, and you do not rebuild

- `internal/domain/statement/` — `Line`, `DirectionCredit`/`DirectionDebit`, all five `Status*` constants, `ListQuery`, `Repository`, `Service`, `ValidateLine`.
- `internal/service/statement/` — the parsers, `Ingester`, `StatementProducer` (which polls and calls `IngestAccount` directly, not through the outbox).
- `internal/adapter/repository/statement/` — `InsertIfNew`, `List`, ordering `occurred_at DESC, id DESC`.
- `internal/adapter/http/adminstatement/` — `GET /admin/statement-lines`.
- P2b's ledger: `PostDepositMatched` and `PostUnmatchedIn` already exist (`internal/service/ledger/entries.go:71` and `:156`), and `KindHouseSuspense` is a real account kind. **Section 8 of the spec is right that nothing new is needed there.**
- P2a's outbox: `outbox.Repository.Enqueue(ctx, tx, kind, payload, runAfter)` already takes a transaction, which is what makes §7's atomicity possible.
- `repository/tx.TransactionHelper.WithTx(ctx, func(*sqlx.Tx) error)`.

## Global Constraints

- Money is `decimal.Decimal`, never `float64`, on every path including intermediates. Monetary columns are `NUMERIC(20,4)`; amounts cross JSON as strings via `StringFixed(2)`.
- Every id is a UUIDv7. Validator tags use `uuid`, never `uuid4`.
- Log fields are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`; service log lines carry `trace_id` from `shared.TraceIDFromContext(ctx)`.
- Errors wrap the sentinels in `internal/shared/errs` and map to HTTP status through `resp`. Raw internal text never reaches a caller.
- `internal/domain` imports no adapter and no service package.
- `repository/base` for timeouts and `CheckRowsAffectedWith`; `repository/tx` for multi-write use cases.
- Mappers follow `XToModel` / `XToDomain` / `XsToDomain`.
- HTTP handlers only bind, validate, map, call a service, and respond — they depend on a `domain*.Service`, never a repository.
- **The first task that READS a config key is the task that adds it** — to `internal/shared/config.go`, `config.yaml`, and `config.yaml.example`, in the same commit as the code that reads it.
- English only. `gofmt` clean.
- The gate is `make check` then `make test-integration`.

## Environment notes for every implementer

- `export PATH="$PATH:$HOME/go/bin"` before Go tooling.
- PostgreSQL is already running. **Never run `make docker-up`** from a worktree — compose derives its project name from the directory and would start a second stack. `make migrate-up` applies migrations.
- **Never truncate or drop anything in the `maxpay` development database.** It holds a bank device registered against a live corporate banking login that cannot be recreated without sending the account holder another OTP, and the 15 real statement rows P3b-1 ingested. `maxpay_test` is the integration database and is yours to truncate.
- **Never re-register the device, request an OTP, enable polling, or call the real bank.** This whole phase is offline: the matcher reads rows and deposits and writes attributions, and never asks the bank anything.
- `internal/testutil/pgtest.DB(t)` and `pgtest.Truncate(t, db, ...)` are the integration harness.

---

## The discovery that shapes Task 5, found before this plan was written

Spec §9 requires the webhook payload to carry `hash`: AES-256 of the `transactionId`, keyed by `API_KEY + SECRET_KEY` concatenated, so the merchant can decrypt it with credentials only it and we hold.

**That cannot be computed at delivery time.** `db/migrations/000003_credentials.up.sql:18` stores `api_key_hash BYTEA NOT NULL UNIQUE` and `api_key_prefix TEXT` — the plaintext API key is shown once at issuance and never stored. `secret_key_enc` is sealed and recoverable; the API key is not. Half the key is gone.

The plaintext API key exists at exactly one point in a deposit's life: the `x-api-key` header on the create request (`internal/adapter/http/middleware/merchantauth.go:21`). `transactionId` is also known then. **So the hash is computed at deposit creation and stored on the row**, and delivery replays it. Task 5 does this.

The alternative — sealing the API key at issuance so it can be recovered later — changes P1's credential design and weakens the reason to hash it at all. Do not take it without asking.

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/000012_matching.up.sql` / `.down.sql` | the legacy debit backfill, `deposits.webhook_hash`, and the matcher's indexes |
| `internal/domain/statement/repository.go` | tx-aware status transitions and the oldest-first candidate read |
| `internal/domain/deposit/repository.go` | tx-aware candidate queries and `MarkCompleted` |
| `internal/service/matcher/service.go` | the three outcomes, in one transaction |
| `internal/service/matcher/candidates.go` | QR and TRANSFER candidate rules, kept apart from the outcome logic |
| `internal/service/matcher/suspense.go` | the ageing sweep |
| `internal/service/deposit/webhook.go` | the payload, and the hash computed at creation |
| `internal/service/webhook/deliver.go` | the outbox handler |
| `internal/adapter/http/adminstatement/attribute.go` | `POST /admin/statement-lines/:id/attribute` |
| `internal/adapter/http/admindeposit/` | `GET /admin/deposits` |

`candidates.go` is separate from `service.go` because they change for different reasons: the outcome table is settled by the spec and should almost never change, while the candidate rules change every time a payment channel or a merchant contract does.

---

### Task 1: Tx-aware statement transitions, and the backfill P3b-1 owes

**Files:**
- Create: `db/migrations/000012_matching.up.sql`, `.down.sql`
- Modify: `internal/domain/statement/repository.go`, `internal/adapter/repository/statement/repository.go`
- Test: `internal/adapter/repository/statement/repository_test.go`, `repository_integration_test.go`

**Interfaces:**
- Consumes: `statement.Line`, the `Status*` constants, `repository/base`.
- Produces:

```go
// ListUnmatchedCredits returns UNMATCHED credit rows for one account, OLDEST
// FIRST -- the opposite of List's newest-first, because a matcher that takes
// the newest first would let a later credit consume a deposit an earlier one
// was waiting for.
ListUnmatchedCredits(ctx context.Context, bankAccountID uuid.UUID, limit int) ([]*Line, error)

// MarkMatched, MarkAmbiguous and MarkSuspense move one row, inside the
// caller's transaction. They take a tx because §7 requires the row's status,
// the deposit's status, the ledger entry and the webhook job to commit
// together.
MarkMatched(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, at time.Time) error
MarkAmbiguous(ctx context.Context, tx *sqlx.Tx, id uuid.UUID) error
MarkSuspense(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, at time.Time) error

// ListAgeing returns UNMATCHED credits older than cutoff, for the sweep.
ListAgeing(ctx context.Context, cutoff time.Time, limit int) ([]*Line, error)
```

- [ ] **Step 1: Write the migration**

```sql
-- P3b-1 changed ingestion so a debit is stored IGNORED, but rows ingested
-- before that change still carry UNMATCHED. 000011's own comment asserts that
-- nothing but a credit is ever in the unmatched partial index -- true of every
-- row written since, false of the table until this runs.
--
-- This matters because the suspense sweep in this phase posts every row still
-- UNMATCHED past a cutoff to HOUSE_SUSPENSE. Run against these rows it would
-- post historical bank fees and payout debits into the house suspense account.
UPDATE bank_statement_lines
   SET match_status = 'IGNORED'
 WHERE direction = 'DEBIT'
   AND match_status = 'UNMATCHED';

-- The matcher's read: unmatched credits on one account, oldest first. 000011's
-- statement_lines_unmatched has no direction column, which was correct while
-- debits could sit in it; now that they cannot, this index is what the read
-- actually uses.
CREATE INDEX statement_lines_matchable
    ON bank_statement_lines (bank_account_id, occurred_at)
    WHERE match_status = 'UNMATCHED' AND direction = 'CREDIT';

-- And drop the one it supersedes. Once the backfill's invariant holds -- only
-- a credit is ever UNMATCHED -- the two partial indexes cover an identical set
-- of rows over the same columns, so keeping both charges index maintenance on
-- every insert and update for a predicate no query uniquely needs. The down
-- migration recreates it.
DROP INDEX IF EXISTS statement_lines_unmatched;

-- The hash the merchant decrypts to prove a webhook came from us. Computed at
-- deposit creation, because the plaintext API key that keys it exists only in
-- the create request's header and is never stored (000003 keeps a hash).
-- Nullable: deposits created before this migration have none, and a webhook
-- for one of those must be refused rather than sent unsigned.
ALTER TABLE deposits ADD COLUMN webhook_hash TEXT;
```

Down: drop the column and the index. **The backfill is not reversed** — say so in a comment, because re-marking those rows `UNMATCHED` would re-arm the landmine.

- [ ] **Step 2: Apply and verify the backfill against the dev database**

Run `make migrate-up`, then confirm against `maxpay`:

```sql
SELECT direction, match_status, count(*) FROM bank_statement_lines GROUP BY 1,2 ORDER BY 1;
```

Expected before: `CREDIT/UNMATCHED 7`, `DEBIT/UNMATCHED 8`. Expected after: `CREDIT/UNMATCHED 7`, `DEBIT/IGNORED 8`. Paste both. **This is the one migration in this plan that changes existing rows; prove it did what it claims.**

- [ ] **Step 3: Add the port methods and implement them**

`ListUnmatchedCredits` orders `occurred_at ASC, id ASC` — and note the tie-break direction is the mirror of `List`'s. The capture proves ties are ordinary (a fee and its transfer share a timestamp), so the tie-break is required, not decoration.

The three `Mark*` methods take `*sqlx.Tx` and use `base.CheckRowsAffectedWith` so that marking a row that is no longer `UNMATCHED` is an error rather than a silent no-op. **A concurrent matcher must not be able to match the same row twice**, and the `WHERE match_status = 'UNMATCHED'` guard plus the rows-affected check is what prevents it.

- [ ] **Step 4: Tests**

```text
ListUnmatchedCredits_ReturnsOldestFirst
ListUnmatchedCredits_ExcludesDebits                    -- the reason the backfill exists
ListUnmatchedCredits_ExcludesMatchedAndSuspense
ListUnmatchedCredits_IsScopedToItsAccount
ListUnmatchedCredits_BreaksTiedTimestampsDeterministically
MarkMatched_MovesTheRowAndSetsMatchedAt
MarkMatched_OnARowThatIsNoLongerUnmatched_IsAnError    -- the double-match guard
MarkSuspense_SetsSettledAt
ListAgeing_ExcludesRowsYoungerThanTheCutoff
```

- [ ] **Step 5: Prove the teeth**

With `go test -overlay` on modified COPIES: drop `direction = 'CREDIT'` from `ListUnmatchedCredits`; reverse its ordering to newest-first; drop the `WHERE match_status = 'UNMATCHED'` guard from `MarkMatched`. Each must fail its own test. Report the table.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/000012_matching.up.sql db/migrations/000012_matching.down.sql internal/domain/statement/ internal/adapter/repository/statement/
git commit -m "feat(statement): tx-aware transitions, an oldest-first read, and the debit backfill"
```

---

### Task 2: Tx-aware deposit candidate queries

**Files:** `internal/domain/deposit/repository.go`, `internal/adapter/repository/deposit/repository.go`, sqlmock and integration tests.

**Interfaces produced:**

```go
// CandidatesForAmount returns PENDING deposits on one account whose
// deposit_amount equals amount exactly and whose expires_at is at or after
// occurredAt. This is the QR rule, and the equality is why P3a randomises
// satang in the first place.
CandidatesForAmount(ctx context.Context, tx *sqlx.Tx, bankAccountID uuid.UUID, amount decimal.Decimal, occurredAt time.Time) ([]*Deposit, error)

// CandidatesForCounterparty returns PENDING deposits on one account whose
// declared customer account and bank code match the sender parsed out of the
// row. This is the TRANSFER rule.
CandidatesForCounterparty(ctx context.Context, tx *sqlx.Tx, bankAccountID uuid.UUID, bankCode, accountNo string, occurredAt time.Time) ([]*Deposit, error)

MarkCompleted(ctx context.Context, tx *sqlx.Tx, id uuid.UUID, at time.Time) error
```

**`expires_at >= occurredAt`, not `>= now()`.** A row is matched against the deposit that was open *when the money arrived*, not when the matcher happens to run. A matcher lagging by an hour must not refuse a payment the customer made in time — and it must not match one they made late.

`MarkCompleted` guards on `status = 'PENDING'` with a rows-affected check, for the same double-spend reason as `MarkMatched`.

Tests, each with `pgtest.Truncate`: amount equality is exact to satang (`5.35` does not match `5.3500001` or `5.34`); an expired-at-the-time deposit is excluded; a deposit on another account is excluded; a `COMPLETED` deposit is excluded; two deposits at the same amount both come back, because that is the AMBIGUOUS case and the repository must not hide it.

Prove: change the amount comparison to a range; change `expires_at >= occurredAt` to `>= now()`; drop the `status = 'PENDING'` filter. Each must fail.

---

### Task 3: The matcher — three outcomes, one transaction

**Files:** `internal/service/matcher/service.go`, `candidates.go`, tests.

**Interfaces:**
- Consumes: everything from Tasks 1 and 2; `ledger.Service.PostDepositMatched`; `outbox.Repository.Enqueue`; `tx.TransactionHelper`.
- Produces: `func NewService(...) *Service` with `MatchAccount(ctx, bankAccountID uuid.UUID) (matched, ambiguous, failed int, err error)`.

**One row's failure must not end the account's pass.** Log it at Error with the row id, count it, and carry on — the same policy the ingester applies to a row it cannot parse, and for the same reason. A permanent per-row failure is reachable: `chainFor` fails for a merchant whose ancestor chain is broken, which is why P2b's `PostPayoutCompleted` needed a fallback. Returning on the first error lets one such row block every row behind it forever, on every pass, which is precisely the poison-row stall P3b-1's final review rated Important. A failed row simply stays `UNMATCHED`, which is already the no-candidates behaviour, so it retries next pass and ages into `SUSPENSE` after `suspense_after` — a row nobody can process becoming a human's problem after 24 hours is the right end state.

Reserve the returned `err` for a failure of the pass itself, such as `ListUnmatchedCredits` failing.

**Post the ROW's amount to the ledger, never the deposit's.** `ledger.DepositInput{MerchantID, BankAccountID, Amount, Reference}` takes one amount, and it must be `row.Amount` — the money that actually arrived. For a QR match the two are equal by the matching rule itself. For a TRANSFER match they can differ, because §7 matches a transfer on the sender and only bounds the amount. Posting `deposit.DepositAmount` when the customer sent something else would make the books disagree with the bank, and the bank is right.

**The webhook payload struct is defined in `internal/domain/deposit/dto.go` by THIS task**, because Task 3 enqueues it and Task 6 decodes it and neither can own a type the other needs first. Give it the merchant id, the deposit id, the reference, the transaction id, the amount as a string, the callback URL and the stored hash — everything the delivery handler needs without re-reading the deposit. `bankaccount.RefreshPayload` is the precedent for the shape.

**The outcome table is the whole engine, and it is spec §7 verbatim:**

| Candidates | Outcome |
|---|---|
| exactly one | row `MATCHED`, deposit `COMPLETED`, ledger posted, webhook enqueued |
| more than one | row `AMBIGUOUS`, **nothing else changes**, alert |
| none | row stays `UNMATCHED`, retried next pass |

- [ ] **Step 1: `candidates.go` — the rules, apart from the outcomes**

```go
// Candidates returns the deposits a row could be paying for.
//
// The two rules are kept here, away from the outcome logic, because they
// change for different reasons: the outcome table is settled by the spec and
// should almost never move, while these change whenever a payment channel or
// a merchant contract does.
func (s *Service) Candidates(ctx context.Context, tx *sqlx.Tx, row *statement.Line) ([]*deposit.Deposit, error) {
	// QR: the amount IS the identifier. P3a randomises satang precisely so
	// that an exact amount match identifies one deposit.
	byAmount, err := s.deposits.CandidatesForAmount(ctx, tx, row.BankAccountID, row.Amount, row.OccurredAt)
	if err != nil {
		return nil, err
	}

	// TRANSFER: the sender identifies the customer. A row whose comment
	// carries no sender -- a PromptPay credit, which names US, or the empty
	// comment the capture also contains -- has no candidates by this rule and
	// ages into SUSPENSE. Spec section 6 is explicit that this is a property
	// of how the customer chose to pay, not a defect.
	if !row.HasCounterparty() {
		return byAmount, nil
	}

	byCounterparty, err := s.deposits.CandidatesForCounterparty(
		ctx, tx, row.BankAccountID, row.CounterpartyBank, row.CounterpartyAccount, row.OccurredAt)
	if err != nil {
		return nil, err
	}

	return dedupeByID(append(byAmount, byCounterparty...)), nil
}
```

**Two QR deposits at the same amount cannot both be PENDING, so that is NOT how you build the AMBIGUOUS test.** `deposits_pending_amount` is `UNIQUE (bank_account_id, deposit_amount) WHERE status = 'PENDING' AND deposit_amount IS NOT NULL`, and `CandidatesForAmount` filters on a non-null `deposit_amount`, so the amount rule alone returns at most one candidate per account. Task 2's implementer found this by trying to build the fixture and failing. Two candidates arise in exactly two shapes, and both must be tested:

1. **Two TRANSFER deposits sharing a declared customer account.** Nothing forbids two PENDING deposits on one account with the same `customer_bank_code` and `customer_account_no` — a customer opening two orders and paying once.
2. **The cross-rule collision, which is the dangerous one.** Deposit A is QR at 5.35; deposit B is TRANSFER declared from account X. A row of exactly 5.35 arriving from account X matches A by amount and B by counterparty — two *different* deposits, two different merchants possibly, and no index anywhere prevents it. This is the case AMBIGUOUS exists for.

**`dedupeByID` is load-bearing, not tidiness.** A QR deposit whose customer also happens to be the declared TRANSFER counterparty would otherwise appear twice and be judged AMBIGUOUS — credited to nobody — when it is in fact one unambiguous deposit matched two ways. Write a test for exactly that shape.

- [ ] **Step 2: `service.go` — one row, one transaction**

```go
// matchRow applies the outcome table to one row.
//
// Everything a match does commits together: the row's status, the deposit's
// status, the ledger entry and the webhook job. Either a merchant is credited
// and told, or nothing happened. outbox.Enqueue taking a tx is what makes the
// last of those possible.
func (s *Service) matchRow(ctx context.Context, row *statement.Line) (outcome string, err error) {
	err = s.tx.WithTx(ctx, func(tx *sqlx.Tx) error {
		candidates, err := s.Candidates(ctx, tx, row)
		if err != nil {
			return err
		}

		switch len(candidates) {
		case 0:
			// Not an error and not a state change. The row is retried next
			// pass, and ages into SUSPENSE if it never matches.
			outcome = OutcomeNone

			return nil

		case 1:
			// ... MarkMatched, MarkCompleted, PostDepositMatched, Enqueue
			outcome = OutcomeMatched

			return nil

		default:
			// NOTHING else changes. No deposit is completed, no ledger entry
			// is posted, no webhook is sent. A human resolves it through the
			// attribute endpoint. Crediting the wrong merchant is worse than
			// crediting nobody, and this branch is that sentence in code.
			outcome = OutcomeAmbiguous

			return s.rows.MarkAmbiguous(ctx, tx, row.ID)
		}
	})

	return outcome, err
}
```

- [ ] **Step 3: The tests spec §13.3 demands, each failing when its outcome is changed**

```text
MatchRow_OneCandidate_CreditsExactlyOneMerchant
MatchRow_OneCandidate_PostsTheLedgerEntryAndEnqueuesTheWebhook
MatchRow_TwoTransferDepositsSharingACustomer_CreditsNobody   -- assert NO ledger entry, NO webhook, NO deposit completed
MatchRow_QRAndTransferMatchingDifferentDeposits_CreditsNobody -- the cross-rule collision
MatchRow_TwoCandidates_MarksTheRowAmbiguous
MatchRow_NoCandidates_LeavesTheRowAlone       -- assert the row is still UNMATCHED
MatchRow_OneDepositMatchedByBothRules_IsNotAmbiguous
MatchRow_ARowWithNoCounterparty_UsesTheAmountRuleOnly
MatchAccount_TakesRowsOldestFirst
```

The three-outcome tests are the ones spec §13 names as making this phase trustworthy. `TwoCandidates_CreditsNobody` must assert on the *absence* of every side effect, not merely on the row's status — a matcher that marks the row `AMBIGUOUS` and also credits one of the two would pass a status-only assertion.

- [ ] **Step 4: Prove the transaction boundary, against a real database**

An integration test that makes the webhook enqueue fail after the ledger entry is posted, and asserts **the row is still `UNMATCHED`, the deposit still `PENDING`, and no journal entry exists.** This is the promise §7 makes, and it is a promise about PostgreSQL, not about Go — it belongs in `-tags=integration`.

- [ ] **Step 5: Mutations**

Swap the `case 1` and `default` branches; delete `MarkAmbiguous` from the default branch; remove `dedupeByID`; take rows newest-first. Each must fail its own test. Then design and run at least three of your own.

---

### Task 4: The suspense sweep

**Files:** `internal/service/matcher/suspense.go`, config, tests.

A row still `UNMATCHED` after `deposit.suspense_after` (default 24h) is posted to `HOUSE_SUSPENSE` via `PostUnmatchedIn` and marked `SUSPENSE`, in one transaction. It is **not deleted and not hidden** — a human can still attribute it, and Task 7 is how.

You add `deposit.suspense_after` to `shared.Config`, `config.yaml` and `config.yaml.example`, per the standing rule.

**The sweep runs over `UNMATCHED` rows, which after Task 1 are only credits.** State that dependency in the code comment: the correctness of this sweep rests on Task 1's backfill and on ingestion storing debits `IGNORED`, and a future change that lets a debit back into `UNMATCHED` would make this sweep post bank fees to the house.

Tests: a row younger than the cutoff is untouched; a row older is posted and marked; a row already `SUSPENSE` is not posted twice; **a debit is never swept** (seed one directly and assert).

---

### Task 5: The webhook hash, computed where both halves of the key exist

**Files:** `internal/service/deposit/webhook.go`, the create path, `internal/shared/crypto/`, tests.

Read the section above the File Structure before starting. The short version: the plaintext API key is never stored, so the hash cannot be computed at delivery, and it must be computed at creation and stored in `deposits.webhook_hash`.

**Interfaces produced:** `func DepositHash(transactionID, apiKey, secretKey string) (string, error)` — AES-256 of `transactionID`, keyed by `apiKey + secretKey`.

**The cipher is pinned by the PRD's own example, and it is NOT raw AES-256.** `PRD/technical-term/Deposit/Deposit Webhook Callback.md` gives a sample hash of `U2FsdGVkX1/Z6EHf3XX6hmzlnK7TvYoLKsUlyR0F47LIERkRq2fKKhKwpwq3j9wu`. Base64-decoded, its first eight bytes are the ASCII `Salted__`, followed by an 8-byte salt and 32 bytes of ciphertext — two AES blocks, exactly PKCS#7 padding for the 19-character `transactionId` in the same example. That is the OpenSSL "salted" container, which is what **CryptoJS's default `AES.encrypt(plaintext, passphrase)`** emits, and CryptoJS is what a Node or PHP merchant integration will use to decrypt it.

So the contract is:

- **AES-256-CBC**, PKCS#7 padding.
- Key and IV derived by **EVP_BytesToKey with MD5, one iteration**, from the passphrase `API_KEY + SECRET_KEY` and the random 8-byte salt. The passphrase is *not* used as raw key bytes.
- Output is `"Salted__"` + the salt + the ciphertext, base64-encoded.
- **The result is deliberately non-deterministic** — a fresh random salt per call — so do not write a test asserting a fixed string. Assert instead that the value round-trips: decrypting with the same passphrase returns the `transactionId`, and decrypting with a different one does not.

Nothing in `internal/shared/crypto/` does this today; `secretbox.go` is NaCl and unrelated. Write it, and write the decrypt side too, because a round-trip test is the only way to prove the encrypt side is right.

The create path takes the API key from `middleware.MerchantAPIKeyHeader`, the secret from the credential's `SecretKeyEnc` opened with the KEK, computes the hash, and stores it. A deposit created before this migration has `webhook_hash` NULL, and **Task 6 must refuse to deliver one of those rather than send it unsigned.**

Tests: the hash is stable for the same inputs; it differs when the API key differs; it differs when the secret differs; a deposit created without a hash is refused at delivery.

---

### Task 6: Webhook delivery

**Files:** `internal/service/webhook/deliver.go`, the outbox job kind, tests.

An outbox job of kind `deliver_deposit_webhook`.

**The outbound body follows the PRD verbatim, and the PRD's field list is wider than the job payload.** `Deposit Webhook Callback.md` mandates `referenceId`, `transactionId`, `clientId`, `merchantId`, `walletId`, `bankCode`, `bankName`, `bankAccountNumber`, `bankAccountName`, `amount`, `status`, `timestamp`, `matchTimestamp`, `type` and `hash`. Task 3's `WebhookPayload` carries the deposit's identity and the hash — the hash matters because it **cannot be recomputed later**, the API key being unrecoverable. **The four `bank*` fields are the PAYING CUSTOMER's, not our receiving account.** An earlier draft of this plan said "the bank details live on `bank_accounts`" and that was wrong. The PRD's own field table is explicit: `bankCode` is "รหัสธนาคาร 3 หลักของลูกค้าผู้โอน", `bankName` is "ชื่อย่อธนาคารผู้ชำระเงิน", `bankAccountNumber` is "เลขบัญชีลูกค้าผู้ชำระ (อาจปิดบังบางส่วน)", and `bankAccountName` is "ชื่อเจ้าของบัญชีผู้ชำระ (อาจเป็น `""` หากไม่พบใน Statement)". A masked number and a possibly-empty name only make sense for a payer read out of a statement; we know our own account's name exactly. `CreateDeposit.md` puts the receiving company at the top level and nests the payer under `customerData` — the webhook has no such nesting, which is why its top-level `bank*` are the payer's.

Fill them from what actually happened, per path:

- **Completion** — the matched statement row's `CounterpartyBank` and `CounterpartyAccount`. The matcher holds that row when it enqueues, so it carries them in the payload; the delivery handler must not have to find the row. `bankAccountName` is `""`, because a KTB statement carries no counterparty name and the PRD explicitly allows the empty string for exactly that reason.
- **Expiry** — nobody paid, so there is no observed payer. Use the deposit's declared `CustomerBankCode`, `CustomerAccountNo` and `CustomerName`.
- `bankName` is the mnemonic for the payer's bank code, and **the one-entry `receivingBankNames` map is not it.** That map exists for be-maxpay's own KTB account and its own comment says so; feeding an arbitrary payer's code through it returns the raw code, so the PRD's own worked example renders `bankName: "074"` where it must say `"TTB"`. Build the real table from `PRD/technical-term/Utilitties/ListBank.md`, which is the authority `CreateDeposit.md` names ("ต้องตรงกับ `name` จาก **List Bank API**"): seventeen entries, `code` to `name`, including `000 PROMPTPAY`, `004 KBANK`, `006 KTB`, `014 SCB`, `025 BAY` and `074 TTB`. An unrecognised code falls back to the raw code, which at least tells a merchant something; say in a comment that it is a fallback rather than a name.

  **Assert literal pairs in the test.** `assertStringField(..., bank.Mnemonic(payload.CounterpartyBankCode))` calls the function under test to build its own expectation and can never fail. `"074"` must assert `"TTB"` as a literal.

**`amount` is `DepositAmount` on both paths**, not `RequestedAmount`. The PRD defines it as "ยอดชำระจริงหลังสุ่มเศษสตางค์" — the figure after satang randomisation, which is what the merchant was handed at create time and what it reconciles against. Sending `RequestedAmount` on expiry makes the same deposit report `400.64` if it completes and `400.00` if it does not.

**Everything else — the merchant, the client, the deposit itself — is loaded.** The bank account is still needed for nothing in the body; do not remove the load if something else uses it, but do not source the payer from it.

**`clientId` and `merchantId` are the short codes, not the UUIDs.** `merchants.code` and `merchant_clients.code` both exist and are what the PRD's `VOBM7qzaRH`/`nHUxQbHgEu` examples are. Load the merchant and the client alongside the deposit and its bank account. Sending a UUID where a merchant matches a code against its own records breaks the integration silently.

**`walletId` has no source in this system and is emitted empty.** The webhook PRD lists it; `CreateDeposit.md` never defines it and no wallet table exists anywhere in the schema. Emitting the client's code there would be inventing a semantic mapping, which is the kind of guess that surfaces as a support ticket a year later. The PRD's own example carries `"bankAccountName": ""`, so an empty string is within the contract's shape. Say in the code why it is empty, and treat it as an open question for the merchant-facing documentation rather than a defect.

**The PRD requires a callback on `expired` too, not only on `completed`.** `Deposit Webhook Callback.md`'s first line says the callback fires the moment a deposit reaches `completed` *or* `expired`, and its `status` field takes both values. A merchant never told about an expiry holds a pending order that will never resolve — worse than not being told about a completion, because nothing else will ever prompt them. `deposit.Expirer.ExpireDue` already claims overdue deposits in one locked statement and carries its own TODO for this. Enqueue the same `deliver_deposit_webhook` job there, with `status: "expired"`, inside whatever transaction `ClaimExpired` gives you. The delivery handler needs no change beyond taking the status from the payload rather than hardcoding it.

**`amount` crosses this boundary as a JSON NUMBER, not a string.** The PRD's example is `"amount": 400.64` unquoted, and a merchant parsing `400.64` will break on `"400.64"`. This is the one place the project's amounts-as-strings rule yields, because the rule serves internal consistency and the PRD is an external contract. Emit it from the `decimal.Decimal`'s own text via `json.RawMessage` or a custom marshaller — **never by converting to `float64`**, which is what the rule was protecting against in the first place. A non-2xx response returns an error and the worker's existing backoff decides when to retry; burial after `outbox.max_attempts` is already implemented and you do not reimplement it.

`callback_url` is checked HTTPS at deposit creation and `deposit.ErrCallbackNotHTTPS` already exists (`internal/domain/deposit/validator.go:43`) — **verify it, do not re-add it.**

**The delivery handler must not follow redirects**, and must have a timeout. A merchant's endpoint redirecting to an internal address is an SSRF, and this job runs inside the network.

Tests: a 200 succeeds; a 500 returns an error so the worker retries; a redirect is refused; a missing `webhook_hash` is refused; the timeout is honoured.

---

### Task 7: The admin surface

**Files:** `internal/adapter/http/adminstatement/attribute.go`, `internal/adapter/http/admindeposit/`, `.bru` files, tests.

`POST /api/v1/admin/statement-lines/:id/attribute` resolves an `AMBIGUOUS` or `SUSPENSE` row. **Platform administrators only** — a reseller may read its subtree's deposits, but attributing money is the platform's act, the same boundary P2b drew between reading a ledger and adjusting it. Follow `adminledger.postAdjustment`, whose comment records that a previous security review of this codebase found the wrong shape of this check three times.

Attributing a `SUSPENSE` row is **a reversal and a re-posting, not an edit**: reverse the `PostUnmatchedIn` entry, then `PostDepositMatched`. That is why `SUSPENSE` is a status and not a deletion.

**No reversal method exists yet, and this task adds it.** `internal/service/ledger/` has `Post`, `Adjust` and the eight `Post*` constructors, and none of them undoes an entry. Add:

```go
// PostReversal writes the compensating entry for an earlier one: every line
// with its sign flipped, referencing the original.
//
// It does not delete or amend the original, because a ledger that can be
// edited cannot be audited -- the zero-sum constraint trigger and the
// append-only design both assume a correction is a new entry.
func (s *Service) PostReversal(ctx context.Context, tx *sqlx.Tx, entryID uuid.UUID, ref string) (*domainledger.Entry, error)
```

**And a way to find the entry, which also does not exist.** `PostReversal` takes an `entryID`, and nothing in `internal/adapter/repository/ledger/` can produce one from a statement row. `journal_entries` carries `reference_type` and `reference_id` with an index on them (`000009_ledger.up.sql:71-80`), and Task 4's sweep posts with the row's id as the reference — so the lookup exists in the schema and only the method is missing:

```go
// FindEntryByReference returns the entry posted against one reference, or
// ErrNotFound. The suspense sweep writes the statement row's id as the
// reference, which is what makes a later attribution able to find the posting
// it must reverse.
FindEntryByReference(ctx context.Context, tx *sqlx.Tx, referenceType, referenceID string) (*Entry, error)
```

Test that the reversal's lines sum to zero against the original's, that the affected balances return to where they were before the original, that reversing the same entry twice is refused, and that `FindEntryByReference` returns `ErrNotFound` rather than an empty entry when a row was never swept.

`GET /api/v1/admin/deposits` — platform admins see all; a reseller sees its subtree. Reuse Task 7-of-P3b-1's shape, including refuse-before-loading.

Write one authorization test per rule, **each asserting the service was never called** on a refusal.

---

### Task 8: Wire it up and prove it end to end

**Files:** the three per-layer module files, `internal/service/outbox/module.go`, config, `README.md`, `AGENTS.md`.

This codebase registers providers in **one module file per layer**. Do not create per-package `module.go` files. Any producer's `fx.Invoke` goes in `internal/service/outbox/module.go` beside `RegisterBalanceProducerLifecycle`, never in `service.Module` — which is registered first in `app/module.go` and would therefore stop it last, after the database pool closes.

**The matcher runs on its own ticker, not chained to the ingestion pass.** Spec §7 says "runs after each ingestion pass", and this is a deliberate deviation from that wording, recorded here and in `AGENTS.md`: `statement.polling_enabled` defaults to **false**, so a matcher chained to ingestion would never run at all in the default configuration — including over rows already in the table. An independent ticker satisfies the intent (matching happens promptly and repeatedly) without making the matcher hostage to a flag that protects a different resource, the bank channel, which the matcher never touches.

**Both new producers take an `enabled` switch defaulting to TRUE.** The existing `pool.balance_refresh_enabled` and `statement.polling_enabled` default false because every tick is a live bank call, and that reason genuinely does not apply here — neither the matcher nor the expiry sweep talks to the bank. But the reason to have a switch at all does: these loops credit merchants and enqueue webhooks, and an operator needs to be able to stop a money-moving loop during an incident without a redeploy. Default true, because the safe state for matching is running.

**Nothing schedules the deposit expiry sweep, and this task fixes that.** `KindExpireDeposits`'s handler is registered in `internal/service/outbox/module.go` and **nothing anywhere enqueues that kind** — so `Expirer.ExpireDue` never runs, no deposit ever reaches `EXPIRED`, and Task 6's expiry callback is unreachable code. This is the third time this plan's lineage has shipped a sweep with no caller: P3a's `ExpireStale` had none, and P3b-1 hit the same shape twice. Add a producer with a ticker, following `bankaccount.BalanceProducer` and `statement.StatementProducer` exactly — including registering its `fx.Invoke` in `internal/service/outbox/module.go` beside the others, never in `service.Module`, for the shutdown-ordering reason those files already explain.

**The proof, and it needs no bank:** seed `maxpay_test` with a pending QR deposit and a statement row at exactly its amount, run the matcher, and assert the deposit is `COMPLETED`, the row `MATCHED`, a balanced journal entry exists, and a `deliver_deposit_webhook` job is queued. Then run it again and assert nothing changes. Paste the SQL.

Then the ambiguous case end to end: two deposits at the same amount, one row, and assert nobody was credited.

Then the expiry case end to end: a `PENDING` deposit past `expires_at`, the sweep run, and assert the deposit is `EXPIRED` and a `deliver_deposit_webhook` job is queued carrying `status: "expired"`. Without this the PRD's own first line — the callback fires on `completed` **or** `expired` — is only half implemented, and nothing else in the plan would notice.

---

## Self-Review

**Spec coverage.** §7's outcome table and transaction → Task 3; its oldest-first read → Task 1; the SUSPENSE ageing → Task 4. §8 → Task 3 and Task 4, using P2b's existing constructors, as the spec says. §9 → Tasks 5 and 6. §10's `attribute` and `admin/deposits` → Task 7. §12's new error cases → Tasks 5, 6 and 7. §13's four trust requirements: the three matcher outcomes are Task 3 Step 3, and ingestion idempotency was proved in P3b-1.

Not covered, deliberately: P5's delivery history, manual replay, inquiry APIs and per-merchant delivery configuration, which §9 explicitly leaves there.

**Placeholder scan.** Tasks 1, 2 and 3 carry their schema, their queries and the outcome switch in full, because they are where a mistake credits the wrong merchant. Tasks 4 to 8 name each rule and each required test but not every body — they follow shapes already in the tree.

**Type consistency.** `ListUnmatchedCredits`, `MarkMatched`, `MarkAmbiguous`, `MarkSuspense`, `ListAgeing`, `CandidatesForAmount`, `CandidatesForCounterparty` and `MarkCompleted` are defined in Tasks 1 and 2 and used with those names and signatures in Tasks 3 and 4. Every one takes `*sqlx.Tx` except the two read paths that begin a pass.

**One thing this plan cannot prove.** Whether the webhook hash a merchant receives is one they can actually decrypt. That is a contract with an external party and the PRD is the authority; Task 5 stops and asks rather than guessing at a cipher mode.
