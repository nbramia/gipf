# Games accounts

How accounts, sessions, keys and progress work on play.ramia.us, the one Games site
(the `play` Vercel project, store `gipf-public`). Accounts are optional: every game
plays as a guest. Related to https://github.com/nbramia/ramia/issues/22.

## Sign-in surface

`/login` (`src/LoginPage.jsx`) is the only place to sign in, sign out, or enter the
Anthropic key and Lichess token. The landing page links to
`/login`, and each game that uses a key links to `/login?return=/<game>`. `return` must
exactly equal a `games-registry.js` path, otherwise sign-in returns to `/` — checked in
the browser (`src/loginReturn.js`) and again by the server (`server/auth0.js`), so the
sign-in redirect is never open. Games contain no credential or key inputs, enforced by
`src/gamesLoginBoundary.test.js`.

Signing in uses the ramia.us Auth0 tenant — the same one home.ramia.us uses, with the
same Google and email/password connections — through `play`'s own Regular Web
Application. An Auth0 session already open from Home completes the redirect without a
prompt, and Games uses it without a click (below). Anyone may sign up; that grants nothing on Home, which admits only identities
with an enabled membership row (ramia `docs/private-portal-contracts.md`). "Use a
different account" asks Auth0 for credentials even when its session would sign in
silently.

### Automatic sign-in

Being signed in at home.ramia.us signs Games in on its own (`src/silentSignIn.js`).
With no Games session, `/login` and the catalogue (`/`) make one top-level redirect to
`/api/auth/login?silent=…`, which sends `prompt=none`: Auth0 either completes from its
own session or answers `login_required` / `consent_required` / `interaction_required`
without showing anything. The callback treats those as a quiet fallback — no session,
no error message — returning to `/login?silent=failed&return=…` (from `/login`) or to
`/` (from the catalogue), where the ordinary Sign in button shows. Top-level redirects
rather than an iframe, so third-party cookie blocking does not matter.

It never loops or interrupts a guest:

- After any attempt, the browser makes no other for 10 minutes (`gipf:silent-sign-in-at`
  in localStorage). If that marker cannot be stored, there is no attempt at all.
- The catalogue tries at most once per browser session (`gipf:silent-sign-in-home` in
  sessionStorage); game routes never try.
- Signing out of Games sets `gipf:silent-sign-in-off`, which stops attempts until the
  player next chooses Sign in or "Use a different account"; otherwise the Auth0 session
  that outlives a Games sign-out would sign straight back in.
- Only on play.ramia.us, the one host Auth0 accepts a callback for, and never while
  `/login` is showing an error or finishing a sign-in.

## Auth0 flow

`api/auth.js` with `server/auth0.js` (openid-client):

- `GET /api/auth/login?return=` builds an authorization-code request with PKCE (S256),
  `state` and `nonce`, `scope=openid email profile`, and the one registered callback
  `https://play.ramia.us/api/auth/callback`. Those values ride in
  `__Host-games_auth` (HttpOnly, Secure, SameSite=Lax, 10 minutes), AES-GCM-sealed under
  a key derived from `GAMES_SESSION_SECRET`. Off `play.ramia.us`, or with any
  configuration missing, it returns to `/login?error=unavailable` instead (or quietly,
  as above, for a silent attempt). `silent=1` or `silent=home` adds `prompt=none` and
  records the attempt's origin in the sealed transaction; `reauthenticate=1` adds
  `prompt=login` and takes precedence.
- `GET /api/auth/callback` needs that cookie, exchanges the code with
  `client_secret_post`, and validates the ID token: issuer, audience, expiry, nonce,
  state, and its RS256 signature against the tenant's JWKS. It then requires
  `email_verified === true` (Google identities are verified). Any failure returns to
  `/login?error=…` with no provider detail and no session.
- The identity is `sha256("gipf-games-identity:v1|<issuer>|<sub>")`; Redis never holds
  the subject. A first sign-in creates `gipf:identity:v1:<identityId>` and spends the
  creation budgets that bound the store (see Durable limits; over budget returns
  `error=busy`). The callback then revokes any session the browser
  presented, issues a new one, and returns to `/login?signedin=1&return=…`, where
  `completeSignIn` finishes on the device.
