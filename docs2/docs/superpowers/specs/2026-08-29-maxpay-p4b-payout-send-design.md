# Design: MaxPay P4b — sending the payout to the bank

Date: 2026-08-29
Status: approved (design), pending spec review

## 1. Goal

Send the money P4a reserved, and know afterwards whether it left.

P4a created payouts and held their money in `MERCHANT_PENDING_PAYOUT`;
nothing spends it, and `PostPayoutCompleted` and `PostPayoutFailed` still
have no callers. This phase gives them callers, and is the first in the
payout feature that moves money out of the company's bank account.

P4c then closes the loop: webhooks, the reconciler that resolves what this
phase leaves unknown, and the screen a human uses to decide.

Reference contract: `../MaxPay/PRD/technical-term/payout/Payout.md` (the
lifecycle) and `CreatePayout.md` (the statuses a merchant sees).

## 2. Scope

In scope:

- a progress-reporting change to `internal/service/transfer` so a caller can
  persist the bank's order id and the moment of confirmation **as they
  happen**, not after the whole sequence returns
- a worker that claims `PENDING` payouts one at a time and sends them
- `attempts` / `next_attempt_at` and a bounded retry, gated on the payout
  never having been confirmed
- `PostPayoutCompleted` and `PostPayoutFailed` at the terminal states
- crash recovery: a payout interrupted mid-send is classified, never guessed

Out of scope, named so nobody builds them by accident:

- **webhooks of any kind** (P4c). This phase changes a merchant's payout
  status in the database and tells the merchant nothing.
- the reconciler that re-asks the bank about an `Unknown` outcome (P4c)
- the statement fallback and `NEEDS_REVIEW` (P4c)
- the admin screen for human resolution (P4c)
- bulk transfers. The rail supports them; the merchant contract carries one
  recipient per payout and this phase sends them one at a time.
- multiple source accounts and any routing between them

## 3. Global constraints

- Go 1.25 · Gin · uber/fx · sqlx + squirrel · PostgreSQL 18 · Zap · Viper
- Money is `decimal.Decimal`, never `float64`
- Every status transition is a guarded `UPDATE` with `CheckRowsAffectedWith`
- `payout.send_enabled` defaults to **false**
- Never log the PIN, the API key, the secret key, or any merchant plaintext
  credential, at any level including error paths
- The worker sends **one payout at a time per device**, never concurrently
- All code, identifiers, comments and docstrings in English

## 4. The constraint that shapes everything

Three facts about the existing rail, each verified in the code:

1. **The KTB transfer order carries no client-side reference.**
   `ktb.CreateTransferOrderRequest` and the item-update request have no
   remark, note, memo or reference field. We cannot tag an order with a
   payout id and later ask the bank "do you have an order for this payout?"
2. **`Transfer()` does the whole sequence in one call** — name check, create
   order, price the item, verify, pre-confirm, MFA with the stored PIN,
   confirm, poll, read the order back — and the caller only learns the
   order id from the returned `Result`.
3. **`Transfer()` returns a `Result` and a nil error both when the bank said
   the transfer completed and when polling failed.** The two are told apart
   only by comparing `FinalResult` against `pendingApprovalBody`, an
   unexported package-level variable.

Together these make the P4a invariant unenforceable. **Money moves at
`ConfirmTransfer`.** If the process dies between that call succeeding and
`Transfer()` returning, the money is gone, the payout row has no
`bank_order_id`, and no question we can ask the bank will find the order.
The next worker pass sees `PENDING` and **sends it a second time**.

`confirmed_at IS NOT NULL` cannot mean "the bank was told to pay" if
nothing can write it at the moment the bank was told.

**So the rail changes.** This is the one place in P4b that touches code
already proven against the live bank, and it is not optional: without it,
the release-safety rule this whole feature rests on is decorative.

## 5. The rail change

`internal/service/transfer`:

```go
// Hooks let a caller persist what the bank has told us at the moment it
// tells us, rather than after the whole sequence returns. Both are called
// synchronously, inline, and a hook that returns an error ABORTS the
// transfer -- a caller that cannot record the order id must not go on to
// confirm it, because that is precisely the state nothing can recover from.
type Hooks struct {
    // OnOrderCreated fires as soon as the bank returns an order id, which
    // is before any money can move: an order that is never confirmed
    // transfers nothing.
    OnOrderCreated func(ctx context.Context, orderID string) error

    // OnConfirmed fires immediately after ConfirmTransfer succeeds. From
    // this instant the money may be gone, and nothing may release the
    // payout's reservation without positive evidence.
    OnConfirmed func(ctx context.Context) error
}

// Outcome replaces "read Result.FinalResult and compare it against an
// unexported variable". Unknown is a first-class value because it is the
// case the caller most needs to handle and the one it is most likely to
// get wrong.
type Outcome struct {
    Kind            OutcomeKind // Completed | Failed | Unknown
    TransferOrderID string
    Reason          string          // set for Failed
    FinalResult     json.RawMessage // preserved for the audit trail
    TransferDetails json.RawMessage
}
```

