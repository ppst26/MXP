# Design: MaxPay P4a — creating a payout and reserving its money

Date: 2026-08-29
Status: approved (design), pending spec review

## 1. Goal

Let a merchant ask us to pay someone, take that money out of its spendable
balance the moment we accept the request, and hand back a reference it can
poll — **without any part of this phase talking to a bank.**

P2b built every ledger posting a payout needs (`PostPayoutCreated`,
`PostPayoutCompleted`, `PostPayoutFailed`) and left them with zero callers.
This phase writes the first one. P4b sends the money; P4c closes the loop
with webhooks and human resolution.

Splitting it this way is deliberate: everything in P4a can be tested
exhaustively against a real database with **no risk to the corporate bank
account at all**, and a design mistake surfaces before a satang has moved.

The reference contract is the MaxPay PRD in `../MaxPay` — in particular
`PRD/technical-term/payout/CreatePayout.md` (request and response fields),
`PRD/technical-term/payout/Payout.md` (the lifecycle and the authorization
model) and `PRD/technical-term/payout/List Payout Transactions.md` /
`Get Payout Transaction By Ref ID .md` (the two read endpoints).

## 2. Scope

In scope:

- `POST /api/v1/payout/create` — signature-guarded, idempotent
- the `payouts` table and its status lifecycle
- reserving amount **plus fee** through `PostPayoutCreated`
- the insufficient-balance guard P2b declared and left unbuilt
- persisting `reserved_fee`, which P2b's own comment asks for by name
- resolving the source corporate account from configuration
- `GET /api/v1/payout/:reference_id` and `GET /api/v1/payouts`

Out of scope, and named here so nobody builds them by accident:

- **any call to the bank.** No transfer order, no name check, no PIN. The
  `transfer` service is not wired into this phase at all.
- the worker that claims `PENDING` rows (P4b)
- `PostPayoutCompleted` / `PostPayoutFailed` (P4b)
- webhooks of any kind (P4c)
- the reconciler, the statement fallback and `NEEDS_REVIEW` (P4c)
- bulk payouts. The PRD's create endpoint carries exactly one recipient,
  and the rail's bulk mode stays unused.
- liquidity buffers and auto-sweep. There is no `OUTBOUND` account to
  measure yet and `pool.balance_refresh_enabled` has never run; a guard
  reading a stale balance is worse than no guard, because it is believed.

## 3. Global constraints

- Go 1.25 · Gin · uber/fx · sqlx + squirrel · PostgreSQL 18 · Zap · Viper
- money is `decimal.Decimal`, never `float64`, at every layer including the
  JSON edge (`json.Number`, as `merchantdeposit` already does)
- Clean Architecture: `internal/domain/payout` imports no adapter or service
- every status transition is a guarded `UPDATE` with `CheckRowsAffectedWith`
- the API key, the secret, and the merchant's plaintext credentials are
  never logged at any level, including error paths
- nothing in this phase may open a network connection to a bank

## 4. The contract

### 4.1 Request

