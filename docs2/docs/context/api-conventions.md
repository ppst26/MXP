# Context: API Conventions

## Handler Boundaries

HTTP handlers perform only:

1. Bind path, query, or JSON input.
2. Validate transport input.
3. Read trusted identity from middleware context.
4. Map input to domain types.
5. Call one service operation.
6. Map and send the response.

Business rules belong in services. SQL and Redis calls belong in repositories.

## Feature Files

| File | Responsibility |
|---|---|
| `handler.go` | `Handler` and `NewHandler` |
| `dto.go` | JSON DTOs and short domain/response mappers |
| `helpers.go` | Query parsing and context extraction |
| `handlers.go` | Handler methods |
| `routes.go` | `fx.In` route parameters and registration |

Split `handlers.go` by audience or sub-resource when it becomes difficult to scan.

## Route Groups

Use `internal/adapter/http/routing`; do not recreate authentication middleware in each feature.

```go
public := routing.UserAuthGroup(p.Router)
public.POST("/login", h.login)

user := routing.UserGroup(p.Router, p.Store, sessionTTL)
notes := user.Group("/notes")
notes.GET("", h.list)
notes.GET("/:id", h.get)
```

Current prefixes:

- Public auth: `/api/v1/auth`
- Authenticated API: `/api/v1`
- Public non-auth endpoints: `/api/v1/public`

User-owned endpoints must derive `user_id` from the authenticated context. Never accept ownership from request JSON or query parameters.

## Response Envelope

Use `internal/adapter/http/resp`:

```json
{"success": true, "code": 200, "data": {}}
```

```json
{"success": false, "code": 400, "message": "..."}
```

- `resp.Success` — 200
- `resp.Created` — 201
- `resp.NoContent` — 204
- `resp.Paginated` — 200 with pagination metadata
- `resp.Error` — maps shared sentinels to HTTP status

`resp` must not import feature packages. Domain errors wrap shared sentinels so centralized mapping remains possible.

### Error hygiene

`resp.Error` records the full error on the gin context (`c.Error`) and then
picks a client-safe message:

- 4xx (client errors): the wrapped domain message is returned as-is.
- 5xx (server errors): a generic message (`internal server error` /
  `service unavailable`) is returned; the real error is logged by the logging
  middleware together with the request `trace_id`.

Never hand-build 5xx bodies that echo internal or database error text.

## Health and Readiness

`internal/adapter/http/health` registers:

- `GET /health` — liveness only; returns 200 without touching dependencies.
- `GET /ready` — readiness; pings PostgreSQL and Redis and returns `503` with a
  per-dependency status map if any check fails.

Use `/health` for liveness probes and `/ready` for readiness/load-balancer gating.

## DTO and Validation Rules

- HTTP DTOs own JSON tags and transport validation tags.
- Domain DTOs have no JSON or database tags.
- JSON fields use `snake_case`.
- Invalid JSON maps to `errs.ErrInvalidJSON`.
- Invalid UUID path parameters map to a typed feature error such as `note.ErrInvalidNoteID`.
- Return response timestamps in UTC using RFC3339.
- Never expose password hashes, session storage values, or internal database errors.

## List Endpoints (page, sort, search)

List endpoints accept the same query parameters across every service:

| Param | Meaning |
|---|---|
| `page` | 1-based page number; invalid values fall back to 1 |
| `limit` | page size; clamped to `consts.MaxPageSize` |
| `sort_by` | whitelisted sort key (e.g. `created_at`, `title`) |
| `sort_order` | `asc` or `desc` |
| `search` | free-text search across the feature's searchable columns |

Handlers parse them into the domain `ListQuery` (see
`adapter/http/note/helpers.go`); the service normalizes paging; the repository
validates `sort_by` / `sort_order` against its `base.SortConfig` whitelist.
An unknown sort key returns `400` (`errs.ErrInvalidSortColumn`) instead of silently
sorting by something else.

Ownership fields (`user_id`) always come from the session, never from the query
string.

## Pagination

Defaults:

```go
consts.DefaultPageSize // 20
consts.MaxPageSize     // 100
```

Services normalize invalid page and limit values. Repositories receive an already-valid query.

Paginated responses contain:

```json
{
  "success": true,
  "code": 200,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "pages": 0
  }
}
```

## Authentication

Protected routes expect:

```text
Authorization: Bearer <opaque-token>
```

The middleware validates the Redis session, extends its TTL, and injects:

- `consts.UserIDKey`
- `consts.EmailKey`
- `consts.SessionTokenKey`

See `docs/session-auth-standard.md`.

## Bruno Collection

The `bruno/` folder is the canonical manual API contract for this starter (not OpenAPI).

Required rule: **any HTTP endpoint add/change/remove must update `bruno/` in the same change.**

| Change | Bruno update |
|---|---|
| New route | Add a matching `.bru` under the feature folder |
| Changed path / method / body / auth | Edit the existing `.bru` |
| Removed route | Delete the `.bru` |
| New shared variable (token, id, base URL) | Update `bruno/environments/*.bru` |

Layout:

```text
bruno/
├── bruno.json
├── environments/local.bru
├── Health.bru
├── Ready.bru
├── Auth/          # register, login, me, logout
└── Notes/         # list, create, get, update, delete
```

Conventions:

- Use `{{API_URL}}` / `{{BASE_URL}}` from the environment — do not hardcode host/port in requests.
- Protected requests use `auth:bearer` with `{{session_token}}`.
- Login/Register scripts store `session_token`; Create Note stores `note_id`.
- Keep example bodies valid against the current HTTP DTOs.

Bruno is a developer/backoffice contract. It is not required in CI.

## Logging and Timeouts

Every service emits the same JSON log shape so one aggregator query works across
the platform. `shared.NewLogger` fixes the field names — `timestamp`, `level`,
`logger`, `caller`, `message`, `stacktrace` — and writes to stdout plus a dated
rotating file (`YYYYMMDDNN.log`) when `log.file_path` is set. Do not fall back to
zap defaults (`msg`), and do not rename these keys per service.

The request logger emits one line per request with:

```text
trace_id, method, path, query, remote_addr, user_agent, status, bytes, duration, duration_ms
```

- Message is `HTTP Request`, or `HTTP Request failed` at error level when any
  `c.Error` was recorded. Clients still receive the sanitized envelope.
- `trace_id` is published to the gin context **and** to `c.Request.Context()`.
  Downstream layers read it with `shared.TraceIDFromContext(ctx)` and include it in
  their own logs:

```go
logger.Info("note created",
    zap.String("trace_id", shared.TraceIDFromContext(ctx)),
    zap.String("note_id", n.ID.String()),
    zap.Error(err), // only on errors
)
```

Levels: `Debug` local troubleshooting · `Info` normal flow and state changes ·
`Warn` recoverable/expected failures · `Error` unexpected failures worth alerting.

- Do not log passwords, bearer tokens, raw session values, or full request bodies.
- Use request contexts for all service and repository calls.
- `TimeoutMiddleware` is applied globally with `app.request_timeout` (default `15s`); it recovers panics from the handler goroutine and returns `408` on deadline. Tune per-route only when a specific endpoint needs a different bound.