- `POST /api/auth/logout {everywhere?}` revokes this session (or every session of the
  identity) and clears the cookie. **It does not end the Auth0 session**, so Home stays
  signed in and signing in to Games again is one click with no password. Signing out is
  still meaningful on Games: the session is revoked server-side, the device's identity,
  keys and progress are cleared and sealed, and nothing signs in again — automatically
  or otherwise — until the player chooses Sign in. A player on a shared computer signs out of Home (or Google) to end
  the provider session too.

## Sessions

`api/session.js` and `server/session.js`:

- The cookie is `__Host-games_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax;
  Max-Age=7776000` — host-only, never readable by page script. The token is 32 random
  bytes; Redis stores only `gipf:session:v1:<sha256(token)>` →
  `{i, u, name, created, seen}` (identity, data id, and the verified email shown as the
  account name), plus the set
  `gipf:sessions:v1:<identityId>` of that identity's session hashes.
- Lifetime: 30 days idle (the record's TTL, refreshed at most hourly by use) and
  90 days absolute from creation.
- `GET /api/session` reports `{signedIn, u, name, keys}` or 401. `keys` says only
  whether each key is held. `POST {action:'establish'}` adds `sealKey` (below).
- A session record without a well-formed identity and data id is refused and deleted
  on sight.
- CSRF: `guardRequest` rejects any POST whose `Content-Type` is not `application/json`
  (415), so no cross-site form or no-cors fetch reaches a handler. Every
  cookie-authenticated request and every session change also needs
  `X-Games-Request: 1` and either `Origin` exactly `https://play.ramia.us` (or, on a
  preview deployment, that deployment's own URL) or `Sec-Fetch-Site: same-origin`
  with no conflicting `Origin`; otherwise 403. The Auth0 login and callback are top-level
  GET navigations protected by `state`, `nonce` and PKCE instead.

`gipfAccount` (v3) is `{v:3, username, usernameId, sid}`: the account name, the data id
its progress is stored under, and a random per-sign-in marker the identity fences
compare. It holds no secret. The device seal key — the AES key that seals this
device's recovery copies and migration journals — is imported as a non-extractable
`CryptoKey` into IndexedDB (`gipf-account` / `keys`, keyed by data id); without
IndexedDB it is kept for the page only. Sign-out deletes it; the next sign-in fetches it
again with `establish`. At startup, before anything renders, a stored `gipfAccount`
that is not a valid v3 record is removed (`discardUnreadableSession`); the device's
progress stays in place as guest progress.

After startup, a v3 session whose cookie the server rejects (expired or revoked) is
signed out locally exactly like a normal sign-out, and `/login` says the session ended;
a live one refreshes which keys the account holds. If the stored key is gone (site data
cleared), sign-out still clears credentials and keys but cannot seal progress, which
stays on the device.

## Key custody

The Anthropic key and the Lichess token are entered at `/login`, sent once over TLS to
`POST /api/chessAccount {action:'setKeys', anthropic?, lichess?}` (a string sets, null
clears, omitted keeps), and stored in the identity record as AES-256-GCM envelopes
`{kv, iv, ct, tag}` under the key-encryption key (KEK) `GAMES_KEY_ENCRYPTION_KEY`
(`server/keyCustody.js`). The additional authenticated data is
`gipf-games-key:v1|<identityId>|<slot>|<kv>`, so an envelope copied to another identity
or slot, or relabelled with another key version, fails to decrypt. The seal key is a
third slot, random 32 bytes for a new identity. No response ever returns the Anthropic
key or Lichess token.

The model proxies (`chessCoach`, `catanRules`, `splendorRules`, `diplomacyAgent`) take a
guest's key from the request body. With no body key, `server/accountKeys.js` resolves
the session cookie (same-origin checks included) and decrypts the account's key for
that one upstream call. The Lichess masters explorer is proxied the same way
(`api/chessCoach.js`, `mode:'explorer'`), so the token never reaches the browser; guests
still query Lichess directly with their device token. Yinsh and Zertz API play uses no
key. Proxies never log request bodies or keys, never use an environment key as a
fallback, and never echo provider error details. A missing or unreadable account key is
401 `missing_api_key`; an unavailable store or KEK is 503.

Signed in, no key is kept in `localStorage`: `gipfAccountKeys` holds only
`{anthropic, lichess}` booleans (`src/accountKeys.js`), which each game's key client
reads to enable its AI features, sending `X-Games-Request: 1` so the server may use the
cookie. Keys already on a device as a guest move to the account at sign-in when the
account lacks them, and are removed from the device either way. Guests keep
device-only `gipfApiKey` and `chessLichessToken`.

Rotation: put the new KEK in `GAMES_KEY_ENCRYPTION_KEY`, raise
`GAMES_KEY_ENCRYPTION_KEY_VERSION`, and keep the previous KEK readable as
`GAMES_KEY_ENCRYPTION_KEY_V<old>` (Production and Preview, since both share the store).
Deploy, run `node scripts/rotate-games-keys.mjs` with the same variables and the store
credentials (it rewraps every identity and prints counts only), then remove the old KEK.
New envelopes always use the current version. Losing the KEK makes every account key
and seal key unreadable; its backup is `~/Code/Sync/envs/gipf/.env`.

## Authorization

The session cookie is the only authorization for account, profile and key requests.
Body fields authorize nothing; a body `u`, if present, must name the session's own data
id, so a tab still showing another account cannot write into this one.
`POST /api/chessAccount` accepts only `setKeys`; any other action is 400.

`POST /api/chessProfile` is authorized by the session cookie on every action:

- `read`: returns `{configured:true, revision, profile, legacyProfiles?}`.
  `legacyProfiles` appears only on profiles that claimed pre-Auth0 data; it holds those
  copies, which normal Chess reads merge with the existing monotonic merge rules.
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
  stored at `gipf:match:v1:<dataId>:<game>` with a separate account/game CAS
  revision. Writes use `domains.match` (a validated snapshot or null to clear);
  stale revisions return 409. See
  [resumable matches](resumable-matches.md) for schema, restore, and recovery details.
Any other action is 400, and `GET` is 405. API secrets must never be placed in URLs,
analytics, logs, test traces, or ordinary exports.

## JSON preservation and damaged records

Profile and settings records keep the existing JSON object format and namespaces.
The server sanitizes new domain values, parses and merges JSON in JavaScript, and
passes the complete JSON string to Redis unchanged. Lua compares the exact prior
record before committing; a race returns 409 without changing any domain. It does
not decode/re-encode domain data. Existing valid records need no migration, and
partial writes preserve arrays, objects, and stored `legacyProfiles` copies.

The known version-1 `mistakes.entries: {}` case is compatible with historical
cjson empty-array loss. A normal sanitized mistakes write can replace this empty
object, including the client's atomic game-end `{history, mistakes}` save. This
is only compatibility for that field, not evidence that arbitrary objects were
arrays. Reads keep originals; the client merges only array-valued mistake entries, so
empty objects and nonempty malformed objects do not crash reconciliation. Healthy
`legacyProfiles` copies can contribute entries even when the destination has an empty
object, and stay intact.

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

## Device isolation and recovery

On switching, the outgoing
allowlisted progress is encrypted with its account's seal key and stored under
`gipf:recovery:<dataId>`. Only a sign-in to that account can decrypt it. Secrets,
active sessions, and unrelated app data are excluded. Device quota/encryption
failure aborts a switch instead of deleting the only recovery copy.

Guest progress is retained separately in `gipf:guest:recovery`. Import requires the
unchecked-by-default checkbox; it never imports an outgoing account into another.
Logout revokes the server session and removes the cached session, the stored seal key,
the shared and per-game Anthropic slots, the Lichess slot and the account-key marker,
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
uses the same counters. Account traffic (session `establish`, keys, logout) is
20/minute per network identity and 20/minute per signed-in identity; the Auth0 login
and callback are 30/minute per network; sync is 120/minute per network identity and
account; AI is 30/minute per network identity shared across proxies, including Yinsh;
the Lichess explorer proxy is 60/minute per network. Counters store hashed identities.
Auth0's own attack protection covers the sign-in itself.
New identities are capped at 5 per network and 50 across all networks per fixed
24-hour window (it starts at the window's first creation); returning sign-ins spend
neither. Each account can hold several megabytes (settings, profile, four matches,
migration receipts), so identity creation is the store's growth bound. The global cap
means a flood can pause new sign-ups for a day; existing accounts are unaffected. It
bounds, rather than eliminates, aggregate storage abuse on the free Upstash store: keep
eviction disabled so a full store refuses writes instead of dropping real accounts, and
watch its memory and command usage.
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
and cache-hit result shape; the search runs in a fresh worker terminated at
three seconds, with generic failures and suppressed engine diagnostics. Its 2.5-second
soft search budget remains unchanged. Warm transposition state is isolated to each
worker and the duplicate intermediate cache is consolidated into the bounded result
cache.

Security headers are deferred. A CSP requires an explicit inventory of Google Fonts,
Stockfish CDN/blob workers and ONNX/WASM; adding an unverified blanket policy risks
breaking gameplay. Frame protection, `nosniff`, Referrer-Policy, and CSP remain
hardening work, with browser response-header coverage required.

## Verification

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/chess/engine/account.test.js src/games/chess/engine/chessAccountEndpoint.test.js src/games/chess/engine/profileSync.test.js src/LandingPage.test.jsx src/LoginPage.test.jsx src/gamesLoginBoundary.test.js src/accountSession.test.js src/accountKeys.test.js src/games/chess/ChessGame.test.js
node --test tests/public-security.test.mjs tests/ai-security.test.mjs
# Explicit disposable Redis only; these tests FLUSHDB the container, so run them one file at a time.
export GIPF_TEST_REDIS_CONTAINER=gipf-test-public-accounts
docker run --rm -d --name "$GIPF_TEST_REDIS_CONTAINER" redis:7-alpine
node --test --test-concurrency=1 tests/auth-oidc-redis.test.mjs tests/account-redis.test.mjs tests/session-redis.test.mjs tests/match-redis.test.mjs tests/profile-arrays-redis.test.mjs tests/migration-activation-redis.test.mjs
# Real sign-in in Chromium against the synthetic provider, served as https://play.ramia.us.
npm run build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/auth-browser.mjs
# Browser fixture server at http://127.0.0.1:3187/; stop it before container cleanup.
node tests/serve-public-security.mjs
docker stop "$GIPF_TEST_REDIS_CONTAINER"
```

`tests/auth-oidc-redis.test.mjs` runs the Auth0 flow against a synthetic OpenID
provider (discovery, JWKS, token endpoint, throwaway RS256 key): redirect parameters,
state/nonce/PKCE and signature failures, verified email, the return allowlist, session
and CSRF rules, key custody (ciphertext only at rest, AAD binding, rotation), the proxies
using account keys, refusal of retired account actions, and automatic
sign-in (`prompt=none`, the quiet fallback for each refusal, its return allowlist).
`tests/auth-browser.mjs` drives the built app in Chromium: the catalogue's and
`/login`'s automatic attempts falling back once with no provider session, `/login`
completing on its own with one, a model request, sign-out suppressing the automatic
attempt, a clicked silent sign-in, and `prompt=login`.

The fixtures use only synthetic local Redis and refuse real provider calls.
`GIPF_TEST_REDIS_CONTAINER` must explicitly name a `gipf-test-*` disposable
container; there is no shared-container default. `GIPF_TEST_PORT` can select a
nonconflicting loopback port.
In the fixture server `GET /api/auth/login` is a synthetic sign-in: it seeds a session for
the identity named by a `fixture-identity` cookie and returns to `/login?signedin=1`, so
the real device-side sign-in runs. The match fixtures (`tests/match-browser.mjs`,
`tests/match-import-browser.mjs`) expect `GIPF_TEST_PORT=3189`, and the ESM fixtures need
`PLAYWRIGHT_MODULE` to name Playwright's `index.mjs`.
The repository's pre-existing CRA/source-map warnings may remain in the build.

### Hosted verification

Preview and production deployments of `play` share the `gipf-public` store, so hosted
checks use synthetic data only and delete it afterwards. Auth0 accepts only the
production callback, so previews cannot sign in, and production sign-in needs a real
identity: hosted checks are anonymous. After each production deploy, verify that
`/api/auth/login?return=/catan` redirects to the tenant's `/authorize` with `play`'s
client id, `redirect_uri=https://play.ramia.us/api/auth/callback`, `response_type=code`,
`code_challenge_method=S256`, `state` and `nonce`, and sets a host-only
`__Host-games_auth` cookie (HttpOnly, Secure, SameSite=Lax, no `Domain`); that a
non-registry `return` falls back to `/`; that all six game routes and their refreshes
work as a guest, and `/login` itself; that a fresh anonymous `/login` makes exactly one
`prompt=none` round trip and settles on `/login?silent=failed` with the Sign in button,
and a second visit within 10 minutes makes none; and that no API answers 503 (health:
`GET /api/session` is 401 signed out, not 503). The full sign-in — including
automatic sign-in from home.ramia.us, adding keys, AI in Catan and signing out — is checked by Nathan with a real identity. `x-vercel-forwarded-for` must
remain the end-user identity, or every visitor shares one rate-limit bucket.
