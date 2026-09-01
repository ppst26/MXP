# Design: MaxPay P3 — deposits, PromptPay QR and statement matching

Date: 2026-08-27
Status: approved (design), pending spec review

## 1. Goal

Take money in. P0–P2b built the merchants, the credentials, the corporate
bank account pool and the ledger that records who owns what; none of them
moves a satang on their own. This phase is the first that does.

A merchant asks for a deposit, its customer pays into one of our corporate
KTB accounts, we notice the money arriving, we credit the merchant in the
ledger, and we tell the merchant. Everything here posts through
`ledger.Service.Post` rather than inventing its own bookkeeping.

The reference contract is the MaxPay PRD in `../MaxPay` — in particular
`PRD/technical-term/Deposit/CreateDeposit.md` (request and response fields),
`PRD/technical-term/Deposit/Deposit.md` (both flows and the webhook payloads)
and `PRD/technical-term/Deposit/Deposit Webhook Callback.md`.

## 2. Scope

In scope:

- `POST /deposit/create` for both deposit types, `QR` and `TRANSFER`
- PromptPay EMVCo payload generation, targeting a corporate tax ID
- randomised satang amounts, with collision refused rather than guessed
- statement ingestion from KTB, persisted row by row
- a matching engine that fails closed when a row is ambiguous
- ledger postings for a matched deposit and for money that matches nothing
- deposit expiry
- webhook delivery to the merchant, including the AES hash that lets the
  merchant verify it — see §9 for why this moved out of P5
- inquiry endpoints: one deposit by reference, and a merchant's list

Not in scope:

| Missing | Phase |
|---|---|
| `POST /payout/create` and its bank execution | P4 |
| webhook delivery history, manual replay, per-merchant delivery config | P5 |
| auto-sweep, rotation, JIT top-up, buffer alerts | P6 |
| back-office deposit screens | P7 |

What is demonstrable at the end of P3: a merchant signs a `/deposit/create`
request, receives a PromptPay payload, a human scans it with a banking app and
pays, and within one polling interval the merchant's ledger balance moves and
a signed webhook arrives at its callback URL.

## 3. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Matching architecture | Statement rows are the source of truth; deposits are matched **to** rows | Money that matches nothing still exists and must land somewhere; a deposit-driven scan cannot see it |
| Ambiguous rows | Match nothing, mark the row, alert a human | Crediting the wrong merchant is far harder to unwind than making a customer wait |
| Polling cadence | Fast while a deposit is pending, slow floor always | The slow floor is what discovers money nobody asked for; the fast tier is what makes a deposit feel instant |
| QR target | PromptPay tax ID, 13 digits, sub-tag `02` | A corporate account registers its PromptPay proxy with the tax ID; the account number is not a PromptPay target |
| QR library | Generated in-process, never from a hosted service | A deposit that depends on a third party's uptime is a gateway that is down when they are |
| Satang randomisation | Add 0.01–1.99, never subtract | A deposit that credits more than requested is not a complaint; one that credits less is |
| Amount collision | Refused by a partial unique index, retried, then refused outright | Issuing a QR we already know will be ambiguous is worse than refusing to issue one |
| Webhook | Delivered in P3, hash included | A merchant that integrates against an unverifiable webhook keeps that code after we add the hash |

## 4. Domain model

Two new packages: `internal/domain/deposit` and `internal/domain/statement`.
Both carry the standard six files. Money is `decimal.Decimal` throughout.

The two tables reference each other — a deposit names the row that completed
it, and §7 requires both to change in one transaction. The migration therefore
creates `bank_statement_lines` first and `deposits` second, which is the
opposite of the order they are described in below: the reading order follows
the merchant's journey, the creation order follows the dependency.

### 4.1 `deposits`

