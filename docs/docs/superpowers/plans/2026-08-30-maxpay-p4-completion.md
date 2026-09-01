# P4 Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish P4 — make payouts leave the platform through the bulk lane,
settle from the bank's own record, and close the two lane defects the live
testing on 2026-08-30 exposed.

**Architecture:** Payouts batch into a KTB bulk order rather than one transfer
per payout. A batcher claims PENDING payouts on a timer with a count cap and
writes a `payout_batches` row; a sender drives the existing bulk service and
records the bank's `packageRefNo` before anything settles; a reconciler reads
the bank's per-item status back and settles each payout independently. The
single-payout send path is removed — one lane, not two.

**Tech Stack:** Go 1.25 · Gin · fx · sqlx + squirrel · PostgreSQL 18 · Zap ·
shopspring/decimal · testify

**Spec:** Phases 1 and 2 need none — they are bounded fixes whose design is
settled by measurement, recorded in `docs/context/p4b-residuals.md`.
**Phase 3 must not start until its spec exists** (see the note at the head of
Phase 3).

## Global Constraints

- Money is `decimal.Decimal`. Never `float64`. No exceptions.
- Never truncate, drop, or `UPDATE` anything in the `maxpay` development
  database. It holds a bank device registered against a live corporate login
  that cannot be recreated without sending the account holder another OTP.
- Never run `make migrate-up` / `migrate-down` / `migrate-reset` without an
  explicit `DATABASE_URL`. Never run `make docker-up`.
- `export PATH="$PATH:$HOME/go/bin"` before any `make check` — without it
  `golangci-lint` is silently absent and the gate reports green while failing.
- Both gates must pass: `make check` and `make test-integration`. The
  integration suite needs `-p 1`; the payout packages truncate shared tables.
- Never log or print the PIN, API key, secret key, or any merchant credential.
- `logs/ktb-wire.jsonl` and `_local/` hold real names, balances and account
  numbers. They are gitignored and must never be copied into tracked docs.
- Never enable `payout.send_enabled`, `statement.polling_enabled`,
  `matching_enabled`, or any sweep loop as part of a task. Config switches are
  the operator's, not the implementer's.
- No webhook is ever sent anywhere real.

---

## Decisions locked on 2026-08-30

These were open and are now answered. They are requirements, not suggestions.

| Question | Answer |
|---|---|
| Who pays the 5 THB interbank fee? | **The platform.** The merchant's reservation is the payout amount alone; the fee is a platform expense posted from the bank's own per-item quote. |
| When do payouts batch? | **On a timer with a count cap** — whichever comes first. |
| Is there still a single-payout send path? | **No.** Everything goes through bulk. |

Measured facts the plan depends on, all from live calls on 2026-08-30:

- `/submission` refuses every order on this account; `/confirmation` commits
  it. Same-bank refusals carry code `80000`, interbank refusals `20000`.
- The fee is **per item and route-dependent**: `TRANSFER_3_PARTY` quotes
  `0.00`, `TRANSFER_OTHER_BANK` quotes `5.00`. Batching saves nothing.
- `packageRefNo` on the bulk summary equals `instructionRefNo` in the
  instruction lists. It is the key that joins a batch to the bank's record.
- A bulk item's `isCompleted` is `true` at submission time, before the money
  moves. It must never be used as a settlement signal.
- `GET /accounts/cashflow` serves a stale balance. Only
  `GET /accounts/overview` may inform a money decision.

---

## Phase 1 — Unblock the interbank route

### Task 1: Widen the commit gate to the codes the bank actually uses

