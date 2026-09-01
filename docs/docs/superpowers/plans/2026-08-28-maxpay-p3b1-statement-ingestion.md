# MaxPay P3b-1 — Statement Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** See every baht that arrives in a corporate bank account, recorded row by row, with the bank's own answer kept verbatim.

**Architecture:** A poller walks `GET /v1/transaction-history/accounts/{accountRefId}` newest-first and stores each row it has not seen, keyed on the bank's own `transactionIndex`. Everything the row means — its amount, its direction, its timestamp, its counterparty — is read by one small parser apiece, each driven by a fixture captured from the real bank. Nothing infers, nothing falls back: a row that cannot be parsed is refused rather than stored under a guess.

**Tech Stack:** Go 1.25 · PostgreSQL 18 · Gin · sqlx + Masterminds/squirrel · uber/fx · Zap · shopspring/decimal · testify · go-sqlmock

**Spec:** `docs/superpowers/specs/2026-08-27-maxpay-p3-deposits-design.md`, sections 4.2 and 6, plus the admin surface in §10. A Thai translation sits beside it and is explicitly not authoritative.

**Scope boundary — what this plan deliberately does NOT build:** the matching engine, ledger postings, webhook delivery, and the endpoint that attributes a row to a deposit by hand. Those are P3b-2. A row ingested here reaches `MATCHED` or `SUSPENSE` only once that lands; in P3b-1 every credit sits at `UNMATCHED` and that is the correct, complete behaviour of this phase.

**Prerequisite — branch from P3a, not from `main`.** P3a is pushed and its pull request is open, but it has NOT merged: `main` stops at migration `000009_ledger`, and `000010_deposits` exists only on `feat/p3a-deposit-creation`. Two things break if this work starts from `main`: the migration below collides at `000010`, and the active polling tier in Task 6 queries a `deposits` table that is not there. Create the worktree from `feat/p3a-deposit-creation`. If P3a has merged into `main` by the time this runs, branch from `main` instead and keep the same numbering — `000011` is correct either way, because P3a owns `000010`.

**What this phase is worth on its own:** today nobody can see money arriving in the corporate accounts at all. After this, every credit and debit is a row with the bank's raw JSON beside it, and an operator can read them.

## Global Constraints

