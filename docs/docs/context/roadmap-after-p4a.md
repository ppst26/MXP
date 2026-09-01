# Work plan after P4a

Written 2026-08-29, the day P4a landed on `main`. Supersedes
`roadmap-after-p3.md`, whose section 1 is now complete.

## Where things stand

**Money in** is built and has never run. Create a deposit, generate a
PromptPay QR, poll the bank's statement, decide whose money each credit is,
post it, tell the merchant, let a human resolve what the matcher could not.
Every switch is off.

**Money out** now has its first half. A merchant can create a payout and
have its money reserved in the ledger; nothing sends it. `PostPayoutCreated`
has a caller at last. `PostPayoutCompleted` and `PostPayoutFailed` still have
none.

**Six switches are off**, and they are not off for one reason:

| Switch | Off because |
|---|---|
| `statement.polling_enabled` | every tick is a live bank call; a hammered login risks being blocked |
| `pool.balance_refresh_enabled` | same — protects the bank channel |
| `deposit.qr_enabled` | blocked on a human scanning a generated payload with a real registered PromptPay id |
| `deposit.matching_enabled` | it acts on whatever is in the table the moment it starts |
| `deposit.expire_sweep_enabled` | same |
| `payout.enabled` | a merchant could reserve real money against a phase with no worker to spend it |

Only the first two protect the bank. The rest protect existing data.

## The sequence, and why it is this order

### 1. Turn on statement polling — first, and by itself

`statement.polling_enabled` is **the only switch that moves no money at
all.** It reads. Everything else either sends to a bank or acts on rows.

It goes first for three reasons, not one:

- It is the cheapest possible test of the bank channel. If KTB throttles us,
  we learn it while nothing depends on the answer.
- **P4c cannot be designed without it.** P4c's fallback — "if the bank will
  not tell us whether a payout completed, look for the DEBIT in the source
  account's statement" — rests on statement ingestion that has never once
  run against real traffic. Building that fallback on an unproven foundation
  is how it fails the first time it is needed.
- It produces the real counterparty grammars the matcher will have to learn.
  Only five are known, from two captures of one account.

**Before turning it on, raise `poll_interval_active`.** It is 10s, chosen
for responsiveness and never measured against KTB's tolerance. Start at
something conservative — a minute or more — watch `logs/ktb-wire.jsonl` for
any sign of throttling, and only then consider lowering it. The account this
runs against cannot be replaced without another OTP to the account holder.

No code changes. This is a config change and a period of watching.

### 2. P4b — send the money

The largest remaining piece, and the first that moves money out.

Its shape is already decided (see the P4a spec's §5.1 and the design
conversation behind it): a worker claims `PENDING` rows one at a time with a
guarded UPDATE, sends through the existing KTB rail, and records
`bank_order_id` and `confirmed_at`. The rule those two columns carry is the
whole design:

> `confirmed_at IS NULL` — the bank was never told to pay; releasing the
> reservation is safe.
> `confirmed_at IS NOT NULL` — the money may already be gone. Only positive
> evidence may resolve it.

**Three obligations P4a hands it by name:**

- **`sourceAccount` must be re-checked inside the sending transaction.** P4a
  resolves it outside, which is safe only because P4a sends nothing.
- **`PostPayoutFailed` is the real deadlock partner of `Create`**, not
  `PostPayoutCompleted`. It locks `{pending, operate}` for the same merchant
  while `Create` holds `operate` and wants `pending`. Safe today only
  because ledger account ids are `uuidv7()` and `operate` is created first —
  not because of anything the code enforces.
- **`list`'s per-row account cache goes live the moment a second source
  account exists**, which is the first thing payout routing would add. It is
  keyed correctly today but nothing pins it, because every fixture names one
  account.

**Serialisation is not optional.** `session.Do` does not serialise its work —
`singleflight` covers only login. Two payouts running concurrently on one
device would build two transfer orders on one bank session. The worker runs
one at a time, per device, with a delay between, and `daily_txn_cap` /
`daily_amount_cap` (already on `bank_accounts`) as the per-day ceiling.