**Files:**
- Modify: `internal/service/transfer/commit.go`
- Modify: `internal/service/transfer/service.go` (the fallback's log line)
- Modify: `internal/service/transfer/bulk.go` (the fallback's log line)
- Test: `internal/service/transfer/commit_test.go`
- Test: `internal/service/transfer/bulk_test.go`

**Interfaces:**
- Consumes: `errs.UpstreamError` with `Status int` and `Code string`.
- Produces: `isBankRefusal(err error) bool` — unchanged signature, widened
  behaviour; and `logUnknownCommitRefusal`, called by both lanes.

**Why:** the committed gate admits only `80000`, which is the same-bank
route's refusal code. Every interbank payout fails today. The gate stays an
allow-list rather than "any 400" because the two endpoints demonstrably do
not validate the same things — `/submission` refuses this account and
`/confirmation` does not — and nobody knows what else `/submission` checks.
Falling back on an unrecognised 400 would skip those checks blind. A payout
that fails is recoverable; one that pays twice or skips a bank limit is not.

- [ ] **Step 1: Write the failing tests**

Add to the table in `TestTransfer_AnAmbiguousSubmissionFailureNeverFallsBack`
and its bulk twin — these must keep passing unchanged, they are the guard:

```go
{"a 400 on the merits will be refused again", errs.NewUpstreamError(
    http.StatusBadRequest, "E1234", "insufficient balance", nil)},
```

And add the new positive case to `commit_test.go`:

```go
func TestTransfer_TheInterbankRefusalCodeAlsoFallsBack(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.transfers.confirmErr = errs.NewUpstreamError(
		http.StatusBadRequest, "20000", "กรุณาลองใหม่อีกครั้ง", nil)

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	}, domaintransfer.Hooks{})

	require.NoError(t, err, "the interbank route's refusal code must commit via /confirmation")
	assert.Equal(t, 1, h.transfers.commitCalls)
}
```

- [ ] **Step 2: Run them and watch the new one fail**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/service/transfer/... -run TheInterbankRefusalCode -v
```

Expected: FAIL — `20000` is not in the allow-list, so `Transfer` returns the
upstream error instead of committing.

- [ ] **Step 3: Replace the constant with the map**

In `commit.go`, replace `wrongCommitEndpointCode` with:

```go
// commitRefusalCodes are the codes this account's /submission returns when it
// refuses an order it did not act on, mapped to the route that produces each.
// Both were measured live on 2026-08-30 with the balance unchanged before and
// after, and both commit successfully via /confirmation.
//
// This is an allow-list rather than "any 400" on purpose. The two endpoints do
// not validate the same things -- /submission refuses this account outright
// and /confirmation does not -- and what else /submission checks is unknown.
// Falling back on an unrecognised 400 would skip those checks blind. A new
// route that returns a third code fails closed and is reported by
// logUnknownCommitRefusal; that is one broken run and a one-line fix, against
// a double payment or a bypassed bank limit, which are neither.
var commitRefusalCodes = map[string]string{
	"80000": "same-bank route",
	"20000": "interbank route",
}

func isBankRefusal(err error) bool {
	var upstream *errs.UpstreamError
	if !errors.As(err, &upstream) {
		return false
	}
	if upstream.Status != 400 {
		return false
	}
	_, ok := commitRefusalCodes[upstream.Code]
	return ok
}

// logUnknownCommitRefusal reports a 400 at commit whose code is not in
// commitRefusalCodes. It is how a new route's refusal code is discovered on
// its first failure rather than after a week of silently failing payouts.
func logUnknownCommitRefusal(logger *zap.Logger, orderID string, err error) {
	var upstream *errs.UpstreamError
	if !errors.As(err, &upstream) || upstream.Status != 400 {
		return
	}
	if _, known := commitRefusalCodes[upstream.Code]; known {
		return
	}
	logger.Error("unknown 400 code at commit -- a new route may need this code in commitRefusalCodes",
		zap.String("order_id", orderID),
		zap.String("upstream_code", upstream.Code),
		zap.String("upstream_message", upstream.Message),
	)
}
```

- [ ] **Step 4: Call the reporter from both lanes**

In `service.go` and `bulk.go`, inside each `if !isBankRefusal(err)` branch,
call `logUnknownCommitRefusal` before returning the error.

- [ ] **Step 5: Run the package**

```bash
go test ./internal/service/transfer/...
```

Expected: PASS, including every ambiguous-failure case.

- [ ] **Step 6: Mutation-test the gate**

Build modified copies of `commit.go` and run them through `go test -overlay`.
**Run a sanity mutant first** — `-overlay` fails open, and a `[build failed]`
is not a kill. Mutations that must all die:

| Mutation | Must be killed by |
|---|---|
| always return `true` | every ambiguous-failure case |
| always return `false` | both fallback cases |
| drop the `Status != 400` check | the 5xx-carrying-a-refusal-code case |
| drop the map lookup | the business-code case |
| accept any 4xx | the 401 case |

- [ ] **Step 7: Both gates, then commit**

```bash
export PATH="$PATH:$HOME/go/bin"
make check && make test-integration
git add -A && git commit -m "fix: accept the interbank route's refusal code at commit"
```

---

## Phase 2 — Close the bulk lane's token-expiry hole

### Task 2: Suppress the whole-closure retry once a bulk order exists

**Files:**
- Modify: `internal/service/transfer/bulk.go`
- Test: `internal/service/transfer/bulk_test.go`

**Interfaces:**
- Consumes: `noRetryAfterOrder(err error) error` and
  `session.IsTokenExpired(err error) bool`, both already used by
  `runTransfer`.
- Produces: nothing new.

**Why:** `runBulk` creates a bulk order and then submits and confirms it with
none of the protection `runTransfer` gained in P4b. A token expiry part-way
through re-runs the whole closure through `session.Do` and creates a **second
bulk order**. It is not a double payment today only because the abandoned
order is never confirmed. Phase 3 makes bulk the payout lane, which turns this
from an unused path's defect into the payout path's defect. It must close
before `payout.send_enabled` is ever turned on.

- [ ] **Step 1: Write the failing test**

Mirror `TestTransfer_TokenExpiryAfterTheOrderExistsIsNotRetried` for bulk: a
harness whose session retries, a fake that returns a token-expiry error from
`SubmitBulk`, and an assertion that `CreateBulkOrder` was called exactly once.

```go
func TestBulk_TokenExpiryAfterTheOrderExistsIsNotRetried(t *testing.T) {
	h := newRetryingHarness(t, readyDevice())
	h.bulk.submitErr = errs.NewUpstreamError(http.StatusUnauthorized, "", "token expired", nil)

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.Error(t, err)

	assert.Equal(t, 1, h.bulk.createCalls,
		"a second bulk order after an expiry is a second batch of payments")
}
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL with `createCalls == 2` — the closure re-ran.

- [ ] **Step 3: Apply the same guard `runTransfer` uses**

Wrap `runBulk`'s error return in `noRetryAfterOrder` from the point the bulk
order id exists, exactly as `runTransfer` does at
`internal/service/transfer/service.go:188`.

- [ ] **Step 4: Run it and watch it pass, then run the package**

- [ ] **Step 5: Update the doc comment on `session.IsTokenExpired`**

It names `runTransfer` specifically. Add `runBulk` so nobody reads it as
covering only one lane.

- [ ] **Step 6: Both gates, then commit**

---

## Phase 3 — P4c: payouts through the bulk lane

> **This phase needs a spec before any task is dispatched.** The tasks below
> are the shape the work takes given the decisions locked above; they are not
> yet bite-sized and they do not contain the code. Run
> superpowers:brainstorming to produce
> `docs/superpowers/specs/YYYY-MM-DD-maxpay-p4c-payout-settlement-design.md`,
> then rewrite this phase from it with superpowers:writing-plans. Dispatching
> from the sketch below would produce exactly the guesswork this process
> exists to prevent.

### Task 3: Find a stable status code — research, and a genuine blocker

Everything downstream settles on the bank's per-item status, and the only
status we have is `bulkItemStatus`, a **Thai display string** that read
`ส่งเพื่อดำเนินการเรียบร้อย` at submission and `รายการสำเร็จ` forty minutes
later. Matching on that text breaks the day the bank rewords it, and it
breaks silently, in the direction of settling a payout that did not complete.

Read `GET /v1/instructions/{refNo}/activity-log` and the per-item detail
endpoint for a coded field. If one exists, it is the settlement signal. If
none exists, that is itself the finding and the spec must say how settlement
survives without one — most likely by requiring a matching statement DEBIT
before any release, which the agreed evidence table already allows for.

**Nothing in Phase 3 can be specified until this is answered.**

### Task 4: `payout_batches` and the columns that join a payout to the bank

A migration adding `payout_batches` (batch id, device alias, the bank's bulk
order id, `package_ref_no`, status, item count, totals, timestamps) and two
columns on `payouts` — the owning batch, and the bank's `bulkItemId`.

The discipline P4b established carries over unchanged: **the bank's id is
recorded before the call that can move money**, so a process that dies
mid-sequence can still ask the bank about that specific order.

### Task 5: The batcher

A ticker that claims PENDING payouts for one source account and opens a batch
when either the age of the oldest claimed payout crosses the window or the
count reaches the cap. Both come from config; neither has a default that
sends anything, and the loop stays gated on `payout.send_enabled`.

Claiming reuses P4a's guarded-update discipline so two batchers cannot claim
the same payout.

### Task 6: The sender

Builds the recipient list from the batch and drives the existing bulk service
— which, after Phases 1 and 2, commits correctly and does not double-create.
Records the bank's bulk order id before committing, then `packageRefNo` and
each `bulkItemId` after.

**The fee is captured here, per item, from the bank's own quote** — the
`/service` response carries `payerTransactionFee` per recipient. It is stored
on the payout row as the bank's charge and posted as a **platform expense**,
never against the merchant's reservation. The merchant reserved the payout
amount and nothing more.

### Task 7: The reconciler

For each sent batch, reads the bank's per-item status back and settles each
payout independently — one item failing does not hold up its siblings. It
applies the evidence table already agreed in
`docs/context/roadmap-after-p4a.md`: the bank's word settles it; the bank
silent with exactly one matching statement DEBIT settles it; anything else is
`NEEDS_REVIEW`, and **absence of evidence never fails a payout**, because
releasing a reservation on a debit we merely cannot see pays it twice.

### Task 8: Remove the single-payout send path

`Sender.SendOne`, `ClaimForSending`, `RecordBankOrder` and `RecordConfirmed`
exist for a lane that no longer carries payouts. Delete what the batch path
does not use, and keep `RecoverUnsent` — it is the recovery for rows stranded
by a crash and stays deliberately ungated.

Do this last. Until the batch path is proven, the old path is the fallback.

### Task 9: Webhooks

`processing` and terminal callbacks. The one contract point today's work adds:
**a payout's fee is not the merchant's**, so it does not appear in the
callback amount.

---

## Supporting work — no dependencies, do any time

### Task 10: Capture the terminal poll body

P4b's poll allow-list treats `SUCCESS` and `FAILED` as definite, and both come
from a Node-era test stub. The first live body was captured on 2026-08-30 and
carries **no `status` field at all** — only `sourceOrderId`,
`isPollingEnabled` and `isPollingFinished` — so it classifies as `Unknown`,
which is correct but proves nothing about the allow-list.

Poll a committed order well after the fact, capture the terminal body for both
a same-bank and an interbank recipient, and re-check the allow-list against
it. **This gates `payout.send_enabled`**: an envelope whose `status` means
"the poll call succeeded" rather than "the transfer completed" produces a
false `Completed`, which releases a reservation for money that never arrived.

### Task 11: Discard the orphaned DRAFT orders

The failed diagnosis attempts left roughly a dozen `DRAFT` instructions at the
bank, listed by `GET /v1/instructions/pending-tasks` with `availableActions:
[EDIT, DISCARD]` and no `APPROVE`. They never entered the approval workflow
and never moved money. They are litter.

**Operator action, not an automated one.** Nothing in this codebase should
gain the ability to discard bank instructions in bulk.

### Task 12: Prove the transfer lane interbank

The transfer lane is for treasury movement, not payouts, and only its
same-bank route has been proven. One 1 THB interbank transfer closes the last
untested cell in the matrix. Low priority, one call.

### Task 13: The test-coverage gaps carried from P4b

Each is one test, listed in `docs/context/p4b-residuals.md`: the backoff
schedule is unpinned beyond "not zero"; `RecordConfirmed`'s error path is
never exercised; nothing enforces that `RecoverUnsent` stays ungated;
`SetReservedFee` never proves it writes inside its caller's transaction.

Fold these into whichever phase touches the same file rather than running them
as their own pass.

---

## Order, and why

1. **Phase 1 first.** Interbank payouts fail today. Everything downstream is
   untestable against the real bank until it lands.
2. **Phase 2 next.** It is small, it is in the lane Phase 3 builds on, and
   fixing it after Phase 3 means re-reviewing Phase 3's sending path.
3. **Task 3 before the rest of Phase 3**, and before its spec is written — the
   spec cannot describe settlement without knowing what signal settlement
   reads.
4. **Task 10 before any switch is turned on**, whenever it happens.
5. Phase 3's remaining tasks in order; Task 8 last within it.

## What "P4 finished" means

Every one of these is true, and none is assumed:

- A merchant's payout request reaches the recipient's bank account through a
  batch, with no human in the path.
- Its status is settled from the bank's own record, never from a signal that
  merely means "the call succeeded".
- The interbank fee lands on the platform's books, per item, at the amount the
  bank actually quoted.
- A payout the bank will not explain waits in `NEEDS_REVIEW` for a human.
  Nothing auto-fails on absence of evidence.
- Both gates pass, and the commit gate's mutation set is still fully killed.