`POST /api/v1/payout/create`, headers `x-api-key` and
`Content-Type: application/json`, guarded by `middleware.SignatureRequired`
exactly as `POST /deposit/create` is — money moves here.

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientId` | string | yes | must resolve, and must belong to the authenticated merchant |
| `merchantId` | string | yes | must equal the authenticated merchant's `Code` |
| `transactionId` | string | yes | the merchant's own order id; unique per merchant |
| `bankAccountNumber` | string | yes | the recipient's account |
| `amount` | number | yes | decoded through `json.Number`, never `float64` |
| `bankName` | string | yes | recipient bank, spelled as `ListBank.md` returns it |
| `name` | string | yes | the recipient's real account-holder name |
| `phone` | string | no | `""` when absent |
| `callbackUrl` | string | yes | HTTPS only; stored now, used in P4c |
| `signature` | string | yes | HS256 over the body, single use |
| `timestamp` | integer | yes | ms, must equal the signature's `iat` |

`signature` and `timestamp` are consumed by the middleware and are not part
of the payout's own data.

### 4.2 Response — 201

```json
{
  "status": "success",
  "message": "Create Success",
  "data": {
    "clientId": "nHUxQbHgEu",
    "merchantId": "VOBM7qzaRH",
    "referenceId": "qS4EDxSWCO",
    "transactionId": "POP0PTB01776723e7X1",
    "amount": "100.0000",
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
      "name": "บริษัท ..."
    }
  }
}
```

`referenceId` is ten base62 characters from `crypto.RandomCode`, the same
generator and the same length `deposits` uses (`ReferenceLength = 10`).

`amount` is a **string** on the way out while it is a number on the way in.
That asymmetry is deliberate and is what `merchantdeposit` already does: a
number decodes through `json.Number` without ever becoming a `float64`, and
a string renders the stored `decimal.Decimal` exactly, with no encoder
between the books and the merchant.

`status` is lowercase on the wire and uppercase in the database, matching
how deposits already present themselves.

**`systemBankData` is why P4a resolves the source account** even though it
never uses it: the PRD requires the response to name the account that will
pay, so the account must be chosen at creation, recorded on the row, and
returned. P4b then uses the recorded account rather than choosing again —
which also means a merchant's stored answer stays true if the configured
account changes later.

### 4.3 Read endpoints

- `GET /api/v1/payout/:reference_id` — one payout, the same shape as the
  create response's `data`, scoped to the authenticated merchant
- `GET /api/v1/payouts` — paged list, the standard `repository/base`
  list/sort/search contract, scoped to the authenticated merchant

Neither requires a signature. Only `create` moves money, and P3 already set
this rule: "x-api-key plus a single-use HS256 signature where money is
involved."

## 5. Data model

```sql
-- One row per payout a merchant has asked us to make.
--
-- P4a only ever writes PENDING. Every other status is admitted by the
-- CHECK now so that P4b and P4c do not have to widen it, which is the same
-- choice deposits_status made for COMPLETED.
CREATE TABLE payouts (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id         UUID NOT NULL REFERENCES merchants(id),
    client_id           UUID NOT NULL REFERENCES merchant_clients(id),
    reference_id        TEXT NOT NULL UNIQUE,
    transaction_id      TEXT NOT NULL,
    status              TEXT NOT NULL,

    -- The corporate account that will pay, chosen at creation from
    -- configuration and never re-chosen. See systemBankData above.
    bank_account_id     UUID NOT NULL REFERENCES bank_accounts(id),

    amount              NUMERIC(20,4) NOT NULL CHECK (amount > 0),

    -- The fee PostPayoutCreated actually reserved, persisted because
    -- PayoutInput.ReservedFee's own doc asks for it by name: "The full fix
    -- is P4 persisting this on the payout row." If the merchant's payout
    -- rate moves while this payout is in flight, a recomputed fee would
    -- settle a different figure than the reservation credited, stranding
    -- the difference in pending_payout forever.
    reserved_fee        NUMERIC(20,4) NOT NULL CHECK (reserved_fee >= 0),

    recipient_account_no TEXT NOT NULL,
    recipient_bank_code  TEXT NOT NULL,
    recipient_name       TEXT NOT NULL,
    recipient_phone      TEXT,

    callback_url        TEXT NOT NULL,

    -- Written by P4b. Declared now because the safety rule they encode is
    -- this design's central invariant and belongs in the schema from the
    -- start, not bolted on beside the code that depends on it.
    bank_order_id       TEXT,
    confirmed_at        TIMESTAMPTZ,
    failure_reason      TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT payouts_status CHECK (status IN (
        'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED',
        'NEEDS_REVIEW')),

    -- The invariant the whole design rests on, stated to the database
    -- rather than only to the reader: a payout cannot be confirmed at the
    -- bank without the order it was confirmed under.
    CONSTRAINT payouts_confirmed_needs_order CHECK (
        confirmed_at IS NULL OR bank_order_id IS NOT NULL)
);

-- A merchant's own order id is unique to that merchant, not globally --
-- the same rule, and the same reasoning, as deposits_merchant_transaction.
CREATE UNIQUE INDEX payouts_merchant_transaction
    ON payouts (merchant_id, transaction_id);

-- P4b's worker claims rows through this.
CREATE INDEX payouts_claimable ON payouts (created_at) WHERE status = 'PENDING';

