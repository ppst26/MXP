# Context: Architecture and Project Structure

## Overview

`go-template` is a minimal Go REST API starter using Clean Architecture and dependency injection with `go.uber.org/fx`.

It is also the **platform standard**: every Go service in this workspace (`be-maxauto`,
`be-central`, `be-lottery`, …) uses the same layer layout, logging shape, error
sentinels, repository base, and persistence model/mapper rules. `be-maxauto` is the
largest consumer of these conventions; when a rule here and a rule there disagree,
they must be reconciled instead of forked. Project-specific business rules stay in
the service that owns them — only shared shape lives here.

## Deployment Shape: Modular Monolith, Microservice-Ready

Default shape is a **modular monolith** — the standard for small teams and early products:

- One process (`cmd/app`)
- One composition root (`internal/app`)
- Multiple feature modules under `domain/`, `service/`, and `adapter/`
- Shared infrastructure in `shared/` (config, DB, Redis, logging, errors)

This is intentional. A small team should optimize for speed, shared transactions, and simple operations — not for a fleet of services on day one.

At the same time the layout is **microservice-ready** for when the project and team grow:

| Boundary already in place | Why extraction is easier later |
|---|---|
| Feature-sized domain packages | Contracts and rules travel with the feature |
| Feature-sized services | Use cases are not mixed into a shared god service |
| Feature-sized HTTP + repository adapters | Transport and persistence can move with the module |
| Domain interfaces for repositories/stores | Callers depend on ports, not concrete SQL/Redis |
| fx modules per layer | Wiring can be cut and rehomed into a new binary |

Compared with a classic tangled monolith, extraction is not free — but it is **materially easier** because module seams already exist.

### When to stay monolith

- Small team owns the whole product
- Features share database transactions often
- Operational cost of many services is not justified yet

### When to extract a microservice

Extract a feature when growth creates a real need:

- Team/project scale needs independent ownership or deploy cadence
- Independent scale of a hot path
- Stronger failure isolation
- Different data store or compliance boundary

### Extraction sketch

Example: extract `note` later:

1. Copy `domain/note`, `service/note`, `adapter/http/note`, `adapter/repository/note`, and related persistence/migrations into a new repo or `cmd/note-service`.
2. Keep calling the note APIs through HTTP/gRPC instead of in-process service calls.
3. Move only the tables that belong to that bounded context.
4. Leave shared concerns (session auth, logging, error sentinels) as shared libraries or a platform package — do not duplicate them carelessly.

Do **not** pre-split into microservices “just in case.” Keep module boundaries clean so extraction remains an option when the team and project actually scale.

## Stack

| Area | Technology |
|---|---|
| Language | Go 1.25 |
| HTTP | Gin |
| Database | PostgreSQL, pgx, sqlx |
| Query builder | Squirrel |
| Session store | Redis |
| Dependency injection | fx |
| Configuration | Viper (`config.yaml` + `APP_*` environment overrides) |
| Logging | Zap + lumberjack |
| Validation | go-playground/validator |
| Migrations | golang-migrate |
| Testing | testify, sqlmock, miniredis |

## Layers

```text
cmd/app/                     application entry point
internal/
├── app/                     root fx module
├── domain/{feature}/        entities and contracts
├── service/{feature}/       business use cases
├── adapter/
│   ├── http/                Gin transport
│   ├── repository/          PostgreSQL and Redis implementations
│   │   ├── base/            BaseRepository + query builder helpers (shared)
│   │   ├── tx/              transaction helper (multi-write use cases)
│   │   └── {feature}/       one package per feature
│   └── persistence/         database models and mappers
│       ├── model/           db-tagged structs (never leave the adapter layer)
│       └── mapper/          model <-> domain conversion
└── shared/                  config, clients, logging, errors, constants
db/migrations/               versioned database schema
docs/                        architecture and conventions
```

Dependencies point inward:

```text
HTTP / Repository adapters → Service → Domain
                         Shared infrastructure
```

- Domain must not import adapter or service packages.
- Domain may import `internal/shared/errs` only for sentinel error wrapping.
- Service depends on domain interfaces, not concrete repositories.
- Services may depend on other services through their domain interfaces
  (for example `auth` consumes `user.Service`, not `user.Repository`).
- Persistence models and JSON DTOs must not leak into domain entities.

## Operational Concerns

The starter ships production-shaped operational defaults:

| Concern | Where | Behavior |
|---|---|---|
| Liveness | `adapter/http/health` `/health` | Static OK, no dependency calls |
| Readiness | `adapter/http/health` `/ready` | Pings DB and Redis; `503` if any is down |
| Graceful shutdown | `shared/lifecycle.go`, `adapter/http/module.go` | HTTP drain, then close DB pool, Redis, and flush logs via fx `OnStop` |
| Request timeout | `adapter/http/middleware` | Every request bounded by `app.request_timeout`; goroutine panics recovered |
| CORS | `adapter/http/module.go` | Wildcard in dev only; explicit allow-list required in production |
| Error hygiene | `adapter/http/resp` | 5xx returns a generic message; full detail logged with `trace_id` |

## Domain Feature Layout

Every `internal/domain/{feature}` package contains:

| File | Responsibility |
|---|---|
| `entity.go` | Entities, value objects, constants |
| `dto.go` | Use-case inputs and query types; no transport tags |
| `errors.go` | Typed domain errors wrapping shared sentinels |
| `repository.go` | Persistence or store interface |
| `service.go` | Use-case interface |
| `validator.go` | Pure domain validation |

Every feature package MUST contain all six files, even when a file is empty for now.
A predictable layout is what lets any service in the platform be read the same way.
Use a package-only stub with a one-line reason:

```go
// repository.go — agent has no domain repository; persistence lives in the external adapter.
package agent
```

File boundaries:

- `entity.go` — what the domain **is** (`Note`, `RewardType`, `IsActive()`).
- `dto.go` — what operations **accept** (`CreateNoteData`, `ListQuery`); no JSON or `db` tags.
- Domain `dto.go` is not the HTTP `adapter/http/{feature}/dto.go`; the HTTP layer owns JSON and mapping.

Deprecated: `query.go`. Rename it to `dto.go` and move `Create`/`Update` structs out of `entity.go`.

## External Adapter Rules

Every external client lives in `internal/adapter/external/{name}/`:

| File | Responsibility |
|---|---|
| `client.go` | Interface + struct + constructor |
| `dto.go` | Request/response types |
| `methods.go` | API calls (split by domain when many) |
| `module.go` | `fx.Provide(NewClient)` |

- Every client must have an interface so services can be tested with a fake.
- No business logic in a client — HTTP calls and response mapping only.
- No god files: unrelated endpoints go in separate files.

## HTTP Feature Layout

```text
internal/adapter/http/{feature}/
├── handler.go       Handler struct and constructor only
├── dto.go           JSON request/response types and small mappers
├── helpers.go       HTTP parsing and context helpers
├── handlers.go      Handler methods
└── routes.go        Route registration only
```

Shared route prefixes and authentication belong in `internal/adapter/http/routing`.

## fx Registration

Constructors use `fx.Provide`; route and lifecycle side effects use `fx.Invoke`.

```go
var Module = fx.Options(
    fx.Provide(NewService),
)
```

When adding a feature:

1. Add domain contracts and validation (all six files).
2. Implement and test the service.
3. Add the persistence model and the full mapper set
   (`XToModel`, `XToDomain`, `XsToDomain`), then the repository on top of
   `adapter/repository/base` plus its sqlmock tests.
4. Add HTTP DTOs, handler, helpers, and routes.
5. Register constructors and routes in each layer's `module.go`.
6. Add or update Bruno requests under `bruno/` for every new/changed HTTP endpoint.
7. Add reversible migrations when the schema changes.

## Naming

- Packages: lowercase, one word.
- Interfaces: `Service`, `Repository`, or a role-specific name.
- Errors: `Err` prefix.
- JSON fields: `snake_case`.
- Handler methods: unexported when only routes call them.

## Comment Style

- All comments in English, including `TODO` / `FIXME` / `NOTE`.
- Exported types and functions use godoc style, starting with the item name.
- Comment **why**, not what; delete comments that restate the code.

## Makefile Commands

```bash
make run              # run once
make dev              # auto-reload (nodemon)
make build            # build binary

make docker-up        # start PostgreSQL + Redis
make docker-down      # stop containers
make docker-logs      # tail container logs

make migrate-create   # prompts for a name
make migrate-up
make migrate-down
make migrate-reset    # drop + re-apply (local only)

make test             # unit tests
make test-race        # race detector
make cover            # coverage summary (alias: test-coverage)
make check            # tidy + vet + lint + test-race (CI gate)
```

## Configuration

Viper loads `config.yaml` and supports `APP_*` overrides:

```text
APP_APP_PORT
APP_APP_REQUEST_TIMEOUT
APP_APP_CORS_ORIGINS
APP_DATABASE_DSN
APP_REDIS_ADDR
APP_REDIS_TTL
APP_LOG_LEVEL
```

In `production`, `app.cors_origins` must be set or startup fails (no wildcard allowed).

Never commit secrets or environment-specific production values.
