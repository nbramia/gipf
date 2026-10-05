# Games accounts

How accounts, sessions, keys and progress work on play.ramia.us, the one Games site
(the `play` Vercel project, store `gipf-public`). Accounts are optional: every game
plays as a guest. Related to https://github.com/nbramia/ramia/issues/22.

## Sign-in surface

`/login` (`src/LoginPage.jsx`) is the only place to sign in, create an account, sign
out, or enter the Anthropic key and Lichess token. Signed in, saved keys are encrypted
under the account's AES key and stored with `setKey`; as a guest they stay on the
device. The landing page links to `/login`, and each game that uses a key links to
`/login?return=/<game>`. `return` must exactly equal a `games-registry.js` path,
otherwise sign-in returns to `/` (`src/loginReturn.js`). Games contain no credential
or key inputs, enforced by `src/gamesLoginBoundary.test.js`. On the retired gated
hosts (`gipf.vercel.app`, `ramia.us/gipf`) the page points to play.ramia.us instead.

New accounts need a password of at least 10 characters. The server never sees the
password, so `/login` enforces this when creating; accounts created under the earlier
6-character rule keep signing in unchanged. There is no password reset.

## Sessions

`api/session.js` and `server/session.js`:

- `POST /api/session {action:'create', u, auth}` verifies the token (failures share
  the per-network authentication budget), then sets
  `__Host-games_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`
  — host-only, never readable by page script. The token is 32 random bytes; Redis
  stores only `gipf:session:v1:<sha256(token)>` → `{u, created, seen}`, plus the set
  `gipf:sessions:v1:<usernameId>` of that account's session hashes. The response
  carries the encrypted key envelopes, so sign-in is one request.