```sql
CREATE TABLE deposits (
    id                  UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id         UUID NOT NULL REFERENCES merchants(id),
    client_id           UUID NOT NULL REFERENCES merchant_clients(id),
    reference_id        TEXT NOT NULL UNIQUE,
    transaction_id      TEXT NOT NULL,
    type                TEXT NOT NULL,
    status              TEXT NOT NULL,
    bank_account_id     UUID NOT NULL REFERENCES bank_accounts(id),

    requested_amount    NUMERIC(20,4),
    deposit_amount      NUMERIC(20,4),

    customer_account_no TEXT NOT NULL,
    customer_bank_code  TEXT NOT NULL,
    customer_name       TEXT NOT NULL,
    customer_phone      TEXT,

    qr_payload          TEXT,
    callback_url        TEXT NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,

    matched_line_id     UUID REFERENCES bank_statement_lines(id),
    matched_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT deposits_type CHECK (type IN ('QR', 'TRANSFER')),
    CONSTRAINT deposits_status CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED')),

    -- A QR deposit is defined by the amount its customer will pay; a TRANSFER
    -- deposit has no amount until the money arrives.
    CONSTRAINT deposits_qr_has_amount CHECK (
        type <> 'QR' OR (requested_amount IS NOT NULL AND deposit_amount IS NOT NULL AND qr_payload IS NOT NULL)),

    -- A completed deposit must name the row that completed it, and a deposit
    -- that is not completed must not.
    CONSTRAINT deposits_matched_when_completed CHECK (
        (status = 'COMPLETED') = (matched_line_id IS NOT NULL))
);

CREATE UNIQUE INDEX deposits_merchant_transaction
    ON deposits (merchant_id, transaction_id);

-- The rule that makes QR matching unambiguous, enforced by the database
-- rather than by the code that generates the amount: one corporate account
-- cannot hold two pending deposits for the same satang amount.
CREATE UNIQUE INDEX deposits_pending_amount
    ON deposits (bank_account_id, deposit_amount)
    WHERE status = 'PENDING' AND deposit_amount IS NOT NULL;

CREATE INDEX deposits_pending_expiry ON deposits (expires_at) WHERE status = 'PENDING';
CREATE INDEX deposits_merchant_created ON deposits (merchant_id, id DESC);
```

`reference_id` is the ten-character identifier returned to the merchant and
used for inquiry, generated the same way `merchants.code` is.

`transaction_id` is the merchant's own order id. It is unique **per merchant**,
not globally: two merchants may legitimately use the same order numbering.

### 4.2 `bank_statement_lines`

```sql
CREATE TABLE bank_statement_lines (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
    fingerprint     TEXT NOT NULL,

    amount          NUMERIC(20,4) NOT NULL,
    direction       TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,

    counterparty_account TEXT,
    counterparty_bank    TEXT,
    counterparty_name    TEXT,

    raw             JSONB NOT NULL,

    match_status    TEXT NOT NULL DEFAULT 'UNMATCHED',
    matched_at      TIMESTAMPTZ,
    settled_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT statement_direction CHECK (direction IN ('CREDIT', 'DEBIT')),
    CONSTRAINT statement_match_status CHECK (
        match_status IN ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'SUSPENSE', 'IGNORED'))
);

-- The same row seen twice must be recognised as the same row. See §6 on
-- what a fingerprint is made of, and why that cannot be settled until a real
-- statement response has been captured.
CREATE UNIQUE INDEX statement_lines_fingerprint
    ON bank_statement_lines (bank_account_id, fingerprint);

CREATE INDEX statement_lines_unmatched
    ON bank_statement_lines (bank_account_id, occurred_at)
    WHERE match_status = 'UNMATCHED';
```

`raw` keeps the bank's own JSON for the row verbatim. It costs little and it
is the only thing that can answer "what did the bank actually say" after a
dispute — the same reasoning that put the wire capture in P2b.

`match_status` values mean:

| Value | Meaning |
|---|---|
| `UNMATCHED` | not yet attributed; the matcher will try again next pass |
| `MATCHED` | attributed to exactly one deposit, which is now `COMPLETED` |
| `AMBIGUOUS` | matched more than one pending deposit; a human must decide |
| `SUSPENSE` | aged out without a match; posted to `HOUSE_SUSPENSE` |
| `IGNORED` | a debit, or a credit that is our own internal transfer |

## 5. PromptPay QR generation

`internal/service/deposit/promptpay.go`, generated in-process.

The payload is EMVCo TLV — each field is a two-digit tag, a two-digit length,
and a value, concatenated, with a CRC over everything including its own tag
and length:

```text
000201                          payload format indicator
010212                          point of initiation: 12 = dynamic, single use
2937                            PromptPay merchant account information
    0016A000000677010111        AID
    0213<13-digit tax id>       sub-tag 02: national ID / tax ID
5303764                         currency THB
54<len><amount>                 amount, two decimal places
5802TH                          country
6304<CRC>                       CRC-16/CCITT-FALSE, uppercase hex
```