CREATE INDEX payouts_merchant_created ON payouts (merchant_id, id DESC);
```

### 5.1 Why `bank_order_id` and `confirmed_at` exist in P4a

They are never written in this phase. They are declared now because they
carry the rule that decides whether money may be returned to a merchant:

> `confirmed_at IS NULL` — the bank was never told to pay. Releasing the
> reservation is safe.
>
> `confirmed_at IS NOT NULL` — the money may already be gone. Only positive
> evidence may resolve it. Nothing may release the reservation on the
> strength of an absence.

Adding them later, next to the code that needs them, would make it a coding
convention. Declaring them with the table, with a CHECK enforcing that a
confirmation always names its order, makes it a property of the data.

## 6. The create flow

The handler mirrors `merchantdeposit.Handler.create` step for step, because
the security properties it establishes are the ones this endpoint needs too
and were each found by a review rather than designed in:

1. `middleware.SignatureRequired` verifies the signature and buffers the
   exact body it covered (`SignedBodyFromContext`)
2. unmarshal and validate the DTO
3. refuse a non-HTTPS `callbackUrl` case-insensitively, before the service
   is reached
4. refuse `merchantId` naming anyone but the authenticated merchant — the
   body is caller-controlled
5. resolve `clientId` and refuse it if it belongs to another merchant —
   existing is only half the check
6. parse `amount` through `json.Number`
7. `idem.Begin(merchantID, transactionID, body)` claims the transaction
   before any side effect; a replay is served exactly as recorded
8. `payout.Service.Create(...)`
9. `idem.Finish(...)` records the answer; retryable failures `Release` the
   claim so "try again" stays true

Steps 1–7 and 9 are the deposit handler's, unchanged in substance. Step 8
is the new work.

### 6.1 Inside `Service.Create`

```
validate the request                        → 400
resolve the source account from config      → 503 if absent or not ACTIVE
open a transaction
    lock KindMerchantOperate for this merchant  ← serialises this merchant,
                                                   and is the balance read below
    insert the payout row as PENDING
    PostPayoutCreated                       → returns the fee it reserved
    amount + fee > balance                  → 422 ErrInsufficientBalance
    write reserved_fee back onto the row
commit
```

The balance the check compares against is `operate.Balance` as read AT LOCK
TIME, i.e. the figure from BEFORE this posting debited it — not a figure
recomputed after `PostPayoutCreated` runs, which would compare the
reservation against itself. The check runs after the insert and the posting,
not before them, because the fee is not knowable until `PostPayoutCreated`
has run. That ordering is safe only because all of it — the insert, the
posting, and the check — shares one transaction: when the balance check
fails, the posting and the inserted row are rolled back with everything
else, so an underfunded payout leaves no row behind and no ledger entry.
`TestCreate_Integration_AFailureLeavesNoRowAndNoEntry` is what proves the
rollback actually holds; do not trust this ordering without it.

The fee comes back from `PostPayoutCreated` rather than being computed by
this service: `PayoutInput.ReservedFee`'s doc is explicit that recomputing
it anywhere else is the mistake the field exists to prevent, and `chainFor`
is unexported.

### 6.2 The insufficient-balance guard

`ledger.Repository.MerchantBalances` takes no transaction — it reads on the
pool. Calling it and then debiting in a separate transaction lets two
concurrent payouts both pass the check and overdraw the merchant.

**No new repository method is needed.** `ledger_accounts.balance` is a
stored column, not a figure derived at read time, and P2b already ships the
primitive:

```go
// Both already exist on ledger.Repository.
EnsureMerchantAccount(ctx, tx, merchantID, KindMerchantOperate) (*Account, error)
LockAccounts(ctx, tx, []uuid.UUID) (map[uuid.UUID]*Account, error)  // SELECT ... FOR UPDATE ORDER BY id
```

So the guard is: ensure the merchant's `MERCHANT_OPERATE` account inside the
transaction, lock it, and read `Balance` off the locked row. That is a real
row lock on a row `Post` actually updates — not an advisory one — and it is
the **same lock `PostPayoutCreated` takes moments later in the same
transaction**, so no new locking regime is introduced.

Two concurrent payout creations for one merchant therefore serialise: the
second blocks on `operate` until the first commits, and then reads a balance
that already reflects the first reservation.

Lock ordering, since `LockAccounts`' own doc warns about it: every payout
creation takes `operate` first and then lets `Post` acquire its full set in
id order. Both contenders take the same first lock, so they queue rather
than deadlock. A concurrent `Post` from another flow acquires its accounts
inside one statement ordered by id; it can wait on `operate`, but this flow
never waits on an account that flow holds, so there is no cycle.

Scope of the guarantee, stated honestly: this serialises **payout
creation** against other payout creation for the same merchant, which is
the only automated, merchant-triggered path that debits `operate` at
volume. An admin adjustment posted concurrently does not take this lock
first and could in principle still overdraw; that is a human action against
a small number, visible in the ledger, and not worth serialising the admin
surface for. If a second automated debit path is ever added, it takes this
lock.

`ErrInsufficientBalance` already exists in `internal/domain/ledger/errors.go`,
declared and deliberately unreferenced, with a comment naming
`PostPayoutCreated` as the caller that will need it. This phase is that
caller. It maps to 422 through `errs.ErrUnprocessable`.

The comparison is against **amount + fee**, not amount alone, for the same
reason `PostPayoutCreated` reserves both: a merchant that can afford the
amount but not the fee cannot afford the payout.

### 6.3 Choosing the source account

```yaml
payout:
  # Off by default, like every money-moving switch since P3. While false,
  # POST /payout/create answers 503 and no payout row is ever written.
  enabled: false

  # bank_accounts.id of the corporate account payouts are paid from.
  #
  # Named explicitly rather than routed by tier: there is exactly one paying
  # account, and the PRD's systemBankData reflects that. Routing across a
  # pool of outbound accounts is a later problem.
  source_account_id: ""
