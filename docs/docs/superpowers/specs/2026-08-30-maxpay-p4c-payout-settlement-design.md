# P4c — Payout settlement through the bulk lane

**Status:** design, approved in conversation on 2026-08-30. Not implemented.

**Supersedes:** the P4c sketch in
`docs/superpowers/plans/2026-08-30-maxpay-p4-completion.md`. That plan's
Phase 3 must be rewritten from this document.

**Depends on:** Phases 1 and 2 of that plan, both merged. The commit-endpoint
fallback and the bulk lane's token-expiry guard are load-bearing here.

---

## 1. What this phase is for

P4a reserves a merchant's money when a payout is created. P4b sends one payout
at a time down the transfer lane and settles it from the rail's answer. P4c
replaces that sending path: payouts batch into a single KTB bulk order, and
each one settles independently from the bank's own per-item record.

Three things drove the change, all measured on 2026-08-30 against the live
corporate account:

- The operator will send payouts in batches, as merchant withdrawal requests
  accumulate. That is what the bulk lane is for.
- The bank's fee is **per item and route-dependent** — `0.00` within KTB,
  `5.00` interbank. Batching saves nothing on fees; it saves one PIN
  confirmation and yields one reference number per batch to reconcile against.
- The bank exposes a **stable per-item status code**, but only on the item
  detail endpoint. That is the settlement signal this phase is built on.

When P4c is done, a merchant's withdrawal reaches the recipient's bank without
a human in the path, and its outcome comes from the bank's record rather than
from any signal that merely means "the call succeeded".

## 2. Decisions this design rests on

Settled in conversation. They are requirements here, not open questions.

| Decision | Consequence |
|---|---|
| The **platform** absorbs the bank's interbank fee | The merchant's reservation is unchanged; the fee becomes a house expense |
| Payouts batch **on a timer with a count cap**, whichever fires first | Two config values, neither with a sending default |
| **No single-payout send path remains** | `Sender.SendOne` and its repository methods are removed once the batch path is proven |
| A payout that **fails name resolution is failed before the batch opens** | One bad recipient can never poison a batch |
| An **unrecognised item status is `NEEDS_REVIEW`** | Never auto-settles, never auto-fails |
| When the source account **cannot fund the whole queue**, send what fits in FIFO order and alert | No head-of-line blocking behind one large payout |
| The bank fee is debited to a **new `HOUSE_EXPENSE` account** | Bank fees stay separately reportable from revenue |

## 3. Two fees, and why they must not be confused

This is the single easiest thing to get wrong in this phase.

| | **MaxPay service fee** | **Bank transfer fee** |
|---|---|---|
| Exists since | P4a | new in P4c |
| Paid by | the merchant | the platform |
| Amount | the merchant chain's rate | `0.00` same-bank, `5.00` interbank |
| Where it lands | rebates up the chain, remainder to `HOUSE_REVENUE` | `HOUSE_EXPENSE` |
| Source of truth | `SplitFee` over the merchant chain | `itemTransactionFee` on the bank's item detail |

The service fee is **not changed by this phase**. It is reserved with the
amount at create, and distributed at settlement, exactly as P4a and P4b do it.

The bank fee is new, and it is not the merchant's. It never enters a
reservation, never appears in a merchant callback, and never affects what the
recipient receives.

## 4. Data model

### 4.1 `payout_batches` (new)

```sql
CREATE TABLE payout_batches (
    id                 UUID PRIMARY KEY,
    bank_account_id    UUID NOT NULL REFERENCES bank_accounts(id),
    status             TEXT NOT NULL,
    item_count         INTEGER NOT NULL CHECK (item_count > 0),
    total_amount       NUMERIC(20,2) NOT NULL CHECK (total_amount > 0),
    total_fee          NUMERIC(20,2),
    bank_bulk_order_id TEXT,
    package_ref_no     TEXT,
    failure_reason     TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at            TIMESTAMPTZ,
    confirmed_at       TIMESTAMPTZ,
    settled_at         TIMESTAMPTZ
);
```

`total_fee` is nullable because it is not known until the bank quotes it.
`bank_bulk_order_id` is nullable for exactly as long as no order exists, and
**that null is the only thing that authorises re-sending a batch** — the same
rule `bank_order_id IS NULL` plays in P4b.

### 4.2 `payouts` (three columns added)

```sql
ALTER TABLE payouts
    ADD COLUMN batch_id     UUID REFERENCES payout_batches(id),
    ADD COLUMN bank_item_id TEXT,
    ADD COLUMN bank_fee     NUMERIC(20,2);
```