- Money is `decimal.Decimal`, never `float64`, on every path including intermediates. **A statement amount must be read from the literal text of the JSON number**, via `json.RawMessage` into `decimal.NewFromString` — `internal/service/bankaccount/balance.go`'s `decodeAmount` is the pattern. The failure this prevents is a boundary one, not a penny one: see the evidence section's fact 3.
- Monetary columns are `NUMERIC(20,4)`; amounts cross JSON as strings via `StringFixed(2)`.
- Every id is a UUIDv7. Validator tags use `uuid`, never `uuid4`.
- Log fields are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`; service log lines carry `trace_id` from `shared.TraceIDFromContext(ctx)`.
- Errors wrap the sentinels in `internal/shared/errs` and map to HTTP status through `resp`. Raw internal text never reaches a caller.
- `internal/domain` imports no adapter and no service package.
- `repository/base` for timeouts and `CheckRowsAffectedWith`; `repository/tx` for multi-write use cases.
- Mappers follow `XToModel` / `XToDomain` / `XsToDomain`.
- Every new endpoint ships a `.bru` file.
- English only. `gofmt` clean.
- **The first task that READS a config key is the task that adds it** — to `shared.Config`, to `config.yaml`, and to `config.yaml.example`, in one commit with the code that reads it. Task 8 then verifies the block is complete rather than introducing it. A task that reads `cfg.Statement.MaxPages` before any task has declared the field does not compile.
- The gate is `make check` then `make test-integration`.

## Environment notes for every implementer

- `export PATH="$PATH:$HOME/go/bin"` before Go tooling.
- A PostgreSQL container is already running. **Never run `make docker-up`** from a worktree — compose derives its project name from the directory and would start a second stack. `make migrate-up` applies migrations.
- Integration tests use `maxpay_test` via `TEST_DATABASE_URL`; `make test-integration` runs `-race -p 1`. **Never truncate or drop anything in the `maxpay` development database** — it holds a bank device registered against a live corporate banking login that cannot be recreated without sending the account holder another OTP.
- `internal/testutil/pgtest.DB(t)` and `pgtest.Truncate(t, db, ...)` are the integration harness.
- `ktb.capture_path` is set, so any call this code makes to the bank is appended verbatim to `logs/ktb-wire.jsonl`. That file holds real account numbers and balances: `0600`, gitignored, never a fixture without redaction.

---

## The captured evidence this plan is built on

`internal/service/deposit/testdata/transaction_history.json` is a redacted copy of a real response. Everything below comes from it, not from the PRD, which was wrong about most of it.

```json
{
  "content": [
    { "transactionIndex": "17074203242", "transactionRefId": "17074203242",
      "transactionDateTime": "2026-08-28T12:05:27+07:00",
      "transactionCode": "MORISD",
      "transactionComment": "TR fr 004-9999999999",
      "withdraw": null, "deposit": 5.35, "ledgerBalance": 22.35,
      "currency": "THB", "transactionType": "Deposit", "paymentRef": null }
  ],
  "pageable": { "totalPages": 2, "last": false, "numberOfElements": 10,
                "totalElements": 15, "pageSize": 10, "pageNumber": 0,
                "prevCursor": null, "nextCursor": null }
}
```

Four facts drive the design:

1. **`transactionIndex` is the fingerprint.** Stable, monotonic per account, and present in every row.
2. **Direction is two nullable fields**, not a sign. A credit sets `deposit`; a debit sets a **negative** `withdraw`. `transactionType` says which in words.
3. **Satang survive.** `deposit: 5.35` arrives unrounded, and must be read from the literal text into `decimal.NewFromString`.

   Be precise about why, because the obvious reason is false and a test written against it proves nothing: `decimal.NewFromFloat(5.35)` returns exactly `5.35`. shopspring formats a float with shortest-round-trip, so the literal comes back intact for every ordinary amount — measured across `0.07`, `1234567.89` and `123456789012345.67`, all identical either way. The float64 path only diverges once a value needs more significant digits than a float64 holds: `99999999999999.99` decodes as `99999999999999.98`. The rule stands, but it guards a boundary, not pennies, and the test that pins it has to use a value at that boundary.
4. **The counterparty lives in free text and varies by channel.** Five grammars appear in the capture, and there is no reason to believe that is all of them.

5. **The bank returns newest-first, and `transactionIndex` descends in lockstep.** Verified across the capture's ten rows: `transactionDateTime` is strictly descending, `transactionIndex` is strictly descending, every index is distinct, and `transactionIndex == transactionRefId` on every row. Task 5's page walk depends on the newest-first ordering to know that a page holding nothing new means nothing newer exists.

6. **`transactionDateTime` is NOT unique.** Three of the ten rows share a timestamp with their neighbour — a fee and the transfer it belongs to are stamped identically (`IORSFE`/`IORSWT` at `01:45:23`, `01:43:03`, and `13:49:48`). Any newest-first ordering must therefore carry a tiebreaker, or paging over it can repeat or skip rows.

7. **The capture is page 0 of 2**, not a complete statement: `totalPages: 2`, `last: false`, `numberOfElements: 10`, `totalElements: 15`. Task 5's page walk has real multi-page evidence to test against, and any test asserting this fixture is a final page asserts the opposite of what the bank sent.

| `transactionCode` | Direction | `transactionComment` | Counterparty |
|---|---|---|---|
| `MORISD` | Deposit | `TR fr 004-9999999999` | sender: bank `004`, account `9999999999` |
| `IORSDT` | Deposit | `025-9999999999~ Future Amount: 129 ~ Tran: IORSDT` | sender: bank `025`, account `9999999999` |
| `NBIDSD` | Deposit | `TR To NATID 0000000000000` | **none — that is the recipient, us** |
| `IORSWT` | Withdraw | `TR to 9999999999 aao 99999999999999999999~ Future Amount: 106 ~ Tran: IORSWT` | payee account `9999999999` |
| `IORSFE` | Withdraw | `Transaction Fee~ Future Amount: 5 ~ Tran: IORSFE`, or bare `Transaction Fee` | **none — a bank fee has no other party** |

Three things in that table are easy to get wrong and each is provable from the capture:

**The leading three digits are a BANK CODE, and it varies.** `004` is Kasikornbank; the capture also contains `025`. A parser written against the first example — matching `^004-`, or treating the digits as part of the account number — silently drops or corrupts every deposit from any other bank. Split on the first `-` and keep the two halves apart.

**`counterparty_bank` stores the raw code**, `004`, not a bank name. `bank_accounts.bank_code` and the transfer DTOs already carry raw codes as opaque strings and there is no code-to-name map anywhere in this service; introducing one here would be a second thing to maintain that the matcher does not need, and would stop the two columns from comparing directly.

**The `~ Future Amount: N ~ Tran: CODE` tail is an optional wrapper, not part of any grammar.** It appears on `IORSDT`, `IORSWT` and `IORSFE`, and the same `IORSFE` and `IORSWT` grammars also appear in the capture without it. Strip the tail first, then read the head — five independent regexes that each have to re-describe the tail will disagree about it eventually.

---

## An interface gap this plan must close

`account.Service.Transactions(ctx, alias, q)` reads `AccountRefID` from the **device**, not from a bank account:

```go
// internal/service/account/service.go:77
func (s *Service) Transactions(ctx context.Context, alias string, q TransactionsQuery) (json.RawMessage, error) {
	// ... uses d.AccountRefID, the device's own default account ...
}
```

The README states that one BizNext device can front several accounts of the same legal entity, and `bank_accounts.account_ref_id` holds each account's own id. So the existing method **cannot poll a specific pool account** — it polls whichever account the device last refreshed.

Task 4 adds `TransactionsFor(ctx, alias string, accountRefID string, q TransactionsQuery)`, leaving the existing method untouched for its existing callers.

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/000011_statement_lines.up.sql` / `.down.sql` | `bank_statement_lines` and its indexes |
| `internal/domain/statement/{entity,dto,errors,validator,repository,service}.go` | the statement domain |
| `internal/service/statement/parse.go` | `Fingerprint`, `Amount`, `Direction`, `OccurredAt` — one parser each |
| `internal/service/statement/counterparty.go` | the `transactionCode` grammar table |
| `internal/service/statement/testdata/transaction_history.json` | the captured fixture, moved here from the deposit package |
| `internal/adapter/persistence/model/statement.go`, `mapper/statement.go` | row struct and mappers |
| `internal/adapter/repository/statement/repository.go` | insert-if-new, list, and the poll-due query |
| `internal/service/statement/ingester.go` | the page walk |
| `internal/service/statement/producer.go` | the two-tier cadence |
| `internal/adapter/http/adminstatement/` | `GET /admin/statement-lines` |
| `bruno/Statement/*.bru` | one per endpoint |

`parse.go` and `counterparty.go` are separate because they change for different reasons: one changes if the bank alters a field, the other every time a new payment channel appears — and the second will change more often.

---

### Task 1: The statement schema and domain

**Files:**
- Create: `db/migrations/000011_statement_lines.up.sql`, `.down.sql`
- Create: `internal/domain/statement/{entity,dto,errors,validator,repository,service}.go`
- Test: `internal/domain/statement/validator_test.go`

**Interfaces:**
- Consumes: `bank_accounts(id)`.
- Produces: `statement.Line`, `statement.Direction`, `statement.MatchStatus` constants, `statement.Repository`, `statement.Service`, `ValidateLine`.

- [ ] **Step 1: Write the migration**

```sql
-- One row per movement the bank has reported on one corporate account.
--
-- This table is deliberately a record of what the bank SAID, not of what we
-- concluded. raw keeps its own JSON verbatim, and every derived column beside
-- it is something a parser read out of that JSON and could be wrong about.
CREATE TABLE bank_statement_lines (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
    fingerprint     TEXT NOT NULL,

    amount          NUMERIC(20,4) NOT NULL,
    direction       TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,

    transaction_code TEXT,
    counterparty_account TEXT,
    counterparty_bank    TEXT,

    raw             JSONB NOT NULL,

    match_status    TEXT NOT NULL DEFAULT 'UNMATCHED',
    matched_at      TIMESTAMPTZ,
    settled_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT statement_direction CHECK (direction IN ('CREDIT', 'DEBIT')),
    CONSTRAINT statement_match_status CHECK (
        match_status IN ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'SUSPENSE', 'IGNORED')),

    -- Amount is a MAGNITUDE; direction carries the sign, and the bank's own
    -- negative "withdraw" is stored positive. A zero movement is not a
    -- movement either. Enforcing this in the database and not only in
    -- ValidateLine means a manual fix script or a future write path that
    -- skips the validator still cannot persist a sign the entity forbids.
    CONSTRAINT statement_amount_positive CHECK (amount > 0),

    -- Amounts are held to satang. The bank reports 5.35; anything finer is a
    -- parser bug, and storing it would let a matcher compare values a
    -- customer could never have paid.
    CONSTRAINT statement_amount_satang CHECK (amount = ROUND(amount, 2))
);

-- The same row seen twice must be recognised as the same row. transactionIndex
-- is the bank's own identifier and is unique per account, not globally.
CREATE UNIQUE INDEX statement_lines_fingerprint
    ON bank_statement_lines (bank_account_id, fingerprint);

-- P3b-2's matcher reads exactly this shape: unmatched credits on one account,
-- oldest first.
CREATE INDEX statement_lines_unmatched
    ON bank_statement_lines (bank_account_id, occurred_at)
    WHERE match_status = 'UNMATCHED';

CREATE INDEX statement_lines_account_recent
    ON bank_statement_lines (bank_account_id, id DESC);
```