`010212` is not cosmetic. `11` marks a QR that may be scanned repeatedly; `12`
marks one that carries an amount and is used once. Emitting `11` on a QR with
an amount invites a customer to pay it twice, and the second payment matches
nothing.

**The PromptPay id's format decides its sub-tag, so the format is enforced on
the way in rather than inferred on the way out.** `bank_accounts.promptpay_id`
accepts exactly three shapes: 10 digits beginning `0` (a mobile number,
emitted as sub-tag `01` after rewriting to `0066` plus the last nine digits),
13 digits (a national or tax id, sub-tag `02`, emitted verbatim), or 15 digits
(an e-wallet id, sub-tag `03`). Length alone then decides, with nothing to
guess. P3 uses the 13-digit corporate tax id; the other two are validated but
unexercised.

### Verification, in three layers

1. **CRC against published EMVCo test vectors.** Proves the checksum
   algorithm, which is the one part where a single wrong bit makes every QR
   in the system unscannable, silently, in the customer's hand.
2. **Parse back.** A TLV reader reads our own payload and must recover the
   same tax id, the same amount and the same sub-tag. This catches a wrong
   tag, a wrong length prefix and a wrong field order — none of which the CRC
   notices.
3. **One real scan, before the feature is enabled.** The first two layers
   prove we did what we understood; only a banking app proves we understood
   correctly. This is the same gate P2b learned to demand for
   `ParseBankBalance`, and it is not optional.

**The PRD's sample payload is not a test vector.** Its string encodes an
amount of `1.54` (`54041.54`) while its own `depositAmount` field says
`99.54`. It is internally inconsistent and must not be used to validate the
generator. Its mobile-number transformation — `0955157457` rendered as
`0066955157457` — is consistent and does confirm that rule.

### Amount randomisation

The merchant's requested amount plus a random 0.01 to 1.99. The PRD describes
±1.99; this design adds only, on the grounds that a customer who pays a little
more than the order and is credited what they paid has nothing to dispute,
while one credited less does. That halves the value space from 398 to 199 per
base amount, which is the one reason to revisit it: if `pool.satang_retries`
starts exhausting in practice, widening to ± is the first lever, and it is a
change to one function.

The generated amount is offered to the database. `deposits_pending_amount`
accepts it or rejects it. On rejection the service tries again, up to
`pool.satang_retries` (default 5), and then refuses the deposit with a
`409`. The refusal is deliberate: a QR issued into a known collision produces
a payment we have already decided we cannot attribute.

## 6. Statement ingestion

`GET /v1/transaction-history/accounts/{accountRefId}` is the only statement
source, and it shapes this design in two ways.

**It is keyed on `accountRefId`.** That is the bank's own unmasked identifier,
already stored on `bank_accounts.account_ref_id` by P2b for exactly this class
of reason. An account without one cannot be polled, the same way it cannot
have its balance refreshed.

**It has no date filter.** The only controls are `pageSize`, `pageNumber` and
a descending sort by transaction date. Ingestion therefore reads the first
page, walks backwards while it is still seeing rows it has not stored, and
stops at the first page that is entirely known. A row is known by its
fingerprint.

### The real response shape, captured 2026-08-28

A genuine `GET /v1/transaction-history/accounts/{accountRefId}` response is now
in hand, and `internal/service/deposit/testdata/transaction_history.json` holds
a redacted copy of it. What it says replaces every guess this section used to
carry.

```json
{
  "content": [
    {
      "transactionIndex": "17074203241",
      "transactionRefId": "17074203241",
      "transactionDateTime": "2026-08-27T22:29:01+07:00",
      "transactionCode": "NBIDSD",
      "descriptionName": "โอนเงินเข้าพร้อมเพย์",
      "descriptionChannel": "KTB netbank",
      "transactionComment": "TR To NATID 0203555007074",
      "withdraw": null,
      "deposit": 1,
      "ledgerBalance": 17,
      "currency": "THB",
      "transactionType": "Deposit",
      "paymentRef": null
    }
  ],
  "pageable": { "totalPages": 1, "last": true, "numberOfElements": 14,
                "totalElements": 14, "pageSize": 40, "pageNumber": 0,
                "prevCursor": null, "nextCursor": null }
}
```

