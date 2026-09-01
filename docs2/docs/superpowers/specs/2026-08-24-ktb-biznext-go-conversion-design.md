# Design: KTB BizNext API — Node.js → Go conversion

Date: 2026-08-24
Status: approved (design), pending spec review

## 1. Goal

Rewrite the Express/SQLite service in `src/` as a Go service built on the
`go-template` platform standard, preserving every upstream call to Krungthai
BizNext byte-for-byte while replacing the transport, storage, and error
handling with the template's conventions.

The upstream bank contract is the part that must not change. Everything the
service exposes to its own callers is allowed to change, and does.

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Database | PostgreSQL (template standard); one-off import from `biznext.db` |
| API surface | Template conventions — `/api/v1`, snake_case JSON, `{success, code, data}` envelope, real 4xx/5xx |
| Caller authentication | `X-API-Key` header checked against a config allow-list |
| Location | New project `ktb-biznext-api/`, copied from `go-template`, module renamed |
| PIN encryption at rest | Out of scope for this conversion; recorded in §12 as future work |

## 3. Project layout

```text
ktb-biznext-api/
├── cmd/app/main.go
├── db/migrations/000001_init.{up,down}.sql
├── scripts/import_sqlite.go          one-off biznext.db -> Postgres import
├── internal/
│   ├── app/module.go
│   ├── domain/
│   │   ├── device/          entity, dto, errors, repository, service, validator
│   │   ├── registration/    (same six files, per feature)
│   │   ├── session/
│   │   ├── account/
│   │   ├── transfer/
│   │   └── instruction/
│   ├── service/
│   │   ├── device/  registration/  session/  account/  transfer/  instruction/
│   │   └── module.go
│   ├── adapter/
│   │   ├── http/
│   │   │   ├── device/  registration/  account/  transfer/  instruction/
│   │   │   ├── middleware/apikey.go
│   │   │   ├── routing/groups.go
│   │   │   ├── resp/          (unchanged from template)
│   │   │   └── module.go
│   │   ├── external/
│   │   │   ├── ktb/        client.go dto.go methods_*.go module.go
│   │   │   └── encrypt/    client.go dto.go methods.go module.go
│   │   ├── persistence/{model,mapper}/device.go
│   │   └── repository/
│   │       ├── base/          (unchanged from template)
│   │       ├── tx/            (unchanged from template)
│   │       ├── device/repository.go
│   │       └── module.go
│   └── shared/                (template, minus redis.go)
└── bruno/                     replaced with the real collection
```

Template demo features deleted: `note`, `auth`, `user`, `session` (Redis),
and their domain / service / adapter / migration / bruno counterparts.

### Deviations from the platform standard

Both must be recorded in `ktb-biznext-api/AGENTS.md`, as the standard requires:

1. **Redis removed.** The service has no session store and no cache. `/ready`
   pings PostgreSQL only. `shared/redis.go`, `domain/session`,
   `adapter/repository/session`, and the `redis` config block are deleted;
   `go-redis` and `miniredis` are dropped from `go.mod`.
2. **Caller auth is a static API key, not an opaque Redis session.** The
   service is a machine-to-machine proxy with no human users of its own.
3. **A `502` response carries a trimmed upstream error object** (§11), which
   narrows the platform's blanket "5xx returns a generic message" rule.

## 4. Domain model

### `device` — the stored credential set

One row per registered BizNext device. `alias` is the caller-facing key; the
Node code called it `user`.

```go
type Device struct {
    ID               uuid.UUID
    Alias            string
    DeviceID         string
    PIN              string
    AccessToken      string
    RefreshToken     string
    CorporateRefID   string
    AccountRefID     string
    FromAccountNo    string
    CompanyID        string
    UserID           string
    TokenUUID        string
    TransactionToken string
    CreatedAt        time.Time
    UpdatedAt        time.Time
}
```

Nullable text columns map to `string` in the domain (empty means absent);
`model.Device` in the adapter layer holds `sql.NullString` and the mapper
converts. Rationale: the whole codebase branches on "is it set", never on
"is it SQL NULL", so pushing the distinction to the adapter keeps the service
layer free of pointer checks.

### Migration `000001_init.up.sql`

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column() ... ;  -- as in template