**Starts with brainstorming and a spec**, like P4a did.

### 3. P4c — close the loop

Webhooks (`processing` and terminal, with `qrcode` on success), the
reconciler that re-asks the bank, the statement fallback, `NEEDS_REVIEW`,
and the admin screen a human uses to decide.

The rule agreed for the unknown-outcome path, which P4c implements:

| Evidence | System decides? |
|---|---|
| bank says completed | yes |
| bank says failed | yes |
| bank silent, exactly one matching DEBIT in the statement | yes — completed |
| bank silent, several matching DEBITs | no — `NEEDS_REVIEW` |
| bank silent, no DEBIT found | no — **not seeing is not the same as not happening** |
| bank silent, statement has a gap over the window | no |

**No auto-fail on absence of evidence.** Releasing a merchant's reservation
because we cannot see the debit, when the statement poller was simply down,
pays the money twice.

### 4. Turn on the money-moving switches

In the roadmap's order: `matching_enabled`, then `expire_sweep_enabled`,
then the suspense sweep last — the two that move money on a timer with
nobody watching.

**A decision must be made before the first of these, not during it.** The
`maxpay` database holds seven UNMATCHED credit rows worth **713.35 THB of
real money**. Every one of these loops acts on whatever is in the table the
moment it starts. Turning on matching, or the suspense sweep, decides what
happens to that money. Decide deliberately: attribute it by hand first,
clear it, or accept what the sweep will do.

`deposit.qr_enabled` stays off regardless, and no engineer can change that.
It needs a human to scan a generated payload with a **real registered
corporate PromptPay id** and confirm the recipient name and amount. The
development id is synthetic and would fail whether or not the generator is
correct.

### 5. Three merchant-facing answers, cheap now and breaking later

Each has no answer written anywhere, and each is a contract with an
integrator once the first one is live:

- `walletId` is always sent as `""`, and the PRD lists it as a plain string
  with no "may be empty" note. A merchant validating it non-empty rejects
  every callback.
- `type` sends the deposit's real type, which can be `TRANSFER`, where the
  PRD says it is always `"QR"`. More truthful, and a merchant validating the
  literal will reject it.
- **`expired` is not terminal.** A deposit that expired and is later matched
  sends `completed` afterwards. Merchants must be told, or they will treat
  the first callback as final.

## Carried residuals

Recorded so none is lost, none blocking:

- **`statement.Service.Attribute` does not check that the deposit's
  `BankAccountID` matches the row's.** An admin can attribute a credit that
  landed in account A to a deposit created against account B; the ledger
  then posts against the row's account, so the books balance around the
  wrong story. Small, cheap, and the only one here that is a real bug rather
  than a test gap.
- A retried webhook re-reads the deposit live, so a retry can send a
  different body than the first attempt.
- Six config-reading constructors in `internal/service/module.go` map config
  with nothing exercising the mapping — the same class P4a closed for
  `payout`.
- Every other zero-value config default (`Deposit.QREnabled`,
  `Deposit.ExpireSweepEnabled`, …) has the blind spot P4a closed for its own
  two keys: the defaults test asserts Go zero values, so a broken
  mapstructure tag is indistinguishable from a correct default.
- `merchantdeposit`'s create handler has the gap P4a closed in
  `merchantpayout`: nothing pins that its ownership checks run before the
  idempotency claim, so a forbidden request could burn a merchant's own
  order id.
- Nine deferred minors from P3b-2, in `p3b2-residuals.md`.

## One operational note

`make migrate-down` and `make migrate-reset` now refuse when
`DATABASE_URL` names `maxpay`, because `migrate-reset` ran `migrate drop -f`
against it by default — the database holding a bank device that cannot be
re-registered without another OTP. Pass `I_MEAN_IT=1` to override, or point
`DATABASE_URL` at `maxpay_test`.