Down: `DROP TABLE IF EXISTS bank_statement_lines;`

- [ ] **Step 2: Apply it**

Run: `export PATH="$PATH:$HOME/go/bin" && make migrate-up`
Expected: `11/u statement_lines`. Do NOT run `make docker-up`.

- [ ] **Step 3: Write the entity**

```go
// Package statement is the record of what a bank said moved through a
// corporate account. It holds no opinion about what any movement meant --
// attributing a credit to a deposit is P3b-2's matcher, and it works from
// these rows rather than from the bank.
package statement

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Directions, matching the statement_direction CHECK.
const (
	// DirectionCredit is money arriving. The bank reports it by setting
	// "deposit" and leaving "withdraw" null.
	DirectionCredit = "CREDIT"
	// DirectionDebit is money leaving. The bank reports a NEGATIVE "withdraw".
	DirectionDebit = "DEBIT"
)

// Match statuses, matching the statement_match_status CHECK. Only UNMATCHED is
// reachable in P3b-1; the rest are P3b-2's, and they are admitted now so that
// adding the matcher does not require widening a CHECK.
const (
	StatusUnmatched = "UNMATCHED"
	StatusMatched   = "MATCHED"
	StatusAmbiguous = "AMBIGUOUS"
	StatusSuspense  = "SUSPENSE"
	StatusIgnored   = "IGNORED"
)

// Line is one movement, as the bank reported it.
//
// Amount is always positive; Direction carries the sign. Storing a negative
// debit would mean every consumer had to remember which fields could be
// negative, and the bank's own representation -- two nullable fields -- does
// not survive a single signed column anyway.
type Line struct {
	ID            uuid.UUID
	BankAccountID uuid.UUID
	Fingerprint   string

	Amount     decimal.Decimal
	Direction  string
	OccurredAt time.Time

	TransactionCode     string
	CounterpartyAccount string
	CounterpartyBank    string

	Raw []byte

	MatchStatus string
	MatchedAt   time.Time
	SettledAt   time.Time

	CreatedAt time.Time
}

func (l *Line) IsCredit() bool { return l.Direction == DirectionCredit }

// HasCounterparty reports whether the bank told us who sent this money. It
// often did not: a PromptPay credit names the recipient rather than the
// sender, and some rows carry no comment at all. A credit without a
// counterparty can still be matched by amount, which is what the deposit
// amount randomisation exists for.
func (l *Line) HasCounterparty() bool { return l.CounterpartyAccount != "" }
```

- [ ] **Step 4: Write the errors, DTOs, ports and validator, then their tests**

