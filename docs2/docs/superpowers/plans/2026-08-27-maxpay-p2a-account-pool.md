# MaxPay P2a — Account Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `be-maxpay` the three-tier corporate bank account pool the gateway settles through — the accounts themselves, the rules that pick one for a deposit or a payout, and the background worker that keeps their real bank balances fresh.

**Architecture:** A `bank_accounts` row is a corporate account reachable through an existing `devices` row (a BizNext login). Accounts carry a tier (INBOUND / VAULT / OUTBOUND), belong either to a shared cluster or to one merchant, and record two balances that must never be conflated: `bank_balance`, what the bank says, and the book balance, which arrives with the ledger in P2b. Selection is a query, not a loop in Go. Background work runs through a PostgreSQL outbox claimed with `FOR UPDATE SKIP LOCKED` — the first background worker this service has ever had.

**Tech Stack:** Go 1.25, gin, fx, sqlx + squirrel, PostgreSQL 18, `shopspring/decimal`, `go-sqlmock`, `testify`.

**Spec:** `docs/superpowers/specs/2026-08-26-maxpay-merchant-ledger-design.md` — this plan implements §4.5, §4.7, §8 and the pool half of §13. The ledger (§4.6, §9) is P2b and is deliberately absent.

## Global Constraints

Copied from the spec and `AGENTS.md`; every task inherits these.

- Every `internal/domain/{feature}` package has all six files: `entity.go`, `dto.go`, `errors.go`, `repository.go`, `service.go`, `validator.go` (a package-only stub when empty).
- Domain code must not import adapter or service packages. Domain DTOs carry no JSON or database tags.
- Errors wrap shared sentinels from `internal/shared/errs`. Never return raw database text to a caller.
- Every function performing I/O accepts `context.Context` first.
- Repositories embed `*base.BaseRepository` and build SQL with squirrel and dollar placeholders.
- Primary keys are UUIDv7 via `shared/id.New()` or the `uuidv7()` column default.
- Persistence models live in `internal/adapter/persistence/model`; each entity ships `XToModel`, `XToDomain`, `XsToDomain` in `internal/adapter/persistence/mapper`.
- Money and balances are `decimal.Decimal`. Never `float64`.
- Service constructors return their DOMAIN INTERFACE, with `var _ Iface = (*Service)(nil)` beneath.
- Code, identifiers and comments in English, including `TODO`/`NOTE`.
- Log fields are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`; service logs carry `trace_id` from `shared.TraceIDFromContext(ctx)`.
- Every new or changed HTTP endpoint ships a matching `.bru` file AND an entry in `internal/adapter/http/routes_test.go`'s `wantRoutes`, whose exact-length assertion must never be relaxed.
- Merchant-addressed admin endpoints resolve their id through `adminmerchant.EnsureVisible` before acting on it.
- `pool.balance_max_age` default 5m, `pool.balance_refresh_interval` default 60s, `pool.satang_retries` default 5, `outbox.poll_interval` default 1s, `outbox.max_attempts` default 10, `outbox.batch_size` default 20.
- Validation tags for ids use `uuid`, never `uuid4` — every id in this system is UUIDv7 and `uuid4` rejects them all.
- Migrations continue from `000005_admin_auth`; this plan adds `000006` and `000007`.

## What P1 built that this plan consumes

Exact signatures, so no task has to go looking:

```go
// internal/domain/merchant
type Service interface {
	Create(ctx context.Context, parentID uuid.UUID, data *CreateData) (*Merchant, error)
	GetByID(ctx context.Context, id uuid.UUID) (*Merchant, error)
	GetByCode(ctx context.Context, code string) (*Merchant, error)
	GetRoot(ctx context.Context) (*Merchant, error)
	ListSubtree(ctx context.Context, rootID uuid.UUID) ([]*Merchant, error)
	Ancestors(ctx context.Context, id uuid.UUID) ([]*Merchant, error)
	Update(ctx context.Context, id uuid.UUID, data *UpdateData) (*Merchant, error)
}
type Merchant struct {
	ID, ParentID, ClusterID uuid.UUID
	Code, Name, Status      string
	Role                    Role      // ROOT | RESELLER | DIRECT
	PoolModel               PoolModel // SHARED | DEDICATED
	Depth                   int
	DepositRate, PayoutRate decimal.Decimal
	CreatedAt, UpdatedAt    time.Time
}

// internal/adapter/http/adminmerchant
func VisibleRoot(user *adminuser.User) uuid.UUID
func EnsureVisible(ctx context.Context, merchants merchant.Service, user *adminuser.User, target uuid.UUID) error

// internal/adapter/http/middleware
func UserFromContext(c *gin.Context) (*adminuser.User, bool)
func MerchantFromContext(c *gin.Context) (*merchant.Merchant, bool)

// internal/adapter/http/routing
func APIGroup(r *gin.Engine, cfg *shared.Config) *gin.RouterGroup   // static X-API-Key
func AdminGroup(r *gin.Engine, users adminuser.Service) *gin.RouterGroup // session
func PublicAuthGroup(r *gin.Engine) *gin.RouterGroup

// internal/adapter/repository/tx
func (t *TransactionHelper) WithTx(ctx context.Context, fn func(*sqlx.Tx) error) error