**The fingerprint is `transactionIndex`.** It is a stable, monotonic per-account
identifier — the capture shows `…241`, `…240`, `…239` in descending order — and
`transactionRefId` carries the same value in every row seen. Nothing needs to be
composed out of date, amount and counterparty the way the PRD's `checkStr`
suggested. `Fingerprint` still returns an error rather than a fallback when the
field is missing, for the reason it always did: a row stored under a guessed key
is either a duplicate credit or a missed one.

**Direction is two nullable fields, not a sign.** A credit sets `deposit` and
leaves `withdraw` null; a debit does the reverse and carries a **negative**
`withdraw`. `transactionType` says `Deposit` or `Withdraw` in words. Read the
type, and take the magnitude from whichever field is populated.

**Pagination is richer than assumed.** `pageable.last` and `pageable.totalPages`
end the walk cleanly, so the ingester does not have to infer the end from a page
of already-known rows. `nextCursor` and `prevCursor` exist and were null for a
single-page account; whether they populate at scale is unknown and the
page-number walk remains the contract until someone sees them non-null.

### The counterparty lives in free text, and only sometimes

There is **no counterparty account field at all** — masked or otherwise. The
only place a sender ever appears is `transactionComment`, and what it holds
depends entirely on how the money arrived:

| How the money arrived | `transactionCode` | `transactionComment` |
|---|---|---|
| Inter-bank transfer in (ORFT) | `IORSDT` | `004-2353990384~ Future Amount: 50 ~ Tran: IORSDT` |
| Mobile-banking transfer in | `MORISD` | `TR fr 004-0611287194` |
| PromptPay transfer in | `NBIDSD` | `TR To NATID 0203555007074` |
| Some deposits | — | empty string |

**Three grammars, and there is no reason to believe that is all of them.** Each
carries the sender differently or not at all: `IORSDT` puts
`<bank>-<account>` first and appends its own trailer, `MORISD` prefixes
`TR fr `, and `NBIDSD` names the recipient instead of the sender. The third was
discovered only because a second capture was taken after a real transfer; a
parser written against the first capture alone would have failed on it silently.

So the counterparty parser is written as a table of known `transactionCode`
grammars, and **an unrecognised code yields no counterparty rather than a
guess** — the row is still ingested and still reaches `SUSPENSE`, which is the
outcome for an unattributable credit anyway. Adding a grammar is then a data
change with a fixture behind it, not a rewrite.

The ORFT form is `<3-digit bank code>-<account number>` and it is **not masked**
— the capture carries full ten-digit account numbers. That is the opposite of
what the PRD's example implied, and it is good news: `TRANSFER` matching by
sender account is possible after all, by parsing that prefix.

But two rows in the same capture carry no sender at all. The PromptPay row names
`NATID 0203555007074`, which is **our own** tax id — the recipient, not the
sender — and one deposit of 500 has an entirely empty comment. So:

- **A `QR` deposit is matched on amount alone**, because a PromptPay credit
  carries no sender to match on. That is precisely why the satang randomisation
  exists, and this capture is the evidence that it has to.
- **A `TRANSFER` deposit can only be matched when the customer pays by
  inter-bank transfer.** If that customer pays by PromptPay instead, the row
  arrives with nothing to attribute it by, and it must fall to `SUSPENSE` and a
  human rather than be guessed at. The merchant-facing documentation has to say
  so; a `TRANSFER` deposit is not a promise that any payment method will match.

Parsing `transactionComment` is string-handling against a bank's free text, so
it is one function, driven by the fixture, returning an error rather than a
guess — the same shape the fingerprint has, for the same reason.

### Satang survive — confirmed 2026-08-28

The first capture contained only whole-baht amounts, which left the `QR`
design's central assumption unproven. A real transfer of **5.35** was then made
into the corporate account and captured:

```json
{ "transactionDateTime": "2026-08-28T12:05:27+07:00",
  "transactionCode": "MORISD",
  "transactionComment": "TR fr 004-0611287194",
  "deposit": 5.35, "withdraw": null, "ledgerBalance": 22.35,
  "transactionType": "Deposit" }
```

`deposit` arrives as the JSON number `5.35`, unrounded and untruncated, and the
running `ledgerBalance` carries the satang too. **`QR` matching by exact amount
is viable.**

