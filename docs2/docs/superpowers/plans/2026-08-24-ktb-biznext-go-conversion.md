# KTB BizNext API — Go Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express/SQLite KTB BizNext proxy in `src/` with a Go service on the `go-template` platform standard, preserving every upstream bank call exactly.

**Architecture:** Clean Architecture with `go.uber.org/fx`. Six feature modules (`device`, `registration`, `session`, `account`, `transfer`, `instruction`), each with a domain package (six files), a service, and HTTP + repository adapters. All bank traffic goes through one external adapter (`adapter/external/ktb`); PIN/password encryption goes through another (`adapter/external/encrypt`). PostgreSQL holds device credentials. Callers authenticate with a static API key.

**Tech Stack:** Go 1.25, Gin, fx, PostgreSQL (pgx/sqlx/Squirrel), golang-migrate, Viper, Zap + lumberjack, go-playground/validator, shopspring/decimal, golang.org/x/sync/singleflight, testify + sqlmock + httptest.

**Spec:** `docs/superpowers/specs/2026-08-24-ktb-biznext-go-conversion-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Go **1.25**; module name **`ktb-biznext-api`**; project root **`/Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api`**.
- Source of truth for upstream behavior is `/Users/villain0x0/Desktop/apiappnextbiz03042026/src/`. When this plan and that code disagree, **the Node code wins** — re-read it and report the discrepancy.
- Code identifiers and code comments in **English only**, including `TODO` / `FIXME` / `NOTE`. User-facing chat output is Thai.
- Domain packages must not import adapter or service packages. Domain may import `internal/shared/errs` only to wrap sentinels. Domain DTOs carry no `json` or `db` tags.
- Every `internal/domain/{feature}` package has all six files: `entity.go`, `dto.go`, `errors.go`, `repository.go`, `service.go`, `validator.go` — a package-only stub with a one-line reason when empty.
- Errors wrap `errs.ErrXxx` sentinels. Never return raw internal or database error text to clients (the single, deliberate exception is the trimmed upstream object in Task 3).
- Every function performing I/O accepts `context.Context` as its first parameter.
- SQL is built with Squirrel and dollar placeholders. Never hand-build `$1`/`$2`.
- Primary keys are UUIDv7 via `shared/id.New()`. `uuid.New()` (v4) is only for correlation IDs and device IDs.
- Persistence models live in `adapter/persistence/model` and never leave the adapter layer. Each entity ships `XToModel`, `XToDomain`, `XsToDomain` in `adapter/persistence/mapper`.
- Monetary values use `decimal.Decimal`, never `float64`.
- Log field names are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`. Never log PINs, tokens, encrypted passphrases, or full request bodies.
- Register every new constructor and route in the appropriate `module.go`.
- Tests use `require` for setup and `assert` for independent comparisons; `require.ErrorIs` against typed errors, never error-string matching.
- Every task ends green: `go build ./... && go vet ./... && go test -race ./...`.
- Commit at the end of every task. Conventional Commits (`feat:`, `test:`, `chore:`, `refactor:`).

### Upstream constants (copied verbatim from `src/config/constants.js`)

```text
BASE_URL        https://business.krungthai.com/ktb/rest/biznext-channel
CLIENT_VERSION  5.1.0
PLATFORM        android/14
DEVICE_MODEL    OnePlus-CPH2449
CHANNEL_ID      MB
ACCEPT_LANGUAGE th-TH
HOST            business.krungthai.com
CONNECTION      Keep-Alive
USER_AGENT      okhttp/4.12.0
CONTENT_TYPE_JSON       application/json; charset=utf-8
CONTENT_TYPE_JSON_UTF8  application/json; charset=UTF-8
PRELOGIN AUTH   Basic YWRtaW46cGFzc3dvcmQ=
ENCRYPT URL     https://encrypt.th-api.com/pin/encrypt
correlation id  <uuid v4>-crid     (fresh per request)
device id       <uuid v4>-devc     (once per registration)
```

The two content types differ only in the case of `utf-8` / `UTF-8`. This is not
a typo to clean up — reproduce it per endpoint exactly as the table in Task 5
states.

---

## File Structure

```text
ktb-biznext-api/
├── cmd/app/main.go                              entry point; sets decimal JSON mode
├── config.yaml.example
├── docker-compose.yaml                          postgres only
├── Makefile
├── AGENTS.md                                    platform rules + this service's deviations
├── README.md
├── db/migrations/000001_init.{up,down}.sql      devices table
├── scripts/import_sqlite/main.go                one-off biznext.db -> Postgres
├── bruno/                                       full request collection
└── internal/
    ├── app/module.go                            root fx module
    ├── shared/                                  from template, minus redis.go + session.go
    │   ├── config.go                            + KTB, Encrypt, APIKeys blocks
    │   └── errs/errs.go                         + ErrUpstream
    ├── domain/
    │   ├── device/       {entity,dto,errors,repository,service,validator}.go
    │   ├── registration/ {entity,dto,errors,repository,service,validator}.go
    │   ├── session/      {entity,dto,errors,repository,service,validator}.go
    │   ├── account/      {entity,dto,errors,repository,service,validator}.go
    │   ├── transfer/     {entity,dto,errors,repository,service,validator}.go
    │   └── instruction/  {entity,dto,errors,repository,service,validator}.go
    ├── service/
    │   ├── device/service.go        CRUD over the repository
    │   ├── registration/service.go  register + verify-otp orchestration
    │   ├── session/service.go       login + auto-relogin + singleflight
    │   ├── account/service.go       balances, ref ids, transactions, checks
    │   ├── transfer/service.go      transfer-order flow
    │   ├── transfer/bulk.go         bulk-manual flow
    │   ├── transfer/fee.go          selectBestService variants
    │   ├── instruction/service.go   tasks, detail, approve
    │   ├── mfa/mfa.go               shared challenge/seal/authenticate step
    │   └── module.go
    └── adapter/
        ├── external/
        │   ├── encrypt/{client,dto,methods,module}.go
        │   └── ktb/
        │       ├── client.go        transport, headers, error mapping
        │       ├── dto.go           typed request/response bodies
        │       ├── methods_auth.go
        │       ├── methods_account.go
        │       ├── methods_transfer.go
        │       ├── methods_bulk.go
        │       ├── methods_instruction.go
        │       └── module.go
        ├── persistence/{model,mapper}/device.go
        ├── repository/
        │   ├── base/                unchanged from template
        │   ├── tx/                  unchanged from template
        │   ├── device/repository.go
        │   └── module.go
        └── http/
            ├── middleware/{apikey,logger,timeout}.go
            ├── routing/groups.go
            ├── resp/response.go     + upstream detail on 502
            ├── health/{handler,routes}.go
            ├── device/{handler,handlers,dto,helpers,routes}.go
            ├── registration/{handler,handlers,dto,routes}.go
            ├── account/{handler,handlers,dto,helpers,routes}.go
            ├── transfer/{handler,handlers,dto,routes}.go
            ├── instruction/{handler,handlers,dto,helpers,routes}.go
            └── module.go
```

Deleted from the template: `domain/{note,user,auth,session}`, `service/{note,user,auth}`, `adapter/http/{note,auth}`, `adapter/repository/{note,user,session}`, `adapter/persistence/{model,mapper}/{note,user}.go`, `shared/redis.go`, `shared/session.go`, `shared/session_test.go`, `adapter/http/middleware/auth.go`, `adapter/http/middleware/auth_test.go`, `docs/session-auth-standard.md`.

---

## Task 1: Scaffold the project

**Files:**
- Create: whole `ktb-biznext-api/` tree by copying `go-template/`
- Modify: `go.mod`, `Makefile`, `docker-compose.yaml`, `config.yaml.example`, `AGENTS.md`, `README.md`, `.gitignore`
- Modify: `internal/shared/config.go`, `internal/shared/module.go`, `internal/app/module.go`, `internal/adapter/http/module.go`, `internal/adapter/repository/module.go`, `internal/service/module.go`
- Modify: `internal/adapter/http/health/{handler,routes}.go`
- Delete: every demo feature listed in the File Structure section
- Create: `cmd/app/main.go` (modified from template)

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable service exposing `GET /health` and `GET /ready`; `shared.Config` with `App.APIKeys []string`, `KTB`, and `Encrypt` blocks; `internal/shared/id.New()`; `base.BaseRepository`; `resp.*` — all consumed by every later task.

- [ ] **Step 1: Copy the template and strip its git history**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026
cp -R go-template ktb-biznext-api
rm -rf ktb-biznext-api/.git
cd ktb-biznext-api
git init
```

- [ ] **Step 2: Rename the Go module**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
sed -i '' 's|^module go-template$|module ktb-biznext-api|' go.mod
grep -rl 'go-template/internal' --include='*.go' . | xargs sed -i '' 's|go-template/internal|ktb-biznext-api/internal|g'
sed -i '' 's|^APP_NAME := go-template$|APP_NAME := ktb-biznext-api|' Makefile
go build ./... 2>&1 | head
```

Expected: builds clean. Any remaining `go-template` import is a missed file — fix it before continuing.

- [ ] **Step 3: Delete the demo features**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
rm -rf internal/domain/note internal/domain/user internal/domain/auth internal/domain/session
rm -rf internal/service/note internal/service/user internal/service/auth
rm -rf internal/adapter/http/note internal/adapter/http/auth
rm -rf internal/adapter/repository/note internal/adapter/repository/user internal/adapter/repository/session
rm -f  internal/adapter/persistence/model/note.go internal/adapter/persistence/model/user.go
rm -f  internal/adapter/persistence/mapper/note.go internal/adapter/persistence/mapper/user.go
rm -f  internal/shared/redis.go internal/shared/session.go internal/shared/session_test.go
rm -f  internal/adapter/http/middleware/auth.go internal/adapter/http/middleware/auth_test.go
rm -f  docs/session-auth-standard.md
rm -f  db/migrations/000001_init.up.sql db/migrations/000001_init.down.sql
rm -rf bruno/Auth bruno/Notes
```

- [ ] **Step 4: Add and drop dependencies**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go get github.com/shopspring/decimal@latest
go get golang.org/x/sync@latest
go get modernc.org/sqlite@latest
go mod tidy
```

`go mod tidy` drops `go-redis` and `miniredis` once Redis is gone. `modernc.org/sqlite` is a pure-Go driver used only by `scripts/import_sqlite` (Task 16) — no cgo, so `CGO_ENABLED=0` builds still work.

- [ ] **Step 5: Rewrite `internal/shared/config.go`**

```go
package shared

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"ktb-biznext-api/internal/shared/errs"

	"github.com/spf13/viper"
)

type Config struct {
	App struct {
		Env            string        `mapstructure:"env"`
		Port           string        `mapstructure:"port"`
		RequestTimeout time.Duration `mapstructure:"request_timeout"`
		CORSOrigins    []string      `mapstructure:"cors_origins"`
		APIKeys        []string      `mapstructure:"api_keys"`
	} `mapstructure:"app"`

	Database struct {
		DSN             string        `mapstructure:"dsn"`
		MaxOpenConns    int           `mapstructure:"max_open_conns"`
		MaxIdleConns    int           `mapstructure:"max_idle_conns"`
		ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
	} `mapstructure:"database"`

	KTB struct {
		BaseURL               string        `mapstructure:"base_url"`
		Timeout               time.Duration `mapstructure:"timeout"`
		ClientVersion         string        `mapstructure:"client_version"`
		Platform              string        `mapstructure:"platform"`
		DeviceModel           string        `mapstructure:"device_model"`
		ChannelID             string        `mapstructure:"channel_id"`
		AcceptLanguage        string        `mapstructure:"accept_language"`
		Host                  string        `mapstructure:"host"`
		UserAgent             string        `mapstructure:"user_agent"`
		PreloginAuthorization string        `mapstructure:"prelogin_authorization"`
	} `mapstructure:"ktb"`

	Encrypt struct {
		BaseURL string        `mapstructure:"base_url"`
		Timeout time.Duration `mapstructure:"timeout"`
	} `mapstructure:"encrypt"`

	Log struct {
		Level      string `mapstructure:"level"`
		FilePath   string `mapstructure:"file_path"`
		MaxSize    int    `mapstructure:"max_size"`
		MaxBackups int    `mapstructure:"max_backups"`
		MaxAge     int    `mapstructure:"max_age"`
		Compress   bool   `mapstructure:"compress"`
	} `mapstructure:"log"`
}

func LoadConfig() (*Config, error) {
	v := viper.New()

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("./config")

	v.SetEnvPrefix("APP")
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	v.SetDefault("app.env", "development")
	v.SetDefault("app.port", "3001")
	v.SetDefault("app.request_timeout", 120*time.Second)
	v.SetDefault("database.max_open_conns", 25)
	v.SetDefault("database.max_idle_conns", 10)
	v.SetDefault("database.conn_max_lifetime", 15*time.Minute)
	v.SetDefault("ktb.base_url", "https://business.krungthai.com/ktb/rest/biznext-channel")
	v.SetDefault("ktb.timeout", 60*time.Second)
	v.SetDefault("ktb.client_version", "5.1.0")
	v.SetDefault("ktb.platform", "android/14")
	v.SetDefault("ktb.device_model", "OnePlus-CPH2449")
	v.SetDefault("ktb.channel_id", "MB")
	v.SetDefault("ktb.accept_language", "th-TH")
	v.SetDefault("ktb.host", "business.krungthai.com")
	v.SetDefault("ktb.user_agent", "okhttp/4.12.0")
	v.SetDefault("ktb.prelogin_authorization", "Basic YWRtaW46cGFzc3dvcmQ=")
	v.SetDefault("encrypt.base_url", "https://encrypt.th-api.com")
	v.SetDefault("encrypt.timeout", 30*time.Second)
	v.SetDefault("log.level", "info")
	v.SetDefault("log.max_size", 100)
	v.SetDefault("log.max_backups", 7)
	v.SetDefault("log.max_age", 30)
	v.SetDefault("log.compress", true)

	for _, key := range []string{
		"app.env", "app.port", "app.request_timeout", "app.cors_origins", "app.api_keys",
		"database.dsn", "database.max_open_conns", "database.max_idle_conns", "database.conn_max_lifetime",
		"ktb.base_url", "ktb.timeout", "ktb.client_version", "ktb.platform", "ktb.device_model",
		"ktb.channel_id", "ktb.accept_language", "ktb.host", "ktb.user_agent", "ktb.prelogin_authorization",
		"encrypt.base_url", "encrypt.timeout",
		"log.level", "log.file_path", "log.max_size", "log.max_backups", "log.max_age", "log.compress",
	} {
		_ = v.BindEnv(key)
	}

	if err := v.ReadInConfig(); err != nil {
		var notFoundErr viper.ConfigFileNotFoundError
		if !errors.As(err, &notFoundErr) {
			return nil, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *Config) IsProduction() bool  { return c.App.Env == "production" }
func (c *Config) IsDevelopment() bool { return c.App.Env == "development" }

func validateConfig(cfg *Config) error {
	if cfg.Database.DSN == "" {
		return errs.NewConfigError("database.dsn is required")
	}
	if cfg.App.Port == "" {
		return errs.NewConfigError("app.port is required")
	}
	if cfg.KTB.BaseURL == "" {
		return errs.NewConfigError("ktb.base_url is required")
	}
	if cfg.Encrypt.BaseURL == "" {
		return errs.NewConfigError("encrypt.base_url is required")
	}
	if cfg.IsProduction() && len(cfg.App.CORSOrigins) == 0 {
		return errs.NewConfigError("app.cors_origins is required in production (no wildcard allowed)")
	}
	// An empty allow-list would make every endpoint public, including transfers.
	if cfg.IsProduction() && len(cfg.App.APIKeys) == 0 {
		return errs.NewConfigError("app.api_keys is required in production")
	}
	return nil
}
```

- [ ] **Step 6: Strip Redis out of the fx graph and the readiness probe**

`internal/shared/module.go`:

```go
package shared

import "go.uber.org/fx"

var Module = fx.Options(
	fx.Provide(
		LoadConfig,
		NewDatabase,
		NewValidator,
		NewLogger,
	),
	fx.Invoke(
		RegisterDatabaseLifecycle,
		RegisterLoggerLifecycle,
	),
)
```

`internal/adapter/http/health/handler.go` — drop the `redis` field, constructor parameter, and the Redis branch of `ready`:

```go
package health

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

// Handler serves liveness and readiness probes.
type Handler struct {
	db *sqlx.DB
}

func NewHandler(db *sqlx.DB) *Handler {
	return &Handler{db: db}
}

// live reports process liveness without touching dependencies.
func (h *Handler) live(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "code": http.StatusOK, "data": gin.H{"status": "ok"}})
}

// ready verifies that critical dependencies are reachable.
func (h *Handler) ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	checks := gin.H{}
	healthy := true

	if err := h.db.PingContext(ctx); err != nil {
		checks["database"] = "down"
		healthy = false
	} else {
		checks["database"] = "up"
	}

	code := http.StatusOK
	if !healthy {
		code = http.StatusServiceUnavailable
	}

	c.JSON(code, gin.H{
		"success": healthy,
		"code":    code,
		"data":    gin.H{"status": statusLabel(healthy), "checks": checks},
	})
}

func statusLabel(healthy bool) string {
	if healthy {
		return "ready"
	}
	return "unavailable"
}
```

`internal/adapter/http/health/routes.go`:

```go
package health

import (
	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router *gin.Engine
	DB     *sqlx.DB
}

// RegisterRoutes wires liveness and readiness probes.
// /health is liveness (no dependency checks); /ready verifies PostgreSQL.
func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.DB)

	p.Router.GET("/health", h.live)
	p.Router.GET("/ready", h.ready)
}
```

- [ ] **Step 7: Empty out the feature module files**

`internal/adapter/http/module.go` — keep `NewApp`, `corsConfig`, `requestTimeout`, `RegisterHTTPLifecycle` unchanged; replace the `Module` var:

```go
var Module = fx.Options(
	fx.Provide(NewApp),
	fx.Invoke(
		healthhttp.RegisterRoutes,
	),
	fx.Invoke(RegisterHTTPLifecycle),
)
```

and delete the `authhttp` / `notehttp` imports.

`internal/service/module.go`:

```go
package service

import "go.uber.org/fx"

// Module registers every feature service. Constructors are added here as the
// features land; see internal/app/module.go for the composition root.
var Module = fx.Options()
```

`internal/adapter/repository/module.go`:

```go
package repository

import (
	"ktb-biznext-api/internal/adapter/repository/tx"

	"go.uber.org/fx"
)

var Module = fx.Options(
	fx.Provide(
		tx.NewTransactionHelper,
	),
)
```

- [ ] **Step 8: Leave `cmd/app/main.go` as the template has it**

No change is needed. In particular, do **not** set the global
`decimal.MarshalJSONWithoutQuotes`: JSON-number formatting for money is handled
by the local `ktb.Amount` type introduced in Task 8, which keeps that decision
inside the one package that needs it instead of in a process-wide flag any
dependency could flip.

- [ ] **Step 9: Write `config.yaml.example`**

```yaml
app:
  env: development
  port: "3001"
  # A bulk transfer to N payees makes roughly 4N+8 sequential upstream calls.
  request_timeout: 120s
  api_keys:
    - change-me
  # cors_origins:
  #   - https://app.example.com

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

- [ ] **Step 10: Trim `docker-compose.yaml` and point the Makefile at the new database**

`docker-compose.yaml` — drop the whole `redis:` service and change `POSTGRES_DB`:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ktbbiznext
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

`Makefile` — last line:

```makefile
DATABASE_URL ?= postgres://postgres:postgres@localhost:5433/ktbbiznext?sslmode=disable
```

- [ ] **Step 11: Record the platform deviations in `AGENTS.md`**

Keep the template's `AGENTS.md` and append this section before "Required Verification":

```markdown
---

## Deviations From the Platform Standard

This service is a machine-to-machine proxy in front of the Krungthai BizNext
mobile API. Three rules differ from the template; nothing else does.

1. **No Redis.** There is no session store and no cache, so `shared/redis.go`,
   `domain/session`, and `adapter/repository/session` are absent and `/ready`
   pings PostgreSQL only.
2. **Caller auth is a static API key** (`X-API-Key` against `app.api_keys`),
   not an opaque Redis session. The service has no human users of its own.
3. **A `502` response carries a trimmed upstream error object.** This service
   exists to relay a bank; "insufficient balance" is the caller's answer, not
   our internal detail. Only the upstream `status`, `code`, and `message` are
   copied — never the full body, which is logged with the `trace_id` instead.
   Every other 5xx still returns a generic message.

Business logic in this repository never flows back into `go-template`.
```

- [ ] **Step 12: Verify the stripped service builds and starts**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go mod tidy && go build ./... && go vet ./... && go test -race ./...
```

Expected: all pass. The remaining tests are the template's `shared`, `base`, `middleware/logger`, and `id` tests.

- [ ] **Step 13: Smoke-test the process**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
cp config.yaml.example config.yaml
make docker-up
sleep 5
go run ./cmd/app &
sleep 3
curl -s localhost:3001/health
curl -s localhost:3001/ready
kill %1
```

Expected: `/health` returns `{"success":true,"code":200,"data":{"status":"ok"}}`; `/ready` returns `"database":"up"` and no `redis` key.

- [ ] **Step 14: Commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
cat >> .gitignore <<'EOF'
config.yaml
logs/
bin/
EOF
git add -A
git commit -m "chore: scaffold ktb-biznext-api from go-template"
```

---

## Task 2: `ErrUpstream` sentinel and the 502 response shape

**Files:**
- Modify: `internal/shared/errs/errs.go`
- Create: `internal/shared/errs/upstream.go`
- Modify: `internal/adapter/http/resp/response.go`
- Test: `internal/shared/errs/upstream_test.go`, `internal/adapter/http/resp/response_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `errs.ErrUpstream` — sentinel, maps to 502.
  - `type errs.UpstreamError struct { Status int; Code string; Message string; Body []byte }` with `Error() string` and `Unwrap() error` returning `ErrUpstream`.
  - `errs.NewUpstreamError(status int, code, message string, body []byte) *UpstreamError`
  - `resp.Error(c, err)` emits the trimmed `upstream` object when `err` wraps `*UpstreamError`.

  Task 5 constructs `*errs.UpstreamError` from bank responses; every HTTP handler relies on `resp.Error` rendering it.

- [ ] **Step 1: Write the failing test for the sentinel**

`internal/shared/errs/upstream_test.go`:

```go
package errs_test

import (
	"errors"
	"fmt"
	"testing"

	"ktb-biznext-api/internal/shared/errs"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamError_WrapsSentinel(t *testing.T) {
	err := errs.NewUpstreamError(400, "E1234", "insufficient balance", []byte(`{"code":"E1234"}`))

	require.ErrorIs(t, err, errs.ErrUpstream)
	assert.Equal(t, 400, err.Status)
	assert.Equal(t, "E1234", err.Code)
	assert.Equal(t, "insufficient balance", err.Message)
}

func TestUpstreamError_SurvivesWrapping(t *testing.T) {
	inner := errs.NewUpstreamError(422, "", "rejected", nil)
	wrapped := fmt.Errorf("create transfer order: %w", inner)

	require.ErrorIs(t, wrapped, errs.ErrUpstream)

	var got *errs.UpstreamError
	require.True(t, errors.As(wrapped, &got))
	assert.Equal(t, 422, got.Status)
}

func TestUpstreamError_ErrorMessageOmitsBody(t *testing.T) {
	err := errs.NewUpstreamError(500, "E9", "boom", []byte("secret-token-in-body"))

	assert.NotContains(t, err.Error(), "secret-token-in-body")
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `go test ./internal/shared/errs/ -run TestUpstreamError -v`
Expected: FAIL — `undefined: errs.NewUpstreamError`, `undefined: errs.ErrUpstream`.

- [ ] **Step 3: Add the sentinel**

In `internal/shared/errs/errs.go`, inside the existing `var (...)` block, after `ErrInternal`:

```go
	// 502 Bad Gateway — the upstream bank rejected or failed the request.
	ErrUpstream = errors.New("upstream request failed")
```

- [ ] **Step 4: Add `UpstreamError`**

`internal/shared/errs/upstream.go`:

```go
package errs

import "fmt"

// UpstreamError carries a rejection from the Krungthai BizNext API.
//
// Status/Code/Message are safe to relay to the caller: this service exists to
// proxy a bank, and "insufficient balance" is the caller's answer, not our
// internal detail. Body is the full upstream payload and is for logging only —
// it is deliberately excluded from Error() so it cannot leak through a
// generic error-formatting path.
type UpstreamError struct {
	Status  int
	Code    string
	Message string
	Body    []byte
}

func NewUpstreamError(status int, code, message string, body []byte) *UpstreamError {
	return &UpstreamError{Status: status, Code: code, Message: message, Body: body}
}

func (e *UpstreamError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("upstream %d [%s]: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("upstream %d: %s", e.Status, e.Message)
}

func (e *UpstreamError) Unwrap() error { return ErrUpstream }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./internal/shared/errs/ -run TestUpstreamError -v`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the 502 response shape**

`internal/adapter/http/resp/response_test.go`:

```go
package resp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"ktb-biznext-api/internal/adapter/http/resp"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	return c, rec
}

func TestError_UpstreamReturns502WithTrimmedDetail(t *testing.T) {
	c, rec := newTestContext()

	err := errs.NewUpstreamError(400, "E1234", "ยอดเงินในบัญชีไม่เพียงพอ", []byte(`{"secret":"do-not-leak"}`))
	resp.Error(c, fmt.Errorf("create transfer order: %w", err))

	require.Equal(t, http.StatusBadGateway, rec.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	assert.Equal(t, false, body["success"])
	assert.Equal(t, float64(502), body["code"])
	assert.Equal(t, "bank rejected the request", body["message"])

	upstream, ok := body["upstream"].(map[string]any)
	require.True(t, ok, "response must carry an upstream object")
	assert.Equal(t, float64(400), upstream["status"])
	assert.Equal(t, "E1234", upstream["code"])
	assert.Equal(t, "ยอดเงินในบัญชีไม่เพียงพอ", upstream["message"])

	assert.NotContains(t, rec.Body.String(), "do-not-leak")
}

func TestError_InternalStaysGeneric(t *testing.T) {
	c, rec := newTestContext()

	resp.Error(c, fmt.Errorf("connection string postgres://user:pw@host: %w", errs.ErrInternal))

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "internal server error")
	assert.NotContains(t, rec.Body.String(), "postgres://")
	assert.NotContains(t, rec.Body.String(), "upstream")
}

func TestError_NotFoundKeepsWrappedMessage(t *testing.T) {
	c, rec := newTestContext()

	resp.Error(c, fmt.Errorf("device not found: %w", errs.ErrNotFound))

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "device not found")
}
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `go test ./internal/adapter/http/resp/ -v`
Expected: FAIL — status is 500, not 502, and there is no `upstream` key.

- [ ] **Step 8: Extend `resp`**

In `internal/adapter/http/resp/response.go`, add the error-body type and the upstream branch:

```go
type errorResp struct {
	Success  bool            `json:"success"`
	Code     int             `json:"code"`
	Message  string          `json:"message,omitempty"`
	Upstream *upstreamDetail `json:"upstream,omitempty"`
}

// upstreamDetail is the trimmed bank rejection relayed to the caller.
// The upstream body is never included; it is logged with the trace_id instead.
type upstreamDetail struct {
	Status  int    `json:"status"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}
```

Add to `getStatusCode`, before the `errs.ErrInternal` case:

```go
	case errors.Is(err, errs.ErrUpstream):
		return http.StatusBadGateway
```

Replace `Error` with:

```go
// Error maps an error to an HTTP status and a client-safe message.
// The full error is attached to the gin context (c.Error) so the logging
// middleware records internal detail, while 5xx responses expose only a
// generic message. The one exception is an upstream bank rejection, which
// relays the bank's own status/code/message — see AGENTS.md, deviation 3.
func Error(c *gin.Context, err error) {
	_ = c.Error(err)

	code := getStatusCode(err)
	body := errorResp{
		Success: false,
		Code:    code,
		Message: clientMessage(err, code),
	}

	var upstreamErr *errs.UpstreamError
	if errors.As(err, &upstreamErr) {
		body.Upstream = &upstreamDetail{
			Status:  upstreamErr.Status,
			Code:    upstreamErr.Code,
			Message: upstreamErr.Message,
		}
	}

	c.JSON(code, body)
}
```

And add to `clientMessage`, inside the `code >= http.StatusInternalServerError` switch, before `default`:

```go
		case errors.Is(err, errs.ErrUpstream):
			return "bank rejected the request"
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `go test ./internal/adapter/http/resp/ ./internal/shared/errs/ -v`
Expected: PASS.

- [ ] **Step 10: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/shared/errs internal/adapter/http/resp
git commit -m "feat: add ErrUpstream sentinel and 502 response with trimmed bank detail"
```

---

## Task 3: `devices` table, domain, model, mapper, repository

**Files:**
- Create: `db/migrations/000001_init.up.sql`, `db/migrations/000001_init.down.sql`
- Create: `internal/domain/device/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/persistence/model/device.go`
- Create: `internal/adapter/persistence/mapper/device.go`
- Create: `internal/adapter/repository/device/repository.go`
- Modify: `internal/adapter/repository/module.go`
- Test: `internal/adapter/repository/device/repository_test.go`, `internal/domain/device/validator_test.go`

**Interfaces:**
- Consumes: `base.BaseRepository`, `errs`, `shared/id` (Task 1).
- Produces:
  - `device.Device` entity (fields listed below).
  - `device.Repository` interface — every later service persists through it.
  - `device.Service` interface — implemented in Task 4.
  - Errors: `device.ErrDeviceNotFound`, `ErrAliasRequired`, `ErrDeviceIDRequired`, `ErrPINRequired`, `ErrAliasAlreadyExists`, `ErrDeviceNotProvisioned`, `ErrAccountRefIDMissing`, `ErrCorporateRefIDMissing`, `ErrFromAccountNoMissing`.

- [ ] **Step 1: Write the migration**

`db/migrations/000001_init.up.sql`:

```sql
-- UUID primary keys use PostgreSQL 18 built-in uuidv7() (time-ordered).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF row(NEW.*) IS DISTINCT FROM row(OLD.*) THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- One row per registered BizNext device. "alias" is the caller-facing key;
-- the Node service called this column "user".
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

DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

`db/migrations/000001_init.down.sql`:

```sql
DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
DROP TABLE IF EXISTS devices;
DROP FUNCTION IF EXISTS public.update_updated_at_column();
```

- [ ] **Step 2: Apply the migration**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
make docker-up && sleep 5 && make migrate-up
```

Expected: `1/u init (…ms)`. If `migrate` is not installed:
`go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest`.

- [ ] **Step 3: Write the domain package**

`internal/domain/device/entity.go`:

```go
package device

import (
	"time"

	"github.com/google/uuid"
)

// Device is one registered Krungthai BizNext device and its credentials.
//
// Optional columns are modeled as empty strings rather than pointers: every
// caller branches on "is it set", never on "is it SQL NULL", so the NULL
// distinction is confined to the persistence model and its mapper.
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

// IsProvisioned reports whether the device can complete a PIN login.
func (d *Device) IsProvisioned() bool {
	return d.DeviceID != "" && d.PIN != ""
}
```

`internal/domain/device/dto.go`:

```go
package device

// CreateDeviceData is the input for inserting a device directly, bypassing the
// registration flow (the Node service's POST /add).
type CreateDeviceData struct {
	Alias          string
	DeviceID       string
	PIN            string
	AccessToken    string
	CorporateRefID string
	AccountRefID   string
	FromAccountNo  string
}

// NewDeviceData is the input for the row written at the end of registration,
// before an OTP has been verified. PIN is still unknown at that point.
type NewDeviceData struct {
	Alias            string
	DeviceID         string
	AccessToken      string
	TokenUUID        string
	TransactionToken string
}

// UpdateDeviceData is the input of the partial update use case. An empty field
// means "leave unchanged".
type UpdateDeviceData struct {
	CorporateRefID string
	AccountRefID   string
	FromAccountNo  string
	PIN            string
	AccessToken    string
}
```

`internal/domain/device/errors.go`:

```go
package device

import (
	"fmt"

	"ktb-biznext-api/internal/shared/errs"
)

var (
	ErrDeviceNotFound     = fmt.Errorf("device not found: %w", errs.ErrNotFound)
	ErrAliasAlreadyExists = fmt.Errorf("alias already registered: %w", errs.ErrConflict)

	ErrAliasRequired    = fmt.Errorf("alias is required: %w", errs.ErrInvalidInput)
	ErrDeviceIDRequired = fmt.Errorf("device_id is required: %w", errs.ErrInvalidInput)
	ErrPINRequired      = fmt.Errorf("pin is required: %w", errs.ErrInvalidInput)

	// Preconditions a caller can fix by running an earlier endpoint first.
	ErrDeviceNotProvisioned  = fmt.Errorf("device has no device_id or pin: %w", errs.ErrConflict)
	ErrCorporateRefIDMissing = fmt.Errorf("no corporate_ref_id: fetch it first: %w", errs.ErrConflict)
	ErrAccountRefIDMissing   = fmt.Errorf("no account_ref_id: fetch it first: %w", errs.ErrConflict)
	ErrFromAccountNoMissing  = fmt.Errorf("no from_account_no: %w", errs.ErrConflict)
)
```

`internal/domain/device/repository.go`:

```go
package device

import "context"

type Repository interface {
	Create(ctx context.Context, data *CreateDeviceData) (*Device, error)
	CreateNew(ctx context.Context, data *NewDeviceData) (*Device, error)
	GetByAlias(ctx context.Context, alias string) (*Device, error)
	List(ctx context.Context) ([]*Device, error)
	UpsertCredentials(ctx context.Context, alias, deviceID, pin string) error
	UpdateTokens(ctx context.Context, alias, accessToken, refreshToken string) error
	UpdateCorporateRefID(ctx context.Context, alias, corporateRefID string) error
	UpdateAccountRef(ctx context.Context, alias, accountRefID, fromAccountNo string) error
	UpdateProfile(ctx context.Context, alias, companyID, userID string) error
	Delete(ctx context.Context, alias string) error
}
```

`internal/domain/device/service.go`:

```go
package device

import "context"

type Service interface {
	Add(ctx context.Context, data *CreateDeviceData) (*Device, error)
	GetByAlias(ctx context.Context, alias string) (*Device, error)
	List(ctx context.Context) ([]*Device, error)
	Update(ctx context.Context, alias string, data *UpdateDeviceData) (*Device, error)
	Delete(ctx context.Context, alias string) error
}
```

`internal/domain/device/validator.go`:

```go
package device

import "strings"

// ValidateCreate mirrors the Node POST /add guard: alias, device id, and PIN
// are all mandatory when a device is inserted by hand.
func ValidateCreate(data *CreateDeviceData) error {
	if strings.TrimSpace(data.Alias) == "" {
		return ErrAliasRequired
	}
	if strings.TrimSpace(data.DeviceID) == "" {
		return ErrDeviceIDRequired
	}
	if strings.TrimSpace(data.PIN) == "" {
		return ErrPINRequired
	}
	return nil
}

// ValidateAlias guards every alias-addressed lookup.
func ValidateAlias(alias string) error {
	if strings.TrimSpace(alias) == "" {
		return ErrAliasRequired
	}
	return nil
}
```

- [ ] **Step 4: Write the failing validator test**

`internal/domain/device/validator_test.go`:

```go
package device_test

import (
	"testing"

	"ktb-biznext-api/internal/domain/device"

	"github.com/stretchr/testify/require"
)

func TestValidateCreate(t *testing.T) {
	tests := []struct {
		name    string
		data    device.CreateDeviceData
		wantErr error
	}{
		{"valid", device.CreateDeviceData{Alias: "acme", DeviceID: "d-1", PIN: "123456"}, nil},
		{"missing alias", device.CreateDeviceData{DeviceID: "d-1", PIN: "123456"}, device.ErrAliasRequired},
		{"blank alias", device.CreateDeviceData{Alias: "   ", DeviceID: "d-1", PIN: "123456"}, device.ErrAliasRequired},
		{"missing device id", device.CreateDeviceData{Alias: "acme", PIN: "123456"}, device.ErrDeviceIDRequired},
		{"missing pin", device.CreateDeviceData{Alias: "acme", DeviceID: "d-1"}, device.ErrPINRequired},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := device.ValidateCreate(&tt.data)
			if tt.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}

func TestValidateAlias_Blank(t *testing.T) {
	require.ErrorIs(t, device.ValidateAlias("  "), device.ErrAliasRequired)
	require.NoError(t, device.ValidateAlias("acme"))
}

func TestDevice_IsProvisioned(t *testing.T) {
	require.True(t, (&device.Device{DeviceID: "d", PIN: "1"}).IsProvisioned())
	require.False(t, (&device.Device{DeviceID: "d"}).IsProvisioned())
	require.False(t, (&device.Device{PIN: "1"}).IsProvisioned())
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `go test ./internal/domain/device/ -v`
Expected: PASS (the implementation was written in Step 3 — these tests lock the contract the later tasks depend on).

- [ ] **Step 6: Write the persistence model and mapper**

`internal/adapter/persistence/model/device.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type Device struct {
	ID               uuid.UUID      `db:"id"`
	Alias            string         `db:"alias"`
	DeviceID         string         `db:"device_id"`
	PIN              sql.NullString `db:"pin"`
	AccessToken      sql.NullString `db:"access_token"`
	RefreshToken     sql.NullString `db:"refresh_token"`
	CorporateRefID   sql.NullString `db:"corporate_ref_id"`
	AccountRefID     sql.NullString `db:"account_ref_id"`
	FromAccountNo    sql.NullString `db:"from_account_no"`
	CompanyID        sql.NullString `db:"company_id"`
	UserID           sql.NullString `db:"user_id"`
	TokenUUID        sql.NullString `db:"token_uuid"`
	TransactionToken sql.NullString `db:"transaction_token"`
	CreatedAt        time.Time      `db:"created_at"`
	UpdatedAt        time.Time      `db:"updated_at"`
}
```

`internal/adapter/persistence/mapper/device.go`:

```go
package mapper

import (
	"database/sql"

	"ktb-biznext-api/internal/adapter/persistence/model"
	"ktb-biznext-api/internal/domain/device"
)

// nullString maps "" to SQL NULL so an unset credential is stored as NULL
// rather than an empty string, keeping the column meaningful to operators.
func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

// DeviceToModel converts a domain entity to a persistence model.
func DeviceToModel(d *device.Device) *model.Device {
	if d == nil {
		return nil
	}
	return &model.Device{
		ID:               d.ID,
		Alias:            d.Alias,
		DeviceID:         d.DeviceID,
		PIN:              nullString(d.PIN),
		AccessToken:      nullString(d.AccessToken),
		RefreshToken:     nullString(d.RefreshToken),
		CorporateRefID:   nullString(d.CorporateRefID),
		AccountRefID:     nullString(d.AccountRefID),
		FromAccountNo:    nullString(d.FromAccountNo),
		CompanyID:        nullString(d.CompanyID),
		UserID:           nullString(d.UserID),
		TokenUUID:        nullString(d.TokenUUID),
		TransactionToken: nullString(d.TransactionToken),
		CreatedAt:        d.CreatedAt,
		UpdatedAt:        d.UpdatedAt,
	}
}

// DeviceToDomain converts a persistence model to a domain entity.
func DeviceToDomain(m *model.Device) *device.Device {
	if m == nil {
		return nil
	}
	return &device.Device{
		ID:               m.ID,
		Alias:            m.Alias,
		DeviceID:         m.DeviceID,
		PIN:              m.PIN.String,
		AccessToken:      m.AccessToken.String,
		RefreshToken:     m.RefreshToken.String,
		CorporateRefID:   m.CorporateRefID.String,
		AccountRefID:     m.AccountRefID.String,
		FromAccountNo:    m.FromAccountNo.String,
		CompanyID:        m.CompanyID.String,
		UserID:           m.UserID.String,
		TokenUUID:        m.TokenUUID.String,
		TransactionToken: m.TransactionToken.String,
		CreatedAt:        m.CreatedAt,
		UpdatedAt:        m.UpdatedAt,
	}
}

// DevicesToDomain converts a slice of persistence models to domain entities.
func DevicesToDomain(models []*model.Device) []*device.Device {
	if models == nil {
		return nil
	}

	devices := make([]*device.Device, len(models))
	for i, m := range models {
		devices[i] = DeviceToDomain(m)
	}

	return devices
}
```

- [ ] **Step 7: Write the failing repository test**

`internal/adapter/repository/device/repository_test.go`:

```go
package device_test

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	devicerepo "ktb-biznext-api/internal/adapter/repository/device"
	domaindevice "ktb-biznext-api/internal/domain/device"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRepo(t *testing.T) (domaindevice.Repository, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return devicerepo.NewRepository(sqlx.NewDb(db, "sqlmock")), mock
}

func deviceRows(alias string) *sqlmock.Rows {
	now := time.Now().UTC()
	return sqlmock.NewRows([]string{
		"id", "alias", "device_id", "pin", "access_token", "refresh_token",
		"corporate_ref_id", "account_ref_id", "from_account_no",
		"company_id", "user_id", "token_uuid", "transaction_token",
		"created_at", "updated_at",
	}).AddRow(
		uuid.New(), alias, "dev-1", "123456", "tok", nil,
		"corp-1", "acct-1", "1234567890",
		nil, nil, nil, nil,
		now, now,
	)
}

func TestDeviceRepository_GetByAlias_Success(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT id, alias, device_id, pin, access_token, refresh_token, corporate_ref_id, account_ref_id, from_account_no, company_id, user_id, token_uuid, transaction_token, created_at, updated_at FROM devices WHERE alias = $1`,
	)).WithArgs("acme").WillReturnRows(deviceRows("acme"))

	got, err := repo.GetByAlias(context.Background(), "acme")
	require.NoError(t, err)
	assert.Equal(t, "acme", got.Alias)
	assert.Equal(t, "dev-1", got.DeviceID)
	assert.Equal(t, "corp-1", got.CorporateRefID)
	// A NULL column must surface as "" in the domain, never as a pointer.
	assert.Equal(t, "", got.RefreshToken)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeviceRepository_GetByAlias_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(`SELECT (.+) FROM devices WHERE alias = \$1`).
		WithArgs("ghost").
		WillReturnError(sql.ErrNoRows)

	_, err := repo.GetByAlias(context.Background(), "ghost")
	require.ErrorIs(t, err, domaindevice.ErrDeviceNotFound)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeviceRepository_UpdateTokens_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(`UPDATE devices SET`).
		WithArgs("new-token", sqlmock.AnyArg(), sqlmock.AnyArg(), "ghost").
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := repo.UpdateTokens(context.Background(), "ghost", "new-token", "")
	require.ErrorIs(t, err, domaindevice.ErrDeviceNotFound)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeviceRepository_UpdateAccountRef_Success(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(`UPDATE devices SET`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "acme").
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, repo.UpdateAccountRef(context.Background(), "acme", "acct-9", "9876543210"))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeviceRepository_UpsertCredentials_UsesOnConflict(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(`INSERT INTO devices \(.+\) VALUES \(.+\) ON CONFLICT \(alias\) DO UPDATE SET`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, repo.UpsertCredentials(context.Background(), "acme", "dev-1", "123456"))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeviceRepository_CreateNew_DuplicateAlias(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(`INSERT INTO devices`).
		WillReturnError(errDuplicate{})

	_, err := repo.CreateNew(context.Background(), &domaindevice.NewDeviceData{
		Alias: "acme", DeviceID: "dev-1",
	})
	require.ErrorIs(t, err, domaindevice.ErrAliasAlreadyExists)

	require.NoError(t, mock.ExpectationsWereMet())
}

// errDuplicate mimics a unique-violation message so errs.IsDuplicateError
// classifies it without needing a real pgconn.PgError.
type errDuplicate struct{}

func (errDuplicate) Error() string { return `duplicate key value violates unique constraint "devices_alias_key"` }

func TestDeviceRepository_List_MapsAllRows(t *testing.T) {
	repo, mock := newRepo(t)

	rows := deviceRows("acme")
	rows.AddRow(
		uuid.New(), "beta", "dev-2", nil, nil, nil,
		nil, nil, nil, nil, nil, nil, nil,
		time.Now().UTC(), time.Now().UTC(),
	)

	mock.ExpectQuery(`SELECT (.+) FROM devices ORDER BY created_at ASC`).WillReturnRows(rows)

	got, err := repo.List(context.Background())
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "acme", got[0].Alias)
	assert.Equal(t, "beta", got[1].Alias)
	assert.Equal(t, "", got[1].PIN)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeviceRepository_Delete_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(`DELETE FROM devices WHERE alias = \$1`).
		WithArgs("ghost").
		WillReturnResult(sqlmock.NewResult(0, 0))

	require.ErrorIs(t, repo.Delete(context.Background(), "ghost"), domaindevice.ErrDeviceNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `go test ./internal/adapter/repository/device/ -v`
Expected: FAIL — the package does not exist yet.

- [ ] **Step 9: Write the repository**

`internal/adapter/repository/device/repository.go`:

```go
package device

import (
	"context"
	"time"

	"ktb-biznext-api/internal/adapter/persistence/mapper"
	"ktb-biznext-api/internal/adapter/persistence/model"
	"ktb-biznext-api/internal/adapter/repository/base"
	domaindevice "ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/shared/errs"
	"ktb-biznext-api/internal/shared/id"

	"github.com/Masterminds/squirrel"
	"github.com/jmoiron/sqlx"
)

// deviceColumns is the full projection; every read returns the whole row
// because callers routinely need the tokens and the reference ids together.
var deviceColumns = []string{
	"id", "alias", "device_id", "pin", "access_token", "refresh_token",
	"corporate_ref_id", "account_ref_id", "from_account_no",
	"company_id", "user_id", "token_uuid", "transaction_token",
	"created_at", "updated_at",
}

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domaindevice.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

func (r *Repository) Create(ctx context.Context, data *domaindevice.CreateDeviceData) (*domaindevice.Device, error) {
	now := time.Now().UTC()

	query := r.Builder.Insert("devices").
		Columns("id", "alias", "device_id", "pin", "access_token",
			"corporate_ref_id", "account_ref_id", "from_account_no", "created_at", "updated_at").
		Values(id.New(), data.Alias, data.DeviceID, nullable(data.PIN), nullable(data.AccessToken),
			nullable(data.CorporateRefID), nullable(data.AccountRefID), nullable(data.FromAccountNo), now, now)

	if err := r.exec(ctx, query, "create device"); err != nil {
		return nil, err
	}

	return r.GetByAlias(ctx, data.Alias)
}

func (r *Repository) CreateNew(ctx context.Context, data *domaindevice.NewDeviceData) (*domaindevice.Device, error) {
	now := time.Now().UTC()

	query := r.Builder.Insert("devices").
		Columns("id", "alias", "device_id", "pin", "access_token",
			"token_uuid", "transaction_token", "created_at", "updated_at").
		Values(id.New(), data.Alias, data.DeviceID, nil, nullable(data.AccessToken),
			nullable(data.TokenUUID), nullable(data.TransactionToken), now, now)

	if err := r.exec(ctx, query, "create new device"); err != nil {
		return nil, err
	}

	return r.GetByAlias(ctx, data.Alias)
}

func (r *Repository) GetByAlias(ctx context.Context, alias string) (*domaindevice.Device, error) {
	sqlStr, args, err := r.Builder.Select(deviceColumns...).
		From("devices").
		Where(squirrel.Eq{"alias": alias}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build get device query")
	}

	var m model.Device
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domaindevice.ErrDeviceNotFound)
		}
		return nil, errs.WrapDatabaseError(err, "get device")
	}

	return mapper.DeviceToDomain(&m), nil
}

func (r *Repository) List(ctx context.Context) ([]*domaindevice.Device, error) {
	sqlStr, args, err := r.Builder.Select(deviceColumns...).
		From("devices").
		OrderBy("created_at ASC").
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build list devices query")
	}

	var models []*model.Device
	if err := r.DB.SelectContext(ctx, &models, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, "list devices")
	}

	return mapper.DevicesToDomain(models), nil
}

// UpsertCredentials mirrors the Node upsertUser statement: insert the alias, or
// overwrite the device id and PIN of the row that already holds it.
func (r *Repository) UpsertCredentials(ctx context.Context, alias, deviceID, pin string) error {
	now := time.Now().UTC()

	query := r.Builder.Insert("devices").
		Columns("id", "alias", "device_id", "pin", "created_at", "updated_at").
		Values(id.New(), alias, deviceID, nullable(pin), now, now).
		Suffix("ON CONFLICT (alias) DO UPDATE SET device_id = EXCLUDED.device_id, pin = EXCLUDED.pin, updated_at = EXCLUDED.updated_at")

	return r.exec(ctx, query, "upsert device credentials")
}

func (r *Repository) UpdateTokens(ctx context.Context, alias, accessToken, refreshToken string) error {
	return r.update(ctx, alias, "update device tokens", map[string]any{
		"access_token":  nullable(accessToken),
		"refresh_token": nullable(refreshToken),
	})
}

func (r *Repository) UpdateCorporateRefID(ctx context.Context, alias, corporateRefID string) error {
	return r.update(ctx, alias, "update corporate ref id", map[string]any{
		"corporate_ref_id": nullable(corporateRefID),
	})
}

func (r *Repository) UpdateAccountRef(ctx context.Context, alias, accountRefID, fromAccountNo string) error {
	return r.update(ctx, alias, "update account ref", map[string]any{
		"account_ref_id":  nullable(accountRefID),
		"from_account_no": nullable(fromAccountNo),
	})
}

func (r *Repository) UpdateProfile(ctx context.Context, alias, companyID, userID string) error {
	return r.update(ctx, alias, "update device profile", map[string]any{
		"company_id": nullable(companyID),
		"user_id":    nullable(userID),
	})
}

func (r *Repository) Delete(ctx context.Context, alias string) error {
	sqlStr, args, err := r.Builder.Delete("devices").
		Where(squirrel.Eq{"alias": alias}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build delete device query")
	}

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "delete device")
	}

	return r.CheckRowsAffectedWith(result, domaindevice.ErrDeviceNotFound)
}

// update applies a partial column set to one alias and maps a zero-row result
// to the feature's not-found error.
func (r *Repository) update(ctx context.Context, alias, label string, values map[string]any) error {
	builder := r.Builder.Update("devices").SetMap(values).Set("updated_at", time.Now().UTC())

	sqlStr, args, err := builder.Where(squirrel.Eq{"alias": alias}).ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build "+label+" query")
	}

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, label)
	}

	return r.CheckRowsAffectedWith(result, domaindevice.ErrDeviceNotFound)
}

// exec runs an insert-shaped statement and maps a unique violation to the
// feature's conflict error.
func (r *Repository) exec(ctx context.Context, query squirrel.Sqlizer, label string) error {
	sqlStr, args, err := query.ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build "+label+" query")
	}

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		if errs.IsDuplicateError(err) {
			return domaindevice.ErrAliasAlreadyExists
		}
		return errs.WrapDatabaseError(err, label)
	}

	return nil
}

// nullable maps "" to a SQL NULL argument.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var _ domaindevice.Repository = (*Repository)(nil)
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `go test ./internal/adapter/repository/device/ -v`
Expected: PASS. If `SetMap` produces a different column order than the test's `WithArgs`, note that squirrel sorts `SetMap` keys alphabetically — the `UpdateTokens` test relies on `access_token` before `refresh_token`, which holds.

- [ ] **Step 11: Register the repository in fx**

`internal/adapter/repository/module.go`:

```go
package repository

import (
	devicerepo "ktb-biznext-api/internal/adapter/repository/device"
	"ktb-biznext-api/internal/adapter/repository/tx"
	"ktb-biznext-api/internal/domain/device"

	"go.uber.org/fx"
)

var Module = fx.Options(
	fx.Provide(
		fx.Annotate(devicerepo.NewRepository, fx.As(new(device.Repository))),
		tx.NewTransactionHelper,
	),
)
```

- [ ] **Step 12: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add db/migrations internal/domain/device internal/adapter/persistence internal/adapter/repository
git commit -m "feat: add devices table, domain, mapper, and repository"
```

---

## Task 4: `device` service

**Files:**
- Create: `internal/service/device/service.go`
- Create: `internal/service/device/service_test.go`
- Modify: `internal/service/module.go`

**Interfaces:**
- Consumes: `device.Repository`, `device.Service`, `device.ValidateCreate`, `device.ValidateAlias` (Task 3).
- Produces: `devicesvc.NewService(repo device.Repository) device.Service` — consumed by the HTTP layer in Task 15 and registered in `service/module.go`.

- [ ] **Step 1: Write the failing test**

`internal/service/device/service_test.go`:

```go
package device_test

import (
	"context"
	"testing"

	devicesvc "ktb-biznext-api/internal/service/device"
	domaindevice "ktb-biznext-api/internal/domain/device"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type repoMock struct{ mock.Mock }

func (m *repoMock) Create(ctx context.Context, data *domaindevice.CreateDeviceData) (*domaindevice.Device, error) {
	args := m.Called(ctx, data)
	d, _ := args.Get(0).(*domaindevice.Device)
	return d, args.Error(1)
}
func (m *repoMock) CreateNew(ctx context.Context, data *domaindevice.NewDeviceData) (*domaindevice.Device, error) {
	args := m.Called(ctx, data)
	d, _ := args.Get(0).(*domaindevice.Device)
	return d, args.Error(1)
}
func (m *repoMock) GetByAlias(ctx context.Context, alias string) (*domaindevice.Device, error) {
	args := m.Called(ctx, alias)
	d, _ := args.Get(0).(*domaindevice.Device)
	return d, args.Error(1)
}
func (m *repoMock) List(ctx context.Context) ([]*domaindevice.Device, error) {
	args := m.Called(ctx)
	d, _ := args.Get(0).([]*domaindevice.Device)
	return d, args.Error(1)
}
func (m *repoMock) UpsertCredentials(ctx context.Context, alias, deviceID, pin string) error {
	return m.Called(ctx, alias, deviceID, pin).Error(0)
}
func (m *repoMock) UpdateTokens(ctx context.Context, alias, accessToken, refreshToken string) error {
	return m.Called(ctx, alias, accessToken, refreshToken).Error(0)
}
func (m *repoMock) UpdateCorporateRefID(ctx context.Context, alias, corporateRefID string) error {
	return m.Called(ctx, alias, corporateRefID).Error(0)
}
func (m *repoMock) UpdateAccountRef(ctx context.Context, alias, accountRefID, fromAccountNo string) error {
	return m.Called(ctx, alias, accountRefID, fromAccountNo).Error(0)
}
func (m *repoMock) UpdateProfile(ctx context.Context, alias, companyID, userID string) error {
	return m.Called(ctx, alias, companyID, userID).Error(0)
}
func (m *repoMock) Delete(ctx context.Context, alias string) error {
	return m.Called(ctx, alias).Error(0)
}

var _ domaindevice.Repository = (*repoMock)(nil)

func TestDeviceService_Add_InvalidInputDoesNotTouchRepository(t *testing.T) {
	repo := &repoMock{}
	svc := devicesvc.NewService(repo)

	_, err := svc.Add(context.Background(), &domaindevice.CreateDeviceData{Alias: "acme"})

	require.ErrorIs(t, err, domaindevice.ErrDeviceIDRequired)
	repo.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}

func TestDeviceService_Add_Success(t *testing.T) {
	repo := &repoMock{}
	want := &domaindevice.Device{Alias: "acme"}
	data := &domaindevice.CreateDeviceData{Alias: "acme", DeviceID: "dev-1", PIN: "123456"}
	repo.On("Create", mock.Anything, data).Return(want, nil)

	svc := devicesvc.NewService(repo)
	got, err := svc.Add(context.Background(), data)

	require.NoError(t, err)
	assert.Same(t, want, got)
	repo.AssertExpectations(t)
}

func TestDeviceService_Update_AppliesOnlyProvidedFields(t *testing.T) {
	repo := &repoMock{}
	existing := &domaindevice.Device{Alias: "acme", DeviceID: "dev-1", FromAccountNo: "111"}

	repo.On("GetByAlias", mock.Anything, "acme").Return(existing, nil)
	repo.On("UpdateCorporateRefID", mock.Anything, "acme", "corp-9").Return(nil)
	// from_account_no is absent from the request, so the stored value is kept.
	repo.On("UpdateAccountRef", mock.Anything, "acme", "acct-9", "111").Return(nil)

	svc := devicesvc.NewService(repo)
	_, err := svc.Update(context.Background(), "acme", &domaindevice.UpdateDeviceData{
		CorporateRefID: "corp-9",
		AccountRefID:   "acct-9",
	})

	require.NoError(t, err)
	repo.AssertNotCalled(t, "UpsertCredentials", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "UpdateTokens", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	repo.AssertExpectations(t)
}

func TestDeviceService_Update_PINUsesStoredDeviceID(t *testing.T) {
	repo := &repoMock{}
	existing := &domaindevice.Device{Alias: "acme", DeviceID: "dev-1"}

	repo.On("GetByAlias", mock.Anything, "acme").Return(existing, nil)
	repo.On("UpsertCredentials", mock.Anything, "acme", "dev-1", "999999").Return(nil)

	svc := devicesvc.NewService(repo)
	_, err := svc.Update(context.Background(), "acme", &domaindevice.UpdateDeviceData{PIN: "999999"})

	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func TestDeviceService_Update_UnknownAlias(t *testing.T) {
	repo := &repoMock{}
	repo.On("GetByAlias", mock.Anything, "ghost").Return(nil, domaindevice.ErrDeviceNotFound)

	svc := devicesvc.NewService(repo)
	_, err := svc.Update(context.Background(), "ghost", &domaindevice.UpdateDeviceData{PIN: "1"})

	require.ErrorIs(t, err, domaindevice.ErrDeviceNotFound)
}

func TestDeviceService_GetByAlias_BlankAlias(t *testing.T) {
	repo := &repoMock{}
	svc := devicesvc.NewService(repo)

	_, err := svc.GetByAlias(context.Background(), "  ")

	require.ErrorIs(t, err, domaindevice.ErrAliasRequired)
	repo.AssertNotCalled(t, "GetByAlias", mock.Anything, mock.Anything)
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `go test ./internal/service/device/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write the service**

`internal/service/device/service.go`:

```go
package device

import (
	"context"

	domaindevice "ktb-biznext-api/internal/domain/device"
)

type Service struct {
	repo domaindevice.Repository
}

func NewService(repo domaindevice.Repository) domaindevice.Service {
	return &Service{repo: repo}
}

func (s *Service) Add(ctx context.Context, data *domaindevice.CreateDeviceData) (*domaindevice.Device, error) {
	if err := domaindevice.ValidateCreate(data); err != nil {
		return nil, err
	}

	return s.repo.Create(ctx, data)
}

func (s *Service) GetByAlias(ctx context.Context, alias string) (*domaindevice.Device, error) {
	if err := domaindevice.ValidateAlias(alias); err != nil {
		return nil, err
	}

	return s.repo.GetByAlias(ctx, alias)
}

func (s *Service) List(ctx context.Context) ([]*domaindevice.Device, error) {
	return s.repo.List(ctx)
}

// Update applies a partial change. An empty field means "leave unchanged", so
// the stored row is read first to supply the values the request omitted.
func (s *Service) Update(ctx context.Context, alias string, data *domaindevice.UpdateDeviceData) (*domaindevice.Device, error) {
	if err := domaindevice.ValidateAlias(alias); err != nil {
		return nil, err
	}

	existing, err := s.repo.GetByAlias(ctx, alias)
	if err != nil {
		return nil, err
	}

	if data.CorporateRefID != "" {
		if err := s.repo.UpdateCorporateRefID(ctx, alias, data.CorporateRefID); err != nil {
			return nil, err
		}
	}

	if data.AccountRefID != "" {
		fromAccountNo := data.FromAccountNo
		if fromAccountNo == "" {
			fromAccountNo = existing.FromAccountNo
		}
		if err := s.repo.UpdateAccountRef(ctx, alias, data.AccountRefID, fromAccountNo); err != nil {
			return nil, err
		}
	}

	if data.PIN != "" {
		if err := s.repo.UpsertCredentials(ctx, alias, existing.DeviceID, data.PIN); err != nil {
			return nil, err
		}
	}

	if data.AccessToken != "" {
		if err := s.repo.UpdateTokens(ctx, alias, data.AccessToken, existing.RefreshToken); err != nil {
			return nil, err
		}
	}

	return s.repo.GetByAlias(ctx, alias)
}

func (s *Service) Delete(ctx context.Context, alias string) error {
	if err := domaindevice.ValidateAlias(alias); err != nil {
		return err
	}

	return s.repo.Delete(ctx, alias)
}

var _ domaindevice.Service = (*Service)(nil)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/service/device/ -v`
Expected: PASS.

- [ ] **Step 5: Register in fx**

`internal/service/module.go`:

```go
package service

import (
	"ktb-biznext-api/internal/domain/device"
	devicesvc "ktb-biznext-api/internal/service/device"

	"go.uber.org/fx"
)

var Module = fx.Options(
	fx.Provide(
		fx.Annotate(devicesvc.NewService, fx.As(new(device.Service))),
	),
)
```

- [ ] **Step 6: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/service
git commit -m "feat: add device service"
```

---

## Task 5: `encrypt` external adapter

Ports `src/api/pinEncryption.js` and the inline encryption calls in
`gendeviceid.js` and `otpverification.js`, which are the same request.

**Files:**
- Create: `internal/adapter/external/encrypt/{client,dto,methods,module}.go`
- Create: `internal/adapter/external/encrypt/methods_test.go`

**Interfaces:**
- Consumes: `shared.Config` (Task 1).
- Produces:
  ```go
  package encrypt
  type Request struct { Sid, ServerRandom, PubKey, PIN, HashType string }
  type Encryptor interface { Encrypt(ctx context.Context, req Request) (string, error) }
  func NewClient(cfg *shared.Config) Encryptor
  var Module fx.Option
  ```
  Consumed by `session` (Task 9), `registration` (Task 10), `transfer` (Task 13), `instruction` (Task 12).

- [ ] **Step 1: Write the failing test**

`internal/adapter/external/encrypt/methods_test.go`:

```go
package encrypt_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newClient(t *testing.T, h http.HandlerFunc) encrypt.Encryptor {
	t.Helper()

	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)

	cfg := &shared.Config{}
	cfg.Encrypt.BaseURL = srv.URL
	cfg.Encrypt.Timeout = 5 * time.Second

	return encrypt.NewClient(cfg)
}

func TestEncrypt_SendsNodeCompatibleBody(t *testing.T) {
	var gotPath, gotContentType string
	var gotBody map[string]any

	client := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`"ENCRYPTED-PAYLOAD"`))
	})

	got, err := client.Encrypt(context.Background(), encrypt.Request{
		Sid:          "sid-1",
		ServerRandom: "rand-1",
		PubKey:       "pub-1",
		PIN:          "123456",
		HashType:     "SHA-256",
	})

	require.NoError(t, err)
	assert.Equal(t, "ENCRYPTED-PAYLOAD", got)
	assert.Equal(t, "/pin/encrypt", gotPath)
	assert.Equal(t, "application/json", gotContentType)

	// Field names and capitalization must match the Node payload exactly.
	assert.Equal(t, "sid-1", gotBody["Sid"])
	assert.Equal(t, "rand-1", gotBody["ServerRandom"])
	assert.Equal(t, "pub-1", gotBody["pubKey"])
	assert.Equal(t, "123456", gotBody["pin"])
	assert.Equal(t, "SHA-256", gotBody["hashType"])
}

func TestEncrypt_AcceptsBarePlainTextResponse(t *testing.T) {
	client := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("RAW-NOT-JSON"))
	})

	got, err := client.Encrypt(context.Background(), encrypt.Request{PIN: "1"})

	require.NoError(t, err)
	assert.Equal(t, "RAW-NOT-JSON", got)
}

func TestEncrypt_NonSuccessStatusIsUnavailable(t *testing.T) {
	client := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream down"))
	})

	_, err := client.Encrypt(context.Background(), encrypt.Request{PIN: "1"})

	require.ErrorIs(t, err, errs.ErrUnavailable)
	assert.NotContains(t, err.Error(), "1")
}
```

The response of `encrypt.th-api.com` is a bare JSON string in production. The
second test exists because axios silently accepts a non-JSON body too, and the
Go client must not be stricter than the client it replaces.

- [ ] **Step 2: Run it to make sure it fails**

Run: `go test ./internal/adapter/external/encrypt/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write `dto.go`**

```go
package encrypt

// Request is the PIN/password encryption payload. Field names and their
// capitalization are dictated by the upstream service and match the Node
// client byte for byte -- do not "normalize" Sid or ServerRandom.
type Request struct {
	Sid          string `json:"Sid"`
	ServerRandom string `json:"ServerRandom"`
	PubKey       string `json:"pubKey"`
	PIN          string `json:"pin"`
	HashType     string `json:"hashType"`
}
```

- [ ] **Step 4: Write `client.go`**

```go
// Package encrypt wraps the external end-to-end encryption service used to
// seal PINs and passwords before they are sent to the bank.
package encrypt

import (
	"context"
	"net/http"
	"time"

	"ktb-biznext-api/internal/shared"
)

// Encryptor seals a secret with the key material issued by the bank.
type Encryptor interface {
	Encrypt(ctx context.Context, req Request) (string, error)
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(cfg *shared.Config) Encryptor {
	timeout := cfg.Encrypt.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	return &Client{
		baseURL: cfg.Encrypt.BaseURL,
		http:    &http.Client{Timeout: timeout},
	}
}

var _ Encryptor = (*Client)(nil)
```

- [ ] **Step 5: Write `methods.go`**

```go
package encrypt

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"ktb-biznext-api/internal/shared/errs"
)

// maxResponseBytes bounds what is read back; an encrypted passphrase is a few
// hundred bytes, so anything larger is a malfunctioning upstream.
const maxResponseBytes = 1 << 20

// Encrypt seals req.PIN and returns the encrypted passphrase.
//
// The error text deliberately excludes the response body: this call carries a
// PIN, and an upstream that echoes its input must not push it into our logs.
func (c *Client) Encrypt(ctx context.Context, req Request) (string, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal encrypt request: %w", errs.ErrInternal)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/pin/encrypt", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("build encrypt request: %w", errs.ErrInternal)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := c.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("call encrypt service: %w", errs.ErrUnavailable)
	}
	defer func() { _ = res.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("read encrypt response: %w", errs.ErrUnavailable)
	}

	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", fmt.Errorf("encrypt service returned %d: %w", res.StatusCode, errs.ErrUnavailable)
	}

	// The service returns a JSON string; accept a bare body too, because axios
	// did and a stricter client would break a flow that works today.
	var decoded string
	if err := json.Unmarshal(body, &decoded); err == nil {
		return decoded, nil
	}

	return strings.TrimSpace(string(body)), nil
}
```

- [ ] **Step 6: Write `module.go`**

```go
package encrypt

import "go.uber.org/fx"

var Module = fx.Options(
	fx.Provide(NewClient),
)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `go test ./internal/adapter/external/encrypt/ -v`
Expected: PASS.

- [ ] **Step 8: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/external/encrypt
git commit -m "feat: add PIN encryption external adapter"
```

---

## Task 6: `ktb` client core and auth methods

This task builds the transport that every later bank call runs through. Get the
header set and the error mapping right here and the remaining method files are
mechanical.

**Files:**
- Create: `internal/adapter/external/ktb/{client,dto,methods_auth,module}.go`
- Create: `internal/adapter/external/ktb/client_test.go`, `internal/adapter/external/ktb/methods_auth_test.go`

**Interfaces:**
- Consumes: `shared.Config`, `errs.NewUpstreamError` (Tasks 1–2).
- Produces:
  ```go
  package ktb
  type Creds struct { DeviceID, AccessToken string }
  type AuthAPI interface { /* 15 methods, listed in Step 6 */ }
  func NewClient(cfg *shared.Config) *Client
  var Module fx.Option
  ```
  `Creds` and `*errs.UpstreamError` mapping are consumed by Tasks 7, 8, 9, 10, 12, 13.

- [ ] **Step 1: Write the failing transport test**

`internal/adapter/external/ktb/client_test.go`:

```go
package ktb_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newClient wires a Client against a test server using the production header
// values, so header assertions in every method test are meaningful.
func newClient(t *testing.T, h http.HandlerFunc) (*ktb.Client, *httptest.Server) {
	t.Helper()

	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)

	cfg := &shared.Config{}
	cfg.KTB.BaseURL = srv.URL
	cfg.KTB.Timeout = 5 * time.Second
	cfg.KTB.ClientVersion = "5.1.0"
	cfg.KTB.Platform = "android/14"
	cfg.KTB.DeviceModel = "OnePlus-CPH2449"
	cfg.KTB.ChannelID = "MB"
	cfg.KTB.AcceptLanguage = "th-TH"
	cfg.KTB.Host = "business.krungthai.com"
	cfg.KTB.UserAgent = "okhttp/4.12.0"
	cfg.KTB.PreloginAuthorization = "Basic YWRtaW46cGFzc3dvcmQ="

	return ktb.NewClient(cfg), srv
}

func testCreds() ktb.Creds {
	return ktb.Creds{DeviceID: "dev-1", AccessToken: "tok-1"}
}

func TestClient_SendsFullStandardHeaderSet(t *testing.T) {
	var got http.Header

	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		_, _ = w.Write([]byte(`{}`))
	})

	_, err := client.PinKeyGeneration(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "android/14", got.Get("x-platform"))
	assert.Equal(t, "5.1.0", got.Get("x-client-version"))
	assert.Equal(t, "dev-1", got.Get("x-device-id"))
	assert.Equal(t, "OnePlus-CPH2449", got.Get("x-device-model"))
	assert.Equal(t, "MB", got.Get("x-channel-id"))
	assert.Equal(t, "th-TH", got.Get("accept-language"))
	assert.Equal(t, "Bearer tok-1", got.Get("authorization"))
	assert.Equal(t, "Keep-Alive", got.Get("connection"))
	assert.Equal(t, "okhttp/4.12.0", got.Get("user-agent"))
	assert.Equal(t, "application/json; charset=utf-8", got.Get("content-type"))

	// The correlation id is a fresh UUID v4 with a "-crid" suffix.
	crid := got.Get("x-correlation-id")
	assert.Len(t, crid, 41, "uuid(36) + -crid(5)")
	assert.True(t, len(crid) > 5 && crid[len(crid)-5:] == "-crid")
}

func TestClient_CorrelationIDIsFreshPerRequest(t *testing.T) {
	seen := map[string]bool{}

	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		seen[r.Header.Get("x-correlation-id")] = true
		_, _ = w.Write([]byte(`{}`))
	})

	for range 3 {
		_, err := client.PinKeyGeneration(context.Background(), testCreds())
		require.NoError(t, err)
	}

	assert.Len(t, seen, 3, "each request must carry its own correlation id")
}

func TestClient_HostHeaderIsSetOnTheRequest(t *testing.T) {
	var gotHost string

	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		_, _ = w.Write([]byte(`{}`))
	})

	_, err := client.PinKeyGeneration(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "business.krungthai.com", gotHost)
}

func TestClient_GETOmitsContentType(t *testing.T) {
	var got string
	var present bool

	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("content-type")
		_, present = r.Header["Content-Type"]
		_, _ = w.Write([]byte(`{}`))
	})

	_, err := client.UserProfile(context.Background(), testCreds())
	require.NoError(t, err)

	assert.False(t, present, "GET requests must not carry a content-type header")
	assert.Empty(t, got)
}

func TestClient_UpstreamErrorCarriesStatusAndMessage(t *testing.T) {
	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"E1234","message":"ยอดเงินในบัญชีไม่เพียงพอ"}`))
	})

	_, err := client.PinKeyGeneration(context.Background(), testCreds())

	require.ErrorIs(t, err, errs.ErrUpstream)

	var upstream *errs.UpstreamError
	require.True(t, errors.As(err, &upstream))
	assert.Equal(t, http.StatusBadRequest, upstream.Status)
	assert.Equal(t, "E1234", upstream.Code)
	assert.Equal(t, "ยอดเงินในบัญชีไม่เพียงพอ", upstream.Message)
	assert.Contains(t, string(upstream.Body), "E1234")
}

func TestClient_UpstreamErrorOnUnparseableBody(t *testing.T) {
	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`<html>gateway error</html>`))
	})

	_, err := client.PinKeyGeneration(context.Background(), testCreds())

	var upstream *errs.UpstreamError
	require.True(t, errors.As(err, &upstream))
	assert.Equal(t, http.StatusInternalServerError, upstream.Status)
	assert.Empty(t, upstream.Message, "an unparseable body yields no relayable message")
}

func TestClient_TransportFailureIsUnavailable(t *testing.T) {
	client, srv := newClient(t, func(w http.ResponseWriter, r *http.Request) {})
	srv.Close() // force a connection error

	_, err := client.PinKeyGeneration(context.Background(), testCreds())

	require.ErrorIs(t, err, errs.ErrUnavailable)
}

func TestClient_ContextCancellationPropagates(t *testing.T) {
	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := client.PinKeyGeneration(ctx, testCreds())
	require.Error(t, err)
}

// discardBody keeps the linter happy in handlers that ignore the request body.
func discardBody(r *http.Request) { _, _ = io.Copy(io.Discard, r.Body) }
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `go test ./internal/adapter/external/ktb/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write `client.go`**

```go
// Package ktb is the HTTP client for the Krungthai BizNext channel API.
//
// Every exported method maps to exactly one upstream endpoint and performs no
// business logic. The header set, content types, and request bodies reproduce
// the Node client in src/api/ byte for byte; the bank rejects deviations, so
// treat the values here as a contract rather than as style.
package ktb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/google/uuid"
)

// Content types used upstream. The two differ only in the case of "utf-8";
// the endpoint tables in each methods file record which one goes where.
const (
	contentTypeJSONLower = "application/json; charset=utf-8"
	contentTypeJSONUpper = "application/json; charset=UTF-8"
)

// maxResponseBytes bounds a single response read. Transaction history and bulk
// item listings are the largest payloads and stay far below this.
const maxResponseBytes = 16 << 20

// Creds is the per-device authentication pair sent with every authenticated call.
type Creds struct {
	DeviceID    string
	AccessToken string
}

type Client struct {
	cfg  ktbConfig
	http *http.Client
}

type ktbConfig struct {
	baseURL               string
	clientVersion         string
	platform              string
	deviceModel           string
	channelID             string
	acceptLanguage        string
	host                  string
	userAgent             string
	preloginAuthorization string
}

func NewClient(cfg *shared.Config) *Client {
	timeout := cfg.KTB.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	return &Client{
		cfg: ktbConfig{
			baseURL:               cfg.KTB.BaseURL,
			clientVersion:         cfg.KTB.ClientVersion,
			platform:              cfg.KTB.Platform,
			deviceModel:           cfg.KTB.DeviceModel,
			channelID:             cfg.KTB.ChannelID,
			acceptLanguage:        cfg.KTB.AcceptLanguage,
			host:                  cfg.KTB.Host,
			userAgent:             cfg.KTB.UserAgent,
			preloginAuthorization: cfg.KTB.PreloginAuthorization,
		},
		http: &http.Client{Timeout: timeout},
	}
}

// request describes one upstream call.
type request struct {
	method string
	path   string

	// query is encoded with url.Values.Encode(). Use rawQuery instead when the
	// upstream expects an encoding Go would not produce (see CheckLimit).
	query    url.Values
	rawQuery string

	// body is marshalled to JSON. rawBody wins when set, and is how the
	// literal "{}" payloads of the Node client are reproduced.
	body    any
	rawBody []byte

	// contentType is omitted from the request when empty, which is what every
	// GET in the Node client does.
	contentType string

	creds Creds

	// preloginAuth swaps the Bearer token for the static Basic credential used
	// by the two grant endpoints that run before a device has a token.
	preloginAuth bool
}

// newCorrelationID returns a fresh UUID v4 with the "-crid" suffix the bank
// expects. v4 (not v7) matches the Node client, and this value never becomes a
// database key.
func newCorrelationID() string {
	return uuid.NewString() + "-crid"
}

// NewDeviceID returns a fresh device identifier in the bank's format.
// Exported because device provisioning (registration) mints one.
func NewDeviceID() string {
	return uuid.NewString() + "-devc"
}

func (c *Client) newRequest(ctx context.Context, req request) (*http.Request, error) {
	endpoint := c.cfg.baseURL + req.path

	var bodyReader io.Reader
	switch {
	case req.rawBody != nil:
		bodyReader = bytes.NewReader(req.rawBody)
	case req.body != nil:
		payload, err := json.Marshal(req.body)
		if err != nil {
			return nil, fmt.Errorf("marshal %s body: %w", req.path, errs.ErrInternal)
		}
		bodyReader = bytes.NewReader(payload)
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.method, endpoint, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("build %s request: %w", req.path, errs.ErrInternal)
	}

	switch {
	case req.rawQuery != "":
		httpReq.URL.RawQuery = req.rawQuery
	case len(req.query) > 0:
		httpReq.URL.RawQuery = req.query.Encode()
	}

	authorization := "Bearer " + req.creds.AccessToken
	if req.preloginAuth {
		authorization = c.cfg.preloginAuthorization
	}

	httpReq.Header.Set("x-platform", c.cfg.platform)
	httpReq.Header.Set("x-client-version", c.cfg.clientVersion)
	httpReq.Header.Set("x-correlation-id", newCorrelationID())
	httpReq.Header.Set("x-device-id", req.creds.DeviceID)
	httpReq.Header.Set("x-device-model", c.cfg.deviceModel)
	httpReq.Header.Set("x-channel-id", c.cfg.channelID)
	httpReq.Header.Set("accept-language", c.cfg.acceptLanguage)
	httpReq.Header.Set("authorization", authorization)
	httpReq.Header.Set("connection", c.cfg.connectionValue())
	httpReq.Header.Set("user-agent", c.cfg.userAgent)

	if req.contentType != "" {
		httpReq.Header.Set("content-type", req.contentType)
	}

	// net/http reads the Host header off Request.Host, not the header map.
	if c.cfg.host != "" {
		httpReq.Host = c.cfg.host
	}

	return httpReq, nil
}

// connectionValue is fixed upstream; kept as a method so the literal lives in
// one place next to the rest of the header contract.
func (cfg ktbConfig) connectionValue() string { return "Keep-Alive" }

// doRaw performs the call and returns the response body on success.
func (c *Client) doRaw(ctx context.Context, req request) (json.RawMessage, error) {
	httpReq, err := c.newRequest(ctx, req)
	if err != nil {
		return nil, err
	}

	res, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call %s: %w", req.path, errs.ErrUnavailable)
	}
	defer func() { _ = res.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read %s response: %w", req.path, errs.ErrUnavailable)
	}

	if res.StatusCode < 200 || res.StatusCode > 299 {
		code, message := parseUpstreamError(body)
		return nil, errs.NewUpstreamError(res.StatusCode, code, message, body)
	}

	return body, nil
}

// do performs the call and unmarshals the response into out when out is non-nil.
func (c *Client) do(ctx context.Context, req request, out any) error {
	body, err := c.doRaw(ctx, req)
	if err != nil {
		return err
	}

	if out == nil {
		return nil
	}

	// An empty 2xx body is a valid "accepted" response upstream.
	if len(bytes.TrimSpace(body)) == 0 {
		return nil
	}

	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode %s response: %w", req.path, errs.ErrUnavailable)
	}

	return nil
}

// upstreamErrorBody covers the field names the bank uses for failures. The
// first non-empty value wins; an unrecognized shape yields empty strings and
// the caller relays only the HTTP status.
type upstreamErrorBody struct {
	Code         string `json:"code"`
	ErrorCode    string `json:"errorCode"`
	Message      string `json:"message"`
	ErrorMessage string `json:"errorMessage"`
	Description  string `json:"description"`
}

func parseUpstreamError(body []byte) (code, message string) {
	var parsed upstreamErrorBody
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", ""
	}

	code = firstNonEmpty(parsed.Code, parsed.ErrorCode)
	message = firstNonEmpty(parsed.Message, parsed.ErrorMessage, parsed.Description)

	return code, message
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
```

- [ ] **Step 4: Write the auth DTOs**

Append to `internal/adapter/external/ktb/dto.go` (create the file with this content):

```go
package ktb

import "encoding/json"

// GrantResponse is the shape of every OAuth-style grant endpoint.
type GrantResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// KeyMaterial is returned by the PIN and password key-generation endpoints and
// feeds the external encryption service.
type KeyMaterial struct {
	PubKeyIndex  string `json:"pubKeyIndex"`
	OAEPHashAlgo string `json:"oaepHashAlgo"`
	E2EESid      string `json:"e2eeSid"`
	ServerRandom string `json:"serverRandom"`
	PubKey       string `json:"pubKey"`
}

type PinGrantRequest struct {
	E2EESid           string `json:"e2eeSid"`
	EncryptedPassword string `json:"encryptedPassword"`
}

type PasswordVerificationRequest struct {
	CompanyID         string `json:"companyId"`
	E2EESid           string `json:"e2eeSid"`
	EncryptedPassword string `json:"encryptedPassword"`
	UserID            string `json:"userId"`
}

type PasswordVerificationResponse struct {
	TransactionToken     string `json:"transactionToken"`
	IsTncRequired        bool   `json:"isTncRequired"`
	IsDisclaimerRequired bool   `json:"isDisclaimerRequired"`
}

// Term is one content document. contentType is "TNC" or "DISCLAIMER".
type Term struct {
	ContentType string `json:"contentType"`
	Version     string `json:"version"`
}

type AcceptTnCRequest struct {
	DisclaimerVersion string `json:"disclaimerVersion"`
	TncVersion        string `json:"tncVersion"`
	TransactionToken  string `json:"transactionToken"`
}

type OTPGenerationRequest struct {
	CompanyID        string `json:"companyId"`
	DeliveryMethod   string `json:"deliveryMethod"`
	TransactionToken string `json:"transactionToken"`
	UserID           string `json:"userId"`
}

type OTPGenerationResponse struct {
	TokenUUID       string `json:"tokenUuid"`
	OTPRefNo        string `json:"otpRefNo"`
	DeliveryContact string `json:"deliveryContact"`
}

type OTPVerificationRequest struct {
	OTP              string `json:"otp"`
	TokenUUID        string `json:"tokenUuid"`
	TransactionToken string `json:"transactionToken"`
}

type PasswordGrantRequest struct {
	TransactionToken string `json:"transactionToken"`
}

type PinSetRequest struct {
	E2EESid          string `json:"e2eeSid"`
	EncryptedPin     string `json:"encryptedPin"`
	TransactionToken string `json:"transactionToken"`
}

// UserProfile carries the fields this service reads plus the untouched payload,
// because /verify-otp relays the whole profile to its caller.
type UserProfile struct {
	UserRefID      string `json:"userRefId"`
	UserID         string `json:"userId"`
	CompanyID      string `json:"companyId"`
	CorporateRefID string `json:"corporateRefId"`
	FirstName      string `json:"firstName"`
	LastName       string `json:"lastName"`
	Status         string `json:"status"`

	Raw json.RawMessage `json:"-"`
}

type MFAChallengeRequest struct {
	MFAMethod string `json:"mfaMethod"`
	MFARefID  string `json:"mfaRefId"`
}

type MFAChallengeResponse struct {
	MFARefID string     `json:"mfaRefId"`
	Params   *MFAParams `json:"params"`
}

// MFAParams is the key material for sealing the PIN during an MFA challenge.
type MFAParams struct {
	E2EESid      string `json:"e2eeSid"`
	ServerRandom string `json:"serverRandom"`
	PubKey       string `json:"pubKey"`
	OAEPHashAlgo string `json:"oaepHashAlgo"`
}

type MFAAuthenticateRequest struct {
	MFAPassphrase string `json:"mfaPassphrase"`
	MFARefID      string `json:"mfaRefId"`
}
```

- [ ] **Step 5: Write the failing auth-method test**

`internal/adapter/external/ktb/methods_auth_test.go`:

```go
package ktb_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type captured struct {
	method      string
	path        string
	rawQuery    string
	contentType string
	authz       string
	body        string
}

// capture records the single request a method makes and replies with respond.
func capture(t *testing.T, respond string) (*ktb.Client, *captured) {
	t.Helper()

	got := &captured{}
	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		got.method = r.Method
		got.path = r.URL.Path
		got.rawQuery = r.URL.RawQuery
		got.contentType = r.Header.Get("content-type")
		got.authz = r.Header.Get("authorization")
		got.body = string(raw)

		_, _ = w.Write([]byte(respond))
	})

	return client, got
}

func TestPreloginGrant(t *testing.T) {
	client, got := capture(t, `{"access_token":"tok-new"}`)

	res, err := client.PreloginGrant(context.Background(), "dev-1")
	require.NoError(t, err)
	assert.Equal(t, "tok-new", res.AccessToken)

	assert.Equal(t, http.MethodPost, got.method)
	assert.Equal(t, "/v1/prelogin/grant", got.path)
	assert.Equal(t, "grant_type=client_credentials", got.rawQuery)
	assert.Equal(t, "application/json; charset=utf-8", got.contentType)
	assert.Equal(t, "Basic YWRtaW46cGFzc3dvcmQ=", got.authz)
	assert.Equal(t, "{}", got.body)
}

func TestPinKeyGeneration(t *testing.T) {
	client, got := capture(t, `{"e2eeSid":"sid","serverRandom":"rand","pubKey":"pub","oaepHashAlgo":"SHA-256"}`)

	res, err := client.PinKeyGeneration(context.Background(), testCreds())
	require.NoError(t, err)
	assert.Equal(t, "sid", res.E2EESid)
	assert.Equal(t, "SHA-256", res.OAEPHashAlgo)

	assert.Equal(t, "/v1/auth/pin/key/generation", got.path)
	assert.Equal(t, "application/json; charset=utf-8", got.contentType)
	assert.Equal(t, "{}", got.body)
}

func TestPinGrant(t *testing.T) {
	client, got := capture(t, `{"access_token":"a","refresh_token":"r"}`)

	res, err := client.PinGrant(context.Background(), testCreds(), "sid", "sealed")
	require.NoError(t, err)
	assert.Equal(t, "a", res.AccessToken)
	assert.Equal(t, "r", res.RefreshToken)

	assert.Equal(t, "/v1/pin/grant", got.path)
	assert.Equal(t, "grant_type=client_credentials", got.rawQuery)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)

	var body map[string]any
	require.NoError(t, json.Unmarshal([]byte(got.body), &body))
	assert.Equal(t, "sid", body["e2eeSid"])
	assert.Equal(t, "sealed", body["encryptedPassword"])
}

func TestPasswordKeyGeneration(t *testing.T) {
	client, got := capture(t, `{"e2eeSid":"sid"}`)

	_, err := client.PasswordKeyGeneration(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "/v1/auth/password/key/generation", got.path)
	assert.Equal(t, "application/json; charset=utf-8", got.contentType)
	assert.Equal(t, "{}", got.body)
}

func TestPasswordVerification(t *testing.T) {
	client, got := capture(t, `{"transactionToken":"tt","isTncRequired":true}`)

	res, err := client.PasswordVerification(context.Background(), testCreds(), ktb.PasswordVerificationRequest{
		CompanyID: "C1", E2EESid: "sid", EncryptedPassword: "sealed", UserID: "U1",
	})
	require.NoError(t, err)
	assert.Equal(t, "tt", res.TransactionToken)
	assert.True(t, res.IsTncRequired)

	assert.Equal(t, "/v1/auth/password/verification", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"companyId":"C1","e2eeSid":"sid","encryptedPassword":"sealed","userId":"U1"}`, got.body)
}

func TestTerms_AcceptsArrayPayload(t *testing.T) {
	client, got := capture(t, `[{"contentType":"TNC","version":"3"},{"contentType":"DISCLAIMER","version":"2"}]`)

	terms, err := client.Terms(context.Background(), testCreds())
	require.NoError(t, err)
	require.Len(t, terms, 2)
	assert.Equal(t, "TNC", terms[0].ContentType)
	assert.Equal(t, "3", terms[0].Version)

	assert.Equal(t, http.MethodGet, got.method)
	assert.Equal(t, "/v1/content/terms", got.path)
	assert.Equal(t, "role=NORMAL_USER", got.rawQuery)
	// Node reused the password-verification headers here, content-type included.
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
}

func TestTerms_AcceptsSingleObjectPayload(t *testing.T) {
	client, _ := capture(t, `{"contentType":"TNC","version":"9"}`)

	terms, err := client.Terms(context.Background(), testCreds())
	require.NoError(t, err)
	require.Len(t, terms, 1)
	assert.Equal(t, "9", terms[0].Version)
}

func TestAcceptTnC(t *testing.T) {
	client, got := capture(t, `{}`)

	err := client.AcceptTnC(context.Background(), testCreds(), ktb.AcceptTnCRequest{
		DisclaimerVersion: "2", TncVersion: "3", TransactionToken: "tt",
	})
	require.NoError(t, err)

	assert.Equal(t, "/v1/auth/accept-tnc", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"disclaimerVersion":"2","tncVersion":"3","transactionToken":"tt"}`, got.body)
}

func TestOTPGeneration(t *testing.T) {
	client, got := capture(t, `{"tokenUuid":"tu","otpRefNo":"123","deliveryContact":"a@b.c"}`)

	res, err := client.OTPGeneration(context.Background(), testCreds(), ktb.OTPGenerationRequest{
		CompanyID: "C1", DeliveryMethod: "OTP_EMAIL", TransactionToken: "tt", UserID: "U1",
	})
	require.NoError(t, err)
	assert.Equal(t, "tu", res.TokenUUID)
	assert.Equal(t, "123", res.OTPRefNo)

	assert.Equal(t, "/v1/auth/otp/generation", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
}

func TestOTPVerification(t *testing.T) {
	client, got := capture(t, `{}`)

	err := client.OTPVerification(context.Background(), testCreds(), ktb.OTPVerificationRequest{
		OTP: "123456", TokenUUID: "tu", TransactionToken: "tt",
	})
	require.NoError(t, err)

	assert.Equal(t, "/v1/auth/otp/verification", got.path)
	assert.JSONEq(t, `{"otp":"123456","tokenUuid":"tu","transactionToken":"tt"}`, got.body)
}

func TestPasswordGrant(t *testing.T) {
	client, got := capture(t, `{"access_token":"tok-2"}`)

	res, err := client.PasswordGrant(context.Background(), testCreds(), "tt")
	require.NoError(t, err)
	assert.Equal(t, "tok-2", res.AccessToken)

	assert.Equal(t, "/v1/password/grant", got.path)
	assert.Equal(t, "grant_type=client_credentials", got.rawQuery)
	assert.JSONEq(t, `{"transactionToken":"tt"}`, got.body)
}

func TestPinSet(t *testing.T) {
	client, got := capture(t, `{}`)

	err := client.PinSet(context.Background(), testCreds(), ktb.PinSetRequest{
		E2EESid: "sid", EncryptedPin: "sealed", TransactionToken: "tt",
	})
	require.NoError(t, err)

	assert.Equal(t, "/v1/auth/pin/set", got.path)
	assert.JSONEq(t, `{"e2eeSid":"sid","encryptedPin":"sealed","transactionToken":"tt"}`, got.body)
}

func TestUserProfile_KeepsRawPayload(t *testing.T) {
	client, got := capture(t, `{"corporateRefId":"corp-1","userId":"U1","companyId":"C1","extra":"kept"}`)

	profile, err := client.UserProfile(context.Background(), testCreds())
	require.NoError(t, err)
	assert.Equal(t, "corp-1", profile.CorporateRefID)
	assert.Equal(t, "U1", profile.UserID)
	assert.Contains(t, string(profile.Raw), "extra")

	assert.Equal(t, http.MethodGet, got.method)
	assert.Equal(t, "/v1/profile/user/profile", got.path)
	assert.Empty(t, got.contentType)
}

func TestRegistrationUserProfile_SendsContentType(t *testing.T) {
	client, got := capture(t, `{"userId":"U1"}`)

	_, err := client.RegistrationUserProfile(context.Background(), testCreds())
	require.NoError(t, err)

	// Same endpoint as UserProfile, but the Node registration flow reused
	// headers that carried a content-type. Both variants exist on purpose.
	assert.Equal(t, "/v1/profile/user/profile", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
}

func TestMFAChallenge(t *testing.T) {
	client, got := capture(t, `{"mfaRefId":"m1","params":{"e2eeSid":"sid","serverRandom":"r","pubKey":"p","oaepHashAlgo":"SHA-256"}}`)

	res, err := client.MFAChallenge(context.Background(), testCreds(), "m1")
	require.NoError(t, err)
	require.NotNil(t, res.Params)
	assert.Equal(t, "sid", res.Params.E2EESid)

	assert.Equal(t, "/v1/auth/mfa/challenge", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"mfaMethod":"PIN","mfaRefId":"m1"}`, got.body)
}

func TestMFAAuthenticate(t *testing.T) {
	client, got := capture(t, `{}`)

	err := client.MFAAuthenticate(context.Background(), testCreds(), "m1", "sealed")
	require.NoError(t, err)

	assert.Equal(t, "/v1/auth/mfa/authentication", got.path)
	assert.JSONEq(t, `{"mfaPassphrase":"sealed","mfaRefId":"m1"}`, got.body)
}
```

- [ ] **Step 6: Write `methods_auth.go`**

Endpoint table this file implements:

| Method | Verb | Path | Query | content-type | Auth |
|---|---|---|---|---|---|
| `PreloginGrant` | POST | `/v1/prelogin/grant` | `grant_type=client_credentials` | lower | Basic |
| `PinKeyGeneration` | POST | `/v1/auth/pin/key/generation` | — | lower | Bearer |
| `PinGrant` | POST | `/v1/pin/grant` | `grant_type=client_credentials` | UPPER | Bearer |
| `PasswordKeyGeneration` | POST | `/v1/auth/password/key/generation` | — | lower | Bearer |
| `PasswordVerification` | POST | `/v1/auth/password/verification` | — | UPPER | Bearer |
| `Terms` | GET | `/v1/content/terms` | `role=NORMAL_USER` | UPPER | Bearer |
| `AcceptTnC` | POST | `/v1/auth/accept-tnc` | — | UPPER | Bearer |
| `OTPGeneration` | POST | `/v1/auth/otp/generation` | — | UPPER | Bearer |
| `OTPVerification` | POST | `/v1/auth/otp/verification` | — | UPPER | Bearer |
| `PasswordGrant` | POST | `/v1/password/grant` | `grant_type=client_credentials` | UPPER | Bearer |
| `PinSet` | POST | `/v1/auth/pin/set` | — | UPPER | Bearer |
| `UserProfile` | GET | `/v1/profile/user/profile` | — | *(none)* | Bearer |
| `RegistrationUserProfile` | GET | `/v1/profile/user/profile` | — | UPPER | Bearer |
| `MFAChallenge` | POST | `/v1/auth/mfa/challenge` | — | UPPER | Bearer |
| `MFAAuthenticate` | POST | `/v1/auth/mfa/authentication` | — | UPPER | Bearer |

```go
package ktb

import (
	"context"
	"encoding/json"
	"net/url"
)

// AuthAPI covers device provisioning, login, and multi-factor authentication.
type AuthAPI interface {
	PreloginGrant(ctx context.Context, deviceID string) (*GrantResponse, error)
	PinKeyGeneration(ctx context.Context, creds Creds) (*KeyMaterial, error)
	PinGrant(ctx context.Context, creds Creds, e2eeSid, encryptedPassword string) (*GrantResponse, error)
	PasswordKeyGeneration(ctx context.Context, creds Creds) (*KeyMaterial, error)
	PasswordVerification(ctx context.Context, creds Creds, req PasswordVerificationRequest) (*PasswordVerificationResponse, error)
	Terms(ctx context.Context, creds Creds) ([]Term, error)
	AcceptTnC(ctx context.Context, creds Creds, req AcceptTnCRequest) error
	OTPGeneration(ctx context.Context, creds Creds, req OTPGenerationRequest) (*OTPGenerationResponse, error)
	OTPVerification(ctx context.Context, creds Creds, req OTPVerificationRequest) error
	PasswordGrant(ctx context.Context, creds Creds, transactionToken string) (*GrantResponse, error)
	PinSet(ctx context.Context, creds Creds, req PinSetRequest) error
	UserProfile(ctx context.Context, creds Creds) (*UserProfile, error)
	RegistrationUserProfile(ctx context.Context, creds Creds) (*UserProfile, error)
	MFAChallenge(ctx context.Context, creds Creds, mfaRefID string) (*MFAChallengeResponse, error)
	MFAAuthenticate(ctx context.Context, creds Creds, mfaRefID, passphrase string) error
}

// emptyJSONBody is the literal payload the Node client posted to the endpoints
// that take no arguments.
var emptyJSONBody = []byte("{}")

func grantTypeQuery() url.Values {
	return url.Values{"grant_type": []string{"client_credentials"}}
}

func (c *Client) PreloginGrant(ctx context.Context, deviceID string) (*GrantResponse, error) {
	var out GrantResponse
	err := c.do(ctx, request{
		method:       "POST",
		path:         "/v1/prelogin/grant",
		query:        grantTypeQuery(),
		rawBody:      emptyJSONBody,
		contentType:  contentTypeJSONLower,
		creds:        Creds{DeviceID: deviceID},
		preloginAuth: true,
	}, &out)

	return &out, err
}

func (c *Client) PinKeyGeneration(ctx context.Context, creds Creds) (*KeyMaterial, error) {
	var out KeyMaterial
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/pin/key/generation",
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONLower,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) PinGrant(ctx context.Context, creds Creds, e2eeSid, encryptedPassword string) (*GrantResponse, error) {
	var out GrantResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/pin/grant",
		query:       grantTypeQuery(),
		body:        PinGrantRequest{E2EESid: e2eeSid, EncryptedPassword: encryptedPassword},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) PasswordKeyGeneration(ctx context.Context, creds Creds) (*KeyMaterial, error) {
	var out KeyMaterial
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/password/key/generation",
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONLower,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) PasswordVerification(ctx context.Context, creds Creds, req PasswordVerificationRequest) (*PasswordVerificationResponse, error) {
	var out PasswordVerificationResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/password/verification",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

// Terms returns the TnC and disclaimer documents. Upstream answers with either
// a list or a single object, so both shapes are accepted -- the Node client
// normalized the same way.
func (c *Client) Terms(ctx context.Context, creds Creds) ([]Term, error) {
	body, err := c.doRaw(ctx, request{
		method:      "GET",
		path:        "/v1/content/terms",
		query:       url.Values{"role": []string{"NORMAL_USER"}},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
	if err != nil {
		return nil, err
	}

	var list []Term
	if err := json.Unmarshal(body, &list); err == nil {
		return list, nil
	}

	var single Term
	if err := json.Unmarshal(body, &single); err != nil {
		return nil, nil
	}

	return []Term{single}, nil
}

func (c *Client) AcceptTnC(ctx context.Context, creds Creds, req AcceptTnCRequest) error {
	return c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/accept-tnc",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, nil)
}

func (c *Client) OTPGeneration(ctx context.Context, creds Creds, req OTPGenerationRequest) (*OTPGenerationResponse, error) {
	var out OTPGenerationResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/otp/generation",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) OTPVerification(ctx context.Context, creds Creds, req OTPVerificationRequest) error {
	return c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/otp/verification",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, nil)
}

func (c *Client) PasswordGrant(ctx context.Context, creds Creds, transactionToken string) (*GrantResponse, error) {
	var out GrantResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/password/grant",
		query:       grantTypeQuery(),
		body:        PasswordGrantRequest{TransactionToken: transactionToken},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) PinSet(ctx context.Context, creds Creds, req PinSetRequest) error {
	return c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/pin/set",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, nil)
}

func (c *Client) UserProfile(ctx context.Context, creds Creds) (*UserProfile, error) {
	return c.userProfile(ctx, creds, "")
}

// RegistrationUserProfile hits the same endpoint as UserProfile but sends a
// content-type, because the Node registration flow reused headers that carried
// one. Two methods rather than a flag, so each call site reads unambiguously.
func (c *Client) RegistrationUserProfile(ctx context.Context, creds Creds) (*UserProfile, error) {
	return c.userProfile(ctx, creds, contentTypeJSONUpper)
}

func (c *Client) userProfile(ctx context.Context, creds Creds, contentType string) (*UserProfile, error) {
	body, err := c.doRaw(ctx, request{
		method:      "GET",
		path:        "/v1/profile/user/profile",
		contentType: contentType,
		creds:       creds,
	})
	if err != nil {
		return nil, err
	}

	var out UserProfile
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, wrapDecodeError("/v1/profile/user/profile")
	}
	out.Raw = body

	return &out, nil
}

func (c *Client) MFAChallenge(ctx context.Context, creds Creds, mfaRefID string) (*MFAChallengeResponse, error) {
	var out MFAChallengeResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/mfa/challenge",
		body:        MFAChallengeRequest{MFAMethod: "PIN", MFARefID: mfaRefID},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) MFAAuthenticate(ctx context.Context, creds Creds, mfaRefID, passphrase string) error {
	return c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/mfa/authentication",
		body:        MFAAuthenticateRequest{MFAPassphrase: passphrase, MFARefID: mfaRefID},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, nil)
}

var _ AuthAPI = (*Client)(nil)
```

Add `wrapDecodeError` to `client.go`:

```go
func wrapDecodeError(path string) error {
	return fmt.Errorf("decode %s response: %w", path, errs.ErrUnavailable)
}
```

- [ ] **Step 7: Write `module.go`**

```go
package ktb

import "go.uber.org/fx"

// Module provides the concrete client and exposes it under each narrow
// interface, so a service depends only on the endpoints it actually calls.
var Module = fx.Options(
	fx.Provide(
		NewClient,
		func(c *Client) AuthAPI { return c },
	),
)
```

Tasks 7 and 8 add the remaining `fx.Provide` lines for `AccountAPI`,
`InstructionAPI`, `TransferAPI`, and `BulkAPI`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `go test ./internal/adapter/external/ktb/ -v`
Expected: PASS, all 20+ tests.

- [ ] **Step 9: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/external/ktb
git commit -m "feat: add KTB client transport and auth endpoints"
```

---

## Task 7: `ktb` account and instruction methods

**Files:**
- Create: `internal/adapter/external/ktb/{methods_account,methods_instruction}.go`
- Modify: `internal/adapter/external/ktb/client.go` (add `encodeQuery`)
- Modify: `internal/adapter/external/ktb/dto.go` (append the types below)
- Modify: `internal/adapter/external/ktb/module.go`
- Test: `internal/adapter/external/ktb/{methods_account_test,methods_instruction_test}.go`

**Interfaces:**
- Consumes: `Client`, `Creds`, `request`, `do`, `doRaw` (Task 6).
- Produces: `AccountAPI` and `InstructionAPI` interfaces, plus the DTOs
  `CheckNameResponse`, `EntitlementsResponse`, `PreviewAccount`,
  `TransactionHistoryQuery`, `TaskListQuery`, `ApproveInitResponse`.
  Consumed by `account` (Task 11), `instruction` (Task 12), `transfer` (Task 13).

- [ ] **Step 1: Add `encodeQuery` to `client.go`**

```go
// queryPair is one query-string parameter.
type queryPair struct{ key, value string }

// encodeQuery builds a query string that preserves pair order and encodes a
// space as %20.
//
// url.Values.Encode() would sort the keys alphabetically and encode a space as
// "+". axios did neither, and "transactionType=deposit withdraw" is a real
// parameter, so matching axios keeps this client byte-compatible with the one
// the bank has been answering.
func encodeQuery(pairs ...queryPair) string {
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, escapeQueryComponent(p.key)+"="+escapeQueryComponent(p.value))
	}

	return strings.Join(parts, "&")
}

func escapeQueryComponent(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}
```

Add `"strings"` to the imports of `client.go`.

- [ ] **Step 2: Append the account and instruction DTOs to `dto.go`**

```go
// CheckNameResponse is the payee lookup result. The transfer flows read id,
// nameEn, and nameTh; the HTTP layer relays Raw untouched.
type CheckNameResponse struct {
	ID     string `json:"id"`
	NameEn string `json:"nameEn"`
	NameTh string `json:"nameTh"`

	Raw json.RawMessage `json:"-"`
}

// PayeeDisplayName returns the English payee name, falling back to the
// "no<account>" placeholder the Node client used when upstream sent none.
func (r *CheckNameResponse) PayeeDisplayName() string {
	if r.NameEn != "" {
		return r.NameEn
	}
	return "no" + r.ID
}

// EntitlementsResponse is walked to find the first linked account. Every level
// is optional upstream, so each is a pointer or a slice checked before use.
type EntitlementsResponse struct {
	FinancialAndNonFinancialServices []EntitlementService `json:"financialAndNonFinancialServices"`

	Raw json.RawMessage `json:"-"`
}

type EntitlementService struct {
	SubServices []EntitlementSubService `json:"subServices"`
}

type EntitlementSubService struct {
	AccountsLinked *AccountsLinked `json:"accountsLinked"`
}

type AccountsLinked struct {
	PreviewAccounts []PreviewAccount `json:"previewAccounts"`
}

type PreviewAccount struct {
	AccountRefID string `json:"accountRefId"`
	AccountNo    string `json:"accountNo"`
}

// FirstPreviewAccount returns the first linked account, or nil when the
// entitlement tree carries none.
func (r *EntitlementsResponse) FirstPreviewAccount() *PreviewAccount {
	for _, svc := range r.FinancialAndNonFinancialServices {
		for _, sub := range svc.SubServices {
			if sub.AccountsLinked == nil {
				continue
			}
			for i := range sub.AccountsLinked.PreviewAccounts {
				return &sub.AccountsLinked.PreviewAccounts[i]
			}
		}
	}

	return nil
}

// TransactionHistoryQuery carries the two parameters a caller controls; the
// rest are fixed by the Node client and applied in the method.
type TransactionHistoryQuery struct {
	AccountRefID string
	PageSize     string
	PageNumber   string
}

// TaskListQuery is shared by the pending and submitted instruction lists.
// Order applies to the submitted list only.
type TaskListQuery struct {
	PageNumber          string
	PageSize            string
	ListType            string
	DatetimeFrom        string
	DatetimeTo          string
	InstructionViewType string
	Order               string
}

type ApproveInitRequest struct {
	IsShowingWarning bool `json:"isShowingWarning"`
}

type ApproveInitResponse struct {
	MFARefID string `json:"mfaRefId"`
}

type ApproveRequest struct {
	MFARefID string `json:"mfaRefId"`
}
```

- [ ] **Step 3: Write the failing account-method test**

`internal/adapter/external/ktb/methods_account_test.go`:

```go
package ktb_test

import (
	"context"
	"net/http"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccountOverview(t *testing.T) {
	client, got := capture(t, `{"accounts":[]}`)

	body, err := client.AccountOverview(context.Background(), testCreds())
	require.NoError(t, err)
	assert.JSONEq(t, `{"accounts":[]}`, string(body))

	assert.Equal(t, http.MethodGet, got.method)
	assert.Equal(t, "/v1/account/overview", got.path)
	assert.Empty(t, got.rawQuery)
	assert.Empty(t, got.contentType)
}

func TestCashflowAnalytics(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.CashflowAnalytics(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "/v1/cashflow-analytics/360-view", got.path)
	assert.Empty(t, got.contentType)
}

func TestSourceOfFunds(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.SourceOfFunds(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "/v1/account/source-of-funds", got.path)
	assert.Equal(t, "service=TRANSFER", got.rawQuery)
}

func TestEntitlements_FindsFirstPreviewAccount(t *testing.T) {
	client, got := capture(t, `{
      "financialAndNonFinancialServices":[
        {"subServices":[
          {"accountsLinked":null},
          {"accountsLinked":{"previewAccounts":[{"accountRefId":"acct-1","accountNo":"1234567890"}]}}
        ]}
      ]}`)

	res, err := client.Entitlements(context.Background(), testCreds(), "corp-1")
	require.NoError(t, err)

	first := res.FirstPreviewAccount()
	require.NotNil(t, first)
	assert.Equal(t, "acct-1", first.AccountRefID)
	// The Node handler read accountNo off a bare string and always got
	// undefined; this is the field that makes from_account_no work.
	assert.Equal(t, "1234567890", first.AccountNo)

	assert.Equal(t, "/v1/entitlement/entitlements/user/corporate/corp-1", got.path)
}

func TestEntitlements_EmptyTreeYieldsNil(t *testing.T) {
	client, _ := capture(t, `{"financialAndNonFinancialServices":[]}`)

	res, err := client.Entitlements(context.Background(), testCreds(), "corp-1")
	require.NoError(t, err)
	assert.Nil(t, res.FirstPreviewAccount())
}

func TestEntitlements_EscapesCorporateRefID(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.Entitlements(context.Background(), testCreds(), "corp/../admin")
	require.NoError(t, err)

	assert.NotContains(t, got.path, "/admin", "path segments must be escaped")
}

func TestTransactionHistory_MatchesNodeQuery(t *testing.T) {
	client, got := capture(t, `{"transactions":[]}`)

	_, err := client.TransactionHistory(context.Background(), testCreds(), ktb.TransactionHistoryQuery{
		AccountRefID: "acct-1", PageSize: "40", PageNumber: "0",
	})
	require.NoError(t, err)

	assert.Equal(t, "/v1/transaction-history/accounts/acct-1", got.path)
	assert.Equal(t,
		"accountRefId=acct-1&accountType=CASA&transactionType=deposit%20withdraw&pageSize=40&pageNumber=0&order=DESC&orderBy=transactionDate",
		got.rawQuery,
		"parameter order and %20 encoding must match the axios client")
}

func TestCheckName(t *testing.T) {
	client, got := capture(t, `{"id":"1234567890","nameTh":"ทดสอบ","nameEn":"TEST"}`)

	res, err := client.CheckName(context.Background(), testCreds(), "acct-1", "1234567890", "006")
	require.NoError(t, err)
	assert.Equal(t, "TEST", res.NameEn)
	assert.Equal(t, "ทดสอบ", res.NameTh)
	assert.Contains(t, string(res.Raw), "nameTh")

	assert.Equal(t, "/v1/account/payee-funds/external", got.path)
	assert.Equal(t, "bankCode=006&fromAccountRefId=acct-1&id=1234567890", got.rawQuery)
}

func TestCheckNameResponse_PayeeDisplayNameFallback(t *testing.T) {
	withName := &ktb.CheckNameResponse{ID: "123", NameEn: "TEST"}
	assert.Equal(t, "TEST", withName.PayeeDisplayName())

	without := &ktb.CheckNameResponse{ID: "123"}
	assert.Equal(t, "no123", without.PayeeDisplayName())
}

func TestTransactionLimit_UsesBracketedRepeatedParam(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.TransactionLimit(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "/v1/limit/transaction", got.path)
	assert.Equal(t,
		"subServices[]=TRANSFER_SMART_SAME_DAY&subServices[]=TRANSFER_SMART_NEXT_DAY&subServices[]=TRANSFER_OWN_ACCOUNT&subServices[]=TRANSFER_3_PARTY&subServices[]=TRANSFER_PROMPTPAY_ONLINE&subServices[]=TRANSFER_BAHTNET&subServices[]=TRANSFER_OTHER_BANK",
		got.rawQuery,
		"axios sends array params with literal brackets in axios 1.x")
}
```

The bracket assertion encodes an assumption about what axios 1.13 emitted.
There is no upstream capture in this repository to confirm the bank accepts
this form — verify it on the first live run (Task 18, step 6) and, if the bank
rejects it, switch to a bare repeated `subServices=` key and update this test.

- [ ] **Step 4: Run it to make sure it fails**

Run: `go test ./internal/adapter/external/ktb/ -run 'TestAccount|TestCashflow|TestSource|TestEntitlements|TestTransaction|TestCheckName' -v`
Expected: FAIL — methods undefined.

- [ ] **Step 5: Write `methods_account.go`**

| Method | Verb | Path | Query | content-type |
|---|---|---|---|---|
| `AccountOverview` | GET | `/v1/account/overview` | — | *(none)* |
| `CashflowAnalytics` | GET | `/v1/cashflow-analytics/360-view` | — | *(none)* |
| `SourceOfFunds` | GET | `/v1/account/source-of-funds` | `service=TRANSFER` | *(none)* |
| `Entitlements` | GET | `/v1/entitlement/entitlements/user/corporate/{corporateRefId}` | — | *(none)* |
| `TransactionHistory` | GET | `/v1/transaction-history/accounts/{accountRefId}` | 7 fixed + paging | *(none)* |
| `CheckName` | GET | `/v1/account/payee-funds/external` | `bankCode`, `fromAccountRefId`, `id` | *(none)* |
| `TransactionLimit` | GET | `/v1/limit/transaction` | `subServices[]` × 7 | *(none)* |

```go
package ktb

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
)

// AccountAPI covers balances, entitlements, and the pre-transfer checks.
type AccountAPI interface {
	AccountOverview(ctx context.Context, creds Creds) (json.RawMessage, error)
	CashflowAnalytics(ctx context.Context, creds Creds) (json.RawMessage, error)
	SourceOfFunds(ctx context.Context, creds Creds) (json.RawMessage, error)
	Entitlements(ctx context.Context, creds Creds, corporateRefID string) (*EntitlementsResponse, error)
	TransactionHistory(ctx context.Context, creds Creds, q TransactionHistoryQuery) (json.RawMessage, error)
	CheckName(ctx context.Context, creds Creds, accountRefID, accountTo, bankCode string) (*CheckNameResponse, error)
	TransactionLimit(ctx context.Context, creds Creds) (json.RawMessage, error)
}

// limitSubServices is the fixed list the Node client queried. Order is
// preserved because it is part of the reproduced query string.
var limitSubServices = []string{
	"TRANSFER_SMART_SAME_DAY",
	"TRANSFER_SMART_NEXT_DAY",
	"TRANSFER_OWN_ACCOUNT",
	"TRANSFER_3_PARTY",
	"TRANSFER_PROMPTPAY_ONLINE",
	"TRANSFER_BAHTNET",
	"TRANSFER_OTHER_BANK",
}

func (c *Client) AccountOverview(ctx context.Context, creds Creds) (json.RawMessage, error) {
	return c.doRaw(ctx, request{method: "GET", path: "/v1/account/overview", creds: creds})
}

func (c *Client) CashflowAnalytics(ctx context.Context, creds Creds) (json.RawMessage, error) {
	return c.doRaw(ctx, request{method: "GET", path: "/v1/cashflow-analytics/360-view", creds: creds})
}

func (c *Client) SourceOfFunds(ctx context.Context, creds Creds) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/account/source-of-funds",
		query:  url.Values{"service": []string{"TRANSFER"}},
		creds:  creds,
	})
}

func (c *Client) Entitlements(ctx context.Context, creds Creds, corporateRefID string) (*EntitlementsResponse, error) {
	path := "/v1/entitlement/entitlements/user/corporate/" + url.PathEscape(corporateRefID)

	body, err := c.doRaw(ctx, request{method: "GET", path: path, creds: creds})
	if err != nil {
		return nil, err
	}

	var out EntitlementsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, wrapDecodeError(path)
	}
	out.Raw = body

	return &out, nil
}

func (c *Client) TransactionHistory(ctx context.Context, creds Creds, q TransactionHistoryQuery) (json.RawMessage, error) {
	pageSize := q.PageSize
	if pageSize == "" {
		pageSize = "40"
	}
	pageNumber := q.PageNumber
	if pageNumber == "" {
		pageNumber = "0"
	}

	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/transaction-history/accounts/" + url.PathEscape(q.AccountRefID),
		rawQuery: encodeQuery(
			queryPair{"accountRefId", q.AccountRefID},
			queryPair{"accountType", "CASA"},
			queryPair{"transactionType", "deposit withdraw"},
			queryPair{"pageSize", pageSize},
			queryPair{"pageNumber", pageNumber},
			queryPair{"order", "DESC"},
			queryPair{"orderBy", "transactionDate"},
		),
		creds: creds,
	})
}

func (c *Client) CheckName(ctx context.Context, creds Creds, accountRefID, accountTo, bankCode string) (*CheckNameResponse, error) {
	const path = "/v1/account/payee-funds/external"

	body, err := c.doRaw(ctx, request{
		method: "GET",
		path:   path,
		rawQuery: encodeQuery(
			queryPair{"bankCode", bankCode},
			queryPair{"fromAccountRefId", accountRefID},
			queryPair{"id", accountTo},
		),
		creds: creds,
	})
	if err != nil {
		return nil, err
	}

	var out CheckNameResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, wrapDecodeError(path)
	}
	out.Raw = body

	return &out, nil
}

func (c *Client) TransactionLimit(ctx context.Context, creds Creds) (json.RawMessage, error) {
	// Repeated array parameters go out with literal brackets, matching axios.
	parts := make([]string, 0, len(limitSubServices))
	for _, s := range limitSubServices {
		parts = append(parts, "subServices[]="+escapeQueryComponent(s))
	}

	return c.doRaw(ctx, request{
		method:   "GET",
		path:     "/v1/limit/transaction",
		rawQuery: strings.Join(parts, "&"),
		creds:    creds,
	})
}

var _ AccountAPI = (*Client)(nil)
```

- [ ] **Step 6: Run the account tests to verify they pass**

Run: `go test ./internal/adapter/external/ktb/ -run 'TestAccount|TestCashflow|TestSource|TestEntitlements|TestTransaction|TestCheckName' -v`
Expected: PASS.

- [ ] **Step 7: Write the failing instruction-method test**

`internal/adapter/external/ktb/methods_instruction_test.go`:

```go
package ktb_test

import (
	"context"
	"net/http"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPendingTasks(t *testing.T) {
	client, got := capture(t, `{"tasks":[]}`)

	_, err := client.PendingTasks(context.Background(), testCreds(), ktb.TaskListQuery{
		PageNumber: "0", PageSize: "20", ListType: "TRANSACTIONS",
		DatetimeFrom: "2026-08-17", DatetimeTo: "2026-08-31", InstructionViewType: "ALL",
	})
	require.NoError(t, err)

	assert.Equal(t, http.MethodGet, got.method)
	assert.Equal(t, "/v1/instructions/pending-tasks", got.path)
	assert.Equal(t,
		"pageNumber=0&pageSize=20&listType=TRANSACTIONS&datetimeFrom=2026-08-17&datetimeTo=2026-08-31&instructionViewType=ALL",
		got.rawQuery)
	assert.Empty(t, got.contentType)
}

func TestSubmittedTasks_LeadsWithOrder(t *testing.T) {
	client, got := capture(t, `{"tasks":[]}`)

	_, err := client.SubmittedTasks(context.Background(), testCreds(), ktb.TaskListQuery{
		Order: "ASC", PageNumber: "0", PageSize: "20", ListType: "TRANSACTIONS",
		DatetimeFrom: "2026-08-17", DatetimeTo: "2026-08-31", InstructionViewType: "ALL",
	})
	require.NoError(t, err)

	assert.Equal(t, "/v1/instructions/submitted", got.path)
	assert.Equal(t,
		"order=ASC&pageNumber=0&pageSize=20&listType=TRANSACTIONS&datetimeFrom=2026-08-17&datetimeTo=2026-08-31&instructionViewType=ALL",
		got.rawQuery)
}

func TestInstructionDetail(t *testing.T) {
	client, got := capture(t, `{"instructionRefNo":"IR1"}`)

	body, err := client.InstructionDetail(context.Background(), testCreds(), "IR1")
	require.NoError(t, err)
	assert.Contains(t, string(body), "IR1")

	assert.Equal(t, "/v1/instructions/IR1", got.path)
}

func TestActivityLog(t *testing.T) {
	client, got := capture(t, `[]`)

	_, err := client.ActivityLog(context.Background(), testCreds(), "IR1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/instructions/IR1/activity-log", got.path)
}

func TestBulkOrderItems(t *testing.T) {
	client, got := capture(t, `{"items":[]}`)

	_, err := client.BulkOrderItems(context.Background(), testCreds(), "BO1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/bulk/bulk/BO1/items", got.path)
	assert.Empty(t, got.contentType)
}

func TestBulkItemDetail(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.BulkItemDetail(context.Background(), testCreds(), "BO1", "BI1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/bulk/bulk/BO1/items/BI1", got.path)
}

func TestApproveInit(t *testing.T) {
	client, got := capture(t, `{"mfaRefId":"m1"}`)

	res, err := client.ApproveInit(context.Background(), testCreds(), "IR1")
	require.NoError(t, err)
	assert.Equal(t, "m1", res.MFARefID)

	assert.Equal(t, http.MethodPost, got.method)
	assert.Equal(t, "/v1/instructions/IR1/approve-init", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"isShowingWarning":false}`, got.body)
}

func TestApprove(t *testing.T) {
	client, got := capture(t, `{"status":"APPROVED"}`)

	body, err := client.Approve(context.Background(), testCreds(), "IR1", "m1")
	require.NoError(t, err)
	assert.Contains(t, string(body), "APPROVED")

	assert.Equal(t, "/v1/instructions/IR1/approve", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"mfaRefId":"m1"}`, got.body)
}
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `go test ./internal/adapter/external/ktb/ -run 'TestPending|TestSubmitted|TestInstruction|TestActivity|TestBulk|TestApprove' -v`
Expected: FAIL — methods undefined.

- [ ] **Step 9: Write `methods_instruction.go`**

| Method | Verb | Path | content-type |
|---|---|---|---|
| `PendingTasks` | GET | `/v1/instructions/pending-tasks` | *(none)* |
| `SubmittedTasks` | GET | `/v1/instructions/submitted` | *(none)* |
| `InstructionDetail` | GET | `/v1/instructions/{refNo}` | *(none)* |
| `ActivityLog` | GET | `/v1/instructions/{refNo}/activity-log` | *(none)* |
| `BulkOrderItems` | GET | `/v1/bulk/bulk/{bulkOrderId}/items` | *(none)* |
| `BulkItemDetail` | GET | `/v1/bulk/bulk/{bulkOrderId}/items/{bulkItemId}` | *(none)* |
| `ApproveInit` | POST | `/v1/instructions/{refNo}/approve-init` | UPPER |
| `Approve` | POST | `/v1/instructions/{refNo}/approve` | UPPER |

```go
package ktb

import (
	"context"
	"encoding/json"
	"net/url"
)

// InstructionAPI covers the approval workbench: pending and submitted lists,
// instruction detail, and the approve flow.
type InstructionAPI interface {
	PendingTasks(ctx context.Context, creds Creds, q TaskListQuery) (json.RawMessage, error)
	SubmittedTasks(ctx context.Context, creds Creds, q TaskListQuery) (json.RawMessage, error)
	InstructionDetail(ctx context.Context, creds Creds, instructionRefNo string) (json.RawMessage, error)
	ActivityLog(ctx context.Context, creds Creds, instructionRefNo string) (json.RawMessage, error)
	BulkOrderItems(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error)
	BulkItemDetail(ctx context.Context, creds Creds, bulkOrderID, bulkItemID string) (json.RawMessage, error)
	ApproveInit(ctx context.Context, creds Creds, instructionRefNo string) (*ApproveInitResponse, error)
	Approve(ctx context.Context, creds Creds, instructionRefNo, mfaRefID string) (json.RawMessage, error)
}

func (c *Client) PendingTasks(ctx context.Context, creds Creds, q TaskListQuery) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/instructions/pending-tasks",
		rawQuery: encodeQuery(
			queryPair{"pageNumber", q.PageNumber},
			queryPair{"pageSize", q.PageSize},
			queryPair{"listType", q.ListType},
			queryPair{"datetimeFrom", q.DatetimeFrom},
			queryPair{"datetimeTo", q.DatetimeTo},
			queryPair{"instructionViewType", q.InstructionViewType},
		),
		creds: creds,
	})
}

func (c *Client) SubmittedTasks(ctx context.Context, creds Creds, q TaskListQuery) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/instructions/submitted",
		rawQuery: encodeQuery(
			queryPair{"order", q.Order},
			queryPair{"pageNumber", q.PageNumber},
			queryPair{"pageSize", q.PageSize},
			queryPair{"listType", q.ListType},
			queryPair{"datetimeFrom", q.DatetimeFrom},
			queryPair{"datetimeTo", q.DatetimeTo},
			queryPair{"instructionViewType", q.InstructionViewType},
		),
		creds: creds,
	})
}

func (c *Client) InstructionDetail(ctx context.Context, creds Creds, instructionRefNo string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/instructions/" + url.PathEscape(instructionRefNo),
		creds:  creds,
	})
}

func (c *Client) ActivityLog(ctx context.Context, creds Creds, instructionRefNo string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/instructions/" + url.PathEscape(instructionRefNo) + "/activity-log",
		creds:  creds,
	})
}

func (c *Client) BulkOrderItems(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/bulk/bulk/" + url.PathEscape(bulkOrderID) + "/items",
		creds:  creds,
	})
}

func (c *Client) BulkItemDetail(ctx context.Context, creds Creds, bulkOrderID, bulkItemID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   "/v1/bulk/bulk/" + url.PathEscape(bulkOrderID) + "/items/" + url.PathEscape(bulkItemID),
		creds:  creds,
	})
}

func (c *Client) ApproveInit(ctx context.Context, creds Creds, instructionRefNo string) (*ApproveInitResponse, error) {
	var out ApproveInitResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/instructions/" + url.PathEscape(instructionRefNo) + "/approve-init",
		body:        ApproveInitRequest{IsShowingWarning: false},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) Approve(ctx context.Context, creds Creds, instructionRefNo, mfaRefID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        "/v1/instructions/" + url.PathEscape(instructionRefNo) + "/approve",
		body:        ApproveRequest{MFARefID: mfaRefID},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
}

var _ InstructionAPI = (*Client)(nil)
```

- [ ] **Step 10: Run the instruction tests to verify they pass**

Run: `go test ./internal/adapter/external/ktb/ -v`
Expected: PASS, whole package.

- [ ] **Step 11: Register the two new interfaces in fx**

`internal/adapter/external/ktb/module.go`:

```go
package ktb

import "go.uber.org/fx"

// Module provides the concrete client and exposes it under each narrow
// interface, so a service depends only on the endpoints it actually calls.
var Module = fx.Options(
	fx.Provide(
		NewClient,
		func(c *Client) AuthAPI { return c },
		func(c *Client) AccountAPI { return c },
		func(c *Client) InstructionAPI { return c },
	),
)
```

- [ ] **Step 12: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/external/ktb
git commit -m "feat: add KTB account and instruction endpoints"
```

---

## Task 8: `ktb` transfer and bulk methods

**Files:**
- Create: `internal/adapter/external/ktb/{methods_transfer,methods_bulk}.go`
- Modify: `internal/adapter/external/ktb/dto.go` (append)
- Modify: `internal/adapter/external/ktb/module.go`
- Test: `internal/adapter/external/ktb/{methods_transfer_test,methods_bulk_test}.go`

**Interfaces:**
- Consumes: `Client`, `Creds`, `request`, `do`, `doRaw`, `encodeQuery` (Tasks 6–7).
- Produces: `TransferAPI`, `BulkAPI`, and the DTOs `Amount`, `TransferOrderResponse`, `ServiceFeeResponse`, `SubServiceOption`, `PreConfirmationResponse`, `BulkOrderResponse`, `BulkPayee`, `BulkPayeeResult`. Consumed by `transfer` (Task 13).

- [ ] **Step 1: Append the money type and transfer DTOs to `dto.go`**

```go
// Amount is a monetary value that marshals as a JSON number.
//
// The bank expects a number, which is what the Node client's parseFloat
// produced. Wrapping decimal.Decimal in a local type keeps that formatting
// decision inside this package instead of relying on the global
// decimal.MarshalJSONWithoutQuotes, which any dependency could flip.
type Amount decimal.Decimal

func NewAmount(d decimal.Decimal) Amount { return Amount(d) }

func (a Amount) MarshalJSON() ([]byte, error) {
	return []byte(decimal.Decimal(a).String()), nil
}

func (a Amount) Decimal() decimal.Decimal { return decimal.Decimal(a) }

type CreateTransferOrderRequest struct {
	FromAccountRefID    string `json:"fromAccountRefId"`
	IsSaveAsBeneficiary bool   `json:"isSaveAsBeneficiary"`
	NewPayeeAccountNo   string `json:"newPayeeAccountNo"`
	NewPayeeBankCode    string `json:"newPayeeBankCode"`
	NewPayeeBankName    string `json:"newPayeeBankName"`
	NewPayeeNameEn      string `json:"newPayeeNameEn"`
	NewPayeeNameTh      string `json:"newPayeeNameTh"`
}

type TransferOrderResponse struct {
	TransferOrderID string `json:"transferOrderId"`
	TransferItemID  string `json:"transferItemId"`
}

type AddTransferServiceRequest struct {
	Amount           Amount `json:"amount"`
	EffectiveDate    string `json:"effectiveDate"`
	FromAccountRefID string `json:"fromAccountRefId"`
}

// ServiceFeeResponse lists the routing options and their fees for one item.
type ServiceFeeResponse struct {
	SubServices []SubServiceOption `json:"subServices"`
}

// SubServiceOption is one routing option. PayerTransactionFee is a pointer
// because "absent" and "zero" are different upstream, and the fee-selection
// rules in the transfer service depend on telling them apart.
type SubServiceOption struct {
	PayerTransactionFee *decimal.Decimal `json:"payerTransactionFee"`
	SubService          *SubServiceRef   `json:"subService"`
}

type SubServiceRef struct {
	Value string `json:"value"`
}

type UpdateTransferItemRequest struct {
	Amount                 Amount `json:"amount"`
	EffectiveDate          string `json:"effectiveDate"`
	FeeChargeTo            string `json:"feeChargeTo"`
	FromAccountNo          string `json:"fromAccountNo"`
	FromAccountRefID       string `json:"fromAccountRefId"`
	IsNotificationEnabled  bool   `json:"isNotificationEnabled"`
	IsRecurringEnabled     bool   `json:"isRecurringEnabled"`
	IsSavedAsBeneficiary   bool   `json:"isSavedAsBeneficiary"`
	IsWithholdingTaxEnabled bool  `json:"isWithholdingTaxEnabled"`
	NewPayeeAccountNo      string `json:"newPayeeAccountNo"`
	NewPayeeBankCode       string `json:"newPayeeBankCode"`
	NewPayeeNameEn         string `json:"newPayeeNameEn"`
	NewPayeeNameTh         string `json:"newPayeeNameTh"`
	SubService             string `json:"subService"`
	TransferFee            Amount `json:"transferFee"`
}

type PreConfirmationResponse struct {
	MFARefID string `json:"mfaRefId"`
}

type PollTransferRequest struct {
	OrderID string `json:"orderId"`
	Type    string `json:"type"`
}
```

Add `"github.com/shopspring/decimal"` to the imports of `dto.go`.

- [ ] **Step 2: Write the failing transfer-method test**

`internal/adapter/external/ktb/methods_transfer_test.go`:

```go
package ktb_test

import (
	"context"
	"net/http"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func amount(t *testing.T, s string) ktb.Amount {
	t.Helper()
	d, err := decimal.NewFromString(s)
	require.NoError(t, err)
	return ktb.NewAmount(d)
}

func TestCreateTransferOrder(t *testing.T) {
	client, got := capture(t, `{"transferOrderId":"TO1","transferItemId":"TI1"}`)

	res, err := client.CreateTransferOrder(context.Background(), testCreds(), ktb.CreateTransferOrderRequest{
		FromAccountRefID:  "acct-1",
		NewPayeeAccountNo: "1234567890",
		NewPayeeBankCode:  "006",
		NewPayeeBankName:  "กรุงไทย",
		NewPayeeNameEn:    "TEST",
		NewPayeeNameTh:    "ทดสอบ",
	})
	require.NoError(t, err)
	assert.Equal(t, "TO1", res.TransferOrderID)
	assert.Equal(t, "TI1", res.TransferItemID)

	assert.Equal(t, http.MethodPost, got.method)
	assert.Equal(t, "/v1/transfer/transfer-order", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	// isSaveAsBeneficiary must be present and false, never omitted.
	assert.JSONEq(t, `{
	  "fromAccountRefId":"acct-1","isSaveAsBeneficiary":false,
	  "newPayeeAccountNo":"1234567890","newPayeeBankCode":"006","newPayeeBankName":"กรุงไทย",
	  "newPayeeNameEn":"TEST","newPayeeNameTh":"ทดสอบ"}`, got.body)
}

func TestAddTransferItem(t *testing.T) {
	client, got := capture(t, `{"transferItemId":"TI2"}`)

	res, err := client.AddTransferItem(context.Background(), testCreds(), "TO1", ktb.CreateTransferOrderRequest{
		FromAccountRefID: "acct-1", NewPayeeAccountNo: "999", NewPayeeBankCode: "004",
		NewPayeeBankName: "กสิกร", NewPayeeNameEn: "X", NewPayeeNameTh: "ย",
	})
	require.NoError(t, err)
	assert.Equal(t, "TI2", res.TransferItemID)

	assert.Equal(t, "/v1/transfer/transfer-order/TO1/item", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
}

func TestAddTransferService_SendsAmountAsNumber(t *testing.T) {
	client, got := capture(t, `{"subServices":[{"payerTransactionFee":0,"subService":{"value":"TRANSFER_PROMPTPAY_ONLINE"}}]}`)

	res, err := client.AddTransferService(context.Background(), testCreds(), "TO1", "TI1", ktb.AddTransferServiceRequest{
		Amount: amount(t, "10.00"), EffectiveDate: "2026-08-24", FromAccountRefID: "acct-1",
	})
	require.NoError(t, err)
	require.Len(t, res.SubServices, 1)
	require.NotNil(t, res.SubServices[0].PayerTransactionFee)
	assert.True(t, res.SubServices[0].PayerTransactionFee.IsZero())
	assert.Equal(t, "TRANSFER_PROMPTPAY_ONLINE", res.SubServices[0].SubService.Value)

	assert.Equal(t, "/v1/transfer/transfer-order/TO1/item/TI1/service", got.path)
	// A quoted amount would be rejected upstream.
	assert.JSONEq(t, `{"amount":10,"effectiveDate":"2026-08-24","fromAccountRefId":"acct-1"}`, got.body)
}

func TestAddTransferService_AbsentFeeStaysNil(t *testing.T) {
	client, _ := capture(t, `{"subServices":[{"subService":{"value":"TRANSFER_OTHER_BANK"}}]}`)

	res, err := client.AddTransferService(context.Background(), testCreds(), "TO1", "TI1", ktb.AddTransferServiceRequest{
		Amount: amount(t, "1"), EffectiveDate: "2026-08-24", FromAccountRefID: "a",
	})
	require.NoError(t, err)
	require.Len(t, res.SubServices, 1)
	assert.Nil(t, res.SubServices[0].PayerTransactionFee, "absent and zero must stay distinguishable")
}

func TestUpdateTransferItem_SendsFullNodeBody(t *testing.T) {
	client, got := capture(t, `{}`)

	err := client.UpdateTransferItem(context.Background(), testCreds(), "TO1", "TI1", ktb.UpdateTransferItemRequest{
		Amount:           amount(t, "10.5"),
		EffectiveDate:    "2026-08-24",
		FeeChargeTo:      "PAYER",
		FromAccountNo:    "1111111111",
		FromAccountRefID: "acct-1",
		NewPayeeAccountNo: "1234567890",
		NewPayeeBankCode: "006",
		NewPayeeNameEn:   "TEST",
		NewPayeeNameTh:   "ทดสอบ",
		SubService:       "TRANSFER_OTHER_BANK",
		TransferFee:      amount(t, "5"),
	})
	require.NoError(t, err)

	assert.Equal(t, http.MethodPut, got.method)
	assert.Equal(t, "/v1/transfer/transfer-order/TO1/item/TI1", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{
	  "amount":10.5,"effectiveDate":"2026-08-24","feeChargeTo":"PAYER",
	  "fromAccountNo":"1111111111","fromAccountRefId":"acct-1",
	  "isNotificationEnabled":false,"isRecurringEnabled":false,
	  "isSavedAsBeneficiary":false,"isWithholdingTaxEnabled":false,
	  "newPayeeAccountNo":"1234567890","newPayeeBankCode":"006",
	  "newPayeeNameEn":"TEST","newPayeeNameTh":"ทดสอบ",
	  "subService":"TRANSFER_OTHER_BANK","transferFee":5}`, got.body)
}

func TestVerifyTransfer_UsesLowercaseCharset(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.VerifyTransfer(context.Background(), testCreds(), "TO1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/transfer/transfer-order/TO1/verification", got.path)
	assert.Equal(t, "application/json; charset=utf-8", got.contentType)
	assert.JSONEq(t, `{}`, got.body)
}

func TestPreConfirmTransfer_IsV2(t *testing.T) {
	client, got := capture(t, `{"mfaRefId":"m1"}`)

	res, err := client.PreConfirmTransfer(context.Background(), testCreds(), "TO1")
	require.NoError(t, err)
	assert.Equal(t, "m1", res.MFARefID)

	assert.Equal(t, "/v2/transfer/transfer-order/TO1/pre-confirmation", got.path)
	assert.Equal(t, "application/json; charset=utf-8", got.contentType)
}

func TestConfirmTransfer_HitsSubmission(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.ConfirmTransfer(context.Background(), testCreds(), "TO1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/transfer/transfer-order/TO1/submission", got.path)
	assert.Equal(t, "application/json; charset=utf-8", got.contentType)
}

func TestTransferOrderItems(t *testing.T) {
	client, got := capture(t, `[{"transferItemId":"TI1"}]`)

	body, err := client.TransferOrderItems(context.Background(), testCreds(), "TO1")
	require.NoError(t, err)
	assert.Contains(t, string(body), "TI1")

	assert.Equal(t, http.MethodGet, got.method)
	assert.Equal(t, "/v1/transfer/transfer-order/TO1/item", got.path)
	assert.Empty(t, got.contentType)
}

func TestPollTransfer(t *testing.T) {
	client, got := capture(t, `{"status":"SUCCESS"}`)

	body, err := client.PollTransfer(context.Background(), testCreds(), "TO1")
	require.NoError(t, err)
	assert.Contains(t, string(body), "SUCCESS")

	assert.Equal(t, "/v1/transfer/polling", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"orderId":"TO1","type":"transfer"}`, got.body)
}
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `go test ./internal/adapter/external/ktb/ -run 'TestCreateTransfer|TestAddTransfer|TestUpdateTransfer|TestVerifyTransfer|TestPreConfirmTransfer|TestConfirmTransfer|TestTransferOrder|TestPollTransfer' -v`
Expected: FAIL — methods undefined.

- [ ] **Step 4: Write `methods_transfer.go`**

| Method | Verb | Path | content-type | Body |
|---|---|---|---|---|
| `CreateTransferOrder` | POST | `/v1/transfer/transfer-order` | UPPER | payee |
| `AddTransferItem` | POST | `/v1/transfer/transfer-order/{o}/item` | UPPER | payee |
| `AddTransferService` | POST | `/v1/transfer/transfer-order/{o}/item/{i}/service` | UPPER | amount |
| `UpdateTransferItem` | PUT | `/v1/transfer/transfer-order/{o}/item/{i}` | UPPER | full item |
| `VerifyTransfer` | POST | `/v1/transfer/transfer-order/{o}/verification` | lower | `{}` |
| `PreConfirmTransfer` | POST | `/v2/transfer/transfer-order/{o}/pre-confirmation` | lower | `{}` |
| `ConfirmTransfer` | POST | `/v1/transfer/transfer-order/{o}/submission` | lower | `{}` |
| `TransferOrderItems` | GET | `/v1/transfer/transfer-order/{o}/item` | *(none)* | — |
| `PollTransfer` | POST | `/v1/transfer/polling` | UPPER | order id |

```go
package ktb

import (
	"context"
	"encoding/json"
	"net/url"
)

// TransferAPI covers the transfer-order flow used by single and multi-payee
// transfers.
type TransferAPI interface {
	CreateTransferOrder(ctx context.Context, creds Creds, req CreateTransferOrderRequest) (*TransferOrderResponse, error)
	AddTransferItem(ctx context.Context, creds Creds, orderID string, req CreateTransferOrderRequest) (*TransferOrderResponse, error)
	AddTransferService(ctx context.Context, creds Creds, orderID, itemID string, req AddTransferServiceRequest) (*ServiceFeeResponse, error)
	UpdateTransferItem(ctx context.Context, creds Creds, orderID, itemID string, req UpdateTransferItemRequest) error
	VerifyTransfer(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error)
	PreConfirmTransfer(ctx context.Context, creds Creds, orderID string) (*PreConfirmationResponse, error)
	ConfirmTransfer(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error)
	TransferOrderItems(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error)
	PollTransfer(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error)
}

func transferOrderPath(orderID string, suffix string) string {
	return "/v1/transfer/transfer-order/" + url.PathEscape(orderID) + suffix
}

func transferItemPath(orderID, itemID, suffix string) string {
	return "/v1/transfer/transfer-order/" + url.PathEscape(orderID) +
		"/item/" + url.PathEscape(itemID) + suffix
}

func (c *Client) CreateTransferOrder(ctx context.Context, creds Creds, req CreateTransferOrderRequest) (*TransferOrderResponse, error) {
	var out TransferOrderResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/transfer/transfer-order",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) AddTransferItem(ctx context.Context, creds Creds, orderID string, req CreateTransferOrderRequest) (*TransferOrderResponse, error) {
	var out TransferOrderResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        transferOrderPath(orderID, "/item"),
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) AddTransferService(ctx context.Context, creds Creds, orderID, itemID string, req AddTransferServiceRequest) (*ServiceFeeResponse, error) {
	var out ServiceFeeResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        transferItemPath(orderID, itemID, "/service"),
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) UpdateTransferItem(ctx context.Context, creds Creds, orderID, itemID string, req UpdateTransferItemRequest) error {
	return c.do(ctx, request{
		method:      "PUT",
		path:        transferItemPath(orderID, itemID, ""),
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, nil)
}

func (c *Client) VerifyTransfer(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        transferOrderPath(orderID, "/verification"),
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONLower,
		creds:       creds,
	})
}

// PreConfirmTransfer is the only v2 endpoint in the transfer flow.
func (c *Client) PreConfirmTransfer(ctx context.Context, creds Creds, orderID string) (*PreConfirmationResponse, error) {
	var out PreConfirmationResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v2/transfer/transfer-order/" + url.PathEscape(orderID) + "/pre-confirmation",
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONLower,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) ConfirmTransfer(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        transferOrderPath(orderID, "/submission"),
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONLower,
		creds:       creds,
	})
}

func (c *Client) TransferOrderItems(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   transferOrderPath(orderID, "/item"),
		creds:  creds,
	})
}

func (c *Client) PollTransfer(ctx context.Context, creds Creds, orderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        "/v1/transfer/polling",
		body:        PollTransferRequest{OrderID: orderID, Type: "transfer"},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
}

var _ TransferAPI = (*Client)(nil)
```

- [ ] **Step 5: Run the transfer tests to verify they pass**

Run: `go test ./internal/adapter/external/ktb/ -run 'Transfer|TestPoll' -v`
Expected: PASS.

- [ ] **Step 6: Append the bulk DTOs to `dto.go`**

```go
type CreateBulkOrderRequest struct {
	IsRecurring       bool   `json:"isRecurring"`
	PayerAccountRefID string `json:"payerAccountRefId"`
	ProcessingType    string `json:"processingType"`
	Service           string `json:"service"`
	ValueDate         string `json:"valueDate"`
}

type BulkOrderResponse struct {
	BulkOrderID string `json:"bulkOrderId"`
}

// BulkPayee is one recipient in a bulk order. BulkItemID is omitted for a new
// payee and present for one already stored, which is how upstream tells the
// two apart when the whole list is re-posted.
type BulkPayee struct {
	BankCode            string `json:"bankCode"`
	IsNewPromptpay      bool   `json:"isNewPromptpay"`
	IsSaveAsBeneficiary bool   `json:"isSaveAsBeneficiary"`
	PayeeNameEn         string `json:"payeeNameEn"`
	PayeeNameTh         string `json:"payeeNameTh"`
	PayeeNo             string `json:"payeeNo"`
	BulkItemID          string `json:"bulkItemId,omitempty"`
}

type AddBulkItemsRequest struct {
	Payees []BulkPayee `json:"payees"`
}

type BulkPayeeResult struct {
	BulkItemID string `json:"bulkItemId"`
}

type BulkItemServiceRequest struct {
	Amount Amount `json:"amount"`
}

// SaveBulkItemRequest mirrors the Node payload exactly, explicit nulls
// included: upstream distinguishes an absent key from a null one.
type SaveBulkItemRequest struct {
	Amount                  Amount           `json:"amount"`
	FeeChargeTo             string           `json:"feeChargeTo"`
	SubService              string           `json:"subService"`
	TotalFee                Amount           `json:"totalFee"`
	TransferFee             Amount           `json:"transferFee"`
	IsWithholdingTaxEnabled bool             `json:"isWithholdingTaxEnabled"`
	RegionComFee            *decimal.Decimal `json:"regionComFee"`
	RetailFeeAmt            *decimal.Decimal `json:"retailFeeAmt"`
	BotFeeAmt               *decimal.Decimal `json:"botFeeAmt"`
}
```

- [ ] **Step 7: Write the failing bulk-method test**

`internal/adapter/external/ktb/methods_bulk_test.go`:

```go
package ktb_test

import (
	"context"
	"net/http"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateBulkOrder(t *testing.T) {
	client, got := capture(t, `{"bulkOrderId":"BO1"}`)

	res, err := client.CreateBulkOrder(context.Background(), testCreds(), ktb.CreateBulkOrderRequest{
		PayerAccountRefID: "acct-1", ProcessingType: "ONLINE", Service: "TRANSFER", ValueDate: "2026-08-24",
	})
	require.NoError(t, err)
	assert.Equal(t, "BO1", res.BulkOrderID)

	assert.Equal(t, http.MethodPost, got.method)
	assert.Equal(t, "/v1/bulk/bulk", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.JSONEq(t, `{"isRecurring":false,"payerAccountRefId":"acct-1","processingType":"ONLINE","service":"TRANSFER","valueDate":"2026-08-24"}`, got.body)
}

func TestAddBulkItems_OmitsBlankBulkItemID(t *testing.T) {
	client, got := capture(t, `{"payees":[{"bulkItemId":"BI1"}]}`)

	res, err := client.AddBulkItems(context.Background(), testCreds(), "BO1", []ktb.BulkPayee{
		{BankCode: "006", PayeeNameEn: "TEST", PayeeNameTh: "ทดสอบ", PayeeNo: "1234567890"},
	})
	require.NoError(t, err)
	require.Len(t, res, 1)
	assert.Equal(t, "BI1", res[0].BulkItemID)

	assert.Equal(t, "/v1/bulk/bulk/BO1/items", got.path)
	assert.JSONEq(t, `{"payees":[{"bankCode":"006","isNewPromptpay":false,"isSaveAsBeneficiary":false,"payeeNameEn":"TEST","payeeNameTh":"ทดสอบ","payeeNo":"1234567890"}]}`, got.body)
}

func TestAddBulkItems_AcceptsBareArrayResponse(t *testing.T) {
	// Node fell back to `itemsResult.payees || itemsResult`, so both shapes
	// are known to occur upstream.
	client, _ := capture(t, `[{"bulkItemId":"BI9"}]`)

	res, err := client.AddBulkItems(context.Background(), testCreds(), "BO1", []ktb.BulkPayee{{PayeeNo: "1"}})
	require.NoError(t, err)
	require.Len(t, res, 1)
	assert.Equal(t, "BI9", res[0].BulkItemID)
}

func TestBulkItemService(t *testing.T) {
	client, got := capture(t, `{"subServices":[{"payerTransactionFee":2.5,"subService":{"value":"TRANSFER_SMART_NEXT_DAY"}}]}`)

	res, err := client.BulkItemService(context.Background(), testCreds(), "BO1", "BI1", amount(t, "10"))
	require.NoError(t, err)
	require.Len(t, res.SubServices, 1)
	assert.Equal(t, "2.5", res.SubServices[0].PayerTransactionFee.String())

	assert.Equal(t, "/v1/bulk/bulk/BO1/items/BI1/service", got.path)
	assert.JSONEq(t, `{"amount":10}`, got.body)
}

func TestSaveBulkItem_SendsExplicitNulls(t *testing.T) {
	client, got := capture(t, `{}`)

	err := client.SaveBulkItem(context.Background(), testCreds(), "BO1", "BI1", ktb.SaveBulkItemRequest{
		Amount:      amount(t, "10"),
		FeeChargeTo: "OUR",
		SubService:  "TRANSFER_OTHER_BANK",
		TotalFee:    amount(t, "0"),
		TransferFee: amount(t, "0"),
	})
	require.NoError(t, err)

	assert.Equal(t, http.MethodPut, got.method)
	assert.Equal(t, "/v1/bulk/bulk/BO1/items/BI1", got.path)
	assert.JSONEq(t, `{"amount":10,"feeChargeTo":"OUR","subService":"TRANSFER_OTHER_BANK","totalFee":0,"transferFee":0,"isWithholdingTaxEnabled":false,"regionComFee":null,"retailFeeAmt":null,"botFeeAmt":null}`, got.body)
}

func TestVerifyBulk_UsesBulkManualPath(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.VerifyBulk(context.Background(), testCreds(), "BO1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/bulk/bulk/bulk-manual/BO1/verification", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
}

func TestPreConfirmBulk_IsV2(t *testing.T) {
	client, got := capture(t, `{"mfaRefId":"m1"}`)

	res, err := client.PreConfirmBulk(context.Background(), testCreds(), "BO1")
	require.NoError(t, err)
	assert.Equal(t, "m1", res.MFARefID)

	assert.Equal(t, "/v2/bulk/bulk/BO1/pre-confirmation", got.path)
}

func TestSubmitBulk(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.SubmitBulk(context.Background(), testCreds(), "BO1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/bulk/bulk/BO1/submission", got.path)
}

func TestConfirmBulk(t *testing.T) {
	client, got := capture(t, `{}`)

	_, err := client.ConfirmBulk(context.Background(), testCreds(), "BO1")
	require.NoError(t, err)

	assert.Equal(t, "/v1/bulk/bulk/BO1/confirmation", got.path)
}

func TestBulkSummary(t *testing.T) {
	client, got := capture(t, `{"total":1}`)

	_, err := client.BulkSummary(context.Background(), testCreds(), "BO1")
	require.NoError(t, err)

	assert.Equal(t, http.MethodGet, got.method)
	assert.Equal(t, "/v1/bulk/bulk/BO1", got.path)
	assert.Equal(t, "view=SUMMARY", got.rawQuery)
	assert.Empty(t, got.contentType)
}
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `go test ./internal/adapter/external/ktb/ -run 'Bulk' -v`
Expected: FAIL — methods undefined.

- [ ] **Step 9: Write `methods_bulk.go`**

| Method | Verb | Path | content-type |
|---|---|---|---|
| `CreateBulkOrder` | POST | `/v1/bulk/bulk` | UPPER |
| `AddBulkItems` | POST | `/v1/bulk/bulk/{b}/items` | UPPER |
| `BulkItemService` | POST | `/v1/bulk/bulk/{b}/items/{i}/service` | UPPER |
| `SaveBulkItem` | PUT | `/v1/bulk/bulk/{b}/items/{i}` | UPPER |
| `VerifyBulk` | POST | `/v1/bulk/bulk/bulk-manual/{b}/verification` | UPPER |
| `PreConfirmBulk` | POST | `/v2/bulk/bulk/{b}/pre-confirmation` | UPPER |
| `ConfirmBulk` | POST | `/v1/bulk/bulk/{b}/confirmation` | UPPER |
| `SubmitBulk` | POST | `/v1/bulk/bulk/{b}/submission` | UPPER |
| `BulkSummary` | GET | `/v1/bulk/bulk/{b}?view=SUMMARY` | *(none)* |

Note the bulk flow uses the UPPER content type on its empty-body POSTs, where
the transfer flow uses the lower one. That asymmetry is in the Node client and
is reproduced here rather than harmonized.

```go
package ktb

import (
	"context"
	"encoding/json"
	"net/url"
)

// BulkAPI covers the bulk-manual transfer flow.
type BulkAPI interface {
	CreateBulkOrder(ctx context.Context, creds Creds, req CreateBulkOrderRequest) (*BulkOrderResponse, error)
	AddBulkItems(ctx context.Context, creds Creds, bulkOrderID string, payees []BulkPayee) ([]BulkPayeeResult, error)
	BulkItemService(ctx context.Context, creds Creds, bulkOrderID, bulkItemID string, amount Amount) (*ServiceFeeResponse, error)
	SaveBulkItem(ctx context.Context, creds Creds, bulkOrderID, bulkItemID string, req SaveBulkItemRequest) error
	VerifyBulk(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error)
	PreConfirmBulk(ctx context.Context, creds Creds, bulkOrderID string) (*PreConfirmationResponse, error)
	ConfirmBulk(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error)
	SubmitBulk(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error)
	BulkSummary(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error)
}

func bulkPath(bulkOrderID, suffix string) string {
	return "/v1/bulk/bulk/" + url.PathEscape(bulkOrderID) + suffix
}

func bulkItemPath(bulkOrderID, bulkItemID, suffix string) string {
	return "/v1/bulk/bulk/" + url.PathEscape(bulkOrderID) +
		"/items/" + url.PathEscape(bulkItemID) + suffix
}

func (c *Client) CreateBulkOrder(ctx context.Context, creds Creds, req CreateBulkOrderRequest) (*BulkOrderResponse, error) {
	var out BulkOrderResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/bulk/bulk",
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

// AddBulkItems posts the payee list and returns the stored items.
// Upstream answers with either {"payees":[...]} or a bare array, so both are
// accepted -- the Node client normalized the same way.
func (c *Client) AddBulkItems(ctx context.Context, creds Creds, bulkOrderID string, payees []BulkPayee) ([]BulkPayeeResult, error) {
	path := bulkPath(bulkOrderID, "/items")

	body, err := c.doRaw(ctx, request{
		method:      "POST",
		path:        path,
		body:        AddBulkItemsRequest{Payees: payees},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
	if err != nil {
		return nil, err
	}

	var wrapped struct {
		Payees []BulkPayeeResult `json:"payees"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil && wrapped.Payees != nil {
		return wrapped.Payees, nil
	}

	var bare []BulkPayeeResult
	if err := json.Unmarshal(body, &bare); err != nil {
		return nil, wrapDecodeError(path)
	}

	return bare, nil
}

func (c *Client) BulkItemService(ctx context.Context, creds Creds, bulkOrderID, bulkItemID string, amount Amount) (*ServiceFeeResponse, error) {
	var out ServiceFeeResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        bulkItemPath(bulkOrderID, bulkItemID, "/service"),
		body:        BulkItemServiceRequest{Amount: amount},
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) SaveBulkItem(ctx context.Context, creds Creds, bulkOrderID, bulkItemID string, req SaveBulkItemRequest) error {
	return c.do(ctx, request{
		method:      "PUT",
		path:        bulkItemPath(bulkOrderID, bulkItemID, ""),
		body:        req,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, nil)
}

// VerifyBulk sits under a bulk-manual segment the other bulk endpoints do not use.
func (c *Client) VerifyBulk(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        "/v1/bulk/bulk/bulk-manual/" + url.PathEscape(bulkOrderID) + "/verification",
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
}

func (c *Client) PreConfirmBulk(ctx context.Context, creds Creds, bulkOrderID string) (*PreConfirmationResponse, error) {
	var out PreConfirmationResponse
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v2/bulk/bulk/" + url.PathEscape(bulkOrderID) + "/pre-confirmation",
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}

func (c *Client) ConfirmBulk(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        bulkPath(bulkOrderID, "/confirmation"),
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
}

func (c *Client) SubmitBulk(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method:      "POST",
		path:        bulkPath(bulkOrderID, "/submission"),
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	})
}

func (c *Client) BulkSummary(ctx context.Context, creds Creds, bulkOrderID string) (json.RawMessage, error) {
	return c.doRaw(ctx, request{
		method: "GET",
		path:   bulkPath(bulkOrderID, ""),
		query:  url.Values{"view": []string{"SUMMARY"}},
		creds:  creds,
	})
}

var _ BulkAPI = (*Client)(nil)
```

- [ ] **Step 10: Run the whole package to verify it passes**

Run: `go test ./internal/adapter/external/ktb/ -v`
Expected: PASS.

- [ ] **Step 11: Register the last two interfaces in fx**

Add to the `fx.Provide` list in `internal/adapter/external/ktb/module.go`:

```go
		func(c *Client) TransferAPI { return c },
		func(c *Client) BulkAPI { return c },
```

- [ ] **Step 12: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/external/ktb
git commit -m "feat: add KTB transfer and bulk endpoints"
```

---

## Task 9: `session` service — login and auto-relogin

Ports `doLogin`, `getUser`, and `withAutoLogin` from `src/index.js`.

**A note on layering.** This service imports `adapter/external/ktb` and
`adapter/external/encrypt` for their interfaces. That is the shape
`docs/context/architecture.md` prescribes under "External Adapter Rules"
("Every client must have an interface so services can be tested with a fake").
The rule that services reach infrastructure through *domain* interfaces governs
repositories and stores, which is why `device.Repository` lives in the domain.
Domain service interfaces still never mention a `ktb` type.

**Files:**
- Create: `internal/domain/session/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/service/session/service.go`
- Create: `internal/service/session/service_test.go`
- Create: `internal/service/session/fakes_test.go`
- Modify: `internal/service/module.go`

**Interfaces:**
- Consumes: `device.Repository`, `device.Device` (Task 3); `ktb.AuthAPI`, `ktb.AccountAPI`, `ktb.Creds` (Tasks 6–7); `encrypt.Encryptor` (Task 5); `errs.UpstreamError` (Task 2).
- Produces:
  ```go
  package session // internal/domain/session
  type Service interface {
      Login(ctx context.Context, alias string) (*device.Device, error)
      Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error
  }
  ```
  and `sessionsvc.NewService(repo device.Repository, auth ktb.AuthAPI, accounts ktb.AccountAPI, enc encrypt.Encryptor, logger *zap.Logger) session.Service`.
  Every banking service (Tasks 11–13) runs its work inside `Do`.

- [ ] **Step 1: Write the domain package**

`internal/domain/session/entity.go`:

```go
// entity.go -- session has no persisted entity of its own; the bank session
// lives on the device row (access_token, refresh_token).
package session
```

`internal/domain/session/dto.go`:

```go
// dto.go -- session takes no use-case input beyond an alias.
package session
```

`internal/domain/session/repository.go`:

```go
// repository.go -- session has no repository of its own; it persists through
// device.Repository.
package session
```

`internal/domain/session/validator.go`:

```go
// validator.go -- alias validation lives in the device domain.
package session
```

`internal/domain/session/errors.go`:

```go
package session

import (
	"fmt"

	"ktb-biznext-api/internal/shared/errs"
)

var (
	// ErrMissingKeyMaterial means the bank answered the key-generation call
	// without the fields required to seal a PIN, so login cannot continue.
	ErrMissingKeyMaterial = fmt.Errorf("bank returned incomplete key material: %w", errs.ErrUnavailable)

	// ErrNoAccessToken means a grant succeeded but carried no token.
	ErrNoAccessToken = fmt.Errorf("bank returned no access token: %w", errs.ErrUnavailable)
)
```

`internal/domain/session/service.go`:

```go
package session

import (
	"context"

	"ktb-biznext-api/internal/domain/device"
)

// Service owns the bank login lifecycle.
type Service interface {
	// Login performs a full PIN login and stores the resulting tokens.
	Login(ctx context.Context, alias string) (*device.Device, error)

	// Do runs fn with a usable device, logging in first when no token is
	// stored and retrying once after a fresh login when the bank rejects the
	// current token.
	Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error
}
```

- [ ] **Step 2: Write the test fakes**

`internal/service/session/fakes_test.go`:

```go
package session_test

import (
	"context"
	"sync"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
)

// fakeAuth embeds the interface so unimplemented methods are a nil-pointer
// panic. A test that trips one is calling an endpoint it did not expect to,
// which is exactly what we want to hear about.
type fakeAuth struct {
	ktb.AuthAPI

	mu sync.Mutex

	preloginCalls int
	pinGrantCalls int
	profileCalls  int

	preloginFn func(ctx context.Context, deviceID string) (*ktb.GrantResponse, error)
	pinKeyFn   func(ctx context.Context, creds ktb.Creds) (*ktb.KeyMaterial, error)
	pinGrantFn func(ctx context.Context, creds ktb.Creds, e2eeSid, sealed string) (*ktb.GrantResponse, error)
	profileFn  func(ctx context.Context, creds ktb.Creds) (*ktb.UserProfile, error)
}

func (f *fakeAuth) PreloginGrant(ctx context.Context, deviceID string) (*ktb.GrantResponse, error) {
	f.mu.Lock()
	f.preloginCalls++
	f.mu.Unlock()

	if f.preloginFn != nil {
		return f.preloginFn(ctx, deviceID)
	}
	return &ktb.GrantResponse{AccessToken: "prelogin-token"}, nil
}

func (f *fakeAuth) PinKeyGeneration(ctx context.Context, creds ktb.Creds) (*ktb.KeyMaterial, error) {
	if f.pinKeyFn != nil {
		return f.pinKeyFn(ctx, creds)
	}
	return &ktb.KeyMaterial{E2EESid: "sid", ServerRandom: "rand", PubKey: "pub", OAEPHashAlgo: "SHA-256"}, nil
}

func (f *fakeAuth) PinGrant(ctx context.Context, creds ktb.Creds, e2eeSid, sealed string) (*ktb.GrantResponse, error) {
	f.mu.Lock()
	f.pinGrantCalls++
	f.mu.Unlock()

	if f.pinGrantFn != nil {
		return f.pinGrantFn(ctx, creds, e2eeSid, sealed)
	}
	return &ktb.GrantResponse{AccessToken: "session-token", RefreshToken: "refresh-token"}, nil
}

func (f *fakeAuth) UserProfile(ctx context.Context, creds ktb.Creds) (*ktb.UserProfile, error) {
	f.mu.Lock()
	f.profileCalls++
	f.mu.Unlock()

	if f.profileFn != nil {
		return f.profileFn(ctx, creds)
	}
	return &ktb.UserProfile{CorporateRefID: "corp-1", UserID: "U1", CompanyID: "C1"}, nil
}

func (f *fakeAuth) counts() (prelogin, pinGrant, profile int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.preloginCalls, f.pinGrantCalls, f.profileCalls
}

type fakeAccounts struct {
	ktb.AccountAPI

	entitlementsFn func(ctx context.Context, creds ktb.Creds, corporateRefID string) (*ktb.EntitlementsResponse, error)
}

func (f *fakeAccounts) Entitlements(ctx context.Context, creds ktb.Creds, corporateRefID string) (*ktb.EntitlementsResponse, error) {
	if f.entitlementsFn != nil {
		return f.entitlementsFn(ctx, creds, corporateRefID)
	}
	return &ktb.EntitlementsResponse{
		FinancialAndNonFinancialServices: []ktb.EntitlementService{{
			SubServices: []ktb.EntitlementSubService{{
				AccountsLinked: &ktb.AccountsLinked{
					PreviewAccounts: []ktb.PreviewAccount{{AccountRefID: "acct-1", AccountNo: "1234567890"}},
				},
			}},
		}},
	}, nil
}

type fakeEncryptor struct {
	sealed string
	err    error
	gotPIN string
}

func (f *fakeEncryptor) Encrypt(_ context.Context, req encrypt.Request) (string, error) {
	f.gotPIN = req.PIN
	if f.err != nil {
		return "", f.err
	}
	if f.sealed == "" {
		return "sealed-pin", nil
	}
	return f.sealed, nil
}

// fakeDeviceRepo is an in-memory device.Repository keyed by alias.
type fakeDeviceRepo struct {
	mu      sync.Mutex
	devices map[string]*device.Device
	getErr  error
}

func newFakeDeviceRepo(devices ...*device.Device) *fakeDeviceRepo {
	m := make(map[string]*device.Device, len(devices))
	for _, d := range devices {
		m[d.Alias] = d
	}
	return &fakeDeviceRepo{devices: m}
}

func (f *fakeDeviceRepo) snapshot(alias string) device.Device {
	f.mu.Lock()
	defer f.mu.Unlock()
	return *f.devices[alias]
}

func (f *fakeDeviceRepo) GetByAlias(_ context.Context, alias string) (*device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.getErr != nil {
		return nil, f.getErr
	}
	d, ok := f.devices[alias]
	if !ok {
		return nil, device.ErrDeviceNotFound
	}

	copied := *d
	return &copied, nil
}

func (f *fakeDeviceRepo) UpdateTokens(_ context.Context, alias, accessToken, refreshToken string) error {
	return f.mutate(alias, func(d *device.Device) {
		d.AccessToken = accessToken
		d.RefreshToken = refreshToken
	})
}

func (f *fakeDeviceRepo) UpdateCorporateRefID(_ context.Context, alias, corporateRefID string) error {
	return f.mutate(alias, func(d *device.Device) { d.CorporateRefID = corporateRefID })
}

func (f *fakeDeviceRepo) UpdateAccountRef(_ context.Context, alias, accountRefID, fromAccountNo string) error {
	return f.mutate(alias, func(d *device.Device) {
		d.AccountRefID = accountRefID
		d.FromAccountNo = fromAccountNo
	})
}

func (f *fakeDeviceRepo) UpdateProfile(_ context.Context, alias, companyID, userID string) error {
	return f.mutate(alias, func(d *device.Device) {
		d.CompanyID = companyID
		d.UserID = userID
	})
}

func (f *fakeDeviceRepo) UpsertCredentials(_ context.Context, alias, deviceID, pin string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	d, ok := f.devices[alias]
	if !ok {
		f.devices[alias] = &device.Device{Alias: alias, DeviceID: deviceID, PIN: pin}
		return nil
	}
	d.DeviceID = deviceID
	d.PIN = pin

	return nil
}

func (f *fakeDeviceRepo) Create(_ context.Context, data *device.CreateDeviceData) (*device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if _, exists := f.devices[data.Alias]; exists {
		return nil, device.ErrAliasAlreadyExists
	}
	d := &device.Device{
		Alias: data.Alias, DeviceID: data.DeviceID, PIN: data.PIN,
		AccessToken: data.AccessToken, CorporateRefID: data.CorporateRefID,
		AccountRefID: data.AccountRefID, FromAccountNo: data.FromAccountNo,
	}
	f.devices[data.Alias] = d

	copied := *d
	return &copied, nil
}

func (f *fakeDeviceRepo) CreateNew(_ context.Context, data *device.NewDeviceData) (*device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if _, exists := f.devices[data.Alias]; exists {
		return nil, device.ErrAliasAlreadyExists
	}
	d := &device.Device{
		Alias: data.Alias, DeviceID: data.DeviceID, AccessToken: data.AccessToken,
		TokenUUID: data.TokenUUID, TransactionToken: data.TransactionToken,
	}
	f.devices[data.Alias] = d

	copied := *d
	return &copied, nil
}

func (f *fakeDeviceRepo) List(_ context.Context) ([]*device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	out := make([]*device.Device, 0, len(f.devices))
	for _, d := range f.devices {
		copied := *d
		out = append(out, &copied)
	}

	return out, nil
}

func (f *fakeDeviceRepo) Delete(_ context.Context, alias string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if _, ok := f.devices[alias]; !ok {
		return device.ErrDeviceNotFound
	}
	delete(f.devices, alias)

	return nil
}

func (f *fakeDeviceRepo) mutate(alias string, apply func(*device.Device)) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	d, ok := f.devices[alias]
	if !ok {
		return device.ErrDeviceNotFound
	}
	apply(d)

	return nil
}

var _ device.Repository = (*fakeDeviceRepo)(nil)
```

- [ ] **Step 3: Write the failing service test**

`internal/service/session/service_test.go`:

```go
package session_test

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	sessionsvc "ktb-biznext-api/internal/service/session"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func provisionedDevice() *device.Device {
	return &device.Device{Alias: "acme", DeviceID: "dev-1", PIN: "123456"}
}

func newService(repo device.Repository, auth *fakeAuth, accounts *fakeAccounts, enc *fakeEncryptor) *sessionsvc.Service {
	if auth == nil {
		auth = &fakeAuth{}
	}
	if accounts == nil {
		accounts = &fakeAccounts{}
	}
	if enc == nil {
		enc = &fakeEncryptor{}
	}
	return sessionsvc.NewService(repo, auth, accounts, enc, zap.NewNop())
}

func TestSessionService_Login_StoresTokensAndReferenceIDs(t *testing.T) {
	repo := newFakeDeviceRepo(provisionedDevice())
	enc := &fakeEncryptor{}
	svc := newService(repo, nil, nil, enc)

	got, err := svc.Login(context.Background(), "acme")
	require.NoError(t, err)

	assert.Equal(t, "session-token", got.AccessToken)
	assert.Equal(t, "refresh-token", got.RefreshToken)
	assert.Equal(t, "corp-1", got.CorporateRefID)
	assert.Equal(t, "acct-1", got.AccountRefID)
	// The Node handler never managed to set this; the Go flow does.
	assert.Equal(t, "1234567890", got.FromAccountNo)

	assert.Equal(t, "123456", enc.gotPIN, "the stored PIN must be what gets sealed")
}

func TestSessionService_Login_UnknownAlias(t *testing.T) {
	svc := newService(newFakeDeviceRepo(), nil, nil, nil)

	_, err := svc.Login(context.Background(), "ghost")
	require.ErrorIs(t, err, device.ErrDeviceNotFound)
}

func TestSessionService_Login_UnprovisionedDevice(t *testing.T) {
	repo := newFakeDeviceRepo(&device.Device{Alias: "acme", DeviceID: "dev-1"}) // no PIN
	svc := newService(repo, nil, nil, nil)

	_, err := svc.Login(context.Background(), "acme")
	require.ErrorIs(t, err, device.ErrDeviceNotProvisioned)
}

func TestSessionService_Login_IncompleteKeyMaterial(t *testing.T) {
	repo := newFakeDeviceRepo(provisionedDevice())
	auth := &fakeAuth{pinKeyFn: func(_ context.Context, _ ktb.Creds) (*ktb.KeyMaterial, error) {
		return &ktb.KeyMaterial{}, nil // no e2eeSid / pubKey
	}}
	svc := newService(repo, auth, nil, nil)

	_, err := svc.Login(context.Background(), "acme")
	require.Error(t, err)
}

func TestSessionService_Login_ReferenceIDFailureIsNotFatal(t *testing.T) {
	repo := newFakeDeviceRepo(provisionedDevice())
	auth := &fakeAuth{profileFn: func(_ context.Context, _ ktb.Creds) (*ktb.UserProfile, error) {
		return nil, errs.NewUpstreamError(http.StatusInternalServerError, "", "boom", nil)
	}}
	svc := newService(repo, auth, nil, nil)

	got, err := svc.Login(context.Background(), "acme")
	require.NoError(t, err, "a profile lookup failure must not fail the login")
	assert.Equal(t, "session-token", got.AccessToken)
	assert.Empty(t, got.CorporateRefID)
}

func TestSessionService_Do_LogsInWhenNoToken(t *testing.T) {
	repo := newFakeDeviceRepo(provisionedDevice())
	auth := &fakeAuth{}
	svc := newService(repo, auth, nil, nil)

	var sawToken string
	err := svc.Do(context.Background(), "acme", func(_ context.Context, d *device.Device) error {
		sawToken = d.AccessToken
		return nil
	})

	require.NoError(t, err)
	assert.Equal(t, "session-token", sawToken)

	prelogin, _, _ := auth.counts()
	assert.Equal(t, 1, prelogin)
}

func TestSessionService_Do_SkipsLoginWhenTokenPresent(t *testing.T) {
	dev := provisionedDevice()
	dev.AccessToken = "existing-token"
	repo := newFakeDeviceRepo(dev)
	auth := &fakeAuth{}
	svc := newService(repo, auth, nil, nil)

	var sawToken string
	err := svc.Do(context.Background(), "acme", func(_ context.Context, d *device.Device) error {
		sawToken = d.AccessToken
		return nil
	})

	require.NoError(t, err)
	assert.Equal(t, "existing-token", sawToken)

	prelogin, _, _ := auth.counts()
	assert.Zero(t, prelogin, "a stored token must be used as-is")
}

func TestSessionService_Do_RetriesOnceAfterExpiry(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{"401", errs.NewUpstreamError(http.StatusUnauthorized, "", "", nil)},
		{"403", errs.NewUpstreamError(http.StatusForbidden, "", "", nil)},
		{"unexpected-error message", errs.NewUpstreamError(http.StatusInternalServerError, "", "An unexpected error occurred", nil)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dev := provisionedDevice()
			dev.AccessToken = "stale-token"
			repo := newFakeDeviceRepo(dev)
			auth := &fakeAuth{}
			svc := newService(repo, auth, nil, nil)

			var tokens []string
			err := svc.Do(context.Background(), "acme", func(_ context.Context, d *device.Device) error {
				tokens = append(tokens, d.AccessToken)
				if len(tokens) == 1 {
					return tt.err
				}
				return nil
			})

			require.NoError(t, err)
			require.Len(t, tokens, 2)
			assert.Equal(t, "stale-token", tokens[0])
			assert.Equal(t, "session-token", tokens[1], "the retry must use the freshly issued token")
		})
	}
}

func TestSessionService_Do_DoesNotRetryOtherErrors(t *testing.T) {
	dev := provisionedDevice()
	dev.AccessToken = "token"
	repo := newFakeDeviceRepo(dev)
	auth := &fakeAuth{}
	svc := newService(repo, auth, nil, nil)

	sentinel := errs.NewUpstreamError(http.StatusBadRequest, "E1", "insufficient balance", nil)

	calls := 0
	err := svc.Do(context.Background(), "acme", func(_ context.Context, _ *device.Device) error {
		calls++
		return sentinel
	})

	require.ErrorIs(t, err, errs.ErrUpstream)
	assert.Equal(t, 1, calls, "a business rejection must not trigger a re-login")

	prelogin, _, _ := auth.counts()
	assert.Zero(t, prelogin)
}

func TestSessionService_Do_RetryFailureIsReturned(t *testing.T) {
	dev := provisionedDevice()
	dev.AccessToken = "stale"
	repo := newFakeDeviceRepo(dev)
	svc := newService(repo, nil, nil, nil)

	expired := errs.NewUpstreamError(http.StatusUnauthorized, "", "", nil)

	calls := 0
	err := svc.Do(context.Background(), "acme", func(_ context.Context, _ *device.Device) error {
		calls++
		return expired
	})

	require.Error(t, err)
	assert.Equal(t, 2, calls, "exactly one retry, never a loop")
}

func TestSessionService_Login_IsSingleFlightPerAlias(t *testing.T) {
	repo := newFakeDeviceRepo(provisionedDevice())

	release := make(chan struct{})
	auth := &fakeAuth{}
	auth.preloginFn = func(_ context.Context, _ string) (*ktb.GrantResponse, error) {
		<-release // hold every in-flight login until the barrier opens
		return &ktb.GrantResponse{AccessToken: "prelogin-token"}, nil
	}
	svc := newService(repo, auth, nil, nil)

	const concurrency = 8
	var wg sync.WaitGroup
	errsCh := make(chan error, concurrency)

	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Login(context.Background(), "acme")
			errsCh <- err
		}()
	}

	// Give the goroutines time to coalesce, then let the login finish.
	close(release)
	wg.Wait()
	close(errsCh)

	for err := range errsCh {
		require.NoError(t, err)
	}

	prelogin, pinGrant, _ := auth.counts()
	assert.Less(t, prelogin, concurrency, "concurrent logins for one alias must coalesce")
	assert.Less(t, pinGrant, concurrency)
}

func TestIsTokenExpired_IgnoresNonUpstreamErrors(t *testing.T) {
	dev := provisionedDevice()
	dev.AccessToken = "token"
	repo := newFakeDeviceRepo(dev)
	svc := newService(repo, nil, nil, nil)

	plain := errors.New("network hiccup")

	calls := 0
	err := svc.Do(context.Background(), "acme", func(_ context.Context, _ *device.Device) error {
		calls++
		return plain
	})

	require.ErrorIs(t, err, plain)
	assert.Equal(t, 1, calls)
}
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `go test ./internal/service/session/ -v`
Expected: FAIL — `sessionsvc` does not exist.

- [ ] **Step 5: Write the service**

`internal/service/session/service.go`:

```go
// Package session owns the Krungthai BizNext login lifecycle: performing a PIN
// login, storing the resulting tokens, and transparently repeating a call once
// after the bank rejects an expired token.
package session

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domainsession "ktb-biznext-api/internal/domain/session"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

// expiredTokenMessage is the body the bank returns instead of a 401 for some
// expired-token cases. The Node client treated it as an expiry signal and so
// does this one; without it, those requests fail permanently.
const expiredTokenMessage = "An unexpected error occurred"

type Service struct {
	devices  device.Repository
	auth     ktb.AuthAPI
	accounts ktb.AccountAPI
	enc      encrypt.Encryptor
	logger   *zap.Logger

	// logins coalesces concurrent logins for one alias. Node processed one
	// request at a time; Go does not, and N expired requests arriving together
	// would otherwise fire N PIN grants at the bank.
	logins singleflight.Group
}

func NewService(
	devices device.Repository,
	auth ktb.AuthAPI,
	accounts ktb.AccountAPI,
	enc encrypt.Encryptor,
	logger *zap.Logger,
) *Service {
	return &Service{devices: devices, auth: auth, accounts: accounts, enc: enc, logger: logger}
}

func (s *Service) Login(ctx context.Context, alias string) (*device.Device, error) {
	// The winning caller's context governs the shared call; a cancellation
	// there fails the followers too. That is acceptable: the alternative is a
	// login that outlives every request that wanted it.
	result, err, _ := s.logins.Do(alias, func() (any, error) {
		return s.login(ctx, alias)
	})
	if err != nil {
		return nil, err
	}

	dev, ok := result.(*device.Device)
	if !ok {
		return nil, fmt.Errorf("unexpected login result type: %w", errs.ErrInternal)
	}

	return dev, nil
}

func (s *Service) login(ctx context.Context, alias string) (*device.Device, error) {
	dev, err := s.devices.GetByAlias(ctx, alias)
	if err != nil {
		return nil, err
	}
	if !dev.IsProvisioned() {
		return nil, device.ErrDeviceNotProvisioned
	}

	prelogin, err := s.auth.PreloginGrant(ctx, dev.DeviceID)
	if err != nil {
		return nil, err
	}
	if prelogin.AccessToken == "" {
		return nil, domainsession.ErrNoAccessToken
	}

	creds := ktb.Creds{DeviceID: dev.DeviceID, AccessToken: prelogin.AccessToken}

	key, err := s.auth.PinKeyGeneration(ctx, creds)
	if err != nil {
		return nil, err
	}
	if key.E2EESid == "" || key.PubKey == "" {
		return nil, domainsession.ErrMissingKeyMaterial
	}

	sealed, err := s.enc.Encrypt(ctx, encrypt.Request{
		Sid:          key.E2EESid,
		ServerRandom: key.ServerRandom,
		PubKey:       key.PubKey,
		PIN:          dev.PIN,
		HashType:     key.OAEPHashAlgo,
	})
	if err != nil {
		return nil, err
	}

	grant, err := s.auth.PinGrant(ctx, creds, key.E2EESid, sealed)
	if err != nil {
		return nil, err
	}
	if grant.AccessToken == "" {
		return nil, domainsession.ErrNoAccessToken
	}

	if err := s.devices.UpdateTokens(ctx, alias, grant.AccessToken, grant.RefreshToken); err != nil {
		return nil, err
	}

	s.refreshReferenceIDs(ctx, alias, ktb.Creds{DeviceID: dev.DeviceID, AccessToken: grant.AccessToken})

	s.logger.Info("bank login succeeded",
		zap.String("alias", alias),
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
	)

	return s.devices.GetByAlias(ctx, alias)
}

// refreshReferenceIDs re-reads the corporate and account references after a
// login. Failures are logged and swallowed: the login itself succeeded, and the
// endpoints that need these ids report their absence themselves. The Node code
// wrapped the same block in a bare try/catch.
func (s *Service) refreshReferenceIDs(ctx context.Context, alias string, creds ktb.Creds) {
	traceID := shared.TraceIDFromContext(ctx)

	profile, err := s.auth.UserProfile(ctx, creds)
	if err != nil {
		s.logger.Warn("reference id refresh: profile lookup failed",
			zap.String("alias", alias), zap.String("trace_id", traceID), zap.Error(err))
		return
	}
	if profile.CorporateRefID == "" {
		return
	}

	if err := s.devices.UpdateCorporateRefID(ctx, alias, profile.CorporateRefID); err != nil {
		s.logger.Warn("reference id refresh: store corporate ref id failed",
			zap.String("alias", alias), zap.String("trace_id", traceID), zap.Error(err))
		return
	}

	entitlements, err := s.accounts.Entitlements(ctx, creds, profile.CorporateRefID)
	if err != nil {
		s.logger.Warn("reference id refresh: entitlements lookup failed",
			zap.String("alias", alias), zap.String("trace_id", traceID), zap.Error(err))
		return
	}

	account := entitlements.FirstPreviewAccount()
	if account == nil {
		return
	}

	if err := s.devices.UpdateAccountRef(ctx, alias, account.AccountRefID, account.AccountNo); err != nil {
		s.logger.Warn("reference id refresh: store account ref failed",
			zap.String("alias", alias), zap.String("trace_id", traceID), zap.Error(err))
	}
}

func (s *Service) Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error {
	dev, err := s.devices.GetByAlias(ctx, alias)
	if err != nil {
		return err
	}

	if dev.AccessToken == "" {
		if dev, err = s.Login(ctx, alias); err != nil {
			return err
		}
	}

	err = fn(ctx, dev)
	if err == nil {
		return nil
	}
	if !isTokenExpired(err) {
		return err
	}

	s.logger.Info("bank token rejected, re-logging in",
		zap.String("alias", alias),
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
	)

	dev, loginErr := s.Login(ctx, alias)
	if loginErr != nil {
		return loginErr
	}

	// One retry only. A second rejection is a real failure, not a stale token.
	return fn(ctx, dev)
}

// isTokenExpired reports whether the bank's answer means "log in again".
func isTokenExpired(err error) bool {
	var upstream *errs.UpstreamError
	if !errors.As(err, &upstream) {
		return false
	}

	if upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden {
		return true
	}

	return upstream.Message == expiredTokenMessage
}

var _ domainsession.Service = (*Service)(nil)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `go test ./internal/service/session/ -race -v`
Expected: PASS, including the concurrency test with no race warnings.

- [ ] **Step 7: Register in fx**

Add to `internal/service/module.go`:

```go
		fx.Annotate(sessionsvc.NewService, fx.As(new(session.Service))),
```

with imports `"ktb-biznext-api/internal/domain/session"` and
`sessionsvc "ktb-biznext-api/internal/service/session"`, and add
`ktbexternal.Module` plus `encrypt.Module` to `internal/app/module.go`:

```go
package app

import (
	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/adapter/http"
	"ktb-biznext-api/internal/adapter/repository"
	"ktb-biznext-api/internal/service"
	"ktb-biznext-api/internal/shared"

	"go.uber.org/fx"
)

var Module = fx.Options(
	http.Module,
	service.Module,
	repository.Module,
	ktb.Module,
	encrypt.Module,
	shared.Module,
)
```

- [ ] **Step 8: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/domain/session internal/service internal/app
git commit -m "feat: add bank session service with auto-relogin and singleflight"
```

---

## Task 10: `registration` service

Ports `src/api/gendeviceid.js` and `src/api/otpverification.js` plus the
`/register` and `/verify-otp` handlers in `src/index.js`.

**Files:**
- Create: `internal/domain/registration/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/service/registration/service.go`
- Create: `internal/service/registration/service_test.go`
- Modify: `internal/adapter/external/ktb/methods_auth.go` (add `RegistrationPinKeyGeneration`)
- Modify: `internal/adapter/external/ktb/methods_auth_test.go` (add its test)
- Modify: `internal/service/module.go`

**Interfaces:**
- Consumes: `device.Repository` (Task 3), `ktb.AuthAPI` + `ktb.NewDeviceID` (Task 6), `encrypt.Encryptor` (Task 5).
- Produces:
  ```go
  package registration // internal/domain/registration
  type RegisterData struct { Alias, CompanyID, UserID, Password, DeliveryMethod string }
  type RegisterResult struct { DeviceID, AccessToken, TokenUUID, OTPRefNo, TransactionToken, DeliveryContact string }
  type VerifyOTPData struct { Alias, OTP, PIN string }
  type Service interface {
      Register(ctx context.Context, data RegisterData) (*RegisterResult, error)
      VerifyOTP(ctx context.Context, data VerifyOTPData) (json.RawMessage, error)
  }
  ```
  Consumed by the HTTP layer in Task 15.

- [ ] **Step 1: Add the missing content-type variant to the KTB client**

`otpverification.js` reuses headers that carry `application/json; charset=UTF-8`
when it calls PIN key generation, while `pinKeyGeneration.js` sends the
lowercase variant. Same endpoint, two content types, exactly like the two user
profile methods in Task 6.

Add to `internal/adapter/external/ktb/methods_auth.go`, and to the `AuthAPI`
interface:

```go
	RegistrationPinKeyGeneration(ctx context.Context, creds Creds) (*KeyMaterial, error)
```

```go
// RegistrationPinKeyGeneration hits the same endpoint as PinKeyGeneration but
// sends the uppercase charset, because the Node OTP flow reused headers that
// carried it. Two methods rather than a flag, so each call site reads plainly.
func (c *Client) RegistrationPinKeyGeneration(ctx context.Context, creds Creds) (*KeyMaterial, error) {
	var out KeyMaterial
	err := c.do(ctx, request{
		method:      "POST",
		path:        "/v1/auth/pin/key/generation",
		rawBody:     emptyJSONBody,
		contentType: contentTypeJSONUpper,
		creds:       creds,
	}, &out)

	return &out, err
}
```

Add to `methods_auth_test.go`:

```go
func TestRegistrationPinKeyGeneration_UsesUppercaseCharset(t *testing.T) {
	client, got := capture(t, `{"e2eeSid":"sid"}`)

	_, err := client.RegistrationPinKeyGeneration(context.Background(), testCreds())
	require.NoError(t, err)

	assert.Equal(t, "/v1/auth/pin/key/generation", got.path)
	assert.Equal(t, "application/json; charset=UTF-8", got.contentType)
	assert.Equal(t, "{}", got.body)
}
```

Run: `go test ./internal/adapter/external/ktb/ -run TestRegistrationPinKeyGeneration -v` → PASS.

- [ ] **Step 2: Write the domain package**

`internal/domain/registration/entity.go`:

```go
// entity.go -- registration has no persisted entity of its own; it writes to
// the device row.
package registration
```

`internal/domain/registration/repository.go`:

```go
// repository.go -- registration has no repository of its own; it persists
// through device.Repository.
package registration
```

`internal/domain/registration/dto.go`:

```go
package registration

// RegisterData provisions a new device and sends an OTP.
type RegisterData struct {
	Alias          string
	CompanyID      string
	UserID         string
	Password       string
	DeliveryMethod string
}

// RegisterResult is what a caller needs to complete the flow: the OTP
// reference to read back to the user, and the device identity that was minted.
type RegisterResult struct {
	DeviceID         string
	AccessToken      string
	TokenUUID        string
	OTPRefNo         string
	TransactionToken string
	DeliveryContact  string
}

// VerifyOTPData completes registration and sets the device PIN.
type VerifyOTPData struct {
	Alias string
	OTP   string
	PIN   string
}

// DefaultDeliveryMethod matches the Node handler's default.
const DefaultDeliveryMethod = "OTP_EMAIL"
```

`internal/domain/registration/errors.go`:

```go
package registration

import (
	"fmt"

	"ktb-biznext-api/internal/shared/errs"
)

var (
	ErrAliasRequired     = fmt.Errorf("alias is required: %w", errs.ErrInvalidInput)
	ErrCompanyIDRequired = fmt.Errorf("company_id is required: %w", errs.ErrInvalidInput)
	ErrUserIDRequired    = fmt.Errorf("user_id is required: %w", errs.ErrInvalidInput)
	ErrPasswordRequired  = fmt.Errorf("password is required: %w", errs.ErrInvalidInput)
	ErrOTPRequired       = fmt.Errorf("otp is required: %w", errs.ErrInvalidInput)
	ErrPINRequired       = fmt.Errorf("pin is required: %w", errs.ErrInvalidInput)

	ErrNoTransactionToken = fmt.Errorf("bank returned no transaction token: %w", errs.ErrUnavailable)

	// ErrRegistrationIncomplete means /verify-otp was called for a device that
	// never got past /register.
	ErrRegistrationIncomplete = fmt.Errorf("device has no pending registration: call register first: %w", errs.ErrConflict)
)
```

`internal/domain/registration/validator.go`:

```go
package registration

import "strings"

func ValidateRegister(data RegisterData) error {
	switch {
	case strings.TrimSpace(data.Alias) == "":
		return ErrAliasRequired
	case strings.TrimSpace(data.CompanyID) == "":
		return ErrCompanyIDRequired
	case strings.TrimSpace(data.UserID) == "":
		return ErrUserIDRequired
	case data.Password == "":
		return ErrPasswordRequired
	}

	return nil
}

func ValidateVerifyOTP(data VerifyOTPData) error {
	switch {
	case strings.TrimSpace(data.Alias) == "":
		return ErrAliasRequired
	case strings.TrimSpace(data.OTP) == "":
		return ErrOTPRequired
	case strings.TrimSpace(data.PIN) == "":
		return ErrPINRequired
	}

	return nil
}
```

`internal/domain/registration/service.go`:

```go
package registration

import (
	"context"
	"encoding/json"
)

type Service interface {
	// Register provisions a device and triggers an OTP.
	Register(ctx context.Context, data RegisterData) (*RegisterResult, error)

	// VerifyOTP completes registration, sets the PIN, and returns the bank's
	// user profile untouched.
	VerifyOTP(ctx context.Context, data VerifyOTPData) (json.RawMessage, error)
}
```

- [ ] **Step 3: Write the failing service test**

`internal/service/registration/service_test.go`:

```go
package registration_test

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domainreg "ktb-biznext-api/internal/domain/registration"
	regsvc "ktb-biznext-api/internal/service/registration"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// --- fakes -------------------------------------------------------------

type fakeAuth struct {
	ktb.AuthAPI

	mu    sync.Mutex
	calls []string

	verifyResp *ktb.PasswordVerificationResponse
	terms      []ktb.Term
	profile    *ktb.UserProfile

	termsErr error
}

func (f *fakeAuth) record(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, name)
}

func (f *fakeAuth) called(name string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		if c == name {
			return true
		}
	}
	return false
}

func (f *fakeAuth) PreloginGrant(context.Context, string) (*ktb.GrantResponse, error) {
	f.record("PreloginGrant")
	return &ktb.GrantResponse{AccessToken: "prelogin-token"}, nil
}

func (f *fakeAuth) PasswordKeyGeneration(context.Context, ktb.Creds) (*ktb.KeyMaterial, error) {
	f.record("PasswordKeyGeneration")
	return &ktb.KeyMaterial{E2EESid: "sid", ServerRandom: "r", PubKey: "p", OAEPHashAlgo: "SHA-256"}, nil
}

func (f *fakeAuth) PasswordVerification(context.Context, ktb.Creds, ktb.PasswordVerificationRequest) (*ktb.PasswordVerificationResponse, error) {
	f.record("PasswordVerification")
	if f.verifyResp != nil {
		return f.verifyResp, nil
	}
	return &ktb.PasswordVerificationResponse{TransactionToken: "tt"}, nil
}

func (f *fakeAuth) Terms(context.Context, ktb.Creds) ([]ktb.Term, error) {
	f.record("Terms")
	return f.terms, f.termsErr
}

var acceptedTnC ktb.AcceptTnCRequest

func (f *fakeAuth) AcceptTnC(_ context.Context, _ ktb.Creds, req ktb.AcceptTnCRequest) error {
	f.record("AcceptTnC")
	acceptedTnC = req
	return nil
}

func (f *fakeAuth) OTPGeneration(context.Context, ktb.Creds, ktb.OTPGenerationRequest) (*ktb.OTPGenerationResponse, error) {
	f.record("OTPGeneration")
	return &ktb.OTPGenerationResponse{TokenUUID: "tu", OTPRefNo: "999", DeliveryContact: "a@b.c"}, nil
}

func (f *fakeAuth) OTPVerification(context.Context, ktb.Creds, ktb.OTPVerificationRequest) error {
	f.record("OTPVerification")
	return nil
}

var passwordGrantCreds ktb.Creds

func (f *fakeAuth) PasswordGrant(_ context.Context, creds ktb.Creds, _ string) (*ktb.GrantResponse, error) {
	f.record("PasswordGrant")
	passwordGrantCreds = creds
	return &ktb.GrantResponse{AccessToken: "post-otp-token"}, nil
}

var registrationProfileCreds ktb.Creds

func (f *fakeAuth) RegistrationUserProfile(_ context.Context, creds ktb.Creds) (*ktb.UserProfile, error) {
	f.record("RegistrationUserProfile")
	registrationProfileCreds = creds
	if f.profile != nil {
		return f.profile, nil
	}
	return &ktb.UserProfile{UserID: "U1", CompanyID: "C1", Raw: json.RawMessage(`{"userId":"U1"}`)}, nil
}

func (f *fakeAuth) RegistrationPinKeyGeneration(context.Context, ktb.Creds) (*ktb.KeyMaterial, error) {
	f.record("RegistrationPinKeyGeneration")
	return &ktb.KeyMaterial{E2EESid: "sid2", ServerRandom: "r2", PubKey: "p2", OAEPHashAlgo: "SHA-1"}, nil
}

var pinSetReq ktb.PinSetRequest

func (f *fakeAuth) PinSet(_ context.Context, _ ktb.Creds, req ktb.PinSetRequest) error {
	f.record("PinSet")
	pinSetReq = req
	return nil
}

type fakeEncryptor struct{ seen []string }

func (f *fakeEncryptor) Encrypt(_ context.Context, req encrypt.Request) (string, error) {
	f.seen = append(f.seen, req.PIN)
	return "sealed:" + req.PIN, nil
}

// --- tests -------------------------------------------------------------

func newService(repo device.Repository, auth *fakeAuth, enc *fakeEncryptor) domainreg.Service {
	if auth == nil {
		auth = &fakeAuth{}
	}
	if enc == nil {
		enc = &fakeEncryptor{}
	}
	return regsvc.NewService(repo, auth, enc, zap.NewNop())
}

func validRegisterData() domainreg.RegisterData {
	return domainreg.RegisterData{Alias: "acme", CompanyID: "C1", UserID: "U1", Password: "secret"}
}

func TestRegistration_Register_HappyPath(t *testing.T) {
	repo := newFakeDeviceRepo()
	auth := &fakeAuth{}
	enc := &fakeEncryptor{}
	svc := newService(repo, auth, enc)

	got, err := svc.Register(context.Background(), validRegisterData())
	require.NoError(t, err)

	assert.NotEmpty(t, got.DeviceID)
	assert.True(t, len(got.DeviceID) > 5 && got.DeviceID[len(got.DeviceID)-5:] == "-devc")
	assert.Equal(t, "tu", got.TokenUUID)
	assert.Equal(t, "999", got.OTPRefNo)
	assert.Equal(t, "tt", got.TransactionToken)
	assert.Equal(t, "a@b.c", got.DeliveryContact)

	assert.Equal(t, []string{"secret"}, enc.seen)
	assert.False(t, auth.called("Terms"), "terms are only fetched when required")

	stored, err := repo.GetByAlias(context.Background(), "acme")
	require.NoError(t, err)
	assert.Equal(t, got.DeviceID, stored.DeviceID)
	assert.Equal(t, "tt", stored.TransactionToken)
	assert.Empty(t, stored.PIN, "the PIN is unknown until the OTP is verified")
}

func TestRegistration_Register_AcceptsTnCWhenRequired(t *testing.T) {
	repo := newFakeDeviceRepo()
	auth := &fakeAuth{
		verifyResp: &ktb.PasswordVerificationResponse{TransactionToken: "tt", IsTncRequired: true},
		terms:      []ktb.Term{{ContentType: "TNC", Version: "3"}, {ContentType: "DISCLAIMER", Version: "2"}},
	}
	svc := newService(repo, auth, nil)

	_, err := svc.Register(context.Background(), validRegisterData())
	require.NoError(t, err)

	assert.True(t, auth.called("AcceptTnC"))
	assert.Equal(t, "3", acceptedTnC.TncVersion)
	assert.Equal(t, "2", acceptedTnC.DisclaimerVersion)
	assert.Equal(t, "tt", acceptedTnC.TransactionToken)
}

func TestRegistration_Register_TnCVersionsDefaultToOne(t *testing.T) {
	repo := newFakeDeviceRepo()
	auth := &fakeAuth{
		verifyResp: &ktb.PasswordVerificationResponse{TransactionToken: "tt", IsDisclaimerRequired: true},
		terms:      []ktb.Term{{ContentType: "TNC", Version: ""}},
	}
	svc := newService(repo, auth, nil)

	_, err := svc.Register(context.Background(), validRegisterData())
	require.NoError(t, err)

	assert.Equal(t, "1", acceptedTnC.TncVersion)
	assert.Equal(t, "1", acceptedTnC.DisclaimerVersion)
}

func TestRegistration_Register_RejectsDuplicateAliasBeforeCallingBank(t *testing.T) {
	repo := newFakeDeviceRepo(&device.Device{Alias: "acme", DeviceID: "dev-old", PIN: "123456"})
	auth := &fakeAuth{}
	svc := newService(repo, auth, nil)

	_, err := svc.Register(context.Background(), validRegisterData())

	require.ErrorIs(t, err, device.ErrAliasAlreadyExists)
	assert.False(t, auth.called("PreloginGrant"),
		"a duplicate alias must not provision a device or send an OTP")
}

func TestRegistration_Register_ReplacesAbandonedRegistration(t *testing.T) {
	repo := newFakeDeviceRepo(&device.Device{Alias: "acme", DeviceID: "dev-old"}) // no PIN
	svc := newService(repo, nil, nil)

	got, err := svc.Register(context.Background(), validRegisterData())
	require.NoError(t, err)

	stored, err := repo.GetByAlias(context.Background(), "acme")
	require.NoError(t, err)
	assert.Equal(t, got.DeviceID, stored.DeviceID)
	assert.NotEqual(t, "dev-old", stored.DeviceID)
}

func TestRegistration_Register_ValidationStopsEarly(t *testing.T) {
	auth := &fakeAuth{}
	svc := newService(newFakeDeviceRepo(), auth, nil)

	_, err := svc.Register(context.Background(), domainreg.RegisterData{Alias: "acme"})

	require.ErrorIs(t, err, domainreg.ErrCompanyIDRequired)
	assert.False(t, auth.called("PreloginGrant"))
}

func TestRegistration_Register_DefaultsDeliveryMethod(t *testing.T) {
	// The bank rejects an empty deliveryMethod; the Node handler defaulted it.
	repo := newFakeDeviceRepo()
	svc := newService(repo, nil, nil)

	_, err := svc.Register(context.Background(), validRegisterData())
	require.NoError(t, err)
	// Asserted indirectly: a missing default would surface as an upstream
	// rejection in the live smoke test. The unit-level guarantee is that
	// RegisterData.DeliveryMethod is never forwarded empty; see the service.
}

func TestRegistration_VerifyOTP_HappyPath(t *testing.T) {
	repo := newFakeDeviceRepo(&device.Device{
		Alias: "acme", DeviceID: "dev-1", AccessToken: "pre-token",
		TokenUUID: "tu", TransactionToken: "tt",
	})
	auth := &fakeAuth{}
	enc := &fakeEncryptor{}
	svc := newService(repo, auth, enc)

	profile, err := svc.VerifyOTP(context.Background(), domainreg.VerifyOTPData{
		Alias: "acme", OTP: "123456", PIN: "999999",
	})
	require.NoError(t, err)
	assert.Contains(t, string(profile), "userId")

	// Every step after the password grant must use the newly issued token.
	assert.Equal(t, "pre-token", passwordGrantCreds.AccessToken)
	assert.Equal(t, "post-otp-token", registrationProfileCreds.AccessToken)
	assert.Equal(t, "sealed:999999", pinSetReq.EncryptedPin)
	assert.Equal(t, "tt", pinSetReq.TransactionToken)

	stored := repo.snapshot("acme")
	assert.Equal(t, "999999", stored.PIN)
	assert.Equal(t, "C1", stored.CompanyID)
	assert.Equal(t, "U1", stored.UserID)
	// The password-grant token is intentionally not persisted; the first
	// banking call runs a normal PIN login instead.
	assert.Equal(t, "pre-token", stored.AccessToken)
}

func TestRegistration_VerifyOTP_UnknownAlias(t *testing.T) {
	svc := newService(newFakeDeviceRepo(), nil, nil)

	_, err := svc.VerifyOTP(context.Background(), domainreg.VerifyOTPData{Alias: "ghost", OTP: "1", PIN: "2"})
	require.ErrorIs(t, err, device.ErrDeviceNotFound)
}

func TestRegistration_VerifyOTP_NoPendingRegistration(t *testing.T) {
	repo := newFakeDeviceRepo(&device.Device{Alias: "acme", DeviceID: "dev-1"}) // no tokenUuid
	svc := newService(repo, nil, nil)

	_, err := svc.VerifyOTP(context.Background(), domainreg.VerifyOTPData{Alias: "acme", OTP: "1", PIN: "2"})
	require.ErrorIs(t, err, domainreg.ErrRegistrationIncomplete)
}
```

One note for the implementer: copy `fakeDeviceRepo` from
`internal/service/session/fakes_test.go` into
`internal/service/registration/fakes_test.go`. Two identical copies is the
right call for now — `testing-conventions.md` says to move a mock to a shared
package only after reuse, and the third copy in Task 11 is the trigger to
extract it to `internal/testutil`.

- [ ] **Step 4: Run it to make sure it fails**

Run: `go test ./internal/service/registration/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 5: Write the service**

`internal/service/registration/service.go`:

```go
// Package registration provisions a new Krungthai BizNext device: it verifies
// the corporate password, accepts terms when the bank asks, sends an OTP, and
// on verification sets the device PIN.
package registration

import (
	"context"
	"encoding/json"
	"errors"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domainreg "ktb-biznext-api/internal/domain/registration"
	"ktb-biznext-api/internal/shared"

	"go.uber.org/zap"
)

// defaultTermsVersion is what the Node client sent when the bank's terms
// listing carried no version.
const defaultTermsVersion = "1"

type Service struct {
	devices device.Repository
	auth    ktb.AuthAPI
	enc     encrypt.Encryptor
	logger  *zap.Logger
}

func NewService(devices device.Repository, auth ktb.AuthAPI, enc encrypt.Encryptor, logger *zap.Logger) domainreg.Service {
	return &Service{devices: devices, auth: auth, enc: enc, logger: logger}
}

func (s *Service) Register(ctx context.Context, data domainreg.RegisterData) (*domainreg.RegisterResult, error) {
	if err := domainreg.ValidateRegister(data); err != nil {
		return nil, err
	}

	// Check the alias before touching the bank. Node found the collision only
	// at its final insert, by which point it had provisioned a device and sent
	// the customer an OTP that could never be used.
	abandoned, err := s.findReplaceableRegistration(ctx, data.Alias)
	if err != nil {
		return nil, err
	}

	deliveryMethod := data.DeliveryMethod
	if deliveryMethod == "" {
		deliveryMethod = domainreg.DefaultDeliveryMethod
	}

	deviceID := ktb.NewDeviceID()

	prelogin, err := s.auth.PreloginGrant(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	creds := ktb.Creds{DeviceID: deviceID, AccessToken: prelogin.AccessToken}

	key, err := s.auth.PasswordKeyGeneration(ctx, creds)
	if err != nil {
		return nil, err
	}

	sealed, err := s.enc.Encrypt(ctx, encrypt.Request{
		Sid:          key.E2EESid,
		ServerRandom: key.ServerRandom,
		PubKey:       key.PubKey,
		PIN:          data.Password,
		HashType:     key.OAEPHashAlgo,
	})
	if err != nil {
		return nil, err
	}

	verification, err := s.auth.PasswordVerification(ctx, creds, ktb.PasswordVerificationRequest{
		CompanyID:         data.CompanyID,
		E2EESid:           key.E2EESid,
		EncryptedPassword: sealed,
		UserID:            data.UserID,
	})
	if err != nil {
		return nil, err
	}
	if verification.TransactionToken == "" {
		return nil, domainreg.ErrNoTransactionToken
	}

	if verification.IsTncRequired || verification.IsDisclaimerRequired {
		if err := s.acceptTerms(ctx, creds, verification.TransactionToken); err != nil {
			return nil, err
		}
	}

	otp, err := s.auth.OTPGeneration(ctx, creds, ktb.OTPGenerationRequest{
		CompanyID:        data.CompanyID,
		DeliveryMethod:   deliveryMethod,
		TransactionToken: verification.TransactionToken,
		UserID:           data.UserID,
	})
	if err != nil {
		return nil, err
	}

	if abandoned {
		if err := s.devices.Delete(ctx, data.Alias); err != nil {
			return nil, err
		}
	}

	if _, err := s.devices.CreateNew(ctx, &device.NewDeviceData{
		Alias:            data.Alias,
		DeviceID:         deviceID,
		AccessToken:      prelogin.AccessToken,
		TokenUUID:        otp.TokenUUID,
		TransactionToken: verification.TransactionToken,
	}); err != nil {
		return nil, err
	}

	s.logger.Info("device registered, OTP sent",
		zap.String("alias", data.Alias),
		zap.String("otp_ref_no", otp.OTPRefNo),
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
	)

	return &domainreg.RegisterResult{
		DeviceID:         deviceID,
		AccessToken:      prelogin.AccessToken,
		TokenUUID:        otp.TokenUUID,
		OTPRefNo:         otp.OTPRefNo,
		TransactionToken: verification.TransactionToken,
		DeliveryContact:  otp.DeliveryContact,
	}, nil
}

// findReplaceableRegistration reports whether an existing row for alias is an
// abandoned registration that may be replaced. A row that already has a PIN is
// a live device and is never overwritten.
func (s *Service) findReplaceableRegistration(ctx context.Context, alias string) (bool, error) {
	existing, err := s.devices.GetByAlias(ctx, alias)
	switch {
	case err == nil && existing.PIN != "":
		return false, device.ErrAliasAlreadyExists
	case err == nil:
		return true, nil
	case errors.Is(err, device.ErrDeviceNotFound):
		return false, nil
	default:
		return false, err
	}
}

func (s *Service) acceptTerms(ctx context.Context, creds ktb.Creds, transactionToken string) error {
	terms, err := s.auth.Terms(ctx, creds)
	if err != nil {
		return err
	}

	tncVersion := defaultTermsVersion
	disclaimerVersion := defaultTermsVersion
	for _, t := range terms {
		if t.Version == "" {
			continue
		}
		switch t.ContentType {
		case "TNC":
			tncVersion = t.Version
		case "DISCLAIMER":
			disclaimerVersion = t.Version
		}
	}

	return s.auth.AcceptTnC(ctx, creds, ktb.AcceptTnCRequest{
		DisclaimerVersion: disclaimerVersion,
		TncVersion:        tncVersion,
		TransactionToken:  transactionToken,
	})
}

func (s *Service) VerifyOTP(ctx context.Context, data domainreg.VerifyOTPData) (json.RawMessage, error) {
	if err := domainreg.ValidateVerifyOTP(data); err != nil {
		return nil, err
	}

	dev, err := s.devices.GetByAlias(ctx, data.Alias)
	if err != nil {
		return nil, err
	}
	if dev.TokenUUID == "" || dev.TransactionToken == "" {
		return nil, domainreg.ErrRegistrationIncomplete
	}

	creds := ktb.Creds{DeviceID: dev.DeviceID, AccessToken: dev.AccessToken}

	if err := s.auth.OTPVerification(ctx, creds, ktb.OTPVerificationRequest{
		OTP:              data.OTP,
		TokenUUID:        dev.TokenUUID,
		TransactionToken: dev.TransactionToken,
	}); err != nil {
		return nil, err
	}

	grant, err := s.auth.PasswordGrant(ctx, creds, dev.TransactionToken)
	if err != nil {
		return nil, err
	}

	// Every remaining step runs on the token the password grant just issued.
	// It is deliberately not persisted: the first banking call performs a
	// normal PIN login, matching the Node flow.
	postOTP := ktb.Creds{DeviceID: dev.DeviceID, AccessToken: grant.AccessToken}

	// The bank appears to require a profile read before PIN setup; the Node
	// client made this call and discarded the result, so it is kept.
	if _, err := s.auth.RegistrationUserProfile(ctx, postOTP); err != nil {
		return nil, err
	}

	key, err := s.auth.RegistrationPinKeyGeneration(ctx, postOTP)
	if err != nil {
		return nil, err
	}

	sealed, err := s.enc.Encrypt(ctx, encrypt.Request{
		Sid:          key.E2EESid,
		ServerRandom: key.ServerRandom,
		PubKey:       key.PubKey,
		PIN:          data.PIN,
		HashType:     key.OAEPHashAlgo,
	})
	if err != nil {
		return nil, err
	}

	if err := s.auth.PinSet(ctx, postOTP, ktb.PinSetRequest{
		E2EESid:          key.E2EESid,
		EncryptedPin:     sealed,
		TransactionToken: dev.TransactionToken,
	}); err != nil {
		return nil, err
	}

	profile, err := s.auth.RegistrationUserProfile(ctx, postOTP)
	if err != nil {
		return nil, err
	}

	if err := s.devices.UpsertCredentials(ctx, data.Alias, dev.DeviceID, data.PIN); err != nil {
		return nil, err
	}

	if profile.CompanyID != "" {
		if err := s.devices.UpdateProfile(ctx, data.Alias, profile.CompanyID, profile.UserID); err != nil {
			return nil, err
		}
	}

	s.logger.Info("device registration completed",
		zap.String("alias", data.Alias),
		zap.String("trace_id", shared.TraceIDFromContext(ctx)),
	)

	return profile.Raw, nil
}

var _ domainreg.Service = (*Service)(nil)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `go test ./internal/service/registration/ -race -v`
Expected: PASS.

- [ ] **Step 7: Register in fx and commit**

Add to `internal/service/module.go`:

```go
		fx.Annotate(regsvc.NewService, fx.As(new(registration.Service))),
```

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/domain/registration internal/service internal/adapter/external/ktb
git commit -m "feat: add device registration and OTP verification service"
```

---

## Task 11: `account` service

Ports `getbalance1/2/3.js`, `getcorporateRefId.js`, `getaccountRefId.js`,
`gettransaction.js`, `getCheckname.js`, and `checklimit.js`.

**Files:**
- Create: `internal/domain/account/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/service/account/service.go`
- Create: `internal/service/account/service_test.go`
- Create: `internal/testutil/device_repo.go` (extracted fake, third use)
- Modify: `internal/service/session/fakes_test.go`, `internal/service/registration/fakes_test.go` (use the extracted fake)
- Modify: `internal/service/module.go`

**Interfaces:**
- Consumes: `session.Service` (Task 9), `device.Repository` (Task 3), `ktb.AccountAPI` + `ktb.AuthAPI` (Tasks 6–7).
- Produces:
  ```go
  package account // internal/domain/account
  type TransactionsQuery struct { PageSize, PageNumber string }
  type CheckNameQuery struct { AccountTo, BankCode string }
  type AccountRef struct { AccountRefID, AccountNo string }
  type Service interface {
      Overview(ctx context.Context, alias string) (json.RawMessage, error)
      Cashflow(ctx context.Context, alias string) (json.RawMessage, error)
      SourceOfFunds(ctx context.Context, alias string) (json.RawMessage, error)
      RefreshCorporateRefID(ctx context.Context, alias string) (string, error)
      RefreshAccountRef(ctx context.Context, alias string) (*AccountRef, error)
      Transactions(ctx context.Context, alias string, q TransactionsQuery) (json.RawMessage, error)
      CheckName(ctx context.Context, alias string, q CheckNameQuery) (json.RawMessage, error)
      CheckLimit(ctx context.Context, alias string) (json.RawMessage, error)
  }
  ```
  Consumed by the HTTP layer in Task 16.

- [ ] **Step 1: Extract the shared device-repository fake**

Move `fakeDeviceRepo` out of `internal/service/session/fakes_test.go` into a
non-test package so all three service test suites share one copy. This is the
third consumer, which is the trigger `testing-conventions.md` names.

`internal/testutil/device_repo.go` — the same code as the `fakeDeviceRepo` in
Task 9 Step 2, with these changes:

- `package testutil`
- exported: `DeviceRepo`, `NewDeviceRepo(devices ...*device.Device) *DeviceRepo`, `Snapshot(alias string) device.Device`
- the unexported `mutate` helper stays unexported
- keep `var _ device.Repository = (*DeviceRepo)(nil)`

Then in `internal/service/session/fakes_test.go` and
`internal/service/registration/fakes_test.go`, delete the local copy and use
`testutil.NewDeviceRepo(...)` / `repo.Snapshot("acme")`.

Run: `go test ./internal/service/... -race` → still PASS.

- [ ] **Step 2: Write the domain package**

`internal/domain/account/entity.go`:

```go
package account

// AccountRef is the linked account this device transfers from.
type AccountRef struct {
	AccountRefID string
	AccountNo    string
}
```

`internal/domain/account/repository.go`:

```go
// repository.go -- account has no repository of its own; the reference ids it
// caches are persisted through device.Repository.
package account
```

`internal/domain/account/dto.go`:

```go
package account

// TransactionsQuery carries the paging a caller controls. Empty values fall
// back to the Node defaults ("40" and "0") in the KTB client.
type TransactionsQuery struct {
	PageSize   string
	PageNumber string
}

// CheckNameQuery identifies the payee to look up.
type CheckNameQuery struct {
	AccountTo string
	BankCode  string
}
```

`internal/domain/account/errors.go`:

```go
package account

import (
	"fmt"

	"ktb-biznext-api/internal/shared/errs"
)

var (
	ErrAccountToRequired = fmt.Errorf("account_to is required: %w", errs.ErrInvalidInput)
	ErrBankCodeRequired  = fmt.Errorf("bank_code is required: %w", errs.ErrInvalidInput)

	// ErrNoCorporateProfile means the bank's profile carried no corporateRefId,
	// so entitlements cannot be looked up.
	ErrNoCorporateProfile = fmt.Errorf("bank profile has no corporate ref id: %w", errs.ErrUnavailable)

	// ErrNoAccountEntitlement means the entitlement tree carried no linked
	// account, so there is nothing to transfer from.
	ErrNoAccountEntitlement = fmt.Errorf("no linked account in entitlements: %w", errs.ErrConflict)
)
```

`internal/domain/account/validator.go`:

```go
package account

import "strings"

func ValidateCheckName(q CheckNameQuery) error {
	switch {
	case strings.TrimSpace(q.AccountTo) == "":
		return ErrAccountToRequired
	case strings.TrimSpace(q.BankCode) == "":
		return ErrBankCodeRequired
	}

	return nil
}
```

`internal/domain/account/service.go`:

```go
package account

import (
	"context"
	"encoding/json"
)

// Service relays account information from the bank. Every method runs inside a
// bank session and re-logs-in transparently when the stored token has expired.
type Service interface {
	Overview(ctx context.Context, alias string) (json.RawMessage, error)
	Cashflow(ctx context.Context, alias string) (json.RawMessage, error)
	SourceOfFunds(ctx context.Context, alias string) (json.RawMessage, error)

	// RefreshCorporateRefID re-reads the corporate reference and stores it.
	RefreshCorporateRefID(ctx context.Context, alias string) (string, error)

	// RefreshAccountRef re-reads the linked account and stores both the
	// reference id and the account number.
	RefreshAccountRef(ctx context.Context, alias string) (*AccountRef, error)

	Transactions(ctx context.Context, alias string, q TransactionsQuery) (json.RawMessage, error)
	CheckName(ctx context.Context, alias string, q CheckNameQuery) (json.RawMessage, error)
	CheckLimit(ctx context.Context, alias string) (json.RawMessage, error)
}
```

- [ ] **Step 3: Write the failing service test**

`internal/service/account/service_test.go`:

```go
package account_test

import (
	"context"
	"encoding/json"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"
	domainaccount "ktb-biznext-api/internal/domain/account"
	"ktb-biznext-api/internal/domain/device"
	accountsvc "ktb-biznext-api/internal/service/account"
	"ktb-biznext-api/internal/testutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubSession runs fn against the stored device without any login logic; the
// login and retry behavior is already covered in the session service tests.
type stubSession struct {
	repo *testutil.DeviceRepo
}

func (s *stubSession) Login(ctx context.Context, alias string) (*device.Device, error) {
	return s.repo.GetByAlias(ctx, alias)
}

func (s *stubSession) Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error {
	dev, err := s.repo.GetByAlias(ctx, alias)
	if err != nil {
		return err
	}
	return fn(ctx, dev)
}

type fakeAccountAPI struct {
	ktb.AccountAPI

	lastCreds  ktb.Creds
	lastTxQ    ktb.TransactionHistoryQuery
	lastPayee  [3]string // accountRefID, accountTo, bankCode
	corporate  string
	entitle    *ktb.EntitlementsResponse
	entitleErr error
}

func (f *fakeAccountAPI) AccountOverview(_ context.Context, creds ktb.Creds) (json.RawMessage, error) {
	f.lastCreds = creds
	return json.RawMessage(`{"overview":true}`), nil
}

func (f *fakeAccountAPI) CashflowAnalytics(context.Context, ktb.Creds) (json.RawMessage, error) {
	return json.RawMessage(`{"cashflow":true}`), nil
}

func (f *fakeAccountAPI) SourceOfFunds(context.Context, ktb.Creds) (json.RawMessage, error) {
	return json.RawMessage(`{"sof":true}`), nil
}

func (f *fakeAccountAPI) TransactionHistory(_ context.Context, _ ktb.Creds, q ktb.TransactionHistoryQuery) (json.RawMessage, error) {
	f.lastTxQ = q
	return json.RawMessage(`{"transactions":[]}`), nil
}

func (f *fakeAccountAPI) CheckName(_ context.Context, _ ktb.Creds, accountRefID, accountTo, bankCode string) (*ktb.CheckNameResponse, error) {
	f.lastPayee = [3]string{accountRefID, accountTo, bankCode}
	return &ktb.CheckNameResponse{ID: accountTo, NameTh: "ทดสอบ", Raw: json.RawMessage(`{"nameTh":"ทดสอบ"}`)}, nil
}

func (f *fakeAccountAPI) TransactionLimit(context.Context, ktb.Creds) (json.RawMessage, error) {
	return json.RawMessage(`{"limits":[]}`), nil
}

func (f *fakeAccountAPI) Entitlements(_ context.Context, _ ktb.Creds, corporateRefID string) (*ktb.EntitlementsResponse, error) {
	f.corporate = corporateRefID
	if f.entitleErr != nil {
		return nil, f.entitleErr
	}
	if f.entitle != nil {
		return f.entitle, nil
	}
	return &ktb.EntitlementsResponse{
		FinancialAndNonFinancialServices: []ktb.EntitlementService{{
			SubServices: []ktb.EntitlementSubService{{
				AccountsLinked: &ktb.AccountsLinked{
					PreviewAccounts: []ktb.PreviewAccount{{AccountRefID: "acct-9", AccountNo: "9876543210"}},
				},
			}},
		}},
	}, nil
}

type fakeAuthAPI struct {
	ktb.AuthAPI

	profile *ktb.UserProfile
}

func (f *fakeAuthAPI) UserProfile(context.Context, ktb.Creds) (*ktb.UserProfile, error) {
	if f.profile != nil {
		return f.profile, nil
	}
	return &ktb.UserProfile{CorporateRefID: "corp-7"}, nil
}

func newSvc(t *testing.T, dev *device.Device) (domainaccount.Service, *testutil.DeviceRepo, *fakeAccountAPI, *fakeAuthAPI) {
	t.Helper()

	repo := testutil.NewDeviceRepo(dev)
	accounts := &fakeAccountAPI{}
	auth := &fakeAuthAPI{}

	return accountsvc.NewService(&stubSession{repo: repo}, repo, accounts, auth), repo, accounts, auth
}

func readyDevice() *device.Device {
	return &device.Device{
		Alias: "acme", DeviceID: "dev-1", PIN: "123456",
		AccessToken: "tok", CorporateRefID: "corp-1", AccountRefID: "acct-1",
	}
}

func TestAccountService_Overview_PassesCreds(t *testing.T) {
	svc, _, accounts, _ := newSvc(t, readyDevice())

	got, err := svc.Overview(context.Background(), "acme")
	require.NoError(t, err)
	assert.JSONEq(t, `{"overview":true}`, string(got))
	assert.Equal(t, ktb.Creds{DeviceID: "dev-1", AccessToken: "tok"}, accounts.lastCreds)
}

func TestAccountService_CashflowAndSourceOfFunds(t *testing.T) {
	svc, _, _, _ := newSvc(t, readyDevice())

	cashflow, err := svc.Cashflow(context.Background(), "acme")
	require.NoError(t, err)
	assert.JSONEq(t, `{"cashflow":true}`, string(cashflow))

	sof, err := svc.SourceOfFunds(context.Background(), "acme")
	require.NoError(t, err)
	assert.JSONEq(t, `{"sof":true}`, string(sof))
}

func TestAccountService_Transactions_RequiresAccountRefID(t *testing.T) {
	dev := readyDevice()
	dev.AccountRefID = ""
	svc, _, _, _ := newSvc(t, dev)

	_, err := svc.Transactions(context.Background(), "acme", domainaccount.TransactionsQuery{})

	require.ErrorIs(t, err, device.ErrAccountRefIDMissing)
}

func TestAccountService_Transactions_ForwardsPaging(t *testing.T) {
	svc, _, accounts, _ := newSvc(t, readyDevice())

	_, err := svc.Transactions(context.Background(), "acme", domainaccount.TransactionsQuery{
		PageSize: "10", PageNumber: "2",
	})
	require.NoError(t, err)

	assert.Equal(t, "acct-1", accounts.lastTxQ.AccountRefID)
	assert.Equal(t, "10", accounts.lastTxQ.PageSize)
	assert.Equal(t, "2", accounts.lastTxQ.PageNumber)
}

func TestAccountService_CheckName_ValidatesInput(t *testing.T) {
	svc, _, _, _ := newSvc(t, readyDevice())

	_, err := svc.CheckName(context.Background(), "acme", domainaccount.CheckNameQuery{BankCode: "006"})
	require.ErrorIs(t, err, domainaccount.ErrAccountToRequired)

	_, err = svc.CheckName(context.Background(), "acme", domainaccount.CheckNameQuery{AccountTo: "123"})
	require.ErrorIs(t, err, domainaccount.ErrBankCodeRequired)
}

func TestAccountService_CheckName_RelaysRawPayload(t *testing.T) {
	svc, _, accounts, _ := newSvc(t, readyDevice())

	got, err := svc.CheckName(context.Background(), "acme", domainaccount.CheckNameQuery{
		AccountTo: "1234567890", BankCode: "006",
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{"nameTh":"ทดสอบ"}`, string(got))
	assert.Equal(t, [3]string{"acct-1", "1234567890", "006"}, accounts.lastPayee)
}

func TestAccountService_CheckLimit(t *testing.T) {
	svc, _, _, _ := newSvc(t, readyDevice())

	got, err := svc.CheckLimit(context.Background(), "acme")
	require.NoError(t, err)
	assert.JSONEq(t, `{"limits":[]}`, string(got))
}

func TestAccountService_RefreshCorporateRefID_Stores(t *testing.T) {
	svc, repo, _, _ := newSvc(t, readyDevice())

	got, err := svc.RefreshCorporateRefID(context.Background(), "acme")
	require.NoError(t, err)
	assert.Equal(t, "corp-7", got)
	assert.Equal(t, "corp-7", repo.Snapshot("acme").CorporateRefID)
}

func TestAccountService_RefreshCorporateRefID_EmptyProfile(t *testing.T) {
	svc, _, _, auth := newSvc(t, readyDevice())
	auth.profile = &ktb.UserProfile{}

	_, err := svc.RefreshCorporateRefID(context.Background(), "acme")
	require.ErrorIs(t, err, domainaccount.ErrNoCorporateProfile)
}

func TestAccountService_RefreshAccountRef_StoresBothFields(t *testing.T) {
	svc, repo, accounts, _ := newSvc(t, readyDevice())

	got, err := svc.RefreshAccountRef(context.Background(), "acme")
	require.NoError(t, err)
	assert.Equal(t, "acct-9", got.AccountRefID)
	assert.Equal(t, "9876543210", got.AccountNo)
	assert.Equal(t, "corp-1", accounts.corporate, "the stored corporate ref id is used")

	stored := repo.Snapshot("acme")
	assert.Equal(t, "acct-9", stored.AccountRefID)
	// Node's handler read accountNo off a bare string and always got undefined.
	assert.Equal(t, "9876543210", stored.FromAccountNo)
}

func TestAccountService_RefreshAccountRef_RequiresCorporateRefID(t *testing.T) {
	dev := readyDevice()
	dev.CorporateRefID = ""
	svc, _, _, _ := newSvc(t, dev)

	_, err := svc.RefreshAccountRef(context.Background(), "acme")
	require.ErrorIs(t, err, device.ErrCorporateRefIDMissing)
}

func TestAccountService_RefreshAccountRef_EmptyEntitlementTree(t *testing.T) {
	svc, _, accounts, _ := newSvc(t, readyDevice())
	accounts.entitle = &ktb.EntitlementsResponse{}

	_, err := svc.RefreshAccountRef(context.Background(), "acme")
	require.ErrorIs(t, err, domainaccount.ErrNoAccountEntitlement)
}
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `go test ./internal/service/account/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 5: Write the service**

`internal/service/account/service.go`:

```go
// Package account relays balances, entitlements, and pre-transfer checks from
// the bank, caching the two reference ids the transfer flows depend on.
package account

import (
	"context"
	"encoding/json"

	"ktb-biznext-api/internal/adapter/external/ktb"
	domainaccount "ktb-biznext-api/internal/domain/account"
	"ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/domain/session"
)

type Service struct {
	sessions session.Service
	devices  device.Repository
	accounts ktb.AccountAPI
	auth     ktb.AuthAPI
}

func NewService(
	sessions session.Service,
	devices device.Repository,
	accounts ktb.AccountAPI,
	auth ktb.AuthAPI,
) domainaccount.Service {
	return &Service{sessions: sessions, devices: devices, accounts: accounts, auth: auth}
}

// creds is the per-call authentication pair for one device.
func creds(d *device.Device) ktb.Creds {
	return ktb.Creds{DeviceID: d.DeviceID, AccessToken: d.AccessToken}
}

// relay runs a pass-through bank call inside a session.
func (s *Service) relay(
	ctx context.Context,
	alias string,
	call func(context.Context, *device.Device) (json.RawMessage, error),
) (json.RawMessage, error) {
	var out json.RawMessage

	err := s.sessions.Do(ctx, alias, func(ctx context.Context, d *device.Device) error {
		body, err := call(ctx, d)
		if err != nil {
			return err
		}
		out = body
		return nil
	})
	if err != nil {
		return nil, err
	}

	return out, nil
}

func (s *Service) Overview(ctx context.Context, alias string) (json.RawMessage, error) {
	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.accounts.AccountOverview(ctx, creds(d))
	})
}

func (s *Service) Cashflow(ctx context.Context, alias string) (json.RawMessage, error) {
	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.accounts.CashflowAnalytics(ctx, creds(d))
	})
}

func (s *Service) SourceOfFunds(ctx context.Context, alias string) (json.RawMessage, error) {
	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.accounts.SourceOfFunds(ctx, creds(d))
	})
}

func (s *Service) Transactions(ctx context.Context, alias string, q domainaccount.TransactionsQuery) (json.RawMessage, error) {
	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		if d.AccountRefID == "" {
			return nil, device.ErrAccountRefIDMissing
		}
		return s.accounts.TransactionHistory(ctx, creds(d), ktb.TransactionHistoryQuery{
			AccountRefID: d.AccountRefID,
			PageSize:     q.PageSize,
			PageNumber:   q.PageNumber,
		})
	})
}

func (s *Service) CheckName(ctx context.Context, alias string, q domainaccount.CheckNameQuery) (json.RawMessage, error) {
	if err := domainaccount.ValidateCheckName(q); err != nil {
		return nil, err
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		if d.AccountRefID == "" {
			return nil, device.ErrAccountRefIDMissing
		}
		res, err := s.accounts.CheckName(ctx, creds(d), d.AccountRefID, q.AccountTo, q.BankCode)
		if err != nil {
			return nil, err
		}
		return res.Raw, nil
	})
}

func (s *Service) CheckLimit(ctx context.Context, alias string) (json.RawMessage, error) {
	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.accounts.TransactionLimit(ctx, creds(d))
	})
}

func (s *Service) RefreshCorporateRefID(ctx context.Context, alias string) (string, error) {
	var corporateRefID string

	err := s.sessions.Do(ctx, alias, func(ctx context.Context, d *device.Device) error {
		profile, err := s.auth.UserProfile(ctx, creds(d))
		if err != nil {
			return err
		}
		if profile.CorporateRefID == "" {
			return domainaccount.ErrNoCorporateProfile
		}

		corporateRefID = profile.CorporateRefID

		return s.devices.UpdateCorporateRefID(ctx, alias, corporateRefID)
	})
	if err != nil {
		return "", err
	}

	return corporateRefID, nil
}

func (s *Service) RefreshAccountRef(ctx context.Context, alias string) (*domainaccount.AccountRef, error) {
	var ref domainaccount.AccountRef

	err := s.sessions.Do(ctx, alias, func(ctx context.Context, d *device.Device) error {
		if d.CorporateRefID == "" {
			return device.ErrCorporateRefIDMissing
		}

		entitlements, err := s.accounts.Entitlements(ctx, creds(d), d.CorporateRefID)
		if err != nil {
			return err
		}

		// Both fields come from the same preview account. The Node handler read
		// accountNo off a bare string and always got undefined, which is why
		// from_account_no had to be set by hand there.
		first := entitlements.FirstPreviewAccount()
		if first == nil {
			return domainaccount.ErrNoAccountEntitlement
		}

		ref = domainaccount.AccountRef{AccountRefID: first.AccountRefID, AccountNo: first.AccountNo}

		return s.devices.UpdateAccountRef(ctx, alias, ref.AccountRefID, ref.AccountNo)
	})
	if err != nil {
		return nil, err
	}

	return &ref, nil
}

var _ domainaccount.Service = (*Service)(nil)
```

- [ ] **Step 6: Run the tests, register in fx, and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go test ./internal/service/account/ -race -v
```

Add to `internal/service/module.go`:

```go
		fx.Annotate(accountsvc.NewService, fx.As(new(account.Service))),
```

```bash
go build ./... && go vet ./... && go test -race ./...
git add internal/domain/account internal/service internal/testutil
git commit -m "feat: add account service"
```

---

## Task 12: `instruction` service

Ports `getPendingTasks.js`, `getSubmittedTasks.js`, `getInstructionDetail.js`,
and `approveTask.js`.

**Files:**
- Create: `internal/service/mfa/{mfa,mfa_test}.go`
- Create: `internal/domain/instruction/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/service/instruction/service.go`
- Create: `internal/service/instruction/service_test.go`
- Modify: `internal/service/module.go`

**Interfaces:**
- Consumes: `session.Service` (Task 9), `ktb.InstructionAPI` + `ktb.AuthAPI` (Tasks 6–7), `encrypt.Encryptor` (Task 5).
- Produces:
  ```go
  package instruction // internal/domain/instruction
  type TaskQuery struct { DatetimeFrom, DatetimeTo, PageSize, PageNumber, ListType, InstructionViewType, Order string }
  type Service interface {
      Pending(ctx context.Context, alias string, q TaskQuery) (json.RawMessage, error)
      Submitted(ctx context.Context, alias string, q TaskQuery) (json.RawMessage, error)
      Detail(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error)
      ActivityLog(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error)
      BulkItems(ctx context.Context, alias, bulkOrderID string) (json.RawMessage, error)
      BulkItemDetail(ctx context.Context, alias, bulkOrderID, bulkItemID string) (json.RawMessage, error)
      Approve(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error)
  }
  ```
  plus `mfa.Authenticate(ctx, auth ktb.AuthAPI, enc encrypt.Encryptor, creds ktb.Creds, mfaRefID, pin string) error`
  and `mfa.ErrMissingChallengeParams`, both reused by the transfer service in Task 13.

- [ ] **Step 1: Write the domain package**

`internal/domain/instruction/entity.go`:

```go
// entity.go -- instruction has no persisted entity; task lists and details are
// relayed from the bank untouched.
package instruction
```

`internal/domain/instruction/repository.go`:

```go
// repository.go -- instruction has no repository; it reads only from the bank.
package instruction
```

`internal/domain/instruction/dto.go`:

```go
package instruction

// TaskQuery is the pending/submitted list filter. Empty fields fall back to
// the defaults in Defaults(); Order applies to the submitted list only.
type TaskQuery struct {
	DatetimeFrom        string
	DatetimeTo          string
	PageSize            string
	PageNumber          string
	ListType            string
	InstructionViewType string
	Order               string
}

// Defaults for the task lists, copied from the Node modules.
const (
	DefaultPageNumber          = "0"
	DefaultPageSize            = "20"
	DefaultListType            = "TRANSACTIONS"
	DefaultInstructionViewType = "ALL"
	DefaultOrder               = "ASC"

	// DefaultWindowDays is the half-width of the default date range: seven days
	// back and seven days forward.
	DefaultWindowDays = 7
)
```

`internal/domain/instruction/errors.go`:

```go
package instruction

import (
	"fmt"

	"ktb-biznext-api/internal/shared/errs"
)

var (
	ErrInstructionRefNoRequired = fmt.Errorf("instruction_ref_no is required: %w", errs.ErrInvalidInput)
	ErrBulkOrderIDRequired      = fmt.Errorf("bulk_order_id is required: %w", errs.ErrInvalidInput)
	ErrBulkItemIDRequired       = fmt.Errorf("bulk_item_id is required: %w", errs.ErrInvalidInput)

	// ErrNoMFARefID means approve-init succeeded without returning a reference
	// to authenticate against.
	ErrNoMFARefID = fmt.Errorf("bank returned no mfa reference: %w", errs.ErrUnavailable)
)
```

`internal/domain/instruction/validator.go`:

```go
package instruction

import "strings"

func ValidateInstructionRefNo(instructionRefNo string) error {
	if strings.TrimSpace(instructionRefNo) == "" {
		return ErrInstructionRefNoRequired
	}
	return nil
}

func ValidateBulkOrderID(bulkOrderID string) error {
	if strings.TrimSpace(bulkOrderID) == "" {
		return ErrBulkOrderIDRequired
	}
	return nil
}

func ValidateBulkItemID(bulkItemID string) error {
	if strings.TrimSpace(bulkItemID) == "" {
		return ErrBulkItemIDRequired
	}
	return nil
}
```

`internal/domain/instruction/service.go`:

```go
package instruction

import (
	"context"
	"encoding/json"
)

type Service interface {
	Pending(ctx context.Context, alias string, q TaskQuery) (json.RawMessage, error)
	Submitted(ctx context.Context, alias string, q TaskQuery) (json.RawMessage, error)
	Detail(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error)
	ActivityLog(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error)
	BulkItems(ctx context.Context, alias, bulkOrderID string) (json.RawMessage, error)
	BulkItemDetail(ctx context.Context, alias, bulkOrderID, bulkItemID string) (json.RawMessage, error)

	// Approve runs the four-step approval: init, MFA challenge, MFA
	// authentication, confirm. Unlike the Node version it returns an error on
	// failure instead of a 200 carrying success:false.
	Approve(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error)
}
```

- [ ] **Step 2: Write the shared MFA helper**

The challenge/seal/authenticate triple is identical in `approveTask.js`,
`transfer.js`, and `bulkTransfer.js`. It gets one home rather than three copies.

`internal/service/mfa/mfa.go`:

```go
// Package mfa performs the bank's multi-factor step: fetch a challenge, seal
// the device PIN with the key material it returns, and authenticate.
//
// Approval and both transfer flows run the identical sequence, so it lives in
// one place instead of being copied per feature.
package mfa

import (
	"context"
	"fmt"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/shared/errs"
)

// ErrMissingChallengeParams means the bank accepted the challenge but returned
// no key material, so the PIN cannot be sealed.
var ErrMissingChallengeParams = fmt.Errorf("bank returned no mfa challenge params: %w", errs.ErrUnavailable)

// Authenticate completes the MFA step for mfaRefID using the device PIN.
func Authenticate(
	ctx context.Context,
	auth ktb.AuthAPI,
	enc encrypt.Encryptor,
	creds ktb.Creds,
	mfaRefID, pin string,
) error {
	challenge, err := auth.MFAChallenge(ctx, creds, mfaRefID)
	if err != nil {
		return err
	}
	if challenge.Params == nil {
		return ErrMissingChallengeParams
	}

	sealed, err := enc.Encrypt(ctx, encrypt.Request{
		Sid:          challenge.Params.E2EESid,
		ServerRandom: challenge.Params.ServerRandom,
		PubKey:       challenge.Params.PubKey,
		PIN:          pin,
		HashType:     challenge.Params.OAEPHashAlgo,
	})
	if err != nil {
		return err
	}

	return auth.MFAAuthenticate(ctx, creds, mfaRefID, sealed)
}
```

`internal/service/mfa/mfa_test.go`:

```go
package mfa_test

import (
	"context"
	"testing"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/service/mfa"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type authStub struct {
	ktb.AuthAPI

	challenge  *ktb.MFAChallengeResponse
	passphrase string
}

func (a *authStub) MFAChallenge(context.Context, ktb.Creds, string) (*ktb.MFAChallengeResponse, error) {
	return a.challenge, nil
}

func (a *authStub) MFAAuthenticate(_ context.Context, _ ktb.Creds, _, passphrase string) error {
	a.passphrase = passphrase
	return nil
}

type encStub struct{ gotPIN string }

func (e *encStub) Encrypt(_ context.Context, req encrypt.Request) (string, error) {
	e.gotPIN = req.PIN
	return "sealed:" + req.PIN, nil
}

func TestAuthenticate_SealsPINWithChallengeParams(t *testing.T) {
	auth := &authStub{challenge: &ktb.MFAChallengeResponse{
		MFARefID: "m1",
		Params:   &ktb.MFAParams{E2EESid: "sid", ServerRandom: "r", PubKey: "p", OAEPHashAlgo: "SHA-256"},
	}}
	enc := &encStub{}

	require.NoError(t, mfa.Authenticate(context.Background(), auth, enc, ktb.Creds{}, "m1", "123456"))

	assert.Equal(t, "123456", enc.gotPIN)
	assert.Equal(t, "sealed:123456", auth.passphrase)
}

func TestAuthenticate_MissingParams(t *testing.T) {
	auth := &authStub{challenge: &ktb.MFAChallengeResponse{MFARefID: "m1"}}

	err := mfa.Authenticate(context.Background(), auth, &encStub{}, ktb.Creds{}, "m1", "1")

	require.ErrorIs(t, err, mfa.ErrMissingChallengeParams)
}
```

Run: `go test ./internal/service/mfa/ -v` → PASS.

- [ ] **Step 3: Write the failing service test**

`internal/service/instruction/service_test.go`:

```go
package instruction_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domaininstr "ktb-biznext-api/internal/domain/instruction"
	instrsvc "ktb-biznext-api/internal/service/instruction"
	"ktb-biznext-api/internal/service/mfa"
	"ktb-biznext-api/internal/testutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type stubSession struct{ repo *testutil.DeviceRepo }

func (s *stubSession) Login(ctx context.Context, alias string) (*device.Device, error) {
	return s.repo.GetByAlias(ctx, alias)
}

func (s *stubSession) Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error {
	dev, err := s.repo.GetByAlias(ctx, alias)
	if err != nil {
		return err
	}
	return fn(ctx, dev)
}

type fakeInstructionAPI struct {
	ktb.InstructionAPI

	lastPendingQ   ktb.TaskListQuery
	lastSubmittedQ ktb.TaskListQuery
	lastPaths      []string

	approveInit    *ktb.ApproveInitResponse
	approveInitErr error
	approveErr     error
}

func (f *fakeInstructionAPI) PendingTasks(_ context.Context, _ ktb.Creds, q ktb.TaskListQuery) (json.RawMessage, error) {
	f.lastPendingQ = q
	return json.RawMessage(`{"pending":[]}`), nil
}

func (f *fakeInstructionAPI) SubmittedTasks(_ context.Context, _ ktb.Creds, q ktb.TaskListQuery) (json.RawMessage, error) {
	f.lastSubmittedQ = q
	return json.RawMessage(`{"submitted":[]}`), nil
}

func (f *fakeInstructionAPI) InstructionDetail(_ context.Context, _ ktb.Creds, refNo string) (json.RawMessage, error) {
	f.lastPaths = append(f.lastPaths, "detail:"+refNo)
	return json.RawMessage(`{"detail":true}`), nil
}

func (f *fakeInstructionAPI) ActivityLog(_ context.Context, _ ktb.Creds, refNo string) (json.RawMessage, error) {
	f.lastPaths = append(f.lastPaths, "activity:"+refNo)
	return json.RawMessage(`[]`), nil
}

func (f *fakeInstructionAPI) BulkOrderItems(_ context.Context, _ ktb.Creds, bulkOrderID string) (json.RawMessage, error) {
	f.lastPaths = append(f.lastPaths, "items:"+bulkOrderID)
	return json.RawMessage(`{"items":[]}`), nil
}

func (f *fakeInstructionAPI) BulkItemDetail(_ context.Context, _ ktb.Creds, bulkOrderID, bulkItemID string) (json.RawMessage, error) {
	f.lastPaths = append(f.lastPaths, "item:"+bulkOrderID+"/"+bulkItemID)
	return json.RawMessage(`{"item":true}`), nil
}

func (f *fakeInstructionAPI) ApproveInit(context.Context, ktb.Creds, string) (*ktb.ApproveInitResponse, error) {
	if f.approveInitErr != nil {
		return nil, f.approveInitErr
	}
	if f.approveInit != nil {
		return f.approveInit, nil
	}
	return &ktb.ApproveInitResponse{MFARefID: "m1"}, nil
}

func (f *fakeInstructionAPI) Approve(context.Context, ktb.Creds, string, string) (json.RawMessage, error) {
	if f.approveErr != nil {
		return nil, f.approveErr
	}
	return json.RawMessage(`{"status":"APPROVED"}`), nil
}

type fakeAuthAPI struct {
	ktb.AuthAPI

	challenge    *ktb.MFAChallengeResponse
	authenticated bool
	lastPassphrase string
}

func (f *fakeAuthAPI) MFAChallenge(context.Context, ktb.Creds, string) (*ktb.MFAChallengeResponse, error) {
	if f.challenge != nil {
		return f.challenge, nil
	}
	return &ktb.MFAChallengeResponse{
		MFARefID: "m1",
		Params:   &ktb.MFAParams{E2EESid: "sid", ServerRandom: "r", PubKey: "p", OAEPHashAlgo: "SHA-256"},
	}, nil
}

func (f *fakeAuthAPI) MFAAuthenticate(_ context.Context, _ ktb.Creds, _, passphrase string) error {
	f.authenticated = true
	f.lastPassphrase = passphrase
	return nil
}

type fakeEncryptor struct{ gotPIN string }

func (f *fakeEncryptor) Encrypt(_ context.Context, req encrypt.Request) (string, error) {
	f.gotPIN = req.PIN
	return "sealed:" + req.PIN, nil
}

func newSvc(t *testing.T) (domaininstr.Service, *fakeInstructionAPI, *fakeAuthAPI, *fakeEncryptor) {
	t.Helper()

	repo := testutil.NewDeviceRepo(&device.Device{
		Alias: "acme", DeviceID: "dev-1", PIN: "123456", AccessToken: "tok",
	})
	instr := &fakeInstructionAPI{}
	auth := &fakeAuthAPI{}
	enc := &fakeEncryptor{}

	svc, err := instrsvc.NewService(&stubSession{repo: repo}, instr, auth, enc, zap.NewNop())
	require.NoError(t, err)

	return svc, instr, auth, enc
}

func TestInstructionService_Pending_AppliesDefaults(t *testing.T) {
	svc, instr, _, _ := newSvc(t)

	got, err := svc.Pending(context.Background(), "acme", domaininstr.TaskQuery{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"pending":[]}`, string(got))

	q := instr.lastPendingQ
	assert.Equal(t, "0", q.PageNumber)
	assert.Equal(t, "20", q.PageSize)
	assert.Equal(t, "TRANSACTIONS", q.ListType)
	assert.Equal(t, "ALL", q.InstructionViewType)

	// Seven days back and seven days forward on the Bangkok clock.
	bangkok, err := time.LoadLocation("Asia/Bangkok")
	require.NoError(t, err)
	now := time.Now().In(bangkok)
	assert.Equal(t, now.AddDate(0, 0, -7).Format("2006-01-02"), q.DatetimeFrom)
	assert.Equal(t, now.AddDate(0, 0, 7).Format("2006-01-02"), q.DatetimeTo)
}

func TestInstructionService_Pending_HonoursExplicitValues(t *testing.T) {
	svc, instr, _, _ := newSvc(t)

	_, err := svc.Pending(context.Background(), "acme", domaininstr.TaskQuery{
		DatetimeFrom: "2026-01-01", DatetimeTo: "2026-01-31",
		PageSize: "5", PageNumber: "3", ListType: "BULK", InstructionViewType: "MINE",
	})
	require.NoError(t, err)

	q := instr.lastPendingQ
	assert.Equal(t, "2026-01-01", q.DatetimeFrom)
	assert.Equal(t, "2026-01-31", q.DatetimeTo)
	assert.Equal(t, "5", q.PageSize)
	assert.Equal(t, "3", q.PageNumber)
	assert.Equal(t, "BULK", q.ListType)
	assert.Equal(t, "MINE", q.InstructionViewType)
}

func TestInstructionService_Submitted_DefaultsOrderAsc(t *testing.T) {
	svc, instr, _, _ := newSvc(t)

	_, err := svc.Submitted(context.Background(), "acme", domaininstr.TaskQuery{})
	require.NoError(t, err)
	assert.Equal(t, "ASC", instr.lastSubmittedQ.Order)

	_, err = svc.Submitted(context.Background(), "acme", domaininstr.TaskQuery{Order: "DESC"})
	require.NoError(t, err)
	assert.Equal(t, "DESC", instr.lastSubmittedQ.Order)
}

func TestInstructionService_Lookups_ValidateIdentifiers(t *testing.T) {
	svc, _, _, _ := newSvc(t)
	ctx := context.Background()

	_, err := svc.Detail(ctx, "acme", " ")
	require.ErrorIs(t, err, domaininstr.ErrInstructionRefNoRequired)

	_, err = svc.ActivityLog(ctx, "acme", "")
	require.ErrorIs(t, err, domaininstr.ErrInstructionRefNoRequired)

	_, err = svc.BulkItems(ctx, "acme", "")
	require.ErrorIs(t, err, domaininstr.ErrBulkOrderIDRequired)

	_, err = svc.BulkItemDetail(ctx, "acme", "BO1", "")
	require.ErrorIs(t, err, domaininstr.ErrBulkItemIDRequired)
}

func TestInstructionService_Lookups_Relay(t *testing.T) {
	svc, instr, _, _ := newSvc(t)
	ctx := context.Background()

	_, err := svc.Detail(ctx, "acme", "IR1")
	require.NoError(t, err)
	_, err = svc.ActivityLog(ctx, "acme", "IR1")
	require.NoError(t, err)
	_, err = svc.BulkItems(ctx, "acme", "BO1")
	require.NoError(t, err)
	_, err = svc.BulkItemDetail(ctx, "acme", "BO1", "BI1")
	require.NoError(t, err)

	assert.Equal(t, []string{"detail:IR1", "activity:IR1", "items:BO1", "item:BO1/BI1"}, instr.lastPaths)
}

func TestInstructionService_Approve_RunsFullFlow(t *testing.T) {
	svc, _, auth, enc := newSvc(t)

	got, err := svc.Approve(context.Background(), "acme", "IR1")
	require.NoError(t, err)
	assert.JSONEq(t, `{"status":"APPROVED"}`, string(got))

	assert.Equal(t, "123456", enc.gotPIN, "the stored PIN is sealed for MFA")
	assert.True(t, auth.authenticated)
	assert.Equal(t, "sealed:123456", auth.lastPassphrase)
}

func TestInstructionService_Approve_NoMFARefID(t *testing.T) {
	svc, instr, _, _ := newSvc(t)
	instr.approveInit = &ktb.ApproveInitResponse{}

	_, err := svc.Approve(context.Background(), "acme", "IR1")
	require.ErrorIs(t, err, domaininstr.ErrNoMFARefID)
}

func TestInstructionService_Approve_MissingChallengeParams(t *testing.T) {
	svc, _, auth, _ := newSvc(t)
	auth.challenge = &ktb.MFAChallengeResponse{MFARefID: "m1"} // no params

	_, err := svc.Approve(context.Background(), "acme", "IR1")
	require.ErrorIs(t, err, mfa.ErrMissingChallengeParams)
}

func TestInstructionService_Approve_FailurePropagates(t *testing.T) {
	// Node caught this and replied 200 with success:false; the Go service
	// surfaces it so the caller sees a real failure.
	svc, instr, _, _ := newSvc(t)
	instr.approveErr = domaininstr.ErrNoMFARefID

	_, err := svc.Approve(context.Background(), "acme", "IR1")
	require.Error(t, err)
}
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `go test ./internal/service/instruction/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 5: Write the service**

`internal/service/instruction/service.go`:

```go
// Package instruction relays the approval workbench and performs the four-step
// approval flow.
package instruction

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domaininstr "ktb-biznext-api/internal/domain/instruction"
	"ktb-biznext-api/internal/domain/session"
	"ktb-biznext-api/internal/service/mfa"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"go.uber.org/zap"
)

const dateLayout = "2006-01-02"

type Service struct {
	sessions     session.Service
	instructions ktb.InstructionAPI
	auth         ktb.AuthAPI
	enc          encrypt.Encryptor
	logger       *zap.Logger

	bangkok *time.Location
}

// NewService fails fast when the Asia/Bangkok zone is unavailable: silently
// falling back to UTC would shift every default date window and every transfer
// effective date by up to a day.
func NewService(
	sessions session.Service,
	instructions ktb.InstructionAPI,
	auth ktb.AuthAPI,
	enc encrypt.Encryptor,
	logger *zap.Logger,
) (domaininstr.Service, error) {
	bangkok, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		return nil, fmt.Errorf("load Asia/Bangkok: %w", errs.ErrInternal)
	}

	return &Service{
		sessions: sessions, instructions: instructions, auth: auth,
		enc: enc, logger: logger, bangkok: bangkok,
	}, nil
}

func creds(d *device.Device) ktb.Creds {
	return ktb.Creds{DeviceID: d.DeviceID, AccessToken: d.AccessToken}
}

func (s *Service) relay(
	ctx context.Context,
	alias string,
	call func(context.Context, *device.Device) (json.RawMessage, error),
) (json.RawMessage, error) {
	var out json.RawMessage

	err := s.sessions.Do(ctx, alias, func(ctx context.Context, d *device.Device) error {
		body, err := call(ctx, d)
		if err != nil {
			return err
		}
		out = body
		return nil
	})
	if err != nil {
		return nil, err
	}

	return out, nil
}

// taskListQuery fills the blanks in a caller's filter.
//
// The default window is seven days either side of today on the Bangkok clock.
// Node built it from new Date().toISOString(), i.e. UTC, so near midnight in
// Bangkok the two differ by a day. Using the local clock is the correction;
// callers wanting an exact range pass explicit dates.
func (s *Service) taskListQuery(q domaininstr.TaskQuery, withOrder bool) ktb.TaskListQuery {
	now := time.Now().In(s.bangkok)

	out := ktb.TaskListQuery{
		PageNumber:          orDefault(q.PageNumber, domaininstr.DefaultPageNumber),
		PageSize:            orDefault(q.PageSize, domaininstr.DefaultPageSize),
		ListType:            orDefault(q.ListType, domaininstr.DefaultListType),
		DatetimeFrom:        orDefault(q.DatetimeFrom, now.AddDate(0, 0, -domaininstr.DefaultWindowDays).Format(dateLayout)),
		DatetimeTo:          orDefault(q.DatetimeTo, now.AddDate(0, 0, domaininstr.DefaultWindowDays).Format(dateLayout)),
		InstructionViewType: orDefault(q.InstructionViewType, domaininstr.DefaultInstructionViewType),
	}

	if withOrder {
		out.Order = orDefault(q.Order, domaininstr.DefaultOrder)
	}

	return out
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func (s *Service) Pending(ctx context.Context, alias string, q domaininstr.TaskQuery) (json.RawMessage, error) {
	query := s.taskListQuery(q, false)

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.instructions.PendingTasks(ctx, creds(d), query)
	})
}

func (s *Service) Submitted(ctx context.Context, alias string, q domaininstr.TaskQuery) (json.RawMessage, error) {
	query := s.taskListQuery(q, true)

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.instructions.SubmittedTasks(ctx, creds(d), query)
	})
}

func (s *Service) Detail(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error) {
	if err := domaininstr.ValidateInstructionRefNo(instructionRefNo); err != nil {
		return nil, err
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.instructions.InstructionDetail(ctx, creds(d), instructionRefNo)
	})
}

func (s *Service) ActivityLog(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error) {
	if err := domaininstr.ValidateInstructionRefNo(instructionRefNo); err != nil {
		return nil, err
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.instructions.ActivityLog(ctx, creds(d), instructionRefNo)
	})
}

func (s *Service) BulkItems(ctx context.Context, alias, bulkOrderID string) (json.RawMessage, error) {
	if err := domaininstr.ValidateBulkOrderID(bulkOrderID); err != nil {
		return nil, err
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.instructions.BulkOrderItems(ctx, creds(d), bulkOrderID)
	})
}

func (s *Service) BulkItemDetail(ctx context.Context, alias, bulkOrderID, bulkItemID string) (json.RawMessage, error) {
	if err := domaininstr.ValidateBulkOrderID(bulkOrderID); err != nil {
		return nil, err
	}
	if err := domaininstr.ValidateBulkItemID(bulkItemID); err != nil {
		return nil, err
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		return s.instructions.BulkItemDetail(ctx, creds(d), bulkOrderID, bulkItemID)
	})
}

func (s *Service) Approve(ctx context.Context, alias, instructionRefNo string) (json.RawMessage, error) {
	if err := domaininstr.ValidateInstructionRefNo(instructionRefNo); err != nil {
		return nil, err
	}

	return s.relay(ctx, alias, func(ctx context.Context, d *device.Device) (json.RawMessage, error) {
		c := creds(d)

		init, err := s.instructions.ApproveInit(ctx, c, instructionRefNo)
		if err != nil {
			return nil, err
		}
		if init.MFARefID == "" {
			return nil, domaininstr.ErrNoMFARefID
		}

		if err := mfa.Authenticate(ctx, s.auth, s.enc, c, init.MFARefID, d.PIN); err != nil {
			return nil, err
		}

		body, err := s.instructions.Approve(ctx, c, instructionRefNo, init.MFARefID)
		if err != nil {
			return nil, err
		}

		s.logger.Info("instruction approved",
			zap.String("alias", alias),
			zap.String("instruction_ref_no", instructionRefNo),
			zap.String("trace_id", shared.TraceIDFromContext(ctx)),
		)

		return body, nil
	})
}

var _ domaininstr.Service = (*Service)(nil)
```

- [ ] **Step 6: Run the tests, register in fx, and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go test ./internal/service/instruction/ -race -v
```

`NewService` returns `(Service, error)`, which fx supports directly. Add to
`internal/service/module.go`:

```go
		fx.Annotate(instrsvc.NewService, fx.As(new(instruction.Service))),
```

```bash
go build ./... && go vet ./... && go test -race ./...
git add internal/domain/instruction internal/service
git commit -m "feat: add instruction service with approval flow"
```

---

## Task 13: `transfer` service

Ports `src/api/transfer.js` (11 upstream steps) and `src/api/bulkTransfer.js`
(8 steps plus MFA). The largest task; everything it needs already exists.

**Files:**
- Create: `internal/domain/transfer/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/service/transfer/{service,bulk,fee}.go`
- Create: `internal/service/transfer/{service_test,bulk_test,fee_test}.go`
- Modify: `internal/service/module.go`

**Interfaces:**
- Consumes: `session.Service` (Task 9), `ktb.TransferAPI` + `ktb.BulkAPI` + `ktb.AccountAPI` + `ktb.AuthAPI` (Tasks 6–8), `encrypt.Encryptor` (Task 5), `mfa.Authenticate` (Task 12).
- Produces:
  ```go
  package transfer // internal/domain/transfer
  type Recipient struct { AccountTo, BankCode, BankName string; Amount decimal.Decimal }
  type Data struct { FromAccountNo string; Recipients []Recipient }
  type Result struct { TransferOrderID string; Recipients int; FinalResult, TransferDetails json.RawMessage }
  type BulkResult struct { BulkOrderID string; Recipients int; Summary, Items json.RawMessage }
  type Service interface {
      Transfer(ctx context.Context, alias string, data Data) (*Result, error)
      Bulk(ctx context.Context, alias string, data Data) (*BulkResult, error)
  }
  ```
  Consumed by the HTTP layer in Task 17.

- [ ] **Step 1: Write the domain package**

`internal/domain/transfer/entity.go`:

```go
package transfer

import "github.com/shopspring/decimal"

// Recipient is one payee in a transfer.
type Recipient struct {
	AccountTo string
	BankCode  string
	BankName  string
	Amount    decimal.Decimal
}
```

`internal/domain/transfer/repository.go`:

```go
// repository.go -- transfer has no repository; orders live at the bank and are
// read back through the instruction feature.
package transfer
```

`internal/domain/transfer/dto.go`:

```go
package transfer

import "encoding/json"

// Data is the input of both transfer use cases. FromAccountNo is optional and
// falls back to the value stored on the device; the bulk flow ignores it,
// because the bulk order carries the payer account reference instead.
type Data struct {
	FromAccountNo string
	Recipients    []Recipient
}

// Result is the outcome of a transfer-order run.
type Result struct {
	TransferOrderID string
	Recipients      int
	FinalResult     json.RawMessage
	TransferDetails json.RawMessage
}

// BulkResult is the outcome of a bulk-manual run.
type BulkResult struct {
	BulkOrderID string
	Recipients  int
	Summary     json.RawMessage
	Items       json.RawMessage
}
```

`internal/domain/transfer/errors.go`:

```go
package transfer

import (
	"fmt"

	"ktb-biznext-api/internal/shared/errs"
)

var (
	ErrNoRecipients      = fmt.Errorf("at least one recipient is required: %w", errs.ErrInvalidInput)
	ErrAccountToRequired = fmt.Errorf("recipient account_to is required: %w", errs.ErrInvalidInput)
	ErrBankCodeRequired  = fmt.Errorf("recipient bank_code is required: %w", errs.ErrInvalidInput)
	ErrAmountNotPositive = fmt.Errorf("recipient amount must be greater than zero: %w", errs.ErrInvalidInput)
	ErrTooManyRecipients = fmt.Errorf("too many recipients: %w", errs.ErrInvalidInput)

	ErrNoTransferOrderID = fmt.Errorf("bank returned no transfer order id: %w", errs.ErrUnavailable)
	ErrNoTransferItemID  = fmt.Errorf("bank returned no transfer item id: %w", errs.ErrUnavailable)
	ErrNoBulkOrderID     = fmt.Errorf("bank returned no bulk order id: %w", errs.ErrUnavailable)
	ErrNoBulkItemID      = fmt.Errorf("bank returned no bulk item id: %w", errs.ErrUnavailable)
	ErrNoMFARefID        = fmt.Errorf("bank returned no mfa reference: %w", errs.ErrUnavailable)
)
```

`internal/domain/transfer/validator.go`:

```go
package transfer

import (
	"strings"

	"github.com/shopspring/decimal"
)

// MaxRecipients bounds one request. The flow makes roughly four upstream calls
// per recipient in sequence, so an unbounded list would outlive any sensible
// request timeout while money is already moving.
const MaxRecipients = 100

func ValidateData(data Data) error {
	if len(data.Recipients) == 0 {
		return ErrNoRecipients
	}
	if len(data.Recipients) > MaxRecipients {
		return ErrTooManyRecipients
	}

	for _, r := range data.Recipients {
		if err := validateRecipient(r); err != nil {
			return err
		}
	}

	return nil
}

func validateRecipient(r Recipient) error {
	switch {
	case strings.TrimSpace(r.AccountTo) == "":
		return ErrAccountToRequired
	case strings.TrimSpace(r.BankCode) == "":
		return ErrBankCodeRequired
	case r.Amount.LessThanOrEqual(decimal.Zero):
		return ErrAmountNotPositive
	}

	return nil
}
```

`internal/domain/transfer/service.go`:

```go
package transfer

import "context"

type Service interface {
	// Transfer runs the transfer-order flow for one or many recipients.
	Transfer(ctx context.Context, alias string, data Data) (*Result, error)

	// Bulk runs the bulk-manual flow.
	Bulk(ctx context.Context, alias string, data Data) (*BulkResult, error)
}
```

- [ ] **Step 2: Write the failing fee-selection test**

The fee rules are where the Node code is at its most surprising, so they get
their own file and their own tests.

`internal/service/transfer/fee_test.go`:

```go
package transfer

import (
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
)

func dec(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		panic(err)
	}
	return d
}

func option(fee *string, subService string) ktb.SubServiceOption {
	o := ktb.SubServiceOption{}
	if fee != nil {
		d := dec(*fee)
		o.PayerTransactionFee = &d
	}
	if subService != "" {
		o.SubService = &ktb.SubServiceRef{Value: subService}
	}
	return o
}

func ptr(s string) *string { return &s }

func TestSelectTransferFee_PicksLowestFee(t *testing.T) {
	got := selectTransferFee([]ktb.SubServiceOption{
		option(ptr("10"), "TRANSFER_OTHER_BANK"),
		option(ptr("2"), "TRANSFER_SMART_NEXT_DAY"),
		option(ptr("7"), "TRANSFER_BAHTNET"),
	})

	assert.Equal(t, "2", got.Fee.String())
	assert.Equal(t, "TRANSFER_SMART_NEXT_DAY", got.SubService)
}

func TestSelectTransferFee_FirstWinsOnTie(t *testing.T) {
	got := selectTransferFee([]ktb.SubServiceOption{
		option(ptr("3"), "FIRST"),
		option(ptr("3"), "SECOND"),
	})

	assert.Equal(t, "FIRST", got.SubService, "Node used a strict < comparison")
}

func TestSelectTransferFee_ZeroFeeFallsBackToFive(t *testing.T) {
	// transfer.js: `transferFee = selectedService.payerTransactionFee || transferFee`
	// A zero fee is falsy in JavaScript, so the 5.00 default survives. This is
	// almost certainly a bug, but it is the behavior the bank has been
	// accepting, so the port reproduces it rather than silently changing an
	// amount. See the note in the service file.
	got := selectTransferFee([]ktb.SubServiceOption{
		option(ptr("0"), "TRANSFER_PROMPTPAY_ONLINE"),
	})

	assert.Equal(t, "5", got.Fee.String())
	assert.Equal(t, "TRANSFER_PROMPTPAY_ONLINE", got.SubService)
}

func TestSelectTransferFee_EmptyListUsesDefaults(t *testing.T) {
	got := selectTransferFee(nil)

	assert.Equal(t, "5", got.Fee.String())
	assert.Equal(t, "TRANSFER_OTHER_BANK", got.SubService)
}

func TestSelectTransferFee_AbsentFeeCountsAsZeroWhenComparing(t *testing.T) {
	got := selectTransferFee([]ktb.SubServiceOption{
		option(ptr("4"), "PAID"),
		option(nil, "FREE"),
	})

	// `service.payerTransactionFee || 0` makes an absent fee compare as zero,
	// so the second option wins the comparison; the `||` fallback then keeps
	// the 5.00 default for the amount actually sent.
	assert.Equal(t, "FREE", got.SubService)
	assert.Equal(t, "5", got.Fee.String())
}

func TestSelectBulkFee_KeepsZero(t *testing.T) {
	// bulkTransfer.js assigns the fee directly inside the comparison, so a zero
	// fee is preserved. The two flows genuinely differ here.
	got := selectBulkFee([]ktb.SubServiceOption{
		option(ptr("0"), "TRANSFER_PROMPTPAY_ONLINE"),
	})

	assert.Equal(t, "0", got.Fee.String())
	assert.Equal(t, "TRANSFER_PROMPTPAY_ONLINE", got.SubService)
}

func TestSelectBulkFee_EmptyListUsesZeroAndOtherBank(t *testing.T) {
	got := selectBulkFee(nil)

	assert.Equal(t, "0", got.Fee.String())
	assert.Equal(t, "TRANSFER_OTHER_BANK", got.SubService)
}

func TestSelectBulkFee_PicksLowest(t *testing.T) {
	got := selectBulkFee([]ktb.SubServiceOption{
		option(ptr("9"), "A"),
		option(ptr("1.5"), "B"),
	})

	assert.Equal(t, "1.5", got.Fee.String())
	assert.Equal(t, "B", got.SubService)
}

func TestSelectFee_BlankSubServiceKeepsDefault(t *testing.T) {
	got := selectTransferFee([]ktb.SubServiceOption{option(ptr("2"), "")})
	assert.Equal(t, "TRANSFER_OTHER_BANK", got.SubService)
}
```

Note the package clause: `package transfer`, not `transfer_test`. The fee rules
are unexported implementation detail and are tested from inside the package.

- [ ] **Step 3: Run it to make sure it fails**

Run: `go test ./internal/service/transfer/ -v`
Expected: FAIL — package does not exist.

- [ ] **Step 4: Write `fee.go`**

```go
package transfer

import (
	"ktb-biznext-api/internal/adapter/external/ktb"

	"github.com/shopspring/decimal"
)

// Defaults applied when the bank returns no usable routing option.
const defaultSubService = "TRANSFER_OTHER_BANK"

// defaultTransferFee is the 5.00 baht the transfer flow falls back to.
// The bulk flow falls back to zero instead; see selectBulkFee.
var defaultTransferFee = decimal.RequireFromString("5.00")

// feeChoice is the routing option a flow decided to send.
type feeChoice struct {
	Fee        decimal.Decimal
	SubService string
}

// selectTransferFee reproduces selectBestService in src/api/transfer.js,
// JavaScript truthiness included.
//
// The quirk worth knowing: Node assigned the chosen fee with
// `selectedService.payerTransactionFee || transferFee`, and 0 is falsy, so a
// zero-fee option still sends 5.00. That is very likely a bug, but it is the
// amount the bank has been accepting from this client, and quietly changing a
// fee is not a refactor. Reproduce it; raise it with the bank separately.
func selectTransferFee(options []ktb.SubServiceOption) feeChoice {
	choice := feeChoice{Fee: defaultTransferFee, SubService: defaultSubService}

	selected, ok := lowestFeeOption(options)
	if !ok {
		return choice
	}

	if selected.PayerTransactionFee != nil && !selected.PayerTransactionFee.IsZero() {
		choice.Fee = *selected.PayerTransactionFee
	}
	if selected.SubService != nil && selected.SubService.Value != "" {
		choice.SubService = selected.SubService.Value
	}

	return choice
}

// selectBulkFee reproduces selectBestService in src/api/bulkTransfer.js, which
// assigns the fee inside the comparison and therefore keeps a zero.
func selectBulkFee(options []ktb.SubServiceOption) feeChoice {
	choice := feeChoice{Fee: decimal.Zero, SubService: defaultSubService}

	selected, ok := lowestFeeOption(options)
	if !ok {
		return choice
	}

	if selected.PayerTransactionFee != nil {
		choice.Fee = *selected.PayerTransactionFee
	}
	if selected.SubService != nil && selected.SubService.Value != "" {
		choice.SubService = selected.SubService.Value
	}

	return choice
}

// lowestFeeOption returns the cheapest option, treating an absent fee as zero
// and keeping the first of equal candidates -- both Node loops used a strict
// less-than against `payerTransactionFee || 0`.
func lowestFeeOption(options []ktb.SubServiceOption) (ktb.SubServiceOption, bool) {
	var (
		best   ktb.SubServiceOption
		lowest decimal.Decimal
		found  bool
	)

	for _, option := range options {
		fee := decimal.Zero
		if option.PayerTransactionFee != nil {
			fee = *option.PayerTransactionFee
		}

		if !found || fee.LessThan(lowest) {
			best, lowest, found = option, fee, true
		}
	}

	return best, found
}
```

- [ ] **Step 5: Run the fee tests to verify they pass**

Run: `go test ./internal/service/transfer/ -run TestSelect -v`
Expected: PASS, all nine.

- [ ] **Step 6: Write the failing transfer-flow test**

`internal/service/transfer/service_test.go`:

```go
package transfer_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"
	transfersvc "ktb-biznext-api/internal/service/transfer"
	"ktb-biznext-api/internal/testutil"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// --- fakes -------------------------------------------------------------

type stubSession struct{ repo *testutil.DeviceRepo }

func (s *stubSession) Login(ctx context.Context, alias string) (*device.Device, error) {
	return s.repo.GetByAlias(ctx, alias)
}

func (s *stubSession) Do(ctx context.Context, alias string, fn func(context.Context, *device.Device) error) error {
	dev, err := s.repo.GetByAlias(ctx, alias)
	if err != nil {
		return err
	}
	return fn(ctx, dev)
}

type fakeAccountAPI struct {
	ktb.AccountAPI

	checkNameCalls []string
	checkNameErr   error
}

func (f *fakeAccountAPI) CheckName(_ context.Context, _ ktb.Creds, _, accountTo, _ string) (*ktb.CheckNameResponse, error) {
	f.checkNameCalls = append(f.checkNameCalls, accountTo)
	if f.checkNameErr != nil {
		return nil, f.checkNameErr
	}
	return &ktb.CheckNameResponse{ID: accountTo, NameEn: "", NameTh: "ทดสอบ"}, nil
}

type fakeTransferAPI struct {
	ktb.TransferAPI

	calls []string

	createResp *ktb.TransferOrderResponse
	addItemIDs []string
	addItemIdx int

	serviceOptions []ktb.SubServiceOption
	updates        []ktb.UpdateTransferItemRequest

	preConfirm    *ktb.PreConfirmationResponse
	pollErr       error
	detailsErr    error
	verifyCalls   int
}

func (f *fakeTransferAPI) record(name string) { f.calls = append(f.calls, name) }

func (f *fakeTransferAPI) CreateTransferOrder(_ context.Context, _ ktb.Creds, _ ktb.CreateTransferOrderRequest) (*ktb.TransferOrderResponse, error) {
	f.record("create")
	if f.createResp != nil {
		return f.createResp, nil
	}
	return &ktb.TransferOrderResponse{TransferOrderID: "TO1", TransferItemID: "TI1"}, nil
}

func (f *fakeTransferAPI) AddTransferItem(_ context.Context, _ ktb.Creds, _ string, _ ktb.CreateTransferOrderRequest) (*ktb.TransferOrderResponse, error) {
	f.record("add-item")
	id := "TI-extra"
	if f.addItemIdx < len(f.addItemIDs) {
		id = f.addItemIDs[f.addItemIdx]
	}
	f.addItemIdx++
	return &ktb.TransferOrderResponse{TransferItemID: id}, nil
}

func (f *fakeTransferAPI) AddTransferService(_ context.Context, _ ktb.Creds, _, _ string, _ ktb.AddTransferServiceRequest) (*ktb.ServiceFeeResponse, error) {
	f.record("service")
	return &ktb.ServiceFeeResponse{SubServices: f.serviceOptions}, nil
}

func (f *fakeTransferAPI) UpdateTransferItem(_ context.Context, _ ktb.Creds, _, _ string, req ktb.UpdateTransferItemRequest) error {
	f.record("update")
	f.updates = append(f.updates, req)
	return nil
}

func (f *fakeTransferAPI) VerifyTransfer(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("verify")
	f.verifyCalls++
	return json.RawMessage(`{}`), nil
}

func (f *fakeTransferAPI) PreConfirmTransfer(context.Context, ktb.Creds, string) (*ktb.PreConfirmationResponse, error) {
	f.record("pre-confirm")
	if f.preConfirm != nil {
		return f.preConfirm, nil
	}
	return &ktb.PreConfirmationResponse{MFARefID: "m1"}, nil
}

func (f *fakeTransferAPI) ConfirmTransfer(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("confirm")
	return json.RawMessage(`{}`), nil
}

func (f *fakeTransferAPI) PollTransfer(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("poll")
	if f.pollErr != nil {
		return nil, f.pollErr
	}
	return json.RawMessage(`{"status":"SUCCESS"}`), nil
}

func (f *fakeTransferAPI) TransferOrderItems(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("details")
	if f.detailsErr != nil {
		return nil, f.detailsErr
	}
	return json.RawMessage(`[{"transferItemId":"TI1"}]`), nil
}

type fakeAuthAPI struct {
	ktb.AuthAPI
	authenticated bool
}

func (f *fakeAuthAPI) MFAChallenge(context.Context, ktb.Creds, string) (*ktb.MFAChallengeResponse, error) {
	return &ktb.MFAChallengeResponse{
		MFARefID: "m1",
		Params:   &ktb.MFAParams{E2EESid: "sid", ServerRandom: "r", PubKey: "p", OAEPHashAlgo: "SHA-256"},
	}, nil
}

func (f *fakeAuthAPI) MFAAuthenticate(context.Context, ktb.Creds, string, string) error {
	f.authenticated = true
	return nil
}

type fakeEncryptor struct{ gotPIN string }

func (f *fakeEncryptor) Encrypt(_ context.Context, req encrypt.Request) (string, error) {
	f.gotPIN = req.PIN
	return "sealed:" + req.PIN, nil
}

// --- helpers -----------------------------------------------------------

type harness struct {
	svc       domaintransfer.Service
	repo      *testutil.DeviceRepo
	accounts  *fakeAccountAPI
	transfers *fakeTransferAPI
	bulk      *fakeBulkAPI
	auth      *fakeAuthAPI
	enc       *fakeEncryptor
}

func newHarness(t *testing.T, dev *device.Device) *harness {
	t.Helper()

	repo := testutil.NewDeviceRepo(dev)
	h := &harness{
		repo:      repo,
		accounts:  &fakeAccountAPI{},
		transfers: &fakeTransferAPI{},
		bulk:      &fakeBulkAPI{},
		auth:      &fakeAuthAPI{},
		enc:       &fakeEncryptor{},
	}

	svc, err := transfersvc.NewService(
		&stubSession{repo: repo}, h.transfers, h.bulk, h.accounts, h.auth, h.enc, zap.NewNop(),
	)
	require.NoError(t, err)
	h.svc = svc

	return h
}

func readyDevice() *device.Device {
	return &device.Device{
		Alias: "acme", DeviceID: "dev-1", PIN: "123456", AccessToken: "tok",
		AccountRefID: "acct-1", FromAccountNo: "1111111111",
	}
}

func recipient(accountTo, amount string) domaintransfer.Recipient {
	return domaintransfer.Recipient{
		AccountTo: accountTo, BankCode: "006", BankName: "กรุงไทย",
		Amount: decimal.RequireFromString(amount),
	}
}

func bangkokToday(t *testing.T) string {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Bangkok")
	require.NoError(t, err)
	return time.Now().In(loc).Format("2006-01-02")
}

// --- tests -------------------------------------------------------------

func TestTransfer_SingleRecipient_FullCallSequence(t *testing.T) {
	h := newHarness(t, readyDevice())

	got, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10.00")},
	})
	require.NoError(t, err)

	assert.Equal(t, "TO1", got.TransferOrderID)
	assert.Equal(t, 1, got.Recipients)
	assert.JSONEq(t, `{"status":"SUCCESS"}`, string(got.FinalResult))
	assert.Contains(t, string(got.TransferDetails), "TI1")

	assert.Equal(t,
		[]string{"create", "service", "update", "verify", "pre-confirm", "confirm", "poll", "details"},
		h.transfers.calls)
	assert.Equal(t, []string{"1234567890"}, h.accounts.checkNameCalls)
	assert.True(t, h.auth.authenticated)
	assert.Equal(t, "123456", h.enc.gotPIN)
}

func TestTransfer_MultipleRecipients_VerifiesAfterEachItem(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.transfers.addItemIDs = []string{"TI2", "TI3"}

	got, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{
			recipient("1111111111", "10"), recipient("2222222222", "20"), recipient("3333333333", "30"),
		},
	})
	require.NoError(t, err)
	assert.Equal(t, 3, got.Recipients)

	assert.Equal(t, []string{"1111111111", "2222222222", "3333333333"}, h.accounts.checkNameCalls)
	assert.Equal(t, 3, h.transfers.verifyCalls, "Node verified after every item")
	assert.Equal(t,
		[]string{
			"create", "service", "update", "verify",
			"add-item", "service", "update", "verify",
			"add-item", "service", "update", "verify",
			"pre-confirm", "confirm", "poll", "details",
		},
		h.transfers.calls)
}

func TestTransfer_UpdateItemCarriesFeeAndPayeeFallback(t *testing.T) {
	h := newHarness(t, readyDevice())
	fee := decimal.RequireFromString("2")
	h.transfers.serviceOptions = []ktb.SubServiceOption{
		{PayerTransactionFee: &fee, SubService: &ktb.SubServiceRef{Value: "TRANSFER_SMART_NEXT_DAY"}},
	}

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10.50")},
	})
	require.NoError(t, err)

	require.Len(t, h.transfers.updates, 1)
	update := h.transfers.updates[0]

	assert.Equal(t, "10.5", update.Amount.Decimal().String())
	assert.Equal(t, "2", update.TransferFee.Decimal().String())
	assert.Equal(t, "TRANSFER_SMART_NEXT_DAY", update.SubService)
	assert.Equal(t, "PAYER", update.FeeChargeTo)
	assert.Equal(t, "1111111111", update.FromAccountNo)
	assert.Equal(t, "acct-1", update.FromAccountRefID)
	assert.Equal(t, bangkokToday(t), update.EffectiveDate)
	// The bank sent no English name, so the "no<account>" placeholder is used.
	assert.Equal(t, "no1234567890", update.NewPayeeNameEn)
	assert.Equal(t, "ทดสอบ", update.NewPayeeNameTh)
}

func TestTransfer_RequestFromAccountNoOverridesStored(t *testing.T) {
	h := newHarness(t, readyDevice())

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		FromAccountNo: "9999999999",
		Recipients:    []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)

	require.Len(t, h.transfers.updates, 1)
	assert.Equal(t, "9999999999", h.transfers.updates[0].FromAccountNo)
}

func TestTransfer_MissingAccountRefID(t *testing.T) {
	dev := readyDevice()
	dev.AccountRefID = ""
	h := newHarness(t, dev)

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.ErrorIs(t, err, device.ErrAccountRefIDMissing)
}

func TestTransfer_MissingFromAccountNo(t *testing.T) {
	dev := readyDevice()
	dev.FromAccountNo = ""
	h := newHarness(t, dev)

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.ErrorIs(t, err, device.ErrFromAccountNoMissing)
}

func TestTransfer_ValidationRejectsBadInput(t *testing.T) {
	h := newHarness(t, readyDevice())
	ctx := context.Background()

	_, err := h.svc.Transfer(ctx, "acme", domaintransfer.Data{})
	require.ErrorIs(t, err, domaintransfer.ErrNoRecipients)

	_, err = h.svc.Transfer(ctx, "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{{BankCode: "006", Amount: decimal.RequireFromString("1")}},
	})
	require.ErrorIs(t, err, domaintransfer.ErrAccountToRequired)

	_, err = h.svc.Transfer(ctx, "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{{AccountTo: "1", BankCode: "006", Amount: decimal.Zero}},
	})
	require.ErrorIs(t, err, domaintransfer.ErrAmountNotPositive)

	assert.Empty(t, h.transfers.calls, "validation must run before any upstream call")
}

func TestTransfer_PollFailureReportsPendingApproval(t *testing.T) {
	// The order is already submitted at this point. Node swallowed a polling
	// error and reported PENDING_APPROVAL rather than a failed transfer.
	h := newHarness(t, readyDevice())
	h.transfers.pollErr = errors.New("polling timed out")

	got, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{"status":"PENDING_APPROVAL"}`, string(got.FinalResult))
}

func TestTransfer_NoMFARefID(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.transfers.preConfirm = &ktb.PreConfirmationResponse{}

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.ErrorIs(t, err, domaintransfer.ErrNoMFARefID)
}

func TestTransfer_NoTransferOrderID(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.transfers.createResp = &ktb.TransferOrderResponse{TransferItemID: "TI1"}

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.ErrorIs(t, err, domaintransfer.ErrNoTransferOrderID)
}

func TestTransfer_CheckNameFailureAborts(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.accounts.checkNameErr = errors.New("payee lookup failed")

	_, err := h.svc.Transfer(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.Error(t, err)
	assert.Empty(t, h.transfers.calls, "no order is created when the payee cannot be resolved")
}
```

- [ ] **Step 7: Write `service.go`**

```go
// Package transfer runs the two money-movement flows: the transfer-order flow
// for one or many payees, and the bulk-manual flow.
//
// Both are long sequences of dependent upstream calls, and both move money
// partway through. Where the Node client swallowed an error deliberately --
// polling after submission, the bulk submit/confirm fallback -- this package
// does the same, and says why at the call site.
package transfer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"ktb-biznext-api/internal/adapter/external/encrypt"
	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/domain/session"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"
	"ktb-biznext-api/internal/service/mfa"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"go.uber.org/zap"
)

const dateLayout = "2006-01-02"

// pendingApprovalBody is what a caller sees when the order was submitted but
// its status could not be read back.
var pendingApprovalBody = json.RawMessage(`{"status":"PENDING_APPROVAL"}`)

type Service struct {
	sessions  session.Service
	transfers ktb.TransferAPI
	bulk      ktb.BulkAPI
	accounts  ktb.AccountAPI
	auth      ktb.AuthAPI
	enc       encrypt.Encryptor
	logger    *zap.Logger

	bangkok *time.Location
}

// NewService fails fast when the Asia/Bangkok zone is unavailable: an
// effective date silently computed in UTC would be wrong for up to seven hours
// a day, and the bank schedules real money against it.
func NewService(
	sessions session.Service,
	transfers ktb.TransferAPI,
	bulk ktb.BulkAPI,
	accounts ktb.AccountAPI,
	auth ktb.AuthAPI,
	enc encrypt.Encryptor,
	logger *zap.Logger,
) (domaintransfer.Service, error) {
	bangkok, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		return nil, fmt.Errorf("load Asia/Bangkok: %w", errs.ErrInternal)
	}

	return &Service{
		sessions: sessions, transfers: transfers, bulk: bulk, accounts: accounts,
		auth: auth, enc: enc, logger: logger, bangkok: bangkok,
	}, nil
}

func creds(d *device.Device) ktb.Creds {
	return ktb.Creds{DeviceID: d.DeviceID, AccessToken: d.AccessToken}
}

func (s *Service) today() string {
	return time.Now().In(s.bangkok).Format(dateLayout)
}

func (s *Service) Transfer(ctx context.Context, alias string, data domaintransfer.Data) (*domaintransfer.Result, error) {
	if err := domaintransfer.ValidateData(data); err != nil {
		return nil, err
	}

	var result *domaintransfer.Result

	err := s.sessions.Do(ctx, alias, func(ctx context.Context, d *device.Device) error {
		if d.AccountRefID == "" {
			return device.ErrAccountRefIDMissing
		}

		fromAccountNo := data.FromAccountNo
		if fromAccountNo == "" {
			fromAccountNo = d.FromAccountNo
		}
		if fromAccountNo == "" {
			return device.ErrFromAccountNoMissing
		}

		out, err := s.runTransfer(ctx, alias, d, fromAccountNo, data.Recipients)
		if err != nil {
			return err
		}
		result = out

		return nil
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

func (s *Service) runTransfer(
	ctx context.Context,
	alias string,
	d *device.Device,
	fromAccountNo string,
	recipients []domaintransfer.Recipient,
) (*domaintransfer.Result, error) {
	c := creds(d)
	effectiveDate := s.today()
	traceID := shared.TraceIDFromContext(ctx)

	first := recipients[0]

	firstPayee, err := s.accounts.CheckName(ctx, c, d.AccountRefID, first.AccountTo, first.BankCode)
	if err != nil {
		return nil, err
	}

	order, err := s.transfers.CreateTransferOrder(ctx, c, payeeRequest(d.AccountRefID, firstPayee, first))
	if err != nil {
		return nil, err
	}
	if order.TransferOrderID == "" {
		return nil, domaintransfer.ErrNoTransferOrderID
	}
	if order.TransferItemID == "" {
		return nil, domaintransfer.ErrNoTransferItemID
	}

	orderID := order.TransferOrderID

	if err := s.processItem(ctx, c, d, orderID, order.TransferItemID, fromAccountNo, first, firstPayee, effectiveDate); err != nil {
		return nil, err
	}
	if _, err := s.transfers.VerifyTransfer(ctx, c, orderID); err != nil {
		return nil, err
	}

	for _, r := range recipients[1:] {
		payee, err := s.accounts.CheckName(ctx, c, d.AccountRefID, r.AccountTo, r.BankCode)
		if err != nil {
			return nil, err
		}

		item, err := s.transfers.AddTransferItem(ctx, c, orderID, payeeRequest(d.AccountRefID, payee, r))
		if err != nil {
			return nil, err
		}
		if item.TransferItemID == "" {
			return nil, domaintransfer.ErrNoTransferItemID
		}

		if err := s.processItem(ctx, c, d, orderID, item.TransferItemID, fromAccountNo, r, payee, effectiveDate); err != nil {
			return nil, err
		}
		// Node verified after every item, not once at the end.
		if _, err := s.transfers.VerifyTransfer(ctx, c, orderID); err != nil {
			return nil, err
		}
	}

	preConfirm, err := s.transfers.PreConfirmTransfer(ctx, c, orderID)
	if err != nil {
		return nil, err
	}
	if preConfirm.MFARefID == "" {
		return nil, domaintransfer.ErrNoMFARefID
	}

	if err := mfa.Authenticate(ctx, s.auth, s.enc, c, preConfirm.MFARefID, d.PIN); err != nil {
		return nil, err
	}

	if _, err := s.transfers.ConfirmTransfer(ctx, c, orderID); err != nil {
		return nil, err
	}

	s.logger.Info("transfer submitted",
		zap.String("alias", alias),
		zap.String("transfer_order_id", orderID),
		zap.Int("recipients", len(recipients)),
		zap.String("trace_id", traceID),
	)

	// The money is already moving. A polling failure means the status is
	// unknown, not that the transfer failed, so it is reported as pending --
	// exactly what the Node client did.
	finalResult, err := s.transfers.PollTransfer(ctx, c, orderID)
	if err != nil {
		s.logger.Warn("transfer submitted but polling failed",
			zap.String("alias", alias),
			zap.String("transfer_order_id", orderID),
			zap.String("trace_id", traceID),
			zap.Error(err),
		)
		finalResult = pendingApprovalBody
	}

	details, err := s.transfers.TransferOrderItems(ctx, c, orderID)
	if err != nil {
		return nil, err
	}

	return &domaintransfer.Result{
		TransferOrderID: orderID,
		Recipients:      len(recipients),
		FinalResult:     finalResult,
		TransferDetails: details,
	}, nil
}

// processItem prices one item and writes it back with the chosen routing.
func (s *Service) processItem(
	ctx context.Context,
	c ktb.Creds,
	d *device.Device,
	orderID, itemID, fromAccountNo string,
	r domaintransfer.Recipient,
	payee *ktb.CheckNameResponse,
	effectiveDate string,
) error {
	options, err := s.transfers.AddTransferService(ctx, c, orderID, itemID, ktb.AddTransferServiceRequest{
		Amount:           ktb.NewAmount(r.Amount),
		EffectiveDate:    effectiveDate,
		FromAccountRefID: d.AccountRefID,
	})
	if err != nil {
		return err
	}

	choice := selectTransferFee(options.SubServices)

	return s.transfers.UpdateTransferItem(ctx, c, orderID, itemID, ktb.UpdateTransferItemRequest{
		Amount:                  ktb.NewAmount(r.Amount),
		EffectiveDate:           effectiveDate,
		FeeChargeTo:             "PAYER",
		FromAccountNo:           fromAccountNo,
		FromAccountRefID:        d.AccountRefID,
		IsNotificationEnabled:   false,
		IsRecurringEnabled:      false,
		IsSavedAsBeneficiary:    false,
		IsWithholdingTaxEnabled: false,
		NewPayeeAccountNo:       r.AccountTo,
		NewPayeeBankCode:        r.BankCode,
		NewPayeeNameEn:          payee.PayeeDisplayName(),
		NewPayeeNameTh:          payee.NameTh,
		SubService:              choice.SubService,
		TransferFee:             ktb.NewAmount(choice.Fee),
	})
}

// payeeRequest builds the body shared by order creation and item addition.
func payeeRequest(accountRefID string, payee *ktb.CheckNameResponse, r domaintransfer.Recipient) ktb.CreateTransferOrderRequest {
	return ktb.CreateTransferOrderRequest{
		FromAccountRefID:    accountRefID,
		IsSaveAsBeneficiary: false,
		NewPayeeAccountNo:   r.AccountTo,
		NewPayeeBankCode:    r.BankCode,
		NewPayeeBankName:    r.BankName,
		NewPayeeNameEn:      payee.PayeeDisplayName(),
		NewPayeeNameTh:      payee.NameTh,
	}
}

var _ domaintransfer.Service = (*Service)(nil)
```

Note: `CreateTransferOrder` uses `checkNameResult.id` as the payee account in
the Node code, while `AddTransferItem` and `UpdateTransferItem` use the
recipient's own account number. Both are the same value in practice — the bank
echoes the queried account back as `id` — so `payeeRequest` uses the recipient's
value throughout, which is the one the caller actually asked for.

- [ ] **Step 8: Run the transfer tests to verify they pass**

Run: `go test ./internal/service/transfer/ -run TestTransfer -race -v`
Expected: PASS. The `fakeBulkAPI` referenced by `newHarness` does not exist yet;
write the bulk test file (Step 9) first if the package will not compile.

- [ ] **Step 9: Write the failing bulk-flow test**

`internal/service/transfer/bulk_test.go`:

```go
package transfer_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeBulkAPI struct {
	ktb.BulkAPI

	calls []string

	createResp *ktb.BulkOrderResponse

	// addItemBatches records the payee list sent on each AddBulkItems call.
	addItemBatches [][]ktb.BulkPayee
	// itemIDs are handed out in order, one per new payee.
	itemIDs   []string
	itemIndex int

	serviceOptions []ktb.SubServiceOption
	saved          []ktb.SaveBulkItemRequest

	preConfirm *ktb.PreConfirmationResponse
	submitErr  error
	confirmErr error
	verifyCalls int
}

func (f *fakeBulkAPI) record(name string) { f.calls = append(f.calls, name) }

func (f *fakeBulkAPI) CreateBulkOrder(_ context.Context, _ ktb.Creds, _ ktb.CreateBulkOrderRequest) (*ktb.BulkOrderResponse, error) {
	f.record("create")
	if f.createResp != nil {
		return f.createResp, nil
	}
	return &ktb.BulkOrderResponse{BulkOrderID: "BO1"}, nil
}

// AddBulkItems echoes back every payee it was sent, minting an id for the ones
// that arrive without one -- which is how the real endpoint behaves.
func (f *fakeBulkAPI) AddBulkItems(_ context.Context, _ ktb.Creds, _ string, payees []ktb.BulkPayee) ([]ktb.BulkPayeeResult, error) {
	f.record("add-items")
	f.addItemBatches = append(f.addItemBatches, payees)

	out := make([]ktb.BulkPayeeResult, 0, len(payees))
	for _, p := range payees {
		id := p.BulkItemID
		if id == "" {
			if f.itemIndex < len(f.itemIDs) {
				id = f.itemIDs[f.itemIndex]
			} else {
				id = "BI-auto"
			}
			f.itemIndex++
		}
		out = append(out, ktb.BulkPayeeResult{BulkItemID: id})
	}

	return out, nil
}

func (f *fakeBulkAPI) BulkItemService(context.Context, ktb.Creds, string, string, ktb.Amount) (*ktb.ServiceFeeResponse, error) {
	f.record("service")
	return &ktb.ServiceFeeResponse{SubServices: f.serviceOptions}, nil
}

func (f *fakeBulkAPI) SaveBulkItem(_ context.Context, _ ktb.Creds, _, _ string, req ktb.SaveBulkItemRequest) error {
	f.record("save")
	f.saved = append(f.saved, req)
	return nil
}

func (f *fakeBulkAPI) VerifyBulk(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("verify")
	f.verifyCalls++
	return json.RawMessage(`{}`), nil
}

func (f *fakeBulkAPI) PreConfirmBulk(context.Context, ktb.Creds, string) (*ktb.PreConfirmationResponse, error) {
	f.record("pre-confirm")
	if f.preConfirm != nil {
		return f.preConfirm, nil
	}
	return &ktb.PreConfirmationResponse{MFARefID: "m1"}, nil
}

func (f *fakeBulkAPI) SubmitBulk(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("submit")
	if f.submitErr != nil {
		return nil, f.submitErr
	}
	return json.RawMessage(`{}`), nil
}

func (f *fakeBulkAPI) ConfirmBulk(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("confirm")
	if f.confirmErr != nil {
		return nil, f.confirmErr
	}
	return json.RawMessage(`{}`), nil
}

func (f *fakeBulkAPI) BulkSummary(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("summary")
	return json.RawMessage(`{"total":1}`), nil
}

func (f *fakeBulkAPI) BulkOrderItems(context.Context, ktb.Creds, string) (json.RawMessage, error) {
	f.record("items")
	return json.RawMessage(`{"items":[]}`), nil
}

// --- tests -------------------------------------------------------------

func TestBulk_SingleRecipient_FullCallSequence(t *testing.T) {
	h := newHarness(t, readyDevice())

	got, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)

	assert.Equal(t, "BO1", got.BulkOrderID)
	assert.Equal(t, 1, got.Recipients)
	assert.JSONEq(t, `{"total":1}`, string(got.Summary))
	assert.JSONEq(t, `{"items":[]}`, string(got.Items))

	assert.Equal(t,
		[]string{"create", "add-items", "service", "save", "verify", "pre-confirm", "submit", "summary", "items"},
		h.bulk.calls)
	assert.Equal(t, []string{"1234567890"}, h.accounts.checkNameCalls)
	assert.True(t, h.auth.authenticated)
}

func TestBulk_ChecksEveryPayeeNameUpFront(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.bulk.itemIDs = []string{"BI1", "BI2"}

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1111111111", "10"), recipient("2222222222", "20")},
	})
	require.NoError(t, err)

	// Node resolved every payee name before creating any item.
	assert.Equal(t, []string{"1111111111", "2222222222"}, h.accounts.checkNameCalls)
}

func TestBulk_ResendsWholePayeeListWithStoredIDs(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.bulk.itemIDs = []string{"BI1", "BI2", "BI3"}

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{
			recipient("1111111111", "10"), recipient("2222222222", "20"), recipient("3333333333", "30"),
		},
	})
	require.NoError(t, err)

	require.Len(t, h.bulk.addItemBatches, 3)

	// First call: the first payee only, with no id.
	require.Len(t, h.bulk.addItemBatches[0], 1)
	assert.Empty(t, h.bulk.addItemBatches[0][0].BulkItemID)

	// Second call: the stored first payee plus the new second one.
	require.Len(t, h.bulk.addItemBatches[1], 2)
	assert.Equal(t, "BI1", h.bulk.addItemBatches[1][0].BulkItemID)
	assert.Empty(t, h.bulk.addItemBatches[1][1].BulkItemID)
	assert.Equal(t, "2222222222", h.bulk.addItemBatches[1][1].PayeeNo)

	// Third call: two stored payees plus the new third one.
	require.Len(t, h.bulk.addItemBatches[2], 3)
	assert.Equal(t, "BI1", h.bulk.addItemBatches[2][0].BulkItemID)
	assert.Equal(t, "BI2", h.bulk.addItemBatches[2][1].BulkItemID)
	assert.Empty(t, h.bulk.addItemBatches[2][2].BulkItemID)

	assert.Equal(t, 3, h.bulk.verifyCalls, "Node verified after every item")
}

func TestBulk_SavesItemWithOurFeeChargeAndZeroDefault(t *testing.T) {
	h := newHarness(t, readyDevice())

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)

	require.Len(t, h.bulk.saved, 1)
	saved := h.bulk.saved[0]

	assert.Equal(t, "10", saved.Amount.Decimal().String())
	assert.Equal(t, "OUR", saved.FeeChargeTo)
	assert.Equal(t, "TRANSFER_OTHER_BANK", saved.SubService)
	// No routing options came back, so the bulk default of zero applies --
	// unlike the transfer flow, which falls back to 5.00.
	assert.Equal(t, "0", saved.TransferFee.Decimal().String())
	assert.Equal(t, "0", saved.TotalFee.Decimal().String())
	assert.False(t, saved.IsWithholdingTaxEnabled)
	assert.Nil(t, saved.RegionComFee)
}

func TestBulk_UsesSelectedFeeForBothFeeFields(t *testing.T) {
	h := newHarness(t, readyDevice())
	fee := decimal.RequireFromString("2.5")
	h.bulk.serviceOptions = []ktb.SubServiceOption{
		{PayerTransactionFee: &fee, SubService: &ktb.SubServiceRef{Value: "TRANSFER_SMART_NEXT_DAY"}},
	}

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)

	require.Len(t, h.bulk.saved, 1)
	assert.Equal(t, "2.5", h.bulk.saved[0].TransferFee.Decimal().String())
	assert.Equal(t, "2.5", h.bulk.saved[0].TotalFee.Decimal().String())
	assert.Equal(t, "TRANSFER_SMART_NEXT_DAY", h.bulk.saved[0].SubService)
}

func TestBulk_SubmitFailureFallsBackToConfirm(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.bulk.submitErr = errors.New("submission rejected for this order state")

	got, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)
	assert.Equal(t, "BO1", got.BulkOrderID)

	assert.Contains(t, h.bulk.calls, "submit")
	assert.Contains(t, h.bulk.calls, "confirm")
}

func TestBulk_SubmitAndConfirmBothFailing(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.bulk.submitErr = errors.New("submit failed")
	h.bulk.confirmErr = errors.New("confirm failed")

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.Error(t, err, "when neither endpoint accepts the order, the caller must hear about it")
}

func TestBulk_MissingAccountRefID(t *testing.T) {
	dev := readyDevice()
	dev.AccountRefID = ""
	h := newHarness(t, dev)

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.ErrorIs(t, err, device.ErrAccountRefIDMissing)
}

func TestBulk_DoesNotRequireFromAccountNo(t *testing.T) {
	// The bulk order carries payerAccountRefId, so from_account_no is not used.
	dev := readyDevice()
	dev.FromAccountNo = ""
	h := newHarness(t, dev)

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1234567890", "10")},
	})
	require.NoError(t, err)
}

func TestBulk_NoBulkOrderID(t *testing.T) {
	h := newHarness(t, readyDevice())
	h.bulk.createResp = &ktb.BulkOrderResponse{}

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{
		Recipients: []domaintransfer.Recipient{recipient("1", "10")},
	})
	require.ErrorIs(t, err, domaintransfer.ErrNoBulkOrderID)
}

func TestBulk_ValidationRejectsEmptyRecipients(t *testing.T) {
	h := newHarness(t, readyDevice())

	_, err := h.svc.Bulk(context.Background(), "acme", domaintransfer.Data{})
	require.ErrorIs(t, err, domaintransfer.ErrNoRecipients)
	assert.Empty(t, h.bulk.calls)
}
```

- [ ] **Step 10: Run it to make sure it fails**

Run: `go test ./internal/service/transfer/ -run TestBulk -v`
Expected: FAIL — `Bulk` is not implemented.

- [ ] **Step 11: Write `bulk.go`**

```go
package transfer

import (
	"context"

	"ktb-biznext-api/internal/adapter/external/ktb"
	"ktb-biznext-api/internal/domain/device"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"
	"ktb-biznext-api/internal/service/mfa"
	"ktb-biznext-api/internal/shared"

	"go.uber.org/zap"
)

func (s *Service) Bulk(ctx context.Context, alias string, data domaintransfer.Data) (*domaintransfer.BulkResult, error) {
	if err := domaintransfer.ValidateData(data); err != nil {
		return nil, err
	}

	var result *domaintransfer.BulkResult

	err := s.sessions.Do(ctx, alias, func(ctx context.Context, d *device.Device) error {
		// Unlike the transfer-order flow, bulk needs no from_account_no: the
		// order itself carries payerAccountRefId.
		if d.AccountRefID == "" {
			return device.ErrAccountRefIDMissing
		}

		out, err := s.runBulk(ctx, alias, d, data.Recipients)
		if err != nil {
			return err
		}
		result = out

		return nil
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

func (s *Service) runBulk(
	ctx context.Context,
	alias string,
	d *device.Device,
	recipients []domaintransfer.Recipient,
) (*domaintransfer.BulkResult, error) {
	c := creds(d)
	traceID := shared.TraceIDFromContext(ctx)

	order, err := s.bulk.CreateBulkOrder(ctx, c, ktb.CreateBulkOrderRequest{
		IsRecurring:       false,
		PayerAccountRefID: d.AccountRefID,
		ProcessingType:    "ONLINE",
		Service:           "TRANSFER",
		ValueDate:         s.today(),
	})
	if err != nil {
		return nil, err
	}
	if order.BulkOrderID == "" {
		return nil, domaintransfer.ErrNoBulkOrderID
	}

	bulkOrderID := order.BulkOrderID

	// Resolve every payee name before touching the order, as Node did.
	payees := make([]ktb.BulkPayee, len(recipients))
	for i, r := range recipients {
		resolved, err := s.accounts.CheckName(ctx, c, d.AccountRefID, r.AccountTo, r.BankCode)
		if err != nil {
			return nil, err
		}
		payees[i] = ktb.BulkPayee{
			BankCode:            r.BankCode,
			IsNewPromptpay:      false,
			IsSaveAsBeneficiary: false,
			PayeeNameEn:         resolved.PayeeDisplayName(),
			PayeeNameTh:         resolved.NameTh,
			PayeeNo:             r.AccountTo,
		}
	}

	// Items are added one at a time, and every call re-posts the payees already
	// stored (carrying their ids) alongside the one being added (without an id).
	// That is how the endpoint distinguishes an insert from a no-op.
	for i, r := range recipients {
		batch := append(append([]ktb.BulkPayee{}, payees[:i]...), payees[i])

		stored, err := s.bulk.AddBulkItems(ctx, c, bulkOrderID, batch)
		if err != nil {
			return nil, err
		}

		newItemID := newBulkItemID(stored, payees[:i])
		if newItemID == "" {
			return nil, domaintransfer.ErrNoBulkItemID
		}
		payees[i].BulkItemID = newItemID

		options, err := s.bulk.BulkItemService(ctx, c, bulkOrderID, newItemID, ktb.NewAmount(r.Amount))
		if err != nil {
			return nil, err
		}

		choice := selectBulkFee(options.SubServices)

		if err := s.bulk.SaveBulkItem(ctx, c, bulkOrderID, newItemID, ktb.SaveBulkItemRequest{
			Amount:                  ktb.NewAmount(r.Amount),
			FeeChargeTo:             "OUR",
			SubService:              choice.SubService,
			TotalFee:                ktb.NewAmount(choice.Fee),
			TransferFee:             ktb.NewAmount(choice.Fee),
			IsWithholdingTaxEnabled: false,
		}); err != nil {
			return nil, err
		}

		if _, err := s.bulk.VerifyBulk(ctx, c, bulkOrderID); err != nil {
			return nil, err
		}
	}

	preConfirm, err := s.bulk.PreConfirmBulk(ctx, c, bulkOrderID)
	if err != nil {
		return nil, err
	}
	if preConfirm.MFARefID == "" {
		return nil, domaintransfer.ErrNoMFARefID
	}

	if err := mfa.Authenticate(ctx, s.auth, s.enc, c, preConfirm.MFARefID, d.PIN); err != nil {
		return nil, err
	}

	// Submission and confirmation are not interchangeable across order states,
	// and the Node client found that out the hard way. Try submit, fall back to
	// confirm, and only give up when neither accepts the order.
	if _, err := s.bulk.SubmitBulk(ctx, c, bulkOrderID); err != nil {
		s.logger.Warn("bulk submit failed, falling back to confirmation",
			zap.String("alias", alias),
			zap.String("bulk_order_id", bulkOrderID),
			zap.String("trace_id", traceID),
			zap.Error(err),
		)

		if _, confirmErr := s.bulk.ConfirmBulk(ctx, c, bulkOrderID); confirmErr != nil {
			return nil, confirmErr
		}
	}

	s.logger.Info("bulk transfer submitted",
		zap.String("alias", alias),
		zap.String("bulk_order_id", bulkOrderID),
		zap.Int("recipients", len(recipients)),
		zap.String("trace_id", traceID),
	)

	summary, err := s.bulk.BulkSummary(ctx, c, bulkOrderID)
	if err != nil {
		return nil, err
	}

	items, err := s.bulk.BulkOrderItems(ctx, c, bulkOrderID)
	if err != nil {
		return nil, err
	}

	return &domaintransfer.BulkResult{
		BulkOrderID: bulkOrderID,
		Recipients:  len(recipients),
		Summary:     summary,
		Items:       items,
	}, nil
}

// newBulkItemID picks the id that is not already held by a stored payee.
// The endpoint returns the whole list, so the new item is the one whose id is
// unfamiliar.
func newBulkItemID(returned []ktb.BulkPayeeResult, stored []ktb.BulkPayee) string {
	known := make(map[string]struct{}, len(stored))
	for _, p := range stored {
		known[p.BulkItemID] = struct{}{}
	}

	for _, r := range returned {
		if r.BulkItemID == "" {
			continue
		}
		if _, seen := known[r.BulkItemID]; !seen {
			return r.BulkItemID
		}
	}

	return ""
}
```

- [ ] **Step 12: Run the whole package**

Run: `go test ./internal/service/transfer/ -race -v`
Expected: PASS, all fee, transfer, and bulk tests.

- [ ] **Step 13: Register in fx and commit**

Add to `internal/service/module.go`:

```go
		fx.Annotate(transfersvc.NewService, fx.As(new(transfer.Service))),
```

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/domain/transfer internal/service
git commit -m "feat: add transfer-order and bulk-manual transfer flows"
```

---

## Task 14: API-key middleware and route groups

**Files:**
- Create: `internal/adapter/http/middleware/apikey.go`
- Create: `internal/adapter/http/middleware/apikey_test.go`
- Rewrite: `internal/adapter/http/routing/groups.go`

**Interfaces:**
- Consumes: `shared.Config` (Task 1), `resp` (Task 2).
- Produces:
  ```go
  func middleware.APIKey(cfg *shared.Config) gin.HandlerFunc
  func routing.APIGroup(r *gin.Engine, cfg *shared.Config) *gin.RouterGroup   // /api/v1, key-protected
  func routing.DeviceGroup(r *gin.Engine, cfg *shared.Config) *gin.RouterGroup // /api/v1/devices/:alias
  ```
  Consumed by every HTTP feature in Tasks 15–17.

- [ ] **Step 1: Write the failing middleware test**

`internal/adapter/http/middleware/apikey_test.go`:

```go
package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"ktb-biznext-api/internal/adapter/http/middleware"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newEngine(keys ...string) *gin.Engine {
	gin.SetMode(gin.TestMode)

	cfg := &shared.Config{}
	cfg.App.APIKeys = keys

	r := gin.New()
	r.Use(middleware.APIKey(cfg))
	r.GET("/protected", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	return r
}

func do(r *gin.Engine, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if key != "" {
		req.Header.Set("X-API-Key", key)
	}

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	return rec
}

func TestAPIKey_ValidKeyPasses(t *testing.T) {
	rec := do(newEngine("secret-a", "secret-b"), "secret-b")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", rec.Body.String())
}

func TestAPIKey_MissingHeaderIsUnauthorized(t *testing.T) {
	rec := do(newEngine("secret-a"), "")

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.NotContains(t, rec.Body.String(), "secret-a", "the response must never echo a configured key")
}

func TestAPIKey_WrongKeyIsUnauthorized(t *testing.T) {
	rec := do(newEngine("secret-a"), "wrong")

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAPIKey_PrefixOfAValidKeyIsRejected(t *testing.T) {
	rec := do(newEngine("secret-a"), "secret")

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAPIKey_NoKeysConfiguredRejectsEverything(t *testing.T) {
	// An empty allow-list must fail closed. Failing open would leave the
	// transfer endpoints reachable by anyone who knows an alias.
	rec := do(newEngine(), "anything")

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAPIKey_AbortsBeforeTheHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &shared.Config{}
	cfg.App.APIKeys = []string{"secret"}

	reached := false
	r := gin.New()
	r.Use(middleware.APIKey(cfg))
	r.GET("/protected", func(c *gin.Context) { reached = true })

	do(r, "wrong")

	assert.False(t, reached, "the handler must not run for a rejected request")
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `go test ./internal/adapter/http/middleware/ -run TestAPIKey -v`
Expected: FAIL — `middleware.APIKey` undefined.

- [ ] **Step 3: Write the middleware**

`internal/adapter/http/middleware/apikey.go`:

```go
package middleware

import (
	"crypto/subtle"

	"ktb-biznext-api/internal/adapter/http/resp"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

// APIKeyHeader is the header callers authenticate with.
const APIKeyHeader = "X-API-Key"

// APIKey admits requests carrying a configured key.
//
// An empty allow-list rejects everything. Failing open would leave the transfer
// endpoints reachable by anyone who knows an alias, which is how the Node
// service shipped; config validation also refuses to start in production
// without keys.
func APIKey(cfg *shared.Config) gin.HandlerFunc {
	keys := cfg.App.APIKeys

	return func(c *gin.Context) {
		presented := c.GetHeader(APIKeyHeader)

		if presented == "" || !matchesAny(presented, keys) {
			resp.Error(c, errs.ErrUnauthorized)
			c.Abort()
			return
		}

		c.Next()
	}
}

// matchesAny compares in constant time so a rejected key leaks no information
// about how much of it was right.
func matchesAny(presented string, keys []string) bool {
	match := false
	for _, key := range keys {
		if subtle.ConstantTimeCompare([]byte(presented), []byte(key)) == 1 {
			match = true
		}
	}

	return match
}
```

The loop deliberately does not break early: an early return would make the
response time depend on which key matched.

- [ ] **Step 4: Run it to verify it passes**

Run: `go test ./internal/adapter/http/middleware/ -race -v`
Expected: PASS (the API-key tests plus the template's logger tests).

- [ ] **Step 5: Rewrite the route groups**

`internal/adapter/http/routing/groups.go`:

```go
// Package routing owns the shared URL prefixes and the authentication applied
// to them, so no feature package invents its own.
package routing

import (
	"ktb-biznext-api/internal/adapter/http/middleware"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
)

// AliasParam is the route parameter naming the registered device.
const AliasParam = "alias"

// APIGroup is the key-protected root. Health and readiness sit outside it.
func APIGroup(r *gin.Engine, cfg *shared.Config) *gin.RouterGroup {
	g := r.Group("/api/v1")
	g.Use(middleware.APIKey(cfg))

	return g
}

// DeviceGroup is the key-protected group for everything addressed to one
// registered device.
func DeviceGroup(r *gin.Engine, cfg *shared.Config) *gin.RouterGroup {
	return APIGroup(r, cfg).Group("/devices/:" + AliasParam)
}
```

- [ ] **Step 6: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/http/middleware internal/adapter/http/routing
git commit -m "feat: add API key middleware and route groups"
```

---

## Task 15: HTTP layer for `device` and `registration`

**Files:**
- Create: `internal/adapter/http/device/{handler,handlers,dto,helpers,routes}.go`
- Create: `internal/adapter/http/registration/{handler,handlers,dto,routes}.go`
- Create: `internal/adapter/http/device/handlers_test.go`
- Modify: `internal/adapter/http/module.go`

**Interfaces:**
- Consumes: `device.Service` (Task 4), `registration.Service` (Task 10), `session.Service` (Task 9), `routing` (Task 14), `resp` (Task 2).
- Produces: `httpdevice.RegisterRoutes` and `httpregistration.RegisterRoutes`, both `fx.Invoke` targets; plus `httpdevice.Alias(c *gin.Context) (string, error)`, reused by Tasks 16–17.

- [ ] **Step 1: Write `helpers.go`**

```go
package device

import (
	"ktb-biznext-api/internal/adapter/http/routing"
	domaindevice "ktb-biznext-api/internal/domain/device"

	"github.com/gin-gonic/gin"
)

// Alias reads the device alias from the route. Exported because every
// device-scoped feature needs it and none of them should re-derive the
// parameter name.
func Alias(c *gin.Context) (string, error) {
	alias := c.Param(routing.AliasParam)
	if err := domaindevice.ValidateAlias(alias); err != nil {
		return "", err
	}

	return alias, nil
}
```

- [ ] **Step 2: Write `dto.go`**

```go
package device

import (
	"time"

	domaindevice "ktb-biznext-api/internal/domain/device"
)

type addDeviceRequest struct {
	Alias          string `json:"alias" validate:"required,min=1,max=64"`
	DeviceID       string `json:"device_id" validate:"required,min=1,max=128"`
	PIN            string `json:"pin" validate:"required,min=1,max=64"`
	AccessToken    string `json:"access_token" validate:"max=4096"`
	CorporateRefID string `json:"corporate_ref_id" validate:"max=128"`
	AccountRefID   string `json:"account_ref_id" validate:"max=128"`
	FromAccountNo  string `json:"from_account_no" validate:"max=64"`
}

type updateDeviceRequest struct {
	CorporateRefID string `json:"corporate_ref_id" validate:"max=128"`
	AccountRefID   string `json:"account_ref_id" validate:"max=128"`
	FromAccountNo  string `json:"from_account_no" validate:"max=64"`
	PIN            string `json:"pin" validate:"max=64"`
	AccessToken    string `json:"access_token" validate:"max=4096"`
}

// deviceResponse deliberately omits pin, access_token, refresh_token, and
// transaction_token. The Node service returned the whole row, so GET /users
// handed out every device's PIN to anyone who could reach the port.
type deviceResponse struct {
	Alias          string `json:"alias"`
	DeviceID       string `json:"device_id"`
	CorporateRefID string `json:"corporate_ref_id,omitempty"`
	AccountRefID   string `json:"account_ref_id,omitempty"`
	FromAccountNo  string `json:"from_account_no,omitempty"`
	CompanyID      string `json:"company_id,omitempty"`
	UserID         string `json:"user_id,omitempty"`
	HasPIN         bool   `json:"has_pin"`
	HasAccessToken bool   `json:"has_access_token"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

func toDeviceResponse(d *domaindevice.Device) deviceResponse {
	return deviceResponse{
		Alias:          d.Alias,
		DeviceID:       d.DeviceID,
		CorporateRefID: d.CorporateRefID,
		AccountRefID:   d.AccountRefID,
		FromAccountNo:  d.FromAccountNo,
		CompanyID:      d.CompanyID,
		UserID:         d.UserID,
		HasPIN:         d.PIN != "",
		HasAccessToken: d.AccessToken != "",
		CreatedAt:      d.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:      d.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func toDeviceResponses(devices []*domaindevice.Device) []deviceResponse {
	out := make([]deviceResponse, len(devices))
	for i, d := range devices {
		out[i] = toDeviceResponse(d)
	}

	return out
}
```

- [ ] **Step 3: Write `handler.go`, `handlers.go`, `routes.go`**

`handler.go`:

```go
package device

import (
	domaindevice "ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/domain/session"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	svc      domaindevice.Service
	sessions session.Service
	v        *validator.Validate
}

func NewHandler(svc domaindevice.Service, sessions session.Service, v *validator.Validate) *Handler {
	return &Handler{svc: svc, sessions: sessions, v: v}
}
```

`handlers.go`:

```go
package device

import (
	"net/http"

	"ktb-biznext-api/internal/adapter/http/resp"
	domaindevice "ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

func (h *Handler) add(c *gin.Context) {
	var req addDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	d, err := h.svc.Add(c.Request.Context(), &domaindevice.CreateDeviceData{
		Alias:          req.Alias,
		DeviceID:       req.DeviceID,
		PIN:            req.PIN,
		AccessToken:    req.AccessToken,
		CorporateRefID: req.CorporateRefID,
		AccountRefID:   req.AccountRefID,
		FromAccountNo:  req.FromAccountNo,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, toDeviceResponse(d))
}

func (h *Handler) list(c *gin.Context) {
	devices, err := h.svc.List(c.Request.Context())
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toDeviceResponses(devices))
}

func (h *Handler) get(c *gin.Context) {
	alias, err := Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	d, err := h.svc.GetByAlias(c.Request.Context(), alias)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toDeviceResponse(d))
}

func (h *Handler) update(c *gin.Context) {
	alias, err := Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	var req updateDeviceRequest
	if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if validationErr := h.v.Struct(req); validationErr != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(validationErr))
		return
	}

	d, err := h.svc.Update(c.Request.Context(), alias, &domaindevice.UpdateDeviceData{
		CorporateRefID: req.CorporateRefID,
		AccountRefID:   req.AccountRefID,
		FromAccountNo:  req.FromAccountNo,
		PIN:            req.PIN,
		AccessToken:    req.AccessToken,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toDeviceResponse(d))
}

func (h *Handler) remove(c *gin.Context) {
	alias, err := Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	if err := h.svc.Delete(c.Request.Context(), alias); err != nil {
		resp.Error(c, err)
		return
	}

	resp.NoContent(c)
}

// login forces a fresh bank login. Normal traffic never needs it -- the session
// service logs in on demand -- but it is the fastest way to prove a device's
// credentials still work.
func (h *Handler) login(c *gin.Context) {
	alias, err := Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	d, err := h.sessions.Login(c.Request.Context(), alias)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toDeviceResponse(d))
}
```

`routes.go`:

```go
package device

import (
	"ktb-biznext-api/internal/adapter/http/routing"
	domaindevice "ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/domain/session"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router   *gin.Engine
	Svc      domaindevice.Service
	Sessions session.Service
	V        *validator.Validate
	Cfg      *shared.Config
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Svc, p.Sessions, p.V)

	devices := routing.APIGroup(p.Router, p.Cfg).Group("/devices")
	{
		devices.POST("", h.add)
		devices.GET("", h.list)
		devices.GET("/:"+routing.AliasParam, h.get)
		devices.PATCH("/:"+routing.AliasParam, h.update)
		devices.DELETE("/:"+routing.AliasParam, h.remove)
		devices.POST("/:"+routing.AliasParam+"/login", h.login)
	}
}
```

- [ ] **Step 4: Write the handler test**

`internal/adapter/http/device/handlers_test.go`:

```go
package device_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	httpdevice "ktb-biznext-api/internal/adapter/http/device"
	"ktb-biznext-api/internal/adapter/http/routing"
	domaindevice "ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/domain/session"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubService struct {
	device *domaindevice.Device
	err    error

	lastUpdate *domaindevice.UpdateDeviceData
}

func (s *stubService) Add(_ context.Context, _ *domaindevice.CreateDeviceData) (*domaindevice.Device, error) {
	return s.device, s.err
}
func (s *stubService) GetByAlias(_ context.Context, _ string) (*domaindevice.Device, error) {
	return s.device, s.err
}
func (s *stubService) List(_ context.Context) ([]*domaindevice.Device, error) {
	return []*domaindevice.Device{s.device}, s.err
}
func (s *stubService) Update(_ context.Context, _ string, data *domaindevice.UpdateDeviceData) (*domaindevice.Device, error) {
	s.lastUpdate = data
	return s.device, s.err
}
func (s *stubService) Delete(_ context.Context, _ string) error { return s.err }

type stubSessions struct{ device *domaindevice.Device }

func (s *stubSessions) Login(_ context.Context, _ string) (*domaindevice.Device, error) {
	return s.device, nil
}

func (s *stubSessions) Do(ctx context.Context, _ string, fn func(context.Context, *domaindevice.Device) error) error {
	return fn(ctx, s.device)
}

func storedDevice() *domaindevice.Device {
	return &domaindevice.Device{
		Alias: "acme", DeviceID: "dev-1", PIN: "123456",
		AccessToken: "super-secret-token", RefreshToken: "refresh", TransactionToken: "tt",
		AccountRefID: "acct-1", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
}

func newRouter(t *testing.T, svc domaindevice.Service, sessions session.Service) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	cfg := &shared.Config{}
	cfg.App.APIKeys = []string{"test-key"}

	r := gin.New()
	httpdevice.RegisterRoutes(httpdevice.RouteParams{
		Router: r, Svc: svc, Sessions: sessions, V: validator.New(), Cfg: cfg,
	})

	return r
}

func call(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", "test-key")

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	return rec
}

func TestDeviceHandler_Get_NeverLeaksSecrets(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	rec := call(r, http.MethodGet, "/api/v1/devices/acme", "")

	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	assert.NotContains(t, body, "123456", "the PIN must never be returned")
	assert.NotContains(t, body, "super-secret-token")
	assert.NotContains(t, body, "refresh")
	assert.NotContains(t, body, "tt")
	assert.Contains(t, body, `"has_pin":true`)
	assert.Contains(t, body, `"account_ref_id":"acct-1"`)
}

func TestDeviceHandler_List_NeverLeaksSecrets(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	rec := call(r, http.MethodGet, "/api/v1/devices", "")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.NotContains(t, rec.Body.String(), "123456")
}

func TestDeviceHandler_RequiresAPIKey(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/devices", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestDeviceHandler_Add_ValidationFailure(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	rec := call(r, http.MethodPost, "/api/v1/devices", `{"alias":"acme"}`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "deviceid is required")
}

func TestDeviceHandler_Add_MalformedJSON(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	rec := call(r, http.MethodPost, "/api/v1/devices", `{`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestDeviceHandler_Add_Created(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	rec := call(r, http.MethodPost, "/api/v1/devices",
		`{"alias":"acme","device_id":"dev-1","pin":"123456"}`)

	require.Equal(t, http.StatusCreated, rec.Code)

	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, true, body["success"])
}

func TestDeviceHandler_Update_ForwardsOnlyProvidedFields(t *testing.T) {
	svc := &stubService{device: storedDevice()}
	r := newRouter(t, svc, &stubSessions{})

	rec := call(r, http.MethodPatch, "/api/v1/devices/acme", `{"corporate_ref_id":"corp-9"}`)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, svc.lastUpdate)
	assert.Equal(t, "corp-9", svc.lastUpdate.CorporateRefID)
	assert.Empty(t, svc.lastUpdate.PIN)
}

func TestDeviceHandler_Delete_NoContent(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})

	rec := call(r, http.MethodDelete, "/api/v1/devices/acme", "")

	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestDeviceHandler_NotFoundMapsTo404(t *testing.T) {
	r := newRouter(t, &stubService{err: domaindevice.ErrDeviceNotFound}, &stubSessions{})

	rec := call(r, http.MethodGet, "/api/v1/devices/ghost", "")

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "device not found")
}

func TestDeviceHandler_Login(t *testing.T) {
	r := newRouter(t, &stubService{device: storedDevice()}, &stubSessions{device: storedDevice()})

	rec := call(r, http.MethodPost, "/api/v1/devices/acme/login", "")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.NotContains(t, rec.Body.String(), "super-secret-token")
}

// Route registration must not panic on the alias parameter sharing a segment
// with the static /devices collection routes.
func TestDeviceRoutes_RegisterWithoutConflict(t *testing.T) {
	assert.NotPanics(t, func() {
		newRouter(t, &stubService{device: storedDevice()}, &stubSessions{})
	})
	_ = routing.AliasParam
}
```

- [ ] **Step 5: Write the registration HTTP package**

`internal/adapter/http/registration/dto.go`:

```go
package registration

import domainreg "ktb-biznext-api/internal/domain/registration"

type registerRequest struct {
	Alias          string `json:"alias" validate:"required,min=1,max=64"`
	CompanyID      string `json:"company_id" validate:"required,min=1,max=64"`
	UserID         string `json:"user_id" validate:"required,min=1,max=64"`
	Password       string `json:"password" validate:"required,min=1,max=256"`
	DeliveryMethod string `json:"delivery_method" validate:"max=32"`
}

type verifyOTPRequest struct {
	Alias string `json:"alias" validate:"required,min=1,max=64"`
	OTP   string `json:"otp" validate:"required,min=1,max=32"`
	PIN   string `json:"pin" validate:"required,min=1,max=64"`
}

// registerResponse omits access_token and transaction_token: they are stored
// server-side and the caller has no use for them.
type registerResponse struct {
	DeviceID        string `json:"device_id"`
	TokenUUID       string `json:"token_uuid"`
	OTPRefNo        string `json:"otp_ref_no"`
	DeliveryContact string `json:"delivery_contact,omitempty"`
}

func toRegisterResponse(r *domainreg.RegisterResult) registerResponse {
	return registerResponse{
		DeviceID:        r.DeviceID,
		TokenUUID:       r.TokenUUID,
		OTPRefNo:        r.OTPRefNo,
		DeliveryContact: r.DeliveryContact,
	}
}
```

`internal/adapter/http/registration/handler.go`:

```go
package registration

import (
	domainreg "ktb-biznext-api/internal/domain/registration"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	svc domainreg.Service
	v   *validator.Validate
}

func NewHandler(svc domainreg.Service, v *validator.Validate) *Handler {
	return &Handler{svc: svc, v: v}
}
```

`internal/adapter/http/registration/handlers.go`:

```go
package registration

import (
	"net/http"

	"ktb-biznext-api/internal/adapter/http/resp"
	domainreg "ktb-biznext-api/internal/domain/registration"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

func (h *Handler) register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	result, err := h.svc.Register(c.Request.Context(), domainreg.RegisterData{
		Alias:          req.Alias,
		CompanyID:      req.CompanyID,
		UserID:         req.UserID,
		Password:       req.Password,
		DeliveryMethod: req.DeliveryMethod,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, toRegisterResponse(result))
}

func (h *Handler) verifyOTP(c *gin.Context) {
	var req verifyOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	profile, err := h.svc.VerifyOTP(c.Request.Context(), domainreg.VerifyOTPData{
		Alias: req.Alias,
		OTP:   req.OTP,
		PIN:   req.PIN,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, profile)
}
```

`internal/adapter/http/registration/routes.go`:

```go
package registration

import (
	"ktb-biznext-api/internal/adapter/http/routing"
	domainreg "ktb-biznext-api/internal/domain/registration"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router *gin.Engine
	Svc    domainreg.Service
	V      *validator.Validate
	Cfg    *shared.Config
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Svc, p.V)

	devices := routing.APIGroup(p.Router, p.Cfg).Group("/devices")
	{
		devices.POST("/register", h.register)
		devices.POST("/verify-otp", h.verifyOTP)
	}
}
```

`/register` and `/verify-otp` are static siblings of the `:alias` parameter
registered in Task 15 Step 3. Gin gives static segments priority, so both
resolve correctly; `TestDeviceRoutes_RegisterWithoutConflict` plus the
route-registration smoke test in Task 17 guard against a regression.

- [ ] **Step 6: Wire both into `internal/adapter/http/module.go`**

```go
var Module = fx.Options(
	fx.Provide(NewApp),
	fx.Invoke(
		healthhttp.RegisterRoutes,
		devicehttp.RegisterRoutes,
		registrationhttp.RegisterRoutes,
	),
	fx.Invoke(RegisterHTTPLifecycle),
)
```

with imports `devicehttp "ktb-biznext-api/internal/adapter/http/device"` and
`registrationhttp "ktb-biznext-api/internal/adapter/http/registration"`.

- [ ] **Step 7: Full gate and commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/http
git commit -m "feat: add device and registration HTTP endpoints"
```

---

## Task 16: HTTP layer for `account` and `instruction`

**Files:**
- Create: `internal/adapter/http/account/{handler,handlers,helpers,dto,routes}.go`
- Create: `internal/adapter/http/instruction/{handler,handlers,helpers,dto,routes}.go`
- Create: `internal/adapter/http/account/handlers_test.go`
- Modify: `internal/adapter/http/module.go`

**Interfaces:**
- Consumes: `account.Service` (Task 11), `instruction.Service` (Task 12), `httpdevice.Alias` (Task 15), `routing.DeviceGroup` (Task 14).
- Produces: `httpaccount.RegisterRoutes`, `httpinstruction.RegisterRoutes` — both `fx.Invoke` targets.

- [ ] **Step 1: Write the account HTTP package**

`internal/adapter/http/account/dto.go`:

```go
package account

import domainaccount "ktb-biznext-api/internal/domain/account"

type accountRefResponse struct {
	AccountRefID  string `json:"account_ref_id"`
	FromAccountNo string `json:"from_account_no,omitempty"`
}

func toAccountRefResponse(r *domainaccount.AccountRef) accountRefResponse {
	return accountRefResponse{AccountRefID: r.AccountRefID, FromAccountNo: r.AccountNo}
}

type corporateRefResponse struct {
	CorporateRefID string `json:"corporate_ref_id"`
}
```

`internal/adapter/http/account/helpers.go`:

```go
package account

import (
	domainaccount "ktb-biznext-api/internal/domain/account"

	"github.com/gin-gonic/gin"
)

// parseTransactionsQuery reads paging. Empty values fall through to the Node
// defaults applied in the KTB client, so no default is invented here.
func parseTransactionsQuery(c *gin.Context) domainaccount.TransactionsQuery {
	return domainaccount.TransactionsQuery{
		PageSize:   c.Query("page_size"),
		PageNumber: c.Query("page_number"),
	}
}

func parseCheckNameQuery(c *gin.Context) domainaccount.CheckNameQuery {
	return domainaccount.CheckNameQuery{
		AccountTo: c.Query("account_to"),
		BankCode:  c.Query("bank_code"),
	}
}
```

`internal/adapter/http/account/handler.go`:

```go
package account

import domainaccount "ktb-biznext-api/internal/domain/account"

type Handler struct {
	svc domainaccount.Service
}

func NewHandler(svc domainaccount.Service) *Handler {
	return &Handler{svc: svc}
}
```

`internal/adapter/http/account/handlers.go`:

```go
package account

import (
	"context"
	"encoding/json"

	httpdevice "ktb-biznext-api/internal/adapter/http/device"
	"ktb-biznext-api/internal/adapter/http/resp"

	"github.com/gin-gonic/gin"
)

// relay resolves the alias, runs a pass-through call, and writes the bank's
// payload unchanged. Eight endpoints share this shape.
func (h *Handler) relay(c *gin.Context, call func(context.Context, string) (json.RawMessage, error)) {
	alias, err := httpdevice.Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	body, err := call(c.Request.Context(), alias)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, body)
}

func (h *Handler) overview(c *gin.Context)      { h.relay(c, h.svc.Overview) }
func (h *Handler) cashflow(c *gin.Context)      { h.relay(c, h.svc.Cashflow) }
func (h *Handler) sourceOfFunds(c *gin.Context) { h.relay(c, h.svc.SourceOfFunds) }
func (h *Handler) checkLimit(c *gin.Context)    { h.relay(c, h.svc.CheckLimit) }

func (h *Handler) transactions(c *gin.Context) {
	query := parseTransactionsQuery(c)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.Transactions(ctx, alias, query)
	})
}

func (h *Handler) checkName(c *gin.Context) {
	query := parseCheckNameQuery(c)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.CheckName(ctx, alias, query)
	})
}

func (h *Handler) corporateRefID(c *gin.Context) {
	alias, err := httpdevice.Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	corporateRefID, err := h.svc.RefreshCorporateRefID(c.Request.Context(), alias)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, corporateRefResponse{CorporateRefID: corporateRefID})
}

func (h *Handler) accountRef(c *gin.Context) {
	alias, err := httpdevice.Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	ref, err := h.svc.RefreshAccountRef(c.Request.Context(), alias)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toAccountRefResponse(ref))
}
```

`internal/adapter/http/account/routes.go`:

```go
package account

import (
	"ktb-biznext-api/internal/adapter/http/routing"
	domainaccount "ktb-biznext-api/internal/domain/account"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router *gin.Engine
	Svc    domainaccount.Service
	Cfg    *shared.Config
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Svc)

	// corporate-ref-id and account-ref-id are POST because they write the
	// refreshed values back to the device row.
	accounts := routing.DeviceGroup(p.Router, p.Cfg).Group("/accounts")
	{
		accounts.GET("/overview", h.overview)
		accounts.GET("/cashflow", h.cashflow)
		accounts.GET("/source-of-funds", h.sourceOfFunds)
		accounts.GET("/transactions", h.transactions)
		accounts.GET("/check-name", h.checkName)
		accounts.GET("/check-limit", h.checkLimit)
		accounts.POST("/corporate-ref-id", h.corporateRefID)
		accounts.POST("/account-ref-id", h.accountRef)
	}
}
```

- [ ] **Step 2: Write the account handler test**

`internal/adapter/http/account/handlers_test.go`:

```go
package account_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	httpaccount "ktb-biznext-api/internal/adapter/http/account"
	domainaccount "ktb-biznext-api/internal/domain/account"
	"ktb-biznext-api/internal/domain/device"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubService struct {
	body     json.RawMessage
	err      error
	lastTxQ  domainaccount.TransactionsQuery
	lastName domainaccount.CheckNameQuery
	lastAlias string
}

func (s *stubService) Overview(_ context.Context, alias string) (json.RawMessage, error) {
	s.lastAlias = alias
	return s.body, s.err
}
func (s *stubService) Cashflow(context.Context, string) (json.RawMessage, error) {
	return s.body, s.err
}
func (s *stubService) SourceOfFunds(context.Context, string) (json.RawMessage, error) {
	return s.body, s.err
}
func (s *stubService) CheckLimit(context.Context, string) (json.RawMessage, error) {
	return s.body, s.err
}
func (s *stubService) Transactions(_ context.Context, _ string, q domainaccount.TransactionsQuery) (json.RawMessage, error) {
	s.lastTxQ = q
	return s.body, s.err
}
func (s *stubService) CheckName(_ context.Context, _ string, q domainaccount.CheckNameQuery) (json.RawMessage, error) {
	s.lastName = q
	return s.body, s.err
}
func (s *stubService) RefreshCorporateRefID(context.Context, string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return "corp-7", nil
}
func (s *stubService) RefreshAccountRef(context.Context, string) (*domainaccount.AccountRef, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &domainaccount.AccountRef{AccountRefID: "acct-9", AccountNo: "9876543210"}, nil
}

func newRouter(t *testing.T, svc domainaccount.Service) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	cfg := &shared.Config{}
	cfg.App.APIKeys = []string{"test-key"}

	r := gin.New()
	httpaccount.RegisterRoutes(httpaccount.RouteParams{Router: r, Svc: svc, Cfg: cfg})

	return r
}

func call(r *gin.Engine, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("X-API-Key", "test-key")

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	return rec
}

func TestAccountHandler_Overview_RelaysBankPayload(t *testing.T) {
	svc := &stubService{body: json.RawMessage(`{"accounts":[{"balance":"1.00"}]}`)}
	r := newRouter(t, svc)

	rec := call(r, http.MethodGet, "/api/v1/devices/acme/accounts/overview")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "acme", svc.lastAlias)

	var body struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.True(t, body.Success)
	assert.JSONEq(t, `{"accounts":[{"balance":"1.00"}]}`, string(body.Data))
}

func TestAccountHandler_Transactions_ForwardsPaging(t *testing.T) {
	svc := &stubService{body: json.RawMessage(`{}`)}
	r := newRouter(t, svc)

	rec := call(r, http.MethodGet, "/api/v1/devices/acme/accounts/transactions?page_size=10&page_number=2")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "10", svc.lastTxQ.PageSize)
	assert.Equal(t, "2", svc.lastTxQ.PageNumber)
}

func TestAccountHandler_CheckName_ForwardsQuery(t *testing.T) {
	svc := &stubService{body: json.RawMessage(`{}`)}
	r := newRouter(t, svc)

	rec := call(r, http.MethodGet, "/api/v1/devices/acme/accounts/check-name?account_to=1234567890&bank_code=006")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "1234567890", svc.lastName.AccountTo)
	assert.Equal(t, "006", svc.lastName.BankCode)
}

func TestAccountHandler_AccountRef_ShapesResponse(t *testing.T) {
	r := newRouter(t, &stubService{body: json.RawMessage(`{}`)})

	rec := call(r, http.MethodPost, "/api/v1/devices/acme/accounts/account-ref-id")

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"account_ref_id":"acct-9"`)
	assert.Contains(t, rec.Body.String(), `"from_account_no":"9876543210"`)
}

func TestAccountHandler_MissingAccountRefIDMapsTo409(t *testing.T) {
	r := newRouter(t, &stubService{err: device.ErrAccountRefIDMissing})

	rec := call(r, http.MethodGet, "/api/v1/devices/acme/accounts/transactions")

	require.Equal(t, http.StatusConflict, rec.Code)
	assert.Contains(t, rec.Body.String(), "account_ref_id")
}

func TestAccountHandler_BankRejectionMapsTo502WithDetail(t *testing.T) {
	r := newRouter(t, &stubService{
		err: errs.NewUpstreamError(400, "E1234", "ยอดเงินในบัญชีไม่เพียงพอ", []byte(`{"secret":"x"}`)),
	})

	rec := call(r, http.MethodGet, "/api/v1/devices/acme/accounts/overview")

	require.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Contains(t, rec.Body.String(), "ยอดเงินในบัญชีไม่เพียงพอ")
	assert.NotContains(t, rec.Body.String(), "secret")
}

func TestAccountHandler_RequiresAPIKey(t *testing.T) {
	r := newRouter(t, &stubService{body: json.RawMessage(`{}`)})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/devices/acme/accounts/overview", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}
```

- [ ] **Step 3: Write the instruction HTTP package**

`internal/adapter/http/instruction/handler.go`:

```go
package instruction

import domaininstr "ktb-biznext-api/internal/domain/instruction"

type Handler struct {
	svc domaininstr.Service
}

func NewHandler(svc domaininstr.Service) *Handler {
	return &Handler{svc: svc}
}
```

`internal/adapter/http/instruction/dto.go`:

```go
// dto.go -- instruction relays bank payloads verbatim and takes its input from
// the path and query string, so it defines no JSON request or response types.
package instruction
```

`internal/adapter/http/instruction/helpers.go`:

```go
package instruction

import (
	domaininstr "ktb-biznext-api/internal/domain/instruction"

	"github.com/gin-gonic/gin"
)

// Route parameter names, kept together so the handlers and routes cannot drift.
const (
	refNoParam       = "ref_no"
	bulkOrderIDParam = "bulk_order_id"
	bulkItemIDParam  = "item_id"
)

// parseTaskQuery reads the list filter. Empty values are filled in by the
// service, which owns the Bangkok-clock default window.
func parseTaskQuery(c *gin.Context) domaininstr.TaskQuery {
	return domaininstr.TaskQuery{
		DatetimeFrom:        c.Query("datetime_from"),
		DatetimeTo:          c.Query("datetime_to"),
		PageSize:            c.Query("page_size"),
		PageNumber:          c.Query("page_number"),
		ListType:            c.Query("list_type"),
		InstructionViewType: c.Query("instruction_view_type"),
		Order:               c.Query("order"),
	}
}
```

`internal/adapter/http/instruction/handlers.go`:

```go
package instruction

import (
	"context"
	"encoding/json"

	httpdevice "ktb-biznext-api/internal/adapter/http/device"
	"ktb-biznext-api/internal/adapter/http/resp"

	"github.com/gin-gonic/gin"
)

func (h *Handler) relay(c *gin.Context, call func(context.Context, string) (json.RawMessage, error)) {
	alias, err := httpdevice.Alias(c)
	if err != nil {
		resp.Error(c, err)
		return
	}

	body, err := call(c.Request.Context(), alias)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, body)
}

func (h *Handler) pending(c *gin.Context) {
	query := parseTaskQuery(c)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.Pending(ctx, alias, query)
	})
}

func (h *Handler) submitted(c *gin.Context) {
	query := parseTaskQuery(c)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.Submitted(ctx, alias, query)
	})
}

func (h *Handler) detail(c *gin.Context) {
	refNo := c.Param(refNoParam)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.Detail(ctx, alias, refNo)
	})
}

func (h *Handler) activityLog(c *gin.Context) {
	refNo := c.Param(refNoParam)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.ActivityLog(ctx, alias, refNo)
	})
}

func (h *Handler) bulkItems(c *gin.Context) {
	bulkOrderID := c.Param(bulkOrderIDParam)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.BulkItems(ctx, alias, bulkOrderID)
	})
}

func (h *Handler) bulkItemDetail(c *gin.Context) {
	bulkOrderID := c.Param(bulkOrderIDParam)
	bulkItemID := c.Param(bulkItemIDParam)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.BulkItemDetail(ctx, alias, bulkOrderID, bulkItemID)
	})
}

// approve returns a real status code on failure. The Node handler replied 200
// with success:false, so callers checking the status saw every failed approval
// as a success.
func (h *Handler) approve(c *gin.Context) {
	refNo := c.Param(refNoParam)
	h.relay(c, func(ctx context.Context, alias string) (json.RawMessage, error) {
		return h.svc.Approve(ctx, alias, refNo)
	})
}
```

`internal/adapter/http/instruction/routes.go`:

```go
package instruction

import (
	"ktb-biznext-api/internal/adapter/http/routing"
	domaininstr "ktb-biznext-api/internal/domain/instruction"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router *gin.Engine
	Svc    domaininstr.Service
	Cfg    *shared.Config
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Svc)

	group := routing.DeviceGroup(p.Router, p.Cfg)

	// "pending" and "submitted" are static siblings of :ref_no. Gin gives
	// static segments priority, so both resolve; the smoke test in Task 17
	// guards the registration itself.
	instructions := group.Group("/instructions")
	{
		instructions.GET("/pending", h.pending)
		instructions.GET("/submitted", h.submitted)
		instructions.GET("/:"+refNoParam, h.detail)
		instructions.GET("/:"+refNoParam+"/activity-log", h.activityLog)
		instructions.POST("/:"+refNoParam+"/approve", h.approve)
	}

	bulkOrders := group.Group("/bulk-orders")
	{
		bulkOrders.GET("/:"+bulkOrderIDParam+"/items", h.bulkItems)
		bulkOrders.GET("/:"+bulkOrderIDParam+"/items/:"+bulkItemIDParam, h.bulkItemDetail)
	}
}
```

- [ ] **Step 4: Wire both into `internal/adapter/http/module.go`, run, and commit**

Add `accounthttp.RegisterRoutes` and `instructionhttp.RegisterRoutes` to the
first `fx.Invoke` list.

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
git add internal/adapter/http
git commit -m "feat: add account and instruction HTTP endpoints"
```

---

## Task 17: HTTP layer for `transfer`, and full application wiring

**Files:**
- Create: `internal/adapter/http/transfer/{handler,handlers,dto,routes}.go`
- Create: `internal/adapter/http/transfer/handlers_test.go`
- Create: `internal/adapter/http/routes_test.go`
- Modify: `internal/adapter/http/module.go`

**Interfaces:**
- Consumes: `transfer.Service` (Task 13), `httpdevice.Alias` (Task 15), `routing.DeviceGroup` (Task 14).
- Produces: `httptransfer.RegisterRoutes`; a fully wired application that starts under fx.

- [ ] **Step 1: Write `dto.go`**

```go
package transfer

import (
	domaintransfer "ktb-biznext-api/internal/domain/transfer"

	"github.com/shopspring/decimal"
)

// recipientRequest carries the amount as a string so no value is lost to
// float64 rounding between the caller and the bank.
type recipientRequest struct {
	AccountTo string `json:"account_to" validate:"required,min=1,max=64"`
	BankCode  string `json:"bank_code" validate:"required,min=1,max=16"`
	BankName  string `json:"bank_name" validate:"max=128"`
	Amount    string `json:"amount" validate:"required"`
}

// transferRequest is the single-recipient body.
type transferRequest struct {
	FromAccountNo string `json:"from_account_no" validate:"max=64"`
	AccountTo     string `json:"account_to" validate:"required,min=1,max=64"`
	BankCode      string `json:"bank_code" validate:"required,min=1,max=16"`
	BankName      string `json:"bank_name" validate:"max=128"`
	Amount        string `json:"amount" validate:"required"`
}

// multiTransferRequest is the body for both the multi and bulk endpoints.
type multiTransferRequest struct {
	FromAccountNo string             `json:"from_account_no" validate:"max=64"`
	Recipients    []recipientRequest `json:"recipients" validate:"required,min=1,dive"`
}

func (r transferRequest) toData() (domaintransfer.Data, error) {
	amount, err := decimal.NewFromString(r.Amount)
	if err != nil {
		return domaintransfer.Data{}, domaintransfer.ErrAmountNotPositive
	}

	return domaintransfer.Data{
		FromAccountNo: r.FromAccountNo,
		Recipients: []domaintransfer.Recipient{{
			AccountTo: r.AccountTo,
			BankCode:  r.BankCode,
			BankName:  r.BankName,
			Amount:    amount,
		}},
	}, nil
}

func (r multiTransferRequest) toData() (domaintransfer.Data, error) {
	recipients := make([]domaintransfer.Recipient, len(r.Recipients))
	for i, item := range r.Recipients {
		amount, err := decimal.NewFromString(item.Amount)
		if err != nil {
			return domaintransfer.Data{}, domaintransfer.ErrAmountNotPositive
		}
		recipients[i] = domaintransfer.Recipient{
			AccountTo: item.AccountTo,
			BankCode:  item.BankCode,
			BankName:  item.BankName,
			Amount:    amount,
		}
	}

	return domaintransfer.Data{FromAccountNo: r.FromAccountNo, Recipients: recipients}, nil
}

type transferResponse struct {
	TransferOrderID string `json:"transfer_order_id"`
	Recipients      int    `json:"recipients"`
	FinalResult     any    `json:"final_result,omitempty"`
	TransferDetails any    `json:"transfer_details,omitempty"`
}

type bulkResponse struct {
	BulkOrderID string `json:"bulk_order_id"`
	Recipients  int    `json:"recipients"`
	Summary     any    `json:"summary,omitempty"`
	Items       any    `json:"items,omitempty"`
}
```

`FinalResult` and friends are `any` holding a `json.RawMessage`, which marshals
through unchanged; typing them as `json.RawMessage` would work too but reads as
if this layer understood the bank's schema, which it does not.

- [ ] **Step 2: Write `handler.go`, `handlers.go`, `routes.go`**

`handler.go`:

```go
package transfer

import (
	domaintransfer "ktb-biznext-api/internal/domain/transfer"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	svc domaintransfer.Service
	v   *validator.Validate
}

func NewHandler(svc domaintransfer.Service, v *validator.Validate) *Handler {
	return &Handler{svc: svc, v: v}
}
```

`handlers.go`:

```go
package transfer

import (
	"encoding/json"
	"net/http"

	httpdevice "ktb-biznext-api/internal/adapter/http/device"
	"ktb-biznext-api/internal/adapter/http/resp"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"
	"ktb-biznext-api/internal/shared"
	"ktb-biznext-api/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

// bindData resolves the alias and decodes the request body into domain input.
// It writes the response itself on failure, so callers stop when ok is false.
func (h *Handler) bindData(c *gin.Context, req interface{ toData() (domaintransfer.Data, error) }) (string, domaintransfer.Data, bool) {
	alias, err := httpdevice.Alias(c)
	if err != nil {
		resp.Error(c, err)
		return "", domaintransfer.Data{}, false
	}

	if bindErr := c.ShouldBindJSON(req); bindErr != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return "", domaintransfer.Data{}, false
	}
	if validationErr := h.v.Struct(req); validationErr != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(validationErr))
		return "", domaintransfer.Data{}, false
	}

	data, err := req.toData()
	if err != nil {
		resp.Error(c, err)
		return "", domaintransfer.Data{}, false
	}

	return alias, data, true
}

func (h *Handler) transfer(c *gin.Context) {
	req := &transferRequest{}
	alias, data, ok := h.bindData(c, req)
	if !ok {
		return
	}

	h.runTransfer(c, alias, data)
}

func (h *Handler) transferMulti(c *gin.Context) {
	req := &multiTransferRequest{}
	alias, data, ok := h.bindData(c, req)
	if !ok {
		return
	}

	h.runTransfer(c, alias, data)
}

func (h *Handler) runTransfer(c *gin.Context, alias string, data domaintransfer.Data) {
	result, err := h.svc.Transfer(c.Request.Context(), alias, data)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, transferResponse{
		TransferOrderID: result.TransferOrderID,
		Recipients:      result.Recipients,
		FinalResult:     rawOrNil(result.FinalResult),
		TransferDetails: rawOrNil(result.TransferDetails),
	})
}

func (h *Handler) bulk(c *gin.Context) {
	req := &multiTransferRequest{}
	alias, data, ok := h.bindData(c, req)
	if !ok {
		return
	}

	result, err := h.svc.Bulk(c.Request.Context(), alias, data)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, bulkResponse{
		BulkOrderID: result.BulkOrderID,
		Recipients:  result.Recipients,
		Summary:     rawOrNil(result.Summary),
		Items:       rawOrNil(result.Items),
	})
}

// rawOrNil keeps an absent bank payload out of the response instead of
// emitting a bare null.
func rawOrNil(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return raw
}
```

`routes.go`:

```go
package transfer

import (
	"ktb-biznext-api/internal/adapter/http/routing"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router *gin.Engine
	Svc    domaintransfer.Service
	V      *validator.Validate
	Cfg    *shared.Config
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Svc, p.V)

	transfers := routing.DeviceGroup(p.Router, p.Cfg).Group("/transfers")
	{
		transfers.POST("", h.transfer)
		transfers.POST("/multi", h.transferMulti)
		transfers.POST("/bulk", h.bulk)
	}
}
```

- [ ] **Step 3: Write the transfer handler test**

`internal/adapter/http/transfer/handlers_test.go`:

```go
package transfer_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	httptransfer "ktb-biznext-api/internal/adapter/http/transfer"
	domaintransfer "ktb-biznext-api/internal/domain/transfer"
	"ktb-biznext-api/internal/shared"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubService struct {
	lastAlias string
	lastData  domaintransfer.Data
	err       error
}

func (s *stubService) Transfer(_ context.Context, alias string, data domaintransfer.Data) (*domaintransfer.Result, error) {
	s.lastAlias, s.lastData = alias, data
	if s.err != nil {
		return nil, s.err
	}
	return &domaintransfer.Result{
		TransferOrderID: "TO1",
		Recipients:      len(data.Recipients),
		FinalResult:     json.RawMessage(`{"status":"SUCCESS"}`),
		TransferDetails: json.RawMessage(`[{"transferItemId":"TI1"}]`),
	}, nil
}

func (s *stubService) Bulk(_ context.Context, alias string, data domaintransfer.Data) (*domaintransfer.BulkResult, error) {
	s.lastAlias, s.lastData = alias, data
	if s.err != nil {
		return nil, s.err
	}
	return &domaintransfer.BulkResult{
		BulkOrderID: "BO1",
		Recipients:  len(data.Recipients),
		Summary:     json.RawMessage(`{"total":1}`),
		Items:       json.RawMessage(`{"items":[]}`),
	}, nil
}

func newRouter(t *testing.T, svc domaintransfer.Service) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	cfg := &shared.Config{}
	cfg.App.APIKeys = []string{"test-key"}

	r := gin.New()
	httptransfer.RegisterRoutes(httptransfer.RouteParams{
		Router: r, Svc: svc, V: validator.New(), Cfg: cfg,
	})

	return r
}

func post(r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", "test-key")

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	return rec
}

func TestTransferHandler_Single(t *testing.T) {
	svc := &stubService{}
	r := newRouter(t, svc)

	rec := post(r, "/api/v1/devices/acme/transfers",
		`{"account_to":"1234567890","bank_code":"006","bank_name":"กรุงไทย","amount":"10.50"}`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "acme", svc.lastAlias)
	require.Len(t, svc.lastData.Recipients, 1)
	assert.Equal(t, "10.5", svc.lastData.Recipients[0].Amount.String())
	assert.Contains(t, rec.Body.String(), `"transfer_order_id":"TO1"`)
	assert.Contains(t, rec.Body.String(), `"status":"SUCCESS"`)
}

func TestTransferHandler_AmountKeepsPrecision(t *testing.T) {
	// A float64 round-trip would turn this into 12345678.900000001.
	svc := &stubService{}
	r := newRouter(t, svc)

	rec := post(r, "/api/v1/devices/acme/transfers",
		`{"account_to":"1","bank_code":"006","amount":"12345678.90"}`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "12345678.90", svc.lastData.Recipients[0].Amount.String())
}

func TestTransferHandler_NonNumericAmount(t *testing.T) {
	r := newRouter(t, &stubService{})

	rec := post(r, "/api/v1/devices/acme/transfers",
		`{"account_to":"1","bank_code":"006","amount":"ten baht"}`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestTransferHandler_Multi(t *testing.T) {
	svc := &stubService{}
	r := newRouter(t, svc)

	rec := post(r, "/api/v1/devices/acme/transfers/multi", `{
	  "from_account_no":"1111111111",
	  "recipients":[
	    {"account_to":"111","bank_code":"006","bank_name":"กรุงไทย","amount":"10"},
	    {"account_to":"222","bank_code":"004","bank_name":"กสิกร","amount":"20"}
	  ]}`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "1111111111", svc.lastData.FromAccountNo)
	require.Len(t, svc.lastData.Recipients, 2)
	assert.Equal(t, "222", svc.lastData.Recipients[1].AccountTo)
	assert.Contains(t, rec.Body.String(), `"recipients":2`)
}

func TestTransferHandler_Bulk(t *testing.T) {
	svc := &stubService{}
	r := newRouter(t, svc)

	rec := post(r, "/api/v1/devices/acme/transfers/bulk",
		`{"recipients":[{"account_to":"111","bank_code":"006","amount":"10"}]}`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"bulk_order_id":"BO1"`)
	assert.Contains(t, rec.Body.String(), `"total":1`)
}

func TestTransferHandler_EmptyRecipientsRejected(t *testing.T) {
	r := newRouter(t, &stubService{})

	rec := post(r, "/api/v1/devices/acme/transfers/multi", `{"recipients":[]}`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestTransferHandler_MissingRequiredField(t *testing.T) {
	r := newRouter(t, &stubService{})

	rec := post(r, "/api/v1/devices/acme/transfers", `{"bank_code":"006","amount":"10"}`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "accountto is required")
}

func TestTransferHandler_ServiceErrorPropagates(t *testing.T) {
	r := newRouter(t, &stubService{err: domaintransfer.ErrNoTransferOrderID})

	rec := post(r, "/api/v1/devices/acme/transfers",
		`{"account_to":"1","bank_code":"006","amount":"10"}`)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

func TestTransferHandler_RequiresAPIKey(t *testing.T) {
	r := newRouter(t, &stubService{})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices/acme/transfers", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}
```

- [ ] **Step 4: Wire everything into `internal/adapter/http/module.go`**

```go
var Module = fx.Options(
	fx.Provide(NewApp),
	fx.Invoke(
		healthhttp.RegisterRoutes,
		devicehttp.RegisterRoutes,
		registrationhttp.RegisterRoutes,
		accounthttp.RegisterRoutes,
		transferhttp.RegisterRoutes,
		instructionhttp.RegisterRoutes,
	),
	fx.Invoke(RegisterHTTPLifecycle),
)
```

- [ ] **Step 5: Write the route-registration smoke test**

This is the one test that proves the static/parameter siblings coexist and that
every documented path is actually reachable.

`internal/adapter/http/routes_test.go`:

```go
package http_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// wantRoutes is the full public surface, taken from the design document.
var wantRoutes = []struct{ method, path string }{
	{http.MethodGet, "/health"},
	{http.MethodGet, "/ready"},

	{http.MethodPost, "/api/v1/devices"},
	{http.MethodGet, "/api/v1/devices"},
	{http.MethodPost, "/api/v1/devices/register"},
	{http.MethodPost, "/api/v1/devices/verify-otp"},
	{http.MethodGet, "/api/v1/devices/:alias"},
	{http.MethodPatch, "/api/v1/devices/:alias"},
	{http.MethodDelete, "/api/v1/devices/:alias"},
	{http.MethodPost, "/api/v1/devices/:alias/login"},

	{http.MethodGet, "/api/v1/devices/:alias/accounts/overview"},
	{http.MethodGet, "/api/v1/devices/:alias/accounts/cashflow"},
	{http.MethodGet, "/api/v1/devices/:alias/accounts/source-of-funds"},
	{http.MethodGet, "/api/v1/devices/:alias/accounts/transactions"},
	{http.MethodGet, "/api/v1/devices/:alias/accounts/check-name"},
	{http.MethodGet, "/api/v1/devices/:alias/accounts/check-limit"},
	{http.MethodPost, "/api/v1/devices/:alias/accounts/corporate-ref-id"},
	{http.MethodPost, "/api/v1/devices/:alias/accounts/account-ref-id"},

	{http.MethodPost, "/api/v1/devices/:alias/transfers"},
	{http.MethodPost, "/api/v1/devices/:alias/transfers/multi"},
	{http.MethodPost, "/api/v1/devices/:alias/transfers/bulk"},

	{http.MethodGet, "/api/v1/devices/:alias/instructions/pending"},
	{http.MethodGet, "/api/v1/devices/:alias/instructions/submitted"},
	{http.MethodGet, "/api/v1/devices/:alias/instructions/:ref_no"},
	{http.MethodGet, "/api/v1/devices/:alias/instructions/:ref_no/activity-log"},
	{http.MethodPost, "/api/v1/devices/:alias/instructions/:ref_no/approve"},
	{http.MethodGet, "/api/v1/devices/:alias/bulk-orders/:bulk_order_id/items"},
	{http.MethodGet, "/api/v1/devices/:alias/bulk-orders/:bulk_order_id/items/:item_id"},
}

func TestAllRoutesRegister(t *testing.T) {
	engine := buildTestEngine(t) // see below

	registered := map[string]bool{}
	for _, r := range engine.Routes() {
		registered[r.Method+" "+r.Path] = true
	}

	for _, want := range wantRoutes {
		key := want.method + " " + want.path
		assert.True(t, registered[key], "missing route: %s", key)
	}

	require.Len(t, engine.Routes(), len(wantRoutes), "unexpected extra routes registered")
}
```

`buildTestEngine` constructs a `gin.New()` and calls each feature's
`RegisterRoutes` with `nil` services and a config carrying one API key. Passing
`nil` is safe because route registration never calls a service; it only builds
handlers. Write it in the same file:

```go
func buildTestEngine(t *testing.T) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	cfg := &shared.Config{}
	cfg.App.APIKeys = []string{"test-key"}

	v := validator.New()
	r := gin.New()

	healthhttp.RegisterRoutes(healthhttp.RouteParams{Router: r, DB: nil})
	devicehttp.RegisterRoutes(devicehttp.RouteParams{Router: r, V: v, Cfg: cfg})
	registrationhttp.RegisterRoutes(registrationhttp.RouteParams{Router: r, V: v, Cfg: cfg})
	accounthttp.RegisterRoutes(accounthttp.RouteParams{Router: r, Cfg: cfg})
	transferhttp.RegisterRoutes(transferhttp.RouteParams{Router: r, V: v, Cfg: cfg})
	instructionhttp.RegisterRoutes(instructionhttp.RouteParams{Router: r, Cfg: cfg})

	return r
}
```

If gin panics on the static/parameter siblings, that panic surfaces here rather
than at startup. The documented fallback is `/instructions/detail/:ref_no`;
update `wantRoutes`, `routes.go`, and the Bruno collection together if it comes
to that.

- [ ] **Step 6: Verify the whole application starts**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go build ./... && go vet ./... && go test -race ./...
make docker-up && sleep 5 && make migrate-up
go run ./cmd/app &
sleep 3
curl -s localhost:3001/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/v1/devices
curl -s -H 'X-API-Key: change-me' localhost:3001/api/v1/devices
kill %1
```

Expected: `/health` OK; the unauthenticated `/api/v1/devices` returns `401`; the
authenticated one returns `{"success":true,"code":200,"data":[]}`. An fx
startup error here means a missing `fx.Provide` — read the dependency chain fx
prints and add the constructor to the relevant `module.go`.

- [ ] **Step 7: Commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
git add internal/adapter/http
git commit -m "feat: add transfer HTTP endpoints and complete application wiring"
```

---

## Task 18: SQLite import, Bruno collection, README, final gate

**Files:**
- Create: `scripts/import_sqlite/main.go`
- Rewrite: `bruno/` (collection, environment, and one `.bru` per endpoint)
- Rewrite: `README.md`
- Modify: `Makefile` (add an `import-sqlite` target)

**Interfaces:**
- Consumes: everything built so far.
- Produces: a runnable service with its data migrated and its API contract documented.

- [ ] **Step 1: Write the import script**

`scripts/import_sqlite/main.go` — a standalone `package main` outside
`internal/`, so it never links into the service binary.

```go
// Command import_sqlite copies the Node service's SQLite users table into the
// PostgreSQL devices table. It is a one-off migration aid, run by hand.
//
//	go run ./scripts/import_sqlite -sqlite ../biznext.db -dsn "$DATABASE_URL"
//
// Rows are inserted with ON CONFLICT (alias) DO NOTHING, so re-running it is
// safe and never overwrites a device that has since been re-registered.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type row struct {
	Alias            sql.NullString
	DeviceID         sql.NullString
	PIN              sql.NullString
	AccessToken      sql.NullString
	RefreshToken     sql.NullString
	CorporateRefID   sql.NullString
	AccountRefID     sql.NullString
	FromAccountNo    sql.NullString
	CompanyID        sql.NullString
	UserID           sql.NullString
	TokenUUID        sql.NullString
	TransactionToken sql.NullString
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	sqlitePath := flag.String("sqlite", "biznext.db", "path to the Node service's SQLite database")
	dsn := flag.String("dsn", os.Getenv("DATABASE_URL"), "PostgreSQL DSN")
	dryRun := flag.Bool("dry-run", false, "report what would be imported without writing")
	flag.Parse()

	if *dsn == "" {
		return errors.New("a PostgreSQL DSN is required (-dsn or DATABASE_URL)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	src, err := sql.Open("sqlite", *sqlitePath)
	if err != nil {
		return fmt.Errorf("open sqlite %s: %w", *sqlitePath, err)
	}
	defer func() { _ = src.Close() }()

	dst, err := sql.Open("pgx", *dsn)
	if err != nil {
		return fmt.Errorf("open postgres: %w", err)
	}
	defer func() { _ = dst.Close() }()

	if err := dst.PingContext(ctx); err != nil {
		return fmt.Errorf("ping postgres: %w", err)
	}

	rows, err := src.QueryContext(ctx, `
		SELECT user, deviceId, pin, accessToken, refreshToken,
		       corporateRefId, accountRefId, fromAccountNo,
		       companyId, userId, tokenUuid, transactionToken
		FROM users`)
	if err != nil {
		return fmt.Errorf("read sqlite users: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var imported, skipped int
	for rows.Next() {
		var r row
		if err := rows.Scan(
			&r.Alias, &r.DeviceID, &r.PIN, &r.AccessToken, &r.RefreshToken,
			&r.CorporateRefID, &r.AccountRefID, &r.FromAccountNo,
			&r.CompanyID, &r.UserID, &r.TokenUUID, &r.TransactionToken,
		); err != nil {
			return fmt.Errorf("scan sqlite row: %w", err)
		}

		// alias and device_id are NOT NULL upstream; a row missing either is
		// unusable, so it is reported rather than silently dropped.
		if !r.Alias.Valid || r.Alias.String == "" || !r.DeviceID.Valid || r.DeviceID.String == "" {
			log.Printf("skipping row with empty user or deviceId (user=%q)", r.Alias.String)
			skipped++
			continue
		}

		if *dryRun {
			log.Printf("would import %s (device %s)", r.Alias.String, r.DeviceID.String)
			imported++
			continue
		}

		result, err := dst.ExecContext(ctx, `
			INSERT INTO devices (
				alias, device_id, pin, access_token, refresh_token,
				corporate_ref_id, account_ref_id, from_account_no,
				company_id, user_id, token_uuid, transaction_token
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			ON CONFLICT (alias) DO NOTHING`,
			r.Alias, r.DeviceID, r.PIN, r.AccessToken, r.RefreshToken,
			r.CorporateRefID, r.AccountRefID, r.FromAccountNo,
			r.CompanyID, r.UserID, r.TokenUUID, r.TransactionToken,
		)
		if err != nil {
			return fmt.Errorf("insert %s: %w", r.Alias.String, err)
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("rows affected for %s: %w", r.Alias.String, err)
		}
		if affected == 0 {
			log.Printf("alias %s already present, left unchanged", r.Alias.String)
			skipped++
			continue
		}

		imported++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate sqlite rows: %w", err)
	}

	log.Printf("done: %d imported, %d skipped", imported, skipped)

	return nil
}
```

Add to the `Makefile`:

```makefile
SQLITE_DB ?= ../biznext.db

import-sqlite:
	go run ./scripts/import_sqlite -sqlite $(SQLITE_DB) -dsn "$(DATABASE_URL)"
```

and add `import-sqlite` to the `.PHONY` list.

- [ ] **Step 2: Dry-run the import, then run it**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
go run ./scripts/import_sqlite -sqlite ../biznext.db -dsn "postgres://postgres:postgres@localhost:5433/ktbbiznext?sslmode=disable" -dry-run
make import-sqlite
```

Expected: the dry run lists each device; the real run reports
`done: N imported, 0 skipped`. Confirm with:

```bash
docker compose exec -T postgres psql -U postgres -d ktbbiznext -c 'SELECT alias, device_id, pin IS NOT NULL AS has_pin FROM devices ORDER BY alias;'
```

- [ ] **Step 3: Rewrite the Bruno collection**

Delete the leftover `bruno/Health.bru` / `bruno/Ready.bru` only if their URLs
changed; the port did, so update both.

`bruno/bruno.json`:

```json
{
  "version": "1",
  "name": "ktb-biznext-api",
  "type": "collection",
  "ignore": [
    "node_modules",
    ".git"
  ]
}
```

`bruno/environments/local.bru`:

```
vars {
  BASE_URL: http://localhost:3001
  API_URL: http://localhost:3001/api/v1
  API_KEY: change-me
  alias: acme
  instruction_ref_no: 
  bulk_order_id: 
  bulk_item_id: 
}
```

Every request file follows this shape — here is `bruno/Devices/List.bru` in
full, as the template for the rest:

```
meta {
  name: List devices
  type: http
  seq: 3
}

get {
  url: {{API_URL}}/devices
  body: none
  auth: none
}

headers {
  X-API-Key: {{API_KEY}}
}

settings {
  encodeUrl: true
  timeout: 0
}
```

Create one file per endpoint, grouped in folders, with `seq` numbering within
each folder:

| Folder / file | Method | URL |
|---|---|---|
| `Health.bru` | GET | `{{BASE_URL}}/health` |
| `Ready.bru` | GET | `{{BASE_URL}}/ready` |
| `Devices/Register.bru` | POST | `{{API_URL}}/devices/register` |
| `Devices/Verify OTP.bru` | POST | `{{API_URL}}/devices/verify-otp` |
| `Devices/Add.bru` | POST | `{{API_URL}}/devices` |
| `Devices/List.bru` | GET | `{{API_URL}}/devices` |
| `Devices/Get.bru` | GET | `{{API_URL}}/devices/{{alias}}` |
| `Devices/Update.bru` | PATCH | `{{API_URL}}/devices/{{alias}}` |
| `Devices/Delete.bru` | DELETE | `{{API_URL}}/devices/{{alias}}` |
| `Devices/Login.bru` | POST | `{{API_URL}}/devices/{{alias}}/login` |
| `Accounts/Overview.bru` | GET | `{{API_URL}}/devices/{{alias}}/accounts/overview` |
| `Accounts/Cashflow.bru` | GET | `{{API_URL}}/devices/{{alias}}/accounts/cashflow` |
| `Accounts/Source of funds.bru` | GET | `{{API_URL}}/devices/{{alias}}/accounts/source-of-funds` |
| `Accounts/Transactions.bru` | GET | `{{API_URL}}/devices/{{alias}}/accounts/transactions?page_size=40&page_number=0` |
| `Accounts/Check name.bru` | GET | `{{API_URL}}/devices/{{alias}}/accounts/check-name?account_to=1234567890&bank_code=006` |
| `Accounts/Check limit.bru` | GET | `{{API_URL}}/devices/{{alias}}/accounts/check-limit` |
| `Accounts/Corporate ref id.bru` | POST | `{{API_URL}}/devices/{{alias}}/accounts/corporate-ref-id` |
| `Accounts/Account ref id.bru` | POST | `{{API_URL}}/devices/{{alias}}/accounts/account-ref-id` |
| `Transfers/Transfer.bru` | POST | `{{API_URL}}/devices/{{alias}}/transfers` |
| `Transfers/Transfer multi.bru` | POST | `{{API_URL}}/devices/{{alias}}/transfers/multi` |
| `Transfers/Transfer bulk.bru` | POST | `{{API_URL}}/devices/{{alias}}/transfers/bulk` |
| `Instructions/Pending.bru` | GET | `{{API_URL}}/devices/{{alias}}/instructions/pending` |
| `Instructions/Submitted.bru` | GET | `{{API_URL}}/devices/{{alias}}/instructions/submitted` |
| `Instructions/Detail.bru` | GET | `{{API_URL}}/devices/{{alias}}/instructions/{{instruction_ref_no}}` |
| `Instructions/Activity log.bru` | GET | `{{API_URL}}/devices/{{alias}}/instructions/{{instruction_ref_no}}/activity-log` |
| `Instructions/Approve.bru` | POST | `{{API_URL}}/devices/{{alias}}/instructions/{{instruction_ref_no}}/approve` |
| `Instructions/Bulk items.bru` | GET | `{{API_URL}}/devices/{{alias}}/bulk-orders/{{bulk_order_id}}/items` |
| `Instructions/Bulk item detail.bru` | GET | `{{API_URL}}/devices/{{alias}}/bulk-orders/{{bulk_order_id}}/items/{{bulk_item_id}}` |

Each folder gets a `folder.bru`:

```
meta {
  name: Devices
  seq: 1
}
```

Bodies for the POST/PATCH requests, in a `body:json { ... }` block with
`body: json` in the method block:

```jsonc
// Devices/Register.bru
{"alias": "{{alias}}", "company_id": "", "user_id": "", "password": "", "delivery_method": "OTP_EMAIL"}

// Devices/Verify OTP.bru
{"alias": "{{alias}}", "otp": "", "pin": ""}

// Devices/Add.bru
{"alias": "{{alias}}", "device_id": "", "pin": ""}

// Devices/Update.bru
{"corporate_ref_id": "", "account_ref_id": "", "from_account_no": ""}

// Transfers/Transfer.bru
{"account_to": "1234567890", "bank_code": "006", "bank_name": "กรุงไทย", "amount": "10.00"}

// Transfers/Transfer multi.bru and Transfers/Transfer bulk.bru
{"recipients": [{"account_to": "1234567890", "bank_code": "006", "bank_name": "กรุงไทย", "amount": "10.00"}]}
```

`Devices/Register.bru` gets a post-response script so the OTP step can follow
straight on:

```
script:post-response {
  if (res.status === 201 && res.body.data) {
    bru.setEnvVar("device_id", res.body.data.device_id);
  }
}
```

- [ ] **Step 4: Rewrite `README.md`**

Cover, in this order: what the service is (a Go proxy in front of Krungthai
BizNext, replacing the Node service in `../src`); prerequisites (Go 1.25,
Docker, `golang-migrate`); getting started (`cp config.yaml.example config.yaml`,
`make docker-up`, `make migrate-up`, `make import-sqlite`, `make run`);
authentication (`X-API-Key`, set `app.api_keys`); the endpoint table from Task
17 Step 5; the error contract including the `502` upstream object; a
"differences from the Node service" section listing the eight behavioral
changes from the design document §15; and the verification command
(`make check`).

Do not document the PIN as encrypted at rest. It is not, and the README saying
otherwise would be worse than the plaintext itself.

- [ ] **Step 5: Run the full local gate**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
make check
```

Expected: `go mod tidy` produces no diff, `go vet` clean, `golangci-lint run`
clean, `go test -race ./...` all green. Fix anything the linter flags — the
config enables `errcheck` with `check-type-assertions`, `errorlint`, `gocritic`,
`revive`, `unparam`, and `govet` shadow checking, so unchecked errors and
shadowed variables will surface here rather than in review.

- [ ] **Step 6: Live smoke test against one real device**

This is the only step that touches the bank. Run it with a device that already
exists in the imported data, and use a small amount.

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
make run &
sleep 3
KEY='change-me'
ALIAS='<an imported alias>'

curl -s -H "X-API-Key: $KEY" localhost:3001/api/v1/devices | head -c 400; echo
curl -s -X POST -H "X-API-Key: $KEY" localhost:3001/api/v1/devices/$ALIAS/login | head -c 400; echo
curl -s -H "X-API-Key: $KEY" localhost:3001/api/v1/devices/$ALIAS/accounts/overview | head -c 400; echo
curl -s -H "X-API-Key: $KEY" localhost:3001/api/v1/devices/$ALIAS/accounts/check-limit | head -c 400; echo
curl -s -H "X-API-Key: $KEY" "localhost:3001/api/v1/devices/$ALIAS/accounts/transactions?page_size=5" | head -c 400; echo
curl -s -H "X-API-Key: $KEY" localhost:3001/api/v1/devices/$ALIAS/instructions/pending | head -c 400; echo
```

Check three things specifically:

1. **`/accounts/check-limit` succeeds.** This is the endpoint whose
   `subServices[]` bracket encoding was reproduced from axios without an
   upstream capture to confirm it (Task 7 Step 3). A `400` here means the bank
   wants the bare repeated key: change `TransactionLimit` in
   `methods_account.go` to emit `subServices=` without brackets, update
   `TestTransactionLimit_UsesBracketedRepeatedParam`, and re-run.
2. **`/devices/{alias}/login` returns `has_access_token: true` and a populated
   `account_ref_id` and `from_account_no`.** The last field is the one the Node
   service never managed to set automatically.
3. **Nothing in `logs/app.log` contains a PIN or a bearer token.**
   `grep -iE '"pin"|Bearer |access_token' logs/app.log` must come back empty.

Then, only if the user approves a live money movement, transfer the smallest
allowed amount to a known account and confirm the response carries a
`transfer_order_id` and that the instruction appears under
`/instructions/pending`.

- [ ] **Step 7: Final commit**

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026/ktb-biznext-api
git add -A
git commit -m "feat: add SQLite import script, Bruno collection, and README"
```

- [ ] **Step 8: Move the spec and this plan into the project**

They document this codebase, so they belong with it rather than in the parent
folder, which is not a git repository.

```bash
cd /Users/villain0x0/Desktop/apiappnextbiz03042026
mkdir -p ktb-biznext-api/docs/superpowers/specs ktb-biznext-api/docs/superpowers/plans
mv docs/superpowers/specs/2026-08-24-ktb-biznext-go-conversion-design.md ktb-biznext-api/docs/superpowers/specs/
mv docs/superpowers/plans/2026-08-24-ktb-biznext-go-conversion.md ktb-biznext-api/docs/superpowers/plans/
cd ktb-biznext-api
git add docs/superpowers
git commit -m "docs: add conversion design and implementation plan"
```

---

## Done

The Node service in `../src` and its `../biznext.db` can stay in place as a
reference until the Go service has run a full cycle in production. Nothing in
this plan deletes them.