CREATE TABLE devices (
    id                UUID PRIMARY KEY DEFAULT uuidv7(),
    alias             TEXT NOT NULL UNIQUE,
    device_id         TEXT NOT NULL UNIQUE,
    pin               TEXT,
    access_token      TEXT,
    refresh_token     TEXT,
    corporate_ref_id  TEXT,
    account_ref_id    TEXT,
    from_account_no   TEXT,
    company_id        TEXT,
    user_id           TEXT,
    token_uuid        TEXT,
    transaction_token TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

`000001_init.down.sql` drops the table and the trigger function.

### Repository

`adapter/repository/device/repository.go`, embedding `*base.BaseRepository`,
Squirrel with dollar placeholders. Methods:

```go
Create(ctx, *device.Device) error
GetByAlias(ctx, alias string) (*device.Device, error)   // ErrNotFound when absent
List(ctx) ([]*device.Device, error)
UpdateTokens(ctx, alias, accessToken, refreshToken string) error
UpdateCorporateRefID(ctx, alias, corporateRefID string) error
UpdateAccountRef(ctx, alias, accountRefID, fromAccountNo string) error
UpdateProfile(ctx, alias, companyID, userID string) error
UpsertCredentials(ctx, alias, deviceID, pin string) error
Delete(ctx, alias string) error
```

`UpsertCredentials` reproduces the Node `upsertUser` conflict behavior:
`ON CONFLICT (alias) DO UPDATE SET device_id = EXCLUDED.device_id, pin = EXCLUDED.pin`.

## 5. External adapters

### `adapter/external/ktb`

Owns the upstream contract. One `Client` struct with an `http.Client`
(timeout from config) and the static app config. Every method takes
`context.Context`.

Standard header set, applied by `newRequest`:

```text
x-platform:        android/14
x-client-version:  5.1.0
x-correlation-id:  <uuid v4>-crid      (fresh per request)
x-device-id:       <device id>
x-device-model:    OnePlus-CPH2449
x-channel-id:      MB
accept-language:   th-TH
authorization:     Bearer <token>   |  Basic YWRtaW46cGFzc3dvcmQ=  (prelogin only)
host:              business.krungthai.com
connection:        Keep-Alive
user-agent:        okhttp/4.12.0
content-type:      <per endpoint, see below>
```

`content-type` rules copied exactly from the Node modules — this is a real
distinction upstream, not an accident:

- `application/json; charset=utf-8` — prelogin grant, pin key generation,
  transfer verification / pre-confirmation / submission
- `application/json; charset=UTF-8` — pin grant, MFA challenge, MFA
  authentication, all transfer-order writes, all bulk writes, approve-init,
  approve, password verification, accept-tnc, OTP generation, OTP
  verification, password grant, pin set, transfer polling
- **absent** — every GET

Empty-body POSTs send the literal string `{}` where the Node code did
(`prelogin/grant`, `pin/key/generation`, `password/key/generation`) and `{}`
as a JSON object elsewhere. Both serialize to the same two bytes; the
distinction is noted only so the port is not second-guessed.

`APIError`:

```go
type APIError struct {
    Status int
    Body   []byte
    Msg    string   // decoded "message" field when present
}
func (e *APIError) Error() string
```

Any non-2xx response becomes an `*APIError`. This is what `session.Service`
inspects to decide whether to re-login.

Method files:

- `methods_auth.go` — `PreloginGrant`, `PinKeyGeneration`, `PinGrant`,
  `PasswordKeyGeneration`, `PasswordVerification`, `Terms`, `AcceptTnC`,
  `OTPGeneration`, `OTPVerification`, `PasswordGrant`, `PinSet`,
  `UserProfile`, `MFAChallenge`, `MFAAuthenticate`
- `methods_account.go` — `AccountOverview`, `CashflowAnalytics`,
  `SourceOfFunds`, `Entitlements`, `TransactionHistory`, `PayeeFundsExternal`,
  `TransactionLimit`
- `methods_transfer.go` — `CreateTransferOrder`, `AddTransferItem`,
  `AddTransferService`, `UpdateTransferItem`, `VerifyTransfer`,
  `PreConfirmTransfer`, `ConfirmTransfer`, `TransferOrderItems`,
  `PollTransfer`
- `methods_bulk.go` — `CreateBulkOrder`, `AddBulkItems`, `BulkItemService`,
  `SaveBulkItem`, `VerifyBulk`, `PreConfirmBulk`, `ConfirmBulk`, `SubmitBulk`,
  `BulkSummary`, `BulkOrderItems`, `BulkItemDetail`
- `methods_instruction.go` — `PendingTasks`, `SubmittedTasks`,
  `InstructionDetail`, `ActivityLog`, `ApproveInit`, `Approve`

Responses that the service only forwards are typed as
`json.RawMessage` / `map[string]any`; responses the service reads fields out
of get a struct in `dto.go` (grant responses, key generation, entitlements,
check-name, transfer order, service/fee lists, pre-confirmation, bulk item
lists).

**Query-string fidelity note (settled empirically, 2026-08-24).** Two claims in
an earlier draft of this spec were wrong and were corrected after capturing what
axios 1.13.2 — the version pinned in `package-lock.json` — actually puts on the
wire, by running it against a local listener:

```
GET /tx?accountRefId=acct-1&accountType=CASA&transactionType=deposit+withdraw&pageSize=40&...
GET /limit?subServices%5B%5D=TRANSFER_SMART_SAME_DAY&subServices%5B%5D=TRANSFER_OTHER_BANK
```

- A space is encoded as **`+`**, not `%20`. Go's `url.QueryEscape` already does
  this, so no custom escaping is needed — only key-order preservation, which
  `url.Values.Encode()` does not provide because it sorts.
- A repeated array parameter is sent with **percent-encoded** brackets
  (`subServices%5B%5D=`), not literal ones.

Insertion order is preserved by axios, which is the sole reason the client needs
its own ordered query builder.

**Absent vs. null vs. empty string on the wire (settled empirically,
2026-08-25).** Node builds three transfer bodies as object literals and
`JSON.stringify` drops a key whose value is `undefined` while keeping one whose
value is `null`:

- `transfer.js` `createTransferOrder` / `addTransferItem`:
  `newPayeeBankName: bankName`, `newPayeeNameTh: checkNameResult.nameTh`
- `transfer.js` `updateTransferItem`: `newPayeeNameTh: checkNameResult.nameTh`
- `bulkTransfer.js`: `payeeNameTh: checkName.nameTh`

A plain Go `string` sent `""` in all three of the cases where Node sent
something else: the bank omits `nameTh`, the bank sends `"nameTh": null`, and
the caller omits the optional `bank_name`. That was the sixth Node divergence
found in the whole-branch review, and it is closed:

- `newPayeeBankName` is `*string` with `omitempty` — the caller's `bank_name`
  travels as `*string` from the HTTP DTO through `domain/transfer.Recipient`,
  so an omitted field means an omitted key and an explicit `""` still means
  `""`.
- `nameTh` / `payeeNameTh` use `ktb.OptionalString` (`optional.go`), a
  three-state JSON string tagged `omitzero`: absent → key dropped, null →
  `null`, value → the value. `CheckNameResponse.NameTh` is the same type, so
  the state the bank sent is the state that goes back out.

Verified by running `node` (v24.12.0) over copies of the three object literals
and comparing byte for byte with the client's output;
`node_parity_test.go` pins all nine cases against those exact strings.

One deliberate narrowing: a caller who sends `"bank_name": null` to *this*
service gets the key omitted upstream, where Node would have forwarded `null`.
An explicit JSON null and an absent field mean the same thing in this service's
own request contract, and carrying the distinction would put a three-state type
in a domain entity.

### `adapter/external/encrypt`

`POST https://encrypt.th-api.com/pin/encrypt`, `Content-Type: application/json`,
body `{Sid, ServerRandom, pubKey, pin, hashType}`, response is the encrypted
string. Interface `Encryptor` with a single `Encrypt(ctx, EncryptRequest) (string, error)`.

## 6. Feature: `session` — login and auto-relogin

Replaces `doLogin` / `getUser` / `withAutoLogin` in `src/index.js`.

```go
type Service interface {
    Login(ctx context.Context, alias string) (*device.Device, error)
    Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error
}
```

`Login(ctx, alias)`:

1. Load the device. Missing → `ErrDeviceNotFound`. Missing `device_id` or
   `pin` → `ErrDeviceNotProvisioned`.
2. `PreloginGrant(deviceID)` → `access_token`
3. `PinKeyGeneration(deviceID, token)` → `{oaepHashAlgo, e2eeSid, serverRandom, pubKey}`
4. `encrypt.Encrypt(...)` with the stored PIN
5. `PinGrant(deviceID, token, e2eeSid, encrypted)` → new access/refresh token
6. Persist tokens
7. Best-effort refresh of the reference IDs — `UserProfile` → `corporateRefId`,
   `Entitlements(corporateRefId)` → `accountRefId` + `accountNo`. Any failure
   here is logged and swallowed, matching the Node `try { } catch { }`.
8. Return the reloaded device.

`Do(ctx, alias, fn)`:

1. Load the device; if `access_token` is empty, `Login` first.
2. Call `fn`. On success, done.
3. If the error is an `*ktb.APIError` with status 401 or 403, or message
   `"An unexpected error occurred"` → `Login`, call `fn` once more, return
   that result.
4. Otherwise return the error unchanged.

**Concurrency.** Node ran one request at a time in practice; Go does not.
`Login` is wrapped in a `golang.org/x/sync/singleflight.Group` keyed by alias,
so N concurrent requests for the same device trigger one upstream login and
share its result. Without this, a burst of expired-token requests would fire N
PIN grants and could trip the bank's throttling.

## 7. Feature: `registration`

### `Register(ctx, in)` — from `gendeviceid.js`

Input `{alias, company_id, user_id, password, delivery_method}`
(`delivery_method` defaults to `OTP_EMAIL`).

1. Generate `deviceID` = `<uuid v4>-devc`
2. `PreloginGrant(deviceID)` → access token
3. `PasswordKeyGeneration` → key material
4. `encrypt.Encrypt(password)`
5. `PasswordVerification{companyId, e2eeSid, encryptedPassword, userId}` →
   `{transactionToken, isTncRequired, isDisclaimerRequired}`
6. If either flag is set: `GET /v1/content/terms?role=NORMAL_USER`, read
   `version` for `contentType` `TNC` and `DISCLAIMER` (default `"1"` each),
   then `POST /v1/auth/accept-tnc {disclaimerVersion, tncVersion, transactionToken}`
7. `OTPGeneration{companyId, deliveryMethod, transactionToken, userId}` →
   `{tokenUuid, otpRefNo, deliveryContact}`
8. Persistence, reproducing the Node handler: if a row for `alias` exists with
   a NULL pin (a registration that never completed OTP), delete it first; then
   insert `{alias, device_id, pin: NULL, access_token, token_uuid, transaction_token}`.
9. Return `{device_id, access_token, token_uuid, otp_ref_no, transaction_token, delivery_contact}`.

The alias check happens **before** step 1, not at step 8: if a row exists with
a non-empty pin, return `ErrAliasAlreadyRegistered` (409) without calling
upstream at all. Node discovered the collision only at the final SQLite insert,
by which point it had already provisioned a device and sent the customer an
OTP that could never be used.

### `VerifyOTP(ctx, in)` — from `otpverification.js`

Input `{alias, otp, pin}`. Loads the row for `alias` to get
`device_id`, `token_uuid`, `transaction_token`, `access_token`.

1. `OTPVerification{otp, tokenUuid, transactionToken}`
2. `PasswordGrant{transactionToken}` → **new** access token; every later step
   in this flow uses it
3. `UserProfile` (called and discarded — the Node code does this and upstream
   may require it before PIN setup; keep it)
4. `PinKeyGeneration`
5. `encrypt.Encrypt(pin)`
6. `PinSet{e2eeSid, encryptedPin, transactionToken}`
7. `UserProfile` again → the returned profile
8. Persist: `UpsertCredentials(alias, device_id, pin)`, and when the profile
   carries `companyId`, `UpdateProfile(alias, companyId, userId)`
9. Return the profile

The access token obtained in step 2 is **not** persisted, matching Node. The
first banking call after registration will find no usable token and run the
normal `session.Login` flow.

## 8. Feature: `account`

Each method runs inside `session.Do`. Straight pass-through of the upstream
response body except where noted.

| Method | Upstream |
|---|---|
| `Overview` | `GET /v1/account/overview` |
| `Cashflow` | `GET /v1/cashflow-analytics/360-view` |
| `SourceOfFunds` | `GET /v1/account/source-of-funds?service=TRANSFER` |
| `RefreshCorporateRefID` | `GET /v1/profile/user/profile` → store `corporateRefId` |
| `RefreshAccountRef` | `GET /v1/entitlement/entitlements/user/corporate/{corporateRefId}` → store `accountRefId` + `accountNo` |
| `Transactions` | `GET /v1/transaction-history/accounts/{accountRefId}` |
| `CheckName` | `GET /v1/account/payee-funds/external` |
| `CheckLimit` | `GET /v1/limit/transaction` |

`Transactions` query, defaults from Node: `accountRefId`, `accountType=CASA`,
`transactionType=deposit withdraw`, `pageSize=40`, `pageNumber=0`,
`order=DESC`, `orderBy=transactionDate`.

`CheckName` query: `bankCode`, `fromAccountRefId`, `id` (= the payee account).

`CheckLimit` query: `subServices` = `TRANSFER_SMART_SAME_DAY`,
`TRANSFER_SMART_NEXT_DAY`, `TRANSFER_OWN_ACCOUNT`, `TRANSFER_3_PARTY`,
`TRANSFER_PROMPTPAY_ONLINE`, `TRANSFER_BAHTNET`, `TRANSFER_OTHER_BANK`.

`RefreshAccountRef` walks
`financialAndNonFinancialServices[0].subServices[0].accountsLinked.previewAccounts[0]`
and takes both `accountRefId` and `accountNo`. Guarded at every level; an
empty chain yields `ErrNoAccountEntitlement` rather than a nil dereference.

Methods needing a stored `account_ref_id` return `ErrAccountRefIDMissing`
(→ 409) when it is absent, replacing the Node `throw new Error('No accountRefId.')`.

## 9. Feature: `transfer`

### Shared types

```go
type Recipient struct {
    AccountTo string
    BankCode  string
    BankName  string
    Amount    decimal.Decimal
}
```

`decimal.Decimal` per the platform rule against `float64` for money.
`decimal.MarshalJSONWithoutQuotes = true` is set once in `cmd/app/main.go`
so amounts serialize as JSON numbers, which is what the Node `parseFloat`
produced and what upstream expects.

Effective dates use `time.Now().In(bangkok).Format("2006-01-02")` with
`bangkok, _ = time.LoadLocation("Asia/Bangkok")`, replacing dayjs. The
location is loaded once at construction and a load failure is a startup error,
not a silent UTC fallback.

### `Transfer(ctx, dev, recipients []Recipient)` — from `transfer.js`

Handles one recipient and many through the same path; the Node code reached
this with a nine-parameter function and positional shifting, which the Go
signature removes.

For the first recipient:

1. `CheckName` → payee record
2. `CreateTransferOrder{fromAccountRefId, isSaveAsBeneficiary: false,
   newPayeeAccountNo, newPayeeBankCode, newPayeeBankName, newPayeeNameEn,
   newPayeeNameTh}` → `{transferOrderId, transferItemId}`
3. `processItem` (below)
4. `VerifyTransfer(orderId)`

For each further recipient:

1. `CheckName`
2. `AddTransferItem` on the existing order → new `transferItemId`
3. `processItem`
4. `VerifyTransfer(orderId)`

`processItem(orderId, itemID, recipient)`:

1. `AddTransferService{amount, effectiveDate, fromAccountRefId}` → subService/fee list
2. `selectBestService` — lowest `payerTransactionFee`; defaults
   `fee = 5.00`, `subService = TRANSFER_OTHER_BANK` when the list is empty
3. `UpdateTransferItem` (PUT) with the full body from `transfer.js:153-169`

Then MFA and submission:

1. `PreConfirmTransfer` (v2) → `mfaRefId`
2. `MFAChallenge{mfaMethod: "PIN", mfaRefId}` → `params`; absent `params` is an error
3. `encrypt.Encrypt(pin)` with those params
4. `MFAAuthenticate{mfaPassphrase, mfaRefId}`
5. `ConfirmTransfer` (submission)
6. `PollTransfer{orderId, type: "transfer"}` — **any error here yields
   `{"status": "PENDING_APPROVAL"}`**, exactly as Node does; the transfer has
   already been submitted at this point and a polling failure must not be
   reported as a failed transfer
7. `TransferOrderItems(orderId)` → details

Returns `{transfer_order_id, recipients, final_result, transfer_details}`.

Payee name fallback, used in three places: `nameEn` falls back to
`"no" + accountTo` when upstream returns it empty; `nameTh` is passed through
as-is including empty.

### `BulkTransfer(ctx, dev, recipients)` — from `bulkTransfer.js`

1. `CreateBulkOrder{isRecurring: false, payerAccountRefId, processingType:
   "ONLINE", service: "TRANSFER", valueDate}` → `bulkOrderId`
2. `CheckName` for every recipient up front, building the payee list
3. `AddBulkItems` with the first payee only → its `bulkItemId`
4. `BulkItemService` → `selectBestService` (bulk variant defaults `fee = 0`)
   → `SaveBulkItem` (PUT, `feeChargeTo: "OUR"`, `totalFee` = `transferFee`)
5. `VerifyBulk`
6. For each further recipient: re-POST the **whole** payee list — previously
   added ones carrying their `bulkItemId`, the new one without — then identify
   the new item as the returned payee whose `bulkItemId` is not already known,
   run service + save, then `VerifyBulk`
7. `PreConfirmBulk` (v2) → `mfaRefId`; `MFAChallenge` → `encrypt` →
   `MFAAuthenticate`
8. `SubmitBulk`; on error fall back to `ConfirmBulk` — kept from Node, which
   found the two endpoints not interchangeable across order states
9. `BulkSummary` + `BulkOrderItems`

Returns `{bulk_order_id, recipients, summary, items}`.

## 10. Feature: `instruction`

| Method | Upstream |
|---|---|
| `Pending` | `GET /v1/instructions/pending-tasks` |
| `Submitted` | `GET /v1/instructions/submitted` |
| `Detail` | `GET /v1/instructions/{refNo}` |
| `ActivityLog` | `GET /v1/instructions/{refNo}/activity-log` |
| `BulkItems` | `GET /v1/bulk/bulk/{bulkOrderId}/items` |
| `BulkItemDetail` | `GET /v1/bulk/bulk/{bulkOrderId}/items/{bulkItemId}` |
| `Approve` | four-step flow below |

`Pending` / `Submitted` defaults from Node: `pageNumber=0`, `pageSize=20`,
`listType=TRANSACTIONS`, `instructionViewType=ALL`, `order=ASC` (submitted
only), `datetimeFrom` = today − 7 days, `datetimeTo` = today + 7 days, both
formatted `YYYY-MM-DD`.

The Node default window used `new Date().toISOString()`, i.e. UTC. The Go port
uses the Bangkok clock for consistency with the transfer effective date. Near
midnight Bangkok this shifts the default window by one day relative to Node —
a deliberate correction, and callers can always pass explicit dates.

`Approve(ctx, dev, instructionRefNo)`:

1. `ApproveInit{isShowingWarning: false}` → `mfaRefId`
2. `MFAChallenge{mfaMethod: "PIN", mfaRefId}` → `params`
3. `encrypt.Encrypt(pin)`
4. `MFAAuthenticate{mfaPassphrase, mfaRefId}`
5. `Approve{mfaRefId}`

Returns the upstream approve response. Unlike Node, a failure at any step
returns an error and the handler maps it to a real status code.

## 11. HTTP layer

### Authentication

`middleware.APIKey(cfg)` reads `X-API-Key` and compares against
`app.api_keys` with `subtle.ConstantTimeCompare`. Missing or unmatched → 401
with a generic message. `/health` and `/ready` sit outside the group.
Startup fails when `app.api_keys` is empty and `app.env` is `production`.

### Routes

All device-scoped routes live under `/api/v1/devices/:alias`.

```text
POST   /api/v1/devices                                     add a device directly
POST   /api/v1/devices/register
POST   /api/v1/devices/verify-otp
GET    /api/v1/devices
GET    /api/v1/devices/:alias
PATCH  /api/v1/devices/:alias
DELETE /api/v1/devices/:alias
POST   /api/v1/devices/:alias/login                        force re-login

GET    /api/v1/devices/:alias/accounts/overview
GET    /api/v1/devices/:alias/accounts/cashflow
GET    /api/v1/devices/:alias/accounts/source-of-funds
POST   /api/v1/devices/:alias/accounts/corporate-ref-id
POST   /api/v1/devices/:alias/accounts/account-ref-id
GET    /api/v1/devices/:alias/accounts/transactions
GET    /api/v1/devices/:alias/accounts/check-name
GET    /api/v1/devices/:alias/accounts/check-limit

POST   /api/v1/devices/:alias/transfers
POST   /api/v1/devices/:alias/transfers/multi
POST   /api/v1/devices/:alias/transfers/bulk

GET    /api/v1/devices/:alias/instructions/pending
GET    /api/v1/devices/:alias/instructions/submitted
GET    /api/v1/devices/:alias/instructions/:ref_no
GET    /api/v1/devices/:alias/instructions/:ref_no/activity-log
POST   /api/v1/devices/:alias/instructions/:ref_no/approve
GET    /api/v1/devices/:alias/bulk-orders/:bulk_order_id/items
GET    /api/v1/devices/:alias/bulk-orders/:bulk_order_id/items/:item_id
```

`corporate-ref-id` and `account-ref-id` are POST because they write to the
device row.

`/instructions/pending` and `/instructions/submitted` sit as static siblings of
the `:ref_no` parameter on the same segment. Gin has given static segments
priority over params since v1.6, so this registers cleanly on v1.11. Should the
router ever reject it, the fallback is `/instructions/detail/:ref_no` rather
than renaming the two list routes.

### Request bodies

snake_case throughout, validated with `go-playground/validator`.

```jsonc
// POST /api/v1/devices
{"alias": "acme", "device_id": "...", "pin": "123456",
 "access_token": "...", "corporate_ref_id": "...",
 "account_ref_id": "...", "from_account_no": "..."}   // last four optional

// POST /api/v1/devices/register
{"alias": "acme", "company_id": "...", "user_id": "...",
 "password": "...", "delivery_method": "OTP_EMAIL"}   // delivery_method optional

// POST /api/v1/devices/verify-otp
{"alias": "acme", "otp": "123456", "pin": "123456"}

// PATCH /api/v1/devices/:alias
{"corporate_ref_id": "...", "account_ref_id": "...",
 "from_account_no": "...", "pin": "...", "access_token": "..."}  // all optional

// POST .../transfers
{"account_to": "...", "bank_code": "006", "bank_name": "กรุงไทย",
 "amount": "10.00", "from_account_no": "..."}        // from_account_no optional

// POST .../transfers/multi   and   .../transfers/bulk
{"from_account_no": "...",                            // optional; multi only
 "recipients": [{"account_to": "...", "bank_code": "006",
                 "bank_name": "กรุงไทย", "amount": "10.00"}]}
```

`amount` is accepted as a JSON string and parsed into `decimal.Decimal`, so
no value is lost to float rounding between the caller and the bank.

Query parameters: `page_size`, `page_number` (transactions);
`account_to`, `bank_code` (check-name); `datetime_from`, `datetime_to`,
`page_size`, `page_number`, `list_type`, `instruction_view_type`, `order`
(pending / submitted).

### Errors

Domain errors wrap `errs` sentinels and `resp.Error` maps them:

| Condition | Sentinel | Status |
|---|---|---|
| Validation failure | `ErrInvalidInput` | 400 |
| Bad or missing API key | `ErrUnauthorized` | 401 |
| Unknown alias | `ErrNotFound` | 404 |
| Alias already registered | `ErrConflict` | 409 |
| Device missing `device_id` / `pin` | `ErrConflict` | 409 |
| Missing `account_ref_id` / `corporate_ref_id` / `from_account_no` | `ErrConflict` | 409 |
| Bank rejected the request (upstream 4xx, after re-login) | `ErrUpstream` | 502 |
| Upstream 5xx, timeout, transport failure | `ErrUnavailable` | 503 |
| Anything else | `ErrInternal` | 500 |

`ErrUpstream` is a new sentinel added to `internal/shared/errs`, mapped to
`502 Bad Gateway` in `resp.getStatusCode`. It is the one place where this
service deliberately relaxes the platform's "5xx returns a generic message"
rule, and the relaxation is narrow:

```jsonc
{"success": false, "code": 502, "message": "bank rejected the request",
 "upstream": {"status": 400, "code": "E1234",
              "message": "ยอดเงินในบัญชีไม่เพียงพอ"}}
```

Only `status` and the upstream `code` / `message` fields are copied — never the
full body. The rationale: this service exists to proxy a bank, and "insufficient
balance" or "invalid account number" is the caller's answer, not our internal
detail. Collapsing it into a generic 503 would make the service materially less
useful than the Node version it replaces, which returned the whole upstream
payload. The full body is still logged with the `trace_id` and never returned.

Everything else keeps the template's hygiene: 500 and 503 carry a generic
message only.

## 12. Configuration

```yaml
app:
  env: development
  port: "3001"
  request_timeout: 120s        # bulk transfer with many payees is slow
  api_keys:
    - change-me
  # cors_origins: [...]        # required in production

database:
  dsn: postgres://postgres:postgres@localhost:5433/ktbbiznext?sslmode=disable
  max_open_conns: 25
  max_idle_conns: 10
  conn_max_lifetime: 15m

ktb:
  base_url: https://business.krungthai.com/ktb/rest/biznext-channel
  timeout: 60s
  client_version: "5.1.0"
  platform: android/14
  device_model: OnePlus-CPH2449
  channel_id: MB
  accept_language: th-TH
  host: business.krungthai.com
  user_agent: okhttp/4.12.0
  prelogin_authorization: "Basic YWRtaW46cGFzc3dvcmQ="

encrypt:
  base_url: https://encrypt.th-api.com
  timeout: 30s

log:
  level: debug
  file_path: logs/app.log
  max_size: 100
  max_backups: 7
  max_age: 30
  compress: true
```

`request_timeout` is raised from the template's 15s because a bulk transfer to
N payees makes roughly `4N + 8` sequential upstream calls; 15s would abort
real work mid-flight, after money had started moving.

`APP_*` environment overrides work as in the template
(`APP_APP_API_KEYS`, `APP_KTB_BASE_URL`, `APP_DATABASE_DSN`, …).

**Future work, not in this conversion:** `pin`, `access_token`,
`refresh_token`, and `transaction_token` are stored in plaintext, as they were
in SQLite. AES-GCM encryption at rest with a config-supplied key is the
natural next step and was deliberately left out of scope here.

## 13. Logging

zap, template field names (`timestamp`, `level`, `logger`, `caller`,
`message`, `stacktrace`), `trace_id` propagated from the request logger and
read with `shared.TraceIDFromContext`.

The Node code printed access tokens, device IDs, and flow progress to stdout.
The Go port logs flow progress at `info` with `alias`, `trace_id`, and step
name; it never logs PINs, tokens, encrypted passphrases, or full request
bodies.

The request logger records the query string with customer account numbers
redacted — `account_to`, `account_no`, `from_account_no` — by parameter name
rather than by route, so a parameter that later appears on a second route stays
covered. `GET /accounts/check-name` is the case that forced this: it carries
the payee's bank account number, and the request log is a rotating file kept
for weeks.

The one upstream payload that *is* logged whole is a bank error body, at
`error` level with the `trace_id` (§11). It is the only record of why a
transfer was refused, and it never reaches the caller.

## 14. Data migration

`scripts/import_sqlite.go`, run manually once:
reads `biznext.db` with `modernc.org/sqlite` (pure Go, no cgo), maps the
`users` table onto `devices` (`user` → `alias`, camelCase → snake_case),
inserts with `ON CONFLICT (alias) DO NOTHING`, and reports counts. Rows
missing `user` or `deviceId` are skipped and listed.

Kept out of `internal/` so it never links into the service binary.

## 15. Behavioral differences from the Node service

Beyond the transport and error changes already described:

1. **`/approve` failures return a real error status.** Node caught everything
   in `approveTask` and replied `200` with `{success: false}`, so a caller
   checking the status code saw every failed approval as a success.
2. **`from_account_no` is populated automatically.** Node's
   `getaccountRefId()` returned a bare string, but the handler read
   `d.accountNo` off it — always `undefined` — so `from_account_no` was only
   ever set by hand through `/user/update`. The Go version reads both fields
   from `previewAccounts[0]`.
3. **`/transfer-multi` has a typed signature.** Node passed six arguments to a
   nine-parameter function; `pin` landed in the `bankCode` position and was
   shifted back inside the function body. Correct by accident, and silently
   wrong for any future caller.
4. **Money is `decimal.Decimal`.** Node used `parseFloat`.
5. **Concurrent requests for one alias trigger one login**, via singleflight.
6. **The default task date window and transfer effective dates use the
   Bangkok clock**, not UTC (§10). Node built both from `new Date().toISOString()`,
   i.e. UTC, so near midnight in Bangkok the two differ by a day; using the
   local clock is the correction.
7. **Upstream error payloads are trimmed, not forwarded whole** — bank
   rejections surface as `502` with the upstream status, code, and message
   only (§11). Node returned the entire upstream body on every failure.
8. **Registration fails fast on a duplicate alias**, before provisioning a
   device or sending an OTP (§7).
9. **`from_account_no` can be updated on its own.** Node — and this document's
   original draft — only applied it when `account_ref_id` was also supplied,
   so a `PATCH` carrying only `from_account_no` returned `200` and silently
   discarded the value. The Go `Update` treats either field as sufficient to
   trigger a write, carrying the other over from the stored row.
10. **A duplicate `device_id` is reported as such**, not as an alias conflict.
    The `devices` table has two unique constraints; the original error mapping
    collapsed both onto "alias already registered," which sends the caller
    after the wrong problem when it is really the device ID that collided.
11. **A read-back failure after a committed transfer degrades to a successful
    result carrying the order id**, rather than an error. The transfer or bulk
    submission has already succeeded at that point; returning an error there
    would invite a retry that moves the money twice. This matches how a
    polling failure was already handled.
12. **`POST /devices` is a create, not an upsert.** Node's `/add` ran
    `upsertUser` — `ON CONFLICT (user) DO UPDATE SET deviceId, pin` — so
    posting an existing alias rotated its device id and PIN in place, and that
    was the documented way to re-provision a device. The Go handler returns
    `409` for an alias that already exists, and no endpoint can change
    `device_id` at all: `PATCH /devices/{alias}` covers `pin`, `access_token`
    and the three reference fields, but not the device id.

    The stricter behaviour is deliberate and stays. A device id is the
    identity the bank binds a login to; silently replacing it on a `POST` that
    a caller believed was a create is how a working device becomes a device
    that cannot log in, with no record of what it used to be. But it *is* a
    departure that will break a runbook carried over from the Node service —
    "POST /add to rotate the PIN" now returns `409`. The replacement is
    `PATCH /devices/{alias}` for a PIN, and `DELETE` followed by `POST` (or
    `POST /devices/register` plus `/verify-otp`) when the device id itself has
    to change.

## 16. Testing

| Layer | Approach |
|---|---|
| `domain/*/validator.go` | table-driven unit tests |
| `service/*` | fake `ktb.Client` + fake `encrypt.Encryptor` + fake repository |
| `adapter/external/ktb` | `httptest.Server` asserting method, path, query, headers, body |
| `adapter/repository/device` | sqlmock |
| `middleware.APIKey` | valid / missing / wrong key |

The service-layer fakes carry the weight: they let the eleven-step transfer,
the eight-step bulk flow, the five-step approval, and the auto-relogin retry
all be exercised deterministically, including the failure branches (polling
error → `PENDING_APPROVAL`, `SubmitBulk` error → `ConfirmBulk`, re-login on
401), without touching the bank.

The `ktb` client tests are what protect the byte-level upstream contract —
one test per method, asserting the exact header set, content-type, and body
the Node module sent.

`bruno/` is rewritten to cover every endpoint above, with a `local`
environment carrying `base_url`, `api_key`, and `alias`.

Completion gate: `make check` (tidy drift + vet + golangci-lint +
`go test -race`).

## 17. Build order

1. Scaffold: copy template, rename module, strip demo features, remove Redis,
   add `decimal` + `singleflight` + `modernc.org/sqlite`, write `AGENTS.md`
   deviations, update config and docker-compose.
2. Migration + `device` domain, model, mapper, repository (+ sqlmock tests).
3. `ktb` and `encrypt` external adapters (+ httptest tests).
4. `session` service (+ tests, including the singleflight and retry paths).
5. `registration` service (+ tests).
6. `account` service (+ tests).
7. `instruction` service (+ tests).
8. `transfer` service (+ tests) — largest piece, depends on everything above.
9. HTTP layer: API-key middleware, DTOs, handlers, routes, fx wiring.
10. `scripts/import_sqlite.go`, Bruno collection, README.
11. `make check`, then a live smoke test against one real device.

Steps 3 through 8 each stand alone once the layer beneath them exists.
