# Public account boundary (PR4)

This change keeps the outer gate, routes, deployment prefix, engines, and models
unchanged. Do not open public access until the integration and deployment checks
below pass. Related to https://github.com/nbramia/ramia/issues/22.

## Compatibility and authorization

Both account modules preserve the original username normalization, namespace,
310,000 PBKDF2-SHA256 iterations, 768-bit split, and AES-GCM `{iv, ct}` envelopes.
`authToken` authorizes requests; its SHA-256 verifier stays in the original
`chess:account:<usernameId>` record. `aesKey` never leaves the client. Username
hashes are public identifiers, not authorization. The old password-derived
`profileId` and API-key-derived profile ID are secret bearer capabilities.

The model proxies transiently receive the user's own Anthropic key for the
upstream request. They never use an environment key as a fallback, log request
bodies, or echo provider error details. The account service stores ciphertext
only. The Lichess token remains independently encrypted under the same AES key.

`POST /api/chessAccount` retains `create`, `login`, and `setKey` with fields
`u`, `auth`, `enc`, and `encLichess`. `setKey` accepts null to clear a stored
credential; omitted envelopes stay unchanged. Atomic registration prevents an
existing username from being replaced. Bad credentials return the same 401 for
missing accounts and incorrect passwords.

`POST /api/chessProfile` requires `u` and `auth` on every action:

- `read`: returns `{configured:true, revision, profile, legacyProfiles?}`.
- `write`: takes `revision` and `domains`; returns the next revision. A stale
  revision returns 409 without changing data. Chess domains remain `rating`,
  `history`, `puzzles`, and `mistakes`, with existing validators.
- `scope:"settings"`: separate revision and record, with `domains.preferences`
  containing allowlisted localStorage string values. Covers the four named games'
  existing preferences, Yinsh wins, and Chess finished-game statistics
  (`chessGameLog`). Non-null values normally have a 2,048-character limit;
  `chessGameLog` instead uses `server/chessLogValidation.js` to validate its JSON
  entry shape, with at most 200 entries and 100,000 UTF-8 bytes. Match snapshots
  use their own scope below. Unsupported keys
  (including credentials) are rejected. Startup conflicts offer explicit choices;
  changes are checked every five seconds. Network failures leave local play usable.
- `scope:"match"`: `read`/`write` for `game:"chess"|"yinsh"|"zertz"|"catan"`,
  stored at `gipf:match:v1:<usernameId>:<game>` with a separate account/game CAS
  revision. Writes use `domains.match` (a validated snapshot or null to clear);
  stale revisions return 409. `claim` is rejected for this scope. See
  [resumable matches](resumable-matches.md) for schema, restore, and recovery details.
- `claim`: takes `legacyId` only in the body and copies existing cloud data into
  the authenticated owner. There is no unauthenticated legacy read or write.

Legacy `GET /api/chessProfile?id=...` returns 405 and `/api/chessRating` returns
410. Existing clients must upgrade; old data remains in Redis. API secrets must
never be placed in URLs, analytics, logs, test traces, or ordinary exports.

## Bounded legacy claims

Set both `GIPF_LEGACY_CLAIM_FROM` and `GIPF_LEGACY_CLAIM_UNTIL` to fixed ISO UTC
instants. The interval must be at most 90 days. Missing, future, expired, or
oversized windows fail closed. Operator setup is required; this PR sets no live
configuration. Preserve backups before configuring the window.

The authenticated account must also present the old secret capability. Redis
atomically binds that capability to one account permanently; another account
cannot transfer it. A repeat claim by its owner is idempotent. Limits are five
attempts per account per day and five distinct lifetime claims per account.
Existing domain collisions retain the original data in `legacyProfiles`; normal
Chess reads merge those alternatives using the existing monotonic merge rules.
The source record stays untouched. No public username identifier substitutes for
the old capability, and no new profile is stored in the old namespace.

Sign-in claims the password-derived legacy profile. Explicit guest import also
claims the legacy hash of the API key already on that device. Cached older Chess
sessions attempt their account-profile claim on load. A closed/unavailable window
does not delete source data; operators must complete recovery during a documented
window. Forgotten passwords or lost old capabilities cannot be recovered by a
public-ID lookup.

## Device isolation and recovery