`bank_fee` is the bank's own `itemTransactionFee` for this item, copied from
the item detail — never computed locally. Section 7 explains why that matters
more than it looks.

### 4.3 `HOUSE_EXPENSE` account kind

A new `ledger.Kind`, and whatever the ledger schema requires to admit it. It
holds costs the platform pays that are not deducted from any merchant. Today
that is bank transfer fees and nothing else.

## 5. Batch lifecycle

```
PENDING ──claim──> SENDING ──bank commits──> SENT ──all resolved──> SETTLED
   │                  │                        │
   │                  │                        └── any unresolved ──> NEEDS_REVIEW
   │                  ├── died, no order id ──> back to PENDING
   │                  └── died, order id set ──> stays SENDING for the reconciler
   └── refused before any order existed ─────> FAILED
```

`FAILED` is reachable only from `PENDING`, and only when the bank refused the
batch before an order existed — the source account is gone or inactive, or
`CreateBulkOrder` was refused on the merits. `failure_reason` carries the
bank's own words. Every payout in it returns to `PENDING` so a later batch can
carry it; nothing is failed to the merchant, because nothing about the payouts
themselves was wrong. **Once `bank_bulk_order_id` is set, `FAILED` is
unreachable** — from that point only the bank can say what happened, and the
reconciler asks it.

A payout's own status keeps the meanings P4a and P4b gave it. `PROCESSING`
gains one: it now also means "assigned to a batch that has not settled".

## 6. The three loops

Each is a separate ticker with its own config interval. Each is gated on
`payout.send_enabled`, except the recoverer, which is deliberately ungated for
the reason `RecoverUnsent` is.

### 6.1 Batcher

1. Read PENDING payouts for the source account, oldest first.
2. Fire only if the oldest has waited longer than the window **or** the count
   has reached the cap.
3. Resolve every candidate's payee name against the bank.
   - The bank says the account does not exist → that payout is `FAILED` with
     the bank's own reason, its reservation released, and it does not enter the
     batch.
   - The call itself fails → the payout stays `PENDING`. **A payout is never
     failed because we could not reach the bank.**
4. Read the source account's available balance from `GET /accounts/overview`.
   Never `cashflow` — it serves a stale figure (section 10).
   - If the balance cannot be read, skip the tick entirely. A batch is never
     opened without knowing the balance.
5. Walk the survivors in queue order, accumulating `amount + estimated fee`
   while the running total fits the balance. Stop at the first one that does
   not fit; everything after it waits for the next tick. **Log what was left
   behind and why** — an under-funded source account is an operational
   incident, and a queue that quietly stops draining is how it goes unnoticed.

   The **estimated** fee is the batcher's alone: the configured interbank fee
   when the recipient's bank differs from the source account's, zero when it
   does not. It exists only to decide what fits, is never written to a payout
   row, and is never posted. Accounting uses the bank's own charge, read at
   settlement (section 7). The estimate is allowed to be wrong; the only cost
   of it being high is a batch one item smaller than it could have been, and
   the only cost of it being low is a batch the bank refuses for insufficient
   funds — which fails the whole batch and moves nothing, so the estimate
   should round up rather than down.
6. In one transaction: insert the batch as `PENDING`, and assign the chosen
   payouts with a guarded update — `SET batch_id = ?, status = 'PROCESSING'
   WHERE id = ANY(?) AND status = 'PENDING'`. If the guard matches fewer rows
   than expected, roll back: another batcher claimed some, and a batch that
   silently sends a subset is worse than one that does not run.

Only step 3 touches the bank, and it only reads.

### 6.2 Sender

1. Claim one batch with a single guarded statement, in the shape P4b uses for
   payouts:

   ```sql
   UPDATE payout_batches SET status = 'SENDING', sent_at = $2
   WHERE id = (SELECT id FROM payout_batches
               WHERE status = 'PENDING' AND bank_account_id = $1
               ORDER BY created_at
               FOR UPDATE SKIP LOCKED LIMIT 1)
     AND status = 'PENDING'
   RETURNING ...
   ```

2. Build the recipient list from the batch's payouts and call the bulk service
   with hooks (section 8):
   - `OnOrderCreated` writes `bank_bulk_order_id`. **This is the point of no
     return.** After it, the batch is never re-sent by anything.
   - `OnConfirmed` writes `confirmed_at`. From here the money may be gone.
3. On return, record `package_ref_no`, and per payout its `bank_item_id`.
4. Batch becomes `SENT`.

The per-item fee is **not** recorded here. It is read at settlement from the
bank's record, because that is the amount the bank actually charged.

