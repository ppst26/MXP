# Design Summary

## Goal

Standalone minimal API template derived from be-superapi conventions — suitable for copying into a new repository as a team starter / guideline.

## Deployment shape

**Modular monolith + microservice-ready.**

| Mode | Meaning |
|------|---------|
| Modular monolith (default) | Standard for small teams: one binary, one Postgres, one Redis. Features are modules with clear boundaries. |
| Microservice-ready | When the team/project grows, those modules can be extracted into separate services more easily than from a tangled monolith. |

Strategy: start modular-monolith as the team standard. Extract microservices only when team scale, ownership, or isolation requires it. Clean feature boundaries are the preparation — not premature service sprawl.

## Architecture

Clean Architecture with four layers:

| Layer | Responsibility |
|-------|----------------|
| `domain/` | Entities, DTOs, repository/service interfaces, validation, domain errors |
| `service/` | Use cases (auth, notes) |
| `adapter/` | HTTP (Gin), PostgreSQL repositories, Redis session store, persistence models |
| `shared/` | Config, DB, Redis, logger, session helpers, error sentinels |

Dependency rule: domain does not import adapter or service. Domain may import `shared/errs` for sentinel wrapping.

## Auth

- **Opaque session token** (32 random bytes → 64 hex), stored in Redis — not JWT
- Redis keys: `user:session:<token>`, `user:session_index:<user_id>`
- **Single session per user**: login uses atomic `Swap` (Lua) to delete old session
- **Sliding TTL**: 7 days (`redis.ttl` in config), extended on each authenticated request
- Passwords hashed with **bcrypt**

Endpoints: `POST /api/v1/auth/register|login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`

## Notes

CRUD scoped by `user_id` from auth middleware context. List supports `page` and `limit` pagination.

Endpoints: `GET/POST /api/v1/notes`, `GET/PUT/DELETE /api/v1/notes/:id`

## HTTP responses

Standard envelope matching be-superapi:

```json
{"success": true, "code": 200, "data": {}}
{"success": false, "code": 400, "message": "..."}
```

Paginated list includes `pagination: {page, limit, total, pages}`.

## Infrastructure

- **DI**: Uber fx modules (`shared` → `repository` → `service` → `http`)
- **Config**: Viper YAML + `APP_*` env overrides
- **Ports**: Postgres `5437`, Redis `6380` (avoid clash with be-superapi defaults)
- **Health**: `GET /health`
- **CORS**: enabled for development

## Database

```sql
users (id UUID PK DEFAULT uuidv7(), email UNIQUE, password_hash, name, timestamps + updated_at trigger)
notes (id UUID PK DEFAULT uuidv7(), user_id FK CASCADE, title, body, timestamps + updated_at trigger)
```

Application create paths also generate IDs with `internal/shared/id.New()` (UUIDv7) so inserts stay time-ordered even when the app supplies `id`.

## Out of scope (by design)

JWT, admin/2FA, gaming callbacks, money/decimal, batch writers, WebSocket, premature microservice split.