`Transfer(ctx, alias, data, hooks)` returns `(*Outcome, error)`. Passing a
zero `Hooks` keeps today's behaviour, so the existing admin transfer
endpoint is unaffected.

**`Unknown` is not an error.** It is a successful call whose result is that
we do not know. Returning it as an error would invite the caller to retry,
which is the one thing that must never happen after a confirmation.

## 6. What the rail change buys

Money moves only at `ConfirmTransfer`, so a row found mid-flight at startup
falls into exactly three cases, none of which requires a guess:

| Row state | What it means | Action |
|---|---|---|
| `PROCESSING`, no `bank_order_id` | an order may exist at the bank but was never confirmed — **no money moved** | safe to retry |
| `PROCESSING`, `bank_order_id` set, `confirmed_at` NULL | confirmation may or may not have happened — **but the order id is known** | P4c asks the bank |
| `PROCESSING`, both set | the money moved | P4c polls for the outcome |

The middle row is the one the rail change creates. Without it, that state is
indistinguishable from the first, and a retry double-pays.

## 7. Schema

Migration `000017_payout_attempts`:

```sql
ALTER TABLE payouts
    ADD COLUMN attempts        INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ADD COLUMN next_attempt_at TIMESTAMPTZ;

-- The worker's claim query. next_attempt_at IS NULL means "eligible now",
-- which is what a freshly created payout carries.
CREATE INDEX payouts_sendable ON payouts (next_attempt_at NULLS FIRST)
    WHERE status = 'PENDING';
```

`bank_order_id`, `confirmed_at` and `failure_reason` already exist,
declared unwritten by P4a for exactly this phase.

## 8. The worker

Modelled on `statement.StatementProducer`: an fx-managed loop with a ticker,
an `enabled` gate, and the work itself in a function testable without a
goroutine or a sleep.

Each tick, for one source account:

```
CHECK THE GATES FIRST, before claiming anything:
    payout.send_enabled is false        → do nothing this tick
    source account is not ACTIVE        → do nothing this tick, log Warn
    daily_txn_cap or daily_amount_cap
      already reached for today         → do nothing this tick

claim one PENDING payout whose next_attempt_at is NULL or in the past
    guarded UPDATE ... SET status = 'PROCESSING', attempts = attempts + 1
    WHERE id = $1 AND status = 'PENDING'      ← this is the claim
    (no row affected → someone else took it → move on)

Transfer(ctx, alias, data, hooks)
    OnOrderCreated → UPDATE payouts SET bank_order_id = $2 WHERE id = $1
    OnConfirmed    → UPDATE payouts SET confirmed_at = NOW() WHERE id = $1

Completed → COMPLETED + PostPayoutCompleted
Failed    → attempts < max AND bank_order_id IS NULL
                 → back to PENDING with next_attempt_at set
             otherwise
                 → FAILED + PostPayoutFailed
Unknown   → stays PROCESSING. P4c owns it. Nothing is posted.
```

**The gates are checked before the claim, not after it, and this is not
cosmetic.** The claim increments `attempts`, so refusing a payout after
claiming it would spend one of its three chances on a condition the payout
had nothing to do with — a merchant's payout could exhaust its retries
purely because the account's daily cap was full. It would also re-claim and
re-refuse the same row on every tick, burning a write each time. A gate that
belongs to the account or the switch is checked against the account or the
switch, before any row is touched.

An inactive source account leaves payouts `PENDING`, and does **not** move
them to `REJECTED`. `REJECTED` is for a payout we refuse; an account that
went inactive is a condition we expect to be fixed, and failing every queued
payout because an operator suspended an account for ten minutes would
destroy work that was fine.

**One at a time, per device.** `session.Do` does not serialise its work —
`singleflight` covers only login — so two concurrent payouts would build two
transfer orders on one bank session. The worker is a single loop and sends
one payout per tick.

The tick interval is config. The retry backoff is **hardcoded at 1m then
5m** — §10 is the authoritative config list and never carried a key for it,
nobody has asked to tune it, and a knob nobody turns is a knob that drifts
from its tests. It becomes config the first time someone needs a different
value. All of it starts conservative: the account this runs against holds a device
that cannot be re-registered without sending the account holder another OTP.

## 9. Retry

Only before confirmation, and only a bounded number of times.

```
attempt 1 fails → next_attempt_at = now + 1m
attempt 2 fails → now + 5m
attempt 3 fails → FAILED, reservation released
```

**The gate is `bank_order_id IS NULL`, not the attempt count.** A payout that
was confirmed and then failed to report is never retried regardless of how
many attempts it has left — it goes to P4c. The count only bounds how long
we keep trying something that provably never reached the bank.

A `Failed` outcome from the bank after confirmation (the bank actively said
no) is terminal immediately: the bank has told us, so there is nothing to
retry and nothing to reconcile.

## 10. Config

