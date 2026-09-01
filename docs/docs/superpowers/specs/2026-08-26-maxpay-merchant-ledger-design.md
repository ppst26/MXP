# Design: MaxPay — merchant, security and virtual ledger (P1 + P2)

Date: 2026-08-26
Status: approved (design), pending spec review

## 1. Goal

Give `be-maxpay` the foundation every later gateway phase stands on: the
merchants it serves, the credentials they authenticate with, the corporate
bank accounts money actually moves through, and the double-entry ledger that
records who owns what.

Nothing in this document moves money on its own. Deposits (P3), payouts (P4)
and webhooks (P5) do that, and they post to the ledger defined here rather
than inventing their own bookkeeping.

The reference contract is the MaxPay PRD in `../MaxPay` — in particular
`PRD/technical-term/Merchant/Merchant.md` (credentials, balance breakdown,
reseller tiers), `PRD/technical-term/payment-gateway-blueprint.md` (signature,
idempotency, SaaS layer) and `PRD/business/account-pool.md` (three-tier account
architecture).

## 2. Scope

In scope:

- merchant tree (root / reseller / direct), commercial rates
- merchant credentials: `merchantId`, `clientId`, `x-api-key`, `secretKey`
- HS256 single-use signature verification and replay rejection
- idempotency keys for money-moving requests
- back-office authentication for platform admins and merchant users
- three-tier bank account pool (inbound / vault / outbound), clusters, routing
- double-entry ledger: chart of accounts, journal, posting service
- fee and reseller rebate computation
- outbox job table and audit log
- `GET /merchant/balance`, plus the back-office endpoints listed in §11

Not in scope, and not possible when this lands:

| Missing | Phase |
|---|---|
| `POST /deposit/create`, PromptPay QR generation, statement matching | P3 |
| `POST /payout/create` and its bank execution | P4 |
| webhook dispatcher, AES payload hash, retry backoff, inquiry APIs | P5 |
| auto-sweep, rotation, JIT top-up, buffer alerts | P6 |
| back-office transaction screens | P7 |

What is demonstrable at the end of P1 + P2: build a merchant tree, issue and
rotate credentials, sign a request and have it accepted — then have the same
signature rejected, sign in to the back office as a platform admin and as a
reseller and see different data, attach a bank account to a pool and read its
real balance from the bank, and post a manual adjustment and watch the balance
move correctly at every level of the tree.

## 3. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Ledger shape | Full double-entry: accounts, entries, signed lines summing to zero | Money cannot be lost structurally; the reseller rebate is a line in the same entry rather than a separate job that can fail |
| Reseller tiers | Built now, not deferred | Retrofitting a hierarchy onto a ledger that already holds real money is materially harder |
| Merchant funding | Self-funding: completed deposits credit the merchant, payouts debit it | Matches the PRD's balance semantics; pre-funding and settlement are ordinary ledger entries |
| Queue | PostgreSQL outbox with `FOR UPDATE SKIP LOCKED` | Enqueue happens in the same transaction as the ledger write, so no job is lost and none runs against a rolled-back posting |
| Signature replay store | PostgreSQL table with a primary key | The service has no Redis (deviation 1); the guard belongs next to the money anyway |
| Secret key at rest | AES-256-GCM, key-encryption key from configuration | HMAC verification needs the plaintext, so a one-way hash is not an option |
| Back-office auth | Username + password, opaque session token in PostgreSQL | Deviation 1 again; no Redis to hold sessions |
| Merchant logins | Issued on demand by a platform admin, not created with the merchant | An API-only merchant should not carry a human account it never uses |
| Bank accounts in the ledger | Yes, one ledger account per bank account | Sweeps and top-ups move money between accounts without touching any merchant; without them that money leaves the books |

## 4. Domain model

Every feature package carries the six files the standard requires
(`entity.go`, `dto.go`, `errors.go`, `repository.go`, `service.go`,
`validator.go`), and money is `decimal.Decimal` throughout.