One consequence for the implementation, and it is not optional: `5.35` has no
exact binary representation, so the amount must be read from the **literal text
of the JSON number** and handed straight to `decimal.NewFromString` — never
decoded into a `float64` on the way. `internal/service/bankaccount/balance.go`'s
`decodeAmount` already does exactly this for balances and is the pattern to
follow.

### Cadence

Two tiers, both driven by the existing outbox worker:

| Tier | Interval | Covers |
|---|---|---|
| Active | `deposit.poll_interval_active` (default 10s) | accounts with at least one `PENDING` deposit |
| Floor | `deposit.poll_interval_floor` (default 3m) | every `ACTIVE` INBOUND account, always |

The floor is not a fallback. It is what discovers money that arrived with no
deposit behind it — an over-payment, a customer paying an expired QR, a
transfer nobody announced. Without it those never enter the books at all.

Each tier enqueues one job per account, and the jobs are idempotent: ingesting
the same page twice stores nothing new, because the fingerprint index refuses
it.

## 7. The matching engine

Runs after each ingestion pass, over `UNMATCHED` credit rows for that account,
oldest first.

For one row, candidate deposits are those that are `PENDING`, on the same
`bank_account_id`, with `expires_at` at or after the row's `occurred_at`, and:

- **QR** — `deposit_amount` equals the row's amount exactly.
- **TRANSFER** — the `<bank code>-<account number>` parsed out of the row's
  `transactionComment` equals the customer's declared account, and the row's
  amount is within the merchant's declared bounds if it declared any. A row
  whose comment carries no sender — a PromptPay credit, or the empty comment
  the capture also contains — has no candidates by this rule and ages into
  `SUSPENSE`. See §6: that is a property of how the customer chose to pay, not
  a defect, and the merchant-facing documentation must say so.

Then, and this is the whole engine:

| Candidates | Outcome |
|---|---|
| exactly one | row `MATCHED`, deposit `COMPLETED`, ledger posted, webhook enqueued |
| more than one | row `AMBIGUOUS`, **nothing else changes**, alert |
| none | row stays `UNMATCHED` and is retried next pass |

A row that is still `UNMATCHED` after `deposit.suspense_after` (default 24h)
is posted to `HOUSE_SUSPENSE` and marked `SUSPENSE`. It is not deleted and not
hidden; a human can still attribute it, and doing so is a reversal and a
re-posting, not an edit.

**Everything the matcher does happens in one transaction** — the row's status,
the deposit's status, the ledger entry and the webhook job. Either a merchant
is credited and told, or nothing happened. The outbox's transactional enqueue
exists for this.

The matcher is also replayable. It reads rows and deposits and writes
attributions; it never asks the bank anything. A matching bug is fixed by
correcting the matcher and running it again, not by re-polling.

## 8. Ledger postings

Nothing new. P2b's constructors already cover every case here.

| Event | Posting |
|---|---|
| deposit created | none — no money has moved |
| deposit matched | `PostDepositMatched`: `DR bank_account / CR merchant:operate` net, plus the rebate and house lines |
| deposit expired | none |
| row aged into suspense | `PostUnmatchedIn`: `DR bank_account / CR house_suspense` |
| a suspense row later attributed by hand | reverse the suspense posting, then `PostDepositMatched` |

The last row is the reason `SUSPENSE` is a status and not a deletion.

## 9. Webhook

The spec for P1+P2 placed the webhook dispatcher in P5. This design moves
delivery — and only delivery — into P3, for three reasons.

A deposit that completes without telling the merchant has not, from the
merchant's side, happened at all; P3 without delivery is not a usable phase.
The retry machinery P5 was to build already exists in the P2a outbox worker:
attempts, exponential backoff, and burial after `outbox.max_attempts`. And a
merchant that integrates against an unverifiable webhook writes code that does
not verify, and keeps it after a hash is added later — the window does not
close by adding the field.

P5 keeps delivery history, manual replay, inquiry APIs and per-merchant
delivery configuration. Those are real and still needed.

The payloads follow the PRD verbatim, including `hash`: AES-256 of the
`transactionId`, keyed by `API_KEY + SECRET_KEY` concatenated, so the merchant
can decrypt it with credentials only it and we hold.