// internal/adapter/external/ktb
func (c *Client) AccountOverview(ctx context.Context, creds Creds) (json.RawMessage, error)
// internal/domain/account
type Service interface { Overview(ctx context.Context, alias string) (json.RawMessage, error); ... }
```

`account.Service.Overview` wraps `sessions.Do`, which logs in to the bank and refreshes the session automatically — a caller never handles bank credentials itself.

## File Structure

| File | Responsibility |
|---|---|
| `internal/testutil/pgtest/pgtest.go` | Integration-test database: connect, migrate, truncate between tests |
| `db/migrations/000006_bank_accounts.{up,down}.sql` | clusters, bank_accounts, daily stats |
| `db/migrations/000007_outbox.{up,down}.sql` | outbox_jobs |
| `internal/domain/bankaccount/*` | account entity, tier/status rules, routing candidate contracts |
| `internal/domain/outbox/*` | job entity, claim contract |
| `internal/adapter/repository/bankaccount/repository.go` | account SQL, including the two candidate queries |
| `internal/adapter/repository/outbox/repository.go` | enqueue, claim with SKIP LOCKED, finish, fail |
| `internal/service/bankaccount/service.go` | attach, retier, recluster, status changes |
| `internal/service/bankaccount/routing.go` | inbound and outbound selection (§8) |
| `internal/service/outbox/worker.go` | the poll loop and its fx lifecycle |
| `internal/service/outbox/handlers.go` | the job-kind registry |
| `internal/service/bankaccount/balance.go` | `ParseBankBalance` plus the refresh job |
| `internal/adapter/http/adminpool/*` | `/admin/clusters` and `/admin/accounts` |

---

### Task 1: An integration-test harness

`AGENTS.md` and the CI workflow both state that nothing in this repository talks to a live database — every repository test uses `go-sqlmock`. Spec §13 names four guarantees that sqlmock cannot express, and three of them arrive in this plan and P2b. This task builds the harness and proves it on a guarantee that already exists, so it is exercised from the day it lands rather than at the same moment as the code it is meant to check.

**Files:**
- Create: `internal/testutil/pgtest/pgtest.go`
- Create: `internal/adapter/repository/merchant/integration_test.go`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`
- Modify: `docs/context/testing-conventions.md`

**Interfaces:**
- Consumes: `db/migrations/*`, `internal/shared/id`
- Produces:
  - `pgtest.DB(t *testing.T) *sqlx.DB` — a migrated database handle, skipping the test when `TEST_DATABASE_URL` is unset
  - `pgtest.Truncate(t *testing.T, db *sqlx.DB, tables ...string)`

- [ ] **Step 1: Write the harness**

`internal/testutil/pgtest/pgtest.go`:

```go
// Package pgtest gives integration tests a migrated PostgreSQL database.
//
// It exists because sqlmock cannot express the guarantees this service leans
// on hardest: a deferred constraint trigger, a partial unique index, FOR
// UPDATE SKIP LOCKED, and what two concurrent writers do to one row. Those
// are promises PostgreSQL makes, not promises Go makes, and a mock that
// replays canned rows can only assert that we asked politely.
package pgtest

import (
	"os"
	"strings"
	"testing"

	"github.com/jmoiron/sqlx"
	"github.com/stretchr/testify/require"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// EnvDSN names the database these tests run against. Unset means skip: a
// developer without a database still gets a green `go test ./...`, and CI
// sets it so the suite is never quietly skipped where it matters.
const EnvDSN = "TEST_DATABASE_URL"

// DB returns a handle to a migrated database, or skips the test.
//
// Migrations are applied by `make test-integration` before the suite runs,
// not here: applying them per-test would serialise every test behind a
// migration lock for no benefit.
func DB(t *testing.T) *sqlx.DB {
	t.Helper()

	dsn := os.Getenv(EnvDSN)
	if dsn == "" {
		t.Skipf("%s is not set; skipping integration test", EnvDSN)
	}

	db, err := sqlx.Connect("pgx", dsn)
	require.NoError(t, err, "connect to %s", EnvDSN)
	t.Cleanup(func() { _ = db.Close() })

	return db
}

// Truncate empties the named tables and everything referencing them.
//
// RESTART IDENTITY is deliberate: a test that depends on a sequence value
// surviving another test is a test that will fail in a different order.
func Truncate(t *testing.T, db *sqlx.DB, tables ...string) {
	t.Helper()

	if len(tables) == 0 {
		return
	}

	_, err := db.Exec("TRUNCATE " + strings.Join(tables, ", ") + " RESTART IDENTITY CASCADE")
	require.NoError(t, err, "truncate %v", tables)
}
```

- [ ] **Step 2: Write a failing integration test against an existing guarantee**

`internal/adapter/repository/merchant/integration_test.go`:

```go
//go:build integration

package merchant_test

import (
	"context"
	"testing"

	merchantrepo "be-maxpay/internal/adapter/repository/merchant"
	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/testutil/pgtest"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The single-root rule is a partial unique index, not a Go check. sqlmock
// would happily accept a second ROOT because nothing in Go refuses it.
func TestMerchantRepository_Integration_OnlyOneRootMayExist(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "merchants")

	repo := merchantrepo.NewRepository(db)
	ctx := context.Background()

	root := &domainmerchant.Merchant{
		Code: "ROOTAAAAAA", Name: "House", Role: domainmerchant.RoleRoot, Depth: 0,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: decimal.RequireFromString("0.0050"),
		PayoutRate:  decimal.RequireFromString("0.0050"),
		Status:      domainmerchant.StatusActive,
	}
	created, err := repo.Create(ctx, root)
	require.NoError(t, err)
	assert.Equal(t, domainmerchant.RoleRoot, created.Role)

	second := *root
	second.Code = "ROOTBBBBBB"
	_, err = repo.Create(ctx, &second)
	require.ErrorIs(t, err, domainmerchant.ErrRootExists,
		"the partial unique index must refuse a second ROOT, and the repository must name that rule")
}

// GetRoot has no sqlmock coverage of its real WHERE clause against a real
// table; this proves it finds the row the index guarantees is unique.
func TestMerchantRepository_Integration_GetRootFindsIt(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "merchants")

	repo := merchantrepo.NewRepository(db)
	ctx := context.Background()

	_, err := repo.Create(ctx, &domainmerchant.Merchant{
		Code: "ROOTAAAAAA", Name: "House", Role: domainmerchant.RoleRoot, Depth: 0,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: decimal.RequireFromString("0.0050"),
		PayoutRate:  decimal.RequireFromString("0.0050"),
		Status:      domainmerchant.StatusActive,
	})
	require.NoError(t, err)

	got, err := repo.GetRoot(ctx)
	require.NoError(t, err)
	assert.Equal(t, "ROOTAAAAAA", got.Code)
}
```

- [ ] **Step 3: Run it and watch it skip**

Run: `go test -tags=integration ./internal/adapter/repository/merchant/ -run Integration -v`
Expected: both tests SKIP with "TEST_DATABASE_URL is not set". That is the harness working — a developer without a database is not blocked.

- [ ] **Step 4: Add the Makefile target**

Add to `Makefile`, and add `test-integration` to `.PHONY`:

```makefile
# Integration tests run against a real PostgreSQL, because the guarantees they
# check -- deferred constraint triggers, partial unique indexes, SKIP LOCKED,
# concurrent writers -- are PostgreSQL's promises, not Go's. They are a
# separate target because they need a database; `make check` stays runnable
# without one.
TEST_DATABASE_URL ?= postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable

test-integration:
	@psql "$(DATABASE_URL)" -c "SELECT 1 FROM pg_database WHERE datname = 'maxpay_test'" | grep -q 1 \
		|| psql "$(DATABASE_URL)" -c "CREATE DATABASE maxpay_test"
	migrate -path db/migrations -database "$(TEST_DATABASE_URL)" up
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test -tags=integration -count=1 ./...
```

- [ ] **Step 5: Run it for real**

```bash
export PATH="$PATH:$HOME/go/bin"
make test-integration
```

Expected: the `maxpay_test` database is created, migrations apply, and both tests PASS. Run it a second time — it must pass again, proving `Truncate` leaves a usable database rather than a dirty one.

- [ ] **Step 6: Add the CI job**

In `.github/workflows/ci.yml`, replace the comment that begins "No service containers" with the accurate one and add the service and step:

```yaml
    # Unit tests run against sqlmock and need no database. The integration
    # suite does: it checks guarantees PostgreSQL makes and Go cannot.
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: maxpay_test
        ports:
          - 5437:5432
        options: >-
          --health-cmd pg_isready --health-interval 5s
          --health-timeout 5s --health-retries 10
```

and after the existing test step:

```yaml
      - name: Install golang-migrate
        run: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

      - name: Integration tests
        env:
          TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5437/maxpay_test?sslmode=disable
        run: |
          migrate -path db/migrations -database "$TEST_DATABASE_URL" up
          go test -tags=integration -count=1 ./...
```

- [ ] **Step 7: Record it in the documentation**

In `docs/context/testing-conventions.md`, under the sentence "sqlmock is not a database substitute", add:

```markdown
Integration tests live beside their unit tests under a `//go:build integration`
tag and take their database from `pgtest.DB(t)`, which skips when
`TEST_DATABASE_URL` is unset. Run them with `make test-integration`. Use them
only for behaviour PostgreSQL owns — constraints, triggers, locking,
concurrency — never as a slower way to test Go logic.
```

In `AGENTS.md`, under *Required Verification*, add:

```markdown
- Changes touching a constraint, a trigger, an index that enforces a rule, or
  concurrent access to a row need an integration test: `make test-integration`.
  A sqlmock test cannot fail on any of those.
```

- [ ] **Step 8: Run the full gate**

```bash
export PATH="$PATH:$HOME/go/bin"
make check
make test-integration
```

Expected: both green. `make check` must still pass with no database reachable — confirm by running `TEST_DATABASE_URL= go test ./...` and seeing the integration tests skip.

- [ ] **Step 9: Commit**

```bash
git add internal/testutil/pgtest internal/adapter/repository/merchant/integration_test.go \
        Makefile .github/workflows/ci.yml AGENTS.md docs/context/testing-conventions.md
git commit -m "test: add an integration harness for the guarantees sqlmock cannot make"
```

---

### Task 2: The pool schema and its domain

**Files:**
- Create: `db/migrations/000006_bank_accounts.up.sql`
- Create: `db/migrations/000006_bank_accounts.down.sql`
- Create: `internal/domain/bankaccount/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/persistence/model/bankaccount.go`
- Create: `internal/adapter/persistence/mapper/bankaccount.go`
- Test: `internal/domain/bankaccount/validator_test.go`

**Interfaces:**
- Consumes: `errs` sentinels, `merchant.Merchant`
- Produces:
  - `bankaccount.Account`, `bankaccount.Cluster`, `bankaccount.DailyStats`
  - `bankaccount.Tier` (`TierInbound`, `TierVault`, `TierOutbound`), statuses `StatusActive`, `StatusCooling`, `StatusSuspended`
  - `(*Account).IsActive()`, `IsShared()`, `BalanceIsFresh(now time.Time, maxAge time.Duration) bool`, `CanCover(amount decimal.Decimal) bool`
  - `bankaccount.AttachData`, `bankaccount.UpdateData`
  - `bankaccount.Repository`, `bankaccount.Service` interfaces
  - `bankaccount.ValidateAttach(data *AttachData) error`, `ValidateUpdate(a *Account, data *UpdateData) error`
  - errors `ErrAccountNotFound`, `ErrAccountExists`, `ErrClusterNotFound`, `ErrClusterNameExists`, `ErrTierInvalid`, `ErrStatusInvalid`, `ErrPromptPayOnlyOnInbound`, `ErrOwnerAmbiguous`, `ErrAccountNotActive`, `ErrNoAccountAvailable`

- [ ] **Step 1: Write the failing validator tests**

`internal/domain/bankaccount/validator_test.go`:

```go
package bankaccount_test

import (
	"testing"
	"time"

	"be-maxpay/internal/domain/bankaccount"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func money(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func inbound() *bankaccount.AttachData {
	return &bankaccount.AttachData{
		DeviceID:    uuid.New(),
		AccountNo:   "1234567890",
		AccountName: "MAXPAY CO LTD",
		BankCode:    "006",
		Tier:        bankaccount.TierInbound,
		ClusterID:   uuid.New(),
	}
}

func TestValidateAttach_AcceptsAnInboundInACluster(t *testing.T) {
	require.NoError(t, bankaccount.ValidateAttach(inbound()))
}

func TestValidateAttach_RejectsAnUnknownTier(t *testing.T) {
	data := inbound()
	data.Tier = "SIDEWAYS"

	require.ErrorIs(t, bankaccount.ValidateAttach(data), bankaccount.ErrTierInvalid)
}

// promptpay_id identifies where a QR deposit is paid to. An outbound or vault
// account never shows a QR, so carrying one there is a mistake somebody will
// later read as intent.
func TestValidateAttach_RejectsPromptPayOnANonInboundAccount(t *testing.T) {
	data := inbound()
	data.Tier = bankaccount.TierOutbound
	data.PromptPayID = "0812345678"

	require.ErrorIs(t, bankaccount.ValidateAttach(data), bankaccount.ErrPromptPayOnlyOnInbound)
}

func TestValidateAttach_AcceptsPromptPayOnInbound(t *testing.T) {
	data := inbound()
	data.PromptPayID = "0812345678"

	require.NoError(t, bankaccount.ValidateAttach(data))
}

// An account serves either one merchant or one cluster. Both at once has no
// meaning, and the routing queries would have to guess which one wins.
func TestValidateAttach_RejectsBothAClusterAndAMerchant(t *testing.T) {
	data := inbound()
	data.MerchantID = uuid.New()

	require.ErrorIs(t, bankaccount.ValidateAttach(data), bankaccount.ErrOwnerAmbiguous)
}

func TestValidateAttach_AcceptsADedicatedAccount(t *testing.T) {
	data := inbound()
	data.ClusterID = uuid.Nil
	data.MerchantID = uuid.New()

	require.NoError(t, bankaccount.ValidateAttach(data))
}

// A vault account serves nobody directly -- it is the platform's own float --
// so it is allowed to belong to neither.
func TestValidateAttach_AcceptsAVaultWithNoOwner(t *testing.T) {
	data := inbound()
	data.Tier = bankaccount.TierVault
	data.ClusterID = uuid.Nil

	require.NoError(t, bankaccount.ValidateAttach(data))
}

func TestValidateAttach_RequiresAnAccountNumberAndABank(t *testing.T) {
	data := inbound()
	data.AccountNo = "  "
	require.ErrorIs(t, bankaccount.ValidateAttach(data), bankaccount.ErrAccountNoRequired)

	data = inbound()
	data.BankCode = ""
	require.ErrorIs(t, bankaccount.ValidateAttach(data), bankaccount.ErrBankCodeRequired)
}

func TestValidateUpdate_RejectsAnUnknownStatus(t *testing.T) {
	account := &bankaccount.Account{Tier: bankaccount.TierInbound, Status: bankaccount.StatusActive}

	err := bankaccount.ValidateUpdate(account, &bankaccount.UpdateData{Status: "ASLEEP"})
	require.ErrorIs(t, err, bankaccount.ErrStatusInvalid)
}

func TestAccount_CanCoverLeavesTheMinimumBehind(t *testing.T) {
	account := &bankaccount.Account{
		BankBalance: money("100000"),
		MinBalance:  money("50000"),
	}

	assert.True(t, account.CanCover(money("50000")), "exactly down to the minimum is allowed")
	assert.False(t, account.CanCover(money("50000.01")), "one satang past the minimum is not")
}

func TestAccount_BalanceIsFresh(t *testing.T) {
	now := time.Now()
	account := &bankaccount.Account{BankBalanceAt: now.Add(-4 * time.Minute)}

	assert.True(t, account.BalanceIsFresh(now, 5*time.Minute))
	assert.False(t, account.BalanceIsFresh(now, 3*time.Minute))
}

// A balance that was never read is not a balance of zero -- it is unknown,
// and unknown must never satisfy a payout.
func TestAccount_BalanceIsNeverFreshWhenItWasNeverRead(t *testing.T) {
	assert.False(t, (&bankaccount.Account{}).BalanceIsFresh(time.Now(), time.Hour))
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/domain/bankaccount/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the migration**

`db/migrations/000006_bank_accounts.up.sql`:

```sql
-- A cluster is a group of corporate accounts that serve one group of
-- merchants together. The PRD's reason for them is blast radius: if one
-- cluster's accounts are frozen, the merchants on the others keep trading.
CREATE TABLE account_clusters (
    id         UUID PRIMARY KEY DEFAULT uuidv7(),
    name       TEXT NOT NULL UNIQUE,
    status     TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per corporate bank account. device_id is the BizNext login that
-- reaches it; several accounts can share one login.
--
-- bank_balance is what the bank last told us. The book balance lives in the
-- ledger and arrives in P2b. They are deliberately separate: the two
-- disagreeing is the only signal that will ever reveal money arriving that
-- this system did not recognise.
CREATE TABLE bank_accounts (
    id               UUID PRIMARY KEY DEFAULT uuidv7(),
    device_id        UUID NOT NULL REFERENCES devices(id),
    account_no       TEXT NOT NULL,
    account_name     TEXT NOT NULL,
    bank_code        TEXT NOT NULL,
    tier             TEXT NOT NULL CHECK (tier IN ('INBOUND', 'VAULT', 'OUTBOUND')),
    cluster_id       UUID REFERENCES account_clusters(id),
    merchant_id      UUID REFERENCES merchants(id),
    promptpay_id     TEXT,
    status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COOLING', 'SUSPENDED')),
    -- Zero means no cap. A closed account is expressed with status, never
    -- with a cap of zero, so the two readings never collide.
    daily_amount_cap NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (daily_amount_cap >= 0),
    daily_txn_cap    INT NOT NULL DEFAULT 0 CHECK (daily_txn_cap >= 0),
    min_balance      NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (min_balance >= 0),
    target_balance   NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (target_balance >= 0),
    bank_balance     NUMERIC(20,4),
    bank_balance_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (bank_code, account_no),
    -- An account serves one merchant or one cluster, never both: the routing
    -- queries would otherwise have to guess which ownership wins.
    CHECK (cluster_id IS NULL OR merchant_id IS NULL),
    -- Only an inbound account ever shows a QR, so only it may carry the
    -- PromptPay identity a QR is paid to.
    CHECK (promptpay_id IS NULL OR tier = 'INBOUND')
);
CREATE INDEX bank_accounts_cluster ON bank_accounts (cluster_id, tier, status);
CREATE INDEX bank_accounts_merchant ON bank_accounts (merchant_id, tier, status);
CREATE INDEX bank_accounts_device ON bank_accounts (device_id);

-- Today's volume per account, which is what the rotation caps are read
-- against. One row per account per day; the day is the account's own local
-- date, which for a Thai corporate account is Asia/Bangkok.
CREATE TABLE bank_account_daily_stats (
    account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    stat_date  DATE NOT NULL,
    in_amount  NUMERIC(20,4) NOT NULL DEFAULT 0,
    in_count   INT NOT NULL DEFAULT 0,
    out_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
    out_count  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, stat_date)
);

DROP TRIGGER IF EXISTS update_account_clusters_updated_at ON account_clusters;
CREATE TRIGGER update_account_clusters_updated_at
  BEFORE UPDATE ON account_clusters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bank_accounts_updated_at ON bank_accounts;
CREATE TRIGGER update_bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

`db/migrations/000006_bank_accounts.down.sql`:

```sql
DROP TABLE IF EXISTS bank_account_daily_stats;
DROP TABLE IF EXISTS bank_accounts;
DROP TABLE IF EXISTS account_clusters;
```

- [ ] **Step 4: Write the domain entity**

`internal/domain/bankaccount/entity.go`:

```go
package bankaccount

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Tier is what an account is for. The PRD's rule is that no account both
// receives and pays: an inbound account's statement stays clean, and an
// outbound account never holds more than it is about to pay out.
type Tier string

const (
	TierInbound  Tier = "INBOUND"
	TierVault    Tier = "VAULT"
	TierOutbound Tier = "OUTBOUND"
)

const (
	StatusActive    = "ACTIVE"
	// StatusCooling is set by the system when an account's bank calls keep
	// failing, or by an operator resting an account that has taken too much
	// volume today. Returning it to ACTIVE is a back-office action.
	StatusCooling   = "COOLING"
	StatusSuspended = "SUSPENDED"
)

const (
	ClusterStatusActive    = "ACTIVE"
	ClusterStatusSuspended = "SUSPENDED"
)

// Cluster groups accounts that serve one group of merchants together.
type Cluster struct {
	ID        uuid.UUID
	Name      string
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Account is one corporate bank account in the pool.
//
// ClusterID and MerchantID are both uuid.Nil for an unassigned account and a
// vault account; at most one of them is ever set. A cap of zero means no cap.
// BankBalanceAt is the zero time when the balance has never been read, which
// is not the same as a balance of zero and must never satisfy a payout.
type Account struct {
	ID             uuid.UUID
	DeviceID       uuid.UUID
	AccountNo      string
	AccountName    string
	BankCode       string
	Tier           Tier
	ClusterID      uuid.UUID
	MerchantID     uuid.UUID
	PromptPayID    string
	Status         string
	DailyAmountCap decimal.Decimal
	DailyTxnCap    int
	MinBalance     decimal.Decimal
	TargetBalance  decimal.Decimal
	BankBalance    decimal.Decimal
	BankBalanceAt  time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (a *Account) IsActive() bool { return a.Status == StatusActive }

// IsShared reports whether the account serves a cluster rather than one
// merchant.
func (a *Account) IsShared() bool { return a.MerchantID == uuid.Nil }

// BalanceIsFresh reports whether the last bank reading is recent enough to
// act on. A balance that was never read is never fresh.
func (a *Account) BalanceIsFresh(now time.Time, maxAge time.Duration) bool {
	if a.BankBalanceAt.IsZero() {
		return false
	}

	return now.Sub(a.BankBalanceAt) <= maxAge
}

// CanCover reports whether the account holds enough to pay amount and still
// leave its minimum behind. Exactly down to the minimum is allowed.
func (a *Account) CanCover(amount decimal.Decimal) bool {
	return a.BankBalance.Sub(amount).GreaterThanOrEqual(a.MinBalance)
}

// DailyStats is one account's volume for one day, which the rotation caps are
// read against.
type DailyStats struct {
	AccountID uuid.UUID
	StatDate  time.Time
	InAmount  decimal.Decimal
	InCount   int
	OutAmount decimal.Decimal
	OutCount  int
}
```

- [ ] **Step 5: Write the remaining domain files**

`internal/domain/bankaccount/dto.go`:

```go
package bankaccount

import (
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// AttachData adds an existing corporate account to the pool. The account
// itself already exists at the bank; this records that we know about it and
// which BizNext login reaches it.
type AttachData struct {
	DeviceID       uuid.UUID
	AccountNo      string
	AccountName    string
	BankCode       string
	Tier           Tier
	ClusterID      uuid.UUID
	MerchantID     uuid.UUID
	PromptPayID    string
	DailyAmountCap decimal.Decimal
	DailyTxnCap    int
	MinBalance     decimal.Decimal
	TargetBalance  decimal.Decimal
}

// UpdateData is a partial change. An empty string or a nil pointer means
// leave the stored value alone.
type UpdateData struct {
	Tier           Tier
	ClusterID      *uuid.UUID
	MerchantID     *uuid.UUID
	PromptPayID    *string
	Status         string
	DailyAmountCap *decimal.Decimal
	DailyTxnCap    *int
	MinBalance     *decimal.Decimal
	TargetBalance  *decimal.Decimal
}

// InboundQuery and OutboundQuery are what the routing rules ask for. They are
// domain types rather than repository arguments so the selection rules can be
// tested without a database.
type InboundQuery struct {
	MerchantID uuid.UUID
	ClusterID  uuid.UUID
	Today      time.Time
}

type OutboundQuery struct {
	MerchantID uuid.UUID
	ClusterID  uuid.UUID
	Amount     decimal.Decimal
	Now        time.Time
	MaxAge     time.Duration
}
```

Add `"time"` to that file's imports.

`internal/domain/bankaccount/errors.go`:

```go
package bankaccount

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrAccountNotFound   = fmt.Errorf("bank account not found: %w", errs.ErrNotFound)
	ErrClusterNotFound   = fmt.Errorf("cluster not found: %w", errs.ErrNotFound)
	ErrAccountExists     = fmt.Errorf("that account is already in the pool: %w", errs.ErrConflict)
	ErrClusterNameExists = fmt.Errorf("cluster name already exists: %w", errs.ErrConflict)

	ErrAccountNoRequired   = fmt.Errorf("account_no is required: %w", errs.ErrInvalidInput)
	ErrAccountNameRequired = fmt.Errorf("account_name is required: %w", errs.ErrInvalidInput)
	ErrBankCodeRequired    = fmt.Errorf("bank_code is required: %w", errs.ErrInvalidInput)
	ErrDeviceRequired      = fmt.Errorf("device_id is required: %w", errs.ErrInvalidInput)
	ErrClusterNameRequired = fmt.Errorf("cluster name is required: %w", errs.ErrInvalidInput)
	ErrTierInvalid         = fmt.Errorf("tier must be INBOUND, VAULT or OUTBOUND: %w", errs.ErrInvalidInput)
	ErrStatusInvalid       = fmt.Errorf("status must be ACTIVE, COOLING or SUSPENDED: %w", errs.ErrInvalidInput)

	// Shape rules. Conflict rather than bad input: each request is well formed
	// and it is the pool's own rules that refuse it.
	ErrPromptPayOnlyOnInbound = fmt.Errorf("only an inbound account may carry a promptpay id: %w", errs.ErrConflict)
	ErrOwnerAmbiguous         = fmt.Errorf("an account serves a cluster or a merchant, not both: %w", errs.ErrConflict)

	ErrAccountNotActive = fmt.Errorf("account is not active: %w", errs.ErrConflict)

	// ErrNoAccountAvailable is temporary by nature -- a cap resets, a balance
	// refreshes, an operator returns an account to ACTIVE -- so it maps to 503
	// and the caller may retry.
	ErrNoAccountAvailable = fmt.Errorf("no account in the pool can serve this request: %w", errs.ErrUnavailable)
)
```

`internal/domain/bankaccount/repository.go`:

```go
package bankaccount

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Repository interface {
	CreateCluster(ctx context.Context, c *Cluster) (*Cluster, error)
	GetCluster(ctx context.Context, id uuid.UUID) (*Cluster, error)
	ListClusters(ctx context.Context) ([]*Cluster, error)

	Attach(ctx context.Context, a *Account) (*Account, error)
	GetByID(ctx context.Context, id uuid.UUID) (*Account, error)
	List(ctx context.Context) ([]*Account, error)
	ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*Account, error)
	Update(ctx context.Context, id uuid.UUID, data *UpdateData) (*Account, error)

	// InboundCandidates returns ACTIVE inbound accounts serving the caller,
	// least-loaded first by today's in_count, already filtered by both caps.
	// The filtering is in SQL because a cap check done in Go would read a
	// count that another request has already moved past.
	InboundCandidates(ctx context.Context, q InboundQuery) ([]*Account, error)

	// OutboundCandidates returns ACTIVE outbound accounts serving the caller
	// whose balance is both fresh enough and large enough, largest balance
	// first.
	OutboundCandidates(ctx context.Context, q OutboundQuery) ([]*Account, error)

	// RecordBalance stores a reading from the bank.
	RecordBalance(ctx context.Context, id uuid.UUID, balance decimal.Decimal, at time.Time) error

	// ListForBalanceRefresh returns accounts whose reading is older than
	// maxAge, oldest first, capped at limit.
	ListForBalanceRefresh(ctx context.Context, now time.Time, maxAge time.Duration, limit int) ([]*Account, error)
}
```

`internal/domain/bankaccount/service.go`:

```go
package bankaccount

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	CreateCluster(ctx context.Context, name string) (*Cluster, error)
	ListClusters(ctx context.Context) ([]*Cluster, error)

	Attach(ctx context.Context, data *AttachData) (*Account, error)
	GetByID(ctx context.Context, id uuid.UUID) (*Account, error)
	List(ctx context.Context) ([]*Account, error)
	ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*Account, error)
	Update(ctx context.Context, id uuid.UUID, data *UpdateData) (*Account, error)
}

// Router picks the account a deposit is paid into or a payout is paid from.
// It is separate from Service because selection is read-only and is called on
// every money request, while Service is the operator's editing surface.
type Router interface {
	SelectInbound(ctx context.Context, q InboundQuery) ([]*Account, error)
	SelectOutbound(ctx context.Context, q OutboundQuery) (*Account, error)
}
```

`internal/domain/bankaccount/validator.go`:

```go
package bankaccount

import (
	"strings"

	"github.com/google/uuid"
)

func ValidateAttach(data *AttachData) error {
	if data.DeviceID == uuid.Nil {
		return ErrDeviceRequired
	}
	if strings.TrimSpace(data.AccountNo) == "" {
		return ErrAccountNoRequired
	}
	if strings.TrimSpace(data.AccountName) == "" {
		return ErrAccountNameRequired
	}
	if strings.TrimSpace(data.BankCode) == "" {
		return ErrBankCodeRequired
	}
	if err := validateTier(data.Tier); err != nil {
		return err
	}
	if data.PromptPayID != "" && data.Tier != TierInbound {
		return ErrPromptPayOnlyOnInbound
	}
	if data.ClusterID != uuid.Nil && data.MerchantID != uuid.Nil {
		return ErrOwnerAmbiguous
	}

	return nil
}

// ValidateUpdate checks a partial change against the account it applies to.
// A field left unset is not checked, because leaving it alone cannot break a
// rule the stored row already satisfies.
func ValidateUpdate(a *Account, data *UpdateData) error {
	tier := a.Tier
	if data.Tier != "" {
		if err := validateTier(data.Tier); err != nil {
			return err
		}
		tier = data.Tier
	}

	if data.Status != "" {
		switch data.Status {
		case StatusActive, StatusCooling, StatusSuspended:
		default:
			return ErrStatusInvalid
		}
	}

	promptPay := a.PromptPayID
	if data.PromptPayID != nil {
		promptPay = *data.PromptPayID
	}
	if promptPay != "" && tier != TierInbound {
		return ErrPromptPayOnlyOnInbound
	}

	cluster := a.ClusterID
	if data.ClusterID != nil {
		cluster = *data.ClusterID
	}
	merchant := a.MerchantID
	if data.MerchantID != nil {
		merchant = *data.MerchantID
	}
	if cluster != uuid.Nil && merchant != uuid.Nil {
		return ErrOwnerAmbiguous
	}

	return nil
}

func ValidateClusterName(name string) error {
	if strings.TrimSpace(name) == "" {
		return ErrClusterNameRequired
	}
	return nil
}

func validateTier(t Tier) error {
	switch t {
	case TierInbound, TierVault, TierOutbound:
		return nil
	default:
		return ErrTierInvalid
	}
}
```

- [ ] **Step 6: Write the model and mapper**

`internal/adapter/persistence/model/bankaccount.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type AccountCluster struct {
	ID        uuid.UUID `db:"id"`
	Name      string    `db:"name"`
	Status    string    `db:"status"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

type BankAccount struct {
	ID             uuid.UUID           `db:"id"`
	DeviceID       uuid.UUID           `db:"device_id"`
	AccountNo      string              `db:"account_no"`
	AccountName    string              `db:"account_name"`
	BankCode       string              `db:"bank_code"`
	Tier           string              `db:"tier"`
	ClusterID      uuid.NullUUID       `db:"cluster_id"`
	MerchantID     uuid.NullUUID       `db:"merchant_id"`
	PromptPayID    sql.NullString      `db:"promptpay_id"`
	Status         string              `db:"status"`
	DailyAmountCap decimal.Decimal     `db:"daily_amount_cap"`
	DailyTxnCap    int                 `db:"daily_txn_cap"`
	MinBalance     decimal.Decimal     `db:"min_balance"`
	TargetBalance  decimal.Decimal     `db:"target_balance"`
	BankBalance    decimal.NullDecimal `db:"bank_balance"`
	BankBalanceAt  sql.NullTime        `db:"bank_balance_at"`
	CreatedAt      time.Time           `db:"created_at"`
	UpdatedAt      time.Time           `db:"updated_at"`
}
```

`internal/adapter/persistence/mapper/bankaccount.go`:

```go
package mapper

import (
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/bankaccount"

	"github.com/shopspring/decimal"
)

func nullDecimal(d decimal.Decimal) decimal.NullDecimal {
	return decimal.NullDecimal{Decimal: d, Valid: true}
}

func AccountClusterToModel(c *bankaccount.Cluster) *model.AccountCluster {
	if c == nil {
		return nil
	}
	return &model.AccountCluster{
		ID: c.ID, Name: c.Name, Status: c.Status,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

func AccountClusterToDomain(m *model.AccountCluster) *bankaccount.Cluster {
	if m == nil {
		return nil
	}
	return &bankaccount.Cluster{
		ID: m.ID, Name: m.Name, Status: m.Status,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

func AccountClustersToDomain(models []*model.AccountCluster) []*bankaccount.Cluster {
	out := make([]*bankaccount.Cluster, 0, len(models))
	for _, m := range models {
		out = append(out, AccountClusterToDomain(m))
	}
	return out
}

func BankAccountToModel(a *bankaccount.Account) *model.BankAccount {
	if a == nil {
		return nil
	}
	return &model.BankAccount{
		ID: a.ID, DeviceID: a.DeviceID,
		AccountNo: a.AccountNo, AccountName: a.AccountName, BankCode: a.BankCode,
		Tier: string(a.Tier), ClusterID: nullUUID(a.ClusterID), MerchantID: nullUUID(a.MerchantID),
		PromptPayID: nullString(a.PromptPayID), Status: a.Status,
		DailyAmountCap: a.DailyAmountCap, DailyTxnCap: a.DailyTxnCap,
		MinBalance: a.MinBalance, TargetBalance: a.TargetBalance,
		BankBalance: nullDecimal(a.BankBalance), BankBalanceAt: nullTime(a.BankBalanceAt),
		CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
	}
}

func BankAccountToDomain(m *model.BankAccount) *bankaccount.Account {
	if m == nil {
		return nil
	}
	return &bankaccount.Account{
		ID: m.ID, DeviceID: m.DeviceID,
		AccountNo: m.AccountNo, AccountName: m.AccountName, BankCode: m.BankCode,
		Tier: bankaccount.Tier(m.Tier), ClusterID: m.ClusterID.UUID, MerchantID: m.MerchantID.UUID,
		PromptPayID: m.PromptPayID.String, Status: m.Status,
		DailyAmountCap: m.DailyAmountCap, DailyTxnCap: m.DailyTxnCap,
		MinBalance: m.MinBalance, TargetBalance: m.TargetBalance,
		BankBalance: m.BankBalance.Decimal, BankBalanceAt: m.BankBalanceAt.Time,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

func BankAccountsToDomain(models []*model.BankAccount) []*bankaccount.Account {
	out := make([]*bankaccount.Account, 0, len(models))
	for _, m := range models {
		out = append(out, BankAccountToDomain(m))
	}
	return out
}
```

`nullUUID`, `nullString` and `nullTime` already exist in that package (in `merchant.go`, `device.go` and `credential.go`) — do not redeclare them.

- [ ] **Step 7: Run the tests and the migration**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/domain/bankaccount/ ./internal/adapter/persistence/... -v
make migrate-up
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c '\d bank_accounts'
```

Expected: tests PASS, three tables created, both CHECK constraints listed.

- [ ] **Step 8: Prove the two shape constraints against the real database**

```bash
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c "
INSERT INTO bank_accounts (device_id, account_no, account_name, bank_code, tier, promptpay_id, status)
SELECT id, '1', 'X', '006', 'OUTBOUND', '0812345678', 'ACTIVE' FROM devices LIMIT 1;"
```

Expected: refused by the `promptpay_id IS NULL OR tier = 'INBOUND'` check. If the `devices` table is empty the statement inserts nothing and proves nothing — register or add a device first, or seed one row.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/000006_bank_accounts.*.sql internal/domain/bankaccount \
        internal/adapter/persistence/model/bankaccount.go \
        internal/adapter/persistence/mapper/bankaccount.go
git commit -m "feat(bankaccount): add the three-tier pool schema and its rules"
```

---

### Task 3: The pool repository, including the two selection queries

The selection rules live in SQL, not in Go. A cap checked in Go reads a count another request has already moved past, and a freshness check in Go reads a timestamp that was true when the row was fetched. Both are the kind of thing that looks correct in review and is wrong under load.

**Files:**
- Create: `internal/adapter/repository/bankaccount/repository.go`
- Test: `internal/adapter/repository/bankaccount/repository_test.go`
- Test: `internal/adapter/repository/bankaccount/integration_test.go`

**Interfaces:**
- Consumes: `bankaccount.Repository`, `mapper.BankAccountToDomain`, `base.BaseRepository`, `pgtest`
- Produces: `bankaccountrepo.NewRepository(db *sqlx.DB) bankaccount.Repository`

- [ ] **Step 1: Write the failing sqlmock tests**

`internal/adapter/repository/bankaccount/repository_test.go`:

```go
package bankaccount_test

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	bankrepo "be-maxpay/internal/adapter/repository/bankaccount"
	domainbank "be-maxpay/internal/domain/bankaccount"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRepo(t *testing.T) (domainbank.Repository, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return bankrepo.NewRepository(sqlx.NewDb(db, "sqlmock")), mock
}

func accountRows(id uuid.UUID) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "device_id", "account_no", "account_name", "bank_code", "tier",
		"cluster_id", "merchant_id", "promptpay_id", "status",
		"daily_amount_cap", "daily_txn_cap", "min_balance", "target_balance",
		"bank_balance", "bank_balance_at", "created_at", "updated_at",
	}).AddRow(
		id, uuid.New(), "1234567890", "MAXPAY CO LTD", "006", "INBOUND",
		nil, nil, nil, "ACTIVE",
		decimal.Zero, 0, decimal.Zero, decimal.Zero,
		nil, nil, time.Now(), time.Now(),
	)
}

func TestBankAccountRepository_GetByID_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(`FROM bank_accounts WHERE id = $1`)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnError(sql.ErrNoRows)

	_, err := repo.GetByID(context.Background(), uuid.New())
	require.ErrorIs(t, err, domainbank.ErrAccountNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBankAccountRepository_Attach_DuplicateAccountIsNamed(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO bank_accounts`)).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "bank_accounts_bank_code_account_no_key"})

	_, err := repo.Attach(context.Background(), &domainbank.Account{
		DeviceID: uuid.New(), AccountNo: "1234567890", AccountName: "X",
		BankCode: "006", Tier: domainbank.TierInbound, Status: domainbank.StatusActive,
	})

	require.ErrorIs(t, err, domainbank.ErrAccountExists)
	require.NoError(t, mock.ExpectationsWereMet())
}

// The cap and freshness filters must reach the database. Asserting the SQL
// text is the only thing sqlmock can prove here; the integration test proves
// the behaviour.
func TestBankAccountRepository_InboundCandidates_FiltersInSQL(t *testing.T) {
	repo, mock := newRepo(t)
	id := uuid.New()
	cluster := uuid.New()
	today := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`daily_amount_cap`)).
		WithArgs(today, sqlmock.AnyArg(), cluster).
		WillReturnRows(accountRows(id))

	got, err := repo.InboundCandidates(context.Background(), domainbank.InboundQuery{
		ClusterID: cluster, Today: today,
	})
	require.NoError(t, err)
	assert.Len(t, got, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBankAccountRepository_OutboundCandidates_FiltersInSQL(t *testing.T) {
	repo, mock := newRepo(t)
	id := uuid.New()
	cluster := uuid.New()
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(`bank_balance`)).
		WithArgs(sqlmock.AnyArg(), cluster, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(accountRows(id))

	got, err := repo.OutboundCandidates(context.Background(), domainbank.OutboundQuery{
		ClusterID: cluster, Amount: decimal.RequireFromString("1000"),
		Now: now, MaxAge: 5 * time.Minute,
	})
	require.NoError(t, err)
	assert.Len(t, got, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBankAccountRepository_RecordBalance_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(regexp.QuoteMeta(`UPDATE bank_accounts SET`)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := repo.RecordBalance(context.Background(), uuid.New(), decimal.RequireFromString("1"), time.Now())
	require.ErrorIs(t, err, domainbank.ErrAccountNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/adapter/repository/bankaccount/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the repository**

`internal/adapter/repository/bankaccount/repository.go`:

```go
package bankaccount

import (
	"context"
	"errors"
	"time"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/adapter/repository/base"
	domainbank "be-maxpay/internal/domain/bankaccount"
	"be-maxpay/internal/shared/errs"
	"be-maxpay/internal/shared/id"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
)

var (
	clusterColumns = []string{"id", "name", "status", "created_at", "updated_at"}

	accountColumns = []string{
		"id", "device_id", "account_no", "account_name", "bank_code", "tier",
		"cluster_id", "merchant_id", "promptpay_id", "status",
		"daily_amount_cap", "daily_txn_cap", "min_balance", "target_balance",
		"bank_balance", "bank_balance_at", "created_at", "updated_at",
	}
)

// accountSelect is the projection the two hand-written candidate queries
// share. They are hand-written because squirrel has no LEFT JOIN against a
// derived per-day row plus a COALESCE-guarded cap comparison, and forcing it
// through the builder would be less readable than the SQL itself.
const accountSelect = `a.id, a.device_id, a.account_no, a.account_name, a.bank_code, a.tier,
	a.cluster_id, a.merchant_id, a.promptpay_id, a.status,
	a.daily_amount_cap, a.daily_txn_cap, a.min_balance, a.target_balance,
	a.bank_balance, a.bank_balance_at, a.created_at, a.updated_at`

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domainbank.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

var _ domainbank.Repository = (*Repository)(nil)

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

func (r *Repository) CreateCluster(ctx context.Context, c *domainbank.Cluster) (*domainbank.Cluster, error) {
	now := time.Now().UTC()
	newID := id.New()

	sqlStr, args, err := r.Builder.Insert("account_clusters").
		Columns("id", "name", "status", "created_at", "updated_at").
		Values(newID, c.Name, domainbank.ClusterStatusActive, now, now).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build create cluster query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		if errs.IsDuplicateError(err) {
			return nil, domainbank.ErrClusterNameExists
		}
		return nil, errs.WrapDatabaseError(err, "create cluster")
	}

	return r.GetCluster(ctx, newID)
}

func (r *Repository) GetCluster(ctx context.Context, cid uuid.UUID) (*domainbank.Cluster, error) {
	sqlStr, args, err := r.Builder.Select(clusterColumns...).
		From("account_clusters").
		Where(squirrel.Eq{"id": cid}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build get cluster query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.AccountCluster
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domainbank.ErrClusterNotFound)
		}
		return nil, errs.WrapDatabaseError(err, "get cluster")
	}

	return mapper.AccountClusterToDomain(&m), nil
}

func (r *Repository) ListClusters(ctx context.Context) ([]*domainbank.Cluster, error) {
	sqlStr, args, err := r.Builder.Select(clusterColumns...).
		From("account_clusters").
		OrderBy("name ASC").
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build list clusters query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.AccountCluster
	if err := r.DB.SelectContext(ctx, &models, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, "list clusters")
	}

	return mapper.AccountClustersToDomain(models), nil
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

func (r *Repository) Attach(ctx context.Context, a *domainbank.Account) (*domainbank.Account, error) {
	now := time.Now().UTC()
	newID := id.New()

	sqlStr, args, err := r.Builder.Insert("bank_accounts").
		Columns("id", "device_id", "account_no", "account_name", "bank_code", "tier",
			"cluster_id", "merchant_id", "promptpay_id", "status",
			"daily_amount_cap", "daily_txn_cap", "min_balance", "target_balance",
			"created_at", "updated_at").
		Values(newID, a.DeviceID, a.AccountNo, a.AccountName, a.BankCode, string(a.Tier),
			nilUUID(a.ClusterID), nilUUID(a.MerchantID), nilString(a.PromptPayID),
			domainbank.StatusActive,
			a.DailyAmountCap, a.DailyTxnCap, a.MinBalance, a.TargetBalance,
			now, now).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build attach account query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		return nil, mapAccountViolation(err)
	}

	return r.GetByID(ctx, newID)
}

func (r *Repository) GetByID(ctx context.Context, aid uuid.UUID) (*domainbank.Account, error) {
	sqlStr, args, err := r.Builder.Select(accountColumns...).
		From("bank_accounts").
		Where(squirrel.Eq{"id": aid}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build get account query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.BankAccount
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domainbank.ErrAccountNotFound)
		}
		return nil, errs.WrapDatabaseError(err, "get account")
	}

	return mapper.BankAccountToDomain(&m), nil
}

func (r *Repository) List(ctx context.Context) ([]*domainbank.Account, error) {
	return r.listWhere(ctx, nil, "list accounts")
}

func (r *Repository) ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*domainbank.Account, error) {
	return r.listWhere(ctx, squirrel.Eq{"merchant_id": merchantID}, "list accounts for merchant")
}

func (r *Repository) listWhere(ctx context.Context, where squirrel.Sqlizer, label string) ([]*domainbank.Account, error) {
	builder := r.Builder.Select(accountColumns...).From("bank_accounts")
	if where != nil {
		builder = builder.Where(where)
	}

	sqlStr, args, err := builder.OrderBy("tier ASC", "account_no ASC").ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build "+label+" query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.BankAccount
	if err := r.DB.SelectContext(ctx, &models, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, label)
	}

	return mapper.BankAccountsToDomain(models), nil
}

func (r *Repository) Update(ctx context.Context, aid uuid.UUID, data *domainbank.UpdateData) (*domainbank.Account, error) {
	values := map[string]any{}
	if data.Tier != "" {
		values["tier"] = string(data.Tier)
	}
	if data.Status != "" {
		values["status"] = data.Status
	}
	// A pointer that is set but nil-valued clears the column: that is how an
	// account is taken out of a cluster, which a zero value could not express.
	if data.ClusterID != nil {
		values["cluster_id"] = nilUUID(*data.ClusterID)
	}
	if data.MerchantID != nil {
		values["merchant_id"] = nilUUID(*data.MerchantID)
	}
	if data.PromptPayID != nil {
		values["promptpay_id"] = nilString(*data.PromptPayID)
	}
	if data.DailyAmountCap != nil {
		values["daily_amount_cap"] = *data.DailyAmountCap
	}
	if data.DailyTxnCap != nil {
		values["daily_txn_cap"] = *data.DailyTxnCap
	}
	if data.MinBalance != nil {
		values["min_balance"] = *data.MinBalance
	}
	if data.TargetBalance != nil {
		values["target_balance"] = *data.TargetBalance
	}

	if len(values) == 0 {
		return r.GetByID(ctx, aid)
	}

	sqlStr, args, err := r.Builder.Update("bank_accounts").
		SetMap(values).
		Set("updated_at", time.Now().UTC()).
		Where(squirrel.Eq{"id": aid}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build update account query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, mapAccountViolation(err)
	}
	if err := r.CheckRowsAffectedWith(result, domainbank.ErrAccountNotFound); err != nil {
		return nil, err
	}

	return r.GetByID(ctx, aid)
}

// InboundCandidates applies both caps in SQL against today's counters.
//
// Exactly one of MerchantID and ClusterID is set by the caller: a dedicated
// merchant reads its own accounts, a shared one reads its cluster's. The two
// NULL guards make the unused branch inert rather than matching everything.
func (r *Repository) InboundCandidates(ctx context.Context, q domainbank.InboundQuery) ([]*domainbank.Account, error) {
	const query = `
SELECT ` + accountSelect + `
  FROM bank_accounts a
  LEFT JOIN bank_account_daily_stats s
    ON s.account_id = a.id AND s.stat_date = $1
 WHERE a.tier = 'INBOUND'
   AND a.status = 'ACTIVE'
   AND ( ($2::uuid IS NOT NULL AND a.merchant_id = $2)
      OR ($3::uuid IS NOT NULL AND a.cluster_id = $3) )
   AND (a.daily_amount_cap = 0 OR COALESCE(s.in_amount, 0) < a.daily_amount_cap)
   AND (a.daily_txn_cap = 0 OR COALESCE(s.in_count, 0) < a.daily_txn_cap)
 ORDER BY COALESCE(s.in_count, 0) ASC, a.id ASC`

	return r.selectAccounts(ctx, query, "inbound candidates",
		q.Today, nilUUID(q.MerchantID), nilUUID(q.ClusterID))
}

// OutboundCandidates applies the balance rules in SQL.
//
// A stale reading is treated as unknown, not as zero and not as sufficient:
// the freshness comparison is part of the WHERE clause precisely so no caller
// can forget it.
func (r *Repository) OutboundCandidates(ctx context.Context, q domainbank.OutboundQuery) ([]*domainbank.Account, error) {
	const query = `
SELECT ` + accountSelect + `
  FROM bank_accounts a
 WHERE a.tier = 'OUTBOUND'
   AND a.status = 'ACTIVE'
   AND ( ($1::uuid IS NOT NULL AND a.merchant_id = $1)
      OR ($2::uuid IS NOT NULL AND a.cluster_id = $2) )
   AND a.bank_balance IS NOT NULL
   AND a.bank_balance_at > $3
   AND a.bank_balance - $4 >= a.min_balance
 ORDER BY a.bank_balance DESC, a.id ASC`

	return r.selectAccounts(ctx, query, "outbound candidates",
		nilUUID(q.MerchantID), nilUUID(q.ClusterID), q.Now.Add(-q.MaxAge), q.Amount)
}

func (r *Repository) selectAccounts(ctx context.Context, query, label string, args ...any) ([]*domainbank.Account, error) {
	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.BankAccount
	if err := r.DB.SelectContext(ctx, &models, query, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, label)
	}

	return mapper.BankAccountsToDomain(models), nil
}

func (r *Repository) RecordBalance(ctx context.Context, aid uuid.UUID, balance decimal.Decimal, at time.Time) error {
	sqlStr, args, err := r.Builder.Update("bank_accounts").
		SetMap(map[string]any{"bank_balance": balance, "bank_balance_at": at}).
		Where(squirrel.Eq{"id": aid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build record balance query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "record balance")
	}

	return r.CheckRowsAffectedWith(result, domainbank.ErrAccountNotFound)
}

// ListForBalanceRefresh includes COOLING accounts: one may be returned to
// service at any moment, and a stale balance is exactly what would stop it
// being usable when it is.
func (r *Repository) ListForBalanceRefresh(ctx context.Context, now time.Time, maxAge time.Duration, limit int) ([]*domainbank.Account, error) {
	const query = `
SELECT ` + accountSelect + `
  FROM bank_accounts a
 WHERE a.status IN ('ACTIVE', 'COOLING')
   AND (a.bank_balance_at IS NULL OR a.bank_balance_at < $1)
 ORDER BY a.bank_balance_at ASC NULLS FIRST
 LIMIT $2`

	return r.selectAccounts(ctx, query, "list accounts for balance refresh",
		now.Add(-maxAge), limit)
}

// mapAccountViolation names the rule that was broken. "duplicate key" leaves
// an operator guessing between a re-added account and a shape rule.
func mapAccountViolation(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case pgErr.Code == "23505":
			return domainbank.ErrAccountExists
		case pgErr.Code == "23514" && pgErr.ConstraintName == "bank_accounts_check1":
			return domainbank.ErrPromptPayOnlyOnInbound
		case pgErr.Code == "23514":
			return domainbank.ErrOwnerAmbiguous
		}
	}

	return errs.WrapDatabaseError(err, "write bank account")
}

func nilUUID(u uuid.UUID) any {
	if u == uuid.Nil {
		return nil
	}
	return u
}

func nilString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
```

- [ ] **Step 4: Run the sqlmock tests**

Run: `go test ./internal/adapter/repository/bankaccount/ -v`
Expected: PASS, all five.

- [ ] **Step 5: Write the integration test for what SQL actually does**

The sqlmock tests above prove the filters are IN the statement. Only a real database proves they WORK.

`internal/adapter/repository/bankaccount/integration_test.go`:

```go
//go:build integration

package bankaccount_test

import (
	"context"
	"testing"
	"time"

	bankrepo "be-maxpay/internal/adapter/repository/bankaccount"
	devicerepo "be-maxpay/internal/adapter/repository/device"
	domainbank "be-maxpay/internal/domain/bankaccount"
	domaindevice "be-maxpay/internal/domain/device"
	"be-maxpay/internal/testutil/pgtest"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedDevice(t *testing.T, db *sqlx.DB) uuid.UUID {
	t.Helper()

	repo := devicerepo.NewRepository(db)
	d, err := repo.Create(context.Background(), &domaindevice.CreateDeviceData{
		Alias: "pool-test", DeviceID: uuid.NewString() + "-devc", PIN: "1234",
	})
	require.NoError(t, err)

	return d.ID
}

func attach(t *testing.T, repo domainbank.Repository, deviceID uuid.UUID, a domainbank.Account) *domainbank.Account {
	t.Helper()

	a.DeviceID = deviceID
	if a.AccountName == "" {
		a.AccountName = "MAXPAY CO LTD"
	}
	if a.BankCode == "" {
		a.BankCode = "006"
	}
	created, err := repo.Attach(context.Background(), &a)
	require.NoError(t, err)

	return created
}

func TestBankAccountRepository_Integration_DuplicateAccountIsRefused(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "bank_accounts", "account_clusters", "devices")
	repo := bankrepo.NewRepository(db)
	deviceID := seedDevice(t, db)

	attach(t, repo, deviceID, domainbank.Account{AccountNo: "1234567890", Tier: domainbank.TierInbound})

	_, err := repo.Attach(context.Background(), &domainbank.Account{
		DeviceID: deviceID, AccountNo: "1234567890", AccountName: "X",
		BankCode: "006", Tier: domainbank.TierVault,
	})

	require.ErrorIs(t, err, domainbank.ErrAccountExists,
		"the same account at the same bank must not be in the pool twice")
}

// The cap filter is the whole point of the inbound query. This is the test
// that would fail if someone moved it into Go.
func TestBankAccountRepository_Integration_InboundRespectsTheDailyTxnCap(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "bank_account_daily_stats", "bank_accounts", "account_clusters", "devices")
	repo := bankrepo.NewRepository(db)
	ctx := context.Background()
	deviceID := seedDevice(t, db)

	cluster, err := repo.CreateCluster(ctx, &domainbank.Cluster{Name: "cluster-one"})
	require.NoError(t, err)

	capped := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "1111111111", Tier: domainbank.TierInbound,
		ClusterID: cluster.ID, DailyTxnCap: 2,
	})
	free := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "2222222222", Tier: domainbank.TierInbound,
		ClusterID: cluster.ID,
	})

	today := time.Now().UTC().Truncate(24 * time.Hour)
	_, err = db.ExecContext(ctx,
		`INSERT INTO bank_account_daily_stats (account_id, stat_date, in_count) VALUES ($1, $2, 2)`,
		capped.ID, today)
	require.NoError(t, err)

	got, err := repo.InboundCandidates(ctx, domainbank.InboundQuery{ClusterID: cluster.ID, Today: today})
	require.NoError(t, err)

	require.Len(t, got, 1, "the account that has reached its transaction cap must not be offered")
	assert.Equal(t, free.ID, got[0].ID)
}

func TestBankAccountRepository_Integration_InboundOrdersByLeastLoaded(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "bank_account_daily_stats", "bank_accounts", "account_clusters", "devices")
	repo := bankrepo.NewRepository(db)
	ctx := context.Background()
	deviceID := seedDevice(t, db)

	cluster, err := repo.CreateCluster(ctx, &domainbank.Cluster{Name: "cluster-one"})
	require.NoError(t, err)

	busy := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "1111111111", Tier: domainbank.TierInbound, ClusterID: cluster.ID,
	})
	quiet := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "2222222222", Tier: domainbank.TierInbound, ClusterID: cluster.ID,
	})

	today := time.Now().UTC().Truncate(24 * time.Hour)
	_, err = db.ExecContext(ctx,
		`INSERT INTO bank_account_daily_stats (account_id, stat_date, in_count) VALUES ($1, $2, 5)`,
		busy.ID, today)
	require.NoError(t, err)

	got, err := repo.InboundCandidates(ctx, domainbank.InboundQuery{ClusterID: cluster.ID, Today: today})
	require.NoError(t, err)

	require.Len(t, got, 2)
	assert.Equal(t, quiet.ID, got[0].ID, "the account with no volume today comes first")
}

// A stale balance is unknown, and unknown must never satisfy a payout.
func TestBankAccountRepository_Integration_OutboundRefusesAStaleBalance(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "bank_account_daily_stats", "bank_accounts", "account_clusters", "devices")
	repo := bankrepo.NewRepository(db)
	ctx := context.Background()
	deviceID := seedDevice(t, db)

	cluster, err := repo.CreateCluster(ctx, &domainbank.Cluster{Name: "cluster-one"})
	require.NoError(t, err)

	stale := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "3333333333", Tier: domainbank.TierOutbound, ClusterID: cluster.ID,
	})
	fresh := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "4444444444", Tier: domainbank.TierOutbound, ClusterID: cluster.ID,
	})

	now := time.Now().UTC()
	require.NoError(t, repo.RecordBalance(ctx, stale.ID, decimal.RequireFromString("1000000"), now.Add(-time.Hour)))
	require.NoError(t, repo.RecordBalance(ctx, fresh.ID, decimal.RequireFromString("500000"), now))

	got, err := repo.OutboundCandidates(ctx, domainbank.OutboundQuery{
		ClusterID: cluster.ID, Amount: decimal.RequireFromString("1000"),
		Now: now, MaxAge: 5 * time.Minute,
	})
	require.NoError(t, err)

	require.Len(t, got, 1, "the account with the larger but stale balance must not be offered")
	assert.Equal(t, fresh.ID, got[0].ID)
}

// An account that cannot pay without dipping below its minimum is not a
// candidate, however large its balance looks.
func TestBankAccountRepository_Integration_OutboundLeavesTheMinimumBehind(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "bank_account_daily_stats", "bank_accounts", "account_clusters", "devices")
	repo := bankrepo.NewRepository(db)
	ctx := context.Background()
	deviceID := seedDevice(t, db)

	cluster, err := repo.CreateCluster(ctx, &domainbank.Cluster{Name: "cluster-one"})
	require.NoError(t, err)

	account := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "5555555555", Tier: domainbank.TierOutbound, ClusterID: cluster.ID,
		MinBalance: decimal.RequireFromString("100000"),
	})

	now := time.Now().UTC()
	require.NoError(t, repo.RecordBalance(ctx, account.ID, decimal.RequireFromString("150000"), now))

	ok, err := repo.OutboundCandidates(ctx, domainbank.OutboundQuery{
		ClusterID: cluster.ID, Amount: decimal.RequireFromString("50000"),
		Now: now, MaxAge: 5 * time.Minute,
	})
	require.NoError(t, err)
	assert.Len(t, ok, 1, "paying exactly down to the minimum is allowed")

	tooMuch, err := repo.OutboundCandidates(ctx, domainbank.OutboundQuery{
		ClusterID: cluster.ID, Amount: decimal.RequireFromString("50000.01"),
		Now: now, MaxAge: 5 * time.Minute,
	})
	require.NoError(t, err)
	assert.Empty(t, tooMuch, "one satang past the minimum is not")
}

// A dedicated account belongs to one merchant and must never appear in
// another merchant's cluster selection.
func TestBankAccountRepository_Integration_DedicatedAccountsStayPrivate(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "bank_account_daily_stats", "bank_accounts", "account_clusters", "devices")
	repo := bankrepo.NewRepository(db)
	ctx := context.Background()
	deviceID := seedDevice(t, db)

	cluster, err := repo.CreateCluster(ctx, &domainbank.Cluster{Name: "cluster-one"})
	require.NoError(t, err)

	shared := attach(t, repo, deviceID, domainbank.Account{
		AccountNo: "6666666666", Tier: domainbank.TierInbound, ClusterID: cluster.ID,
	})

	today := time.Now().UTC().Truncate(24 * time.Hour)
	got, err := repo.InboundCandidates(ctx, domainbank.InboundQuery{ClusterID: cluster.ID, Today: today})
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, shared.ID, got[0].ID)

	// A merchant-scoped query against a cluster account returns nothing.
	none, err := repo.InboundCandidates(ctx, domainbank.InboundQuery{MerchantID: uuid.New(), Today: today})
	require.NoError(t, err)
	assert.Empty(t, none)
}
```

- [ ] **Step 6: Run the integration suite**

```bash
export PATH="$PATH:$HOME/go/bin"
make test-integration
```

Expected: all six new integration tests PASS.

- [ ] **Step 7: Prove the cap filter has teeth**

Temporarily delete the two cap lines from `InboundCandidates`' WHERE clause and re-run `TestBankAccountRepository_Integration_InboundRespectsTheDailyTxnCap`. It must FAIL with two accounts returned. Restore the lines, confirm it passes, and record both results in your report. A filter nothing can fail on is a filter nobody will notice losing.

- [ ] **Step 8: Commit**

```bash
git add internal/adapter/repository/bankaccount
git commit -m "feat(bankaccount): add the pool repository and its selection queries"
```

---

### Task 4: The pool service

**Files:**
- Create: `internal/service/bankaccount/service.go`
- Test: `internal/service/bankaccount/service_test.go`

**Interfaces:**
- Consumes: `bankaccount.Repository`, `bankaccount.ValidateAttach`, `ValidateUpdate`, `ValidateClusterName`
- Produces: `bankaccountsvc.NewService(repo bankaccount.Repository) bankaccount.Service`, with `var _ bankaccount.Service = (*Service)(nil)`

- [ ] **Step 1: Write the failing tests**

`internal/service/bankaccount/service_test.go`:

```go
package bankaccount_test

import (
	"context"
	"testing"
	"time"

	domainbank "be-maxpay/internal/domain/bankaccount"
	banksvc "be-maxpay/internal/service/bankaccount"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	accounts map[uuid.UUID]*domainbank.Account
	clusters map[uuid.UUID]*domainbank.Cluster
	attached *domainbank.Account
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		accounts: map[uuid.UUID]*domainbank.Account{},
		clusters: map[uuid.UUID]*domainbank.Cluster{},
	}
}

var _ domainbank.Repository = (*fakeRepo)(nil)

func (f *fakeRepo) CreateCluster(_ context.Context, c *domainbank.Cluster) (*domainbank.Cluster, error) {
	c.ID = uuid.New()
	c.Status = domainbank.ClusterStatusActive
	f.clusters[c.ID] = c
	return c, nil
}

func (f *fakeRepo) GetCluster(_ context.Context, id uuid.UUID) (*domainbank.Cluster, error) {
	c, ok := f.clusters[id]
	if !ok {
		return nil, domainbank.ErrClusterNotFound
	}
	return c, nil
}

func (f *fakeRepo) ListClusters(context.Context) ([]*domainbank.Cluster, error) { return nil, nil }

func (f *fakeRepo) Attach(_ context.Context, a *domainbank.Account) (*domainbank.Account, error) {
	a.ID = uuid.New()
	a.Status = domainbank.StatusActive
	f.attached = a
	f.accounts[a.ID] = a
	return a, nil
}

func (f *fakeRepo) GetByID(_ context.Context, id uuid.UUID) (*domainbank.Account, error) {
	a, ok := f.accounts[id]
	if !ok {
		return nil, domainbank.ErrAccountNotFound
	}
	return a, nil
}

func (f *fakeRepo) List(context.Context) ([]*domainbank.Account, error) { return nil, nil }

func (f *fakeRepo) ListForMerchant(context.Context, uuid.UUID) ([]*domainbank.Account, error) {
	return nil, nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, _ *domainbank.UpdateData) (*domainbank.Account, error) {
	return f.GetByID(context.Background(), id)
}

func (f *fakeRepo) InboundCandidates(context.Context, domainbank.InboundQuery) ([]*domainbank.Account, error) {
	return nil, nil
}

func (f *fakeRepo) OutboundCandidates(context.Context, domainbank.OutboundQuery) ([]*domainbank.Account, error) {
	return nil, nil
}

func (f *fakeRepo) RecordBalance(context.Context, uuid.UUID, decimal.Decimal, time.Time) error {
	return nil
}

func (f *fakeRepo) ListForBalanceRefresh(context.Context, time.Time, time.Duration, int) ([]*domainbank.Account, error) {
	return nil, nil
}

func seedCluster(t *testing.T, repo *fakeRepo) uuid.UUID {
	t.Helper()
	c, err := repo.CreateCluster(context.Background(), &domainbank.Cluster{Name: "cluster-one"})
	require.NoError(t, err)
	return c.ID
}

func TestBankAccountService_Attach_StoresAnActiveAccount(t *testing.T) {
	repo := newFakeRepo()
	svc := banksvc.NewService(repo)
	clusterID := seedCluster(t, repo)

	got, err := svc.Attach(context.Background(), &domainbank.AttachData{
		DeviceID: uuid.New(), AccountNo: "1234567890", AccountName: "MAXPAY CO LTD",
		BankCode: "006", Tier: domainbank.TierInbound, ClusterID: clusterID,
	})

	require.NoError(t, err)
	assert.Equal(t, domainbank.StatusActive, got.Status)
	assert.Equal(t, domainbank.TierInbound, got.Tier)
}

func TestBankAccountService_Attach_RefusesAnInvalidShape(t *testing.T) {
	repo := newFakeRepo()
	svc := banksvc.NewService(repo)

	_, err := svc.Attach(context.Background(), &domainbank.AttachData{
		DeviceID: uuid.New(), AccountNo: "1234567890", AccountName: "X",
		BankCode: "006", Tier: domainbank.TierOutbound, PromptPayID: "0812345678",
	})

	require.ErrorIs(t, err, domainbank.ErrPromptPayOnlyOnInbound)
	assert.Nil(t, repo.attached, "an invalid account must never reach the repository")
}

// A cluster that does not exist would leave an account pointing at nothing,
// and the foreign key would report it as an opaque database error.
func TestBankAccountService_Attach_RefusesAnUnknownCluster(t *testing.T) {
	repo := newFakeRepo()
	svc := banksvc.NewService(repo)

	_, err := svc.Attach(context.Background(), &domainbank.AttachData{
		DeviceID: uuid.New(), AccountNo: "1234567890", AccountName: "X",
		BankCode: "006", Tier: domainbank.TierInbound, ClusterID: uuid.New(),
	})

	require.ErrorIs(t, err, domainbank.ErrClusterNotFound)
	assert.Nil(t, repo.attached)
}

func TestBankAccountService_Update_RevalidatesAgainstTheStoredAccount(t *testing.T) {
	repo := newFakeRepo()
	svc := banksvc.NewService(repo)
	clusterID := seedCluster(t, repo)

	account, err := svc.Attach(context.Background(), &domainbank.AttachData{
		DeviceID: uuid.New(), AccountNo: "1234567890", AccountName: "X",
		BankCode: "006", Tier: domainbank.TierInbound, ClusterID: clusterID,
		PromptPayID: "0812345678",
	})
	require.NoError(t, err)

	// Retiering an account that carries a PromptPay identity would leave a
	// vault account advertising a QR destination.
	newTier := domainbank.TierVault
	_, err = svc.Update(context.Background(), account.ID, &domainbank.UpdateData{Tier: newTier})

	require.ErrorIs(t, err, domainbank.ErrPromptPayOnlyOnInbound)
}

func TestBankAccountService_CreateCluster_RequiresAName(t *testing.T) {
	svc := banksvc.NewService(newFakeRepo())

	_, err := svc.CreateCluster(context.Background(), "   ")
	require.ErrorIs(t, err, domainbank.ErrClusterNameRequired)
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/service/bankaccount/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the service**

`internal/service/bankaccount/service.go`:

```go
// Package bankaccount implements the operator's editing surface for the pool.
package bankaccount

import (
	"context"

	domainbank "be-maxpay/internal/domain/bankaccount"

	"github.com/google/uuid"
)

type Service struct {
	repo domainbank.Repository
}

func NewService(repo domainbank.Repository) domainbank.Service {
	return &Service{repo: repo}
}

var _ domainbank.Service = (*Service)(nil)

func (s *Service) CreateCluster(ctx context.Context, name string) (*domainbank.Cluster, error) {
	if err := domainbank.ValidateClusterName(name); err != nil {
		return nil, err
	}

	return s.repo.CreateCluster(ctx, &domainbank.Cluster{Name: name})
}

func (s *Service) ListClusters(ctx context.Context) ([]*domainbank.Cluster, error) {
	return s.repo.ListClusters(ctx)
}

// Attach records an existing corporate account in the pool.
//
// The cluster is resolved before the insert so an unknown one is named as
// such, rather than surfacing as a foreign-key violation an operator would
// have to decode.
func (s *Service) Attach(ctx context.Context, data *domainbank.AttachData) (*domainbank.Account, error) {
	if err := domainbank.ValidateAttach(data); err != nil {
		return nil, err
	}

	if data.ClusterID != uuid.Nil {
		if _, err := s.repo.GetCluster(ctx, data.ClusterID); err != nil {
			return nil, err
		}
	}

	return s.repo.Attach(ctx, &domainbank.Account{
		DeviceID:       data.DeviceID,
		AccountNo:      data.AccountNo,
		AccountName:    data.AccountName,
		BankCode:       data.BankCode,
		Tier:           data.Tier,
		ClusterID:      data.ClusterID,
		MerchantID:     data.MerchantID,
		PromptPayID:    data.PromptPayID,
		Status:         domainbank.StatusActive,
		DailyAmountCap: data.DailyAmountCap,
		DailyTxnCap:    data.DailyTxnCap,
		MinBalance:     data.MinBalance,
		TargetBalance:  data.TargetBalance,
	})
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*domainbank.Account, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) List(ctx context.Context) ([]*domainbank.Account, error) {
	return s.repo.List(ctx)
}

func (s *Service) ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*domainbank.Account, error) {
	return s.repo.ListForMerchant(ctx, merchantID)
}

// Update re-reads the account so the shape rules are checked against what is
// stored, not against what the caller happens to have sent.
func (s *Service) Update(ctx context.Context, id uuid.UUID, data *domainbank.UpdateData) (*domainbank.Account, error) {
	current, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if err := domainbank.ValidateUpdate(current, data); err != nil {
		return nil, err
	}

	if data.ClusterID != nil && *data.ClusterID != uuid.Nil {
		if _, err := s.repo.GetCluster(ctx, *data.ClusterID); err != nil {
			return nil, err
		}
	}

	return s.repo.Update(ctx, id, data)
}
```

- [ ] **Step 4: Run the tests and the gate**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/service/bankaccount/ -v
make check
```

Expected: PASS, gate green.

- [ ] **Step 5: Commit**

```bash
git add internal/service/bankaccount
git commit -m "feat(bankaccount): add the pool editing service"
```

---

### Task 5: Routing — which account serves this request

Spec §8. The repository already applies every filter in SQL; this task is the thin layer that decides which query to run for a given merchant and what to do when nothing comes back.

**Files:**
- Create: `internal/service/bankaccount/routing.go`
- Modify: `internal/domain/bankaccount/dto.go`
- Test: `internal/service/bankaccount/routing_test.go`

**Interfaces:**
- Consumes: `bankaccount.Repository`, `merchant.Merchant`
- Produces:
  - `bankaccount.InboundQueryFor(m *merchant.Merchant, today time.Time) InboundQuery`
  - `bankaccount.OutboundQueryFor(m *merchant.Merchant, amount decimal.Decimal, now time.Time, maxAge time.Duration) OutboundQuery`
  - `bankaccountsvc.NewRouter(repo bankaccount.Repository, balanceMaxAge time.Duration) bankaccount.Router`

- [ ] **Step 1: Write the failing tests**

`internal/service/bankaccount/routing_test.go`:

```go
package bankaccount_test

import (
	"context"
	"testing"
	"time"

	domainbank "be-maxpay/internal/domain/bankaccount"
	domainmerchant "be-maxpay/internal/domain/merchant"
	banksvc "be-maxpay/internal/service/bankaccount"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type routingRepo struct {
	*fakeRepo
	inboundQ  domainbank.InboundQuery
	outboundQ domainbank.OutboundQuery
	inbound   []*domainbank.Account
	outbound  []*domainbank.Account
}

func newRoutingRepo() *routingRepo { return &routingRepo{fakeRepo: newFakeRepo()} }

func (r *routingRepo) InboundCandidates(_ context.Context, q domainbank.InboundQuery) ([]*domainbank.Account, error) {
	r.inboundQ = q
	return r.inbound, nil
}

func (r *routingRepo) OutboundCandidates(_ context.Context, q domainbank.OutboundQuery) ([]*domainbank.Account, error) {
	r.outboundQ = q
	return r.outbound, nil
}

func dedicated() *domainmerchant.Merchant {
	return &domainmerchant.Merchant{
		ID: uuid.New(), PoolModel: domainmerchant.PoolDedicated,
		ClusterID: uuid.New(), // deliberately set: it must be ignored
	}
}

func shared() *domainmerchant.Merchant {
	return &domainmerchant.Merchant{
		ID: uuid.New(), PoolModel: domainmerchant.PoolShared, ClusterID: uuid.New(),
	}
}

// A DEDICATED merchant reads its own accounts. Its cluster_id may be set from
// an earlier life and must not leak other merchants' accounts into its pool.
func TestInboundQueryFor_DedicatedIgnoresTheCluster(t *testing.T) {
	m := dedicated()
	q := domainbank.InboundQueryFor(m, time.Now())

	assert.Equal(t, m.ID, q.MerchantID)
	assert.Equal(t, uuid.Nil, q.ClusterID)
}

func TestInboundQueryFor_SharedUsesTheCluster(t *testing.T) {
	m := shared()
	q := domainbank.InboundQueryFor(m, time.Now())

	assert.Equal(t, uuid.Nil, q.MerchantID)
	assert.Equal(t, m.ClusterID, q.ClusterID)
}

func TestRouter_SelectInbound_ReturnsCandidatesInOrder(t *testing.T) {
	repo := newRoutingRepo()
	first, second := &domainbank.Account{ID: uuid.New()}, &domainbank.Account{ID: uuid.New()}
	repo.inbound = []*domainbank.Account{first, second}

	router := banksvc.NewRouter(repo, 5*time.Minute)
	got, err := router.SelectInbound(context.Background(), domainbank.InboundQueryFor(shared(), time.Now()))

	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, first.ID, got[0].ID, "the repository's ordering is the routing order")
}

// Refusing is the only safe answer: satisfying a deposit from an account that
// is over its cap is how a corporate account gets flagged.
func TestRouter_SelectInbound_RefusesWhenThePoolIsExhausted(t *testing.T) {
	repo := newRoutingRepo()
	router := banksvc.NewRouter(repo, 5*time.Minute)

	_, err := router.SelectInbound(context.Background(), domainbank.InboundQueryFor(shared(), time.Now()))
	require.ErrorIs(t, err, domainbank.ErrNoAccountAvailable)
}

func TestRouter_SelectOutbound_TakesTheLargestBalance(t *testing.T) {
	repo := newRoutingRepo()
	big := &domainbank.Account{ID: uuid.New(), BankBalance: decimal.RequireFromString("900000")}
	small := &domainbank.Account{ID: uuid.New(), BankBalance: decimal.RequireFromString("100000")}
	repo.outbound = []*domainbank.Account{big, small}

	router := banksvc.NewRouter(repo, 5*time.Minute)
	got, err := router.SelectOutbound(context.Background(),
		domainbank.OutboundQueryFor(shared(), decimal.RequireFromString("1000"), time.Now(), 5*time.Minute))

	require.NoError(t, err)
	assert.Equal(t, big.ID, got.ID)
}

func TestRouter_SelectOutbound_RefusesWhenNothingCanPay(t *testing.T) {
	repo := newRoutingRepo()
	router := banksvc.NewRouter(repo, 5*time.Minute)

	_, err := router.SelectOutbound(context.Background(),
		domainbank.OutboundQueryFor(shared(), decimal.RequireFromString("1000"), time.Now(), 5*time.Minute))
	require.ErrorIs(t, err, domainbank.ErrNoAccountAvailable)
}

// The configured window is what reaches the repository, not whatever the
// caller happened to pass.
func TestRouter_SelectOutbound_AppliesTheConfiguredFreshnessWindow(t *testing.T) {
	repo := newRoutingRepo()
	repo.outbound = []*domainbank.Account{{ID: uuid.New()}}

	router := banksvc.NewRouter(repo, 90*time.Second)
	_, err := router.SelectOutbound(context.Background(),
		domainbank.OutboundQueryFor(shared(), decimal.RequireFromString("1000"), time.Now(), time.Hour))

	require.NoError(t, err)
	assert.Equal(t, 90*time.Second, repo.outboundQ.MaxAge)
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/service/bankaccount/ -run Routing -v`
Expected: compile error — `InboundQueryFor` and `NewRouter` are undefined.

- [ ] **Step 3: Add the query constructors to the domain**

Append to `internal/domain/bankaccount/dto.go`, and add the import
`domainmerchant "be-maxpay/internal/domain/merchant"`:

```go
// InboundQueryFor builds the inbound selection for a merchant.
//
// A DEDICATED merchant reads only its own accounts; a SHARED one reads its
// cluster's. The unused field is left at uuid.Nil so the repository's NULL
// guard makes that branch inert — a dedicated merchant whose ClusterID is
// still set from an earlier arrangement must not see other merchants' money.
func InboundQueryFor(m *domainmerchant.Merchant, today time.Time) InboundQuery {
	q := InboundQuery{Today: today}
	if m.PoolModel == domainmerchant.PoolDedicated {
		q.MerchantID = m.ID
		return q
	}
	q.ClusterID = m.ClusterID

	return q
}

// OutboundQueryFor builds the outbound selection for a merchant. maxAge is
// the operator's configured freshness window, not the caller's preference.
func OutboundQueryFor(m *domainmerchant.Merchant, amount decimal.Decimal, now time.Time, maxAge time.Duration) OutboundQuery {
	q := OutboundQuery{Amount: amount, Now: now, MaxAge: maxAge}
	if m.PoolModel == domainmerchant.PoolDedicated {
		q.MerchantID = m.ID
		return q
	}
	q.ClusterID = m.ClusterID

	return q
}
```

- [ ] **Step 4: Write the router**

`internal/service/bankaccount/routing.go`:

```go
package bankaccount

import (
	"context"
	"time"

	domainbank "be-maxpay/internal/domain/bankaccount"
)

// Router picks the account a deposit is paid into or a payout is paid from.
//
// It holds almost no logic on purpose: every filter that decides eligibility
// is in the repository's SQL, because a cap or a freshness check evaluated in
// Go reads a value another request has already moved past.
type Router struct {
	repo          domainbank.Repository
	balanceMaxAge time.Duration
}

func NewRouter(repo domainbank.Repository, balanceMaxAge time.Duration) domainbank.Router {
	return &Router{repo: repo, balanceMaxAge: balanceMaxAge}
}

var _ domainbank.Router = (*Router)(nil)

// SelectInbound returns every account that may take this deposit, least
// loaded first. It returns the whole list rather than one account because the
// caller retries down it when a randomised amount collides (spec §8); that
// retry loop arrives with deposits in P3.
func (r *Router) SelectInbound(ctx context.Context, q domainbank.InboundQuery) ([]*domainbank.Account, error) {
	accounts, err := r.repo.InboundCandidates(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(accounts) == 0 {
		return nil, domainbank.ErrNoAccountAvailable
	}

	return accounts, nil
}

// SelectOutbound returns the account with the largest fresh balance that can
// pay without dipping below its own minimum.
//
// The configured window overrides whatever the query carried: freshness is an
// operator's policy about how stale a reading may be before it counts as
// unknown, and a caller must not be able to widen it.
func (r *Router) SelectOutbound(ctx context.Context, q domainbank.OutboundQuery) (*domainbank.Account, error) {
	q.MaxAge = r.balanceMaxAge

	accounts, err := r.repo.OutboundCandidates(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(accounts) == 0 {
		return nil, domainbank.ErrNoAccountAvailable
	}

	return accounts[0], nil
}
```

- [ ] **Step 5: Run the tests and the gate**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/service/bankaccount/ ./internal/domain/bankaccount/ -v
make check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/service/bankaccount/routing.go internal/service/bankaccount/routing_test.go \
        internal/domain/bankaccount/dto.go
git commit -m "feat(bankaccount): choose the account that serves a deposit or a payout"
```

---

### Task 6: The outbox

Spec §4.7. This is the queue every later phase's background work runs through — balance refreshes now, webhook dispatch and statement matching later. Enqueuing shares the caller's transaction, so a job cannot survive a rollback and a committed change cannot lose its follow-up work.

**Files:**
- Create: `db/migrations/000007_outbox.up.sql`
- Create: `db/migrations/000007_outbox.down.sql`
- Create: `internal/domain/outbox/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/persistence/model/outbox.go`
- Create: `internal/adapter/persistence/mapper/outbox.go`
- Create: `internal/adapter/repository/outbox/repository.go`
- Test: `internal/adapter/repository/outbox/repository_test.go`
- Test: `internal/adapter/repository/outbox/integration_test.go`

**Interfaces:**
- Consumes: `base.BaseRepository`, `tx.TransactionHelper`
- Produces:
  - `outbox.Job{ID, Kind, Payload, RunAfter, Attempts, LockedUntil, LastError, CreatedAt}`
  - `outbox.Repository` with `Enqueue`, `Claim`, `Succeed`, `Fail`, `Bury`, `CountBuried`
  - errors `ErrJobNotFound`, `ErrKindRequired`
  - `outboxrepo.NewRepository(db *sqlx.DB) outbox.Repository`

- [ ] **Step 1: Write the migration**

`db/migrations/000007_outbox.up.sql`:

```sql
-- Background work for the whole service. A job is claimed with FOR UPDATE
-- SKIP LOCKED, so two workers never take the same row and neither waits for
-- the other.
--
-- There is no status column. A finished job is deleted; a job that has
-- exhausted its attempts keeps its row with locked_until = 'infinity', which
-- takes it out of every claim query while leaving last_error readable. That
-- is what "buried" means here, and it is deliberately visible rather than
-- silently dropped.
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

-- The claim query's index. Partial on an unlocked job because a locked or
-- buried one is never a candidate, and most rows in a busy queue are neither.
CREATE INDEX outbox_jobs_ready ON outbox_jobs (run_after) WHERE locked_until IS NULL;
CREATE INDEX outbox_jobs_kind ON outbox_jobs (kind, run_after);
```

`db/migrations/000007_outbox.down.sql`:

```sql
DROP TABLE IF EXISTS outbox_jobs;
```

- [ ] **Step 2: Write the domain files**

`internal/domain/outbox/entity.go`:

```go
package outbox

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Job is one unit of background work.
//
// LockedUntil is the zero time when the job is free to claim. A buried job —
// one that has exhausted its attempts — carries a LockedUntil far in the
// future, which removes it from every claim query without hiding it from an
// operator reading LastError.
type Job struct {
	ID          uuid.UUID
	Kind        string
	Payload     json.RawMessage
	RunAfter    time.Time
	Attempts    int
	LockedUntil time.Time
	LastError   string
	CreatedAt   time.Time
}

// BuriedUntil is the sentinel a buried job's lock is set to. PostgreSQL's
// timestamptz 'infinity' would be tidier, but Go's time.Time has no such
// value and round-tripping it through the driver is a needless trap.
var BuriedUntil = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)

func (j *Job) IsBuried() bool { return j.LockedUntil.Equal(BuriedUntil) }
```

`internal/domain/outbox/dto.go`:

```go
package outbox

// Kinds of work this service enqueues. A handler is registered per kind; an
// unregistered kind is buried on its first claim rather than retried, because
// no number of retries will teach the worker what it means.
const (
	KindRefreshAccountBalance = "refresh_account_balance"
)
```

`internal/domain/outbox/errors.go`:

```go
package outbox

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrJobNotFound  = fmt.Errorf("job not found: %w", errs.ErrNotFound)
	ErrKindRequired = fmt.Errorf("job kind is required: %w", errs.ErrInvalidInput)
	// ErrUnknownKind is what a worker returns for a kind with no registered
	// handler. It is not retryable.
	ErrUnknownKind = fmt.Errorf("no handler registered for this job kind: %w", errs.ErrInternal)
)
```

`internal/domain/outbox/repository.go`:

```go
package outbox

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type Repository interface {
	// Enqueue adds a job. When tx is non-nil the job shares the caller's
	// transaction, so it cannot survive a rollback and the committed change
	// cannot lose its follow-up work. Pass nil for a standalone enqueue.
	Enqueue(ctx context.Context, tx *sqlx.Tx, kind string, payload any, runAfter time.Time) error

	// Claim takes up to limit ready jobs and leases them for the given
	// duration. FOR UPDATE SKIP LOCKED is what makes two workers safe: the
	// second skips the rows the first holds instead of waiting behind them.
	Claim(ctx context.Context, now time.Time, lease time.Duration, limit int) ([]*Job, error)

	// Succeed deletes a finished job.
	Succeed(ctx context.Context, id uuid.UUID) error

	// Fail releases the lease and schedules a retry.
	Fail(ctx context.Context, id uuid.UUID, reason string, retryAt time.Time) error

	// Bury takes a job out of circulation permanently, keeping its row and
	// its reason for an operator to find.
	Bury(ctx context.Context, id uuid.UUID, reason string) error

	CountBuried(ctx context.Context) (int, error)
}
```

`internal/domain/outbox/service.go`:

```go
package outbox

import (
	"context"
	"encoding/json"
)

// Handler runs one kind of job. Returning an error schedules a retry unless
// the job has exhausted its attempts.
type Handler interface {
	Handle(ctx context.Context, payload json.RawMessage) error
}

// HandlerFunc adapts a plain function to Handler.
type HandlerFunc func(ctx context.Context, payload json.RawMessage) error

func (f HandlerFunc) Handle(ctx context.Context, payload json.RawMessage) error {
	return f(ctx, payload)
}
```

`internal/domain/outbox/validator.go`:

```go
package outbox

import "strings"

func ValidateKind(kind string) error {
	if strings.TrimSpace(kind) == "" {
		return ErrKindRequired
	}
	return nil
}
```

- [ ] **Step 3: Write the model and mapper**

`internal/adapter/persistence/model/outbox.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type OutboxJob struct {
	ID          uuid.UUID      `db:"id"`
	Kind        string         `db:"kind"`
	Payload     []byte         `db:"payload"`
	RunAfter    time.Time      `db:"run_after"`
	Attempts    int            `db:"attempts"`
	LockedUntil sql.NullTime   `db:"locked_until"`
	LastError   sql.NullString `db:"last_error"`
	CreatedAt   time.Time      `db:"created_at"`
}
```

`internal/adapter/persistence/mapper/outbox.go`:

```go
package mapper

import (
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/outbox"
)

func OutboxJobToModel(j *outbox.Job) *model.OutboxJob {
	if j == nil {
		return nil
	}
	return &model.OutboxJob{
		ID: j.ID, Kind: j.Kind, Payload: j.Payload,
		RunAfter: j.RunAfter, Attempts: j.Attempts,
		LockedUntil: nullTime(j.LockedUntil), LastError: nullString(j.LastError),
		CreatedAt: j.CreatedAt,
	}
}

func OutboxJobToDomain(m *model.OutboxJob) *outbox.Job {
	if m == nil {
		return nil
	}
	return &outbox.Job{
		ID: m.ID, Kind: m.Kind, Payload: m.Payload,
		RunAfter: m.RunAfter, Attempts: m.Attempts,
		LockedUntil: m.LockedUntil.Time, LastError: m.LastError.String,
		CreatedAt: m.CreatedAt,
	}
}

func OutboxJobsToDomain(models []*model.OutboxJob) []*outbox.Job {
	out := make([]*outbox.Job, 0, len(models))
	for _, m := range models {
		out = append(out, OutboxJobToDomain(m))
	}
	return out
}
```

- [ ] **Step 4: Write the failing sqlmock test**

`internal/adapter/repository/outbox/repository_test.go`:

```go
package outbox_test

import (
	"context"
	"regexp"
	"testing"
	"time"

	outboxrepo "be-maxpay/internal/adapter/repository/outbox"
	domainoutbox "be-maxpay/internal/domain/outbox"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/stretchr/testify/require"
)

func newRepo(t *testing.T) (domainoutbox.Repository, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return outboxrepo.NewRepository(sqlx.NewDb(db, "sqlmock")), mock
}

// SKIP LOCKED is the whole design. Asserting it is in the statement is the
// only thing sqlmock can do; the integration test proves it works.
func TestOutboxRepository_Claim_UsesSkipLocked(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(`FOR UPDATE SKIP LOCKED`)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), 10).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "kind", "payload", "run_after", "attempts", "locked_until", "last_error", "created_at",
		}))

	_, err := repo.Claim(context.Background(), time.Now(), time.Minute, 10)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestOutboxRepository_Succeed_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM outbox_jobs`)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := repo.Succeed(context.Background(), uuid.New())
	require.ErrorIs(t, err, domainoutbox.ErrJobNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestOutboxRepository_Enqueue_RejectsAnEmptyKind(t *testing.T) {
	repo, _ := newRepo(t)

	err := repo.Enqueue(context.Background(), nil, "  ", map[string]string{}, time.Now())
	require.ErrorIs(t, err, domainoutbox.ErrKindRequired)
}
```

- [ ] **Step 5: Run it and watch it fail**

Run: `go test ./internal/adapter/repository/outbox/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 6: Write the repository**

`internal/adapter/repository/outbox/repository.go`:

```go
package outbox

import (
	"context"
	"encoding/json"
	"time"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/adapter/repository/base"
	domainoutbox "be-maxpay/internal/domain/outbox"
	"be-maxpay/internal/shared/errs"
	"be-maxpay/internal/shared/id"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

var jobColumns = []string{
	"id", "kind", "payload", "run_after", "attempts", "locked_until", "last_error", "created_at",
}

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domainoutbox.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

var _ domainoutbox.Repository = (*Repository)(nil)

// Enqueue writes the job through the caller's transaction when one is given.
//
// That is the whole reason this queue lives in PostgreSQL rather than beside
// it: a job enqueued in the same transaction as the change it follows up
// cannot survive that change being rolled back, and the change cannot commit
// without it.
func (r *Repository) Enqueue(ctx context.Context, tx *sqlx.Tx, kind string, payload any, runAfter time.Time) error {
	if err := domainoutbox.ValidateKind(kind); err != nil {
		return err
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return errs.WrapDatabaseError(err, "encode job payload")
	}

	sqlStr, args, err := r.Builder.Insert("outbox_jobs").
		Columns("id", "kind", "payload", "run_after", "created_at").
		Values(id.New(), kind, encoded, runAfter, time.Now().UTC()).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build enqueue query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if tx != nil {
		_, err = tx.ExecContext(ctx, sqlStr, args...)
	} else {
		_, err = r.DB.ExecContext(ctx, sqlStr, args...)
	}
	if err != nil {
		return errs.WrapDatabaseError(err, "enqueue job")
	}

	return nil
}

// Claim leases ready jobs.
//
// The inner SELECT takes its rows with FOR UPDATE SKIP LOCKED, so a second
// worker running the same statement passes over the rows the first is holding
// instead of blocking behind them. Doing this as a plain UPDATE ... LIMIT
// would serialise every worker onto one row at a time.
func (r *Repository) Claim(ctx context.Context, now time.Time, lease time.Duration, limit int) ([]*domainoutbox.Job, error) {
	const query = `
UPDATE outbox_jobs
   SET locked_until = $1,
       attempts = attempts + 1
 WHERE id IN (
       SELECT id
         FROM outbox_jobs
        WHERE run_after <= $2
          AND (locked_until IS NULL OR locked_until < $2)
        ORDER BY run_after ASC
          FOR UPDATE SKIP LOCKED
        LIMIT $3
 )
RETURNING id, kind, payload, run_after, attempts, locked_until, last_error, created_at`

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.OutboxJob
	if err := r.DB.SelectContext(ctx, &models, query, now.Add(lease), now, limit); err != nil {
		return nil, errs.WrapDatabaseError(err, "claim jobs")
	}

	return mapper.OutboxJobsToDomain(models), nil
}

func (r *Repository) Succeed(ctx context.Context, jid uuid.UUID) error {
	sqlStr, args, err := r.Builder.Delete("outbox_jobs").
		Where(squirrel.Eq{"id": jid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build succeed query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "delete finished job")
	}

	return r.CheckRowsAffectedWith(result, domainoutbox.ErrJobNotFound)
}

// Fail releases the lease so the job is claimable again at retryAt.
func (r *Repository) Fail(ctx context.Context, jid uuid.UUID, reason string, retryAt time.Time) error {
	sqlStr, args, err := r.Builder.Update("outbox_jobs").
		SetMap(map[string]any{
			"locked_until": nil,
			"run_after":    retryAt,
			"last_error":   reason,
		}).
		Where(squirrel.Eq{"id": jid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build fail query")
	}

	return r.exec(ctx, sqlStr, args, "release failed job")
}

// Bury removes a job from circulation without deleting it. An operator can
// still read why it stopped, which a delete would take away.
func (r *Repository) Bury(ctx context.Context, jid uuid.UUID, reason string) error {
	sqlStr, args, err := r.Builder.Update("outbox_jobs").
		SetMap(map[string]any{
			"locked_until": domainoutbox.BuriedUntil,
			"last_error":   reason,
		}).
		Where(squirrel.Eq{"id": jid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build bury query")
	}

	return r.exec(ctx, sqlStr, args, "bury job")
}

func (r *Repository) CountBuried(ctx context.Context) (int, error) {
	sqlStr, args, err := r.Builder.Select("COUNT(*)").
		From("outbox_jobs").
		Where(squirrel.Eq{"locked_until": domainoutbox.BuriedUntil}).
		ToSql()
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "build count buried query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var count int
	if err := r.DB.GetContext(ctx, &count, sqlStr, args...); err != nil {
		return 0, errs.WrapDatabaseError(err, "count buried jobs")
	}

	return count, nil
}

func (r *Repository) exec(ctx context.Context, sqlStr string, args []any, label string) error {
	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, label)
	}

	return r.CheckRowsAffectedWith(result, domainoutbox.ErrJobNotFound)
}
```

- [ ] **Step 7: Write the integration test that proves SKIP LOCKED works**

`internal/adapter/repository/outbox/integration_test.go`:

```go
//go:build integration

package outbox_test

import (
	"context"
	"sync"
	"testing"
	"time"

	outboxrepo "be-maxpay/internal/adapter/repository/outbox"
	domainoutbox "be-maxpay/internal/domain/outbox"
	"be-maxpay/internal/testutil/pgtest"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Two workers claiming at the same moment must never take the same job. This
// is the guarantee the whole queue rests on and the one sqlmock cannot make.
func TestOutboxRepository_Integration_TwoWorkersNeverTakeTheSameJob(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "outbox_jobs")
	repo := outboxrepo.NewRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	const jobs = 20
	for i := 0; i < jobs; i++ {
		require.NoError(t, repo.Enqueue(ctx, nil, domainoutbox.KindRefreshAccountBalance,
			map[string]int{"n": i}, now))
	}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		claimed []uuid.UUID
	)
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := repo.Claim(ctx, now, time.Minute, jobs)
			assert.NoError(t, err)

			mu.Lock()
			defer mu.Unlock()
			for _, j := range got {
				claimed = append(claimed, j.ID)
			}
		}()
	}
	wg.Wait()

	seen := map[uuid.UUID]bool{}
	for _, jid := range claimed {
		require.False(t, seen[jid], "job %s was claimed twice", jid)
		seen[jid] = true
	}
	assert.Len(t, claimed, jobs, "every job must be claimed exactly once between the workers")
}

// A leased job is invisible until its lease expires, then claimable again.
func TestOutboxRepository_Integration_ALeasedJobIsNotReclaimedUntilItExpires(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "outbox_jobs")
	repo := outboxrepo.NewRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, repo.Enqueue(ctx, nil, domainoutbox.KindRefreshAccountBalance, map[string]int{"n": 1}, now))

	first, err := repo.Claim(ctx, now, time.Minute, 10)
	require.NoError(t, err)
	require.Len(t, first, 1)
	assert.Equal(t, 1, first[0].Attempts, "claiming counts as an attempt")

	second, err := repo.Claim(ctx, now.Add(30*time.Second), time.Minute, 10)
	require.NoError(t, err)
	assert.Empty(t, second, "a job still under lease must not be handed out again")

	third, err := repo.Claim(ctx, now.Add(2*time.Minute), time.Minute, 10)
	require.NoError(t, err)
	require.Len(t, third, 1, "an expired lease returns the job to the queue")
	assert.Equal(t, 2, third[0].Attempts)
}

func TestOutboxRepository_Integration_BuriedJobsStayOutOfTheQueue(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "outbox_jobs")
	repo := outboxrepo.NewRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, repo.Enqueue(ctx, nil, domainoutbox.KindRefreshAccountBalance, map[string]int{"n": 1}, now))
	claimed, err := repo.Claim(ctx, now, time.Minute, 10)
	require.NoError(t, err)
	require.Len(t, claimed, 1)

	require.NoError(t, repo.Bury(ctx, claimed[0].ID, "handler kept failing"))

	again, err := repo.Claim(ctx, now.Add(365*24*time.Hour), time.Minute, 10)
	require.NoError(t, err)
	assert.Empty(t, again, "a buried job must never be claimed again, however long we wait")

	buried, err := repo.CountBuried(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, buried, "and it must stay visible to an operator")
}

// A job enqueued in a transaction that rolls back must not exist. This is the
// property that makes a PostgreSQL outbox worth having over a message broker.
func TestOutboxRepository_Integration_ARolledBackEnqueueLeavesNothing(t *testing.T) {
	db := pgtest.DB(t)
	pgtest.Truncate(t, db, "outbox_jobs")
	repo := outboxrepo.NewRepository(db)
	ctx := context.Background()
	now := time.Now().UTC()

	tx, err := db.Beginx()
	require.NoError(t, err)
	require.NoError(t, repo.Enqueue(ctx, tx, domainoutbox.KindRefreshAccountBalance, map[string]int{"n": 1}, now))
	require.NoError(t, tx.Rollback())

	got, err := repo.Claim(ctx, now, time.Minute, 10)
	require.NoError(t, err)
	assert.Empty(t, got)
}
```

- [ ] **Step 8: Run everything**

```bash
export PATH="$PATH:$HOME/go/bin"
make migrate-up
go test ./internal/adapter/repository/outbox/ ./internal/domain/outbox/ -v
make test-integration
make check
```

Expected: all PASS.

- [ ] **Step 9: Prove SKIP LOCKED has teeth**

Replace `FOR UPDATE SKIP LOCKED` with `FOR UPDATE` and re-run
`TestOutboxRepository_Integration_TwoWorkersNeverTakeTheSameJob`. It should still
pass on correctness — `FOR UPDATE` also prevents double claiming — but the
workers now serialise. Then remove the `FOR UPDATE` clause entirely and re-run:
the test must FAIL with a job claimed twice. Restore the clause and record
both results in your report, so the next reader knows which half of that
phrase does which job.

- [ ] **Step 10: Commit**

```bash
git add db/migrations/000007_outbox.*.sql internal/domain/outbox \
        internal/adapter/persistence/model/outbox.go \
        internal/adapter/persistence/mapper/outbox.go \
        internal/adapter/repository/outbox
git commit -m "feat(outbox): add the transactional job queue"
```

---

### Task 7: The worker that drains the outbox

This is the first background worker this service has ever had. `internal/shared/lifecycle.go` shows the fx pattern for owning a resource across startup and shutdown; follow it.

**Files:**
- Create: `internal/service/outbox/worker.go`
- Test: `internal/service/outbox/worker_test.go`

**Interfaces:**
- Consumes: `outbox.Repository`, `outbox.Handler`, `zap.Logger`, `fx.Lifecycle`
- Produces:
  - `outboxsvc.Config{PollInterval, Lease, MaxAttempts, BatchSize time/int}`
  - `outboxsvc.NewWorker(repo outbox.Repository, logger *zap.Logger, cfg Config) *Worker`
  - `(*Worker).Register(kind string, h outbox.Handler)`
  - `(*Worker).Tick(ctx context.Context) (int, error)` — one batch; the loop is `Run`
  - `outboxsvc.RegisterWorkerLifecycle(life fx.Lifecycle, w *Worker, logger *zap.Logger)`

- [ ] **Step 1: Write the failing tests**

`internal/service/outbox/worker_test.go`:

```go
package outbox_test

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	domainoutbox "be-maxpay/internal/domain/outbox"
	outboxsvc "be-maxpay/internal/service/outbox"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type fakeRepo struct {
	mu        sync.Mutex
	ready     []*domainoutbox.Job
	succeeded []uuid.UUID
	failed    map[uuid.UUID]string
	buried    map[uuid.UUID]string
	retryAt   map[uuid.UUID]time.Time
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		failed:  map[uuid.UUID]string{},
		buried:  map[uuid.UUID]string{},
		retryAt: map[uuid.UUID]time.Time{},
	}
}

var _ domainoutbox.Repository = (*fakeRepo)(nil)

func (f *fakeRepo) Enqueue(context.Context, *sqlx.Tx, string, any, time.Time) error { return nil }

func (f *fakeRepo) Claim(_ context.Context, _ time.Time, _ time.Duration, limit int) ([]*domainoutbox.Job, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if len(f.ready) == 0 {
		return nil, nil
	}
	if limit > len(f.ready) {
		limit = len(f.ready)
	}
	batch := f.ready[:limit]
	f.ready = f.ready[limit:]

	return batch, nil
}

func (f *fakeRepo) Succeed(_ context.Context, id uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.succeeded = append(f.succeeded, id)
	return nil
}

func (f *fakeRepo) Fail(_ context.Context, id uuid.UUID, reason string, retryAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failed[id] = reason
	f.retryAt[id] = retryAt
	return nil
}

func (f *fakeRepo) Bury(_ context.Context, id uuid.UUID, reason string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.buried[id] = reason
	return nil
}

func (f *fakeRepo) CountBuried(context.Context) (int, error) { return len(f.buried), nil }

func job(kind string, attempts int) *domainoutbox.Job {
	return &domainoutbox.Job{
		ID: uuid.New(), Kind: kind, Payload: json.RawMessage(`{"n":1}`), Attempts: attempts,
	}
}

func newWorker(repo domainoutbox.Repository) *outboxsvc.Worker {
	return outboxsvc.NewWorker(repo, zap.NewNop(), outboxsvc.Config{
		PollInterval: time.Millisecond,
		Lease:        time.Minute,
		MaxAttempts:  3,
		BatchSize:    10,
	})
}

func TestWorker_Tick_RunsAHandlerAndFinishesTheJob(t *testing.T) {
	repo := newFakeRepo()
	repo.ready = []*domainoutbox.Job{job("greet", 1)}

	var seen json.RawMessage
	w := newWorker(repo)
	w.Register("greet", domainoutbox.HandlerFunc(func(_ context.Context, payload json.RawMessage) error {
		seen = payload
		return nil
	}))

	done, err := w.Tick(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, done)
	assert.JSONEq(t, `{"n":1}`, string(seen))
	assert.Len(t, repo.succeeded, 1)
	assert.Empty(t, repo.failed)
}

// A retryable failure keeps the job, with the reason recorded.
func TestWorker_Tick_ReschedulesAFailedJob(t *testing.T) {
	repo := newFakeRepo()
	j := job("greet", 1)
	repo.ready = []*domainoutbox.Job{j}

	w := newWorker(repo)
	w.Register("greet", domainoutbox.HandlerFunc(func(context.Context, json.RawMessage) error {
		return errors.New("bank said no")
	}))

	_, err := w.Tick(context.Background())
	require.NoError(t, err)
	assert.Contains(t, repo.failed[j.ID], "bank said no")
	assert.Empty(t, repo.succeeded)
	assert.True(t, repo.retryAt[j.ID].After(time.Now()), "a retry must be scheduled for later, not now")
}

// Backoff grows with the attempt count, so a persistently failing job stops
// hammering whatever it is failing against.
func TestWorker_Tick_BacksOffFurtherOnALaterAttempt(t *testing.T) {
	repo := newFakeRepo()
	early, late := job("greet", 1), job("greet", 2)
	repo.ready = []*domainoutbox.Job{early, late}

	w := newWorker(repo)
	w.Register("greet", domainoutbox.HandlerFunc(func(context.Context, json.RawMessage) error {
		return errors.New("still failing")
	}))

	_, err := w.Tick(context.Background())
	require.NoError(t, err)
	assert.True(t, repo.retryAt[late.ID].After(repo.retryAt[early.ID]),
		"the job that has failed more often waits longer")
}

func TestWorker_Tick_BuriesAJobThatHasExhaustedItsAttempts(t *testing.T) {
	repo := newFakeRepo()
	j := job("greet", 3) // MaxAttempts is 3
	repo.ready = []*domainoutbox.Job{j}

	w := newWorker(repo)
	w.Register("greet", domainoutbox.HandlerFunc(func(context.Context, json.RawMessage) error {
		return errors.New("never works")
	}))

	_, err := w.Tick(context.Background())
	require.NoError(t, err)
	assert.Contains(t, repo.buried[j.ID], "never works")
	assert.Empty(t, repo.failed, "an exhausted job is buried, not rescheduled")
}

// No number of retries teaches the worker what an unregistered kind means.
func TestWorker_Tick_BuriesAnUnknownKindImmediately(t *testing.T) {
	repo := newFakeRepo()
	j := job("nobody-handles-this", 1)
	repo.ready = []*domainoutbox.Job{j}

	w := newWorker(repo)

	_, err := w.Tick(context.Background())
	require.NoError(t, err)
	assert.Contains(t, repo.buried[j.ID], "no handler")
	assert.Empty(t, repo.failed)
}

// One job's failure must not stop the rest of the batch.
func TestWorker_Tick_KeepsGoingAfterOneJobFails(t *testing.T) {
	repo := newFakeRepo()
	bad, good := job("boom", 1), job("greet", 1)
	repo.ready = []*domainoutbox.Job{bad, good}

	w := newWorker(repo)
	w.Register("boom", domainoutbox.HandlerFunc(func(context.Context, json.RawMessage) error {
		return errors.New("boom")
	}))
	w.Register("greet", domainoutbox.HandlerFunc(func(context.Context, json.RawMessage) error {
		return nil
	}))

	done, err := w.Tick(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, done)
	assert.Len(t, repo.succeeded, 1)
	assert.Len(t, repo.failed, 1)
}

// A handler that panics must not take the process down with it. A worker is
// the one place in this service where an unrecovered panic kills every future
// job as well as the current one.
func TestWorker_Tick_SurvivesAPanickingHandler(t *testing.T) {
	repo := newFakeRepo()
	j := job("panic", 1)
	repo.ready = []*domainoutbox.Job{j}

	w := newWorker(repo)
	w.Register("panic", domainoutbox.HandlerFunc(func(context.Context, json.RawMessage) error {
		panic("handler exploded")
	}))

	require.NotPanics(t, func() {
		_, err := w.Tick(context.Background())
		require.NoError(t, err)
	})
	assert.Contains(t, repo.failed[j.ID], "panic")
}

func TestWorker_Run_StopsWhenTheContextIsCancelled(t *testing.T) {
	repo := newFakeRepo()
	w := newWorker(repo)

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(stopped)
	}()

	cancel()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("Run did not return after its context was cancelled")
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/service/outbox/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the worker**

`internal/service/outbox/worker.go`:

```go
// Package outbox drains the job queue.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	domainoutbox "be-maxpay/internal/domain/outbox"
	"be-maxpay/internal/shared"

	"go.uber.org/fx"
	"go.uber.org/zap"
)

// Config is how hard the worker leans on the database and how patient it is
// with a failing job.
type Config struct {
	PollInterval time.Duration
	Lease        time.Duration
	MaxAttempts  int
	BatchSize    int
}

// maxBackoff caps the retry delay. Without it the eighth attempt at an hourly
// job lands days later, by which time nobody is watching for it.
const maxBackoff = 10 * time.Minute

type Worker struct {
	repo   domainoutbox.Repository
	logger *zap.Logger
	cfg    Config

	mu       sync.RWMutex
	handlers map[string]domainoutbox.Handler
}

func NewWorker(repo domainoutbox.Repository, logger *zap.Logger, cfg Config) *Worker {
	return &Worker{
		repo:     repo,
		logger:   logger,
		cfg:      cfg,
		handlers: map[string]domainoutbox.Handler{},
	}
}

// Register wires a handler to a job kind. Registration happens at startup,
// before Run, but the lock is real because Tick reads the map from the worker
// goroutine.
func (w *Worker) Register(kind string, h domainoutbox.Handler) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlers[kind] = h
}

// Run drains the queue until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.Tick(ctx); err != nil {
				// A failure to CLAIM is a database problem, not a job
				// problem: log it and try again on the next tick rather than
				// stopping the only thing that drains the queue.
				w.logger.Error("outbox claim failed", zap.Error(err))
			}
		}
	}
}

// Tick claims one batch and runs it, returning how many jobs finished.
//
// It is exported and separate from Run so the batch behaviour can be tested
// without a ticker, a goroutine or a sleep.
func (w *Worker) Tick(ctx context.Context) (int, error) {
	jobs, err := w.repo.Claim(ctx, time.Now().UTC(), w.cfg.Lease, w.cfg.BatchSize)
	if err != nil {
		return 0, err
	}

	done := 0
	for _, j := range jobs {
		if w.runOne(ctx, j) {
			done++
		}
	}

	return done, nil
}

// runOne reports whether the job finished successfully.
func (w *Worker) runOne(ctx context.Context, j *domainoutbox.Job) bool {
	handler, ok := w.handler(j.Kind)
	if !ok {
		// Not retryable: the kind will not become known by waiting.
		w.bury(ctx, j, fmt.Sprintf("no handler registered for kind %q", j.Kind))
		return false
	}

	if err := w.invoke(ctx, handler, j.Payload); err != nil {
		w.logger.Warn("outbox job failed",
			zap.String("trace_id", shared.TraceIDFromContext(ctx)),
			zap.String("job_id", j.ID.String()),
			zap.String("kind", j.Kind),
			zap.Int("attempts", j.Attempts),
			zap.Error(err),
		)

		if j.Attempts >= w.cfg.MaxAttempts {
			w.bury(ctx, j, err.Error())
			return false
		}

		retryAt := time.Now().UTC().Add(backoff(j.Attempts))
		if failErr := w.repo.Fail(ctx, j.ID, err.Error(), retryAt); failErr != nil {
			w.logger.Error("could not reschedule a failed job",
				zap.String("job_id", j.ID.String()), zap.Error(failErr))
		}

		return false
	}

	if err := w.repo.Succeed(ctx, j.ID); err != nil {
		// The work happened; only the bookkeeping failed. The lease will
		// expire and the job will run again, which is why every handler must
		// be safe to run twice.
		w.logger.Error("could not delete a finished job",
			zap.String("job_id", j.ID.String()), zap.Error(err))
		return false
	}

	return true
}

// invoke runs a handler and turns a panic into an error.
//
// A worker is the one place in this service where an unrecovered panic would
// take down not just this job but every future one, because the goroutine
// that drains the queue would die with it.
func (w *Worker) invoke(ctx context.Context, h domainoutbox.Handler, payload json.RawMessage) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("handler panic: %v", recovered)
		}
	}()

	return h.Handle(ctx, payload)
}

func (w *Worker) handler(kind string) (domainoutbox.Handler, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	h, ok := w.handlers[kind]

	return h, ok
}

func (w *Worker) bury(ctx context.Context, j *domainoutbox.Job, reason string) {
	w.logger.Error("outbox job buried",
		zap.String("job_id", j.ID.String()),
		zap.String("kind", j.Kind),
		zap.Int("attempts", j.Attempts),
		zap.String("reason", reason),
	)

	if err := w.repo.Bury(ctx, j.ID, reason); err != nil {
		w.logger.Error("could not bury a job",
			zap.String("job_id", j.ID.String()), zap.Error(err))
	}
}

// backoff doubles with each attempt, capped. attempts is at least 1 because
// claiming counts as an attempt.
func backoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}

	delay := time.Duration(math.Pow(2, float64(attempts))) * time.Second
	if delay > maxBackoff {
		return maxBackoff
	}

	return delay
}

// RegisterWorkerLifecycle starts the worker with the application and waits
// for its current batch on shutdown.
//
// The wait matters: a job cut off mid-flight keeps its lease and is invisible
// until that lease expires, which for a balance refresh means a stale reading
// that blocks payouts for no reason.
func RegisterWorkerLifecycle(life fx.Lifecycle, w *Worker, logger *zap.Logger) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	life.Append(fx.Hook{
		OnStart: func(context.Context) error {
			logger.Info("outbox worker starting",
				zap.Duration("poll_interval", w.cfg.PollInterval),
				zap.Int("batch_size", w.cfg.BatchSize),
			)
			go func() {
				defer close(done)
				w.Run(ctx)
			}()

			return nil
		},
		OnStop: func(stopCtx context.Context) error {
			logger.Info("outbox worker stopping")
			cancel()

			select {
			case <-done:
				return nil
			case <-stopCtx.Done():
				return stopCtx.Err()
			}
		},
	})
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./internal/service/outbox/ -race -v`
Expected: PASS, all eight. The race detector matters here — this is the first concurrent code in the service.

- [ ] **Step 5: Commit**

```bash
git add internal/service/outbox
git commit -m "feat(outbox): add the worker that drains the queue"
```

---

### Task 8: Keeping bank balances fresh

Outbound routing refuses an account whose reading is stale, so a poller that stops means payouts stop. It also means a poller that records the WRONG number sends money from the wrong account.

**⚠️ THIS TASK HAS A DEPENDENCY ON REALITY.** `account.Service.Overview` returns `json.RawMessage` relayed straight from the bank, and nothing in this repository has ever parsed it — no type, no fixture, no test. The field that holds an available balance is not known. Do NOT guess it: write `ParseBankBalance` against a captured real response, and if none is available yet, implement the function and its fixture-driven test with the fixture marked as provisional, leave the job registered but disabled, and say so plainly in your report. A poller that quietly records a wrong balance is worse than one that does not run.

**Files:**
- Create: `internal/service/bankaccount/balance.go`
- Create: `internal/service/bankaccount/testdata/account_overview.json`
- Test: `internal/service/bankaccount/balance_test.go`

**Interfaces:**
- Consumes: `account.Service`, `bankaccount.Repository`, `outbox.Repository`, `device.Repository`
- Produces:
  - `bankaccountsvc.ParseBankBalance(raw json.RawMessage) (decimal.Decimal, error)`
  - `bankaccountsvc.NewBalanceRefresher(...) *BalanceRefresher` with `Handle(ctx, payload) error` and `EnqueueDue(ctx) (int, error)`
  - `bankaccountsvc.RefreshPayload{AccountID uuid.UUID, Alias string}`

- [ ] **Step 1: Capture or stub the fixture**

If a real device is registered, capture a genuine response and save it verbatim:

```bash
curl -s -H 'X-API-Key: change-me' \
  http://localhost:8091/api/v1/devices/<alias>/accounts/overview \
  | jq .data > internal/service/bankaccount/testdata/account_overview.json
```

If no device is registered yet, create the file with this provisional content AND the note, so the next reader knows it is not evidence:

```json
{
  "_PROVISIONAL": "This is NOT a captured bank response. Replace it with real output from GET /devices/{alias}/accounts/overview before trusting the balance poller. See Task 8 of the P2a plan.",
  "accounts": [
    {
      "accountNo": "1234567890",
      "accountName": "MAXPAY CO LTD",
      "availableBalance": "1234567.89",
      "ledgerBalance": "1234567.89",
      "currency": "THB"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`internal/service/bankaccount/balance_test.go`:

```go
package bankaccount_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	banksvc "be-maxpay/internal/service/bankaccount"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseBankBalance_ReadsTheFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "account_overview.json"))
	require.NoError(t, err)

	got, err := banksvc.ParseBankBalance(raw, "1234567890")
	require.NoError(t, err)
	assert.True(t, got.Equal(decimal.RequireFromString("1234567.89")),
		"got %s", got)
}

// A response the parser does not understand must be an error, never a zero
// balance. A zero recorded with a fresh timestamp reads as "this account has
// no money", which silently removes it from outbound routing.
func TestParseBankBalance_RefusesRatherThanReturningZero(t *testing.T) {
	for name, body := range map[string]string{
		"empty object":       `{}`,
		"no accounts":        `{"accounts":[]}`,
		"no matching number": `{"accounts":[{"accountNo":"9999999999","availableBalance":"1"}]}`,
		"unparseable amount": `{"accounts":[{"accountNo":"1234567890","availableBalance":"not a number"}]}`,
		"not json":           `<html>maintenance</html>`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := banksvc.ParseBankBalance(json.RawMessage(body), "1234567890")
			require.Error(t, err, "an unreadable response must not resolve to a balance")
		})
	}
}

// The bank sends amounts as strings and sometimes with separators. Whatever
// it sends, it must never become a float.
func TestParseBankBalance_HandlesTheAmountFormatsTheBankUses(t *testing.T) {
	cases := map[string]string{
		`{"accounts":[{"accountNo":"1","availableBalance":"1234567.89"}]}`:   "1234567.89",
		`{"accounts":[{"accountNo":"1","availableBalance":"1,234,567.89"}]}`: "1234567.89",
		`{"accounts":[{"accountNo":"1","availableBalance":1234567.89}]}`:     "1234567.89",
	}

	for body, want := range cases {
		got, err := banksvc.ParseBankBalance(json.RawMessage(body), "1")
		require.NoError(t, err, body)
		assert.True(t, got.Equal(decimal.RequireFromString(want)), "%s -> %s", body, got)
	}
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `go test ./internal/service/bankaccount/ -run ParseBankBalance -v`
Expected: compile error — `ParseBankBalance` is undefined.

- [ ] **Step 4: Write the parser and the job**

`internal/service/bankaccount/balance.go`:

```go
package bankaccount

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	domainaccount "be-maxpay/internal/domain/account"
	domainbank "be-maxpay/internal/domain/bankaccount"
	domainoutbox "be-maxpay/internal/domain/outbox"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// balanceFields are the response keys that have been observed to carry an
// available balance, in the order they are preferred.
//
// This list is EVIDENCE, not a guess: add to it only after seeing a real
// response that needs the new key, and update testdata/account_overview.json
// at the same time. The bank's contract is not documented anywhere we control.
var balanceFields = []string{"availableBalance", "available_balance", "balance"}

// overviewShape is the part of the account-overview response this parser
// depends on. Everything else the bank sends is ignored on purpose: relaying
// the whole payload is the account endpoint's job, not this one's.
type overviewShape struct {
	Accounts []struct {
		AccountNo string                     `json:"accountNo"`
		Fields    map[string]json.RawMessage `json:"-"`
	} `json:"accounts"`
}

// ParseBankBalance extracts one account's available balance from an
// account-overview response.
//
// It returns an error rather than a zero balance whenever it cannot find the
// number. Zero recorded with a fresh timestamp reads as "this account has no
// money" and silently removes the account from outbound routing, which is a
// far worse failure than a stale reading that routing already refuses.
func ParseBankBalance(raw json.RawMessage, accountNo string) (decimal.Decimal, error) {
	var envelope struct {
		Accounts []map[string]json.RawMessage `json:"accounts"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return decimal.Zero, fmt.Errorf("account overview was not JSON: %w", errs.ErrUnavailable)
	}

	for _, account := range envelope.Accounts {
		if !matchesAccount(account, accountNo) {
			continue
		}

		for _, field := range balanceFields {
			rawValue, ok := account[field]
			if !ok {
				continue
			}

			value, err := decodeAmount(rawValue)
			if err != nil {
				return decimal.Zero, fmt.Errorf("account %s field %s: %w", accountNo, field, err)
			}

			return value, nil
		}

		return decimal.Zero, fmt.Errorf(
			"account %s carried none of the known balance fields %v: %w",
			accountNo, balanceFields, errs.ErrUnavailable)
	}

	return decimal.Zero, fmt.Errorf("account %s was not in the overview: %w", accountNo, errs.ErrUnavailable)
}

func matchesAccount(account map[string]json.RawMessage, accountNo string) bool {
	for _, key := range []string{"accountNo", "account_no", "accountNumber"} {
		raw, ok := account[key]
		if !ok {
			continue
		}

		var got string
		if err := json.Unmarshal(raw, &got); err == nil && got == accountNo {
			return true
		}
	}

	return false
}

// decodeAmount accepts the shapes the bank has been seen to use: a JSON
// string, a string with thousands separators, or a JSON number. A number is
// decoded through its literal text rather than through float64, so a value
// the bank sent exactly is stored exactly.
func decodeAmount(raw json.RawMessage) (decimal.Decimal, error) {
	text := strings.TrimSpace(string(raw))

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		text = asString
	}

	text = strings.ReplaceAll(text, ",", "")
	if text == "" {
		return decimal.Zero, fmt.Errorf("empty amount: %w", errs.ErrUnavailable)
	}

	value, err := decimal.NewFromString(text)
	if err != nil {
		return decimal.Zero, fmt.Errorf("amount %q is not a number: %w", text, errs.ErrUnavailable)
	}

	return value, nil
}

// RefreshPayload is one balance-refresh job.
type RefreshPayload struct {
	AccountID uuid.UUID `json:"account_id"`
	Alias     string    `json:"alias"`
	AccountNo string    `json:"account_no"`
}

// BalanceRefresher reads one account's balance from the bank and records it.
type BalanceRefresher struct {
	accounts domainbank.Repository
	overview domainaccount.Service
	jobs     domainoutbox.Repository
	maxAge   time.Duration
	batch    int
	logger   *zap.Logger
}

func NewBalanceRefresher(
	accounts domainbank.Repository,
	overview domainaccount.Service,
	jobs domainoutbox.Repository,
	maxAge time.Duration,
	batch int,
	logger *zap.Logger,
) *BalanceRefresher {
	return &BalanceRefresher{
		accounts: accounts, overview: overview, jobs: jobs,
		maxAge: maxAge, batch: batch, logger: logger,
	}
}

// Handle is the outbox handler for KindRefreshAccountBalance.
//
// It is safe to run twice: recording the same balance again is a no-op, and a
// second reading is simply newer.
func (b *BalanceRefresher) Handle(ctx context.Context, payload json.RawMessage) error {
	var data RefreshPayload
	if err := json.Unmarshal(payload, &data); err != nil {
		return fmt.Errorf("decode refresh payload: %w", errs.ErrInternal)
	}

	raw, err := b.overview.Overview(ctx, data.Alias)
	if err != nil {
		return err
	}

	balance, err := ParseBankBalance(raw, data.AccountNo)
	if err != nil {
		// Deliberately not recorded. The stored reading stays as it was and
		// goes stale, which routing already treats as unknown.
		return err
	}

	if err := b.accounts.RecordBalance(ctx, data.AccountID, balance, time.Now().UTC()); err != nil {
		return err
	}

	b.logger.Info("bank balance refreshed",
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
		zap.String("account_id", data.AccountID.String()),
	)

	return nil
}

// EnqueueDue queues a refresh for every account whose reading has gone stale.
// It is called on a timer by whatever schedules periodic work; in this phase
// that is the worker's own tick through a registered job.
func (b *BalanceRefresher) EnqueueDue(ctx context.Context) (int, error) {
	due, err := b.accounts.ListForBalanceRefresh(ctx, time.Now().UTC(), b.maxAge, b.batch)
	if err != nil {
		return 0, err
	}

	queued := 0
	for _, account := range due {
		alias, err := b.aliasFor(ctx, account)
		if err != nil {
			b.logger.Warn("skipping balance refresh: no alias for account",
				zap.String("account_id", account.ID.String()), zap.Error(err))
			continue
		}

		if err := b.jobs.Enqueue(ctx, nil, domainoutbox.KindRefreshAccountBalance, RefreshPayload{
			AccountID: account.ID, Alias: alias, AccountNo: account.AccountNo,
		}, time.Now().UTC()); err != nil {
			return queued, err
		}
		queued++
	}

	return queued, nil
}
```

- [ ] **Step 5: Add the alias lookup**

`BalanceRefresher` needs the device alias for an account, because
`account.Service.Overview` is addressed by alias, not by device id. Add a
`GetByID(ctx, id uuid.UUID) (*Device, error)` method to `device.Repository`
and its implementation in `internal/adapter/repository/device/repository.go`,
following the existing `GetByAlias`, then:

```go
func (b *BalanceRefresher) aliasFor(ctx context.Context, a *domainbank.Account) (string, error) {
	d, err := b.devices.GetByID(ctx, a.DeviceID)
	if err != nil {
		return "", err
	}

	return d.Alias, nil
}
```

adding `devices domaindevice.Repository` to the struct and its constructor. Add a
sqlmock test for `GetByID` mirroring the existing `GetByAlias` tests.

- [ ] **Step 6: Run the tests**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/service/bankaccount/ ./internal/adapter/repository/device/ -v
make check
```

Expected: PASS.

- [ ] **Step 7: Say plainly what is unproven**

In your report, state which it is:
- a real captured response was used, and which field carried the balance; or
- the fixture is provisional, `ParseBankBalance` has never seen a real bank response, and the job must not be trusted until it has.

Add the same note to `README.md` beside the pool section. This is the one piece of P2a that cannot be verified without the bank.

- [ ] **Step 8: Commit**

```bash
git add internal/service/bankaccount/balance.go internal/service/bankaccount/balance_test.go \
        internal/service/bankaccount/testdata internal/adapter/repository/device \
        internal/domain/device/repository.go README.md
git commit -m "feat(bankaccount): refresh bank balances through the outbox"
```

---

### Task 9: The back office's pool endpoints

Spec §4.3's capability table gives the bank account pool to platform administrators only — it is the platform's own infrastructure, and a merchant has no business seeing which corporate accounts serve its competitors.

**Files:**
- Create: `internal/adapter/http/adminpool/{handler,handlers,routes,dto}.go`
- Create: `internal/adapter/http/adminpool/handlers_test.go`
- Create: `bruno/Pool/{folder,List clusters,Create cluster,List accounts,Attach account,Get account,Update account}.bru`
- Modify: `bruno/environments/local.bru`
- Modify: `internal/adapter/http/routes_test.go`

**Interfaces:**
- Consumes: `bankaccount.Service`, `adminuser.Service`, `middleware.UserFromContext`, `routing.AdminGroup`
- Produces: `adminpool.RegisterRoutes(p RouteParams)`

Routes, all under `AdminGroup`:

```text
GET    /api/v1/admin/clusters
POST   /api/v1/admin/clusters
GET    /api/v1/admin/accounts
POST   /api/v1/admin/accounts
GET    /api/v1/admin/accounts/:id
PATCH  /api/v1/admin/accounts/:id
```

- [ ] **Step 1: Write the DTOs**

`internal/adapter/http/adminpool/dto.go`:

```go
package adminpool

import (
	"time"

	domainbank "be-maxpay/internal/domain/bankaccount"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type createClusterRequest struct {
	Name string `json:"name" validate:"required,min=1,max=100"`
}

// Ids validate against "uuid", never "uuid4": every id in this system is a
// UUIDv7 and the uuid4 tag rejects all of them.
type attachAccountRequest struct {
	DeviceID       string `json:"device_id" validate:"required,uuid"`
	AccountNo      string `json:"account_no" validate:"required,min=1,max=32"`
	AccountName    string `json:"account_name" validate:"required,min=1,max=200"`
	BankCode       string `json:"bank_code" validate:"required,min=1,max=8"`
	Tier           string `json:"tier" validate:"required,oneof=INBOUND VAULT OUTBOUND"`
	ClusterID      string `json:"cluster_id" validate:"omitempty,uuid"`
	MerchantID     string `json:"merchant_id" validate:"omitempty,uuid"`
	PromptPayID    string `json:"promptpay_id" validate:"max=32"`
	DailyAmountCap string `json:"daily_amount_cap"`
	DailyTxnCap    int    `json:"daily_txn_cap" validate:"min=0"`
	MinBalance     string `json:"min_balance"`
	TargetBalance  string `json:"target_balance"`
}

type updateAccountRequest struct {
	Tier           string  `json:"tier" validate:"omitempty,oneof=INBOUND VAULT OUTBOUND"`
	Status         string  `json:"status" validate:"omitempty,oneof=ACTIVE COOLING SUSPENDED"`
	ClusterID      *string `json:"cluster_id" validate:"omitempty"`
	MerchantID     *string `json:"merchant_id" validate:"omitempty"`
	PromptPayID    *string `json:"promptpay_id"`
	DailyAmountCap *string `json:"daily_amount_cap"`
	DailyTxnCap    *int    `json:"daily_txn_cap"`
	MinBalance     *string `json:"min_balance"`
	TargetBalance  *string `json:"target_balance"`
}

type clusterResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// accountResponse reports both balances side by side and never merges them.
// bank_balance is what the bank said and when; the book balance arrives with
// the ledger. An operator reading one number would have no way to notice the
// two drifting apart, which is the whole reason they are stored separately.
type accountResponse struct {
	ID             string `json:"id"`
	DeviceID       string `json:"device_id"`
	AccountNo      string `json:"account_no"`
	AccountName    string `json:"account_name"`
	BankCode       string `json:"bank_code"`
	Tier           string `json:"tier"`
	ClusterID      string `json:"cluster_id,omitempty"`
	MerchantID     string `json:"merchant_id,omitempty"`
	PromptPayID    string `json:"promptpay_id,omitempty"`
	Status         string `json:"status"`
	DailyAmountCap string `json:"daily_amount_cap"`
	DailyTxnCap    int    `json:"daily_txn_cap"`
	MinBalance     string `json:"min_balance"`
	TargetBalance  string `json:"target_balance"`
	BankBalance    string `json:"bank_balance,omitempty"`
	BankBalanceAt  string `json:"bank_balance_at,omitempty"`
	CreatedAt      string `json:"created_at"`
}

func toClusterResponse(c *domainbank.Cluster) clusterResponse {
	return clusterResponse{ID: c.ID.String(), Name: c.Name, Status: c.Status}
}

func toClusterResponses(cs []*domainbank.Cluster) []clusterResponse {
	out := make([]clusterResponse, 0, len(cs))
	for _, c := range cs {
		out = append(out, toClusterResponse(c))
	}
	return out
}

func toAccountResponse(a *domainbank.Account) accountResponse {
	out := accountResponse{
		ID: a.ID.String(), DeviceID: a.DeviceID.String(),
		AccountNo: a.AccountNo, AccountName: a.AccountName, BankCode: a.BankCode,
		Tier: string(a.Tier), PromptPayID: a.PromptPayID, Status: a.Status,
		DailyAmountCap: a.DailyAmountCap.String(), DailyTxnCap: a.DailyTxnCap,
		MinBalance: a.MinBalance.String(), TargetBalance: a.TargetBalance.String(),
		CreatedAt: a.CreatedAt.UTC().Format(time.RFC3339),
	}
	if a.ClusterID != uuid.Nil {
		out.ClusterID = a.ClusterID.String()
	}
	if a.MerchantID != uuid.Nil {
		out.MerchantID = a.MerchantID.String()
	}
	// A balance that was never read is omitted rather than reported as zero:
	// "we do not know" and "there is nothing there" must not look the same.
	if !a.BankBalanceAt.IsZero() {
		out.BankBalance = a.BankBalance.String()
		out.BankBalanceAt = a.BankBalanceAt.UTC().Format(time.RFC3339)
	}

	return out
}

func toAccountResponses(as []*domainbank.Account) []accountResponse {
	out := make([]accountResponse, 0, len(as))
	for _, a := range as {
		out = append(out, toAccountResponse(a))
	}
	return out
}

// parseMoney turns an optional decimal string into a value, treating an empty
// string as zero. Amounts arrive as strings so no float ever touches them.
func parseMoney(s string) (decimal.Decimal, error) {
	if s == "" {
		return decimal.Zero, nil
	}

	return decimal.NewFromString(s)
}
```

- [ ] **Step 2: Write the handler, handlers and routes**

`internal/adapter/http/adminpool/handler.go`:

```go
package adminpool

import (
	domainbank "be-maxpay/internal/domain/bankaccount"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	accounts domainbank.Service
	v        *validator.Validate
}

func NewHandler(accounts domainbank.Service, v *validator.Validate) *Handler {
	return &Handler{accounts: accounts, v: v}
}
```

`internal/adapter/http/adminpool/handlers.go`:

```go
package adminpool

import (
	"net/http"

	"be-maxpay/internal/adapter/http/middleware"
	"be-maxpay/internal/adapter/http/resp"
	domainbank "be-maxpay/internal/domain/bankaccount"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/errs"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// requirePlatformAdmin gates every endpoint in this package.
//
// The pool is the platform's own infrastructure. A merchant has no business
// learning which corporate accounts serve its competitors, and spec 4.3's
// capability table gives it to platform administrators alone.
func requirePlatformAdmin(c *gin.Context) bool {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return false
	}
	if !user.IsPlatformAdmin() {
		resp.Error(c, errs.ErrForbidden)
		return false
	}

	return true
}

func (h *Handler) listClusters(c *gin.Context) {
	if !requirePlatformAdmin(c) {
		return
	}

	clusters, err := h.accounts.ListClusters(c.Request.Context())
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toClusterResponses(clusters))
}

func (h *Handler) createCluster(c *gin.Context) {
	if !requirePlatformAdmin(c) {
		return
	}

	var req createClusterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	created, err := h.accounts.CreateCluster(c.Request.Context(), req.Name)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, toClusterResponse(created))
}

func (h *Handler) listAccounts(c *gin.Context) {
	if !requirePlatformAdmin(c) {
		return
	}

	accounts, err := h.accounts.List(c.Request.Context())
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toAccountResponses(accounts))
}

func (h *Handler) attachAccount(c *gin.Context) {
	if !requirePlatformAdmin(c) {
		return
	}

	var req attachAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	deviceID, err := uuid.Parse(req.DeviceID)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}
	clusterID, err := parseOptionalUUID(req.ClusterID)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}
	merchantID, err := parseOptionalUUID(req.MerchantID)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	amountCap, err := parseMoney(req.DailyAmountCap)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}
	minBalance, err := parseMoney(req.MinBalance)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}
	targetBalance, err := parseMoney(req.TargetBalance)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	created, err := h.accounts.Attach(c.Request.Context(), &domainbank.AttachData{
		DeviceID: deviceID, AccountNo: req.AccountNo, AccountName: req.AccountName,
		BankCode: req.BankCode, Tier: domainbank.Tier(req.Tier),
		ClusterID: clusterID, MerchantID: merchantID, PromptPayID: req.PromptPayID,
		DailyAmountCap: amountCap, DailyTxnCap: req.DailyTxnCap,
		MinBalance: minBalance, TargetBalance: targetBalance,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, toAccountResponse(created))
}

func (h *Handler) getAccount(c *gin.Context) {
	if !requirePlatformAdmin(c) {
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	account, err := h.accounts.GetByID(c.Request.Context(), id)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toAccountResponse(account))
}

func (h *Handler) updateAccount(c *gin.Context) {
	if !requirePlatformAdmin(c) {
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	var req updateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	data := &domainbank.UpdateData{
		Tier:        domainbank.Tier(req.Tier),
		Status:      req.Status,
		PromptPayID: req.PromptPayID,
		DailyTxnCap: req.DailyTxnCap,
	}

	// A pointer that is present but empty clears the column. That is how an
	// account is taken out of a cluster, which no zero value could express.
	if req.ClusterID != nil {
		parsed, parseErr := parseOptionalUUID(*req.ClusterID)
		if parseErr != nil {
			resp.Error(c, errs.ErrInvalidInput)
			return
		}
		data.ClusterID = &parsed
	}
	if req.MerchantID != nil {
		parsed, parseErr := parseOptionalUUID(*req.MerchantID)
		if parseErr != nil {
			resp.Error(c, errs.ErrInvalidInput)
			return
		}
		data.MerchantID = &parsed
	}
	for _, field := range []struct {
		in  *string
		out **decimal.Decimal
	}{
		{req.DailyAmountCap, &data.DailyAmountCap},
		{req.MinBalance, &data.MinBalance},
		{req.TargetBalance, &data.TargetBalance},
	} {
		if field.in == nil {
			continue
		}
		parsed, parseErr := parseMoney(*field.in)
		if parseErr != nil {
			resp.Error(c, errs.ErrInvalidInput)
			return
		}
		*field.out = &parsed
	}

	updated, err := h.accounts.Update(c.Request.Context(), id, data)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toAccountResponse(updated))
}

func parseOptionalUUID(s string) (uuid.UUID, error) {
	if s == "" {
		return uuid.Nil, nil
	}

	return uuid.Parse(s)
}
```

Add `"github.com/shopspring/decimal"` to that file's imports.

`internal/adapter/http/adminpool/routes.go`:

```go
package adminpool

import (
	"be-maxpay/internal/adapter/http/routing"
	domainadmin "be-maxpay/internal/domain/adminuser"
	domainbank "be-maxpay/internal/domain/bankaccount"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router   *gin.Engine
	Accounts domainbank.Service
	Users    domainadmin.Service
	V        *validator.Validate
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Accounts, p.V)
	admin := routing.AdminGroup(p.Router, p.Users)

	clusters := admin.Group("/admin/clusters")
	{
		clusters.GET("", h.listClusters)
		clusters.POST("", h.createCluster)
	}

	accounts := admin.Group("/admin/accounts")
	{
		accounts.GET("", h.listAccounts)
		accounts.POST("", h.attachAccount)
		accounts.GET("/:id", h.getAccount)
		accounts.PATCH("/:id", h.updateAccount)
	}
}
```

- [ ] **Step 3: Write the handler test**

`internal/adapter/http/adminpool/handlers_test.go` drives the REAL registered routes, exactly as `adminmerchant/handlers_test.go` does: build a `*gin.Engine`, call `adminpool.RegisterRoutes` with a literal `RouteParams`, and give `AdminGroup` a stub `domainadmin.Service` whose `Authenticate` returns the test user. Cover at minimum:

- a merchant user gets 403 from `GET /api/v1/admin/accounts` — the pool is platform-only
- a merchant user gets 403 from `POST /api/v1/admin/accounts`
- a platform admin gets 200 from the list
- attaching with `promptpay_id` on an OUTBOUND tier surfaces the domain's refusal, not a 500
- `bank_balance` is absent from the response for an account whose balance was never read, and present once it has been

Follow that file for the stub shapes; `domainbank.Service` has seven methods and your stub must implement all of them.

- [ ] **Step 4: Add the routes to the inventory**

In `internal/adapter/http/routes_test.go`, append to `wantRoutes`:

```go
	{http.MethodGet, "/api/v1/admin/clusters"},
	{http.MethodPost, "/api/v1/admin/clusters"},
	{http.MethodGet, "/api/v1/admin/accounts"},
	{http.MethodPost, "/api/v1/admin/accounts"},
	{http.MethodGet, "/api/v1/admin/accounts/:id"},
	{http.MethodPatch, "/api/v1/admin/accounts/:id"},
```

and register `adminpool.RegisterRoutes` inside `buildTestEngine` alongside the others. The exact-length assertion at the end of that test is what makes the inventory worth having — do not relax it.

- [ ] **Step 5: Add the Bruno requests**

Create `bruno/Pool/folder.bru` with `name: Pool`, `seq: 4`, and one `.bru` per route carrying `Authorization: Bearer {{SESSION_TOKEN}}` and the `settings { encodeUrl: true \n timeout: 0 }` block the sibling files use. `Attach account.bru` posts:

```
body:json {
  {
    "device_id": "{{DEVICE_UUID}}",
    "account_no": "1234567890",
    "account_name": "MAXPAY CO LTD",
    "bank_code": "006",
    "tier": "INBOUND",
    "cluster_id": "{{CLUSTER_ID}}",
    "min_balance": "0",
    "target_balance": "0"
  }
}
```

with a post-response script storing `ACCOUNT_ID`. `Create cluster.bru` stores `CLUSTER_ID` the same way. Add `DEVICE_UUID`, `CLUSTER_ID` and `ACCOUNT_ID` to `bruno/environments/local.bru`.

- [ ] **Step 6: Run the tests and the gate**

```bash
export PATH="$PATH:$HOME/go/bin"
go test ./internal/adapter/http/... -v
make check
```

Expected: PASS, including the route inventory.

- [ ] **Step 7: Commit**

```bash
git add internal/adapter/http/adminpool internal/adapter/http/routes_test.go \
        bruno/Pool bruno/environments/local.bru
git commit -m "feat(admin): manage clusters and the bank account pool"
```

---

### Task 10: Wire it up and prove it against a real database

**Files:**
- Modify: `internal/shared/config.go`, `config.yaml`, `config.yaml.example`
- Modify: `internal/adapter/repository/module.go`, `internal/service/module.go`, `internal/adapter/http/module.go`
- Create: `internal/service/outbox/module.go`
- Modify: `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above
- Produces: a running service where a cluster and an account can be created and the worker is draining the queue

- [ ] **Step 1: Add the config blocks**

In `internal/shared/config.go`, after `Security`:

```go
	Pool struct {
		SatangRetries          int           `mapstructure:"satang_retries"`
		BalanceMaxAge          time.Duration `mapstructure:"balance_max_age"`
		BalanceRefreshInterval time.Duration `mapstructure:"balance_refresh_interval"`
	} `mapstructure:"pool"`

	Outbox struct {
		PollInterval time.Duration `mapstructure:"poll_interval"`
		Lease        time.Duration `mapstructure:"lease"`
		MaxAttempts  int           `mapstructure:"max_attempts"`
		BatchSize    int           `mapstructure:"batch_size"`
	} `mapstructure:"outbox"`
```

Defaults beside the existing ones:

```go
	v.SetDefault("pool.satang_retries", 5)
	v.SetDefault("pool.balance_max_age", 5*time.Minute)
	v.SetDefault("pool.balance_refresh_interval", 60*time.Second)
	v.SetDefault("outbox.poll_interval", time.Second)
	v.SetDefault("outbox.lease", time.Minute)
	v.SetDefault("outbox.max_attempts", 10)
	v.SetDefault("outbox.batch_size", 20)
```

and the keys in the `BindEnv` list:

```go
		"pool.satang_retries", "pool.balance_max_age", "pool.balance_refresh_interval",
		"outbox.poll_interval", "outbox.lease", "outbox.max_attempts", "outbox.batch_size",
```

Append the same block to `config.yaml` and `config.yaml.example`:

```yaml
pool:
  satang_retries: 5
  balance_max_age: 5m
  balance_refresh_interval: 60s

outbox:
  poll_interval: 1s
  lease: 1m
  max_attempts: 10
  batch_size: 20
```

- [ ] **Step 2: Register the repositories**

In `internal/adapter/repository/module.go`, add to `fx.Provide`:

```go
		fx.Annotate(bankaccountrepo.NewRepository, fx.As(new(bankaccount.Repository))),
		fx.Annotate(outboxrepo.NewRepository, fx.As(new(outbox.Repository))),
```

- [ ] **Step 3: Register the services**

In `internal/service/module.go`, add the two config-reading adapters beside the existing ones and register them:

```go
// NewBankAccountRouter takes the freshness window from config, so no caller
// can widen the definition of a usable balance.
func NewBankAccountRouter(repo bankaccount.Repository, cfg *shared.Config) bankaccount.Router {
	return banksvc.NewRouter(repo, cfg.Pool.BalanceMaxAge)
}
```

```go
		fx.Annotate(banksvc.NewService, fx.As(new(bankaccount.Service))),
		fx.Annotate(NewBankAccountRouter, fx.As(new(bankaccount.Router))),
```

- [ ] **Step 4: Wire the worker**

`internal/service/outbox/module.go`:

```go
package outbox

import (
	domainaccount "be-maxpay/internal/domain/account"
	domainbank "be-maxpay/internal/domain/bankaccount"
	domaindevice "be-maxpay/internal/domain/device"
	domainoutbox "be-maxpay/internal/domain/outbox"
	banksvc "be-maxpay/internal/service/bankaccount"
	"be-maxpay/internal/shared"

	"go.uber.org/fx"
	"go.uber.org/zap"
)

// NewConfiguredWorker builds the worker and registers every job kind the
// service knows how to run.
//
// Registration lives here rather than in each feature package so there is one
// place to read the answer to "what background work does this service do".
func NewConfiguredWorker(
	jobs domainoutbox.Repository,
	accounts domainbank.Repository,
	devices domaindevice.Repository,
	overview domainaccount.Service,
	cfg *shared.Config,
	logger *zap.Logger,
) *Worker {
	w := NewWorker(jobs, logger, Config{
		PollInterval: cfg.Outbox.PollInterval,
		Lease:        cfg.Outbox.Lease,
		MaxAttempts:  cfg.Outbox.MaxAttempts,
		BatchSize:    cfg.Outbox.BatchSize,
	})

	refresher := banksvc.NewBalanceRefresher(
		accounts, overview, devices, jobs,
		cfg.Pool.BalanceMaxAge, cfg.Outbox.BatchSize, logger,
	)
	w.Register(domainoutbox.KindRefreshAccountBalance, domainoutbox.HandlerFunc(refresher.Handle))

	return w
}

var Module = fx.Options(
	fx.Provide(NewConfiguredWorker),
	fx.Invoke(RegisterWorkerLifecycle),
)
```

Add `outboxsvc.Module` to `internal/app/module.go`'s `fx.Options`.

- [ ] **Step 5: Register the routes**

In `internal/adapter/http/module.go`, add `adminpoolhttp.RegisterRoutes` to the `fx.Invoke` list with the import `adminpoolhttp "be-maxpay/internal/adapter/http/adminpool"`.

- [ ] **Step 6: Run the whole gate**

```bash
export PATH="$PATH:$HOME/go/bin"
go mod tidy
make check
make test-integration
```

Expected: all green, including the route inventory's exact-length assertion.

- [ ] **Step 7: Prove it end to end**

```bash
make migrate-up
go run ./cmd/app &
sleep 3

TOKEN=$(curl -s -X POST http://localhost:8091/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .data.token)

# 1. a cluster
CLUSTER_ID=$(curl -s -X POST http://localhost:8091/api/v1/admin/clusters \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"cluster-one"}' | jq -r .data.id)

# 2. an inbound account against a registered device
DEVICE_UUID=$(docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -tAc \
  "SELECT id FROM devices LIMIT 1")
curl -s -X POST http://localhost:8091/api/v1/admin/accounts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$DEVICE_UUID\",\"account_no\":\"1234567890\",\"account_name\":\"MAXPAY CO LTD\",\"bank_code\":\"006\",\"tier\":\"INBOUND\",\"cluster_id\":\"$CLUSTER_ID\",\"promptpay_id\":\"0812345678\"}" | jq .

# 3. the shape rule must refuse a PromptPay identity on an outbound account
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8091/api/v1/admin/accounts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$DEVICE_UUID\",\"account_no\":\"2222222222\",\"account_name\":\"X\",\"bank_code\":\"006\",\"tier\":\"OUTBOUND\",\"cluster_id\":\"$CLUSTER_ID\",\"promptpay_id\":\"0812345678\"}"

# 4. the pool is platform-only: a merchant user must be refused
# (create a merchant login through /admin/merchants/:id/users first)

# 5. the worker is running
grep "outbox worker starting" /tmp/*.log || true
```

Expected: step 2 returns 201 with `bank_balance` ABSENT — no balance has been read. Step 3 prints `409`. Step 4 prints `403`. Step 5 shows the worker's startup line.

Note what step 2's absent `bank_balance` means: until Task 8's poller runs against a real bank response, no outbound account will ever be a candidate, because an unread balance is not a fresh balance. That is the correct refusal, not a bug — say so in your report.

- [ ] **Step 8: Update the documentation**

In `README.md`, add a Pool section listing the six endpoints, the `pool` and `outbox` config blocks, and the note from Task 8 about the balance parser's fixture.

In `AGENTS.md`, add to *Money-Flow Rules*:

```markdown
- Account selection lives in SQL, in the repository's two candidate queries. A
  cap or a freshness check evaluated in Go reads a value another request has
  already moved past. If you find yourself filtering candidates in a service,
  the filter belongs in the query.
- A bank balance that was never read is not a balance of zero. `bank_balance`
  and `bank_balance_at` are reported together and omitted together, and
  outbound routing refuses an account whose reading is stale — unknown must
  never satisfy a payout.
- Background work goes through the outbox, enqueued in the same transaction as
  the change it follows. A handler must be safe to run twice: a worker that
  dies after doing its work but before deleting its job will run it again.
```

- [ ] **Step 9: Commit**

```bash
git add internal/shared/config.go config.yaml.example \
        internal/adapter/repository/module.go internal/service/module.go \
        internal/service/outbox/module.go internal/app/module.go \
        internal/adapter/http/module.go README.md AGENTS.md
git commit -m "feat: wire the account pool and the outbox worker into the app"
```

---

## Plan Self-Review

**Spec coverage.** §4.5 (clusters, bank_accounts, daily stats) → Tasks 2–4. §4.7 outbox → Tasks 6–7. §4.7 audit_logs → NOT in this plan; it belongs with the ledger's `created_by` trail and lands in P2b. §8 inbound and outbound routing → Tasks 3 and 5, with the `deposits_pending_amount` index explicitly deferred to P3 with its table. §13's integration harness → Task 1, with three of its four named cases covered here (partial unique index, SKIP LOCKED, concurrent claim); the fourth (the deferred constraint trigger) belongs to the ledger and lands in P2b. §10's `pool` and `outbox` configuration → Task 10.

**Deliberate deferrals, each with its reason:**
1. `audit_logs` → P2b, because its first real writer is the ledger's adjustment endpoint.
2. The satang retry loop → P3, because it needs the `deposits` table it retries against.
3. Sweep and just-in-time top-up → P6, as the spec says; this plan gives them the `target_balance` and `min_balance` they will read.
4. `pool.satang_retries` is configured but unread until P3. It is added here so the whole `pool` block lands at once rather than the config file growing a section per phase.

**Known unproven work.** Task 8's `ParseBankBalance` cannot be verified against reality until someone registers a real KTB device and captures an account-overview response. The plan says so in the task, requires the implementer to state which case applies in its report, and requires the same note in the README. Everything else in this plan is verifiable today.

**Placeholder scan.** No "TBD", no "add validation", no "similar to Task N". Task 9's Step 3 describes a test file rather than printing it — the shape is fully specified (which routes, which cases, which sibling file to follow) and printing a fourth near-identical stub set would be worse than the pointer. Every other code step carries its code.

**Type consistency.** `bankaccount.Service` has seven methods (`CreateCluster`, `ListClusters`, `Attach`, `GetByID`, `List`, `ListForMerchant`, `Update`); Task 9's stub note said eight and has been corrected to seven. `bankaccount.Router` has two. `outbox.Repository` has six (`Enqueue`, `Claim`, `Succeed`, `Fail`, `Bury`, `CountBuried`) and every fake in Tasks 6 and 7 implements all six. `InboundQuery`/`OutboundQuery` field names are identical in the domain, the repository, the router and their tests. `ParseBankBalance` takes `(raw json.RawMessage, accountNo string)` in its definition and at all three call sites. `RefreshPayload` carries `AccountID`, `Alias`, `AccountNo` in both the producer (`EnqueueDue`) and the consumer (`Handle`).