### 6.3 Reconciler

For each `SENT` batch, for each of its payouts, read
`GET /v1/bulk/bulk/{orderId}/items/{itemId}` — the **detail** endpoint, never
the list (section 10).

| `bulkItemStatus` | Payout becomes | Money |
|---|---|---|
| `SUCCESSFUL` | `COMPLETED` | reservation converted, service fee distributed, bank fee expensed |
| a code in the known-failure map | `FAILED` | reservation released |
| anything else | `NEEDS_REVIEW` | untouched |

The known-failure map starts **empty**. No failing item has ever been
observed, so there is no code to put in it, and inventing one would be
guessing at the exact decision that must not be guessed. The first real
failure lands in `NEEDS_REVIEW`, a human reads the code and the
`transactionErrorDescription` beside it, and the code is added — one map
entry, exactly as `commitRefusalCodes` grew when the interbank route appeared.

When every payout in a batch has resolved, the batch is `SETTLED`, or
`NEEDS_REVIEW` if any of them is.

If the item detail call fails, nothing settles and the tick retries. If the
bank does not know the order at all, section 9's evidence table applies.

### 6.4 Recoverer

Finds batches stuck in `SENDING` past a threshold.

- `bank_bulk_order_id IS NULL` → nothing was created. Return the batch to
  `PENDING`; it is safe to send.
- `bank_bulk_order_id` set → an order exists at the bank. **Never re-send.**
  Hand it to the reconciler, which asks the bank what happened to that order.

This is `RecoverUnsent`'s rule, applied to batches instead of payouts, and it
stays ungated for the same reason: a crash must not need a config switch to
recover from.

## 7. Ledger

**Create** — unchanged from P4a:

```
Debit   MERCHANT_OPERATE          amount + serviceFee
Credit  MERCHANT_PENDING_PAYOUT   amount + serviceFee
```

**Completed** — one line changes and one is added:

```
Debit   MERCHANT_PENDING_PAYOUT   amount + serviceFee
Credit  BANK_ACCOUNT              amount + bankFee        <- was amount
Debit   HOUSE_EXPENSE             bankFee                 <- new
Credit  rebates, then HOUSE_REVENUE   serviceFee          <- unchanged
```

Both sides total `amount + serviceFee + bankFee`.

**The changed line is the important one.** `PostPayoutCompleted` currently
credits the bank account with the payout amount alone, while the bank actually
debits the amount plus its fee. Left alone, the ledger's view of the bank
account drifts from the bank's by 5 THB on every interbank payout, in a
direction nothing reports.

**Failed** — the reservation is released as P4a does. If the bank charged a
fee anyway, the fee lines are posted on their own:

```
Credit  BANK_ACCOUNT    bankFee
Debit   HOUSE_EXPENSE   bankFee
```

**Whether a failed transfer is still charged is unknown** — no failing item
has been observed. This design does not need to know: `bankFee` is read from
the bank's `itemTransactionFee`, so a charged fee posts and an uncharged one
is zero and posts nothing. Both cases are handled without anyone guessing
which is real. A zero-amount line is refused by the ledger schema, so the
zero case must skip the lines rather than post them — the same pattern
`PostPayoutCompleted` already uses for a zero house share.

## 8. The bulk lane needs hooks

`Service.Bulk` runs create → add items → verify → pre-confirm → MFA → commit
in one call, with no seam. A caller cannot record the bank's order id before
the money can move.

That breaks the discipline P4b established and this phase depends on: **the
bank's identifier is recorded before the call that can move money**, so a
process that dies mid-sequence can still ask the bank about that specific
order rather than guess.

So `Bulk` takes `domaintransfer.Hooks` — the same `OnOrderCreated` /
`OnConfirmed` pair the transfer lane already has, with the same contract: a
hook returning an error aborts before the money moves, and a caller that
cannot record the order id must not go on to commit.

This is not symmetry for its own sake. Without it there is no recovery story
for a sender that dies at the wrong moment, and the failure it prevents is a
whole batch of unattributable payments.

## 9. Resolving what the bank will not say

The rule agreed in `docs/context/roadmap-after-p4a.md`, unchanged:

| Evidence | System decides? |
|---|---|
| bank says the item completed | yes |
| bank says the item failed, with a code we know | yes |
| bank silent, exactly one matching DEBIT in the statement | yes — completed |
| bank silent, several matching DEBITs | no — `NEEDS_REVIEW` |
| bank silent, no DEBIT found | no — **not seeing is not the same as not happening** |
| bank silent, statement has a gap over the window | no |

