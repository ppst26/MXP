# MaxPay P1 — Merchant and Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `be-maxpay` the merchants it serves, the credentials they authenticate with, the signature and idempotency guards that protect money-moving requests, and the back-office sign-in that platform staff and merchants share.

**Architecture:** Six new feature packages follow the repository's existing Clean Architecture split — `internal/domain/<feature>` holds entity/dto/errors/repository/service/validator, `internal/service/<feature>` implements the service interface, `internal/adapter/repository/<feature>` implements the repository against PostgreSQL with squirrel, and `internal/adapter/http/<feature>` binds and responds. Two new gin middlewares sit in front of the gateway route groups: one resolves an API key to a merchant, the other verifies a single-use HS256 signature. No Redis: replay and session state live in PostgreSQL, matching this service's recorded deviation.

**Tech Stack:** Go 1.25, gin, fx, sqlx + squirrel, PostgreSQL 18, `shopspring/decimal`, `golang-jwt/jwt/v5` (new), `golang.org/x/crypto/argon2` (promote to direct), `go-sqlmock`, `testify`.

**Spec:** `docs/superpowers/specs/2026-08-26-maxpay-merchant-ledger-design.md`

## Global Constraints

Copied from the spec and from `AGENTS.md`; every task inherits these.

- Every `internal/domain/{feature}` package has all six files: `entity.go`, `dto.go`, `errors.go`, `repository.go`, `service.go`, `validator.go` (a package-only stub when empty).
- Domain code must not import adapter or service packages. Domain DTOs carry no JSON or database tags.
- Errors wrap shared sentinels from `internal/shared/errs`. Never return raw database text to a caller.
- Every function performing I/O accepts `context.Context` as its first parameter.
- Repositories embed `*base.BaseRepository` and build SQL with squirrel and dollar placeholders. Never `fmt.Sprintf` a placeholder.
- Primary keys are UUIDv7 via `shared/id.New()` or the `uuidv7()` column default.
- Persistence models live in `internal/adapter/persistence/model` and never leave the adapter layer. Each entity ships `XToModel`, `XToDomain`, `XsToDomain` in `internal/adapter/persistence/mapper`.
- Money is `decimal.Decimal`. Never `float64`.
- Code, identifiers and comments in English, including `TODO`/`NOTE`.
- Log field names are `timestamp`, `level`, `logger`, `caller`, `message`, `stacktrace`. Never log a password, bearer token, PIN, secret key or signature.
- Every new or changed HTTP endpoint ships a matching `.bru` file under `bruno/` in the same commit.
- `signature_ttl` default 60s, `clock_skew` default 5s, `idempotency_inflight_timeout` default 5m, `session_ttl` default 12h.
- `security.kek` is 32 bytes, base64-encoded. Startup fails in production when it is missing. There is no development default.
- The JWT parser pins the algorithm to HS256. An unpinned parser is a security defect, not a style choice.
- `bo-maxpay` already calls `/api/v1/auth/login`, `/api/v1/auth/me` and `/api/v1/auth/logout` and expects `{success, code, data:{token, account}}` where `account` has `id`, `username`, `name`, `is_superadmin`, `permissions`. Changing that shape means changing `bo-maxpay/src/routes/api/auth/*` and `bo-maxpay/src/hooks/use-auth.ts` in the same change.

## File Structure

| File | Responsibility |
|---|---|
| `internal/shared/crypto/secretbox.go` | AES-256-GCM seal/open under the configured KEK |
| `internal/shared/crypto/password.go` | argon2id hash and verify |
| `internal/shared/crypto/token.go` | random base62 identifiers, API keys, opaque session tokens |
| `internal/shared/errs/errs.go` | adds `ErrUnprocessable` |
| `internal/adapter/http/resp/response.go` | adds the 422 case |
| `internal/domain/merchant/*` | merchant entity, tree rules, rate rules |
| `internal/domain/credential/*` | API keys, client ids, secret keys |
| `internal/domain/signature/*` | HS256 claims, verification result, replay record |
| `internal/domain/idempotency/*` | transaction-id guard |
| `internal/domain/adminuser/*` | back-office accounts and sessions |
| `internal/service/{merchant,credential,signature,idempotency,adminuser}/service.go` | use cases |
| `internal/adapter/repository/{merchant,credential,signature,idempotency,adminuser}/repository.go` | SQL |
| `internal/adapter/http/middleware/merchantauth.go` | `x-api-key` to merchant |
| `internal/adapter/http/middleware/signature.go` | signature verification |
| `internal/adapter/http/auth/*` | `/auth/*` endpoints |
| `internal/adapter/http/adminmerchant/*` | `/admin/merchants/*` endpoints |
| `db/migrations/000002..000004_*.sql` | schema |

---

### Task 1: A 422 the service does not have yet

The spec refuses a payout for insufficient balance with `422`. `errs` has no
such sentinel and `resp` has no case for it, so today that error would fall
through to `500`.

**Files:**
- Modify: `internal/shared/errs/errs.go`
- Modify: `internal/adapter/http/resp/response.go:75-99`
- Test: `internal/adapter/http/resp/response_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `errs.ErrUnprocessable` — an `error` sentinel that `resp` maps to HTTP 422

- [ ] **Step 1: Write the failing test**

Append to `internal/adapter/http/resp/response_test.go`:

```go
func TestError_UnprocessableMapsTo422(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/payout", nil)

	resp.Error(c, fmt.Errorf("insufficient balance: %w", errs.ErrUnprocessable))

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/adapter/http/resp/ -run TestError_Unprocessable -v`
Expected: a compile error — `undefined: errs.ErrUnprocessable`.

- [ ] **Step 3: Add the sentinel**

In `internal/shared/errs/errs.go`, between the 409 and 429 entries:

```go
	// 422 Unprocessable Entity — the request is well formed and authorised,
	// but the current state cannot satisfy it. A payout refused for
	// insufficient balance is the case this exists for: 400 tells an
	// integrator to fix its request and 409 tells it to resolve a conflict,
	// and both send it looking in the wrong place.
	ErrUnprocessable = errors.New("unprocessable entity")
```

- [ ] **Step 4: Add the mapping**

In `getStatusCode` in `internal/adapter/http/resp/response.go`, after the
`ErrConflict` case:

```go
	case errors.Is(err, errs.ErrUnprocessable):
		return http.StatusUnprocessableEntity
```

- [ ] **Step 5: Run the test and the package**

Run: `go test ./internal/adapter/http/resp/ ./internal/shared/errs/ -v`
Expected: PASS.

- [ ] **Step 6: Record the deviation**

`AGENTS.md` requires a reason whenever a file shared with the platform
standard changes. Add to the *Deviations From the Platform Standard* section:

```markdown
4. **`errs` and `resp` carry a 422.** The template has no unprocessable-entity
   sentinel. The gateway needs one: a payout refused for insufficient balance
   is authenticated, authorised and well formed, and reporting it as 400 or
   409 sends an integrator to the wrong place. This stays here; it is not
   ported back to `go-template`.
```

- [ ] **Step 7: Commit**

```bash
git add internal/shared/errs/errs.go internal/adapter/http/resp/response.go \
        internal/adapter/http/resp/response_test.go AGENTS.md
git commit -m "feat(errs): map an unprocessable state to 422"
```

---

### Task 2: Encryption, hashing and identifier generation

Three small primitives everything else needs. They live together because they
are all "turn bytes into something safe to store".

**Files:**
- Create: `internal/shared/crypto/secretbox.go`
- Create: `internal/shared/crypto/password.go`
- Create: `internal/shared/crypto/token.go`
- Create: `internal/shared/crypto/secretbox_test.go`
- Create: `internal/shared/crypto/password_test.go`
- Create: `internal/shared/crypto/token_test.go`
- Modify: `internal/shared/config.go`
- Modify: `config.yaml`, `config.yaml.example`

**Interfaces:**
- Consumes: `errs.ErrInternal`, `errs.NewConfigError`
- Produces:
  - `crypto.NewSecretBox(kekBase64 string) (*SecretBox, error)`
  - `(*SecretBox).Seal(plaintext []byte) ([]byte, error)`
  - `(*SecretBox).Open(ciphertext []byte) ([]byte, error)`
  - `crypto.HashPassword(plain string) (string, error)`
  - `crypto.VerifyPassword(hash, plain string) bool`
  - `crypto.RandomCode(n int) (string, error)` — base62
  - `crypto.NewAPIKey() (key, prefix string, err error)`
  - `crypto.NewOpaqueToken() (string, error)`
  - `crypto.SHA256(s string) []byte`
  - `cfg.Security.KEK`, `cfg.Security.SignatureTTL`, `cfg.Security.ClockSkew`, `cfg.Security.IdempotencyInflightTimeout`, `cfg.Security.SessionTTL`

- [ ] **Step 1: Write the failing tests**

`internal/shared/crypto/secretbox_test.go`:

```go
package crypto_test

import (
	"encoding/base64"
	"testing"

	"be-maxpay/internal/shared/crypto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testKEK(t *testing.T) string {
	t.Helper()
	return base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
}

func TestSecretBox_RoundTrip(t *testing.T) {
	box, err := crypto.NewSecretBox(testKEK(t))
	require.NoError(t, err)

	sealed, err := box.Seal([]byte("super-secret-key"))
	require.NoError(t, err)
	assert.NotContains(t, string(sealed), "super-secret-key")

	opened, err := box.Open(sealed)
	require.NoError(t, err)
	assert.Equal(t, "super-secret-key", string(opened))
}

// Two seals of the same plaintext must differ: a deterministic ciphertext
// tells anyone with read access which merchants share a secret.
func TestSecretBox_SealIsNonDeterministic(t *testing.T) {
	box, err := crypto.NewSecretBox(testKEK(t))
	require.NoError(t, err)

	first, err := box.Seal([]byte("same"))
	require.NoError(t, err)
	second, err := box.Seal([]byte("same"))
	require.NoError(t, err)

	assert.NotEqual(t, first, second)
}

func TestSecretBox_OpenRejectsTamperedCiphertext(t *testing.T) {
	box, err := crypto.NewSecretBox(testKEK(t))
	require.NoError(t, err)

	sealed, err := box.Seal([]byte("secret"))
	require.NoError(t, err)
	sealed[len(sealed)-1] ^= 0xFF

	_, err = box.Open(sealed)
	require.Error(t, err)
}

func TestNewSecretBox_RejectsWrongKeyLength(t *testing.T) {
	short := base64.StdEncoding.EncodeToString([]byte("too-short"))
	_, err := crypto.NewSecretBox(short)
	require.Error(t, err)
}
```

`internal/shared/crypto/password_test.go`:

```go
package crypto_test

import (
	"testing"

	"be-maxpay/internal/shared/crypto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashPassword_VerifiesItself(t *testing.T) {
	hash, err := crypto.HashPassword("correct horse battery staple")
	require.NoError(t, err)

	assert.True(t, crypto.VerifyPassword(hash, "correct horse battery staple"))
	assert.False(t, crypto.VerifyPassword(hash, "wrong"))
}

func TestHashPassword_SaltsEachCall(t *testing.T) {
	first, err := crypto.HashPassword("same")
	require.NoError(t, err)
	second, err := crypto.HashPassword("same")
	require.NoError(t, err)

	assert.NotEqual(t, first, second)
}

func TestVerifyPassword_RejectsGarbageHash(t *testing.T) {
	assert.False(t, crypto.VerifyPassword("not-a-hash", "anything"))
}
```

`internal/shared/crypto/token_test.go`:

```go
package crypto_test

import (
	"strings"
	"testing"

	"be-maxpay/internal/shared/crypto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRandomCode_LengthAndAlphabet(t *testing.T) {
	code, err := crypto.RandomCode(10)
	require.NoError(t, err)
	assert.Len(t, code, 10)

	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	for _, r := range code {
		assert.True(t, strings.ContainsRune(alphabet, r), "unexpected rune %q", r)
	}
}

func TestNewAPIKey_PrefixIsThePrefix(t *testing.T) {
	key, prefix, err := crypto.NewAPIKey()
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(key, "mxp_"))
	assert.Len(t, prefix, 12)
	assert.True(t, strings.HasPrefix(key, prefix))
}

func TestSHA256_IsStable(t *testing.T) {
	assert.Equal(t, crypto.SHA256("abc"), crypto.SHA256("abc"))
	assert.NotEqual(t, crypto.SHA256("abc"), crypto.SHA256("abd"))
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./internal/shared/crypto/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write `secretbox.go`**

```go
// Package crypto holds the primitives that turn secrets into something safe
// to store: envelope encryption for values that must be readable again,
// password hashing for values that must not, and random identifiers.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"be-maxpay/internal/shared/errs"
)

// SecretBox seals values under the configured key-encryption key.
//
// Merchant secret keys have to be readable again — HMAC verification needs
// the plaintext — so they are encrypted rather than hashed. AES-256-GCM is
// authenticated: Open fails on a modified ciphertext instead of returning
// plausible garbage that would then be used as an HMAC key.
type SecretBox struct {
	aead cipher.AEAD
}

// NewSecretBox decodes a base64 32-byte key and prepares the cipher.
func NewSecretBox(kekBase64 string) (*SecretBox, error) {
	raw, err := base64.StdEncoding.DecodeString(kekBase64)
	if err != nil {
		return nil, fmt.Errorf("decode kek: %w", errs.ErrInternal)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("kek must be 32 bytes, got %d: %w", len(raw), errs.ErrInternal)
	}

	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", errs.ErrInternal)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", errs.ErrInternal)
	}

	return &SecretBox{aead: aead}, nil
}

// Seal returns nonce || ciphertext. The nonce is fresh per call, so sealing
// the same plaintext twice produces different bytes.
func (b *SecretBox) Seal(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("read nonce: %w", errs.ErrInternal)
	}

	return b.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Open reverses Seal and fails on any modification.
func (b *SecretBox) Open(ciphertext []byte) ([]byte, error) {
	size := b.aead.NonceSize()
	if len(ciphertext) < size {
		return nil, fmt.Errorf("ciphertext too short: %w", errs.ErrInternal)
	}

	plaintext, err := b.aead.Open(nil, ciphertext[:size], ciphertext[size:], nil)
	if err != nil {
		return nil, fmt.Errorf("open ciphertext: %w", errs.ErrInternal)
	}

	return plaintext, nil
}
```

- [ ] **Step 4: Write `password.go`**

```go
package crypto

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"be-maxpay/internal/shared/errs"

	"golang.org/x/crypto/argon2"
)

// argon2id parameters. Deliberately not configurable: a deployment that can
// lower them can make every stored password cheap to crack, and there is no
// operational reason to tune them per environment.
const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

// HashPassword returns an encoded argon2id hash carrying its own parameters
// and salt, so a later parameter change does not invalidate stored hashes.
func HashPassword(plain string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read salt: %w", errs.ErrInternal)
	}

	key := argon2.IDKey([]byte(plain), salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword reports whether plain produced hash. A malformed hash is
// false, never an error: the only caller is a login, and the answer there is
// the same either way.
func VerifyPassword(hash, plain string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}

	var version, memory, time int
	var threads int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}

	got := argon2.IDKey([]byte(plain), salt, uint32(time), uint32(memory), uint8(threads), uint32(len(want)))

	return subtle.ConstantTimeCompare(got, want) == 1
}
```

- [ ] **Step 5: Write `token.go`**

```go
package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"math/big"

	"be-maxpay/internal/shared/errs"
)

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// APIKeyPrefixLen is how much of a key is stored in clear so a person can tell
// two keys apart in the back office without the key itself being shown again.
const APIKeyPrefixLen = 12

// RandomCode returns n base62 characters from a cryptographic source.
//
// It uses rejection-free modulo-free selection via rand.Int, because a naive
// `b % 62` over random bytes is biased towards the first four characters of
// the alphabet — harmless for a display code, not harmless for an API key.
func RandomCode(n int) (string, error) {
	out := make([]byte, n)
	max := big.NewInt(int64(len(base62)))

	for i := range out {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("read random: %w", errs.ErrInternal)
		}
		out[i] = base62[idx.Int64()]
	}

	return string(out), nil
}

// NewAPIKey returns the full key and the prefix stored alongside its hash.
func NewAPIKey() (string, string, error) {
	body, err := RandomCode(32)
	if err != nil {
		return "", "", err
	}

	key := "mxp_" + body

	return key, key[:APIKeyPrefixLen], nil
}

// NewOpaqueToken returns a back-office session token. Only its SHA-256 is
// stored, so a database read cannot be replayed as a login.
func NewOpaqueToken() (string, error) {
	return RandomCode(48)
}

// SHA256 hashes a value for deterministic lookup by that value.
func SHA256(s string) []byte {
	sum := sha256.Sum256([]byte(s))
	return sum[:]
}
```

- [ ] **Step 6: Add the config block**

In `internal/shared/config.go`, add to the `Config` struct after `KTB`:

```go
	Security struct {
		KEK                        string        `mapstructure:"kek"`
		SignatureTTL               time.Duration `mapstructure:"signature_ttl"`
		ClockSkew                  time.Duration `mapstructure:"clock_skew"`
		IdempotencyInflightTimeout time.Duration `mapstructure:"idempotency_inflight_timeout"`
		SessionTTL                 time.Duration `mapstructure:"session_ttl"`
	} `mapstructure:"security"`
```

Add the defaults beside the existing `v.SetDefault` calls — note there is
deliberately no default for `kek`:

```go
	v.SetDefault("security.signature_ttl", 60*time.Second)
	v.SetDefault("security.clock_skew", 5*time.Second)
	v.SetDefault("security.idempotency_inflight_timeout", 5*time.Minute)
	v.SetDefault("security.session_ttl", 12*time.Hour)
```

Add the keys to the `BindEnv` list:

```go
		"security.kek", "security.signature_ttl", "security.clock_skew",
		"security.idempotency_inflight_timeout", "security.session_ttl",
```

Add to `validateConfig`, beside the existing API-key check:

```go
	// A shared default KEK is the same as no encryption, so there is no
	// development fallback to fall back to here.
	if cfg.IsProduction() && cfg.Security.KEK == "" {
		return errs.NewConfigError("security.kek is required in production")
	}
```

- [ ] **Step 7: Add the block to both config files**

Append to `config.yaml` and `config.yaml.example` (the example keeps the
placeholder, `config.yaml` gets a real local key):

```yaml
security:
  # 32 random bytes, base64. Generate with:
  #   openssl rand -base64 32
  kek: "<BASE64_32_BYTE_KEY>"
  signature_ttl: 60s
  clock_skew: 5s
  idempotency_inflight_timeout: 5m
  session_ttl: 12h
```

For `config.yaml`, replace the placeholder with the output of
`openssl rand -base64 32`.

- [ ] **Step 8: Promote the dependency and run the tests**

```bash
go get golang.org/x/crypto@latest
go mod tidy
go test ./internal/shared/... -v
```

Expected: PASS, and `golang.org/x/crypto` moves out of the indirect block in
`go.mod`.

- [ ] **Step 9: Commit**

```bash
git add internal/shared/crypto internal/shared/config.go config.yaml.example go.mod go.sum
git commit -m "feat(crypto): add secret sealing, password hashing and token generation"
```

---

### Task 3: The merchants table

**Files:**
- Create: `db/migrations/000002_merchants.up.sql`
- Create: `db/migrations/000002_merchants.down.sql`
- Create: `internal/domain/merchant/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/persistence/model/merchant.go`
- Create: `internal/adapter/persistence/mapper/merchant.go`
- Test: `internal/domain/merchant/validator_test.go`

**Interfaces:**
- Consumes: `errs` sentinels, `id.New()`
- Produces:
  - `merchant.Merchant` struct, `merchant.Role` (`RoleRoot`, `RoleReseller`, `RoleDirect`), `merchant.PoolModel` (`PoolShared`, `PoolDedicated`)
  - `merchant.CreateData`, `merchant.UpdateData`
  - `merchant.Repository` interface
  - `merchant.Service` interface
  - `merchant.ValidateCreate(parent *Merchant, data *CreateData) error`
  - `merchant.ValidateUpdate(m *Merchant, parent *Merchant, data *UpdateData) error`
  - error values `ErrMerchantNotFound`, `ErrCodeExists`, `ErrDirectCannotHaveChildren`, `ErrRateBelowParent`, `ErrRootExists`, `ErrTreeTooDeep`, `ErrParentRequired`, `ErrMerchantSuspended`

- [ ] **Step 1: Write the failing validator tests**

`internal/domain/merchant/validator_test.go`:

```go
package merchant_test

import (
	"testing"

	"be-maxpay/internal/domain/merchant"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func rate(s string) decimal.Decimal {
	return decimal.RequireFromString(s)
}

func reseller() *merchant.Merchant {
	return &merchant.Merchant{
		Role:        merchant.RoleReseller,
		Depth:       1,
		DepositRate: rate("0.0070"),
		PayoutRate:  rate("0.0070"),
		Status:      merchant.StatusActive,
	}
}

func TestValidateCreate_DirectCannotHaveChildren(t *testing.T) {
	parent := &merchant.Merchant{
		Role: merchant.RoleDirect, Depth: 2,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0150"),
		Status: merchant.StatusActive,
	}

	err := merchant.ValidateCreate(parent, &merchant.CreateData{
		Name: "sub", Role: merchant.RoleDirect,
		DepositRate: rate("0.0200"), PayoutRate: rate("0.0200"),
	})

	require.ErrorIs(t, err, merchant.ErrDirectCannotHaveChildren)
}

func TestValidateCreate_RateMayNotFallBelowParent(t *testing.T) {
	err := merchant.ValidateCreate(reseller(), &merchant.CreateData{
		Name: "cheap", Role: merchant.RoleDirect,
		DepositRate: rate("0.0050"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, merchant.ErrRateBelowParent)
}

func TestValidateCreate_PayoutRateIsCheckedToo(t *testing.T) {
	err := merchant.ValidateCreate(reseller(), &merchant.CreateData{
		Name: "cheap payout", Role: merchant.RoleDirect,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0050"),
	})

	require.ErrorIs(t, err, merchant.ErrRateBelowParent)
}

func TestValidateCreate_EqualToParentIsAllowed(t *testing.T) {
	err := merchant.ValidateCreate(reseller(), &merchant.CreateData{
		Name: "at cost", Role: merchant.RoleDirect,
		DepositRate: rate("0.0070"), PayoutRate: rate("0.0070"),
	})

	require.NoError(t, err)
}

func TestValidateCreate_TreeIsTwoLevelsBelowRoot(t *testing.T) {
	deep := &merchant.Merchant{
		Role: merchant.RoleReseller, Depth: 2,
		DepositRate: rate("0.0070"), PayoutRate: rate("0.0070"),
		Status: merchant.StatusActive,
	}

	err := merchant.ValidateCreate(deep, &merchant.CreateData{
		Name: "too deep", Role: merchant.RoleDirect,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, merchant.ErrTreeTooDeep)
}

func TestValidateCreate_NonRootNeedsAParent(t *testing.T) {
	err := merchant.ValidateCreate(nil, &merchant.CreateData{
		Name: "orphan", Role: merchant.RoleDirect,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, merchant.ErrParentRequired)
}

func TestValidateCreate_NameIsRequired(t *testing.T) {
	err := merchant.ValidateCreate(reseller(), &merchant.CreateData{
		Name: "   ", Role: merchant.RoleDirect,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, merchant.ErrNameRequired)
}

func TestValidateCreate_RateMustBeAFraction(t *testing.T) {
	err := merchant.ValidateCreate(reseller(), &merchant.CreateData{
		Name: "absurd", Role: merchant.RoleDirect,
		DepositRate: rate("1.5"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, merchant.ErrRateOutOfRange)
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./internal/domain/merchant/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the migration**

`db/migrations/000002_merchants.up.sql`:

```sql
-- One row per merchant. depth is stored rather than derived: the two-level
-- rule is checked on every create, and walking the tree to answer "how deep
-- am I" on each of those is a query the answer never changes for.
CREATE TABLE merchants (
    id           UUID PRIMARY KEY DEFAULT uuidv7(),
    code         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    parent_id    UUID REFERENCES merchants(id),
    role         TEXT NOT NULL CHECK (role IN ('ROOT', 'RESELLER', 'DIRECT')),
    depth        INT NOT NULL,
    pool_model   TEXT NOT NULL CHECK (pool_model IN ('SHARED', 'DEDICATED')),
    cluster_id   UUID,
    deposit_rate NUMERIC(6,4) NOT NULL CHECK (deposit_rate >= 0 AND deposit_rate <= 1),
    payout_rate  NUMERIC(6,4) NOT NULL CHECK (payout_rate >= 0 AND payout_rate <= 1),
    status       TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((role = 'ROOT') = (parent_id IS NULL))
);

-- Exactly one root. A partial unique index on a constant is how a
-- "only one row may look like this" rule is expressed without a trigger.
CREATE UNIQUE INDEX merchants_single_root ON merchants ((TRUE)) WHERE role = 'ROOT';
CREATE INDEX merchants_parent ON merchants (parent_id);

DROP TRIGGER IF EXISTS update_merchants_updated_at ON merchants;
CREATE TRIGGER update_merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

`db/migrations/000002_merchants.down.sql`:

```sql
DROP TABLE IF EXISTS merchants;
```

- [ ] **Step 4: Write the domain files**

`internal/domain/merchant/entity.go`:

```go
package merchant

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Role is what a merchant may do commercially.
type Role string

const (
	RoleRoot     Role = "ROOT"
	RoleReseller Role = "RESELLER"
	// RoleDirect is the PRD's CONSUMER_ONLY: it uses the API and may not
	// resell. The restriction is commercial; a direct merchant still reads
	// its own balance and its own transactions.
	RoleDirect Role = "DIRECT"
)

// PoolModel decides which bank accounts serve this merchant.
type PoolModel string

const (
	PoolShared    PoolModel = "SHARED"
	PoolDedicated PoolModel = "DEDICATED"
)

const (
	StatusActive    = "ACTIVE"
	StatusSuspended = "SUSPENDED"
)

// MaxDepth is how far below ROOT the tree may go. The PRD locks this at two
// levels so a transaction's fee has exactly one path to the root.
const MaxDepth = 2

type Merchant struct {
	ID          uuid.UUID
	Code        string
	Name        string
	ParentID    uuid.UUID
	Role        Role
	Depth       int
	PoolModel   PoolModel
	ClusterID   uuid.UUID
	DepositRate decimal.Decimal
	PayoutRate  decimal.Decimal
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (m *Merchant) IsActive() bool { return m.Status == StatusActive }

// CanHaveChildren reports whether this merchant may resell.
func (m *Merchant) CanHaveChildren() bool {
	return m.Role == RoleRoot || m.Role == RoleReseller
}
```

`internal/domain/merchant/dto.go`:

```go
package merchant

import (
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// CreateData is the input for adding a merchant under a parent.
type CreateData struct {
	Name        string
	Role        Role
	PoolModel   PoolModel
	ClusterID   uuid.UUID
	DepositRate decimal.Decimal
	PayoutRate  decimal.Decimal
}

// UpdateData is a partial update. A zero decimal means "leave unchanged";
// a rate of exactly zero is set through a separate explicit field because
// zero is a legitimate rate for ROOT.
type UpdateData struct {
	Name        string
	PoolModel   PoolModel
	ClusterID   uuid.UUID
	DepositRate *decimal.Decimal
	PayoutRate  *decimal.Decimal
	Status      string
}
```

`internal/domain/merchant/errors.go`:

```go
package merchant

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrMerchantNotFound = fmt.Errorf("merchant not found: %w", errs.ErrNotFound)
	ErrCodeExists       = fmt.Errorf("merchant code already exists: %w", errs.ErrConflict)
	ErrRootExists       = fmt.Errorf("a root merchant already exists: %w", errs.ErrConflict)

	ErrNameRequired   = fmt.Errorf("name is required: %w", errs.ErrInvalidInput)
	ErrParentRequired = fmt.Errorf("a non-root merchant needs a parent: %w", errs.ErrInvalidInput)
	ErrRoleInvalid    = fmt.Errorf("role must be ROOT, RESELLER or DIRECT: %w", errs.ErrInvalidInput)
	ErrRateOutOfRange = fmt.Errorf("a rate must be between 0 and 1: %w", errs.ErrInvalidInput)

	// Commercial rules. Conflict rather than bad-input: the request is well
	// formed, the tree is what refuses it.
	ErrDirectCannotHaveChildren = fmt.Errorf("a direct merchant may not have children: %w", errs.ErrConflict)
	ErrRateBelowParent          = fmt.Errorf("a rate may not fall below the parent's: %w", errs.ErrConflict)
	ErrTreeTooDeep              = fmt.Errorf("the merchant tree is limited to two levels below root: %w", errs.ErrConflict)

	ErrMerchantSuspended = fmt.Errorf("merchant suspended: %w", errs.ErrForbidden)
)
```

`internal/domain/merchant/repository.go`:

```go
package merchant

import (
	"context"

	"github.com/google/uuid"
)

type Repository interface {
	Create(ctx context.Context, m *Merchant) (*Merchant, error)
	GetByID(ctx context.Context, id uuid.UUID) (*Merchant, error)
	GetByCode(ctx context.Context, code string) (*Merchant, error)
	// ListSubtree returns rootID and every descendant, ordered by depth then
	// name. Scoping lives here rather than in a handler because every later
	// phase adds endpoints, and one forgotten check leaks a competitor's
	// figures.
	ListSubtree(ctx context.Context, rootID uuid.UUID) ([]*Merchant, error)
	// Ancestors returns the chain from the merchant's parent up to root,
	// nearest first. The fee split walks it.
	Ancestors(ctx context.Context, id uuid.UUID) ([]*Merchant, error)
	Update(ctx context.Context, id uuid.UUID, data *UpdateData) (*Merchant, error)
}
```

`internal/domain/merchant/service.go`:

```go
package merchant

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	Create(ctx context.Context, parentID uuid.UUID, data *CreateData) (*Merchant, error)
	GetByID(ctx context.Context, id uuid.UUID) (*Merchant, error)
	GetByCode(ctx context.Context, code string) (*Merchant, error)
	ListSubtree(ctx context.Context, rootID uuid.UUID) ([]*Merchant, error)
	Ancestors(ctx context.Context, id uuid.UUID) ([]*Merchant, error)
	Update(ctx context.Context, id uuid.UUID, data *UpdateData) (*Merchant, error)
}
```

`internal/domain/merchant/validator.go`:

```go
package merchant

import (
	"strings"

	"github.com/shopspring/decimal"
)

var one = decimal.NewFromInt(1)

// ValidateCreate checks a new merchant against its parent.
//
// parent is nil only when creating ROOT, which the service allows exactly
// once; every other role is refused without one.
func ValidateCreate(parent *Merchant, data *CreateData) error {
	if strings.TrimSpace(data.Name) == "" {
		return ErrNameRequired
	}
	if err := validateRole(data.Role); err != nil {
		return err
	}
	if err := validateRates(data.DepositRate, data.PayoutRate); err != nil {
		return err
	}

	if data.Role == RoleRoot {
		return nil
	}

	if parent == nil {
		return ErrParentRequired
	}
	if !parent.CanHaveChildren() {
		return ErrDirectCannotHaveChildren
	}
	if parent.Depth+1 > MaxDepth {
		return ErrTreeTooDeep
	}
	if data.DepositRate.LessThan(parent.DepositRate) || data.PayoutRate.LessThan(parent.PayoutRate) {
		return ErrRateBelowParent
	}

	return nil
}

// ValidateUpdate checks a partial change against the parent it still hangs
// from. parent is nil for ROOT.
func ValidateUpdate(m *Merchant, parent *Merchant, data *UpdateData) error {
	if data.Name != "" && strings.TrimSpace(data.Name) == "" {
		return ErrNameRequired
	}
	if data.Status != "" && data.Status != StatusActive && data.Status != StatusSuspended {
		return ErrRoleInvalid
	}

	deposit := m.DepositRate
	if data.DepositRate != nil {
		deposit = *data.DepositRate
	}
	payout := m.PayoutRate
	if data.PayoutRate != nil {
		payout = *data.PayoutRate
	}

	if err := validateRates(deposit, payout); err != nil {
		return err
	}
	if parent != nil && (deposit.LessThan(parent.DepositRate) || payout.LessThan(parent.PayoutRate)) {
		return ErrRateBelowParent
	}

	return nil
}

func validateRole(r Role) error {
	switch r {
	case RoleRoot, RoleReseller, RoleDirect:
		return nil
	default:
		return ErrRoleInvalid
	}
}

func validateRates(deposit, payout decimal.Decimal) error {
	for _, r := range []decimal.Decimal{deposit, payout} {
		if r.IsNegative() || r.GreaterThan(one) {
			return ErrRateOutOfRange
		}
	}
	return nil
}
```

- [ ] **Step 5: Write the model and mapper**

`internal/adapter/persistence/model/merchant.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Merchant struct {
	ID          uuid.UUID       `db:"id"`
	Code        string          `db:"code"`
	Name        string          `db:"name"`
	ParentID    uuid.NullUUID   `db:"parent_id"`
	Role        string          `db:"role"`
	Depth       int             `db:"depth"`
	PoolModel   string          `db:"pool_model"`
	ClusterID   uuid.NullUUID   `db:"cluster_id"`
	DepositRate decimal.Decimal `db:"deposit_rate"`
	PayoutRate  decimal.Decimal `db:"payout_rate"`
	Status      string          `db:"status"`
	CreatedAt   time.Time       `db:"created_at"`
	UpdatedAt   time.Time       `db:"updated_at"`
}

// unused keeps the sql import honest if a nullable text column is added later.
var _ = sql.NullString{}
```

`internal/adapter/persistence/mapper/merchant.go`:

```go
package mapper

import (
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/merchant"

	"github.com/google/uuid"
)

func nullUUID(u uuid.UUID) uuid.NullUUID {
	return uuid.NullUUID{UUID: u, Valid: u != uuid.Nil}
}

func MerchantToModel(m *merchant.Merchant) *model.Merchant {
	if m == nil {
		return nil
	}
	return &model.Merchant{
		ID:          m.ID,
		Code:        m.Code,
		Name:        m.Name,
		ParentID:    nullUUID(m.ParentID),
		Role:        string(m.Role),
		Depth:       m.Depth,
		PoolModel:   string(m.PoolModel),
		ClusterID:   nullUUID(m.ClusterID),
		DepositRate: m.DepositRate,
		PayoutRate:  m.PayoutRate,
		Status:      m.Status,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}

func MerchantToDomain(m *model.Merchant) *merchant.Merchant {
	if m == nil {
		return nil
	}
	return &merchant.Merchant{
		ID:          m.ID,
		Code:        m.Code,
		Name:        m.Name,
		ParentID:    m.ParentID.UUID,
		Role:        merchant.Role(m.Role),
		Depth:       m.Depth,
		PoolModel:   merchant.PoolModel(m.PoolModel),
		ClusterID:   m.ClusterID.UUID,
		DepositRate: m.DepositRate,
		PayoutRate:  m.PayoutRate,
		Status:      m.Status,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}

func MerchantsToDomain(models []*model.Merchant) []*merchant.Merchant {
	out := make([]*merchant.Merchant, 0, len(models))
	for _, m := range models {
		out = append(out, MerchantToDomain(m))
	}
	return out
}
```

- [ ] **Step 6: Run the tests**

Run: `go test ./internal/domain/merchant/ ./internal/adapter/persistence/... -v`
Expected: PASS.

- [ ] **Step 7: Apply the migration against a real database**

```bash
make docker-up
make migrate-up
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c '\d merchants'
```

Expected: the table exists with the `merchants_single_root` index listed.

- [ ] **Step 8: Prove the single-root index actually holds**

```bash
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c "
INSERT INTO merchants (code,name,role,depth,pool_model,deposit_rate,payout_rate,status)
VALUES ('ROOT000001','House','ROOT',0,'SHARED',0.005,0.005,'ACTIVE');
INSERT INTO merchants (code,name,role,depth,pool_model,deposit_rate,payout_rate,status)
VALUES ('ROOT000002','Other','ROOT',0,'SHARED',0.005,0.005,'ACTIVE');"
```

Expected: the second insert fails with a unique violation on
`merchants_single_root`. Clean up with
`docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c "DELETE FROM merchants;"`.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/000002_merchants.*.sql internal/domain/merchant \
        internal/adapter/persistence/model/merchant.go \
        internal/adapter/persistence/mapper/merchant.go
git commit -m "feat(merchant): add the merchant tree and its commercial rules"
```

---

### Task 4: The merchant repository

**Files:**
- Create: `internal/adapter/repository/merchant/repository.go`
- Test: `internal/adapter/repository/merchant/repository_test.go`

**Interfaces:**
- Consumes: `merchant.Repository`, `merchant.Merchant`, `merchant.UpdateData`, `mapper.MerchantToDomain`, `base.BaseRepository`
- Produces: `merchantrepo.NewRepository(db *sqlx.DB) merchant.Repository`

- [ ] **Step 1: Write the failing tests**

`internal/adapter/repository/merchant/repository_test.go`:

```go
package merchant_test

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	merchantrepo "be-maxpay/internal/adapter/repository/merchant"
	domainmerchant "be-maxpay/internal/domain/merchant"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRepo(t *testing.T) (domainmerchant.Repository, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return merchantrepo.NewRepository(sqlx.NewDb(db, "sqlmock")), mock
}

func merchantRows(id uuid.UUID) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "code", "name", "parent_id", "role", "depth", "pool_model",
		"cluster_id", "deposit_rate", "payout_rate", "status",
		"created_at", "updated_at",
	}).AddRow(
		id, "ABC1234567", "Acme", nil, "ROOT", 0, "SHARED",
		nil, decimal.RequireFromString("0.0050"), decimal.RequireFromString("0.0050"),
		"ACTIVE", time.Now(), time.Now(),
	)
}