`errors.go` needs at least: `ErrNotFound`, `ErrUnparseableRow` (wrapping `errs.ErrUnavailable` — an unreadable bank response is an upstream problem, not a caller's), `ErrAmountPrecision`, `ErrUnknownDirection`.

`repository.go`:

```go
type Repository interface {
	// InsertIfNew writes the line and reports whether it was new. A row the
	// unique index refuses is not an error: the poller re-reads the same page
	// every cycle and expects to recognise most of it.
	InsertIfNew(ctx context.Context, l *Line) (inserted bool, err error)

	List(ctx context.Context, q ListQuery) ([]*Line, error)
}

// NOTE: an earlier draft declared LatestFingerprint here, on the theory that
// the ingester would use it to stop walking pages. It does not -- Task 5's
// walk stops when a page yields nothing new, and the spec grounds ingestion
// idempotency in the unique index rather than a high-water mark. Do not add
// it back without a caller.

// ListQuery is the admin read filter. Every field is optional; a zero value
// means "do not filter on this". Limit and Offset are clamped in the
// repository, never trusted from the caller.
type ListQuery struct {
	BankAccountID uuid.UUID
	MatchStatus   string
	Direction     string
	From, To      time.Time
	Limit, Offset int
}
```

`ValidateLine` checks what needs no database: a positive amount, at most two decimal places, a known direction, a non-empty fingerprint, and a non-zero `OccurredAt`. Write a table-driven test for each, and one that a valid line passes.

- [ ] **Step 5: Run and prove**

`go test ./internal/domain/statement/ -v`, then the layering check:

```bash
go list -deps ./internal/domain/statement | grep -E 'be-maxpay/internal/(adapter|service)' && echo "LAYERING VIOLATION" || echo "layering ok"
```

With `go test -overlay` on modified COPIES: delete the satang-precision check, and accept an unknown direction. Each must fail its own test.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/000011_statement_lines.up.sql db/migrations/000011_statement_lines.down.sql internal/domain/statement/
git commit -m "feat(statement): add the statement schema and domain"
```

---

### Task 2: The parsers, driven by the captured fixture

This is the task the whole phase turns on. Every field below was guessed wrong at least once before the capture existed.

**Files:**
- Create: `internal/service/statement/parse.go`
- Create: `internal/service/statement/counterparty.go`
- Already present: `internal/service/statement/testdata/transaction_history.json` (the redacted real capture, committed to this branch during setup — do NOT regenerate or edit it)
- Test: `internal/service/statement/parse_test.go`, `counterparty_test.go`

**Interfaces:**
- Produces:
  - `func ParsePage(raw json.RawMessage) (*Page, error)` with `type Page struct { Rows []json.RawMessage; Last bool; TotalPages, PageNumber int }`
  - `func ParseRow(raw json.RawMessage) (*statement.Line, error)`
  - `func Counterparty(transactionCode, comment string) (account, bank string)`

- [ ] **Step 1: Write the row parser**

The rules, each of which contradicts something the PRD implied:

```go
// ParseRow reads one statement row into a Line.
//
// Every field here was guessed wrong before a real response was captured, so
// each is read explicitly and none is inferred from another.
func ParseRow(raw json.RawMessage) (*statement.Line, error) {
	var row struct {
		TransactionIndex    string          `json:"transactionIndex"`
		TransactionDateTime string          `json:"transactionDateTime"`
		TransactionCode     string          `json:"transactionCode"`
		TransactionComment  string          `json:"transactionComment"`
		TransactionType     string          `json:"transactionType"`
		// Deposit and Withdraw are RawMessage, not decimal and not float64.
		// 5.35 has no exact binary representation, so the value must reach
		// decimal.NewFromString as the literal text the bank sent.
		Deposit  json.RawMessage `json:"deposit"`
		Withdraw json.RawMessage `json:"withdraw"`
	}
	// ... unmarshal, then:
	//
	// 1. Fingerprint is TransactionIndex. Empty is an error, never a
	//    composed fallback -- a row stored under a guessed key is either a
	//    duplicate credit or a missed one.
	//
	// 2. Direction comes from TransactionType ("Deposit"/"Withdraw"), and the
	//    amount from whichever of Deposit/Withdraw is populated. A debit
	//    arrives NEGATIVE and is stored as a positive magnitude with
	//    DirectionDebit. A row with both fields set, or neither, is an error.
	//
	// 3. OccurredAt parses RFC3339 with the offset the bank sends
	//    ("2026-08-28T12:05:27+07:00"). Do not force UTC on the way in and do
	//    not assume Bangkok -- store what was sent, converted.
}
```

- [ ] **Step 2: Write the counterparty grammar table**

```go
// Counterparty extracts the sender from a transaction comment.
//
// There is no counterparty FIELD in a KTB statement row. The sender, when
// present at all, is inside transactionComment, in a format that depends on
// the channel the customer paid through. FIVE grammars are known and there is
// no reason to believe that is all of them: two of them were found only
// because a second capture was taken after a real transfer, and a parser
// written against the first capture would have failed on them silently.
//
// An unrecognised code returns no counterparty rather than a guess. The row is
// still ingested; it simply cannot be attributed by sender, which is the same
// position a PromptPay credit is in by nature.
func Counterparty(transactionCode, comment string) (account, bank string) {
	// The "~ Future Amount: N ~ Tran: CODE" tail is a wrapper the bank adds to
	// several grammars and omits from the same grammars elsewhere. Strip it
	// once here so each case below describes only its own shape.
	head := strings.TrimSpace(stripFutureAmountTail(comment))

	switch transactionCode {
	case "MORISD":
		// "TR fr 004-9999999999" -- an inbound transfer. The sender.
		return splitBankAndAccount(strings.TrimPrefix(head, "TR fr "))

	case "IORSDT":
		// "025-9999999999" once the tail is stripped -- an inbound transfer
		// through a different channel. Also the sender.
		return splitBankAndAccount(head)

	case "IORSWT":
		// "TR to 9999999999 aao 99999999999999999999" -- one of OUR OWN
		// outbound transfers. The account is the payee, and it carries no bank
		// code. The trailing tokens are a memo and a reference whose grammar
		// the capture does not pin down, so read the account and stop rather
		// than guess at fields we have never seen unredacted.
		return firstToken(strings.TrimPrefix(head, "TR to ")), ""

	case "NBIDSD":
		// "TR To NATID 0000000000000" -- a PromptPay credit. The NATID is the
		// RECIPIENT, us. Returning it would attribute every PromptPay deposit
		// to ourselves and match them all against each other.
		return "", ""

	case "IORSFE":
		// "Transaction Fee" -- the bank charging us. There is no other party.
		return "", ""
	}

	return "", ""
}

// stripFutureAmountTail and firstToken are unexported helpers in this file,
// written as part of this task:
//
//   stripFutureAmountTail(s) cuts s at the first "~" and returns the head,
//   returning s unchanged when there is no "~". The tail is the optional
//   "~ Future Amount: N ~ Tran: CODE" wrapper.
//
//   firstToken(s) returns everything before the first space, or all of s when
//   there is none.

// splitBankAndAccount reads "004-9999999999" into its two halves.
//
// The leading digits are a Thai bank code and they VARY -- the capture holds
// both 004 (Kasikornbank) and 025. Anything that hardcodes one of them drops
// every deposit from the others.
func splitBankAndAccount(s string) (account, bank string) {
	bank, account, ok := strings.Cut(strings.TrimSpace(s), "-")
	if !ok {
		return "", ""
	}

	return strings.TrimSpace(account), strings.TrimSpace(bank)
}
```

- [ ] **Step 3: Write the tests, against the fixture**

Required, in full:

```text
TestParsePage_ReadsTheCapturedFixture          — row count matches pageable.numberOfElements (10); Last is FALSE and TotalPages is 2, because this capture is page 0 of 2
TestParseRow_ASatangAmountSurvives             — the 5.35 row parses to exactly 5.35, asserted with decimal.Equal
TestParseRow_AnAmountIsReadFromTheLiteralText  — a synthetic row carrying 99999999999999.99 parses to exactly that. This is the ONLY test in the package that can fail when the amount is routed through float64: shortest-round-trip formatting makes every ordinary amount survive that trip. Without it the "never float64" constraint is pinned by nothing, and a later simplification to decimal.NewFromFloat passes the whole suite.
TestParseRow_ADebitIsStoredAsAPositiveMagnitude — a -5 withdraw becomes 5 with DirectionDebit
TestParseRow_RefusesARowWithNoTransactionIndex — error, not a composed fingerprint
TestParseRow_RefusesARowWithBothAmountsSet     — the bank never does this; if it starts, we stop
TestParseRow_RefusesARowWithNeitherAmountSet
TestParseRow_KeepsTheOffsetTheBankSent
TestCounterparty_ReadsEachKnownGrammar         — one case per code, from the fixture's real comments
TestCounterparty_TheBankCodeIsNotHardcoded     — 004 AND 025 both parse, each keeping its own code
TestCounterparty_SplitsTheBankCodeFromTheAccount — "004-0611287194" -> bank "004", account "0611287194"
TestCounterparty_TheFutureAmountTailIsOptional — bare "Transaction Fee" and the tailed form agree
TestCounterparty_PromptPayYieldsNoSender       — NBIDSD must not return our own tax id
TestCounterparty_AFeeHasNoCounterparty         — IORSFE
TestCounterparty_AnOutboundTransferNamesThePayee — IORSWT, account only, no bank code
TestCounterparty_AnUnknownCodeYieldsNoGuess
TestCounterparty_AnEmptyCommentYieldsNoGuess
```

**The satang test is the one that matters most.** Write it so it fails if anyone ever routes the value through `float64`: assert with `decimal.Decimal.Equal` against `decimal.RequireFromString("5.35")`, not against a float.

- [ ] **Step 4: Prove the teeth**

With `go test -overlay` on modified COPIES:

| Mutation | Must fail |
|---|---|
| decode `deposit` into `float64` then `decimal.NewFromFloat` | the literal-text test (NOT the satang test — 5.35 survives that mutation) |
| take the amount from `Deposit` regardless of `TransactionType` | the debit test |
| return the NATID as the counterparty for `NBIDSD` | the PromptPay test |
| treat the whole `004-9999999999` as the account, with no split | the split test |
| hardcode the bank code to `"004"` instead of reading it | the not-hardcoded test |
| fall back to a composed fingerprint when `transactionIndex` is empty | the refusal test |

Report each. **A mutation that fails nothing is a finding about the tests.**

- [ ] **Step 5: Commit**

```bash
git add internal/service/statement/
git commit -m "feat(statement): parse bank statement rows against a captured response"
```

---

### Task 3: The statement repository

**Files:**
- Create: `internal/adapter/persistence/model/statement.go`, `internal/adapter/persistence/mapper/statement.go`
- Create: `internal/adapter/repository/statement/repository.go`
- Test: `internal/adapter/repository/statement/repository_test.go` (sqlmock), `repository_integration_test.go` (`//go:build integration`)

**Order by `occurred_at DESC, id DESC`, never by `occurred_at` alone.** The capture proves ties are ordinary, not exotic: a bank fee and the transfer it belongs to carry identical timestamps, and three of the fixture's ten rows are such pairs. PostgreSQL is free to return tied rows in any order, so a `LIMIT`/`OFFSET` page over an untied sort can show one row twice and never show another. `id` is a UUIDv7, so it is time-ordered and breaks the tie in the same direction as the sort.

**Interfaces:**
- Consumes: `statement.Line`, `statement.Repository`, `statement.StatusUnmatched` (Task 1); `repository/base` for timeouts and clamping.
- Produces: `statement.Repository` implementation via `NewRepository(db *sqlx.DB) *Repository`; `ListQuery{BankAccountID, MatchStatus, Direction, From, To, Limit, Offset}`.

**Write `match_status` explicitly**, as `statement.StatusUnmatched`, even though the column defaults to it. The default exists so a hand-written INSERT during an incident cannot produce a row with no status; the domain constant is what the code reads. Leaving the column to the default here would mean the one value P3b-2's matcher keys on is set in a place Go never names.

`InsertIfNew` is the whole task. The poller re-reads the same page every cycle, so **most inserts are expected to be refused**, and a refusal must be reported as `inserted == false` with a nil error — not as a failure. Match on SQLSTATE `23505` **and the constraint name** `statement_lines_fingerprint`, never on message text.

Integration tests, each beginning `pgtest.Truncate(t, db, "bank_statement_lines")`:

```text
InsertIfNew_ANewRowIsStoredAndReportedNew
InsertIfNew_TheSameFingerprintTwiceIsNotAnError   — second call: inserted=false, err=nil, one row in the table
InsertIfNew_TheSameFingerprintOnAnotherAccountIsNew — the index is per account, and the matcher depends on it
InsertIfNew_ARowWithThreeDecimalPlacesIsRefused    — statement_amount_satang, proving the CHECK is reachable
InsertIfNew_ANegativeAmountIsRefused               — statement_amount_positive; the entity stores debits as magnitudes
List_IsScopedToItsAccountAndNewestFirst
List_OrdersTiedTimestampsDeterministically         — insert two rows sharing one occurred_at, read them back repeatedly, and assert the order never varies
```

Prove the teeth: map every `23505` to "new", and drop the account from the fingerprint index's lookup. Each must fail its own test.

---

### Task 4: Fetching one specific account's statement

**Files:**
- Modify: `internal/domain/account/service.go` (the port), `internal/service/account/service.go`
- Test: `internal/service/account/service_test.go`

**Interfaces:**
- Consumes: `ktb.TransactionHistoryQuery{AccountRefID, PageSize, PageNumber}`, `device.ErrAccountRefIDMissing`.
- Produces: `TransactionsFor(ctx, alias, accountRefID string, q TransactionsQuery) (json.RawMessage, error)`.

- [ ] **Step 1: Write the failing test**

The one behaviour worth pinning is that the SUPPLIED ref id reaches the bank, not the device's. Seed the device with a ref id that differs from the one passed in, and assert on which one arrived.

**Use the harness that already exists in `internal/service/account/service_test.go`** — `newSvc(t, dev)` (four return values, the third being the fake accounts client, which records the last query in `lastTxQ`) and `readyDevice()` (ref id `"acct-1"`). Name the tests `TestAccountService_TransactionsFor_*`, matching the file. The illustrative code below predates a reading of that file and invents helpers (`newTestService`, `fakeAccounts`, `deviceWithRefID`) that do not exist; it is here for the assertions it makes, not the names it uses.

```go
func TestTransactionsFor_SendsTheSuppliedAccountRefID(t *testing.T) {
	// The device's own ref id and the account being polled are deliberately
	// different: that difference is the entire point of this method.
	const deviceRef, wantRef = "device-owns-this", "poll-this-one"

	fake := &fakeAccounts{}
	svc := newTestService(t, fake, deviceWithRefID(deviceRef))

	_, err := svc.TransactionsFor(context.Background(), "Dev1", wantRef,
		domainaccount.TransactionsQuery{PageSize: "40", PageNumber: "0"})

	require.NoError(t, err)
	require.Equal(t, wantRef, fake.lastQuery.AccountRefID)
}

func TestTransactionsFor_RejectsAnEmptyAccountRefID(t *testing.T) {
	fake := &fakeAccounts{}
	svc := newTestService(t, fake, deviceWithRefID("device-owns-this"))

	_, err := svc.TransactionsFor(context.Background(), "Dev1", "",
		domainaccount.TransactionsQuery{})

	// Falling back to the device's ref id here would silently poll the wrong
	// account and file its credits against this one.
	require.ErrorIs(t, err, device.ErrAccountRefIDMissing)
	require.Nil(t, fake.lastQuery)
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$PATH:$HOME/go/bin" && go test ./internal/service/account/ -run TransactionsFor -v`
Expected: FAIL — `svc.TransactionsFor undefined`.

- [ ] **Step 3: Add the port method**

In `internal/domain/account/service.go`, beside the existing `Transactions`:

```go
	// TransactionsFor fetches one account's statement by its own accountRefId.
	//
	// Transactions(alias) reads the ref id off the DEVICE, which is whichever
	// account that device last refreshed. One BizNext device can front several
	// accounts of the same legal entity, so polling a specific pool account
	// needs the account's own id -- bank_accounts.account_ref_id -- passed
	// explicitly. Statement ingestion is the only caller that needs this.
	TransactionsFor(ctx context.Context, alias, accountRefID string, q TransactionsQuery) (json.RawMessage, error)
```

- [ ] **Step 4: Implement it**

In `internal/service/account/service.go`, directly below `Transactions`, which stays exactly as it is — it has existing callers and its behaviour is right for them:

```go
func (s *Service) TransactionsFor(ctx context.Context, alias, accountRefID string, q domainaccount.TransactionsQuery) (json.RawMessage, error) {
	// Checked before relay so an empty id costs no session and no bank call.
	if accountRefID == "" {
		return nil, device.ErrAccountRefIDMissing
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.accounts.TransactionHistory(ctx, creds(d), ktb.TransactionHistoryQuery{
			AccountRefID: accountRefID,
			PageSize:     q.PageSize,
			PageNumber:   q.PageNumber,
		})
	})
}
```

Note what is deliberately absent: no `d.AccountRefID` fallback. The device's ref id is a different account, and quietly substituting it would file one account's credits against another.

- [ ] **Step 5: Run the tests**

Run: `go test ./internal/service/account/ -v` — the new tests pass and every existing `Transactions` test still does.

- [ ] **Step 6: Prove the teeth**

With `go test -overlay` on a modified COPY, change the implementation to use `d.AccountRefID` instead of the parameter. `TestTransactionsFor_SendsTheSuppliedAccountRefID` MUST fail — that mutation is exactly the bug this method exists to prevent, and a test that survives it is testing nothing. Then delete the empty-id guard and confirm the second test fails.

- [ ] **Step 7: Commit**

```bash
git add internal/domain/account/service.go internal/service/account/
git commit -m "feat(account): fetch a statement by explicit account ref id"
```

---

### Task 5: The ingester

**Files:**
- Create: `internal/service/statement/ingester.go`
- Test: `internal/service/statement/ingester_test.go`

**Interfaces:**
- Consumes: `ParsePage`, `ParseRow` (Task 2); `statement.Repository.InsertIfNew` (Task 3); `account.Service.TransactionsFor` (Task 4); `bankaccount.Account` for `ID` and `AccountRefID`.

**Two fields `ParseRow` cannot fill, and this task owns:** `BankAccountID` (the parser sees one row of JSON and has no idea which account it came from) and `MatchStatus` (set to `statement.StatusUnmatched`). Set both before calling `InsertIfNew`. A row inserted with a zero `BankAccountID` would violate the foreign key, so this is a compile-and-run failure rather than a silent one — but the ownership is worth naming, because the alternative is each of the two tasks assuming the other did it.
- Produces:

```go
// devices resolves the account's DeviceID to the device Alias that
// TransactionsFor is addressed by: bankaccount.Account carries DeviceID but no
// Alias, and BalanceRefresher resolves it the same way (balance.go:234).
func NewIngester(accounts domainaccount.Service, devices device.Repository, repo statement.Repository, cfg *shared.Config, logger *zap.Logger) *Ingester

// IngestAccount walks one account's statement newest-first and stores what it
// has not seen. stored counts rows written; failed counts rows the parsers
// refused, which are logged and skipped rather than aborting the page.
func (i *Ingester) IngestAccount(ctx context.Context, acct *bankaccount.Account) (stored, failed int, err error)
```

The walk:

1. Read page 0.
2. Parse each row; `InsertIfNew` each one.
3. If every row on the page was already known **and** `pageable.last` is false, stop anyway — the newest page holding nothing new means nothing newer exists, because the bank returns newest-first.

   **A row that failed to parse is not a row that was already known.** Stop only when `newOnPage == 0 && failedOnPage == 0`. The inference in rule 3 is "we read these rows and recognised them all, so nothing newer exists" — and it does not hold for rows nobody could read. A page of unparseable rows would otherwise end the walk while reporting success, which is exactly how a bank-side format change becomes silent data loss. Walking on costs at most `max_pages` fetches, which is already capped.
4. Otherwise continue to the next page until `pageable.last` is true or a page yields nothing new.
5. Cap the walk at `statement.max_pages` (default 5) so a first run against a long history cannot become an unbounded loop against the bank.

**`IngestAccount` returns a hard error when the device cannot be resolved** — that is the right contract for a call about one account. Note the divergence from `BalanceRefresher`, which logs a Warn and continues past the same condition (`balance.go:233-239`): it is iterating accounts, and this is not. Task 6 is the iterating layer and must restore the log-and-continue behaviour there, or one account with a dangling device FK aborts the poll cycle for every other account.

**An account with no `account_ref_id` is skipped with a warning, not an error** — the same rule P2b applied to balance refresh, for the same reason: there is nothing to ask the bank about.

**One unparseable row must not abandon the page.** Log it at Error with its raw JSON, count it, and carry on — one malformed row costing us every other row on the page would turn a bank-side oddity into a total outage. Return the count of stored rows and the count of failures separately.

Tests with a fake bank client and a fake repository: a first run stores everything; a second run stores nothing and makes one page request; a page of entirely-known rows stops the walk; an unparseable row is counted and skipped while its siblings are stored; an account with no ref id is skipped without calling the bank.

Prove: make an unparseable row abort the page, and remove the stop-on-nothing-new condition. Each must fail its own test.

---

### Task 6: The two-tier cadence

**Files:**
- Create: `internal/service/statement/producer.go`
- Modify: `internal/shared/config.go`
- Test: `internal/service/statement/producer_test.go`

**Two repository queries do not exist yet, and this task adds them.** `bankaccount.Repository` has `ListForBalanceRefresh`, `InboundCandidates` and `OutboundCandidates`, and none of them fits: the candidate queries exist to ROUTE a deposit to an account and filter by merchant and daily caps, which is a different question from "which accounts should we poll". Add both to the port, the repository, and their sqlmock and integration tests:

```go
// ListForStatementPoll returns every ACTIVE INBOUND account that has a bank
// ref id, for the floor tier.
ListForStatementPoll(ctx context.Context) ([]*Account, error)

// ListWithPendingDeposits returns the subset of those that currently have at
// least one PENDING deposit, for the active tier.
ListWithPendingDeposits(ctx context.Context) ([]*Account, error)
```

Both filter `tier = 'INBOUND' AND status = 'ACTIVE'` and exclude an empty `account_ref_id` — an account with no ref id has nothing to ask the bank about, and the ingester would skip it anyway, so excluding it in SQL saves a wasted job rather than changing behaviour. The second adds `EXISTS (SELECT 1 FROM deposits d WHERE d.bank_account_id = bank_accounts.id AND d.status = 'PENDING')`.

**VAULT and OUTBOUND accounts are deliberately not polled in P3b-1.** The capture proves they would have statement activity worth seeing — the fixture holds outbound transfers and bank fees — but this phase exists to make arriving money visible, and reconciling outbound movement is its own problem with its own matching rules. Recording the decision so it reads as a boundary rather than an oversight.

**Interfaces:**
- Consumes: `Ingester.IngestAccount` (Task 5), called **directly**, not through an outbox job — see below.
- Produces: the two repository queries above, plus the producer and its lifecycle registration.
- Produces: `NewStatementProducer(...) *StatementProducer` with `Run(ctx)`, and `RegisterStatementProducerLifecycle(life fx.Lifecycle, p *StatementProducer, logger *zap.Logger)`.

**Per account, log and continue — never let one account's failure end the cycle.** `IngestAccount` returns a hard error when a device cannot be resolved, which is correct for a single-account call and wrong for a loop. This producer is the loop: catch each account's error, log it with the account id, and carry on to the next. A single dangling device FK must not stop every other account's statement from being ingested. Pin it with a test where one account of three fails and the other two are still ingested.

**No outbox job kind. The producer calls `IngestAccount` directly.** An earlier draft of this plan called for one, by analogy with `BalanceProducer`. That was wrong, and the measurements are the argument:

- The outbox is a **shared serial queue** — `Worker.Tick` claims a batch and runs it one job at a time, and `KindRefreshAccountBalance` and `KindExpireDeposits` drain from the same worker. Periodic work placed there degrades the work that genuinely needs exactly-once delivery. This is the decisive point.
- The arithmetic does not close. Enqueuing a poll per account produces `N/10 + N/180` jobs per second, so stability needs `N*L <= 9` for a walk of length `L`. A one-second walk would cap the whole gateway near nine pollable accounts, past which the queue grows without bound — and every job in that backlog repeats an identical idempotent walk whose value is already zero by the time it runs.
- The outbox's failure semantics are wrong here. Exponential backoff and burying at `max_attempts` suit a payout; the right retry for a missed poll is the next tick, and "buried" is meaningless for work that recurs in ten seconds.
- Crash-safety, the outbox's real benefit, buys nothing: the loop polls immediately on start, so a restart re-polls within milliseconds and the bank still holds the same rows.
- A synchronous loop behind a Go ticker is self-limiting for free — the channel holds one tick, so an overrunning pass delays the next instead of stacking. The outbox would convert that natural back-pressure into unbounded queue growth.

`BalanceProducer` is not the same problem: it serialises a cheap DB read into a small payload so the bank call lands in the worker, once per account per 60s, bounded by `balance_max_age` and a `LIMIT`ed batch. Statement polling runs six times that cadence with no cap, and `IngestAccount` takes the whole `*bankaccount.Account` the producer already holds, so a payload would add a serialisation step and buy nothing.

**Stagger the floor tier's first poll.** Both tiers polling immediately means every account with a pending deposit is walked twice concurrently on **every process start** — guaranteed, not probabilistic. And 3m is exactly 18 x 10s, so thereafter a floor tick lands on an active tick systematically rather than by chance. The collision is safe — `InsertIfNew` runs outside a transaction and turns a unique violation into `(false, nil)`, so the loser pays one rejected INSERT and no aborted-transaction penalty — but it spends up to `max_pages` extra bank round-trips per collided account, which is the exact resource `polling_enabled` exists to protect. Let the active tier poll immediately and give the floor tier an offset before its first poll: the accounts a merchant is waiting on are the ones that need promptness after a restart, and a three-minute sweep can wait.

**Copy `bankaccount.BalanceProducer`'s shape**, including its lifecycle registration and its `done` channel — it is the house pattern for exactly this, it already solved the shutdown ordering, and its `RegisterBalanceProducerLifecycle` comment explains why the producer must be cancelled before the outbox worker drains.

Two tiers, as spec §6 requires:

| Tier | Interval | Covers |
|---|---|---|
| Active | `statement.poll_interval_active` (10s) | accounts with at least one `PENDING` deposit |
| Floor | `statement.poll_interval_floor` (3m) | every `ACTIVE` INBOUND account, always |

**The floor tier is not a fallback and its comment must say so.** It is the only thing that discovers money nobody asked for — an overpayment, a customer paying an expired QR, a transfer nobody announced. Without it those never enter the books at all.

Gate the whole producer behind `statement.polling_enabled`, defaulting **false**, exactly as `pool.balance_refresh_enabled` is. Every tick is a live call to KTB per account, and a corporate login that hammers the channel risks being blocked — which would take deposits down with it.

Register the handler; schedule nothing beyond what the flag allows. Say in the code that the default-off is deliberate.

---

### Task 7: `GET /admin/statement-lines`

**Files:**
- Create: `internal/service/statement/service.go` — the implementation of the `statement.Service` port
- Create: `internal/adapter/http/adminstatement/{handler,dto,routes}.go`
- Create: `bruno/Statement/List statement lines.bru`
- Test: `internal/service/statement/service_test.go`, `internal/adapter/http/adminstatement/handler_test.go`

**Interfaces:**
- Consumes: the `statement.Service` port and `ListQuery` (Task 1); `statement.Repository.List` (Task 3); the admin session middleware and role checks used by `adminledger`.
- Produces: `NewService(repo statement.Repository) *Service` satisfying `statement.Service`; `RegisterRoutes(r *gin.RouterGroup, ...)` following `adminledger`'s registration shape.

**The handler depends on `statement.Service`, never on the repository.** AGENTS.md line 44 — "HTTP handlers only bind, validate, map, call a service, and respond" — and both `adminledger.Handler` and `adminpool.Handler` take a `domain*.Service`. `List` is a pass-through today because there is no business rule to apply on top of reading back what the bank already told us; P3b-2 is where the write side (attributing a row, resolving one by hand) arrives, and it arrives on this interface.

Platform administrators and resellers may read; filters on account, status, direction and a date range; paged newest-first with limit and offset **clamped in the repository**.

**Authorization, stated precisely, because the spec's one-liner does not survive contact with the schema.** `bank_accounts.merchant_id` is NULLABLE, and `000006_bank_accounts.up.sql:44` carries `CHECK (cluster_id IS NULL OR merchant_id IS NULL)` — an account belongs to a cluster, or to a merchant, or to neither. So "a reseller sees rows on accounts serving its own subtree" is undefined for most of the pool. Resolve it fail-closed:

- **Platform admin**: may list with any filters, including no account filter at all.
- **Reseller admin**: MUST supply `bank_account_id`. The handler loads that account and refuses unless `MerchantID` is non-nil AND `adminmerchant.EnsureVisible` passes for it. A cluster-owned or unowned account is refused — a reseller has no claim on a shared pool account's movements.

**A reseller omitting the filter is refused, not silently widened.** That is the whole hazard: `internal/adapter/http/adminledger/handlers.go:59-67` records that a previous security review of this codebase found this exact shape of bug three times, "including a handler that called its scoping helper and then discarded the result". Check the role first and on its own, and let the refusal path return before the service is ever reached.

**Refuse before loading.** A reseller naming an account that does not exist must get the same `403` as one naming a real account it may not see. Loading the account first and relaying `ErrAccountNotFound` as a `404` tells an unauthorized caller which ids are real. This is the codebase's existing convention rather than a new rule: `adminmerchant.get` runs `EnsureVisible` **before** `GetByID`, so a reseller naming a nonexistent merchant gets `403` and never `404`, and `adminpool.getAccount` is platform-admin-only so a reseller cannot reach it at all. Amounts render as strings via `StringFixed(2)`. The `raw` column is **not** exposed: it contains the bank's own response, and a merchant-facing surface has no business relaying it.

Write one authorization test per rule, each asserting the service was never called on a refusal.

---

### Task 8: Wire it up and prove it against the real bank

**Files:**
- Modify: `internal/adapter/repository/module.go`, `internal/service/module.go`, `internal/adapter/http/module.go` — this codebase registers fx providers in ONE module file per layer, not one per package. Add `fx.Annotate(statementrepo.NewRepository, fx.As(new(statement.Repository)))` beside the ten already there, and follow the same shape in the other two.
- Modify: `internal/shared/config.go`, `config.yaml`, `config.yaml.example`, `README.md`, `AGENTS.md`

**Do not create `internal/adapter/repository/statement/module.go`** or its siblings. An earlier draft of this plan called for per-package module files; there are none in this repository, and adding them would leave the registration split across two conventions.

**Interfaces:**
- Consumes: every constructor produced by Tasks 1-7.
- Produces: an `fx` graph in which `Ingester`, `StatementProducer`, the repository and the admin routes all resolve.


```yaml
statement:
  poll_interval_active: 10s
  poll_interval_floor: 3m
  max_pages: 5
  polling_enabled: false
```

**Register the statement producer's `fx.Invoke` beside `RegisterBalanceProducerLifecycle` in `internal/service/outbox/module.go`, NOT in `internal/service/module.go`.** The producer must be registered AFTER the outbox worker so fx's reverse `OnStop` cancels it first — its own comment says so. But `service.Module` is registered FIRST in `internal/app/module.go`, so an `fx.Invoke` placed there would stop the producer LAST, after `shared.Module` has closed the database pool. That is the exact failure P2a's Task 10 hit. `RegisterBalanceProducerLifecycle` lives in `internal/service/outbox/module.go` after `fx.Invoke(RegisterWorkerLifecycle)` for precisely this reason.

**Do not change the module ordering in `internal/app/module.go`.** Its comment explains why registering database → worker → HTTP is load-bearing.

**Verify the wiring against a RUNNING application**, not `routes_test.go`, which registers packages by hand and structurally cannot catch a route missing from the fx graph.

Then the proof that matters: with `polling_enabled` **temporarily** true, run one ingestion pass against the real KTB account and confirm the rows in the database match the rows the bank returned — including the 5.35 credit, stored as exactly 5.35. Paste the verbatim output and this query:

```sql
SELECT fingerprint, direction, amount, occurred_at, transaction_code,
       counterparty_bank, counterparty_account
FROM bank_statement_lines ORDER BY occurred_at DESC LIMIT 5;
```

Run the pass **twice** and confirm the second stores zero rows. That is the idempotency the unique index promises, and it is the difference between a poller and a duplicate-credit generator.

Set `polling_enabled` back to `false` when finished.

---

## Self-Review

**Spec coverage.** §4.2 → Task 1. §6's fingerprint, parsers, counterparty grammars and cadence → Tasks 2, 5 and 6. §10's `GET /admin/statement-lines` → Task 7; the `attribute` endpoint is P3b-2's, since it exists to resolve a matcher outcome. §13's ingestion-idempotency requirement → Task 3's integration tests and Task 8's double run.

Not covered, deliberately and named in the header: the matcher, ledger postings, webhooks, and manual attribution.

**Placeholder scan.** Tasks 1, 2 and 4 carry their schema, their parser contracts and their new method in full — the first two because they are where the captured evidence lives and where a guess would do the most damage, the third because its whole reason for existing is one parameter that must not be silently substituted. Tasks 3, 5, 6, 7 and 8 name each required test with its concrete assertion and give the rules verbatim, but not every test body — they follow shapes already in the tree (`repository/deposit`, `service/deposit`, `adminledger`), and those are better models than a transcription.

**Type consistency.** `statement.Line`, `Direction`, `MatchStatus`, `Repository` and `Service` are defined in Task 1 and used with those names throughout. `ParseRow` returns `*statement.Line` at its definition and at its call site in Task 5. `InsertIfNew` returns `(bool, error)` in the port, the implementation and the ingester.

**One thing this plan cannot prove.** Only five `transactionCode` grammars are known, from two captures of one account, and only two sending banks appear among them. Every channel a real merchant's customers use will surface first as unattributed credits. Task 7's status filter is what makes them findable, and the spec's follow-on work names grouping suspense rows by `transactionCode` as the way to find the next grammar worth adding.