Delivery is an outbox job of kind `deliver_deposit_webhook`. A non-2xx
response returns an error, and the worker's existing backoff decides when to
try again. `callback_url` must be HTTPS, checked at deposit creation, not at
delivery.

## 10. HTTP surface

Merchant-facing, `x-api-key` plus a single-use HS256 signature where money is
involved:

```text
POST /api/v1/deposit/create
GET  /api/v1/deposit/:reference_id
GET  /api/v1/deposits
```

Back office, session-authenticated:

```text
GET  /api/v1/admin/statement-lines
POST /api/v1/admin/statement-lines/:id/attribute
GET  /api/v1/admin/deposits
```

`attribute` is how a human resolves an `AMBIGUOUS` or `SUSPENSE` row. Platform
administrators only — a reseller may read its subtree's deposits, but
attributing money is the platform's act, the same boundary P2b drew between
reading a ledger and adjusting it.

Request and response fields for `/deposit/create` follow
`PRD/technical-term/Deposit/CreateDeposit.md` exactly, including the
`data.referenceId`, `data.depositAmount`, `data.qrcode`, `data.expireDate` and
`data.customerData` shapes, so a merchant already integrated against the PRD
needs no changes.

Every new endpoint ships a `.bru` file.

## 11. Configuration

```yaml
deposit:
  poll_interval_active: 10s
  poll_interval_floor: 3m
  suspense_after: 24h
  min_timeout: 5m
  max_timeout: 60m
  qr_enabled: false        # off until one real scan has succeeded
```

`qr_enabled` defaults to false for the same reason
`pool.balance_refresh_enabled` does: a generator that has never been scanned
by a real banking app is not known to work, and a QR that cannot be scanned
fails in the customer's hand rather than in ours.

## 12. Error contract

Unchanged from P1. A merchant-facing refusal is a 4xx wrapping a shared
sentinel; an upstream bank refusal is a `502` carrying the bank's own status
and code but never its body. New cases:

| Case | Status |
|---|---|
| `transactionId` already used by this merchant | 200 with the original deposit — idempotent, not an error |
| satang collision after `satang_retries` | 409 |
| no INBOUND account can serve this merchant | 503 |
| `callbackUrl` not HTTPS | 400 |
| `timeout` outside `min_timeout`..`max_timeout` | 400 |

## 13. Testing

Unit tests for domain validation, service behaviour and repositories with
`sqlmock`, as the standard requires. Beyond that, four things this phase
cannot be trusted without:

1. **The QR generator against published EMVCo vectors**, plus a parse-back
   test, plus a recorded real scan.
2. **The fingerprint and the row parsers against a captured KTB response.**
   Not a hand-written fixture — a real one. If none exists, the parser is not
   written yet.
3. **The matcher's three outcomes**, each proven by a test that fails when the
   outcome is changed: one candidate credits exactly one merchant, two
   candidates credit nobody, zero candidates leave the row alone.
4. **Ingestion idempotency, against a real database.** Ingesting the same page
   twice must store nothing the second time, and that is a promise the unique
   index makes, not the Go code.

The integration harness, `-tags=integration` with `-race -p 1`, already exists.

## 14. Verification gate

`make check`, then `make test-integration`, then the Bruno collection updated
for every new endpoint, then — before `qr_enabled` is turned on anywhere — a
human scans a generated QR with a real banking app and sees the correct
recipient and amount.

## 15. Follow-on work

- The counterparty grammars are known for three `transactionCode` values and
  unknown for every other. Each new channel a merchant's customers actually use
  will surface as unattributed credits in `SUSPENSE`, which is the safe outcome
  but also the only signal — a report of suspense rows grouped by
  `transactionCode` is the cheapest way to find the next grammar worth adding.
- A `TRANSFER` deposit whose customer pays by PromptPay cannot be attributed at
  all, because the row carries no sender. Whether to keep offering `TRANSFER` as
  a type, restrict it to inter-bank payment in the documentation, or require an
  expected amount, is a contract decision for P3b rather than an implementation
  detail.
- Statement rows accumulate without bound. A retention policy needs
  measurements, not a guess made now.
- `deposit.poll_interval_active` at 10 seconds is a starting point chosen for
  responsiveness, not from any measurement of KTB's tolerance. It should be
  raised at the first sign of throttling, and the wire capture is how that
  sign will be seen.