func TestMerchantRepository_GetByCode_Success(t *testing.T) {
	repo, mock := newRepo(t)
	id := uuid.New()

	mock.ExpectQuery(regexp.QuoteMeta(`FROM merchants WHERE code = $1`)).
		WithArgs("ABC1234567").
		WillReturnRows(merchantRows(id))

	got, err := repo.GetByCode(context.Background(), "ABC1234567")
	require.NoError(t, err)
	assert.Equal(t, "ABC1234567", got.Code)
	assert.Equal(t, domainmerchant.RoleRoot, got.Role)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMerchantRepository_GetByCode_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(`FROM merchants WHERE code = $1`)).
		WithArgs("missing").
		WillReturnError(sql.ErrNoRows)

	_, err := repo.GetByCode(context.Background(), "missing")
	require.ErrorIs(t, err, domainmerchant.ErrMerchantNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMerchantRepository_Create_DuplicateCode(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO merchants`)).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "merchants_code_key"})

	_, err := repo.Create(context.Background(), &domainmerchant.Merchant{
		Code: "ABC1234567", Name: "Acme", Role: domainmerchant.RoleDirect,
		DepositRate: decimal.RequireFromString("0.015"),
		PayoutRate:  decimal.RequireFromString("0.015"),
		Status:      domainmerchant.StatusActive,
	})

	require.ErrorIs(t, err, domainmerchant.ErrCodeExists)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMerchantRepository_Create_DuplicateRoot(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO merchants`)).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "merchants_single_root"})

	_, err := repo.Create(context.Background(), &domainmerchant.Merchant{
		Code: "ROOT000001", Name: "House", Role: domainmerchant.RoleRoot,
		DepositRate: decimal.RequireFromString("0.005"),
		PayoutRate:  decimal.RequireFromString("0.005"),
		Status:      domainmerchant.StatusActive,
	})

	require.ErrorIs(t, err, domainmerchant.ErrRootExists)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMerchantRepository_ListSubtree_UsesRecursiveCTE(t *testing.T) {
	repo, mock := newRepo(t)
	id := uuid.New()

	mock.ExpectQuery(regexp.QuoteMeta(`WITH RECURSIVE subtree`)).
		WithArgs(id).
		WillReturnRows(merchantRows(id))

	got, err := repo.ListSubtree(context.Background(), id)
	require.NoError(t, err)
	assert.Len(t, got, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMerchantRepository_Ancestors_UsesRecursiveCTE(t *testing.T) {
	repo, mock := newRepo(t)
	id := uuid.New()

	mock.ExpectQuery(regexp.QuoteMeta(`WITH RECURSIVE chain`)).
		WithArgs(id).
		WillReturnRows(merchantRows(id))

	got, err := repo.Ancestors(context.Background(), id)
	require.NoError(t, err)
	assert.Len(t, got, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMerchantRepository_Update_NotFound(t *testing.T) {
	repo, mock := newRepo(t)
	name := "New name"

	mock.ExpectExec(regexp.QuoteMeta(`UPDATE merchants SET`)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	_, err := repo.Update(context.Background(), uuid.New(), &domainmerchant.UpdateData{Name: name})
	require.ErrorIs(t, err, domainmerchant.ErrMerchantNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./internal/adapter/repository/merchant/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the repository**

`internal/adapter/repository/merchant/repository.go`:

```go
package merchant

import (
	"context"
	"errors"
	"time"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/adapter/repository/base"
	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared/errs"
	"be-maxpay/internal/shared/id"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
)

var merchantColumns = []string{
	"id", "code", "name", "parent_id", "role", "depth", "pool_model",
	"cluster_id", "deposit_rate", "payout_rate", "status",
	"created_at", "updated_at",
}

// merchantSelect is the projection shared by the CTE queries below. The two
// recursive statements are written by hand rather than through squirrel:
// squirrel has no WITH RECURSIVE, and hand-writing one statement with a
// single placeholder is not the "$1/$2 counter" the standard forbids.
const merchantSelect = `id, code, name, parent_id, role, depth, pool_model,
	cluster_id, deposit_rate, payout_rate, status, created_at, updated_at`

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domainmerchant.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

func (r *Repository) Create(ctx context.Context, m *domainmerchant.Merchant) (*domainmerchant.Merchant, error) {
	now := time.Now().UTC()
	newID := id.New()

	query := r.Builder.Insert("merchants").
		Columns("id", "code", "name", "parent_id", "role", "depth", "pool_model",
			"cluster_id", "deposit_rate", "payout_rate", "status", "created_at", "updated_at").
		Values(newID, m.Code, m.Name, nullUUID(m.ParentID), string(m.Role), m.Depth,
			string(m.PoolModel), nullUUID(m.ClusterID), m.DepositRate, m.PayoutRate,
			m.Status, now, now)

	sqlStr, args, err := query.ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build create merchant query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		return nil, mapUniqueViolation(err)
	}

	return r.GetByID(ctx, newID)
}

func (r *Repository) GetByID(ctx context.Context, mid uuid.UUID) (*domainmerchant.Merchant, error) {
	return r.getOne(ctx, squirrel.Eq{"id": mid}, "get merchant by id")
}

func (r *Repository) GetByCode(ctx context.Context, code string) (*domainmerchant.Merchant, error) {
	return r.getOne(ctx, squirrel.Eq{"code": code}, "get merchant by code")
}

func (r *Repository) getOne(ctx context.Context, where squirrel.Sqlizer, label string) (*domainmerchant.Merchant, error) {
	sqlStr, args, err := r.Builder.Select(merchantColumns...).
		From("merchants").
		Where(where).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build "+label+" query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.Merchant
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domainmerchant.ErrMerchantNotFound)
		}
		return nil, errs.WrapDatabaseError(err, label)
	}

	return mapper.MerchantToDomain(&m), nil
}

// ListSubtree returns the merchant and every descendant.
func (r *Repository) ListSubtree(ctx context.Context, rootID uuid.UUID) ([]*domainmerchant.Merchant, error) {
	const q = `
WITH RECURSIVE subtree AS (
    SELECT ` + merchantSelect + ` FROM merchants WHERE id = $1
    UNION ALL
    SELECT m.id, m.code, m.name, m.parent_id, m.role, m.depth, m.pool_model,
           m.cluster_id, m.deposit_rate, m.payout_rate, m.status, m.created_at, m.updated_at
      FROM merchants m JOIN subtree s ON m.parent_id = s.id
)
SELECT ` + merchantSelect + ` FROM subtree ORDER BY depth, name`

	return r.selectMany(ctx, q, rootID, "list merchant subtree")
}

// Ancestors returns the parent chain, nearest first.
func (r *Repository) Ancestors(ctx context.Context, mid uuid.UUID) ([]*domainmerchant.Merchant, error) {
	const q = `
WITH RECURSIVE chain AS (
    SELECT ` + merchantSelect + ` FROM merchants WHERE id = (SELECT parent_id FROM merchants WHERE id = $1)
    UNION ALL
    SELECT m.id, m.code, m.name, m.parent_id, m.role, m.depth, m.pool_model,
           m.cluster_id, m.deposit_rate, m.payout_rate, m.status, m.created_at, m.updated_at
      FROM merchants m JOIN chain c ON c.parent_id = m.id
)
SELECT ` + merchantSelect + ` FROM chain ORDER BY depth DESC`

	return r.selectMany(ctx, q, mid, "list merchant ancestors")
}

func (r *Repository) selectMany(ctx context.Context, query string, arg uuid.UUID, label string) ([]*domainmerchant.Merchant, error) {
	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.Merchant
	if err := r.DB.SelectContext(ctx, &models, query, arg); err != nil {
		return nil, errs.WrapDatabaseError(err, label)
	}

	return mapper.MerchantsToDomain(models), nil
}

func (r *Repository) Update(ctx context.Context, mid uuid.UUID, data *domainmerchant.UpdateData) (*domainmerchant.Merchant, error) {
	values := map[string]any{}
	if data.Name != "" {
		values["name"] = data.Name
	}
	if data.PoolModel != "" {
		values["pool_model"] = string(data.PoolModel)
	}
	if data.ClusterID != uuid.Nil {
		values["cluster_id"] = data.ClusterID
	}
	if data.DepositRate != nil {
		values["deposit_rate"] = *data.DepositRate
	}
	if data.PayoutRate != nil {
		values["payout_rate"] = *data.PayoutRate
	}
	if data.Status != "" {
		values["status"] = data.Status
	}

	if len(values) == 0 {
		return r.GetByID(ctx, mid)
	}

	sqlStr, args, err := r.Builder.Update("merchants").
		SetMap(values).
		Set("updated_at", time.Now().UTC()).
		Where(squirrel.Eq{"id": mid}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build update merchant query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, mapUniqueViolation(err)
	}
	if err := r.CheckRowsAffectedWith(result, domainmerchant.ErrMerchantNotFound); err != nil {
		return nil, err
	}

	return r.GetByID(ctx, mid)
}

// mapUniqueViolation names the rule that was broken. "duplicate key" tells an
// operator nothing about whether they reused a code or tried to add a second
// root, and those need different fixes.
func mapUniqueViolation(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "merchants_single_root":
			return domainmerchant.ErrRootExists
		default:
			return domainmerchant.ErrCodeExists
		}
	}

	return errs.WrapDatabaseError(err, "write merchant")
}

func nullUUID(u uuid.UUID) any {
	if u == uuid.Nil {
		return nil
	}
	return u
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./internal/adapter/repository/merchant/ -v`
Expected: PASS, all seven tests.

- [ ] **Step 5: Commit**

```bash
git add internal/adapter/repository/merchant
git commit -m "feat(merchant): add the merchant repository"
```

---

### Task 5: The merchant service

**Files:**
- Create: `internal/service/merchant/service.go`
- Test: `internal/service/merchant/service_test.go`

**Interfaces:**
- Consumes: `merchant.Repository`, `merchant.ValidateCreate`, `merchant.ValidateUpdate`, `crypto.RandomCode`
- Produces: `merchantsvc.NewService(repo merchant.Repository) *Service` satisfying `merchant.Service`

- [ ] **Step 1: Write the failing tests**

`internal/service/merchant/service_test.go`:

```go
package merchant_test

import (
	"context"
	"testing"

	domainmerchant "be-maxpay/internal/domain/merchant"
	merchantsvc "be-maxpay/internal/service/merchant"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	byID     map[uuid.UUID]*domainmerchant.Merchant
	created  *domainmerchant.Merchant
	createErr error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{byID: map[uuid.UUID]*domainmerchant.Merchant{}}
}

func (f *fakeRepo) Create(_ context.Context, m *domainmerchant.Merchant) (*domainmerchant.Merchant, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	f.created = m
	m.ID = uuid.New()
	f.byID[m.ID] = m
	return m, nil
}

func (f *fakeRepo) GetByID(_ context.Context, id uuid.UUID) (*domainmerchant.Merchant, error) {
	m, ok := f.byID[id]
	if !ok {
		return nil, domainmerchant.ErrMerchantNotFound
	}
	return m, nil
}

func (f *fakeRepo) GetByCode(context.Context, string) (*domainmerchant.Merchant, error) {
	return nil, domainmerchant.ErrMerchantNotFound
}

func (f *fakeRepo) ListSubtree(context.Context, uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return nil, nil
}

func (f *fakeRepo) Ancestors(context.Context, uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return nil, nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, _ *domainmerchant.UpdateData) (*domainmerchant.Merchant, error) {
	return f.GetByID(context.Background(), id)
}

func rate(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func seedReseller(f *fakeRepo) *domainmerchant.Merchant {
	m := &domainmerchant.Merchant{
		ID: uuid.New(), Code: "RESELLER01", Name: "Reseller",
		Role: domainmerchant.RoleReseller, Depth: 1,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: rate("0.0070"), PayoutRate: rate("0.0070"),
		Status: domainmerchant.StatusActive,
	}
	f.byID[m.ID] = m
	return m
}

func TestMerchantService_Create_GeneratesATenCharacterCode(t *testing.T) {
	repo := newFakeRepo()
	parent := seedReseller(repo)
	svc := merchantsvc.NewService(repo)

	got, err := svc.Create(context.Background(), parent.ID, &domainmerchant.CreateData{
		Name: "Acme", Role: domainmerchant.RoleDirect,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0150"),
	})

	require.NoError(t, err)
	assert.Len(t, got.Code, 10)
	assert.Equal(t, 2, got.Depth, "depth is the parent's plus one")
	assert.Equal(t, domainmerchant.StatusActive, got.Status)
	assert.Equal(t, parent.ID, got.ParentID)
}

func TestMerchantService_Create_RefusesARateBelowTheParent(t *testing.T) {
	repo := newFakeRepo()
	parent := seedReseller(repo)
	svc := merchantsvc.NewService(repo)

	_, err := svc.Create(context.Background(), parent.ID, &domainmerchant.CreateData{
		Name: "Cheap", Role: domainmerchant.RoleDirect,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: rate("0.0010"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, domainmerchant.ErrRateBelowParent)
	assert.Nil(t, repo.created, "an invalid merchant must never reach the repository")
}

func TestMerchantService_Create_RefusesAnUnknownParent(t *testing.T) {
	repo := newFakeRepo()
	svc := merchantsvc.NewService(repo)

	_, err := svc.Create(context.Background(), uuid.New(), &domainmerchant.CreateData{
		Name: "Orphan", Role: domainmerchant.RoleDirect,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: rate("0.0150"), PayoutRate: rate("0.0150"),
	})

	require.ErrorIs(t, err, domainmerchant.ErrMerchantNotFound)
}

func TestMerchantService_Create_RootNeedsNoParent(t *testing.T) {
	repo := newFakeRepo()
	svc := merchantsvc.NewService(repo)

	got, err := svc.Create(context.Background(), uuid.Nil, &domainmerchant.CreateData{
		Name: "House", Role: domainmerchant.RoleRoot,
		PoolModel:   domainmerchant.PoolShared,
		DepositRate: rate("0.0050"), PayoutRate: rate("0.0050"),
	})

	require.NoError(t, err)
	assert.Equal(t, 0, got.Depth)
	assert.Equal(t, uuid.Nil, got.ParentID)
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./internal/service/merchant/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the service**

`internal/service/merchant/service.go`:

```go
// Package merchant implements the merchant tree use cases.
package merchant

import (
	"context"

	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
)

// codeLength matches the shape the PRD's examples use (VOBM7qzaRH). It is an
// identifier, not a secret: 62^10 is far more than enough to avoid an
// accidental collision, and the unique index catches one anyway.
const codeLength = 10

type Service struct {
	repo domainmerchant.Repository
}

func NewService(repo domainmerchant.Repository) *Service {
	return &Service{repo: repo}
}

// Create adds a merchant under parentID. parentID is uuid.Nil only when the
// new merchant is ROOT; the single-root index is what refuses a second one.
func (s *Service) Create(ctx context.Context, parentID uuid.UUID, data *domainmerchant.CreateData) (*domainmerchant.Merchant, error) {
	var parent *domainmerchant.Merchant
	if data.Role != domainmerchant.RoleRoot {
		found, err := s.repo.GetByID(ctx, parentID)
		if err != nil {
			return nil, err
		}
		parent = found
	}

	if err := domainmerchant.ValidateCreate(parent, data); err != nil {
		return nil, err
	}

	code, err := crypto.RandomCode(codeLength)
	if err != nil {
		return nil, err
	}

	m := &domainmerchant.Merchant{
		Code:        code,
		Name:        data.Name,
		Role:        data.Role,
		PoolModel:   data.PoolModel,
		ClusterID:   data.ClusterID,
		DepositRate: data.DepositRate,
		PayoutRate:  data.PayoutRate,
		Status:      domainmerchant.StatusActive,
	}
	if parent != nil {
		m.ParentID = parent.ID
		m.Depth = parent.Depth + 1
	}

	return s.repo.Create(ctx, m)
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*domainmerchant.Merchant, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *Service) GetByCode(ctx context.Context, code string) (*domainmerchant.Merchant, error) {
	return s.repo.GetByCode(ctx, code)
}

func (s *Service) ListSubtree(ctx context.Context, rootID uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return s.repo.ListSubtree(ctx, rootID)
}

func (s *Service) Ancestors(ctx context.Context, id uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return s.repo.Ancestors(ctx, id)
}

// Update applies a partial change, re-checking the rate rules against the
// parent the merchant still hangs from.
func (s *Service) Update(ctx context.Context, id uuid.UUID, data *domainmerchant.UpdateData) (*domainmerchant.Merchant, error) {
	current, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	var parent *domainmerchant.Merchant
	if current.ParentID != uuid.Nil {
		found, parentErr := s.repo.GetByID(ctx, current.ParentID)
		if parentErr != nil {
			return nil, parentErr
		}
		parent = found
	}

	if err := domainmerchant.ValidateUpdate(current, parent, data); err != nil {
		return nil, err
	}

	return s.repo.Update(ctx, id, data)
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./internal/service/merchant/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/service/merchant
git commit -m "feat(merchant): add the merchant service"
```

---

### Task 6: Credentials — clients, API keys and sealed secrets

**Files:**
- Create: `db/migrations/000003_credentials.up.sql`
- Create: `db/migrations/000003_credentials.down.sql`
- Create: `internal/domain/credential/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/persistence/model/credential.go`
- Create: `internal/adapter/persistence/mapper/credential.go`
- Create: `internal/adapter/repository/credential/repository.go`
- Test: `internal/adapter/repository/credential/repository_test.go`

**Interfaces:**
- Consumes: `merchant.Merchant`, `base.BaseRepository`, `crypto.SHA256`
- Produces:
  - `credential.Client`, `credential.Credential`
  - `credential.Repository` with `CreateClient`, `GetClientByCode`, `ListClients`, `CreateCredential`, `GetByAPIKeyHash`, `ListCredentials`, `Revoke`, `TouchLastUsed`
  - `credential.Service` with `IssueClient`, `IssueKey`, `RevokeKey`, `Authenticate`, `SecretFor`
  - errors `ErrClientNotFound`, `ErrCredentialNotFound`, `ErrCredentialRevoked`, `ErrClientCodeExists`

- [ ] **Step 1: Write the migration**

`db/migrations/000003_credentials.up.sql`:

```sql
CREATE TABLE merchant_clients (
    id          UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX merchant_clients_merchant ON merchant_clients (merchant_id);

-- A merchant holds several credentials at once on purpose: with one key there
-- is no way to rotate without an outage, because the customer needs the new
-- key working before the old one stops.
CREATE TABLE merchant_credentials (
    id             UUID PRIMARY KEY DEFAULT uuidv7(),
    merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    api_key_hash   BYTEA NOT NULL UNIQUE,
    api_key_prefix TEXT NOT NULL,
    secret_key_enc BYTEA NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
    last_used_at   TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX merchant_credentials_merchant ON merchant_credentials (merchant_id);

DROP TRIGGER IF EXISTS update_merchant_clients_updated_at ON merchant_clients;
CREATE TRIGGER update_merchant_clients_updated_at
  BEFORE UPDATE ON merchant_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

`db/migrations/000003_credentials.down.sql`:

```sql
DROP TABLE IF EXISTS merchant_credentials;
DROP TABLE IF EXISTS merchant_clients;
```

- [ ] **Step 2: Write the domain files**

`internal/domain/credential/entity.go`:

```go
package credential

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusActive   = "ACTIVE"
	StatusRevoked  = "REVOKED"
	StatusDisabled = "DISABLED"
)

// Client is a sub-system under a merchant that initiates requests. The PRD
// calls its code the clientId.
type Client struct {
	ID         uuid.UUID
	MerchantID uuid.UUID
	Code       string
	Label      string
	Status     string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Credential is one API key and the secret key that signs alongside it.
//
// SecretKeyEnc is the sealed secret, never the plaintext: the plaintext exists
// only inside the service that just decrypted it, and only for the length of
// one verification.
type Credential struct {
	ID           uuid.UUID
	MerchantID   uuid.UUID
	APIKeyHash   []byte
	APIKeyPrefix string
	SecretKeyEnc []byte
	Status       string
	LastUsedAt   time.Time
	RevokedAt    time.Time
	CreatedAt    time.Time
}

func (c *Credential) IsActive() bool { return c.Status == StatusActive }
```

`internal/domain/credential/dto.go`:

```go
package credential

import "github.com/google/uuid"

// IssuedKey is returned exactly once, when a key is created. The plaintext key
// and secret are never readable again; only the prefix survives, so the back
// office can name a key without being able to use it.
type IssuedKey struct {
	CredentialID uuid.UUID
	APIKey       string
	SecretKey    string
	Prefix       string
}

type CreateClientData struct {
	MerchantID uuid.UUID
	Label      string
}
```

`internal/domain/credential/errors.go`:

```go
package credential

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrClientNotFound     = fmt.Errorf("client not found: %w", errs.ErrNotFound)
	ErrCredentialNotFound = fmt.Errorf("credential not found: %w", errs.ErrUnauthorized)
	ErrCredentialRevoked  = fmt.Errorf("credential revoked: %w", errs.ErrUnauthorized)
	ErrClientCodeExists   = fmt.Errorf("client code already exists: %w", errs.ErrConflict)
	ErrLabelRequired      = fmt.Errorf("label is required: %w", errs.ErrInvalidInput)
)
```

`internal/domain/credential/repository.go`:

```go
package credential

import (
	"context"

	"github.com/google/uuid"
)

type Repository interface {
	CreateClient(ctx context.Context, c *Client) (*Client, error)
	GetClientByCode(ctx context.Context, code string) (*Client, error)
	ListClients(ctx context.Context, merchantID uuid.UUID) ([]*Client, error)

	CreateCredential(ctx context.Context, c *Credential) (*Credential, error)
	// GetByAPIKeyHash is the authentication lookup. It returns revoked rows
	// too, so the caller can tell "never existed" from "no longer valid".
	GetByAPIKeyHash(ctx context.Context, hash []byte) (*Credential, error)
	ListCredentials(ctx context.Context, merchantID uuid.UUID) ([]*Credential, error)
	Revoke(ctx context.Context, id uuid.UUID) error
	TouchLastUsed(ctx context.Context, id uuid.UUID) error
}
```

`internal/domain/credential/service.go`:

```go
package credential

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	IssueClient(ctx context.Context, data *CreateClientData) (*Client, error)
	ListClients(ctx context.Context, merchantID uuid.UUID) ([]*Client, error)
	IssueKey(ctx context.Context, merchantID uuid.UUID) (*IssuedKey, error)
	ListKeys(ctx context.Context, merchantID uuid.UUID) ([]*Credential, error)
	RevokeKey(ctx context.Context, id uuid.UUID) error
	// Authenticate resolves a presented API key to its credential.
	Authenticate(ctx context.Context, apiKey string) (*Credential, error)
	// SecretFor unseals the signing secret for one verification.
	SecretFor(ctx context.Context, c *Credential) (string, error)
}
```

`internal/domain/credential/validator.go`:

```go
package credential

import "strings"

func ValidateCreateClient(data *CreateClientData) error {
	if strings.TrimSpace(data.Label) == "" {
		return ErrLabelRequired
	}
	return nil
}
```

- [ ] **Step 3: Write the model and mapper**

`internal/adapter/persistence/model/credential.go`:

```go
package model

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type MerchantClient struct {
	ID         uuid.UUID `db:"id"`
	MerchantID uuid.UUID `db:"merchant_id"`
	Code       string    `db:"code"`
	Label      string    `db:"label"`
	Status     string    `db:"status"`
	CreatedAt  time.Time `db:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"`
}

type MerchantCredential struct {
	ID           uuid.UUID    `db:"id"`
	MerchantID   uuid.UUID    `db:"merchant_id"`
	APIKeyHash   []byte       `db:"api_key_hash"`
	APIKeyPrefix string       `db:"api_key_prefix"`
	SecretKeyEnc []byte       `db:"secret_key_enc"`
	Status       string       `db:"status"`
	LastUsedAt   sql.NullTime `db:"last_used_at"`
	RevokedAt    sql.NullTime `db:"revoked_at"`
	CreatedAt    time.Time    `db:"created_at"`
}
```

`internal/adapter/persistence/mapper/credential.go`:

```go
package mapper

import (
	"database/sql"
	"time"

	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/credential"
)

func nullTime(t time.Time) sql.NullTime {
	return sql.NullTime{Time: t, Valid: !t.IsZero()}
}

func MerchantClientToModel(c *credential.Client) *model.MerchantClient {
	if c == nil {
		return nil
	}
	return &model.MerchantClient{
		ID: c.ID, MerchantID: c.MerchantID, Code: c.Code,
		Label: c.Label, Status: c.Status,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

func MerchantClientToDomain(m *model.MerchantClient) *credential.Client {
	if m == nil {
		return nil
	}
	return &credential.Client{
		ID: m.ID, MerchantID: m.MerchantID, Code: m.Code,
		Label: m.Label, Status: m.Status,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

func MerchantClientsToDomain(models []*model.MerchantClient) []*credential.Client {
	out := make([]*credential.Client, 0, len(models))
	for _, m := range models {
		out = append(out, MerchantClientToDomain(m))
	}
	return out
}

func MerchantCredentialToModel(c *credential.Credential) *model.MerchantCredential {
	if c == nil {
		return nil
	}
	return &model.MerchantCredential{
		ID: c.ID, MerchantID: c.MerchantID,
		APIKeyHash: c.APIKeyHash, APIKeyPrefix: c.APIKeyPrefix,
		SecretKeyEnc: c.SecretKeyEnc, Status: c.Status,
		LastUsedAt: nullTime(c.LastUsedAt), RevokedAt: nullTime(c.RevokedAt),
		CreatedAt: c.CreatedAt,
	}
}

func MerchantCredentialToDomain(m *model.MerchantCredential) *credential.Credential {
	if m == nil {
		return nil
	}
	return &credential.Credential{
		ID: m.ID, MerchantID: m.MerchantID,
		APIKeyHash: m.APIKeyHash, APIKeyPrefix: m.APIKeyPrefix,
		SecretKeyEnc: m.SecretKeyEnc, Status: m.Status,
		LastUsedAt: m.LastUsedAt.Time, RevokedAt: m.RevokedAt.Time,
		CreatedAt: m.CreatedAt,
	}
}

func MerchantCredentialsToDomain(models []*model.MerchantCredential) []*credential.Credential {
	out := make([]*credential.Credential, 0, len(models))
	for _, m := range models {
		out = append(out, MerchantCredentialToDomain(m))
	}
	return out
}
```

- [ ] **Step 4: Write the failing repository test**

`internal/adapter/repository/credential/repository_test.go`:

```go
package credential_test

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	credentialrepo "be-maxpay/internal/adapter/repository/credential"
	domaincredential "be-maxpay/internal/domain/credential"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRepo(t *testing.T) (domaincredential.Repository, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return credentialrepo.NewRepository(sqlx.NewDb(db, "sqlmock")), mock
}

func TestCredentialRepository_GetByAPIKeyHash_ReturnsRevokedRows(t *testing.T) {
	repo, mock := newRepo(t)
	hash := []byte("hashed")

	rows := sqlmock.NewRows([]string{
		"id", "merchant_id", "api_key_hash", "api_key_prefix", "secret_key_enc",
		"status", "last_used_at", "revoked_at", "created_at",
	}).AddRow(uuid.New(), uuid.New(), hash, "mxp_abcdefgh", []byte("sealed"),
		"REVOKED", nil, time.Now(), time.Now())

	mock.ExpectQuery(regexp.QuoteMeta(`FROM merchant_credentials WHERE api_key_hash = $1`)).
		WithArgs(hash).
		WillReturnRows(rows)

	got, err := repo.GetByAPIKeyHash(context.Background(), hash)
	require.NoError(t, err)
	assert.False(t, got.IsActive(), "a revoked row must come back so the caller can say why")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCredentialRepository_GetByAPIKeyHash_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(`FROM merchant_credentials WHERE api_key_hash = $1`)).
		WithArgs([]byte("nope")).
		WillReturnError(sql.ErrNoRows)

	_, err := repo.GetByAPIKeyHash(context.Background(), []byte("nope"))
	require.ErrorIs(t, err, domaincredential.ErrCredentialNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCredentialRepository_Revoke_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectExec(regexp.QuoteMeta(`UPDATE merchant_credentials SET`)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := repo.Revoke(context.Background(), uuid.New())
	require.ErrorIs(t, err, domaincredential.ErrCredentialNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}
```

- [ ] **Step 5: Run it and watch it fail**

Run: `go test ./internal/adapter/repository/credential/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 6: Write the repository**

`internal/adapter/repository/credential/repository.go`:

```go
package credential

import (
	"context"
	"time"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/adapter/repository/base"
	domaincredential "be-maxpay/internal/domain/credential"
	"be-maxpay/internal/shared/errs"
	"be-maxpay/internal/shared/id"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

var (
	clientColumns = []string{
		"id", "merchant_id", "code", "label", "status", "created_at", "updated_at",
	}
	credentialColumns = []string{
		"id", "merchant_id", "api_key_hash", "api_key_prefix", "secret_key_enc",
		"status", "last_used_at", "revoked_at", "created_at",
	}
)

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domaincredential.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

func (r *Repository) CreateClient(ctx context.Context, c *domaincredential.Client) (*domaincredential.Client, error) {
	now := time.Now().UTC()

	sqlStr, args, err := r.Builder.Insert("merchant_clients").
		Columns("id", "merchant_id", "code", "label", "status", "created_at", "updated_at").
		Values(id.New(), c.MerchantID, c.Code, c.Label, domaincredential.StatusActive, now, now).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build create client query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		if errs.IsDuplicateError(err) {
			return nil, domaincredential.ErrClientCodeExists
		}
		return nil, errs.WrapDatabaseError(err, "create client")
	}

	return r.GetClientByCode(ctx, c.Code)
}

func (r *Repository) GetClientByCode(ctx context.Context, code string) (*domaincredential.Client, error) {
	sqlStr, args, err := r.Builder.Select(clientColumns...).
		From("merchant_clients").
		Where(squirrel.Eq{"code": code}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build get client query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.MerchantClient
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domaincredential.ErrClientNotFound)
		}
		return nil, errs.WrapDatabaseError(err, "get client")
	}

	return mapper.MerchantClientToDomain(&m), nil
}

func (r *Repository) ListClients(ctx context.Context, merchantID uuid.UUID) ([]*domaincredential.Client, error) {
	sqlStr, args, err := r.Builder.Select(clientColumns...).
		From("merchant_clients").
		Where(squirrel.Eq{"merchant_id": merchantID}).
		OrderBy("created_at ASC").
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build list clients query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.MerchantClient
	if err := r.DB.SelectContext(ctx, &models, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, "list clients")
	}

	return mapper.MerchantClientsToDomain(models), nil
}

func (r *Repository) CreateCredential(ctx context.Context, c *domaincredential.Credential) (*domaincredential.Credential, error) {
	sqlStr, args, err := r.Builder.Insert("merchant_credentials").
		Columns("id", "merchant_id", "api_key_hash", "api_key_prefix",
			"secret_key_enc", "status", "created_at").
		Values(id.New(), c.MerchantID, c.APIKeyHash, c.APIKeyPrefix,
			c.SecretKeyEnc, domaincredential.StatusActive, time.Now().UTC()).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build create credential query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, "create credential")
	}

	return r.GetByAPIKeyHash(ctx, c.APIKeyHash)
}

func (r *Repository) GetByAPIKeyHash(ctx context.Context, hash []byte) (*domaincredential.Credential, error) {
	sqlStr, args, err := r.Builder.Select(credentialColumns...).
		From("merchant_credentials").
		Where(squirrel.Eq{"api_key_hash": hash}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build get credential query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.MerchantCredential
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domaincredential.ErrCredentialNotFound)
		}
		return nil, errs.WrapDatabaseError(err, "get credential")
	}

	return mapper.MerchantCredentialToDomain(&m), nil
}

func (r *Repository) ListCredentials(ctx context.Context, merchantID uuid.UUID) ([]*domaincredential.Credential, error) {
	sqlStr, args, err := r.Builder.Select(credentialColumns...).
		From("merchant_credentials").
		Where(squirrel.Eq{"merchant_id": merchantID}).
		OrderBy("created_at DESC").
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build list credentials query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.MerchantCredential
	if err := r.DB.SelectContext(ctx, &models, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, "list credentials")
	}

	return mapper.MerchantCredentialsToDomain(models), nil
}

func (r *Repository) Revoke(ctx context.Context, cid uuid.UUID) error {
	now := time.Now().UTC()

	sqlStr, args, err := r.Builder.Update("merchant_credentials").
		SetMap(map[string]any{
			"status":     domaincredential.StatusRevoked,
			"revoked_at": now,
		}).
		Where(squirrel.Eq{"id": cid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build revoke credential query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "revoke credential")
	}

	return r.CheckRowsAffectedWith(result, domaincredential.ErrCredentialNotFound)
}

// TouchLastUsed records that a key was used. It is best-effort: a failure here
// must never refuse an otherwise valid request, so the caller logs and
// continues.
func (r *Repository) TouchLastUsed(ctx context.Context, cid uuid.UUID) error {
	sqlStr, args, err := r.Builder.Update("merchant_credentials").
		Set("last_used_at", time.Now().UTC()).
		Where(squirrel.Eq{"id": cid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build touch credential query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		return errs.WrapDatabaseError(err, "touch credential")
	}

	return nil
}
```

- [ ] **Step 7: Run the tests and the migration**

```bash
go test ./internal/adapter/repository/credential/ ./internal/adapter/persistence/... -v
make migrate-up
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c '\d merchant_credentials'
```

Expected: tests PASS, both tables present.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/000003_credentials.*.sql internal/domain/credential \
        internal/adapter/persistence/model/credential.go \
        internal/adapter/persistence/mapper/credential.go \
        internal/adapter/repository/credential
git commit -m "feat(credential): add merchant clients, API keys and sealed secrets"
```

---

### Task 7: The credential service

**Files:**
- Create: `internal/service/credential/service.go`
- Test: `internal/service/credential/service_test.go`

**Interfaces:**
- Consumes: `credential.Repository`, `crypto.SecretBox`, `crypto.NewAPIKey`, `crypto.RandomCode`, `crypto.SHA256`
- Produces: `credentialsvc.NewService(repo credential.Repository, box *crypto.SecretBox, logger *zap.Logger) *Service` satisfying `credential.Service`

- [ ] **Step 1: Write the failing tests**

`internal/service/credential/service_test.go`:

```go
package credential_test

import (
	"context"
	"encoding/base64"
	"testing"

	domaincredential "be-maxpay/internal/domain/credential"
	credentialsvc "be-maxpay/internal/service/credential"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type fakeRepo struct {
	credentials map[string]*domaincredential.Credential // keyed by hex of hash
	clients     []*domaincredential.Client
	touched     []uuid.UUID
	touchErr    error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{credentials: map[string]*domaincredential.Credential{}}
}

func key(h []byte) string { return string(h) }

func (f *fakeRepo) CreateClient(_ context.Context, c *domaincredential.Client) (*domaincredential.Client, error) {
	c.ID = uuid.New()
	f.clients = append(f.clients, c)
	return c, nil
}

func (f *fakeRepo) GetClientByCode(context.Context, string) (*domaincredential.Client, error) {
	return nil, domaincredential.ErrClientNotFound
}

func (f *fakeRepo) ListClients(context.Context, uuid.UUID) ([]*domaincredential.Client, error) {
	return f.clients, nil
}

func (f *fakeRepo) CreateCredential(_ context.Context, c *domaincredential.Credential) (*domaincredential.Credential, error) {
	c.ID = uuid.New()
	c.Status = domaincredential.StatusActive
	f.credentials[key(c.APIKeyHash)] = c
	return c, nil
}

func (f *fakeRepo) GetByAPIKeyHash(_ context.Context, h []byte) (*domaincredential.Credential, error) {
	c, ok := f.credentials[key(h)]
	if !ok {
		return nil, domaincredential.ErrCredentialNotFound
	}
	return c, nil
}

func (f *fakeRepo) ListCredentials(context.Context, uuid.UUID) ([]*domaincredential.Credential, error) {
	return nil, nil
}

func (f *fakeRepo) Revoke(context.Context, uuid.UUID) error { return nil }

func (f *fakeRepo) TouchLastUsed(_ context.Context, id uuid.UUID) error {
	f.touched = append(f.touched, id)
	return f.touchErr
}

func newService(t *testing.T, repo domaincredential.Repository) *credentialsvc.Service {
	t.Helper()

	kek := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	box, err := crypto.NewSecretBox(kek)
	require.NoError(t, err)

	return credentialsvc.NewService(repo, box, zap.NewNop())
}

func TestCredentialService_IssueKey_ReturnsThePlaintextOnce(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(t, repo)
	merchantID := uuid.New()

	issued, err := svc.IssueKey(context.Background(), merchantID)
	require.NoError(t, err)

	assert.NotEmpty(t, issued.APIKey)
	assert.NotEmpty(t, issued.SecretKey)
	assert.Equal(t, issued.APIKey[:12], issued.Prefix)

	stored := repo.credentials[key(crypto.SHA256(issued.APIKey))]
	require.NotNil(t, stored, "the key must be stored by its hash")
	assert.NotContains(t, string(stored.SecretKeyEnc), issued.SecretKey,
		"the secret must be sealed, not stored in clear")
}

func TestCredentialService_Authenticate_RoundTripsAnIssuedKey(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(t, repo)

	issued, err := svc.IssueKey(context.Background(), uuid.New())
	require.NoError(t, err)

	got, err := svc.Authenticate(context.Background(), issued.APIKey)
	require.NoError(t, err)
	assert.Equal(t, issued.CredentialID, got.ID)
	assert.Contains(t, repo.touched, got.ID, "a successful authentication records last use")
}

func TestCredentialService_Authenticate_RejectsAnUnknownKey(t *testing.T) {
	svc := newService(t, newFakeRepo())

	_, err := svc.Authenticate(context.Background(), "mxp_not-a-real-key")
	require.ErrorIs(t, err, domaincredential.ErrCredentialNotFound)
}

func TestCredentialService_Authenticate_RejectsARevokedKey(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(t, repo)

	issued, err := svc.IssueKey(context.Background(), uuid.New())
	require.NoError(t, err)
	repo.credentials[key(crypto.SHA256(issued.APIKey))].Status = domaincredential.StatusRevoked

	_, err = svc.Authenticate(context.Background(), issued.APIKey)
	require.ErrorIs(t, err, domaincredential.ErrCredentialRevoked)
}

// A bookkeeping write must never cost a merchant a valid request.
func TestCredentialService_Authenticate_SurvivesATouchFailure(t *testing.T) {
	repo := newFakeRepo()
	repo.touchErr = assertAnError{}
	svc := newService(t, repo)

	issued, err := svc.IssueKey(context.Background(), uuid.New())
	require.NoError(t, err)

	_, err = svc.Authenticate(context.Background(), issued.APIKey)
	require.NoError(t, err)
}

type assertAnError struct{}

func (assertAnError) Error() string { return "touch failed" }

func TestCredentialService_SecretFor_UnsealsWhatIssueKeySealed(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(t, repo)

	issued, err := svc.IssueKey(context.Background(), uuid.New())
	require.NoError(t, err)

	stored := repo.credentials[key(crypto.SHA256(issued.APIKey))]
	secret, err := svc.SecretFor(context.Background(), stored)
	require.NoError(t, err)
	assert.Equal(t, issued.SecretKey, secret)
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./internal/service/credential/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the service**

`internal/service/credential/service.go`:

```go
// Package credential issues and verifies the keys a merchant authenticates
// with.
package credential

import (
	"context"

	domaincredential "be-maxpay/internal/domain/credential"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// secretKeyLength is the signing secret handed to the merchant. It is only
// ever an HMAC key, so length is the whole of its strength.
const secretKeyLength = 48

// clientCodeLength matches the PRD's clientId examples.
const clientCodeLength = 10

type Service struct {
	repo   domaincredential.Repository
	box    *crypto.SecretBox
	logger *zap.Logger
}

func NewService(repo domaincredential.Repository, box *crypto.SecretBox, logger *zap.Logger) *Service {
	return &Service{repo: repo, box: box, logger: logger}
}

func (s *Service) IssueClient(ctx context.Context, data *domaincredential.CreateClientData) (*domaincredential.Client, error) {
	if err := domaincredential.ValidateCreateClient(data); err != nil {
		return nil, err
	}

	code, err := crypto.RandomCode(clientCodeLength)
	if err != nil {
		return nil, err
	}

	return s.repo.CreateClient(ctx, &domaincredential.Client{
		MerchantID: data.MerchantID,
		Code:       code,
		Label:      data.Label,
		Status:     domaincredential.StatusActive,
	})
}

func (s *Service) ListClients(ctx context.Context, merchantID uuid.UUID) ([]*domaincredential.Client, error) {
	return s.repo.ListClients(ctx, merchantID)
}

// IssueKey mints an API key and a signing secret. The plaintext of both is
// returned here and nowhere else: the key is stored as a hash and the secret
// sealed, so neither can be read back out of the database.
func (s *Service) IssueKey(ctx context.Context, merchantID uuid.UUID) (*domaincredential.IssuedKey, error) {
	apiKey, prefix, err := crypto.NewAPIKey()
	if err != nil {
		return nil, err
	}

	secret, err := crypto.RandomCode(secretKeyLength)
	if err != nil {
		return nil, err
	}

	sealed, err := s.box.Seal([]byte(secret))
	if err != nil {
		return nil, err
	}

	stored, err := s.repo.CreateCredential(ctx, &domaincredential.Credential{
		MerchantID:   merchantID,
		APIKeyHash:   crypto.SHA256(apiKey),
		APIKeyPrefix: prefix,
		SecretKeyEnc: sealed,
	})
	if err != nil {
		return nil, err
	}

	return &domaincredential.IssuedKey{
		CredentialID: stored.ID,
		APIKey:       apiKey,
		SecretKey:    secret,
		Prefix:       prefix,
	}, nil
}

func (s *Service) ListKeys(ctx context.Context, merchantID uuid.UUID) ([]*domaincredential.Credential, error) {
	return s.repo.ListCredentials(ctx, merchantID)
}

func (s *Service) RevokeKey(ctx context.Context, id uuid.UUID) error {
	return s.repo.Revoke(ctx, id)
}

// Authenticate resolves a presented key. A revoked key is reported as revoked
// rather than as unknown, because the two need different fixes: one means
// rotate, the other means you are using the wrong environment.
func (s *Service) Authenticate(ctx context.Context, apiKey string) (*domaincredential.Credential, error) {
	found, err := s.repo.GetByAPIKeyHash(ctx, crypto.SHA256(apiKey))
	if err != nil {
		return nil, err
	}

	if !found.IsActive() {
		return nil, domaincredential.ErrCredentialRevoked
	}

	// Best effort. Refusing a valid request because a bookkeeping column
	// could not be written would be a worse outcome than a stale timestamp.
	if err := s.repo.TouchLastUsed(ctx, found.ID); err != nil {
		s.logger.Warn("could not record credential use",
			zap.String("trace_id", shared.TraceIDFromContext(ctx)),
			zap.String("credential_id", found.ID.String()),
			zap.Error(err),
		)
	}

	return found, nil
}

// SecretFor unseals the signing secret. The plaintext lives only as long as
// the verification that asked for it; it is never logged and never returned
// through HTTP.
func (s *Service) SecretFor(ctx context.Context, c *domaincredential.Credential) (string, error) {
	plain, err := s.box.Open(c.SecretKeyEnc)
	if err != nil {
		return "", err
	}

	return string(plain), nil
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./internal/service/credential/ -v`
Expected: PASS, all six tests.

- [ ] **Step 5: Commit**

```bash
git add internal/service/credential
git commit -m "feat(credential): issue, revoke and authenticate merchant keys"
```

---

### Task 8: The merchant authentication middleware

**Files:**
- Create: `internal/adapter/http/middleware/merchantauth.go`
- Create: `internal/adapter/http/middleware/merchantauth_test.go`
- Modify: `internal/shared/consts/consts.go`

**Interfaces:**
- Consumes: `credential.Service`, `merchant.Service`, `resp.Error`
- Produces:
  - `middleware.MerchantAuth(creds credential.Service, merchants merchant.Service) gin.HandlerFunc`
  - `middleware.MerchantFromContext(c *gin.Context) (*merchant.Merchant, bool)`
  - `middleware.CredentialFromContext(c *gin.Context) (*credential.Credential, bool)`
  - `consts.MerchantKey`, `consts.CredentialKey`

- [ ] **Step 1: Write the failing test**

`internal/adapter/http/middleware/merchantauth_test.go`:

```go
package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"be-maxpay/internal/adapter/http/middleware"
	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubCreds struct {
	credential *domaincredential.Credential
	err        error
}

func (s stubCreds) IssueClient(context.Context, *domaincredential.CreateClientData) (*domaincredential.Client, error) {
	return nil, nil
}
func (s stubCreds) ListClients(context.Context, uuid.UUID) ([]*domaincredential.Client, error) {
	return nil, nil
}
func (s stubCreds) IssueKey(context.Context, uuid.UUID) (*domaincredential.IssuedKey, error) {
	return nil, nil
}
func (s stubCreds) ListKeys(context.Context, uuid.UUID) ([]*domaincredential.Credential, error) {
	return nil, nil
}
func (s stubCreds) RevokeKey(context.Context, uuid.UUID) error { return nil }
func (s stubCreds) Authenticate(context.Context, string) (*domaincredential.Credential, error) {
	return s.credential, s.err
}
func (s stubCreds) SecretFor(context.Context, *domaincredential.Credential) (string, error) {
	return "secret", nil
}

type stubMerchants struct {
	merchant *domainmerchant.Merchant
	err      error
}

func (s stubMerchants) Create(context.Context, uuid.UUID, *domainmerchant.CreateData) (*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) GetByID(context.Context, uuid.UUID) (*domainmerchant.Merchant, error) {
	return s.merchant, s.err
}
func (s stubMerchants) GetByCode(context.Context, string) (*domainmerchant.Merchant, error) {
	return s.merchant, s.err
}
func (s stubMerchants) ListSubtree(context.Context, uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) Ancestors(context.Context, uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) Update(context.Context, uuid.UUID, *domainmerchant.UpdateData) (*domainmerchant.Merchant, error) {
	return nil, nil
}

func activeMerchant() *domainmerchant.Merchant {
	return &domainmerchant.Merchant{
		ID: uuid.New(), Code: "ACME123456", Name: "Acme",
		Role: domainmerchant.RoleDirect, Depth: 2,
		DepositRate: decimal.RequireFromString("0.015"),
		PayoutRate:  decimal.RequireFromString("0.015"),
		Status:      domainmerchant.StatusActive,
	}
}

func runMerchantAuth(t *testing.T, creds domaincredential.Service, merchants domainmerchant.Service, header string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(middleware.MerchantAuth(creds, merchants))
	r.GET("/probe", func(c *gin.Context) {
		m, ok := middleware.MerchantFromContext(c)
		require.True(t, ok)
		c.String(http.StatusOK, m.Code)
	})

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if header != "" {
		req.Header.Set("x-api-key", header)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	return rec
}

func TestMerchantAuth_PutsTheMerchantInContext(t *testing.T) {
	m := activeMerchant()
	rec := runMerchantAuth(t,
		stubCreds{credential: &domaincredential.Credential{ID: uuid.New(), MerchantID: m.ID, Status: domaincredential.StatusActive}},
		stubMerchants{merchant: m},
		"mxp_key")

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ACME123456", rec.Body.String())
}

func TestMerchantAuth_RejectsAMissingHeader(t *testing.T) {
	rec := runMerchantAuth(t, stubCreds{}, stubMerchants{}, "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMerchantAuth_RejectsAnUnknownKey(t *testing.T) {
	rec := runMerchantAuth(t,
		stubCreds{err: domaincredential.ErrCredentialNotFound},
		stubMerchants{}, "mxp_wrong")

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMerchantAuth_RejectsASuspendedMerchant(t *testing.T) {
	m := activeMerchant()
	m.Status = domainmerchant.StatusSuspended

	rec := runMerchantAuth(t,
		stubCreds{credential: &domaincredential.Credential{ID: uuid.New(), MerchantID: m.ID, Status: domaincredential.StatusActive}},
		stubMerchants{merchant: m},
		"mxp_key")

	assert.Equal(t, http.StatusForbidden, rec.Code,
		"a suspended merchant has valid credentials; 401 would send them to rotate a key that is fine")
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/adapter/http/middleware/ -run MerchantAuth -v`
Expected: compile error — `undefined: middleware.MerchantAuth`.

- [ ] **Step 3: Add the context keys**

In `internal/shared/consts/consts.go`, beside the existing trace key:

```go
	// MerchantKey and CredentialKey carry what MerchantAuth resolved, so a
	// handler never repeats the lookup.
	MerchantKey   ContextKey = "merchant"
	CredentialKey ContextKey = "credential"
```

- [ ] **Step 4: Write the middleware**

`internal/adapter/http/middleware/merchantauth.go`:

```go
package middleware

import (
	"be-maxpay/internal/adapter/http/resp"
	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared/consts"

	"github.com/gin-gonic/gin"
)

// MerchantAPIKeyHeader is the header a merchant authenticates with. Lower case
// to match the PRD's examples; gin's header lookup is case-insensitive.
const MerchantAPIKeyHeader = "x-api-key"

// MerchantAuth resolves an API key to its merchant and stores both on the
// context.
//
// A suspended merchant is refused with 403, not 401: the credential is
// perfectly valid, and reporting it as an authentication failure sends an
// integrator to rotate a key that was never the problem.
func MerchantAuth(creds domaincredential.Service, merchants domainmerchant.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		presented := c.GetHeader(MerchantAPIKeyHeader)
		if presented == "" {
			resp.Error(c, domaincredential.ErrCredentialNotFound)
			c.Abort()
			return
		}

		credential, err := creds.Authenticate(c.Request.Context(), presented)
		if err != nil {
			resp.Error(c, err)
			c.Abort()
			return
		}

		found, err := merchants.GetByID(c.Request.Context(), credential.MerchantID)
		if err != nil {
			resp.Error(c, err)
			c.Abort()
			return
		}

		if !found.IsActive() {
			resp.Error(c, domainmerchant.ErrMerchantSuspended)
			c.Abort()
			return
		}

		c.Set(string(consts.MerchantKey), found)
		c.Set(string(consts.CredentialKey), credential)

		c.Next()
	}
}

// MerchantFromContext returns what MerchantAuth resolved.
func MerchantFromContext(c *gin.Context) (*domainmerchant.Merchant, bool) {
	value, exists := c.Get(string(consts.MerchantKey))
	if !exists {
		return nil, false
	}
	m, ok := value.(*domainmerchant.Merchant)

	return m, ok
}

// CredentialFromContext returns the credential the request authenticated with.
// The signature middleware needs it to unseal the signing secret.
func CredentialFromContext(c *gin.Context) (*domaincredential.Credential, bool) {
	value, exists := c.Get(string(consts.CredentialKey))
	if !exists {
		return nil, false
	}
	cred, ok := value.(*domaincredential.Credential)

	return cred, ok
}
```

- [ ] **Step 5: Run the tests**

Run: `go test ./internal/adapter/http/middleware/ -v`
Expected: PASS, including the pre-existing API-key, logger and timeout tests.

- [ ] **Step 6: Commit**

```bash
git add internal/adapter/http/middleware/merchantauth.go \
        internal/adapter/http/middleware/merchantauth_test.go \
        internal/shared/consts/consts.go
git commit -m "feat(http): resolve an API key to its merchant"
```

---

### Task 9: Single-use signatures

**Files:**
- Create: `db/migrations/000004_request_guards.up.sql`
- Create: `db/migrations/000004_request_guards.down.sql`
- Create: `internal/domain/signature/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/repository/signature/repository.go`
- Create: `internal/service/signature/service.go`
- Test: `internal/service/signature/service_test.go`

**Interfaces:**
- Consumes: `credential.Credential`, `merchant.Merchant`, `shared.Config`
- Produces:
  - `signature.Claims{MerchantCode, ClientCode string; IssuedAtMS int64}`
  - `signature.VerifyInput{Token, SecretKey, MerchantCode, ClientCode string; BodyTimestampMS int64}`
  - `signature.Repository` with `MarkUsed(ctx, hash []byte, merchantID uuid.UUID, expiresAt time.Time) error` and `DeleteExpired(ctx, before time.Time) (int64, error)`
  - `signature.Service` with `Verify(ctx context.Context, merchantID uuid.UUID, in VerifyInput) error`
  - errors `ErrSignatureInvalid`, `ErrSignatureExpired`, `ErrSignatureReplayed`, `ErrTimestampMismatch`, `ErrClaimMismatch`

- [ ] **Step 1: Write the migration**

`db/migrations/000004_request_guards.up.sql`:

```sql
-- A signature may be presented once. The primary key is the guard: a
-- read-then-write check lets two concurrent replays both pass, and this is
-- the only thing standing between a captured request and a repeat of it.
CREATE TABLE used_signatures (
    signature_hash BYTEA PRIMARY KEY,
    merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    expires_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX used_signatures_expiry ON used_signatures (expires_at);

-- transaction_id is the merchant's own identifier for a payment. The
-- signature guard above stops a replayed request; this stops a second payment
-- from a merchant that legitimately retried with a fresh signature.
CREATE TABLE idempotency_keys (
    merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL,
    request_hash   BYTEA NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('IN_FLIGHT', 'DONE')),
    response_code  INT,
    response_body  JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ,
    PRIMARY KEY (merchant_id, transaction_id)
);
CREATE INDEX idempotency_keys_inflight ON idempotency_keys (created_at) WHERE status = 'IN_FLIGHT';
```

`db/migrations/000004_request_guards.down.sql`:

```sql
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS used_signatures;
```

- [ ] **Step 2: Write the domain files**

`internal/domain/signature/entity.go`:

```go
package signature

// Claims are the three values the PRD requires inside the JWT.
//
// IssuedAtMS is milliseconds, not seconds. The PRD is explicit about it and
// the body carries the same number, so treating it as seconds would compare
// two different units and accept a signature roughly a thousand times older
// than it looks.
type Claims struct {
	MerchantCode string
	ClientCode   string
	IssuedAtMS   int64
}
```

`internal/domain/signature/dto.go`:

```go
package signature

// VerifyInput is everything a verification needs. SecretKey is the unsealed
// signing secret and must not outlive the call.
type VerifyInput struct {
	Token           string
	SecretKey       string
	MerchantCode    string
	ClientCode      string
	BodyTimestampMS int64
}
```

`internal/domain/signature/errors.go`:

```go
package signature

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrSignatureInvalid  = fmt.Errorf("signature invalid: %w", errs.ErrUnauthorized)
	ErrSignatureExpired  = fmt.Errorf("signature expired: %w", errs.ErrUnauthorized)
	ErrClaimMismatch     = fmt.Errorf("signature claims do not match the request: %w", errs.ErrUnauthorized)
	ErrTimestampMismatch = fmt.Errorf("timestamp does not match the signature iat: %w", errs.ErrUnauthorized)

	// Conflict, not unauthorized: the caller must stop resending, not fix
	// their credentials.
	ErrSignatureReplayed = fmt.Errorf("signature already used: %w", errs.ErrConflict)
)
```

`internal/domain/signature/repository.go`:

```go
package signature

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Repository interface {
	// MarkUsed claims a signature. It returns ErrSignatureReplayed when the
	// hash is already present.
	MarkUsed(ctx context.Context, hash []byte, merchantID uuid.UUID, expiresAt time.Time) error
	// DeleteExpired removes rows past their window and reports how many.
	DeleteExpired(ctx context.Context, before time.Time) (int64, error)
}
```

`internal/domain/signature/service.go`:

```go
package signature

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	Verify(ctx context.Context, merchantID uuid.UUID, in VerifyInput) error
}
```

`internal/domain/signature/validator.go`:

```go
package signature

// ValidateClaims checks the claims against what the request said about itself.
//
// The identity checks matter as much as the cryptography: a signature is only
// evidence about the payload it was made over, and without these a valid
// signature from one client would authorise a request naming another.
func ValidateClaims(c Claims, in VerifyInput) error {
	if c.MerchantCode != in.MerchantCode || c.ClientCode != in.ClientCode {
		return ErrClaimMismatch
	}
	if c.IssuedAtMS != in.BodyTimestampMS {
		return ErrTimestampMismatch
	}

	return nil
}
```

- [ ] **Step 3: Write the repository**

`internal/adapter/repository/signature/repository.go`:

```go
package signature

import (
	"context"
	"time"

	"be-maxpay/internal/adapter/repository/base"
	domainsignature "be-maxpay/internal/domain/signature"
	"be-maxpay/internal/shared/errs"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domainsignature.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

// MarkUsed inserts the hash and lets the primary key decide. Two concurrent
// replays both pass a SELECT; only one survives an INSERT.
func (r *Repository) MarkUsed(ctx context.Context, hash []byte, merchantID uuid.UUID, expiresAt time.Time) error {
	sqlStr, args, err := r.Builder.Insert("used_signatures").
		Columns("signature_hash", "merchant_id", "expires_at").
		Values(hash, merchantID, expiresAt).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build mark signature query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		if errs.IsDuplicateError(err) {
			return domainsignature.ErrSignatureReplayed
		}
		return errs.WrapDatabaseError(err, "mark signature used")
	}

	return nil
}

func (r *Repository) DeleteExpired(ctx context.Context, before time.Time) (int64, error) {
	sqlStr, args, err := r.Builder.Delete("used_signatures").
		Where(squirrel.Lt{"expires_at": before}).
		ToSql()
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "build delete expired signatures query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "delete expired signatures")
	}

	return result.RowsAffected()
}
```

- [ ] **Step 4: Write the failing service test**

`internal/service/signature/service_test.go`:

```go
package signature_test

import (
	"context"
	"testing"
	"time"

	domainsignature "be-maxpay/internal/domain/signature"
	signaturesvc "be-maxpay/internal/service/signature"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "a-signing-secret"

type fakeRepo struct {
	used map[string]bool
}

func newFakeRepo() *fakeRepo { return &fakeRepo{used: map[string]bool{}} }

func (f *fakeRepo) MarkUsed(_ context.Context, hash []byte, _ uuid.UUID, _ time.Time) error {
	if f.used[string(hash)] {
		return domainsignature.ErrSignatureReplayed
	}
	f.used[string(hash)] = true
	return nil
}

func (f *fakeRepo) DeleteExpired(context.Context, time.Time) (int64, error) { return 0, nil }

func signHS256(t *testing.T, merchantCode, clientCode string, iatMS int64, secret string) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchantId": merchantCode,
		"clientId":   clientCode,
		"iat":        iatMS,
	})
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	return signed
}

func newService(repo domainsignature.Repository) *signaturesvc.Service {
	return signaturesvc.NewService(repo, 60*time.Second, 5*time.Second)
}

func validInput(t *testing.T, iatMS int64) domainsignature.VerifyInput {
	t.Helper()
	return domainsignature.VerifyInput{
		Token:           signHS256(t, "MERCHANT01", "CLIENT0001", iatMS, testSecret),
		SecretKey:       testSecret,
		MerchantCode:    "MERCHANT01",
		ClientCode:      "CLIENT0001",
		BodyTimestampMS: iatMS,
	}
}

func nowMS() int64 { return time.Now().UnixMilli() }

func TestSignatureService_Verify_AcceptsAFreshSignature(t *testing.T) {
	svc := newService(newFakeRepo())

	err := svc.Verify(context.Background(), uuid.New(), validInput(t, nowMS()))
	require.NoError(t, err)
}

func TestSignatureService_Verify_RejectsTheSameSignatureTwice(t *testing.T) {
	svc := newService(newFakeRepo())
	in := validInput(t, nowMS())
	id := uuid.New()

	require.NoError(t, svc.Verify(context.Background(), id, in))

	err := svc.Verify(context.Background(), id, in)
	require.ErrorIs(t, err, domainsignature.ErrSignatureReplayed)
}

func TestSignatureService_Verify_RejectsAWrongSecret(t *testing.T) {
	svc := newService(newFakeRepo())
	in := validInput(t, nowMS())
	in.SecretKey = "the-wrong-secret"

	err := svc.Verify(context.Background(), uuid.New(), in)
	require.ErrorIs(t, err, domainsignature.ErrSignatureInvalid)
}

func TestSignatureService_Verify_RejectsAnExpiredSignature(t *testing.T) {
	svc := newService(newFakeRepo())
	old := time.Now().Add(-2 * time.Minute).UnixMilli()

	err := svc.Verify(context.Background(), uuid.New(), validInput(t, old))
	require.ErrorIs(t, err, domainsignature.ErrSignatureExpired)
}

func TestSignatureService_Verify_RejectsAFutureSignatureBeyondSkew(t *testing.T) {
	svc := newService(newFakeRepo())
	future := time.Now().Add(1 * time.Minute).UnixMilli()

	err := svc.Verify(context.Background(), uuid.New(), validInput(t, future))
	require.ErrorIs(t, err, domainsignature.ErrSignatureExpired)
}

func TestSignatureService_Verify_RejectsABodyTimestampThatDiffersFromIat(t *testing.T) {
	svc := newService(newFakeRepo())
	in := validInput(t, nowMS())
	in.BodyTimestampMS = in.BodyTimestampMS + 1

	err := svc.Verify(context.Background(), uuid.New(), in)
	require.ErrorIs(t, err, domainsignature.ErrTimestampMismatch)
}

func TestSignatureService_Verify_RejectsClaimsNamingAnotherMerchant(t *testing.T) {
	svc := newService(newFakeRepo())
	in := validInput(t, nowMS())
	in.MerchantCode = "SOMEONEELSE"

	err := svc.Verify(context.Background(), uuid.New(), in)
	require.ErrorIs(t, err, domainsignature.ErrClaimMismatch)
}

// An unpinned parser accepts alg:none, which turns the whole check into a
// formality. This is the test that keeps the pin in place.
func TestSignatureService_Verify_RejectsAlgNone(t *testing.T) {
	svc := newService(newFakeRepo())
	iat := nowMS()

	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"merchantId": "MERCHANT01",
		"clientId":   "CLIENT0001",
		"iat":        iat,
	})
	unsigned, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	err = svc.Verify(context.Background(), uuid.New(), domainsignature.VerifyInput{
		Token:           unsigned,
		SecretKey:       testSecret,
		MerchantCode:    "MERCHANT01",
		ClientCode:      "CLIENT0001",
		BodyTimestampMS: iat,
	})

	require.ErrorIs(t, err, domainsignature.ErrSignatureInvalid)
}

func TestSignatureService_Verify_RejectsGarbage(t *testing.T) {
	svc := newService(newFakeRepo())

	err := svc.Verify(context.Background(), uuid.New(), domainsignature.VerifyInput{
		Token:           "not.a.jwt",
		SecretKey:       testSecret,
		MerchantCode:    "MERCHANT01",
		ClientCode:      "CLIENT0001",
		BodyTimestampMS: nowMS(),
	})

	require.ErrorIs(t, err, domainsignature.ErrSignatureInvalid)
	assert.NotContains(t, err.Error(), testSecret)
}
```

- [ ] **Step 5: Run it and watch it fail**

```bash
go get github.com/golang-jwt/jwt/v5
go test ./internal/service/signature/ -v
```

Expected: build failure — the service package does not exist.

- [ ] **Step 6: Write the service**

`internal/service/signature/service.go`:

```go
// Package signature verifies the single-use HS256 signature the gateway
// requires on every request that moves money.
package signature

import (
	"context"
	"time"

	domainsignature "be-maxpay/internal/domain/signature"
	"be-maxpay/internal/shared/crypto"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Service struct {
	repo      domainsignature.Repository
	ttl       time.Duration
	clockSkew time.Duration
}

func NewService(repo domainsignature.Repository, ttl, clockSkew time.Duration) *Service {
	return &Service{repo: repo, ttl: ttl, clockSkew: clockSkew}
}

// Verify checks the signature and then claims it.
//
// The order matters. Claiming first would let an attacker burn a legitimate
// signature by replaying it with a corrupted body; checking first means only
// a signature that would have been accepted is ever consumed.
func (s *Service) Verify(ctx context.Context, merchantID uuid.UUID, in domainsignature.VerifyInput) error {
	claims, err := s.parse(in)
	if err != nil {
		return err
	}

	if err := domainsignature.ValidateClaims(claims, in); err != nil {
		return err
	}

	issuedAt := time.UnixMilli(claims.IssuedAtMS)
	now := time.Now()
	if now.Sub(issuedAt) > s.ttl || issuedAt.Sub(now) > s.clockSkew {
		return domainsignature.ErrSignatureExpired
	}

	return s.repo.MarkUsed(ctx, crypto.SHA256(in.Token), merchantID, issuedAt.Add(s.ttl))
}

// parse pins the algorithm to HS256. Without the pin the parser would accept
// alg:none, and an RSA-signed token verified with the HMAC secret as its
// public key.
func (s *Service) parse(in domainsignature.VerifyInput) (domainsignature.Claims, error) {
	parsed, err := jwt.Parse(in.Token, func(*jwt.Token) (any, error) {
		return []byte(in.SecretKey), nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		// The library's own iat check assumes seconds; the PRD specifies
		// milliseconds, so the window is enforced above instead.
		jwt.WithoutClaimsValidation(),
	)
	if err != nil {
		return domainsignature.Claims{}, domainsignature.ErrSignatureInvalid
	}

	mapClaims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return domainsignature.Claims{}, domainsignature.ErrSignatureInvalid
	}

	merchantCode, ok := mapClaims["merchantId"].(string)
	if !ok {
		return domainsignature.Claims{}, domainsignature.ErrSignatureInvalid
	}
	clientCode, ok := mapClaims["clientId"].(string)
	if !ok {
		return domainsignature.Claims{}, domainsignature.ErrSignatureInvalid
	}

	// JSON numbers decode to float64. A millisecond timestamp is 13 digits,
	// well inside float64's exact-integer range, so the conversion is lossless
	// -- but it has to be done deliberately rather than by a type assertion
	// that would simply fail.
	iat, ok := mapClaims["iat"].(float64)
	if !ok {
		return domainsignature.Claims{}, domainsignature.ErrSignatureInvalid
	}

	return domainsignature.Claims{
		MerchantCode: merchantCode,
		ClientCode:   clientCode,
		IssuedAtMS:   int64(iat),
	}, nil
}
```

- [ ] **Step 7: Run the tests and the migration**

```bash
go test ./internal/service/signature/ ./internal/adapter/repository/signature/ -v
make migrate-up
```

Expected: PASS, and both guard tables created.

- [ ] **Step 8: Prove the replay guard against a real database**

```bash
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c "
INSERT INTO merchants (code,name,role,depth,pool_model,deposit_rate,payout_rate,status)
VALUES ('ROOT000001','House','ROOT',0,'SHARED',0.005,0.005,'ACTIVE');
INSERT INTO used_signatures VALUES ('\x01', (SELECT id FROM merchants LIMIT 1), NOW() + INTERVAL '1 minute');
INSERT INTO used_signatures VALUES ('\x01', (SELECT id FROM merchants LIMIT 1), NOW() + INTERVAL '1 minute');"
```

Expected: the second insert fails with a duplicate key violation on
`used_signatures_pkey`. Clean up with
`docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c "DELETE FROM used_signatures; DELETE FROM merchants;"`.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/000004_request_guards.*.sql internal/domain/signature \
        internal/adapter/repository/signature internal/service/signature go.mod go.sum
git commit -m "feat(signature): verify and consume single-use HS256 signatures"
```

---

### Task 10: The signature middleware

Verification needs four fields out of the request body, and the handler needs
that same body afterwards. `c.Request.Body` is a stream that can only be read
once, so the middleware buffers it and puts it back.

**Files:**
- Create: `internal/adapter/http/middleware/signature.go`
- Create: `internal/adapter/http/middleware/signature_test.go`

**Interfaces:**
- Consumes: `signature.Service`, `credential.Service`, `middleware.MerchantFromContext`, `middleware.CredentialFromContext`
- Produces:
  - `middleware.SignatureRequired(sigs signature.Service, creds credential.Service) gin.HandlerFunc`
  - `middleware.SignedBodyFromContext(c *gin.Context) ([]byte, bool)` — the buffered body, for the idempotency hash

- [ ] **Step 1: Write the failing test**

`internal/adapter/http/middleware/signature_test.go`:

```go
package middleware_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"be-maxpay/internal/adapter/http/middleware"
	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"
	domainsignature "be-maxpay/internal/domain/signature"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubSignatures struct {
	err  error
	seen domainsignature.VerifyInput
}

func (s *stubSignatures) Verify(_ context.Context, _ uuid.UUID, in domainsignature.VerifyInput) error {
	s.seen = in
	return s.err
}

func signedBody(t *testing.T, merchantCode, clientCode, secret string, iatMS int64) []byte {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchantId": merchantCode, "clientId": clientCode, "iat": iatMS,
	})
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	body, err := json.Marshal(map[string]any{
		"merchantId": merchantCode,
		"clientId":   clientCode,
		"signature":  signed,
		"timestamp":  iatMS,
		"amount":     100,
	})
	require.NoError(t, err)

	return body
}

func runSignature(t *testing.T, sigs domainsignature.Service, body []byte) (*httptest.ResponseRecorder, *string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	m := activeMerchant()
	creds := stubCreds{credential: &domaincredential.Credential{
		ID: uuid.New(), MerchantID: m.ID, Status: domaincredential.StatusActive,
	}}

	var handlerSaw string
	r := gin.New()
	r.Use(middleware.MerchantAuth(creds, stubMerchants{merchant: m}))
	r.Use(middleware.SignatureRequired(sigs, creds))
	r.POST("/pay", func(c *gin.Context) {
		read, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		handlerSaw = string(read)
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/pay", bytes.NewReader(body))
	req.Header.Set("x-api-key", "mxp_key")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	return rec, &handlerSaw
}

func TestSignatureRequired_PassesAValidRequestThrough(t *testing.T) {
	body := signedBody(t, "ACME123456", "CLIENT0001", "secret", time.Now().UnixMilli())
	sigs := &stubSignatures{}

	rec, handlerSaw := runSignature(t, sigs, body)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, string(body), *handlerSaw,
		"the handler must still be able to read the body the middleware consumed")
	assert.Equal(t, "ACME123456", sigs.seen.MerchantCode)
	assert.NotEmpty(t, sigs.seen.Token)
}

func TestSignatureRequired_RejectsAMissingSignature(t *testing.T) {
	body := []byte(`{"merchantId":"ACME123456","clientId":"CLIENT0001","timestamp":1}`)

	rec, _ := runSignature(t, &stubSignatures{}, body)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestSignatureRequired_RejectsUnparseableJSON(t *testing.T) {
	rec, _ := runSignature(t, &stubSignatures{}, []byte(`{not json`))

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSignatureRequired_RelaysAReplayAs409(t *testing.T) {
	body := signedBody(t, "ACME123456", "CLIENT0001", "secret", time.Now().UnixMilli())
	sigs := &stubSignatures{err: domainsignature.ErrSignatureReplayed}

	rec, _ := runSignature(t, sigs, body)

	assert.Equal(t, http.StatusConflict, rec.Code)
}

func TestSignatureRequired_RelaysAnInvalidSignatureAs401(t *testing.T) {
	body := signedBody(t, "ACME123456", "CLIENT0001", "secret", time.Now().UnixMilli())
	sigs := &stubSignatures{err: domainsignature.ErrSignatureInvalid}

	rec, _ := runSignature(t, sigs, body)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

// The middleware must not run before MerchantAuth: without a merchant on the
// context there is nothing to verify against.
func TestSignatureRequired_RefusesWithoutAMerchantOnTheContext(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(middleware.SignatureRequired(&stubSignatures{}, stubCreds{}))
	r.POST("/pay", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodPost, "/pay", bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

var _ = domainmerchant.RoleDirect
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/adapter/http/middleware/ -run Signature -v`
Expected: compile error — `undefined: middleware.SignatureRequired`.

- [ ] **Step 3: Add the context key**

In `internal/shared/consts/consts.go`:

```go
	// SignedBodyKey holds the buffered request body, so the idempotency guard
	// can hash exactly what the signature covered without reading the stream
	// a second time.
	SignedBodyKey ContextKey = "signed_body"
```

- [ ] **Step 4: Write the middleware**

`internal/adapter/http/middleware/signature.go`:

```go
package middleware

import (
	"bytes"
	"encoding/json"
	"io"

	"be-maxpay/internal/adapter/http/resp"
	domaincredential "be-maxpay/internal/domain/credential"
	domainsignature "be-maxpay/internal/domain/signature"
	"be-maxpay/internal/shared/consts"
	"be-maxpay/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

// maxSignedBody bounds what the middleware will buffer. A payout body is a few
// hundred bytes; anything approaching this is not a request this endpoint
// serves, and reading it into memory before authenticating it would be a way
// to spend the server's memory for free.
const maxSignedBody = 1 << 20

// signedEnvelope is the part of the body every signed request shares.
type signedEnvelope struct {
	MerchantID string `json:"merchantId"`
	ClientID   string `json:"clientId"`
	Signature  string `json:"signature"`
	Timestamp  int64  `json:"timestamp"`
}

// SignatureRequired verifies the single-use signature on a money-moving
// request. It must be registered after MerchantAuth.
func SignatureRequired(sigs domainsignature.Service, creds domaincredential.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		merchant, ok := MerchantFromContext(c)
		if !ok {
			resp.Error(c, errs.ErrUnauthorized)
			c.Abort()
			return
		}

		credential, ok := CredentialFromContext(c)
		if !ok {
			resp.Error(c, errs.ErrUnauthorized)
			c.Abort()
			return
		}

		body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxSignedBody))
		if err != nil {
			resp.Error(c, errs.ErrInvalidJSON)
			c.Abort()
			return
		}
		// The handler still needs the body the signature was made over.
		c.Request.Body = io.NopCloser(bytes.NewReader(body))

		var envelope signedEnvelope
		if err := json.Unmarshal(body, &envelope); err != nil {
			resp.Error(c, errs.ErrInvalidJSON)
			c.Abort()
			return
		}

		if envelope.Signature == "" {
			resp.Error(c, domainsignature.ErrSignatureInvalid)
			c.Abort()
			return
		}

		secret, err := creds.SecretFor(c.Request.Context(), credential)
		if err != nil {
			resp.Error(c, err)
			c.Abort()
			return
		}

		if err := sigs.Verify(c.Request.Context(), merchant.ID, domainsignature.VerifyInput{
			Token:           envelope.Signature,
			SecretKey:       secret,
			MerchantCode:    envelope.MerchantID,
			ClientCode:      envelope.ClientID,
			BodyTimestampMS: envelope.Timestamp,
		}); err != nil {
			resp.Error(c, err)
			c.Abort()
			return
		}

		c.Set(string(consts.SignedBodyKey), body)

		c.Next()
	}
}

// SignedBodyFromContext returns the buffered body.
func SignedBodyFromContext(c *gin.Context) ([]byte, bool) {
	value, exists := c.Get(string(consts.SignedBodyKey))
	if !exists {
		return nil, false
	}
	body, ok := value.([]byte)

	return body, ok
}
```

- [ ] **Step 5: Run the tests**

Run: `go test ./internal/adapter/http/middleware/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/adapter/http/middleware/signature.go \
        internal/adapter/http/middleware/signature_test.go \
        internal/shared/consts/consts.go
git commit -m "feat(http): require a single-use signature on money-moving requests"
```

---

### Task 11: The idempotency guard

Nothing calls this in P1 — the deposit and payout endpoints that will are P3
and P4. It ships now because it belongs with the other request guards and its
table is already migrated, and because building it alongside the endpoint that
needs it is how a guard ends up shaped around one caller.

**Files:**
- Create: `internal/domain/idempotency/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/repository/idempotency/repository.go`
- Create: `internal/service/idempotency/service.go`
- Test: `internal/service/idempotency/service_test.go`

**Interfaces:**
- Consumes: `errs` sentinels, `crypto.SHA256`
- Produces:
  - `idempotency.Record{MerchantID, TransactionID, RequestHash, Status, ResponseCode, ResponseBody, CreatedAt, CompletedAt}`
  - `idempotency.Repository` with `Claim`, `Get`, `Complete`, `ExpireStale`
  - `idempotency.Service` with `Begin(ctx, merchantID uuid.UUID, transactionID string, body []byte) (*Replay, error)` and `Finish(ctx, merchantID uuid.UUID, transactionID string, code int, body []byte) error`
  - `idempotency.Replay{IsReplay bool; Code int; Body []byte}`
  - errors `ErrInFlight`, `ErrDifferentRequest`

- [ ] **Step 1: Write the domain files**

`internal/domain/idempotency/entity.go`:

```go
package idempotency

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusInFlight = "IN_FLIGHT"
	StatusDone     = "DONE"
)

// Record is one claimed transaction id.
type Record struct {
	MerchantID    uuid.UUID
	TransactionID string
	RequestHash   []byte
	Status        string
	ResponseCode  int
	ResponseBody  []byte
	CreatedAt     time.Time
	CompletedAt   time.Time
}
```

`internal/domain/idempotency/dto.go`:

```go
package idempotency

// Replay is what Begin tells its caller.
//
// IsReplay true means the work was already done and Code/Body are the answer
// to send. IsReplay false means this caller owns the transaction id and must
// call Finish.
type Replay struct {
	IsReplay bool
	Code     int
	Body     []byte
}
```

`internal/domain/idempotency/errors.go`:

```go
package idempotency

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	// ErrInFlight means an earlier request with this id has not finished. The
	// caller retries later rather than being made to wait: holding the
	// connection open would tie up a worker on both sides.
	ErrInFlight = fmt.Errorf("a request with this transaction id is still in flight: %w", errs.ErrConflict)

	// ErrDifferentRequest means the id was reused for a different payment,
	// which is a mistake in the caller's own bookkeeping.
	ErrDifferentRequest = fmt.Errorf("transaction id reused for a different request: %w", errs.ErrConflict)

	ErrTransactionIDRequired = fmt.Errorf("transaction_id is required: %w", errs.ErrInvalidInput)
)
```

`internal/domain/idempotency/repository.go`:

```go
package idempotency

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Repository interface {
	// Claim inserts an IN_FLIGHT row. It returns the existing record when the
	// id is already taken, so the caller can decide between replay, conflict
	// and in-flight without a second round trip.
	Claim(ctx context.Context, merchantID uuid.UUID, transactionID string, requestHash []byte) (*Record, error)
	Get(ctx context.Context, merchantID uuid.UUID, transactionID string) (*Record, error)
	Complete(ctx context.Context, merchantID uuid.UUID, transactionID string, code int, body []byte) error
	// ExpireStale finishes rows abandoned by a crashed request, so an id is
	// not blocked forever.
	ExpireStale(ctx context.Context, before time.Time) (int64, error)
}
```

`internal/domain/idempotency/service.go`:

```go
package idempotency

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	Begin(ctx context.Context, merchantID uuid.UUID, transactionID string, body []byte) (*Replay, error)
	Finish(ctx context.Context, merchantID uuid.UUID, transactionID string, code int, body []byte) error
}
```

`internal/domain/idempotency/validator.go`:

```go
package idempotency

import "strings"

func ValidateTransactionID(id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrTransactionIDRequired
	}
	return nil
}
```

- [ ] **Step 2: Write the repository**

`internal/adapter/repository/idempotency/repository.go`:

```go
package idempotency

import (
	"context"
	"time"

	"be-maxpay/internal/adapter/repository/base"
	domainidem "be-maxpay/internal/domain/idempotency"
	"be-maxpay/internal/shared/errs"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type record struct {
	MerchantID    uuid.UUID  `db:"merchant_id"`
	TransactionID string     `db:"transaction_id"`
	RequestHash   []byte     `db:"request_hash"`
	Status        string     `db:"status"`
	ResponseCode  *int       `db:"response_code"`
	ResponseBody  []byte     `db:"response_body"`
	CreatedAt     time.Time  `db:"created_at"`
	CompletedAt   *time.Time `db:"completed_at"`
}

func (r record) toDomain() *domainidem.Record {
	out := &domainidem.Record{
		MerchantID:    r.MerchantID,
		TransactionID: r.TransactionID,
		RequestHash:   r.RequestHash,
		Status:        r.Status,
		ResponseBody:  r.ResponseBody,
		CreatedAt:     r.CreatedAt,
	}
	if r.ResponseCode != nil {
		out.ResponseCode = *r.ResponseCode
	}
	if r.CompletedAt != nil {
		out.CompletedAt = *r.CompletedAt
	}

	return out
}

var columns = []string{
	"merchant_id", "transaction_id", "request_hash", "status",
	"response_code", "response_body", "created_at", "completed_at",
}

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domainidem.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

// Claim takes the id or reports who already holds it.
//
// ON CONFLICT DO NOTHING plus a RETURNING that yields no row is how "insert
// if absent, otherwise tell me what is there" is done in one statement.
// Splitting it into a SELECT and an INSERT reintroduces exactly the race the
// guard exists to close.
func (r *Repository) Claim(ctx context.Context, merchantID uuid.UUID, transactionID string, requestHash []byte) (*domainidem.Record, error) {
	const q = `
INSERT INTO idempotency_keys (merchant_id, transaction_id, request_hash, status)
VALUES ($1, $2, $3, 'IN_FLIGHT')
ON CONFLICT (merchant_id, transaction_id) DO NOTHING
RETURNING merchant_id, transaction_id, request_hash, status,
          response_code, response_body, created_at, completed_at`

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var claimed record
	err := r.DB.GetContext(ctx, &claimed, q, merchantID, transactionID, requestHash)
	if err == nil {
		return claimed.toDomain(), nil
	}
	if !r.IsNoRowsError(err) {
		return nil, errs.WrapDatabaseError(err, "claim transaction id")
	}

	// No row returned: someone else holds it. Read theirs.
	return r.Get(ctx, merchantID, transactionID)
}

func (r *Repository) Get(ctx context.Context, merchantID uuid.UUID, transactionID string) (*domainidem.Record, error) {
	sqlStr, args, err := r.Builder.Select(columns...).
		From("idempotency_keys").
		Where(squirrel.Eq{"merchant_id": merchantID, "transaction_id": transactionID}).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build get idempotency query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var found record
	if err := r.DB.GetContext(ctx, &found, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, errs.ErrRecordNotFound)
		}
		return nil, errs.WrapDatabaseError(err, "get idempotency record")
	}

	return found.toDomain(), nil
}

func (r *Repository) Complete(ctx context.Context, merchantID uuid.UUID, transactionID string, code int, body []byte) error {
	sqlStr, args, err := r.Builder.Update("idempotency_keys").
		SetMap(map[string]any{
			"status":        domainidem.StatusDone,
			"response_code": code,
			"response_body": body,
			"completed_at":  time.Now().UTC(),
		}).
		Where(squirrel.Eq{"merchant_id": merchantID, "transaction_id": transactionID}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build complete idempotency query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "complete idempotency record")
	}

	return r.CheckRowsAffected(result)
}

// ExpireStale marks abandoned claims DONE with a 500, so the id is usable
// again and the caller learns the earlier attempt did not finish.
func (r *Repository) ExpireStale(ctx context.Context, before time.Time) (int64, error) {
	sqlStr, args, err := r.Builder.Update("idempotency_keys").
		SetMap(map[string]any{
			"status":        domainidem.StatusDone,
			"response_code": 500,
			"completed_at":  time.Now().UTC(),
		}).
		Where(squirrel.And{
			squirrel.Eq{"status": domainidem.StatusInFlight},
			squirrel.Lt{"created_at": before},
		}).
		ToSql()
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "build expire idempotency query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "expire stale idempotency records")
	}

	return result.RowsAffected()
}
```

- [ ] **Step 3: Write the failing service test**

`internal/service/idempotency/service_test.go`:

```go
package idempotency_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	domainidem "be-maxpay/internal/domain/idempotency"
	idemsvc "be-maxpay/internal/service/idempotency"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	records map[string]*domainidem.Record
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{records: map[string]*domainidem.Record{}}
}

func key(id uuid.UUID, txn string) string { return id.String() + "|" + txn }

func (f *fakeRepo) Claim(_ context.Context, merchantID uuid.UUID, txn string, hash []byte) (*domainidem.Record, error) {
	if existing, ok := f.records[key(merchantID, txn)]; ok {
		return existing, nil
	}
	rec := &domainidem.Record{
		MerchantID: merchantID, TransactionID: txn, RequestHash: hash,
		Status: domainidem.StatusInFlight, CreatedAt: time.Now(),
	}
	f.records[key(merchantID, txn)] = rec
	return rec, nil
}

func (f *fakeRepo) Get(_ context.Context, merchantID uuid.UUID, txn string) (*domainidem.Record, error) {
	return f.records[key(merchantID, txn)], nil
}

func (f *fakeRepo) Complete(_ context.Context, merchantID uuid.UUID, txn string, code int, body []byte) error {
	rec := f.records[key(merchantID, txn)]
	rec.Status = domainidem.StatusDone
	rec.ResponseCode = code
	rec.ResponseBody = body
	return nil
}

func (f *fakeRepo) ExpireStale(context.Context, time.Time) (int64, error) { return 0, nil }

func TestIdempotencyService_Begin_FirstCallOwnsTheID(t *testing.T) {
	svc := idemsvc.NewService(newFakeRepo())

	got, err := svc.Begin(context.Background(), uuid.New(), "TXN-1", []byte(`{"amount":100}`))
	require.NoError(t, err)
	assert.False(t, got.IsReplay)
}

func TestIdempotencyService_Begin_ReplaysAFinishedRequest(t *testing.T) {
	repo := newFakeRepo()
	svc := idemsvc.NewService(repo)
	id := uuid.New()
	body := []byte(`{"amount":100}`)

	_, err := svc.Begin(context.Background(), id, "TXN-1", body)
	require.NoError(t, err)
	require.NoError(t, svc.Finish(context.Background(), id, "TXN-1", http.StatusOK, []byte(`{"ok":true}`)))

	got, err := svc.Begin(context.Background(), id, "TXN-1", body)
	require.NoError(t, err)
	assert.True(t, got.IsReplay)
	assert.Equal(t, http.StatusOK, got.Code)
	assert.JSONEq(t, `{"ok":true}`, string(got.Body))
}

func TestIdempotencyService_Begin_RefusesADifferentBodyUnderTheSameID(t *testing.T) {
	repo := newFakeRepo()
	svc := idemsvc.NewService(repo)
	id := uuid.New()

	_, err := svc.Begin(context.Background(), id, "TXN-1", []byte(`{"amount":100}`))
	require.NoError(t, err)
	require.NoError(t, svc.Finish(context.Background(), id, "TXN-1", http.StatusOK, []byte(`{}`)))

	_, err = svc.Begin(context.Background(), id, "TXN-1", []byte(`{"amount":999}`))
	require.ErrorIs(t, err, domainidem.ErrDifferentRequest)
}

func TestIdempotencyService_Begin_RefusesWhileStillInFlight(t *testing.T) {
	svc := idemsvc.NewService(newFakeRepo())
	id := uuid.New()
	body := []byte(`{"amount":100}`)

	_, err := svc.Begin(context.Background(), id, "TXN-1", body)
	require.NoError(t, err)

	_, err = svc.Begin(context.Background(), id, "TXN-1", body)
	require.ErrorIs(t, err, domainidem.ErrInFlight)
}

// The signature legitimately differs between an original and a retry; the
// payment being described does not. Hashing it would defeat the guard.
func TestIdempotencyService_Begin_IgnoresTheSignatureField(t *testing.T) {
	repo := newFakeRepo()
	svc := idemsvc.NewService(repo)
	id := uuid.New()

	first := []byte(`{"amount":100,"signature":"aaa","timestamp":1}`)
	_, err := svc.Begin(context.Background(), id, "TXN-1", first)
	require.NoError(t, err)
	require.NoError(t, svc.Finish(context.Background(), id, "TXN-1", http.StatusOK, []byte(`{}`)))

	retry := []byte(`{"amount":100,"signature":"bbb","timestamp":2}`)
	got, err := svc.Begin(context.Background(), id, "TXN-1", retry)
	require.NoError(t, err)
	assert.True(t, got.IsReplay)
}

func TestIdempotencyService_Begin_RequiresATransactionID(t *testing.T) {
	svc := idemsvc.NewService(newFakeRepo())

	_, err := svc.Begin(context.Background(), uuid.New(), "  ", []byte(`{}`))
	require.ErrorIs(t, err, domainidem.ErrTransactionIDRequired)
}

var _ = crypto.SHA256
```

- [ ] **Step 4: Run it and watch it fail**

Run: `go test ./internal/service/idempotency/ -v`
Expected: build failure — the service package does not exist.

- [ ] **Step 5: Write the service**

`internal/service/idempotency/service.go`:

```go
// Package idempotency stops one payment being made twice.
package idempotency

import (
	"bytes"
	"context"
	"encoding/json"

	domainidem "be-maxpay/internal/domain/idempotency"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
)

// volatileFields are removed before hashing. They differ between an original
// request and a legitimate retry of it while describing the same payment, so
// including them would make every retry look like a different request.
var volatileFields = []string{"signature", "timestamp"}

type Service struct {
	repo domainidem.Repository
}

func NewService(repo domainidem.Repository) *Service {
	return &Service{repo: repo}
}

// Begin claims the transaction id for this request.
func (s *Service) Begin(ctx context.Context, merchantID uuid.UUID, transactionID string, body []byte) (*domainidem.Replay, error) {
	if err := domainidem.ValidateTransactionID(transactionID); err != nil {
		return nil, err
	}

	hash, err := canonicalHash(body)
	if err != nil {
		return nil, err
	}

	existing, err := s.repo.Claim(ctx, merchantID, transactionID, hash)
	if err != nil {
		return nil, err
	}

	// A fresh claim comes back IN_FLIGHT with our own hash: we own it.
	if existing.Status == domainidem.StatusInFlight && bytes.Equal(existing.RequestHash, hash) && existing.ResponseCode == 0 && existing.CompletedAt.IsZero() {
		if isOurClaim(existing) {
			return &domainidem.Replay{}, nil
		}
	}

	if !bytes.Equal(existing.RequestHash, hash) {
		return nil, domainidem.ErrDifferentRequest
	}

	if existing.Status == domainidem.StatusInFlight {
		return nil, domainidem.ErrInFlight
	}

	return &domainidem.Replay{
		IsReplay: true,
		Code:     existing.ResponseCode,
		Body:     existing.ResponseBody,
	}, nil
}

// Finish records the answer so a later retry can be replayed.
func (s *Service) Finish(ctx context.Context, merchantID uuid.UUID, transactionID string, code int, body []byte) error {
	return s.repo.Complete(ctx, merchantID, transactionID, code, body)
}

// isOurClaim distinguishes the row this call inserted from one another call
// inserted a moment earlier. The repository returns the inserted row only when
// the insert won, so a returned IN_FLIGHT row with no response is ours.
func isOurClaim(r *domainidem.Record) bool {
	return r.Status == domainidem.StatusInFlight && r.ResponseCode == 0 && len(r.ResponseBody) == 0
}

// canonicalHash hashes the request with the volatile fields removed. Go's
// encoding/json marshals map keys in sorted order, so re-marshalling also
// removes key-order and whitespace differences between two encodings of the
// same request.
func canonicalHash(body []byte) ([]byte, error) {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		// Not an object: hash the bytes as they arrived rather than refusing.
		// Deciding what a request means is the handler's job, not the guard's.
		return crypto.SHA256(string(body)), nil
	}

	for _, field := range volatileFields {
		delete(parsed, field)
	}

	canonical, err := json.Marshal(parsed)
	if err != nil {
		return nil, err
	}

	return crypto.SHA256(string(canonical)), nil
}
```

- [ ] **Step 6: Run the tests**

Run: `go test ./internal/service/idempotency/ ./internal/adapter/repository/idempotency/ -v`
Expected: PASS, all six service tests.

- [ ] **Step 7: Commit**

```bash
git add internal/domain/idempotency internal/adapter/repository/idempotency \
        internal/service/idempotency
git commit -m "feat(idempotency): guard a transaction id against a second payment"
```

---

### Task 12: Back-office accounts and sessions

The spec's §5 lists admin auth as migration `000003`. This plan numbers it
`000005` instead: `admin_users.merchant_id` references `merchants`, and
credentials had to land before the middleware that uses them. The order
differs, the schema does not.

**Files:**
- Create: `db/migrations/000005_admin_auth.up.sql`
- Create: `db/migrations/000005_admin_auth.down.sql`
- Create: `internal/domain/adminuser/{entity,dto,errors,repository,service,validator}.go`
- Create: `internal/adapter/persistence/model/adminuser.go`
- Create: `internal/adapter/persistence/mapper/adminuser.go`
- Create: `internal/adapter/repository/adminuser/repository.go`
- Test: `internal/adapter/repository/adminuser/repository_test.go`

**Interfaces:**
- Consumes: `merchant.Merchant`, `base.BaseRepository`, `crypto.SHA256`
- Produces:
  - `adminuser.User{ID, Username, PasswordHash, Name, MerchantID, IsSuperadmin, Permissions, MustChangePassword, Status}`
  - `adminuser.Session{TokenHash, UserID, ExpiresAt}`
  - `adminuser.Repository` with `Create`, `GetByUsername`, `GetByID`, `ListForMerchant`, `SetPassword`, `CreateSession`, `GetSessionUser`, `DeleteSession`, `DeleteExpiredSessions`
  - errors `ErrUserNotFound`, `ErrUsernameExists`, `ErrInvalidCredentials`, `ErrUserDisabled`, `ErrSessionExpired`

- [ ] **Step 1: Write the migration**

`db/migrations/000005_admin_auth.up.sql`:

```sql
-- Platform staff and merchant users share this table. merchant_id is what
-- separates them: NULL is a platform admin, a value scopes every read to that
-- merchant's subtree.
CREATE TABLE admin_users (
    id                   UUID PRIMARY KEY DEFAULT uuidv7(),
    username             TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    name                 TEXT NOT NULL,
    merchant_id          UUID REFERENCES merchants(id) ON DELETE CASCADE,
    is_superadmin        BOOLEAN NOT NULL DEFAULT FALSE,
    permissions          TEXT[] NOT NULL DEFAULT '{}',
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    status               TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX admin_users_merchant ON admin_users (merchant_id);

-- Only the hash of a session token is stored, so a database read cannot be
-- replayed as a login.
CREATE TABLE admin_sessions (
    token_hash   BYTEA PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX admin_sessions_user ON admin_sessions (user_id);
CREATE INDEX admin_sessions_expiry ON admin_sessions (expires_at);

DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

`db/migrations/000005_admin_auth.down.sql`:

```sql
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS admin_users;
```

- [ ] **Step 2: Write the domain files**

`internal/domain/adminuser/entity.go`:

```go
package adminuser

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusActive   = "ACTIVE"
	StatusDisabled = "DISABLED"
)

// User is anyone who signs in to the back office.
//
// MerchantID is uuid.Nil for platform staff. For everyone else it is the root
// of what they may see: their own merchant and its downline, and nothing
// beside it.
type User struct {
	ID                 uuid.UUID
	Username           string
	PasswordHash       string
	Name               string
	MerchantID         uuid.UUID
	IsSuperadmin       bool
	Permissions        []string
	MustChangePassword bool
	Status             string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (u *User) IsActive() bool         { return u.Status == StatusActive }
func (u *User) IsPlatformAdmin() bool  { return u.MerchantID == uuid.Nil }

// Session is one signed-in browser.
type Session struct {
	TokenHash  []byte
	UserID     uuid.UUID
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
}
```

`internal/domain/adminuser/dto.go`:

```go
package adminuser

import "github.com/google/uuid"

type CreateData struct {
	Username     string
	Password     string
	Name         string
	MerchantID   uuid.UUID
	IsSuperadmin bool
	Permissions  []string
	// MustChangePassword is set for the temporary password a platform admin
	// hands to a merchant.
	MustChangePassword bool
}

// LoginResult is what the back office receives. Token is the plaintext session
// token and exists only in this response.
type LoginResult struct {
	Token string
	User  *User
}
```

`internal/domain/adminuser/errors.go`:

```go
package adminuser

import (
	"fmt"

	"be-maxpay/internal/shared/errs"
)

var (
	ErrUserNotFound   = fmt.Errorf("user not found: %w", errs.ErrNotFound)
	ErrUsernameExists = fmt.Errorf("username already exists: %w", errs.ErrConflict)

	// ErrInvalidCredentials covers an unknown username and a wrong password
	// alike. Telling them apart tells an attacker which usernames exist.
	ErrInvalidCredentials = fmt.Errorf("invalid username or password: %w", errs.ErrUnauthorized)
	ErrSessionExpired     = fmt.Errorf("session expired: %w", errs.ErrUnauthorized)
	ErrUserDisabled       = fmt.Errorf("account disabled: %w", errs.ErrForbidden)

	ErrUsernameRequired = fmt.Errorf("username is required: %w", errs.ErrInvalidInput)
	ErrPasswordTooShort = fmt.Errorf("password must be at least 12 characters: %w", errs.ErrInvalidInput)
	ErrNameRequired     = fmt.Errorf("name is required: %w", errs.ErrInvalidInput)
)
```

`internal/domain/adminuser/repository.go`:

```go
package adminuser

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Repository interface {
	Create(ctx context.Context, u *User) (*User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*User, error)
	GetByUsername(ctx context.Context, username string) (*User, error)
	ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*User, error)
	SetPassword(ctx context.Context, id uuid.UUID, hash string) error

	CreateSession(ctx context.Context, s *Session) error
	// GetSessionUser resolves a token hash to its user in one query, and
	// refuses an expired row rather than returning it for the caller to check.
	GetSessionUser(ctx context.Context, tokenHash []byte, now time.Time) (*User, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteExpiredSessions(ctx context.Context, before time.Time) (int64, error)
}
```

`internal/domain/adminuser/service.go`:

```go
package adminuser

import (
	"context"

	"github.com/google/uuid"
)

type Service interface {
	Create(ctx context.Context, data *CreateData) (*User, error)
	ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*User, error)
	Login(ctx context.Context, username, password string) (*LoginResult, error)
	Authenticate(ctx context.Context, token string) (*User, error)
	Logout(ctx context.Context, token string) error
	ChangePassword(ctx context.Context, id uuid.UUID, current, next string) error
}
```

`internal/domain/adminuser/validator.go`:

```go
package adminuser

import "strings"

// MinPasswordLength is deliberately long rather than complex: length is what
// makes a password expensive to guess, and a complexity rule mostly makes it
// harder to remember.
const MinPasswordLength = 12

func ValidateCreate(data *CreateData) error {
	if strings.TrimSpace(data.Username) == "" {
		return ErrUsernameRequired
	}
	if strings.TrimSpace(data.Name) == "" {
		return ErrNameRequired
	}

	return ValidatePassword(data.Password)
}

func ValidatePassword(password string) error {
	if len(password) < MinPasswordLength {
		return ErrPasswordTooShort
	}
	return nil
}
```

- [ ] **Step 3: Write the model and mapper**

`internal/adapter/persistence/model/adminuser.go`:

```go
package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

type AdminUser struct {
	ID                 uuid.UUID      `db:"id"`
	Username           string         `db:"username"`
	PasswordHash       string         `db:"password_hash"`
	Name               string         `db:"name"`
	MerchantID         uuid.NullUUID  `db:"merchant_id"`
	IsSuperadmin       bool           `db:"is_superadmin"`
	Permissions        pq.StringArray `db:"permissions"`
	MustChangePassword bool           `db:"must_change_password"`
	Status             string         `db:"status"`
	CreatedAt          time.Time      `db:"created_at"`
	UpdatedAt          time.Time      `db:"updated_at"`
}
```

`internal/adapter/persistence/mapper/adminuser.go`:

```go
package mapper

import (
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/domain/adminuser"

	"github.com/lib/pq"
)

func AdminUserToModel(u *adminuser.User) *model.AdminUser {
	if u == nil {
		return nil
	}
	return &model.AdminUser{
		ID: u.ID, Username: u.Username, PasswordHash: u.PasswordHash,
		Name: u.Name, MerchantID: nullUUID(u.MerchantID),
		IsSuperadmin: u.IsSuperadmin, Permissions: pq.StringArray(u.Permissions),
		MustChangePassword: u.MustChangePassword, Status: u.Status,
		CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt,
	}
}

func AdminUserToDomain(m *model.AdminUser) *adminuser.User {
	if m == nil {
		return nil
	}
	return &adminuser.User{
		ID: m.ID, Username: m.Username, PasswordHash: m.PasswordHash,
		Name: m.Name, MerchantID: m.MerchantID.UUID,
		IsSuperadmin: m.IsSuperadmin, Permissions: []string(m.Permissions),
		MustChangePassword: m.MustChangePassword, Status: m.Status,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

func AdminUsersToDomain(models []*model.AdminUser) []*adminuser.User {
	out := make([]*adminuser.User, 0, len(models))
	for _, m := range models {
		out = append(out, AdminUserToDomain(m))
	}
	return out
}
```

`pq.StringArray` is the only reason `github.com/lib/pq` enters the module. It
is used purely as a `sql.Scanner`/`driver.Valuer` for `TEXT[]`; the driver
stays `pgx`.

- [ ] **Step 4: Write the failing repository test**

`internal/adapter/repository/adminuser/repository_test.go`:

```go
package adminuser_test

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	adminrepo "be-maxpay/internal/adapter/repository/adminuser"
	domainadmin "be-maxpay/internal/domain/adminuser"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newRepo(t *testing.T) (domainadmin.Repository, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	return adminrepo.NewRepository(sqlx.NewDb(db, "sqlmock")), mock
}

func userRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "username", "password_hash", "name", "merchant_id",
		"is_superadmin", "permissions", "must_change_password", "status",
		"created_at", "updated_at",
	}).AddRow(uuid.New(), "admin", "$argon2id$...", "Admin", nil,
		true, pq.StringArray{"merchants:read"}, false, "ACTIVE",
		time.Now(), time.Now())
}

func TestAdminUserRepository_GetByUsername_Success(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(`FROM admin_users WHERE username = $1`)).
		WithArgs("admin").
		WillReturnRows(userRows())

	got, err := repo.GetByUsername(context.Background(), "admin")
	require.NoError(t, err)
	assert.True(t, got.IsPlatformAdmin())
	assert.Equal(t, []string{"merchants:read"}, got.Permissions)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAdminUserRepository_GetByUsername_NotFound(t *testing.T) {
	repo, mock := newRepo(t)

	mock.ExpectQuery(regexp.QuoteMeta(`FROM admin_users WHERE username = $1`)).
		WithArgs("ghost").
		WillReturnError(sql.ErrNoRows)

	_, err := repo.GetByUsername(context.Background(), "ghost")
	require.ErrorIs(t, err, domainadmin.ErrUserNotFound)
	require.NoError(t, mock.ExpectationsWereMet())
}

// An expired row must not come back for the caller to check: one forgotten
// comparison and a dead session keeps working.
func TestAdminUserRepository_GetSessionUser_ExpiredIsNotFound(t *testing.T) {
	repo, mock := newRepo(t)
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(`JOIN admin_sessions`)).
		WithArgs([]byte("hash"), now).
		WillReturnError(sql.ErrNoRows)

	_, err := repo.GetSessionUser(context.Background(), []byte("hash"), now)
	require.ErrorIs(t, err, domainadmin.ErrSessionExpired)
	require.NoError(t, mock.ExpectationsWereMet())
}
```

- [ ] **Step 5: Run it and watch it fail**

```bash
go get github.com/lib/pq
go test ./internal/adapter/repository/adminuser/ -v
```

Expected: build failure — the repository package does not exist.

- [ ] **Step 6: Write the repository**

`internal/adapter/repository/adminuser/repository.go`:

```go
package adminuser

import (
	"context"
	"time"

	"be-maxpay/internal/adapter/persistence/mapper"
	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/adapter/repository/base"
	domainadmin "be-maxpay/internal/domain/adminuser"
	"be-maxpay/internal/shared/errs"
	"be-maxpay/internal/shared/id"

	"github.com/Masterminds/squirrel"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

var userColumns = []string{
	"id", "username", "password_hash", "name", "merchant_id",
	"is_superadmin", "permissions", "must_change_password", "status",
	"created_at", "updated_at",
}

type Repository struct {
	*base.BaseRepository
}

func NewRepository(db *sqlx.DB) domainadmin.Repository {
	return &Repository{BaseRepository: base.NewBaseRepository(db)}
}

func (r *Repository) Create(ctx context.Context, u *domainadmin.User) (*domainadmin.User, error) {
	now := time.Now().UTC()

	var merchantID any
	if u.MerchantID != uuid.Nil {
		merchantID = u.MerchantID
	}

	sqlStr, args, err := r.Builder.Insert("admin_users").
		Columns("id", "username", "password_hash", "name", "merchant_id",
			"is_superadmin", "permissions", "must_change_password", "status",
			"created_at", "updated_at").
		Values(id.New(), u.Username, u.PasswordHash, u.Name, merchantID,
			u.IsSuperadmin, pq.StringArray(u.Permissions), u.MustChangePassword,
			domainadmin.StatusActive, now, now).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build create admin user query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		if errs.IsDuplicateError(err) {
			return nil, domainadmin.ErrUsernameExists
		}
		return nil, errs.WrapDatabaseError(err, "create admin user")
	}

	return r.GetByUsername(ctx, u.Username)
}

func (r *Repository) GetByID(ctx context.Context, uid uuid.UUID) (*domainadmin.User, error) {
	return r.getOne(ctx, squirrel.Eq{"id": uid}, "get admin user by id")
}

func (r *Repository) GetByUsername(ctx context.Context, username string) (*domainadmin.User, error) {
	return r.getOne(ctx, squirrel.Eq{"username": username}, "get admin user by username")
}

func (r *Repository) getOne(ctx context.Context, where squirrel.Sqlizer, label string) (*domainadmin.User, error) {
	sqlStr, args, err := r.Builder.Select(userColumns...).
		From("admin_users").
		Where(where).
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build "+label+" query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.AdminUser
	if err := r.DB.GetContext(ctx, &m, sqlStr, args...); err != nil {
		if r.IsNoRowsError(err) {
			return nil, r.MapNotFound(err, domainadmin.ErrUserNotFound)
		}
		return nil, errs.WrapDatabaseError(err, label)
	}

	return mapper.AdminUserToDomain(&m), nil
}

func (r *Repository) ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*domainadmin.User, error) {
	sqlStr, args, err := r.Builder.Select(userColumns...).
		From("admin_users").
		Where(squirrel.Eq{"merchant_id": merchantID}).
		OrderBy("created_at ASC").
		ToSql()
	if err != nil {
		return nil, errs.WrapDatabaseError(err, "build list admin users query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var models []*model.AdminUser
	if err := r.DB.SelectContext(ctx, &models, sqlStr, args...); err != nil {
		return nil, errs.WrapDatabaseError(err, "list admin users")
	}

	return mapper.AdminUsersToDomain(models), nil
}

func (r *Repository) SetPassword(ctx context.Context, uid uuid.UUID, hash string) error {
	sqlStr, args, err := r.Builder.Update("admin_users").
		SetMap(map[string]any{
			"password_hash":        hash,
			"must_change_password": false,
		}).
		Where(squirrel.Eq{"id": uid}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build set password query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return errs.WrapDatabaseError(err, "set password")
	}

	return r.CheckRowsAffectedWith(result, domainadmin.ErrUserNotFound)
}

func (r *Repository) CreateSession(ctx context.Context, s *domainadmin.Session) error {
	sqlStr, args, err := r.Builder.Insert("admin_sessions").
		Columns("token_hash", "user_id", "expires_at").
		Values(s.TokenHash, s.UserID, s.ExpiresAt).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build create session query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		return errs.WrapDatabaseError(err, "create session")
	}

	return nil
}

// GetSessionUser resolves a token to its user, refusing an expired row in the
// query rather than returning it. A comparison the caller has to remember is a
// comparison somebody eventually forgets.
func (r *Repository) GetSessionUser(ctx context.Context, tokenHash []byte, now time.Time) (*domainadmin.User, error) {
	const q = `
SELECT u.id, u.username, u.password_hash, u.name, u.merchant_id,
       u.is_superadmin, u.permissions, u.must_change_password, u.status,
       u.created_at, u.updated_at
  FROM admin_users u
  JOIN admin_sessions s ON s.user_id = u.id
 WHERE s.token_hash = $1 AND s.expires_at > $2`

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	var m model.AdminUser
	if err := r.DB.GetContext(ctx, &m, q, tokenHash, now); err != nil {
		if r.IsNoRowsError(err) {
			return nil, domainadmin.ErrSessionExpired
		}
		return nil, errs.WrapDatabaseError(err, "get session user")
	}

	return mapper.AdminUserToDomain(&m), nil
}

func (r *Repository) DeleteSession(ctx context.Context, tokenHash []byte) error {
	sqlStr, args, err := r.Builder.Delete("admin_sessions").
		Where(squirrel.Eq{"token_hash": tokenHash}).
		ToSql()
	if err != nil {
		return errs.WrapDatabaseError(err, "build delete session query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	if _, err := r.DB.ExecContext(ctx, sqlStr, args...); err != nil {
		return errs.WrapDatabaseError(err, "delete session")
	}

	return nil
}

func (r *Repository) DeleteExpiredSessions(ctx context.Context, before time.Time) (int64, error) {
	sqlStr, args, err := r.Builder.Delete("admin_sessions").
		Where(squirrel.Lt{"expires_at": before}).
		ToSql()
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "build delete expired sessions query")
	}

	ctx, cancel := r.WithTimeout(ctx)
	defer cancel()

	result, err := r.DB.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return 0, errs.WrapDatabaseError(err, "delete expired sessions")
	}

	return result.RowsAffected()
}
```

- [ ] **Step 7: Run the tests and the migration**

```bash
go test ./internal/adapter/repository/adminuser/ ./internal/adapter/persistence/... -v
make migrate-up
docker exec be-maxpay-postgres-1 psql -U postgres -d maxpay -c '\d admin_users'
```

Expected: PASS, both tables present.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/000005_admin_auth.*.sql internal/domain/adminuser \
        internal/adapter/persistence/model/adminuser.go \
        internal/adapter/persistence/mapper/adminuser.go \
        internal/adapter/repository/adminuser go.mod go.sum
git commit -m "feat(adminuser): add back-office accounts and opaque sessions"
```

---

### Task 13: The back-office authentication service

**Files:**
- Create: `internal/service/adminuser/service.go`
- Test: `internal/service/adminuser/service_test.go`

**Interfaces:**
- Consumes: `adminuser.Repository`, `crypto.HashPassword`, `crypto.VerifyPassword`, `crypto.NewOpaqueToken`, `crypto.SHA256`
- Produces: `adminusersvc.NewService(repo adminuser.Repository, sessionTTL time.Duration) *Service` satisfying `adminuser.Service`

- [ ] **Step 1: Write the failing tests**

`internal/service/adminuser/service_test.go`:

```go
package adminuser_test

import (
	"context"
	"testing"
	"time"

	domainadmin "be-maxpay/internal/domain/adminuser"
	adminsvc "be-maxpay/internal/service/adminuser"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	byUsername map[string]*domainadmin.User
	byID       map[uuid.UUID]*domainadmin.User
	sessions   map[string]*domainadmin.Session
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		byUsername: map[string]*domainadmin.User{},
		byID:       map[uuid.UUID]*domainadmin.User{},
		sessions:   map[string]*domainadmin.Session{},
	}
}

func (f *fakeRepo) Create(_ context.Context, u *domainadmin.User) (*domainadmin.User, error) {
	if _, exists := f.byUsername[u.Username]; exists {
		return nil, domainadmin.ErrUsernameExists
	}
	u.ID = uuid.New()
	u.Status = domainadmin.StatusActive
	f.byUsername[u.Username] = u
	f.byID[u.ID] = u
	return u, nil
}

func (f *fakeRepo) GetByID(_ context.Context, id uuid.UUID) (*domainadmin.User, error) {
	u, ok := f.byID[id]
	if !ok {
		return nil, domainadmin.ErrUserNotFound
	}
	return u, nil
}

func (f *fakeRepo) GetByUsername(_ context.Context, username string) (*domainadmin.User, error) {
	u, ok := f.byUsername[username]
	if !ok {
		return nil, domainadmin.ErrUserNotFound
	}
	return u, nil
}

func (f *fakeRepo) ListForMerchant(context.Context, uuid.UUID) ([]*domainadmin.User, error) {
	return nil, nil
}

func (f *fakeRepo) SetPassword(_ context.Context, id uuid.UUID, hash string) error {
	u, ok := f.byID[id]
	if !ok {
		return domainadmin.ErrUserNotFound
	}
	u.PasswordHash = hash
	u.MustChangePassword = false
	return nil
}

func (f *fakeRepo) CreateSession(_ context.Context, s *domainadmin.Session) error {
	f.sessions[string(s.TokenHash)] = s
	return nil
}

func (f *fakeRepo) GetSessionUser(_ context.Context, hash []byte, now time.Time) (*domainadmin.User, error) {
	s, ok := f.sessions[string(hash)]
	if !ok || !s.ExpiresAt.After(now) {
		return nil, domainadmin.ErrSessionExpired
	}
	return f.byID[s.UserID], nil
}

func (f *fakeRepo) DeleteSession(_ context.Context, hash []byte) error {
	delete(f.sessions, string(hash))
	return nil
}

func (f *fakeRepo) DeleteExpiredSessions(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func newService(repo domainadmin.Repository) *adminsvc.Service {
	return adminsvc.NewService(repo, 12*time.Hour)
}

func seedUser(t *testing.T, svc *adminsvc.Service, username, password string) *domainadmin.User {
	t.Helper()

	u, err := svc.Create(context.Background(), &domainadmin.CreateData{
		Username: username, Password: password, Name: "Test User",
	})
	require.NoError(t, err)

	return u
}

func TestAdminUserService_Create_StoresAHashNotThePassword(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(repo)

	u := seedUser(t, svc, "admin", "a-long-enough-password")

	assert.NotContains(t, u.PasswordHash, "a-long-enough-password")
	assert.True(t, crypto.VerifyPassword(u.PasswordHash, "a-long-enough-password"))
}

func TestAdminUserService_Create_RefusesAShortPassword(t *testing.T) {
	svc := newService(newFakeRepo())

	_, err := svc.Create(context.Background(), &domainadmin.CreateData{
		Username: "admin", Password: "short", Name: "Test",
	})

	require.ErrorIs(t, err, domainadmin.ErrPasswordTooShort)
}

func TestAdminUserService_Login_IssuesAToken(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(repo)
	seedUser(t, svc, "admin", "a-long-enough-password")

	got, err := svc.Login(context.Background(), "admin", "a-long-enough-password")
	require.NoError(t, err)
	assert.NotEmpty(t, got.Token)

	_, stored := repo.sessions[string(crypto.SHA256(got.Token))]
	assert.True(t, stored, "only the hash of the token is stored")
}

func TestAdminUserService_Login_SaysTheSameThingForBothFailures(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(repo)
	seedUser(t, svc, "admin", "a-long-enough-password")

	_, wrongPassword := svc.Login(context.Background(), "admin", "not-the-password")
	_, unknownUser := svc.Login(context.Background(), "ghost", "a-long-enough-password")

	require.ErrorIs(t, wrongPassword, domainadmin.ErrInvalidCredentials)
	require.ErrorIs(t, unknownUser, domainadmin.ErrInvalidCredentials)
}

func TestAdminUserService_Login_RefusesADisabledAccount(t *testing.T) {
	repo := newFakeRepo()
	svc := newService(repo)
	u := seedUser(t, svc, "admin", "a-long-enough-password")
	repo.byID[u.ID].Status = domainadmin.StatusDisabled

	_, err := svc.Login(context.Background(), "admin", "a-long-enough-password")
	require.ErrorIs(t, err, domainadmin.ErrUserDisabled)
}

func TestAdminUserService_Authenticate_RoundTripsALogin(t *testing.T) {
	svc := newService(newFakeRepo())
	seedUser(t, svc, "admin", "a-long-enough-password")

	login, err := svc.Login(context.Background(), "admin", "a-long-enough-password")
	require.NoError(t, err)

	got, err := svc.Authenticate(context.Background(), login.Token)
	require.NoError(t, err)
	assert.Equal(t, "admin", got.Username)
}

func TestAdminUserService_Logout_InvalidatesTheToken(t *testing.T) {
	svc := newService(newFakeRepo())
	seedUser(t, svc, "admin", "a-long-enough-password")

	login, err := svc.Login(context.Background(), "admin", "a-long-enough-password")
	require.NoError(t, err)
	require.NoError(t, svc.Logout(context.Background(), login.Token))

	_, err = svc.Authenticate(context.Background(), login.Token)
	require.ErrorIs(t, err, domainadmin.ErrSessionExpired)
}

func TestAdminUserService_ChangePassword_RequiresTheCurrentOne(t *testing.T) {
	svc := newService(newFakeRepo())
	u := seedUser(t, svc, "admin", "a-long-enough-password")

	err := svc.ChangePassword(context.Background(), u.ID, "wrong", "another-long-password")
	require.ErrorIs(t, err, domainadmin.ErrInvalidCredentials)

	require.NoError(t, svc.ChangePassword(context.Background(), u.ID, "a-long-enough-password", "another-long-password"))

	_, err = svc.Login(context.Background(), "admin", "another-long-password")
	require.NoError(t, err)
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./internal/service/adminuser/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the service**

`internal/service/adminuser/service.go`:

```go
// Package adminuser implements back-office sign-in.
package adminuser

import (
	"context"
	"errors"
	"time"

	domainadmin "be-maxpay/internal/domain/adminuser"
	"be-maxpay/internal/shared/crypto"

	"github.com/google/uuid"
)

type Service struct {
	repo       domainadmin.Repository
	sessionTTL time.Duration
}

func NewService(repo domainadmin.Repository, sessionTTL time.Duration) *Service {
	return &Service{repo: repo, sessionTTL: sessionTTL}
}

func (s *Service) Create(ctx context.Context, data *domainadmin.CreateData) (*domainadmin.User, error) {
	if err := domainadmin.ValidateCreate(data); err != nil {
		return nil, err
	}

	hash, err := crypto.HashPassword(data.Password)
	if err != nil {
		return nil, err
	}

	return s.repo.Create(ctx, &domainadmin.User{
		Username:           data.Username,
		PasswordHash:       hash,
		Name:               data.Name,
		MerchantID:         data.MerchantID,
		IsSuperadmin:       data.IsSuperadmin,
		Permissions:        data.Permissions,
		MustChangePassword: data.MustChangePassword,
		Status:             domainadmin.StatusActive,
	})
}

func (s *Service) ListForMerchant(ctx context.Context, merchantID uuid.UUID) ([]*domainadmin.User, error) {
	return s.repo.ListForMerchant(ctx, merchantID)
}

// Login verifies a password and opens a session.
//
// An unknown username and a wrong password produce the same error on purpose:
// distinguishing them turns the login form into a way to enumerate accounts.
func (s *Service) Login(ctx context.Context, username, password string) (*domainadmin.LoginResult, error) {
	user, err := s.repo.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, domainadmin.ErrUserNotFound) {
			return nil, domainadmin.ErrInvalidCredentials
		}
		return nil, err
	}

	if !crypto.VerifyPassword(user.PasswordHash, password) {
		return nil, domainadmin.ErrInvalidCredentials
	}

	// Checked after the password, so a disabled account is not revealed to
	// someone who does not already have its password.
	if !user.IsActive() {
		return nil, domainadmin.ErrUserDisabled
	}

	token, err := crypto.NewOpaqueToken()
	if err != nil {
		return nil, err
	}

	if err := s.repo.CreateSession(ctx, &domainadmin.Session{
		TokenHash: crypto.SHA256(token),
		UserID:    user.ID,
		ExpiresAt: time.Now().UTC().Add(s.sessionTTL),
	}); err != nil {
		return nil, err
	}

	return &domainadmin.LoginResult{Token: token, User: user}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (*domainadmin.User, error) {
	user, err := s.repo.GetSessionUser(ctx, crypto.SHA256(token), time.Now().UTC())
	if err != nil {
		return nil, err
	}

	if !user.IsActive() {
		return nil, domainadmin.ErrUserDisabled
	}

	return user, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	return s.repo.DeleteSession(ctx, crypto.SHA256(token))
}

func (s *Service) ChangePassword(ctx context.Context, uid uuid.UUID, current, next string) error {
	user, err := s.repo.GetByID(ctx, uid)
	if err != nil {
		return err
	}

	if !crypto.VerifyPassword(user.PasswordHash, current) {
		return domainadmin.ErrInvalidCredentials
	}

	if err := domainadmin.ValidatePassword(next); err != nil {
		return err
	}

	hash, err := crypto.HashPassword(next)
	if err != nil {
		return err
	}

	return s.repo.SetPassword(ctx, uid, hash)
}
```

- [ ] **Step 4: Run the tests**

Run: `go test ./internal/service/adminuser/ -v`
Expected: PASS, all eight tests.

- [ ] **Step 5: Commit**

```bash
git add internal/service/adminuser
git commit -m "feat(adminuser): sign in, sign out and change a password"
```

---

### Task 14: The `/auth/*` endpoints

This is the task that makes `bo-maxpay` sign in. Its BFF already calls these
three paths and gets 404.

**Files:**
- Create: `internal/adapter/http/middleware/session.go`
- Create: `internal/adapter/http/auth/{handler,handlers,routes,dto}.go`
- Create: `internal/adapter/http/auth/handlers_test.go`
- Create: `bruno/Auth/{Login,Me,Logout,Change password}.bru`, `bruno/Auth/folder.bru`
- Modify: `internal/adapter/http/routing/groups.go`
- Modify: `bruno/environments/local.bru`

**Interfaces:**
- Consumes: `adminuser.Service`, `resp`, `middleware`
- Produces:
  - `middleware.SessionAuth(users adminuser.Service) gin.HandlerFunc`
  - `middleware.UserFromContext(c *gin.Context) (*adminuser.User, bool)`
  - `routing.AdminGroup(r *gin.Engine, users adminuser.Service) *gin.RouterGroup`
  - `auth.RegisterRoutes(p auth.RouteParams)`
  - `consts.AdminUserKey`

- [ ] **Step 1: Write the session middleware**

Add `AdminUserKey ContextKey = "admin_user"` to `internal/shared/consts/consts.go`, then
`internal/adapter/http/middleware/session.go`:

```go
package middleware

import (
	"strings"

	"be-maxpay/internal/adapter/http/resp"
	domainadmin "be-maxpay/internal/domain/adminuser"
	"be-maxpay/internal/shared/consts"
	"be-maxpay/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

// SessionAuth admits a request carrying a live back-office session.
//
// The token arrives as a bearer header rather than a cookie: the browser never
// holds it, because bo-maxpay's BFF keeps it in an httpOnly cookie on its own
// side and forwards it from the server.
func SessionAuth(users domainadmin.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c.GetHeader("Authorization"))
		if token == "" {
			resp.Error(c, errs.ErrUnauthorized)
			c.Abort()
			return
		}

		user, err := users.Authenticate(c.Request.Context(), token)
		if err != nil {
			resp.Error(c, err)
			c.Abort()
			return
		}

		c.Set(string(consts.AdminUserKey), user)

		c.Next()
	}
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}

	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

// UserFromContext returns the signed-in back-office user.
func UserFromContext(c *gin.Context) (*domainadmin.User, bool) {
	value, exists := c.Get(string(consts.AdminUserKey))
	if !exists {
		return nil, false
	}
	u, ok := value.(*domainadmin.User)

	return u, ok
}
```

- [ ] **Step 2: Add the route group**

Append to `internal/adapter/http/routing/groups.go`:

```go
// AdminGroup is the session-protected back-office root. It deliberately does
// not sit under APIGroup: a back-office user signs in with a password, not
// with the machine-to-machine key that guards /devices.
func AdminGroup(r *gin.Engine, users domainadmin.Service) *gin.RouterGroup {
	g := r.Group("/api/v1")
	g.Use(middleware.SessionAuth(users))

	return g
}

// PublicAuthGroup holds the endpoints that must be reachable without a
// session, because they are how a session is obtained.
func PublicAuthGroup(r *gin.Engine) *gin.RouterGroup {
	return r.Group("/api/v1/auth")
}
```

Add `domainadmin "be-maxpay/internal/domain/adminuser"` to that file's imports.

- [ ] **Step 3: Write the DTOs**

`internal/adapter/http/auth/dto.go`:

```go
package auth

import (
	domainadmin "be-maxpay/internal/domain/adminuser"
)

type loginRequest struct {
	Username string `json:"username" validate:"required,min=1,max=100"`
	Password string `json:"password" validate:"required,min=8,max=128"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required,min=8,max=128"`
	NewPassword     string `json:"new_password" validate:"required,min=12,max=128"`
}

// accountResponse is the shape bo-maxpay already reads. Changing a field name
// here means changing bo-maxpay/src/hooks/use-auth.ts in the same commit.
type accountResponse struct {
	ID                 string   `json:"id"`
	Username           string   `json:"username"`
	Name               string   `json:"name"`
	IsSuperadmin       bool     `json:"is_superadmin"`
	Permissions        []string `json:"permissions"`
	MerchantID         string   `json:"merchant_id,omitempty"`
	MustChangePassword bool     `json:"must_change_password"`
}

type loginResponse struct {
	Token   string          `json:"token"`
	Account accountResponse `json:"account"`
}

func toAccountResponse(u *domainadmin.User) accountResponse {
	out := accountResponse{
		ID:                 u.ID.String(),
		Username:           u.Username,
		Name:               u.Name,
		IsSuperadmin:       u.IsSuperadmin,
		Permissions:        u.Permissions,
		MustChangePassword: u.MustChangePassword,
	}
	if !u.IsPlatformAdmin() {
		out.MerchantID = u.MerchantID.String()
	}
	// A nil slice marshals to null; the back office expects an array.
	if out.Permissions == nil {
		out.Permissions = []string{}
	}

	return out
}
```

- [ ] **Step 4: Write the handler and routes**

`internal/adapter/http/auth/handler.go`:

```go
package auth

import (
	domainadmin "be-maxpay/internal/domain/adminuser"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	users domainadmin.Service
	v     *validator.Validate
}

func NewHandler(users domainadmin.Service, v *validator.Validate) *Handler {
	return &Handler{users: users, v: v}
}
```

`internal/adapter/http/auth/handlers.go`:

```go
package auth

import (
	"net/http"
	"strings"

	"be-maxpay/internal/adapter/http/middleware"
	"be-maxpay/internal/adapter/http/resp"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/errs"

	"github.com/gin-gonic/gin"
)

func (h *Handler) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	result, err := h.users.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, loginResponse{
		Token:   result.Token,
		Account: toAccountResponse(result.User),
	})
}

func (h *Handler) me(c *gin.Context) {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return
	}

	resp.Success(c, toAccountResponse(user))
}

func (h *Handler) logout(c *gin.Context) {
	token := strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
	if token == "" {
		resp.Error(c, errs.ErrUnauthorized)
		return
	}

	if err := h.users.Logout(c.Request.Context(), token); err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, gin.H{"logged_out": true})
}

func (h *Handler) changePassword(c *gin.Context) {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return
	}

	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	if err := h.users.ChangePassword(c.Request.Context(), user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, gin.H{"changed": true})
}
```

`internal/adapter/http/auth/routes.go`:

```go
package auth

import (
	"be-maxpay/internal/adapter/http/routing"
	domainadmin "be-maxpay/internal/domain/adminuser"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router *gin.Engine
	Users  domainadmin.Service
	V      *validator.Validate
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Users, p.V)

	// login is public: it is how a session is obtained.
	routing.PublicAuthGroup(p.Router).POST("/login", h.login)

	authed := routing.AdminGroup(p.Router, p.Users).Group("/auth")
	{
		authed.GET("/me", h.me)
		authed.POST("/logout", h.logout)
		authed.POST("/change-password", h.changePassword)
	}
}
```

- [ ] **Step 5: Write the handler test**

`internal/adapter/http/auth/handlers_test.go`:

```go
package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	authhttp "be-maxpay/internal/adapter/http/auth"
	domainadmin "be-maxpay/internal/domain/adminuser"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubUsers struct {
	loginErr error
	user     *domainadmin.User
	authErr  error
}

func (s stubUsers) Create(context.Context, *domainadmin.CreateData) (*domainadmin.User, error) {
	return nil, nil
}
func (s stubUsers) ListForMerchant(context.Context, uuid.UUID) ([]*domainadmin.User, error) {
	return nil, nil
}
func (s stubUsers) Login(context.Context, string, string) (*domainadmin.LoginResult, error) {
	if s.loginErr != nil {
		return nil, s.loginErr
	}
	return &domainadmin.LoginResult{Token: "opaque-token", User: s.user}, nil
}
func (s stubUsers) Authenticate(context.Context, string) (*domainadmin.User, error) {
	return s.user, s.authErr
}
func (s stubUsers) Logout(context.Context, string) error { return nil }
func (s stubUsers) ChangePassword(context.Context, uuid.UUID, string, string) error {
	return nil
}

func testUser() *domainadmin.User {
	return &domainadmin.User{
		ID: uuid.New(), Username: "admin", Name: "Admin",
		IsSuperadmin: true, Status: domainadmin.StatusActive,
	}
}

func newRouter(users domainadmin.Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	authhttp.RegisterRoutes(authhttp.RouteParams{
		Router: r, Users: users, V: validator.New(),
	})
	return r
}

func TestLogin_ReturnsTheShapeTheBackOfficeReads(t *testing.T) {
	r := newRouter(stubUsers{user: testUser()})

	body, err := json.Marshal(map[string]string{"username": "admin", "password": "a-long-password"})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)

	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Token   string `json:"token"`
			Account struct {
				ID           string   `json:"id"`
				Username     string   `json:"username"`
				Name         string   `json:"name"`
				IsSuperadmin bool     `json:"is_superadmin"`
				Permissions  []string `json:"permissions"`
			} `json:"account"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))

	assert.True(t, envelope.Success)
	assert.Equal(t, "opaque-token", envelope.Data.Token)
	assert.Equal(t, "admin", envelope.Data.Account.Username)
	assert.NotNil(t, envelope.Data.Account.Permissions, "an empty permission list must be [] and not null")
}

func TestLogin_BadCredentialsAre401(t *testing.T) {
	r := newRouter(stubUsers{loginErr: domainadmin.ErrInvalidCredentials})

	body := []byte(`{"username":"admin","password":"a-long-password"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMe_RequiresASession(t *testing.T) {
	r := newRouter(stubUsers{user: testUser()})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMe_ReturnsTheAccount(t *testing.T) {
	r := newRouter(stubUsers{user: testUser()})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer opaque-token")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"username":"admin"`)
}
```

- [ ] **Step 6: Run the tests**

Run: `go test ./internal/adapter/http/... -v`
Expected: PASS.

- [ ] **Step 7: Add the Bruno requests**

`bruno/Auth/folder.bru`:

```
meta {
  name: Auth
  seq: 1
}
```

`bruno/Auth/Login.bru`:

```
meta {
  name: Login
  type: http
  seq: 1
}

post {
  url: {{API_URL}}/auth/login
  body: json
  auth: none
}

body:json {
  {
    "username": "admin",
    "password": "change-me-please"
  }
}

script:post-response {
  if (res.getStatus() === 200) {
    bru.setEnvVar("SESSION_TOKEN", res.getBody().data.token);
  }
}

docs {
  Signs in a back-office user and stores the session token in SESSION_TOKEN
  for the other requests in this folder.
}
```

`bruno/Auth/Me.bru`:

```
meta {
  name: Me
  type: http
  seq: 2
}

get {
  url: {{API_URL}}/auth/me
  body: none
  auth: none
}

headers {
  Authorization: Bearer {{SESSION_TOKEN}}
}
```

`bruno/Auth/Logout.bru`:

```
meta {
  name: Logout
  type: http
  seq: 3
}

post {
  url: {{API_URL}}/auth/logout
  body: none
  auth: none
}

headers {
  Authorization: Bearer {{SESSION_TOKEN}}
}
```

`bruno/Auth/Change password.bru`:

```
meta {
  name: Change password
  type: http
  seq: 4
}

post {
  url: {{API_URL}}/auth/change-password
  body: json
  auth: none
}

headers {
  Authorization: Bearer {{SESSION_TOKEN}}
}

body:json {
  {
    "current_password": "change-me-please",
    "new_password": "a-much-longer-password"
  }
}
```

Add `SESSION_TOKEN: ` to the `vars` block in `bruno/environments/local.bru`.

- [ ] **Step 8: Commit**

```bash
git add internal/adapter/http/middleware/session.go internal/adapter/http/auth \
        internal/adapter/http/routing/groups.go internal/shared/consts/consts.go \
        bruno/Auth bruno/environments/local.bru
git commit -m "feat(auth): add back-office sign-in, /me, sign-out and password change"
```

---

### Task 15: The `/admin/merchants/*` endpoints

**Files:**
- Create: `internal/adapter/http/adminmerchant/{handler,handlers,routes,dto,scope}.go`
- Create: `internal/adapter/http/adminmerchant/scope_test.go`
- Create: `internal/adapter/http/adminmerchant/handlers_test.go`
- Create: `bruno/Merchants/*.bru`

**Interfaces:**
- Consumes: `merchant.Service`, `credential.Service`, `adminuser.Service`, `middleware.UserFromContext`
- Produces: `adminmerchant.RegisterRoutes(p RouteParams)`, `adminmerchant.VisibleRoot(user *adminuser.User) uuid.UUID`, `adminmerchant.EnsureVisible(ctx, merchants merchant.Service, user *adminuser.User, target uuid.UUID) error`

- [ ] **Step 1: Write the failing scope test**

`internal/adapter/http/adminmerchant/scope_test.go`:

```go
package adminmerchant_test

import (
	"context"
	"testing"

	"be-maxpay/internal/adapter/http/adminmerchant"
	domainadmin "be-maxpay/internal/domain/adminuser"
	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubMerchants struct {
	subtree []*domainmerchant.Merchant
}

func (s stubMerchants) Create(context.Context, uuid.UUID, *domainmerchant.CreateData) (*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) GetByID(context.Context, uuid.UUID) (*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) GetByCode(context.Context, string) (*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) ListSubtree(context.Context, uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return s.subtree, nil
}
func (s stubMerchants) Ancestors(context.Context, uuid.UUID) ([]*domainmerchant.Merchant, error) {
	return nil, nil
}
func (s stubMerchants) Update(context.Context, uuid.UUID, *domainmerchant.UpdateData) (*domainmerchant.Merchant, error) {
	return nil, nil
}

func TestVisibleRoot_PlatformAdminHasNoRoot(t *testing.T) {
	got := adminmerchant.VisibleRoot(&domainadmin.User{})
	assert.Equal(t, uuid.Nil, got, "a platform admin is not scoped to a subtree")
}

func TestVisibleRoot_MerchantUserIsScopedToItsOwnMerchant(t *testing.T) {
	id := uuid.New()
	got := adminmerchant.VisibleRoot(&domainadmin.User{MerchantID: id})
	assert.Equal(t, id, got)
}

func TestEnsureVisible_PlatformAdminSeesAnything(t *testing.T) {
	err := adminmerchant.EnsureVisible(context.Background(), stubMerchants{},
		&domainadmin.User{}, uuid.New())
	require.NoError(t, err)
}

func TestEnsureVisible_MerchantUserSeesItsOwnDownline(t *testing.T) {
	self, child := uuid.New(), uuid.New()
	merchants := stubMerchants{subtree: []*domainmerchant.Merchant{{ID: self}, {ID: child}}}

	require.NoError(t, adminmerchant.EnsureVisible(context.Background(), merchants,
		&domainadmin.User{MerchantID: self}, child))
}

func TestEnsureVisible_MerchantUserCannotSeeASibling(t *testing.T) {
	self, sibling := uuid.New(), uuid.New()
	merchants := stubMerchants{subtree: []*domainmerchant.Merchant{{ID: self}}}

	err := adminmerchant.EnsureVisible(context.Background(), merchants,
		&domainadmin.User{MerchantID: self}, sibling)

	require.ErrorIs(t, err, errs.ErrForbidden)
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `go test ./internal/adapter/http/adminmerchant/ -v`
Expected: build failure — the package does not exist.

- [ ] **Step 3: Write the scope helper**

`internal/adapter/http/adminmerchant/scope.go`:

```go
// Package adminmerchant serves the back office's merchant screens.
package adminmerchant

import (
	"context"

	domainadmin "be-maxpay/internal/domain/adminuser"
	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared/errs"

	"github.com/google/uuid"
)

// VisibleRoot is the top of what a user may read. uuid.Nil means unscoped,
// which only a platform admin is.
func VisibleRoot(user *domainadmin.User) uuid.UUID {
	if user.IsPlatformAdmin() {
		return uuid.Nil
	}

	return user.MerchantID
}

// EnsureVisible refuses a merchant outside the caller's subtree.
//
// This is the one check every merchant-addressed endpoint has to make, and
// P3 through P7 keep adding them. It is a named function rather than three
// lines copied into each handler so that a missing check is visible as a
// missing call.
func EnsureVisible(ctx context.Context, merchants domainmerchant.Service, user *domainadmin.User, target uuid.UUID) error {
	root := VisibleRoot(user)
	if root == uuid.Nil {
		return nil
	}

	subtree, err := merchants.ListSubtree(ctx, root)
	if err != nil {
		return err
	}

	for _, m := range subtree {
		if m.ID == target {
			return nil
		}
	}

	// Forbidden rather than not-found: the caller is authenticated and the
	// merchant exists. Pretending otherwise would be a lie that makes a
	// support conversation longer, and the id was already known to whoever
	// asked.
	return errs.ErrForbidden
}
```

- [ ] **Step 4: Write the DTOs**

`internal/adapter/http/adminmerchant/dto.go`:

```go
package adminmerchant

import (
	"time"

	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"
)

type createMerchantRequest struct {
	ParentID    string `json:"parent_id" validate:"omitempty,uuid4"`
	Name        string `json:"name" validate:"required,min=1,max=200"`
	Role        string `json:"role" validate:"required,oneof=ROOT RESELLER DIRECT"`
	PoolModel   string `json:"pool_model" validate:"required,oneof=SHARED DEDICATED"`
	ClusterID   string `json:"cluster_id" validate:"omitempty,uuid4"`
	DepositRate string `json:"deposit_rate" validate:"required"`
	PayoutRate  string `json:"payout_rate" validate:"required"`
}

type updateMerchantRequest struct {
	Name        string `json:"name" validate:"omitempty,max=200"`
	PoolModel   string `json:"pool_model" validate:"omitempty,oneof=SHARED DEDICATED"`
	ClusterID   string `json:"cluster_id" validate:"omitempty,uuid4"`
	DepositRate string `json:"deposit_rate"`
	PayoutRate  string `json:"payout_rate"`
	Status      string `json:"status" validate:"omitempty,oneof=ACTIVE SUSPENDED"`
}

type createUserRequest struct {
	Username string `json:"username" validate:"required,min=3,max=100"`
	Name     string `json:"name" validate:"required,min=1,max=200"`
	Password string `json:"password" validate:"required,min=12,max=128"`
}

type merchantResponse struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	ParentID    string `json:"parent_id,omitempty"`
	Role        string `json:"role"`
	Depth       int    `json:"depth"`
	PoolModel   string `json:"pool_model"`
	ClusterID   string `json:"cluster_id,omitempty"`
	DepositRate string `json:"deposit_rate"`
	PayoutRate  string `json:"payout_rate"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func toMerchantResponse(m *domainmerchant.Merchant) merchantResponse {
	out := merchantResponse{
		ID: m.ID.String(), Code: m.Code, Name: m.Name,
		Role: string(m.Role), Depth: m.Depth, PoolModel: string(m.PoolModel),
		DepositRate: m.DepositRate.String(),
		PayoutRate:  m.PayoutRate.String(),
		Status:      m.Status,
		CreatedAt:   m.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   m.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if !isNil(m.ParentID) {
		out.ParentID = m.ParentID.String()
	}
	if !isNil(m.ClusterID) {
		out.ClusterID = m.ClusterID.String()
	}

	return out
}

func toMerchantResponses(ms []*domainmerchant.Merchant) []merchantResponse {
	out := make([]merchantResponse, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMerchantResponse(m))
	}
	return out
}

// issuedKeyResponse is the only time the plaintext key and secret are ever
// returned. Nothing reads them back afterwards, so the response says so.
type issuedKeyResponse struct {
	CredentialID string `json:"credential_id"`
	APIKey       string `json:"api_key"`
	SecretKey    string `json:"secret_key"`
	Prefix       string `json:"prefix"`
	Notice       string `json:"notice"`
}

// credentialResponse deliberately omits the key and the sealed secret.
type credentialResponse struct {
	ID         string `json:"id"`
	Prefix     string `json:"prefix"`
	Status     string `json:"status"`
	LastUsedAt string `json:"last_used_at,omitempty"`
	CreatedAt  string `json:"created_at"`
}

func toCredentialResponse(c *domaincredential.Credential) credentialResponse {
	out := credentialResponse{
		ID: c.ID.String(), Prefix: c.APIKeyPrefix, Status: c.Status,
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
	}
	if !c.LastUsedAt.IsZero() {
		out.LastUsedAt = c.LastUsedAt.UTC().Format(time.RFC3339)
	}

	return out
}

func toCredentialResponses(cs []*domaincredential.Credential) []credentialResponse {
	out := make([]credentialResponse, 0, len(cs))
	for _, c := range cs {
		out = append(out, toCredentialResponse(c))
	}
	return out
}
```

`github.com/google/uuid` has no `IsNil` method, so `dto.go` carries this
helper and imports `github.com/google/uuid`:

```go
func isNil(u uuid.UUID) bool { return u == uuid.Nil }
```

- [ ] **Step 5: Write the handler, handlers and routes**

`internal/adapter/http/adminmerchant/handler.go`:

```go
package adminmerchant

import (
	domainadmin "be-maxpay/internal/domain/adminuser"
	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"

	"github.com/go-playground/validator/v10"
)

type Handler struct {
	merchants domainmerchant.Service
	creds     domaincredential.Service
	users     domainadmin.Service
	v         *validator.Validate
}

func NewHandler(
	merchants domainmerchant.Service,
	creds domaincredential.Service,
	users domainadmin.Service,
	v *validator.Validate,
) *Handler {
	return &Handler{merchants: merchants, creds: creds, users: users, v: v}
}
```

`internal/adapter/http/adminmerchant/handlers.go`:

```go
package adminmerchant

import (
	"net/http"

	"be-maxpay/internal/adapter/http/middleware"
	"be-maxpay/internal/adapter/http/resp"
	domainadmin "be-maxpay/internal/domain/adminuser"
	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"
	"be-maxpay/internal/shared"
	"be-maxpay/internal/shared/errs"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// list returns the caller's whole visible tree. A platform admin gets every
// merchant by starting from the root.
func (h *Handler) list(c *gin.Context) {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return
	}

	root := VisibleRoot(user)
	if root == uuid.Nil {
		rootMerchant, err := h.merchants.GetByCode(c.Request.Context(), c.Query("root_code"))
		if err != nil {
			// No root_code given, or an unknown one: fall back to the whole
			// table by walking from the single ROOT row.
			all, listErr := h.merchants.ListSubtree(c.Request.Context(), uuid.Nil)
			if listErr != nil {
				resp.Error(c, listErr)
				return
			}
			resp.Success(c, toMerchantResponses(all))
			return
		}
		root = rootMerchant.ID
	}

	merchants, err := h.merchants.ListSubtree(c.Request.Context(), root)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toMerchantResponses(merchants))
}

func (h *Handler) get(c *gin.Context) {
	user, target, ok := h.scoped(c)
	if !ok {
		return
	}
	_ = user

	m, err := h.merchants.GetByID(c.Request.Context(), target)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toMerchantResponse(m))
}

func (h *Handler) create(c *gin.Context) {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return
	}

	var req createMerchantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	parentID, err := parseOptionalUUID(req.ParentID)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	// A reseller may only create under itself or its own downline.
	if parentID != uuid.Nil {
		if err := EnsureVisible(c.Request.Context(), h.merchants, user, parentID); err != nil {
			resp.Error(c, err)
			return
		}
	} else if !user.IsPlatformAdmin() {
		resp.Error(c, errs.ErrForbidden)
		return
	}

	deposit, err := decimal.NewFromString(req.DepositRate)
	if err != nil {
		resp.Error(c, domainmerchant.ErrRateOutOfRange)
		return
	}
	payout, err := decimal.NewFromString(req.PayoutRate)
	if err != nil {
		resp.Error(c, domainmerchant.ErrRateOutOfRange)
		return
	}

	clusterID, err := parseOptionalUUID(req.ClusterID)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	created, err := h.merchants.Create(c.Request.Context(), parentID, &domainmerchant.CreateData{
		Name:        req.Name,
		Role:        domainmerchant.Role(req.Role),
		PoolModel:   domainmerchant.PoolModel(req.PoolModel),
		ClusterID:   clusterID,
		DepositRate: deposit,
		PayoutRate:  payout,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, toMerchantResponse(created))
}

func (h *Handler) update(c *gin.Context) {
	_, target, ok := h.scoped(c)
	if !ok {
		return
	}

	var req updateMerchantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	data := &domainmerchant.UpdateData{
		Name:      req.Name,
		PoolModel: domainmerchant.PoolModel(req.PoolModel),
		Status:    req.Status,
	}

	clusterID, err := parseOptionalUUID(req.ClusterID)
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}
	data.ClusterID = clusterID

	if req.DepositRate != "" {
		rate, rateErr := decimal.NewFromString(req.DepositRate)
		if rateErr != nil {
			resp.Error(c, domainmerchant.ErrRateOutOfRange)
			return
		}
		data.DepositRate = &rate
	}
	if req.PayoutRate != "" {
		rate, rateErr := decimal.NewFromString(req.PayoutRate)
		if rateErr != nil {
			resp.Error(c, domainmerchant.ErrRateOutOfRange)
			return
		}
		data.PayoutRate = &rate
	}

	updated, err := h.merchants.Update(c.Request.Context(), target, data)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toMerchantResponse(updated))
}

func (h *Handler) listCredentials(c *gin.Context) {
	_, target, ok := h.scoped(c)
	if !ok {
		return
	}

	credentials, err := h.creds.ListKeys(c.Request.Context(), target)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, toCredentialResponses(credentials))
}

func (h *Handler) issueCredential(c *gin.Context) {
	_, target, ok := h.scoped(c)
	if !ok {
		return
	}

	issued, err := h.creds.IssueKey(c.Request.Context(), target)
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, issuedKeyResponse{
		CredentialID: issued.CredentialID.String(),
		APIKey:       issued.APIKey,
		SecretKey:    issued.SecretKey,
		Prefix:       issued.Prefix,
		Notice:       "Store these now. Neither value can be read again.",
	})
}

func (h *Handler) revokeCredential(c *gin.Context) {
	_, _, ok := h.scoped(c)
	if !ok {
		return
	}

	credentialID, err := uuid.Parse(c.Param("credential_id"))
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	if err := h.creds.RevokeKey(c.Request.Context(), credentialID); err != nil {
		resp.Error(c, err)
		return
	}

	resp.Success(c, gin.H{"revoked": true})
}

func (h *Handler) createClient(c *gin.Context) {
	_, target, ok := h.scoped(c)
	if !ok {
		return
	}

	var req struct {
		Label string `json:"label" validate:"required,min=1,max=200"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	client, err := h.creds.IssueClient(c.Request.Context(), &domaincredential.CreateClientData{
		MerchantID: target, Label: req.Label,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, gin.H{"client_id": client.Code, "label": client.Label})
}

// createUser issues a back-office login for a merchant. Platform admins only:
// letting a reseller mint logins for its downline would put a password reset
// for someone else's business in its hands.
func (h *Handler) createUser(c *gin.Context) {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return
	}
	if !user.IsPlatformAdmin() {
		resp.Error(c, errs.ErrForbidden)
		return
	}

	target, err := uuid.Parse(c.Param("id"))
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return
	}

	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, errs.ErrInvalidJSON)
		return
	}
	if err := h.v.Struct(req); err != nil {
		resp.ErrorWithMessage(c, http.StatusBadRequest, shared.FormatValidationErrorsToString(err))
		return
	}

	created, err := h.users.Create(c.Request.Context(), &domainadmin.CreateData{
		Username:           req.Username,
		Password:           req.Password,
		Name:               req.Name,
		MerchantID:         target,
		MustChangePassword: true,
	})
	if err != nil {
		resp.Error(c, err)
		return
	}

	resp.Created(c, gin.H{
		"id":                   created.ID.String(),
		"username":             created.Username,
		"must_change_password": created.MustChangePassword,
	})
}

// scoped resolves the :id parameter and refuses one outside the caller's tree.
// It writes the error response itself; a false second return means stop.
func (h *Handler) scoped(c *gin.Context) (*domainadmin.User, uuid.UUID, bool) {
	user, ok := middleware.UserFromContext(c)
	if !ok {
		resp.Error(c, errs.ErrUnauthorized)
		return nil, uuid.Nil, false
	}

	target, err := uuid.Parse(c.Param("id"))
	if err != nil {
		resp.Error(c, errs.ErrInvalidInput)
		return nil, uuid.Nil, false
	}

	if err := EnsureVisible(c.Request.Context(), h.merchants, user, target); err != nil {
		resp.Error(c, err)
		return nil, uuid.Nil, false
	}

	return user, target, true
}

func parseOptionalUUID(s string) (uuid.UUID, error) {
	if s == "" {
		return uuid.Nil, nil
	}

	return uuid.Parse(s)
}
```

`internal/adapter/http/adminmerchant/routes.go`:

```go
package adminmerchant

import (
	"be-maxpay/internal/adapter/http/routing"
	domainadmin "be-maxpay/internal/domain/adminuser"
	domaincredential "be-maxpay/internal/domain/credential"
	domainmerchant "be-maxpay/internal/domain/merchant"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"go.uber.org/fx"
)

type RouteParams struct {
	fx.In

	Router    *gin.Engine
	Merchants domainmerchant.Service
	Creds     domaincredential.Service
	Users     domainadmin.Service
	V         *validator.Validate
}

func RegisterRoutes(p RouteParams) {
	h := NewHandler(p.Merchants, p.Creds, p.Users, p.V)

	merchants := routing.AdminGroup(p.Router, p.Users).Group("/admin/merchants")
	{
		merchants.GET("", h.list)
		merchants.POST("", h.create)
		merchants.GET("/:id", h.get)
		merchants.PATCH("/:id", h.update)
		merchants.POST("/:id/clients", h.createClient)
		merchants.GET("/:id/credentials", h.listCredentials)
		merchants.POST("/:id/credentials", h.issueCredential)
		merchants.DELETE("/:id/credentials/:credential_id", h.revokeCredential)
		merchants.POST("/:id/users", h.createUser)
	}
}
```

- [ ] **Step 6: Write the handler test**

`internal/adapter/http/adminmerchant/handlers_test.go`:

```go
package adminmerchant_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"be-maxpay/internal/adapter/http/adminmerchant"
	"be-maxpay/internal/adapter/http/middleware"
	domainadmin "be-maxpay/internal/domain/adminuser"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// routerAs builds a router with the given user already on the context, so the
// scope rules can be exercised without a real session.
func routerAs(user *domainadmin.User, merchants stubMerchants) *gin.Engine {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("admin_user", user)
		c.Next()
	})
	h := adminmerchant.NewHandler(merchants, nil, nil, validator.New())
	r.GET("/admin/merchants/:id", func(c *gin.Context) {
		// Exercised through the exported helper: the handler methods are
		// unexported, and this asserts the rule rather than the plumbing.
		if err := adminmerchant.EnsureVisible(c.Request.Context(), merchants, user, uuid.MustParse(c.Param("id"))); err != nil {
			c.Status(http.StatusForbidden)
			return
		}
		c.Status(http.StatusOK)
	})
	_ = h

	return r
}

func TestAdminMerchant_AMerchantUserCannotReadASibling(t *testing.T) {
	self, sibling := uuid.New(), uuid.New()
	user := &domainadmin.User{MerchantID: self}
	r := routerAs(user, stubMerchants{subtree: nil})

	req := httptest.NewRequest(http.MethodGet, "/admin/merchants/"+sibling.String(), bytes.NewReader(nil))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestAdminMerchant_UserFromContextKeyMatchesTheMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	want := &domainadmin.User{Username: "admin"}
	c.Set("admin_user", want)

	got, ok := middleware.UserFromContext(c)
	require.True(t, ok, "the literal used in tests must match consts.AdminUserKey")
	assert.Equal(t, want, got)
}
```

- [ ] **Step 7: Run the tests**

Run: `go test ./internal/adapter/http/... -v`
Expected: PASS.

- [ ] **Step 8: Add the Bruno requests**

Create `bruno/Merchants/folder.bru` with `name: Merchants`, `seq: 2`, and one
`.bru` per route, each carrying `Authorization: Bearer {{SESSION_TOKEN}}`:
`List.bru` (GET `{{API_URL}}/admin/merchants`), `Create.bru`, `Get.bru`,
`Update.bru`, `Create client.bru`, `List credentials.bru`,
`Issue credential.bru`, `Revoke credential.bru`, `Create user.bru`.

`Create.bru` body:

```
body:json {
  {
    "parent_id": "{{RESELLER_ID}}",
    "name": "Acme Betting",
    "role": "DIRECT",
    "pool_model": "SHARED",
    "deposit_rate": "0.0150",
    "payout_rate": "0.0150"
  }
}
```

`Issue credential.bru` needs a post-response script, because the secret is
returned once:

```
script:post-response {
  if (res.getStatus() === 201) {
    bru.setEnvVar("MERCHANT_API_KEY", res.getBody().data.api_key);
    bru.setEnvVar("MERCHANT_SECRET_KEY", res.getBody().data.secret_key);
  }
}
```

Add `RESELLER_ID: `, `MERCHANT_ID: `, `MERCHANT_API_KEY: ` and
`MERCHANT_SECRET_KEY: ` to `bruno/environments/local.bru`.

- [ ] **Step 9: Commit**

```bash
git add internal/adapter/http/adminmerchant bruno/Merchants bruno/environments/local.bru
git commit -m "feat(admin): manage merchants, credentials and merchant logins"
```

---

### Task 16: Wire it up and prove it end to end

**Files:**
- Modify: `internal/adapter/repository/module.go`
- Modify: `internal/service/module.go`
- Modify: `internal/adapter/http/module.go`
- Modify: `internal/shared/module.go`
- Create: `scripts/seed_root/main.go`
- Modify: `Makefile`
- Modify: `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above
- Produces: a running service where a merchant can be created and a signed request accepted

- [ ] **Step 1: Provide the secret box**

In `internal/shared/module.go`, add a constructor so fx can inject
`*crypto.SecretBox`:

```go
// NewSecretBox fails startup when the KEK is unusable. A gateway that boots
// without being able to read its merchants' signing secrets would accept
// every request and reject every signature, which is worse than not booting.
func NewSecretBox(cfg *Config) (*crypto.SecretBox, error) {
	return crypto.NewSecretBox(cfg.Security.KEK)
}
```

Add `NewSecretBox` to that module's `fx.Provide` list, and import
`be-maxpay/internal/shared/crypto`.

- [ ] **Step 2: Register the repositories**

In `internal/adapter/repository/module.go`, add to `fx.Provide`:

```go
		fx.Annotate(merchantrepo.NewRepository, fx.As(new(merchant.Repository))),
		fx.Annotate(credentialrepo.NewRepository, fx.As(new(credential.Repository))),
		fx.Annotate(signaturerepo.NewRepository, fx.As(new(signature.Repository))),
		fx.Annotate(idempotencyrepo.NewRepository, fx.As(new(idempotency.Repository))),
		fx.Annotate(adminuserrepo.NewRepository, fx.As(new(adminuser.Repository))),
```

- [ ] **Step 3: Register the services**

In `internal/service/module.go`, add to `fx.Provide`:

```go
		fx.Annotate(merchantsvc.NewService, fx.As(new(merchant.Service))),
		fx.Annotate(credentialsvc.NewService, fx.As(new(credential.Service))),
		fx.Annotate(idempotencysvc.NewService, fx.As(new(idempotency.Service))),
		fx.Annotate(NewSignatureService, fx.As(new(signature.Service))),
		fx.Annotate(NewAdminUserService, fx.As(new(adminuser.Service))),
```

The last two take durations from config rather than plain dependencies, so add
adapters in the same file:

```go
// NewSignatureService reads the window from config. fx has no way to inject a
// bare time.Duration unambiguously -- there would be two of them -- so the
// config read happens here instead of through an annotated parameter.
func NewSignatureService(repo signature.Repository, cfg *shared.Config) *signaturesvc.Service {
	return signaturesvc.NewService(repo, cfg.Security.SignatureTTL, cfg.Security.ClockSkew)
}

func NewAdminUserService(repo adminuser.Repository, cfg *shared.Config) *adminusersvc.Service {
	return adminusersvc.NewService(repo, cfg.Security.SessionTTL)
}
```

- [ ] **Step 4: Register the routes**

In `internal/adapter/http/module.go`, add to the `fx.Invoke` list:

```go
		authhttp.RegisterRoutes,
		adminmerchanthttp.RegisterRoutes,
```

with imports `authhttp "be-maxpay/internal/adapter/http/auth"` and
`adminmerchanthttp "be-maxpay/internal/adapter/http/adminmerchant"`.

Also add `Authorization` is already in the CORS allow-list; no change needed
there.

- [ ] **Step 5: Write the seed script**

A fresh database has no root merchant and no way to sign in, so nothing above
can be exercised.

`scripts/seed_root/main.go`:

```go
// Command seed_root creates the single ROOT merchant and the first platform
// administrator. It is safe to re-run: both inserts are skipped when the row
// already exists.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"be-maxpay/internal/adapter/persistence/model"
	"be-maxpay/internal/shared/crypto"
	"be-maxpay/internal/shared/id"

	"github.com/jmoiron/sqlx"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/lib/pq"
)

func main() {
	dsn := flag.String("dsn", "", "PostgreSQL DSN")
	username := flag.String("username", "admin", "platform administrator username")
	password := flag.String("password", "", "platform administrator password (min 12 chars)")
	rate := flag.String("rate", "0.0050", "root cost rate, as a fraction")
	flag.Parse()

	if *dsn == "" || len(*password) < 12 {
		log.Fatal("dsn is required and password must be at least 12 characters")
	}

	db, err := sqlx.Connect("pgx", *dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx := context.Background()

	var rootID string
	err = db.GetContext(ctx, &rootID, `SELECT id::text FROM merchants WHERE role = 'ROOT'`)
	if err != nil {
		rootID = id.NewString()
		if _, insertErr := db.ExecContext(ctx, `
			INSERT INTO merchants (id, code, name, role, depth, pool_model, deposit_rate, payout_rate, status)
			VALUES ($1, $2, 'House', 'ROOT', 0, 'SHARED', $3, $3, 'ACTIVE')`,
			rootID, mustCode(), *rate); insertErr != nil {
			log.Fatalf("insert root merchant: %v", insertErr)
		}
		fmt.Printf("created root merchant %s\n", rootID)
	} else {
		fmt.Printf("root merchant already exists: %s\n", rootID)
	}

	var existing string
	if err := db.GetContext(ctx, &existing, `SELECT id::text FROM admin_users WHERE username = $1`, *username); err == nil {
		fmt.Printf("admin user %q already exists\n", *username)
		os.Exit(0)
	}

	hash, err := crypto.HashPassword(*password)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO admin_users (id, username, password_hash, name, is_superadmin, permissions, status)
		VALUES ($1, $2, $3, 'Platform Administrator', TRUE, $4, 'ACTIVE')`,
		id.New(), *username, hash, pq.StringArray{}); err != nil {
		log.Fatalf("insert admin user: %v", err)
	}

	fmt.Printf("created platform administrator %q\n", *username)

	var _ model.AdminUser
}

func mustCode() string {
	code, err := crypto.RandomCode(10)
	if err != nil {
		log.Fatalf("generate code: %v", err)
	}
	return code
}
```

Add to the `Makefile`, beside `import-sqlite`:

```makefile
# Creates the ROOT merchant and the first platform administrator.
# Safe to re-run.
ADMIN_USERNAME ?= admin
ADMIN_PASSWORD ?= change-me-please

seed-root:
	go run ./scripts/seed_root -dsn "$(DATABASE_URL)" \
		-username "$(ADMIN_USERNAME)" -password "$(ADMIN_PASSWORD)"
```

and add `seed-root` to the `.PHONY` list.

- [ ] **Step 6: Run the whole gate**

```bash
go mod tidy
make check
```

Expected: `tidy-check`, `vet`, `build`, `lint` and `test-race` all pass.

- [ ] **Step 7: Prove it end to end against a real database**

```bash
make docker-up
make migrate-up
make seed-root

go run ./cmd/app &
sleep 3

# 1. sign in
TOKEN=$(curl -s -X POST http://localhost:8091/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me-please"}' | jq -r .data.token)
echo "token: ${TOKEN:0:8}..."

# 2. read the account back
curl -s http://localhost:8091/api/v1/auth/me -H "Authorization: Bearer $TOKEN" | jq .

# 3. list the tree (the root, so far)
ROOT_ID=$(curl -s http://localhost:8091/api/v1/admin/merchants \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

# 4. create a reseller and a direct merchant beneath it
RESELLER_ID=$(curl -s -X POST http://localhost:8091/api/v1/admin/merchants \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"parent_id\":\"$ROOT_ID\",\"name\":\"Reseller One\",\"role\":\"RESELLER\",\"pool_model\":\"SHARED\",\"deposit_rate\":\"0.0070\",\"payout_rate\":\"0.0070\"}" \
  | jq -r .data.id)

MERCHANT_ID=$(curl -s -X POST http://localhost:8091/api/v1/admin/merchants \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"parent_id\":\"$RESELLER_ID\",\"name\":\"Acme\",\"role\":\"DIRECT\",\"pool_model\":\"SHARED\",\"deposit_rate\":\"0.0150\",\"payout_rate\":\"0.0150\"}" \
  | jq -r .data.id)

# 5. the rate rule must refuse a merchant cheaper than its parent
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8091/api/v1/admin/merchants \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"parent_id\":\"$RESELLER_ID\",\"name\":\"Too cheap\",\"role\":\"DIRECT\",\"pool_model\":\"SHARED\",\"deposit_rate\":\"0.0010\",\"payout_rate\":\"0.0150\"}"

# 6. the two-level rule must refuse a child of a DIRECT merchant
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8091/api/v1/admin/merchants \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"parent_id\":\"$MERCHANT_ID\",\"name\":\"Sub\",\"role\":\"DIRECT\",\"pool_model\":\"SHARED\",\"deposit_rate\":\"0.0200\",\"payout_rate\":\"0.0200\"}"

# 7. issue a key
curl -s -X POST "http://localhost:8091/api/v1/admin/merchants/$MERCHANT_ID/credentials" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: step 5 prints `409` (`ErrRateBelowParent`), step 6 prints `409`
(`ErrDirectCannotHaveChildren`), and step 7 returns the key, the secret and
the notice exactly once.

- [ ] **Step 8: Prove the back office signs in**

```bash
cd ../bo-maxpay && npm run dev
```

Open `http://localhost:3005/auth/login`, sign in as `admin` /
`change-me-please`. Expected: the dashboard renders and the sidebar shows the
signed-in name — the 404 recorded in `bo-maxpay/README.md` is gone.

Remove the "Status" section from `bo-maxpay/README.md` in the same commit,
since it no longer describes the system.

- [ ] **Step 9: Update the documentation**

In `be-maxpay/README.md`, add a Gateway section listing the new endpoints, the
`security` config block, and `make seed-root`.

In `AGENTS.md`, add to *Money-Flow Rules*:

```markdown
- Every request that creates a deposit or a payout must pass through
  `middleware.SignatureRequired` **and** claim its `transactionId` through
  `idempotency.Service.Begin` before any bank call. The bank has no
  idempotency key of its own, so this is the only thing standing between a
  retried request and a second payment.
- Merchant-scoped reads go through `adminmerchant.EnsureVisible`. A handler
  that resolves a merchant id without calling it is a data leak, not a style
  problem.
```

- [ ] **Step 10: Commit**

```bash
git add internal/adapter/repository/module.go internal/service/module.go \
        internal/adapter/http/module.go internal/shared/module.go \
        scripts/seed_root Makefile README.md AGENTS.md ../bo-maxpay/README.md
git commit -m "feat: wire the merchant and security foundation into the app"
```

---

## Plan Self-Review

Run against the spec after the plan is written, before execution starts.

**Spec coverage.** Every P1 requirement in
`docs/superpowers/specs/2026-08-26-maxpay-merchant-ledger-design.md` maps to a
task: §4.1 merchant tree → Tasks 3–5; §4.2 credentials → Tasks 6–7; §4.3
back-office accounts, the visibility table and the recursive CTE → Tasks 12–15;
§4.4 request guards → Tasks 9 and 11; §6 signature algorithm → Task 9; §7
idempotency algorithm → Task 11; §10 configuration → Task 2; §11 HTTP surface
→ Tasks 14–15; §12 error contract and the 422 → Task 1; §13 unit testing →
throughout. §4.5–§4.7, §8 and §9 are P2 and are deliberately absent.

**Known deviations from the spec, both deliberate:**

1. Migration numbering. The spec's §5 orders admin auth as `000003`; this plan
   makes it `000005` because credentials had to land before the middleware
   that consumes them. The schema is identical.
2. The spec does not mention a seed script. Task 16 adds one, because a fresh
   database has no root merchant and no way to sign in, which would leave the
   whole phase unverifiable.

**Not covered here, by design:** the integration harness the spec's §13 calls
for. Three of its four cases (the deferred constraint trigger, the partial
unique index on `deposits`, and concurrent payout debits) test P2 objects that
do not exist yet, and the fourth (`FOR UPDATE SKIP LOCKED`) tests the outbox,
also P2. The harness is Task 1 of the P2 plan. The two database guarantees P1
does rely on — the single-root index and the `used_signatures` primary key —
are verified by hand in Task 3 Step 8 and Task 9 Step 8 against a real
PostgreSQL.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task
N". Every code step carries the code.

**Type consistency.** `merchant.Service`, `credential.Service`,
`signature.Service`, `idempotency.Service` and `adminuser.Service` are named
identically in their producing task and in every consuming one.
`crypto.SHA256` returns `[]byte` everywhere. `middleware.UserFromContext`,
`MerchantFromContext` and `CredentialFromContext` share one shape.
`adminuser.User.MerchantID` is `uuid.UUID` with `uuid.Nil` meaning platform
admin in all four places it is read.
