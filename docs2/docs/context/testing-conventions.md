# Context: Testing Conventions

## Required Coverage

| Layer | Expected tests |
|---|---|
| Domain | Validators, value-object behavior, typed errors |
| Service | Business rules, validation, repository interactions, error propagation |
| PostgreSQL repository | SQL shape, arguments, mapping, not-found/conflict behavior |
| Redis repository | Store lifecycle, TTL behavior, atomic session replacement |
| HTTP | Non-trivial binding, context, middleware, or response behavior |

Every new service and repository must have tests.

## Naming

Use:

```go
func TestNoteService_Create_Success(t *testing.T)
func TestNoteRepository_Update_NotFound(t *testing.T)
```

Use table-driven subtests when scenarios share setup.

## Assertions

- `require` for setup and conditions that prevent meaningful continuation.
- `assert` for independent result comparisons.
- Use `require.ErrorIs` against typed domain errors and shared sentinels.
- Never assert only error strings when a typed error exists.

```go
require.ErrorIs(t, err, note.ErrNoteNotFound)
require.ErrorIs(t, err, errs.ErrNotFound)
```

## Service Mocks

Use manual mocks implementing domain interfaces. `testify/mock` is preferred for interaction assertions.

- Keep one-off mocks next to the test.
- Move mocks to a shared test utility package only after reuse.
- Assert that invalid input does not call a repository.
- Assert ownership identifiers passed to repository methods.

## PostgreSQL Repository Tests

Use `github.com/DATA-DOG/go-sqlmock` with `sqlx.NewDb`.

Test:

- Generated SQL and argument order.
- Persistence-to-domain mapping.
- `sql.ErrNoRows` mapping.
- Unique violation mapping.
- `RowsAffected() == 0` behavior for update and delete.
- Wrapped unexpected database errors where meaningful.

Always finish with:

```go
require.NoError(t, mock.ExpectationsWereMet())
```

sqlmock is not a database substitute. Add integration tests for PostgreSQL-specific semantics, constraints, transactions, or locking.

Integration tests live beside their unit tests under a `//go:build integration`
tag and take their database from `pgtest.DB(t)`, which skips when
`TEST_DATABASE_URL` is unset. Run them with `make test-integration`. Use them
only for behaviour PostgreSQL owns — constraints, triggers, locking,
concurrency — never as a slower way to test Go logic.

## Redis Repository Tests

Use `github.com/alicebob/miniredis/v2`.

Test:

- Set, get, delete, and missing keys.
- TTL extension.
- Atomic session `Swap`.
- Deletion of an old session during single-session replacement.

## HTTP Middleware Tests

Use `net/http/httptest` with a minimal `gin` engine.

- Register the middleware on a throwaway route and assert status codes.
- Back session middleware with an in-memory `session.Store` fake rather than real Redis.
- Cover the missing-header, unknown-token, and valid-token paths at minimum.

See `internal/adapter/http/middleware/auth_test.go`.

## Shared Base Repository Tests

`internal/adapter/repository/base` is used by every feature repository, so its
behavior is covered directly:

- `ApplySort` default fallback, whitelist mapping, `NULLS LAST`, secondary id sort.
- `ApplyPagination` clamping (`page < 1`, `limit > MaxPageSize`, `limit < 1`).
- `ValidateSortColumn` / `ValidateSortOrder` returning the shared sentinels.
- `CheckRowsAffectedWith` / `MapNotFound` mapping to the feature's own error.

Feature repositories then assert their own SQL shape with sqlmock, including the
table alias used by their `SortConfig`.

## Logging Tests

- `shared.NewLogger` writes `"message"`/`"timestamp"` keys to a dated file — a
  regression here silently breaks log aggregation for the whole platform.
- The request middleware publishes `trace_id` into `c.Request.Context()` and logs
  `HTTP Request` / `HTTP Request failed`. Use `zaptest/observer` rather than
  parsing stdout.

## Transaction Helper Tests

`shared.WithTransaction` is covered with sqlmock for commit, rollback-on-error,
and rollback-on-panic. Reuse the same pattern when adding transactional
repositories (`ExpectBegin` / `ExpectCommit` / `ExpectRollback`).

## Test Independence

- Use `context.Background()` or an explicit canceled/deadline context.
- Generate unique UUIDs in each test.
- Do not depend on test execution order.
- Do not require local Docker services for normal unit tests.
- Register cleanup with `t.Cleanup`.

## Verification

Run from the project root:

```bash
go test ./...
go test -race ./...
go vet ./...
go build ./...
```

The race run is required for changes involving concurrency, shared state, middleware goroutines, or atomic session behavior.
