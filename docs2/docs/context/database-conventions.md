# Context: Database Conventions

## Primary Keys (UUIDv7)

Persistent entity primary keys use **UUIDv7** (time-ordered):

| Source | API |
|---|---|
| PostgreSQL DEFAULT | `uuidv7()` (built-in since PostgreSQL 18; no extension) |
| Application create paths | `internal/shared/id.New()` → `uuid.Must(uuid.NewV7())` |

Dual generation is intentional: the app can know the ID before insert, while SQL that omits `id` still gets a correct v7 from the database.

Do **not** use `uuid-ossp` or `gen_random_uuid()` for primary keys.

Keep random UUIDv4 (`uuid.New()`) for non-index identifiers such as HTTP `trace_id`. Opaque session tokens use `crypto/rand`, not UUID.

## Migrations

Use paired, reversible migration files:

```text
db/migrations/NNNNNN_description.up.sql
db/migrations/NNNNNN_description.down.sql
```

- Migrations contain schema changes, constraints, indexes, and required schema transformations.
- Do not place normal business data in migrations.
- The down migration must reverse the up migration safely.
- Add foreign-key and query-path indexes explicitly.

Create and run migrations with:

```bash
make migrate-create
make migrate-up
make migrate-down
```

## Repository Pattern

- Define repository contracts in `internal/domain/{feature}/repository.go`.
- Implement them in `internal/adapter/repository/{feature}/repository.go` — one
  package per feature, never a flat `{feature}_repository.go` in a shared package.
- Embed `*base.BaseRepository` instead of re-declaring `db` / `builder` fields.
- Use Squirrel with PostgreSQL dollar placeholders. Hand-built `$1`/`$2` strings
  and `fmt.Sprintf` argument counters are not allowed: the index drifts the moment
  a column is added.
- Use sqlx context-aware methods: `ExecContext`, `GetContext`, and `SelectContext`.
- Every repository method performing I/O accepts `context.Context`.
- Map persistence models to domain entities through `adapter/persistence/mapper`.
- Do not return persistence models outside the adapter layer.

```go
query, args, err := r.builder.
    Select("id", "user_id", "title").
    From("notes").
    Where(squirrel.And{
        squirrel.Eq{"id": noteID},
        squirrel.Eq{"user_id": userID},
    }).
    ToSql()
```

Use ordered expressions such as `squirrel.And` when argument ordering matters. Avoid multi-key maps where deterministic SQL is important for maintenance and tests.

## Shared Repository Base

`internal/adapter/repository/base` is the shared toolkit. Use it instead of
re-implementing the same helpers per feature:

| Helper | Use |
|---|---|
| `NewBaseRepository(db)` | `DB` + squirrel builder with dollar placeholders |
| `WithTimeout` / `ExecuteWithTimeout` | Bound a call that arrived without a deadline (`DefaultTimeout` 3s) |
| `CheckRowsAffected` | Zero-row UPDATE/DELETE → `errs.ErrRecordNotFound` |
| `CheckRowsAffectedWith` | Zero-row UPDATE/DELETE → the feature's own not-found error |
| `MapNotFound` | `sql.ErrNoRows` → the feature's own not-found error |
| `ApplySort` / `ValidateSortColumn` / `ValidateSortOrder` | Whitelisted ORDER BY |
| `ApplyPagination` | Clamped LIMIT/OFFSET |
| `ApplyStringSearch` | Multi-column `ILIKE` search |
| `ApplyBoolFilter` / `ApplyRangeFilter` / `ApplyDateRangeFilter` | Optional filters |

Money columns must never use `ApplyRangeFilter` (`float64`). Add a
`decimal.Decimal` variant when the service introduces money.

```go
var noteSortConfig = base.SortConfig{
    ColumnMap: map[string]string{
        "created_at": "n.created_at",
        "title":      "LOWER(n.title)",
    },
    DefaultCol:   "n.created_at",
    DefaultOrder: "DESC",
}
```

`ApplySort` always appends a secondary `id` sort so pages stay stable across equal
values, and adds `NULLS LAST` to datetime columns.

## CRITICAL — Table Alias Consistency

If `SortConfig` (or any filter column) uses a table alias, the `FROM` clause MUST
declare that alias — even when the query has no JOIN. Otherwise PostgreSQL fails
with `42P01`.

```go
// WRONG — alias used in ORDER BY but FROM has no alias
qb := r.Builder.Select("*").From("notes")

// CORRECT
qb := r.Builder.Select("n.id", "n.title").From("notes n")
```

The same rule applies to the matching `Count()` query.

## Transaction Helper

Use `internal/adapter/repository/tx.TransactionHelper` (injected via fx) when a use
case writes to several tables:

```go
err := t.WithTx(ctx, func(tx *sqlx.Tx) error {
    // all writes share one transaction
    return nil
})
```

`*sqlx.Tx` must not appear in domain interfaces.

## Ownership and Authorization

Authorization constraints must be enforced in SQL, not only in a preceding service check:

```sql
WHERE id = $1 AND user_id = $2
```

For user-owned records:

- `Find`, `Update`, and `Delete` include `user_id`.
- A record owned by another user is indistinguishable from a missing record.
- Zero affected rows maps to the feature's not-found error.

## Error Mapping

- `sql.ErrNoRows` maps to a typed domain not-found error.
- PostgreSQL unique violation `23505` maps to a typed domain conflict error.
- Other database errors are wrapped with operation context using `errs.WrapDatabaseError`.
- Never send raw database errors directly to an HTTP response.

## Transactions

Use a transaction when multiple writes must commit or roll back atomically.

- Pass the same context to all transaction operations.
- Roll back on every failure.
- Keep external network calls outside database transactions when possible.
- Do not expose `*sqlx.Tx` through domain interfaces; hide infrastructure details behind an adapter or transaction abstraction.

## Pagination and Ordering

- Use stable, explicit ordering for paginated queries (`base.ApplySort`).
- Services normalize page/limit with `shared.NormalizePagination`; repositories
  receive an already-valid query and apply `base.ApplyPagination`.
- Count with the same filters as the list query — build the filter clause once and
  apply it to both.
- Never interpolate client-provided column names directly into SQL. An unknown
  `sort_by` is a `400` via `base.ValidateSortColumn`, not a silent default.

## Connection Pool

| Setting | Default | Notes |
|---|---|---|
| `database.max_open_conns` | 25 | Raise for callback/high-concurrency workloads |
| `database.max_idle_conns` | 10 | Keep close to max_open for bursty traffic |
| `database.conn_max_lifetime` | 15m | Matches the platform default |

Env overrides use the `APP_` prefix (`APP_DATABASE_MAX_OPEN_CONNS`, …). A service
that adds a second pool (for batch/report reads) must keep wallet-style mutations
on the primary pool.

## Repository Tests

- PostgreSQL repositories use `go-sqlmock` for query, scan, affected-row, and error-mapping behavior.
- Redis repositories use `miniredis`.
- Assert every configured mock expectation.
- Use real PostgreSQL integration tests for behavior sqlmock cannot prove, such as constraints, locking, isolation, and database-specific functions.