New packages:

```text
internal/domain/merchant      merchant tree, rates, status
internal/domain/credential    api keys, client ids, secret keys
internal/domain/signature     HS256 verification and replay rejection
internal/domain/idempotency   transaction-id guard
internal/domain/adminuser     back-office accounts and sessions
internal/domain/bankaccount   pool, clusters, routing
internal/domain/ledger        chart of accounts, journal, posting
internal/domain/outbox        background job queue
internal/domain/audit         audit trail
```

`internal/domain/device`, `session`, `account`, `transfer`, `instruction` are
untouched. `bank_accounts.device_id` points into the existing `devices` table;
one BizNext device (a corporate login plus PIN) can front several accounts of
that legal entity, which is why accounts are their own table rather than more
columns on `devices`.

### 4.1 `merchant`

```go
type Role string // ROOT | RESELLER | DIRECT

type PoolModel string // SHARED | DEDICATED

type Merchant struct {
    ID          uuid.UUID
    Code        string          // the merchantId given to the customer
    Name        string
    ParentID    uuid.UUID       // uuid.Nil for ROOT
    Role        Role
    PoolModel   PoolModel
    ClusterID   uuid.UUID       // uuid.Nil when DEDICATED
    DepositRate decimal.Decimal // 0.0150 == 1.50%
    PayoutRate  decimal.Decimal
    Status      string          // ACTIVE | SUSPENDED
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```

`Code` is generated as ten base62 characters, matching the shape the PRD's
examples use (`VOBM7qzaRH`). It is an identifier, not a secret.

Rules enforced in `validator.go`, not by convention:

1. A `DIRECT` merchant may not have children. The PRD calls this
   `CONSUMER_ONLY`; it is checked when a child is created, not when a screen
   is drawn.
2. A child's rate must be greater than or equal to its parent's rate, for both
   deposit and payout. Selling below cost makes the rebate negative, which is
   money flowing the wrong way.
3. Exactly one `ROOT` may exist, and only `ROOT` may have no parent.
4. The tree is at most two levels below `ROOT`. The PRD locks this to keep the
   ledger unambiguous.
5. Suspending a merchant does not cascade: a suspended reseller still earns
   rebate on downline traffic, because that money is already owed.

### 4.2 `credential`

Four values, stored three different ways because they are used three different
ways.