```yaml
payout:
  enabled: false            # P4a's switch: gates POST /payout/create
  source_account_id: ""

  # Gates the sending worker, separately from the create endpoint. Both
  # default false, and they turn on in that order: a merchant creating
  # payouts nobody sends is a recoverable state, while a worker sending
  # payouts nobody created is not a state at all.
  send_enabled: false

  # How often the worker looks for a claimable payout. One payout is sent
  # per tick, so this is also the ceiling on how fast this service will ever
  # call the bank for payouts: at 30s that is two per minute.
  #
  # That is deliberately slow, and it is a starting point rather than a
  # target. The rail's own sequence is several calls per payout, the account
  # cannot be re-registered without another OTP if the channel blocks, and
  # nobody has measured KTB's tolerance. Raise throughput only after
  # statement polling has run at a known-safe rate for long enough to say
  # what that rate is.
  send_interval: 30s

  # Attempts before a pre-confirmation failure becomes terminal.
  max_attempts: 3
```

## 11. Errors

| Condition | Status | Ledger |
|---|---|---|
| `send_enabled` false, or source account not ACTIVE, or daily cap reached | nothing is claimed; payouts stay `PENDING` | none |
| pre-confirmation failure, attempts remain | back to `PENDING` | none |
| pre-confirmation failure, attempts exhausted | `FAILED` | `PostPayoutFailed` |
| bank says the transfer failed | `FAILED` | `PostPayoutFailed` |
| bank says it completed | `COMPLETED` | `PostPayoutCompleted` |
| bank does not answer | stays `PROCESSING` | none — P4c owns it |

Both postings take `ReservedFee: &row.ReservedFee` — the figure P4a
persisted, never a recomputation. `PayoutInput.ReservedFee`'s own doc
explains why, and both functions refuse a nil.

## 12. Testing

The gate is `make check` plus `make test-integration`.

What must be proven, beyond the ordinary cases:

- **The hooks fire in order, and their writes are durable before the next
  step runs.** A test that stubs the rail and asserts the row carries
  `bank_order_id` before `OnConfirmed` is invoked, and `confirmed_at` before
  `Transfer` returns.
- **A hook returning an error aborts the transfer.** If recording the order
  id fails, the sequence must stop before `ConfirmTransfer` — proven by a
  stubbed rail asserting confirm was never reached.
- **A payout with `bank_order_id` set is never retried**, whatever its
  attempt count. Set `bank_order_id`, leave attempts at zero, and assert the
  worker does not claim it.
- **Two workers cannot claim one payout.** The guarded UPDATE, proven
  against a real database with two transactions — not with mocks.
- **The reservation is released exactly once.** A payout driven to `FAILED`
  must post `PostPayoutFailed` once; `journal_entries_reference_unique`
  (type, reference_type, reference_id) is the backstop, and a test should
  prove the code does not rely on it.
- **`ReservedFee` is the stored column**, not a recomputation. Change the
  merchant's payout rate between creation and settlement and assert the
  released figure did not move.
- **Every terminal transition posts inside the same transaction as the
  status update.** A rollback leaves neither.

**No test may call a real bank.** The rail is stubbed at the
`domaintransfer.Service` boundary in every test in this phase.

### The live smoke test, after the automated ones

Two recipient accounts have been provisioned for the first real send. They
live in `_local/payout-test-recipients.md`, which is gitignored: real
account numbers do not belong in a spec, a fixture, or a commit.

**One is at KTB and one is not, and that is the point.** The source account
is a KTB corporate account, so:

- the KTB recipient exercises a **same-bank** transfer
- the other exercises an **interbank** transfer

These are different operations at the bank — different fees, different
settlement timing, and potentially a different response shape and status
vocabulary for the rail to read back. **A payout rail proven only against a
same-bank transfer is not proven.** Both paths must be walked before this
phase is called finished, same-bank first because it is the simpler one.

The first real send is **1 THB**, the amount the PRD's own example uses.
There is no reason for the first transfer out of the corporate account to be
larger, and every reason for it to be small.

Mutation testing applies as it did through P4a: reviewers design their own
mutations rather than working a list, run them with `go test -overlay`
against modified copies, and treat a survivor as a finding about the tests.
A `[build failed]` is not a kill. Fixtures that make two values coincide —
amount equal to fee, the retry interval equal to the tick interval —
silently disarm every swap mutation between them.

## 13. What this phase deliberately leaves broken

A payout whose outcome the bank never reported stays `PROCESSING` forever,
with its money still reserved. Nothing retries it, nothing releases it, and
the merchant is told nothing.

That is correct for this phase and it is safe: the money is held, not lost,
and the row carries `bank_order_id` and `confirmed_at`, which is exactly
what P4c needs to resolve it. It is not safe to leave for long — P4c should
follow closely.

`payout.send_enabled` ships false. Turning it on is the first time this
system moves money out of the company's account, and it should follow
`statement.polling_enabled` having run long enough to prove the bank
channel tolerates our call rate — the payout worker adds several bank calls
per payout on top of whatever polling already costs.