**No auto-fail on absence of evidence.** Releasing a reservation because we
cannot see the debit, when the statement poller was simply down, pays the
money twice.

A batch that sits unresolved past a threshold raises an alert. It is never
auto-failed, and no timer resolves it.

## 10. Two traps in the bank's API

Both were found on 2026-08-30 and both would produce a wrong settlement.

**`bulkItemStatus` means different things on different endpoints.** The list
endpoint returns the Thai display label; the detail endpoint returns the code:

```
GET /bulk/bulk/{id}/items            "รายการสำเร็จ"
GET /bulk/bulk/{id}/items/{itemId}   "SUCCESSFUL"
```

Same field name, different value space. The list is the natural one to reach
for — one call for the whole batch — and settling from it would compare
against `"SUCCESSFUL"` forever without matching, stranding every payout in
`PROCESSING` silently. **Settlement reads the detail endpoint only.** The cost
is one call per item; the detail also carries `transactionErrorCode` and
`itemTransactionFee`, which the list does not, so the call is needed regardless.

**`isCompleted` is not a settlement signal.** It was `true` at submission time
while the status still read "submitted for processing". It means the item is
complete and valid within the package, not that money arrived. Nothing in this
phase may read it.

`GET /accounts/cashflow` is a third trap, in the batcher rather than
settlement: it served a balance from before the previous night's transfers in
the same second `overview` served the current one. Only `overview` informs a
money decision.

## 11. Configuration

New keys under `payout:`, all defaulting to values that send nothing:

| Key | Meaning |
|---|---|
| `batch_window` | how long the oldest pending payout may wait before a batch opens |
| `batch_max_items` | the count that opens a batch early |
| `batch_interval` | how often the batcher looks |
| `reconcile_interval` | how often the reconciler reads item statuses |
| `stuck_batch_after` | how long a `SENDING` or `SENT` batch may sit before it alerts |

`send_enabled`, `source_account_id` and `max_attempts` keep their current
meanings. `send_interval` becomes the sender's batch-claim interval.

**`batch_max_items` has no safe large default.** No bulk order with more than
four recipients has ever been sent, and the bank's own limit is unknown. It
starts small, and it is raised against a measured limit rather than a guess.

## 12. What is removed

Once the batch path is proven end to end, the single-payout send path goes:
`Sender.SendOne`, `ClaimForSending`, `RecordBankOrder`, `RecordConfirmed`, and
the transfer-lane call in the payout sender.

`RecoverUnsent` stays. It recovers rows stranded by a crash, and it is
deliberately ungated.

**This is the last task of the phase, not the first.** Until the batch path
has moved real money, the old path is the fallback.

## 13. Testing

**Unit.** The batcher's trigger (window versus cap), the balance-fitting walk
in queue order, the status map, the fee lines. These are pure functions given
a clock and a balance, and they carry most of the phase's decision logic.

**Integration.** Two batchers racing for the same payouts. Two senders racing
for the same batch. A batcher that fails part-way leaving nothing claimed. The
ledger balancing in the database for a batch mixing same-bank and interbank
recipients, which is the only way the `bankFee` lines are exercised together.

**Mutations that must be killed.** The status map collapsing to "anything
non-empty is success". The balance walk taking everything regardless of the
running total. `AND status = 'PENDING'` dropped from either guarded update.
The `bankFee` term dropped from `Credit BANK_ACCOUNT` — which is the drift in
section 7, and it must not be possible for a test suite to pass without it.

**Before `send_enabled` is ever turned on**, the terminal poll body must be
captured for both a same-bank and an interbank recipient and the allow-list
re-checked against it. The first live body carried no `status` field at all,
so the allow-list is still unvalidated against anything real.

## 14. Out of scope

- Webhooks. `processing` and terminal callbacks are their own work. The only
  contract point this phase adds is that **the bank fee is not the merchant's**
  and does not appear in a callback amount.
- The admin screen a human uses to resolve `NEEDS_REVIEW`.
- Turning on any money-moving switch.
- Discarding the orphaned DRAFT orders left at the bank by the diagnosis
  attempts. That is an operator action, and nothing in this codebase should
  gain the ability to discard bank instructions in bulk.

## 15. Known unknowns

Recorded so nobody mistakes them for settled.

- **No failing bulk item has ever been observed.** The known-failure map is
  empty by construction and the first failure will need a human.
- **Whether the bank charges its fee on a failed item.** Section 7 handles
  both without needing the answer.
- **The bank's maximum recipients per bulk order.** `batch_max_items` starts
  small for this reason.
- **The terminal poll body.** Still uncaptured; it gates `send_enabled`.