`gipfAccount` retains the existing active-session shape. On switching, the outgoing
allowlisted progress is encrypted with its account AES key and stored under
`gipf:recovery:<usernameId>`. Only that account's password can decrypt it. Secrets,
active sessions, and unrelated app data are excluded. Device quota/encryption
failure aborts a switch instead of deleting the only recovery copy.

Guest progress is retained separately in `gipf:guest:recovery`. Import requires the
unchecked-by-default checkbox; it never imports an outgoing account into another.
Logout removes the session, shared and legacy Anthropic slots, and Lichess slot,
and clears visible game progress. Reloading drops component memory and old AI
callbacks. Other tabs reload on the session storage event. Deferred profile writes
capture the old credentials and reject if the active account changed; read
responses perform the same check. Recovery copies are not ordinary exports.

Existing Splendor/Diplomacy local behavior is retained within the active account;
their data is protected during switching, without new cloud persistence features.
PR5 extended the progress allowlist and authenticated contract for versioned
match snapshots and engine-safe restoration; see [resumable matches](resumable-matches.md).
The requirements against public-ID access and merging a pending save into the next
account remain unchanged.

## Durable limits and execution bounds

`server/publicSecurity.js` uses existing `KV_REST_API_URL` / `KV_REST_API_TOKEN`
(or Upstash aliases) and Redis EVAL with atomic INCR plus expiry. Every instance
uses the same counters. Account traffic is 20/minute per network identity and
username; sync is 120/minute per network identity and account; AI is 30/minute
per network identity shared across proxies. Counters store hashed identities.
Vercel's overwritten `x-vercel-forwarded-for` is the deployed network identity;
local fixtures use the socket address, never caller `x-forwarded-for`. See the
[Vercel request-header contract](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).

Storage fetches have three-second abort deadlines. Account input is 12 KiB,
profile input 300,000 bytes, model/AI input 32 KiB, enforced by handler checks (with parser size hints as defense in depth).
`vercel.json` also sets explicit platform execution deadlines and includes the
Zertz worker dependencies without changing rewrites. Provider calls abort at 12 seconds, including reading
the response. Zertz runs in a worker terminated after three seconds, caps work
at 200 simulations, and returns generic failures. Missing or failed durable
storage fails closed with 503 for server features; local engines remain usable.
Sensitive responses set `Cache-Control: no-store`.

**Coordinator integration required:** the parallel game track owns `api/aiMove.js`.
After reconciling that track, import `guardRequest` from
`../server/publicSecurity.js`; after method/preflight checks and before any board
construction, run:

```js
if (!await guardRequest(req, res, { bucket: 'ai', limit: 30, maxBytes: 32768 })) return;
```

Its CPU deadline and redaction must be retained from the repaired implementation.
Do not declare the public server-AI acceptance criterion complete before this
callsite and its cross-instance tests are integrated.

## Focused verification and remaining release checks

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/chess/engine/account.test.js src/games/chess/engine/chessAccountEndpoint.test.js src/games/chess/engine/profileSync.test.js src/LandingPage.test.jsx src/games/chess/ChessGame.test.js
node --test tests/public-security.test.mjs tests/ai-security.test.mjs
# Disposable Redis only. The contract test FLUSHDBs this named container.
docker run --rm -d --name gipf-pr4-synthetic-redis -p 127.0.0.1:16389:6379 redis:7-alpine
node --test tests/account-redis.test.mjs
npm run build
node tests/serve-public-security.mjs
# Browser fixture is http://127.0.0.1:3187/gipf; stop it before container cleanup.
docker stop gipf-pr4-synthetic-redis
```

The fixture uses only synthetic local Redis and refuses real provider calls.
Use two synthetic users and separate browser contexts for credentials, explicit
import, encrypted recovery, conflict handling, and second-device settings reads.
The repository's pre-existing CRA/source-map warnings may remain in the build.

Before opening the gate: coordinator integrates Yinsh guard, performs independent
security review, runs the authoritative full regression suite, verifies Vercel
worker bundling and platform request/deadline behavior, configures durable Redis
and the bounded claim window, and tests the production-like HTTPS origins without
logging secrets. Production cutover, hostname changes, origin migration, and new
match restoration are later PRs. No deployment/DNS/provider writes are in this PR.