- Lifetime: 30 days idle (the record's TTL, refreshed at most hourly by use) and
  90 days absolute from creation. `GET /api/session` reports `{signedIn, u}` or 401.
- `{action:'logout'}` revokes this session and clears the cookie; `{action:'logout-all'}`
  revokes every session in the account's index ("Sign out everywhere" at `/login`).
- CSRF: `guardRequest` rejects any POST whose `Content-Type` is not
  `application/json` (415), so no cross-site form or no-cors fetch reaches a handler.
  Every cookie-authenticated request and every session change also needs
  `X-Games-Request: 1` and either `Origin` exactly `https://play.ramia.us` (or, on a
  preview deployment, that deployment's own URL) or `Sec-Fetch-Site: same-origin`
  with no conflicting `Origin`; otherwise 403.

The browser keeps no secret in `localStorage`. `gipfAccount` (v2) is
`{v:2, username, usernameId, sid}`, where `sid` is a random per-sign-in marker the
identity fences compare. The AES key is imported as a non-extractable `CryptoKey`
and stored in IndexedDB (`gipf-account` / `keys`, keyed by usernameId); key sync,
recovery sealing and migration journals use it from there. Sign-out deletes it.

A device still holding a v1 session (`authToken`, `aesKey` and `profileId` in
`gipfAccount`) is upgraded at startup, before the app mounts: `src/index.js` posts the
cached token to `/api/session`, stores the key, and rewrites `gipfAccount` as v2.
Until that succeeds (offline, or no IndexedDB) the device keeps v1 and sends `u` and
`auth` in request bodies, which the server still accepts. `/migration` skips this
startup work, as it makes no request until asked.

After startup, a v2 session whose cookie the server rejects (expired or revoked) is
signed out locally exactly like a normal sign-out, and `/login` says the session
ended. If the stored key is gone (site data cleared), sign-out still clears
credentials and keys but cannot seal progress, which stays on the device.

Decrypted keys (`gipfApiKey`, `chessLichessToken`) remain in `localStorage` while
signed in, because every game reads them synchronously; they are the user's own keys
and are cleared on sign-out in every tab. The AI proxies stay stateless and receive
the key in the request body.

## Compatibility and authorization

The account module (`src/account.js`) preserves the original username normalization,
namespace, 310,000 PBKDF2-SHA256 iterations, 768-bit split, and AES-GCM `{iv, ct}`
envelopes. `authToken` is presented once per sign-in to `POST /api/session`, which
checks it against the SHA-256 verifier in the original `chess:account:<usernameId>`
record and issues a session cookie; that cookie authorizes every later request.
`aesKey` never leaves the client. Username
hashes are public identifiers, not authorization. The old password-derived
`profileId` and API-key-derived profile ID are secret bearer capabilities.

The model proxies transiently receive the user's own Anthropic key for the
upstream request. They never use an environment key as a fallback, log request
bodies, or echo provider error details. The account service stores ciphertext
only. The Lichess token remains independently encrypted under the same AES key.

`POST /api/chessAccount` retains `create`, `login`, and `setKey` with fields
`u`, `auth`, `enc`, and `encLichess`. `create` always carries `u` and `auth`; `login`
and `setKey` are authorized by the session cookie (or, for a device not yet upgraded,
by `u` and `auth`). `setKey` accepts null to clear a stored
credential; omitted envelopes stay unchanged. Atomic registration prevents an
existing username from being replaced. Bad credentials return the same 401 for
missing accounts and incorrect passwords.

`POST /api/chessProfile` is authorized by the session cookie on every action (a body
`u`, if present, must name the session's own account; `u` and `auth` in the body are
still accepted from devices not yet upgraded):

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

## JSON preservation and legacy damage

Profile and settings records keep the existing JSON object format and namespaces.
The server sanitizes new domain values, parses and merges JSON in JavaScript, and
passes the complete JSON string to Redis unchanged. Lua compares the exact prior
record before committing; a race returns 409 without changing any domain. It does
not decode/re-encode domain data. Existing valid records need no migration, and
partial writes preserve arrays, objects, and retained claim alternatives.

Claims read a snapshot of the destination and all legacy sources, merge only
missing domains in JavaScript, and atomically compare every input before binding
ownership and storing the opaque JSON. Up to six snapshot attempts handle races (five competing successful migrations plus a final read);
continued contention returns `409 conflict`. Sign-in and explicit guest import perform claims; Chess mounts only sync.
Only a new data-bearing migration consumes the daily/lifetime quota, atomically
with ownership and profile storage. Each claim command must have its full 3-second
timeout remaining in a 17-second budget from
handler entry (including authentication and quota checks). Budget exhaustion returns
`503 store_unavailable`; the remaining 3 seconds of `maxDuration:20` are reserved
for CPU/response overhead. Retries do not reset this budget. Same-owner
retries remain idempotent; other owners and the five-claim lifetime cap retain
existing rejection behavior. Source records and overlapping alternatives remain
intact. Match storage and its independent revisions are unchanged.

The known version-1 `mistakes.entries: {}` case is compatible with historical
cjson empty-array loss. A normal sanitized mistakes write can replace this empty
object, including the client's atomic game-end `{history, mistakes}` save. This
is only compatibility for that field, not evidence that arbitrary objects were
arrays. Reads and claims keep originals; the client merges only array-valued
mistake entries, so empty objects and nonempty malformed objects no longer crash
reconciliation. Healthy claimed alternatives can contribute entries even when the
destination has an empty object. Claim sources and stored alternatives stay intact.

Nonempty object-valued version-1 mistake entries still need operator-reviewed
source/backup recovery: replacement returns `409 legacy_shape_conflict` and leaves
the entire bundled write (including history) unchanged. When reconciliation includes
mistakes, the initial sign-in push bundles them with every other changed domain
and is rejected the same way; without healthy alternatives this recurs on every
load. Standalone rating and puzzle saves still sync. The client reports its
existing generic sync error; there is no repair UI. Skipping malformed values in
the client's merge does not make their contents usable or erase the remote original.
Unrelated domain writes retain them. Normal maps remain objects. Missing keys are
explicitly distinct from existing empty strings in exact byte CAS; empty stored
JSON fails closed rather than being treated as a new record. No broad corruption
migration or recovery of already-lost data is provided.

Payload evidence and limitations are recorded in
[the focused verification notes](public-accounts-verification.md#pr65-review-corrections).

## Bounded legacy claims

Set both `GIPF_LEGACY_CLAIM_FROM` and `GIPF_LEGACY_CLAIM_UNTIL` to fixed ISO UTC
instants. The interval must be at most 90 days. Missing, future, expired, or
oversized windows fail closed (410). The window is project configuration, not code:
check the `play` project's environment for whether it is open. Preserve backups before
configuring it.

> Retirement (dated 2026-10-05): the unified login shipped on 2026-10-05. The claim of
> an API-key-derived ID (explicit guest import of the key on the device) is kept for 30
> days and retires on 2026-11-04: remove it from `saveSessionProgress` in
> `src/account.js` (marked with a dated TODO) and delete this note. The window above
> should cover the same 30 days. The password-derived profile claim is unaffected.

The authenticated account must also present the old secret capability. Redis
atomically binds that capability to one account permanently; another account
cannot transfer it. A repeat claim by its owner is idempotent. Limits are five new data-bearing claims per account per day and five distinct
lifetime claims per account. The Lua transaction checks the owner and source data
before either budget: owner repeats, foreign-owner conflicts, and IDs with no source
consume neither budget. Empty IDs are not bound and return `claimed:false`, so data
that appears later can still be claimed. General authenticated sync/network limits
still apply to every request.
Existing domain collisions retain the original data in `legacyProfiles`; normal
Chess reads merge those alternatives using the existing monotonic merge rules.
The source record stays untouched. No public username identifier substitutes for
the old capability, and no new profile is stored in the old namespace.

Sign-in claims the password-derived legacy profile. Explicit guest import also
claims the legacy hash of the API key already on that device. Chess mounts only read/sync; they do not issue migration claims. Users with cached
older sessions must sign out and back in during the window to attempt migration. A closed/unavailable window
does not delete source data; operators must complete recovery during a documented
window. Forgotten passwords or lost old capabilities cannot be recovered by a
public-ID lookup.

## Device isolation and recovery

On switching, the outgoing
allowlisted progress is encrypted with its account AES key and stored under
`gipf:recovery:<usernameId>`. Only that account's password can decrypt it. Secrets,
active sessions, and unrelated app data are excluded. Device quota/encryption
failure aborts a switch instead of deleting the only recovery copy.

Guest progress is retained separately in `gipf:guest:recovery`. Import requires the
unchecked-by-default checkbox; it never imports an outgoing account into another.
Logout revokes the server session and removes the cached session, the stored AES key,
the shared and legacy Anthropic slots, and the Lichess slot,
and clears visible game progress. Reloading drops component memory and old AI
callbacks. Other tabs reload on the session storage event. Deferred profile writes
capture the old identity and reject if the active account changed; read
responses perform the same check. Recovery copies are not ordinary exports.

Splendor and Diplomacy progress stays local within the active account and is
protected during switching; neither has cloud persistence. The progress allowlist
and authenticated contract cover versioned match snapshots and engine-safe
restoration; see [resumable matches](resumable-matches.md). Public IDs never grant
access, and a pending save is never merged into the next account.

## Durable limits and execution bounds

`server/publicSecurity.js` uses existing `KV_REST_API_URL` / `KV_REST_API_TOKEN`
(or Upstash aliases) and Redis EVAL with atomic INCR plus expiry. Every instance
uses the same counters. Account traffic (including `POST /api/session`) is 20/minute per network identity before authentication and
20/minute per authenticated account after credential verification; sync is 120/minute per network identity and account; AI is 30/minute
per network identity shared across proxies, including Yinsh. Counters store hashed identities.
Knowing a username cannot charge its authenticated account budget: incorrect
credentials return the same generic 401 for absent and existing accounts. Registration
uses the network budget and atomic SET NX, never a public-username counter. The
network limit bounds guessing and storage work across usernames on one network; it
is intentionally not a global per-username password lockout. A distributed botnet
can still multiply attempts across networks. Shared-network saturation can throttle
legitimate users behind the same NAT until its 60-second window expires; passwords
do not bypass that resource limit.
Failed credential checks from every endpoint share one 20/minute per-network budget;
once spent, even a correct password gets 429 from that network until the window
expires, so the higher sync limit is not a faster password oracle.
Registration is additionally capped at 5 accounts per network and 50 accounts across
all networks per fixed 24-hour window (it starts at the window's first registration);
an attempt on a taken username spends neither. Each account can hold several megabytes (settings,
profile, four matches, migration receipts), so account creation is the store's growth
bound. The global cap means a flood can pause new registrations for a day; existing
accounts are unaffected. It bounds, rather than eliminates, aggregate storage abuse on
the free Upstash store: keep eviction disabled so a full store refuses writes instead
of dropping real accounts, and watch its memory and command usage.
Vercel's overwritten `x-vercel-forwarded-for` is the deployed network identity;
local fixtures use the socket address, never caller `x-forwarded-for`. IPv6 addresses
are grouped by /64, since one subscriber controls the whole prefix; IPv4 stays per
address. See the
[Vercel request-header contract](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).

Direct Chess match writes apply the migration PGN bound (8 KiB, 1,024 tokens)
before replaying the PGN, so a single write cannot buy seconds of CPU.
A legitimate game beyond that bound (roughly 340 moves) is no longer synced to the
cloud; autosave gets 400 and the match stays on the device.
Storage fetches have three-second abort deadlines. Account input is 12 KiB,
profile input 300,000 bytes, model/AI input 32 KiB, enforced by handler checks (with parser size hints as defense in depth).
`vercel.json` also sets explicit platform execution deadlines and includes the
Zertz worker dependencies without changing rewrites. Provider calls abort at 12 seconds, including reading
the response. Zertz runs in a worker terminated after three seconds, caps work
at 200 simulations, and returns generic failures. Missing or failed durable
storage fails closed with 503 for server features; local engines remain usable.
Sensitive responses set `Cache-Control: no-store`.
Yinsh retains its existing heuristic engine, simulation/confidence/fallback policy,
and cache-hit result shape; the search now runs in a fresh worker terminated at
three seconds, with generic failures and suppressed engine diagnostics. Its 2.5-second
soft search budget remains unchanged. Warm transposition state is isolated to each
worker and the duplicate intermediate cache is consolidated into the bounded result
cache; no model, weights, game rules, or credential derivation changed.

Security headers are deferred. A CSP requires an explicit inventory of Google Fonts,
Stockfish CDN/blob workers, ONNX/WASM, and the retained subpath/rewrite behavior;
adding an unverified blanket policy here risks breaking gameplay. Frame protection,
`nosniff`, Referrer-Policy, and CSP remain release hardening work, with browser and
both-hostname response-header coverage required.

## Focused verification and remaining release checks

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/chess/engine/account.test.js src/games/chess/engine/chessAccountEndpoint.test.js src/games/chess/engine/profileSync.test.js src/LandingPage.test.jsx src/LoginPage.test.jsx src/gamesLoginBoundary.test.js src/accountSession.test.js src/games/chess/ChessGame.test.js
node --test tests/public-security.test.mjs tests/ai-security.test.mjs
# Explicit disposable Redis only; the contract test FLUSHDBs this container.
export GIPF_TEST_REDIS_CONTAINER=gipf-test-public-accounts
docker run --rm -d --name "$GIPF_TEST_REDIS_CONTAINER" redis:7-alpine
node --test tests/account-redis.test.mjs tests/session-redis.test.mjs
# Dedicated issue-62 fixture; never point this test at a shared/production store.
docker run --rm -d --name gipf-r22-address-synthetic-redis redis:7-alpine
node --test tests/profile-arrays-redis.test.mjs
docker stop gipf-r22-address-synthetic-redis
npm run build
node tests/serve-public-security.mjs
# Browser fixture is http://127.0.0.1:3187/gipf; stop it before container cleanup.
docker stop "$GIPF_TEST_REDIS_CONTAINER"
```

The fixture uses only synthetic local Redis and refuses real provider calls.
`GIPF_TEST_REDIS_CONTAINER` must explicitly name a `gipf-test-*` disposable
container; there is no shared-container default. `GIPF_TEST_PORT` can select a
nonconflicting loopback port. Before the browser smoke, seed its synthetic late
migration with `node tests/seed-browser-security.mjs`; this deliberately flushes
only that disposable container. Navigate Playwright to that fixture URL before
running `tests/browser-account-smoke.js`.
Use two synthetic users and separate browser contexts for credentials, explicit
import, encrypted recovery, conflict handling, and second-device settings reads.
The repository's pre-existing CRA/source-map warnings may remain in the build.

### Hosted verification

Preview and production deployments of `play` share the `gipf-public` store, so hosted
checks use synthetic accounts only and delete them afterwards (every key containing
the account's usernameId, its `chess:account:` record and its sessions), returning
the creation budget they spent. Preview deployments sit behind Vercel Authentication;
use the project's automation bypass, never a disabled protection. A login change is
verified in a real browser against the deployment: `/chess` to `/login` and back; a
key added at `/login` reaching Catan, Splendor and Diplomacy with no prompt; sign-out
clearing every tab; a second browser context unlocking both keys; the session cookie's
flags and a secret-free `gipfAccount`; an account created by the original client (and
its cached v1 session) still signing in with decrypting keys; all six game routes and
refreshes as a guest; and `/login` itself. `x-vercel-forwarded-for` must remain the
end-user identity, or every visitor shares one rate-limit bucket.