```sql
CREATE TABLE merchant_clients (
    id          UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    code        TEXT NOT NULL UNIQUE,   -- the clientId
    label       TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE merchant_credentials (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id    UUID NOT NULL REFERENCES merchants(id),
    api_key_hash   BYTEA NOT NULL UNIQUE,  -- sha256 of the full key
    api_key_prefix TEXT NOT NULL,          -- first 8 chars, for humans
    secret_key_enc BYTEA NOT NULL,         -- AES-256-GCM, nonce prefixed
    status         TEXT NOT NULL,          -- ACTIVE | REVOKED
    last_used_at   TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `merchantId` and `clientId` are plaintext identifiers.
- `x-api-key` arrives in a header and must be looked up by it, so it is hashed
  with SHA-256 rather than a password hash: the lookup has to be deterministic.
  The stored prefix exists so a person can tell two keys apart in the back
  office without the key itself ever being displayed again.
- `secret_key` is encrypted with AES-256-GCM under a key-encryption key read
  from `security.kek` (32 bytes, base64). The KEK never reaches the database.
  The blueprint asks for a vault; moving the KEK's source to one later changes
  no schema and no call site.

A merchant may hold several credentials at once. This is not optional
flexibility: with a single key there is no way to rotate one without an outage,
because the customer needs the new key working before the old one stops.

### 4.3 `adminuser` — who signs in to the back office

```sql
CREATE TABLE admin_users (
    id            UUID PRIMARY KEY DEFAULT uuidv7(),
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,          -- argon2id
    name          TEXT NOT NULL,
    merchant_id   UUID REFERENCES merchants(id),  -- NULL = platform admin
    is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    permissions   TEXT[] NOT NULL DEFAULT '{}',
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    status        TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_sessions (
    token_hash BYTEA PRIMARY KEY,        -- sha256 of the opaque token
    user_id    UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Both platform staff and merchants sign in here; `merchant_id` is what
separates them. A merchant user of any role — `DIRECT` included — can read its
own balance, ledger and transactions and rotate its own API key.
`CONSUMER_ONLY` in the PRD restricts what a direct merchant may do
*commercially* (no downline, no margin), not whether it may look at its own
money. A merchant that cannot see its own balance sends every question back to
the operator, which is the opposite of the zero-manual-review goal.

| Capability | DIRECT | RESELLER | PLATFORM_ADMIN |
|---|---|---|---|
| Own balance and ledger | yes | yes | all merchants |
| Own deposits and payouts | yes | yes | all merchants |
| View and rotate own API keys | yes | yes | yes |
| Downline list, their rates, rebate earned | no | yes | yes |
| Set downline rates | no | yes | yes |
| Bank account pool, adjustments, creating merchants above itself | no | no | yes |

Visibility is enforced in the repository layer with a recursive CTE over the
merchant tree, not in handlers. Endpoints keep arriving through P3–P7, and one
forgotten handler check means a merchant reads a competitor's figures.

```sql
WITH RECURSIVE subtree AS (
    SELECT id FROM merchants WHERE id = $1
    UNION ALL
    SELECT m.id FROM merchants m JOIN subtree s ON m.parent_id = s.id
)
SELECT ... WHERE merchant_id IN (SELECT id FROM subtree)
```

Sessions are opaque random tokens; only their SHA-256 is stored, so a database
read cannot be replayed as a login. Logins are issued by a platform admin
(`POST /admin/merchants/:id/users`) with a temporary password and
`must_change_password = true`. There is no 2FA in this phase.

### 4.4 Request guards

```sql
CREATE TABLE used_signatures (
    signature_hash BYTEA PRIMARY KEY,     -- sha256 of the whole JWT
    merchant_id    UUID NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX used_signatures_expiry ON used_signatures (expires_at);

CREATE TABLE idempotency_keys (
    merchant_id    UUID NOT NULL REFERENCES merchants(id),
    transaction_id TEXT NOT NULL,
    request_hash   BYTEA NOT NULL,
    status         TEXT NOT NULL,         -- IN_FLIGHT | DONE
    response_code  INT,
    response_body  JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ,
    PRIMARY KEY (merchant_id, transaction_id)
);
```

These solve different problems and both are needed. A signature guard stops the
same request being replayed. An idempotency key stops the same *payment* being
made twice — including by a merchant that legitimately retries after a timeout
with a fresh signature.

The idempotency guard carries unusual weight in this service. `AGENTS.md`
records that the bank has no idempotency key of its own and that a non-2xx from
a transfer endpoint does not mean the transfer did not happen. This table is
the only place a duplicate payout can be stopped.

### 4.5 `bankaccount` — the three-tier pool

```sql
CREATE TABLE account_clusters (
    id         UUID PRIMARY KEY DEFAULT uuidv7(),
    name       TEXT NOT NULL UNIQUE,
    status     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_accounts (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    device_id        UUID NOT NULL REFERENCES devices(id),
    account_no       TEXT NOT NULL,
    account_name     TEXT NOT NULL,
    bank_code        TEXT NOT NULL,
    tier             TEXT NOT NULL,   -- INBOUND | VAULT | OUTBOUND
    cluster_id       UUID REFERENCES account_clusters(id),
    merchant_id      UUID REFERENCES merchants(id),  -- NULL = shared pool
    promptpay_id     TEXT,                            -- INBOUND only
    status           TEXT NOT NULL,   -- ACTIVE | COOLING | SUSPENDED
    daily_amount_cap NUMERIC(20,4),
    daily_txn_cap    INT,
    min_balance      NUMERIC(20,4) NOT NULL DEFAULT 0,
    target_balance   NUMERIC(20,4) NOT NULL DEFAULT 0,
    bank_balance     NUMERIC(20,4),
    bank_balance_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (bank_code, account_no)
);

CREATE TABLE bank_account_daily_stats (
    account_id UUID NOT NULL REFERENCES bank_accounts(id),
    stat_date  DATE NOT NULL,
    in_amount  NUMERIC(20,4) NOT NULL DEFAULT 0,
    in_count   INT NOT NULL DEFAULT 0,
    out_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
    out_count  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, stat_date)
);
```

`bank_balance` is what the bank says, refreshed by a poller. The book balance
lives in the ledger (§4.6). Keeping them apart is deliberate: the two
disagreeing is the only signal that will ever reveal money arriving that the
system did not recognise, money leaving that did not go through it, or a
mismatched deposit.

An account with `merchant_id` set belongs to that merchant's dedicated pool and
is invisible to every other merchant. An account with `cluster_id` set and no
`merchant_id` serves every merchant assigned to that cluster.

### 4.6 `ledger`

```sql
CREATE TABLE ledger_accounts (
    id              UUID PRIMARY KEY DEFAULT uuidv7(),
    kind            TEXT NOT NULL,
    merchant_id     UUID REFERENCES merchants(id),
    bank_account_id UUID REFERENCES bank_accounts(id),
    normal_balance  TEXT NOT NULL,          -- DEBIT | CREDIT
    balance         NUMERIC(20,4) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ledger_accounts_merchant ON ledger_accounts (kind, merchant_id)
    WHERE merchant_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_bank ON ledger_accounts (kind, bank_account_id)
    WHERE bank_account_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_house ON ledger_accounts (kind)
    WHERE merchant_id IS NULL AND bank_account_id IS NULL;

CREATE TABLE journal_entries (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    type           TEXT NOT NULL,
    merchant_id    UUID REFERENCES merchants(id),
    reference_type TEXT,
    reference_id   TEXT,
    description    TEXT NOT NULL,
    created_by     TEXT NOT NULL,          -- admin user id, merchant code, or SYSTEM
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_lines (
    id           UUID PRIMARY KEY DEFAULT uuidv7(),
    entry_id     UUID NOT NULL REFERENCES journal_entries(id),
    account_id   UUID NOT NULL REFERENCES ledger_accounts(id),
    amount       NUMERIC(20,4) NOT NULL,   -- debit positive, credit negative
    balance_after NUMERIC(20,4) NOT NULL
);
CREATE INDEX journal_lines_entry ON journal_lines (entry_id);
CREATE INDEX journal_lines_account ON journal_lines (account_id, id DESC);
```

Chart of accounts:

| `kind` | Owner | Normal | Meaning |
|---|---|---|---|
| `BANK_ACCOUNT` | a bank account | DEBIT | our book balance for that account |
| `MERCHANT_OPERATE` | merchant | CREDIT | immediately spendable |
| `MERCHANT_PARKING` | merchant | CREDIT | set aside by an admin |
| `MERCHANT_FREEZE` | merchant | CREDIT | held over a dispute |
| `MERCHANT_PENDING_PAYOUT` | merchant | CREDIT | reserved against an unfinished payout |
| `HOUSE_REVENUE` | platform | CREDIT | our share of fees |
| `HOUSE_SUSPENSE` | platform | CREDIT | money in that could not be matched |

`GET /merchant/balance` reports the PRD's three figures, with
`freezeBalance = MERCHANT_FREEZE + MERCHANT_PENDING_PAYOUT`. Both are money the
merchant cannot spend; reporting them separately would break the PRD's own
identity `balance = operate + parking + freeze`.

`MERCHANT_PARKING` has no automation in this phase. An admin moves funds into
and out of it from the back office. Inventing an automatic rule the PRD does
not describe would be guessing about someone's money.

**The zero-sum rule is enforced by the database, at commit:**

```sql
CREATE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE
    target UUID;
    total  NUMERIC(20,4);
BEGIN
    -- NEW is NULL on DELETE, OLD is NULL on INSERT.
    target := COALESCE(NEW.entry_id, OLD.entry_id);

    SELECT COALESCE(SUM(amount), 0) INTO total
      FROM journal_lines WHERE entry_id = target;
    IF total <> 0 THEN
        RAISE EXCEPTION 'journal entry % does not balance: %', target, total;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_balanced
    AFTER INSERT OR UPDATE OR DELETE ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();
```

Deferred, because an entry is legitimately unbalanced between its first and
last line. Checked at commit, because a commit that does not balance must be
impossible regardless of what the calling code believes.

It fires on UPDATE and DELETE as well as INSERT. An earlier draft of this
section guarded INSERT alone, which left the rule trivially escapable: update
one line's amount after the fact, or delete one side of a balanced pair, and
the commit succeeds with money created from nothing. That was demonstrated
against a real database during P2b, not argued about.

`ledger_accounts.balance` is kept in the natural sign of the account: a
`DEBIT`-normal account adds the line amount, a `CREDIT`-normal account
subtracts it, so a merchant's operating balance reads as a positive number.
Rows are locked with `SELECT ... FOR UPDATE` ordered by `account_id` so
concurrent entries touching the same accounts cannot deadlock.

The only way to write to any of these three tables is:

```go
func (s *Service) Post(ctx context.Context, tx *sqlx.Tx, entry Entry, lines ...Line) error
```

No use case updates `ledger_accounts` directly.

### 4.7 Outbox and audit

```sql
CREATE TABLE outbox_jobs (
    id           UUID PRIMARY KEY DEFAULT uuidv7(),
    kind         TEXT NOT NULL,
    payload      JSONB NOT NULL,
    run_after    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts     INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_error   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX outbox_jobs_ready ON outbox_jobs (run_after) WHERE locked_until IS NULL;

CREATE TABLE audit_logs (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    actor_type       TEXT NOT NULL,       -- MERCHANT | ADMIN | SYSTEM
    actor_id         TEXT NOT NULL,
    action           TEXT NOT NULL,
    subject_type     TEXT NOT NULL,
    subject_id       TEXT NOT NULL,
    request_payload  JSONB,
    response_payload JSONB,
    trace_id         TEXT,
    ip               TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_subject ON audit_logs (subject_type, subject_id, created_at DESC);
```

Jobs are claimed with `FOR UPDATE SKIP LOCKED`. Enqueuing happens inside the
same transaction as the ledger posting, so a job cannot survive a rolled-back
entry and an entry cannot commit with its follow-up work missing.

`actor_type` is separate from `actor_id` because the question asked during an
incident is who ordered something, not what happened. Payloads are redacted
before they are written: `signature`, `secretKey` and `pin` never reach the
table. The service's logging rules already forbid them, and an audit log is not
an exception to that.

Two jobs exist in this phase: `refresh_account_balance` and `reconcile_daily`.

## 5. Migrations

```text
000002_merchants        merchants, merchant_clients, merchant_credentials
000003_admin_auth       admin_users, admin_sessions
000004_request_guards   used_signatures, idempotency_keys
000005_bank_accounts    account_clusters, bank_accounts, bank_account_daily_stats
000006_ledger           ledger_accounts, journal_entries, journal_lines, trigger
000007_outbox_audit     outbox_jobs, audit_logs
```

Each has a matching `.down.sql`. `devices` is not modified.

## 6. Signature verification

The PRD requires a JWT signed with HS256 whose claims are `merchantId`,
`clientId` and `iat` in milliseconds, matching a `timestamp` in the body.

```text
1. read x-api-key, hash it, load the credential and its merchant
2. decrypt secret_key with the KEK
3. parse the JWT with the algorithm pinned to HS256
4. claims.merchantId == body.merchantId == credential.merchant.code
   claims.clientId   == body.clientId   and belongs to that merchant
5. claims.iat == body.timestamp, to the millisecond
6. now - iat <= security.signature_ttl (default 60s)
   iat - now <= security.clock_skew    (default 5s)
7. INSERT INTO used_signatures (sha256(jwt), merchant_id, iat + ttl)
   unique violation -> replay -> 409
```

Step 3 pins the algorithm explicitly. An unpinned parser accepts `none` or an
RSA-signed token verified with the HMAC secret as its public key, which turns
a signature check into a formality. `github.com/golang-jwt/jwt/v5` is added as
a dependency and used with `jwt.WithValidMethods([]string{"HS256"})`.

Step 7 is a write, not a read followed by a write. Two concurrent replays of
the same signature both pass a `SELECT` check; only one survives a primary key.

Expired rows are removed by the outbox worker. At a 60-second window and 1,000
requests per second the table holds roughly 60,000 rows, which needs no
partitioning.

## 7. Idempotency

Applies to every request that creates a deposit or a payout.

```text
INSERT (merchant_id, transaction_id, request_hash, IN_FLIGHT)
  conflict?
    stored.status = IN_FLIGHT               -> 409, caller retries later
    stored.request_hash = this request hash -> replay stored response as-is
    otherwise                               -> 409, same id for a different request
  no conflict?
    run the use case, then update to DONE with the response
```

`request_hash` is SHA-256 over the canonical JSON of the request body with the
`signature` field removed — the signature legitimately differs between an
original and a retry, while the payment being described does not.

A crashed request leaves an `IN_FLIGHT` row. Rows older than
`security.idempotency_inflight_timeout` (default 5 minutes) are swept to a
terminal state by the outbox worker rather than blocking that transaction id
forever.

## 8. Account routing

### Inbound

Candidates: `ACTIVE` accounts of tier `INBOUND` that belong to the merchant
(dedicated) or to the merchant's cluster (shared), and that have not reached
`daily_amount_cap` or `daily_txn_cap` for the day. Chosen least-loaded by
today's `in_count`.

Satang collision is prevented by the database, not by a check:

```sql
CREATE UNIQUE INDEX deposits_pending_amount
    ON deposits (inbound_account_id, amount)
    WHERE status = 'PENDING';
```

The `deposits` table and this index both ship in P3, with migration
`000008`. The index is specified here because it is the routing contract that
P2's account selection is written against, and changing it later would change
how deposits are matched. Creating a deposit randomises the satang, inserts,
and on conflict re-randomises up to `pool.satang_retries` (default 5) before
moving to the next account in the pool. This is what round-robin is for in the
PRD: it widens the space of available amounts. If every account is exhausted
the request is refused with `503` — never satisfied with a duplicate amount,
which would match the wrong customer.

### Outbound

Candidates: `ACTIVE` accounts of tier `OUTBOUND` in the same cluster or
dedicated set, where `bank_balance >= amount + min_balance` and
`bank_balance_at` is newer than `pool.balance_max_age` (default 5 minutes). A
stale balance means unknown, not sufficient.

An account whose bank calls fail repeatedly is set to `COOLING` and skipped;
returning it to `ACTIVE` is a back-office action in this phase.

## 9. Posting rules

### Fee and rebate

The merchant pays `amount x merchant.rate`. Every ancestor keeps the difference
between the rate below it and its own:

```text
fee charged        = amount x merchant.rate
rebate to ancestor = amount x (rate of the level below it - its own rate)
house revenue      = amount x rate of the level directly below ROOT
```

A deposit of 1,000 for a direct merchant at 1.50% under a reseller at 0.70%:

```text
DR  bank_account:INB-01        1,000.00
CR  merchant:DIRECT:operate      985.00
CR  merchant:RESELLER:operate      8.00     (1.50% - 0.70%)
CR  house_revenue                  7.00     (0.70%)
                               ---------
                                   0.00
```

**Rounding.** Each share is computed with `decimal.Decimal` and rounded to two
places, then any remainder from rounding is added to `HOUSE_REVENUE` so the
entry sums exactly to zero. Without this rule the §4.6 constraint rejects any
amount whose fee does not divide evenly, and it would be found in production
rather than in review.

### Standard entries

| Event | Posting |
|---|---|
| deposit created | none — no money has moved |
| deposit matched | as above |
| deposit expired | none |
| unmatched money in | `DR bank_account / CR house_suspense` |
| payout created | `DR merchant:operate / CR merchant:pending_payout` for amount + fee |
| payout completed | `DR pending_payout / CR bank_account` for the amount, plus the fee split to reseller and house |
| payout failed | reverse of the reservation, in full, back to `operate` |
| sweep inbound to vault | `DR vault / CR inbound` — no merchant account moves |
| top-up vault to outbound | `DR outbound / CR vault` |
| merchant pre-funds | `DR bank_account / CR merchant:operate`, no fee |
| merchant withdraws | `DR merchant:operate / CR bank_account` |
| admin adjustment | type `ADJUSTMENT`, requires `created_by` and a reason |

The three internal transfers are why bank accounts have ledger accounts at all:
without them, sweeping money between corporate accounts would remove it from
the books.

## 10. Configuration

```yaml
security:
  kek: ""                          # base64, 32 bytes; required in production
  signature_ttl: 60s
  clock_skew: 5s
  idempotency_inflight_timeout: 5m
  session_ttl: 12h

pool:
  satang_retries: 5
  balance_max_age: 5m
  balance_refresh_interval: 60s

outbox:
  poll_interval: 1s
  max_attempts: 10
  batch_size: 20
```

`validateConfig` refuses to start in production without `security.kek`, in the
same way it already refuses without `app.api_keys`. A development default is
not provided: a shared default KEK is the same as no encryption.

## 11. HTTP surface

Merchant-facing, authenticated by `x-api-key` (and by signature where money
moves):

```text
GET  /api/v1/merchant/balance?merchantId=
```

Back office, authenticated by session:

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
POST   /api/v1/auth/change-password

GET    /api/v1/admin/merchants
POST   /api/v1/admin/merchants
GET    /api/v1/admin/merchants/:id
PATCH  /api/v1/admin/merchants/:id
POST   /api/v1/admin/merchants/:id/clients
POST   /api/v1/admin/merchants/:id/credentials
DELETE /api/v1/admin/merchants/:id/credentials/:credential_id
POST   /api/v1/admin/merchants/:id/users
GET    /api/v1/admin/merchants/:id/ledger
POST   /api/v1/admin/merchants/:id/adjustments

GET    /api/v1/admin/clusters
POST   /api/v1/admin/clusters
GET    /api/v1/admin/accounts
POST   /api/v1/admin/accounts
PATCH  /api/v1/admin/accounts/:id
```

`bo-maxpay` is already written against three of these. Its BFF posts to
`/auth/login` and expects `{success, code, data: {token, account}}` where
`account` carries `id`, `username`, `name`, `is_superadmin` and `permissions`;
`/auth/me` returns that same account object; `/auth/logout` takes an empty
body. Changing those shapes means changing `bo-maxpay/src/routes/api/auth/*`
and `src/hooks/use-auth.ts` in the same commit.

Two new middlewares: `MerchantAuth` resolves `x-api-key` to a merchant, and
`SignatureRequired` runs the §6 checks. They are applied per route group; the
existing `X-API-Key` guard on `/devices/*` is unchanged.

Every new endpoint ships a matching `.bru` file, as `AGENTS.md` requires.

## 12. Error contract

The existing rule — an upstream 4xx becomes a `502` carrying the bank's
trimmed code and message — applies to `/devices/*`, which relays the bank.
Gateway endpoints do not relay the bank and must not leak that KTB is behind
them.

| Situation | Status |
|---|---|
| unknown or revoked `x-api-key` | 401 |
| merchant suspended | 403 |
| bad or expired signature | 401 |
| signature already used | 409 |
| duplicate `transactionId`, identical body | 200 with the stored response |
| duplicate `transactionId`, different body | 409 |
| insufficient merchant balance | 422 |
| no account in the pool can serve the request | 503 |
| bank unreachable or failing | 503, generic message, body logged with `trace_id` |

409 rather than 401 for a replayed signature is deliberate: the two ask
opposite things of the caller. One means stop sending this, the other means
your credentials are wrong.

New sentinels in `internal/shared/errs`, each wrapping an existing one so the
`resp` mapping keeps working:

```go
ErrSignatureInvalid    = fmt.Errorf("signature invalid: %w", ErrUnauthorized)
ErrSignatureReplayed   = fmt.Errorf("signature already used: %w", ErrConflict)
ErrIdempotencyConflict = fmt.Errorf("transaction id reused: %w", ErrConflict)
ErrMerchantSuspended   = fmt.Errorf("merchant suspended: %w", ErrForbidden)
ErrNoAccountAvailable  = fmt.Errorf("no account available: %w", ErrUnavailable)
ErrInsufficientBalance = fmt.Errorf("insufficient balance: %w", ErrUnprocessable)
```

`ErrUnauthorized`, `ErrConflict`, `ErrForbidden` and `ErrUnavailable` already
exist. `ErrUnprocessable` does not: `errs` has no 422 today, and `resp`'s
status mapping has no case for it. Both need one line added.

That is a change to two files the platform standard shares, which `AGENTS.md`
allows provided the reason is recorded. The reason: a payout refused for
insufficient balance is a well-formed, authenticated, authorised request that
the current state cannot satisfy. Reporting it as `400` tells the caller to fix
its request, and reporting it as `409` tells it to resolve a conflict; both
send an integrator looking in the wrong place. This change stays in
`be-maxpay` and is not ported back to `go-template`.

## 13. Testing

Unit tests, as the standard requires, for domain validation, service behaviour
and repository behaviour with `sqlmock`.

`ledger` additionally carries a property test: thousands of random amounts and
rate combinations, asserting that every generated entry sums to zero and that
each party's share matches an independent calculation. Rounding bugs surface
here or in production, and nowhere in between.

Four behaviours cannot be tested with `sqlmock`, because they are guarantees
made by PostgreSQL rather than by Go, and they are the guarantees this design
relies on most:

1. the deferred constraint trigger rejecting an unbalanced commit
2. the partial unique index rejecting a duplicate pending amount
3. `FOR UPDATE SKIP LOCKED` handing one job to exactly one worker
4. concurrent payouts against one merchant debiting the balance correctly

An integration harness is therefore added: build tag `integration`, running
against the compose PostgreSQL with migrations applied, plus a
`make test-integration` target and a CI job. This is new to the repository —
today every repository test uses `sqlmock`.

## 14. Verification gate

`make check` (tidy-check, vet, build, lint, test-race), then
`make test-integration`, then the Bruno collection updated for every new
endpoint.

## 15. Follow-on work

- The KEK is read from configuration. Moving it to a managed vault is a change
  of source, not of schema, and should happen before production traffic.
- `PARKING` is manual by design here; if an automatic policy is wanted it needs
  its own decision, not an inferred one.
- Returning a `COOLING` account to `ACTIVE` is manual. Automatic recovery
  belongs with the rest of the pool automation in P6.
- Rebate is posted per transaction. If reseller volumes make that a hot row,
  the aggregation strategy should be decided against measurements rather than
  in advance.