```

**The id, not the name.** `bankaccount.Service` has no lookup by name and
`bank_accounts.name`, though unique, is editable — renaming an account in
the back office would silently repoint every future payout, or break payouts
outright. An id cannot be repointed by a rename, and `GetByID` already
exists, so this adds no new method to any port. `SelectOutbound` is not
usable here: it filters on `tier = 'OUTBOUND'`, of which there are none, and
it requires a balance fresher than `pool.balance_refresh_interval` from a
loop that is switched off.

Resolution rules:

- empty, unparseable, or naming an account that does not exist →
  `ErrNoSourceAccount`, 503. No payout row is created.
- the account is not `ACTIVE` → the same 503.
- the account's tier is not `OUTBOUND` → **log a warning and continue.**

The last rule is deliberate. There is no `OUTBOUND` account today, and
development uses the one registered `INBOUND` account for both directions.
Refusing would make the phase untestable; silently accepting would hide a
production misconfiguration. A warning on every create is loud enough to be
noticed and cheap enough to ignore in development.

`UNIQUE (bank_code, account_no)` on `bank_accounts` means one physical
account cannot hold both an `INBOUND` and an `OUTBOUND` row, which is why
tier is not the selector here.

### 6.4 `REJECTED` in this phase

`REJECTED` means "we never asked the bank" — the only terminal state P4a
can produce. In this phase nothing produces it: every refusal happens
before the row is inserted and is returned as an HTTP error instead.

It is defined here rather than in P4b because the distinction it draws is
part of the merchant contract: `rejected` says *we did not try*, `failed`
says *we tried and it did not work*. Both release the reservation; they
tell the merchant different things, and the PRD lists both.

## 7. Errors

| Condition | Sentinel | HTTP |
|---|---|---|
| amount not positive | `ErrAmountNotPositive` | 400 |
| amount unparseable | `errs.ErrInvalidInput` at the HTTP edge, as `merchantdeposit.parseAmount` already does — no domain sentinel, because a value that never became a `decimal.Decimal` never reached the domain | 400 |
| recipient account, bank or name missing | `ErrRecipientRequired` | 400 |
| callback not HTTPS | `ErrCallbackNotHTTPS` | 400 |
| `merchantId` or `clientId` not the caller's | `errs.ErrForbidden` | 403 |
| `transactionId` reused | `ErrDuplicateTransaction` | 409 |
| balance below amount + fee | `ledger.ErrInsufficientBalance` | 422 |
| no usable source account | `ErrNoSourceAccount` | 503 |
| `payout.enabled` is false | `ErrPayoutDisabled` | 503 |

Every sentinel wraps an `errs` sentinel, and `resp.Error` maps it. No
handler chooses a status code directly.

## 8. Testing

The gate is `make check` plus `make test-integration`.

What must be proven, beyond the ordinary cases:

- **the balance guard actually serialises.** Two concurrent `Create` calls
  for a merchant that can afford exactly one must produce exactly one
  payout and one 422 — proven against a real database with two
  transactions, not with mocks. A mock cannot fail this test.
- **the reservation is amount + fee.** A fixture where the fee is zero
  proves nothing; the merchant under test must sit at a non-zero payout
  rate, and the reserved figure must differ from the amount.
- **`reserved_fee` is what `PostPayoutCreated` returned**, not what the
  service recomputed. Change the merchant's rate between the reservation
  and the assertion and the stored figure must not move.
- **a rollback leaves nothing behind.** No payout row, no journal entry.
- **`journal_entries_reference_unique` refuses a second
  `PAYOUT_CREATED`** under one reference.
- **replaying a `transactionId` returns the recorded response**, not a
  fresh reference id.

Mutation testing applies as it did through P3: reviewers design their own
mutations rather than working a list, run them with `go test -overlay`
against modified copies, and treat a survivor as a finding about the tests.
Fixtures that make two values coincide — amount equal to fee, recipient
bank equal to source bank — silently disarm every swap mutation between
them and must be built to differ.

## 9. What this phase deliberately leaves broken

A payout created by P4a sits at `PENDING` forever and its money stays
reserved. There is no worker, no expiry, and no way to release it except an
admin ledger adjustment.

That is the correct end state for this phase, and it is safe: the money is
the merchant's own, it is visibly held in `pending_payout` rather than
lost, and `POST /payout/create` ships behind `payout.enabled: false` so no
merchant can reach it before P4b exists.
