# Games accounts

How accounts, sessions, keys and progress work on play.ramia.us, the one Games site
(the `play` Vercel project, store `gipf-public`). Accounts are optional: every game
plays as a guest. Related to https://github.com/nbramia/ramia/issues/22.

## Sign-in surface

`/login` (`src/LoginPage.jsx`) is the only place to sign in, sign out, link an old
games account, or enter the Anthropic key and Lichess token. The landing page links to
`/login`, and each game that uses a key links to `/login?return=/<game>`. `return` must
exactly equal a `games-registry.js` path, otherwise sign-in returns to `/` — checked in
the browser (`src/loginReturn.js`) and again by the server (`server/auth0.js`), so the
sign-in redirect is never open. Games contain no credential or key inputs, enforced by
`src/gamesLoginBoundary.test.js`. On the retired gated hosts (`gipf.vercel.app`,
`ramia.us/gipf`) the page points to play.ramia.us instead.

Signing in uses the ramia.us Auth0 tenant — the same one home.ramia.us uses, with the
same Google and email/password connections — through `play`'s own Regular Web
Application. An Auth0 session already open from Home completes the redirect without a
prompt. Anyone may sign up; that grants nothing on Home, which admits only identities
with an enabled membership row (ramia `docs/private-portal-contracts.md`). "Use a
different account" asks Auth0 for credentials even when its session would sign in
silently. There are no username/password sign-ins or new password accounts.

## Auth0 flow

`api/auth.js` with `server/auth0.js` (openid-client):

- `GET /api/auth/login?return=` builds an authorization-code request with PKCE (S256),
  `state` and `nonce`, `scope=openid email profile`, and the one registered callback
  `https://play.ramia.us/api/auth/callback`. Those values ride in
  `__Host-games_auth` (HttpOnly, Secure, SameSite=Lax, 10 minutes), AES-GCM-sealed under
  a key derived from `GAMES_SESSION_SECRET`. Off `play.ramia.us`, or with any
  configuration missing, it returns to `/login?error=unavailable` instead.
- `GET /api/auth/callback` needs that cookie, exchanges the code with
  `client_secret_post`, and validates the ID token: issuer, audience, expiry, nonce,
  state, and its RS256 signature against the tenant's JWKS. It then requires
  `email_verified === true` (Google identities are verified). Any failure returns to
  `/login?error=…` with no provider detail and no session.
- The identity is `sha256("gipf-games-identity:v1|<issuer>|<sub>")`; Redis never holds
  the subject. A first sign-in creates `gipf:identity:v1:<identityId>` and spends the
  creation budgets that bound the store (5 per network and 50 overall per 24 hours;
  over budget returns `error=busy`). The callback then revokes any session the browser
  presented, issues a new one, and returns to `/login?signedin=1&return=…`, where
  `completeSignIn` finishes on the device.
- `POST /api/auth/logout {everywhere?}` revokes this session (or every session of the
  identity) and clears the cookie. **It does not end the Auth0 session**, so Home stays
  signed in and signing in to Games again is one click with no password. Signing out is
  still meaningful on Games: the session is revoked server-side, the device's identity,
  keys and progress are cleared and sealed, and nothing signs in again until the player
  chooses Sign in. A player on a shared computer signs out of Home (or Google) to end
  the provider session too.

## Sessions

`api/session.js` and `server/session.js`:

- The cookie is `__Host-games_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax;
  Max-Age=7776000` — host-only, never readable by page script. The token is 32 random
  bytes; Redis stores only `gipf:session:v1:<sha256(token)>` →
  `{i, u, name, fresh, created, seen}` (identity, data id, verified email shown as the
  account name, whether this sign-in created the identity), plus the set
  `gipf:sessions:v1:<identityId>` of that identity's session hashes.
- Lifetime: 30 days idle (the record's TTL, refreshed at most hourly by use) and
  90 days absolute from creation.
- `GET /api/session` reports `{signedIn, u, name, linked, keys}` or 401. `keys` says only
  whether each key is held. `POST {action:'establish'}` adds `sealKey` (below) and
  `offerLink`, true on the sign-in that created the identity.
- A session record without an identity predates Auth0: it is refused and deleted on
  sight. The browser retires a password-era `gipfAccount` (v1 or v2) at startup
  (`retireLegacySession`): it signs out locally, sealing progress under the old key,
  revokes the old session without waiting, and `/login` explains that Games now signs in
  with the ramia.us account and offers the link.
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
again with `establish`.

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
key or Lichess token; there is no second password.

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

## Linking a pre-Auth0 games account

Accounts created before Auth0 (`chess:account:<usernameId>`, PBKDF2 credentials derived
in the browser) no longer sign in. After a first Auth0 sign-in, `/login` offers "Link
your existing games account"; while unlinked, the account page keeps offering it.

1. The browser derives `authToken` and `aesKey` from the old username and password with
   the original derivation (namespace, 310,000 PBKDF2-SHA256 iterations, 768-bit split).
2. `link-verify {u, auth}` checks the token against the stored verifier (failures share
   the per-network authentication budget; a missing account and a wrong password give
   the same 401) and returns the old client-encrypted `enc` / `encLichess`.
3. The browser decrypts them and sends the plaintext once over TLS with
   `link {u, auth, sealKey: aesKey, anthropic?, lichess?}`. The server verifies the token
   again and, atomically, sets `gipf:identity-link:v1:<usernameId>` and the identity's
   `data` and `linked` to that usernameId. Old keys fill only the slots this sign-in has
   not set, encrypted server-side. The old `aesKey` becomes the seal key, so recovery
   copies sealed before Auth0 still open.
4. The server revokes every session of the identity and reissues this one on the old
   data id; the device switches to it, restoring its sealed recovery copy, and claims
   the old password-derived profile id while the bounded claim window is open.

Linking is by reference: settings, profile, matches, migration receipts and recovery
records stay under the old usernameId and are read in place; nothing is copied or moved.
Each old account links to one identity and each identity links one old account (409
`account_linked` / `identity_linked`); linking is never automatic or guessed. Progress
saved under the new sign-in before linking stays stored but is no longer shown. The old
`chess:account:` record is kept only for this verification; there is no password reset.

## Compatibility and authorization

The session cookie is the only authorization for account, profile and key requests;
`u` and `auth` in a body authorize nothing (a body `u`, if present, must name the
session's own data id). `POST /api/chessAccount` `create`, `login` and `setKey` return
410. Username hashes are public identifiers, not authorization. The old
password-derived `profileId` and API-key-derived profile ID are secret bearer
capabilities used only for bounded claims.

`POST /api/chessProfile` is authorized by the session cookie on every action:

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
  stored at `gipf:match:v1:<dataId>:<game>` with a separate account/game CAS
  revision. Writes use `domains.match` (a validated snapshot or null to clear);
  stale revisions return 409. `claim` is rejected for this scope. See
  [resumable matches](resumable-matches.md) for schema, restore, and recovery details.
- `claim`: takes `legacyId` only in the body and copies existing cloud data into
  the authenticated owner. There is no unauthenticated legacy read or write.

Legacy `GET /api/chessProfile?id=...` returns 405 and `/api/chessRating` returns
410. Old data remains in Redis. API secrets must never be placed in URLs, analytics,
logs, test traces, or ordinary exports.

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

Linking an old account claims its password-derived legacy profile. Explicit guest
import at sign-in also claims the legacy hash of the API key already on that device.
Chess mounts only read/sync; they do not issue migration claims. A closed/unavailable window
does not delete source data; operators must complete recovery during a documented
window. Forgotten passwords or lost old capabilities cannot be recovered by a
public-ID lookup.

## Device isolation and recovery

On switching, the outgoing
allowlisted progress is encrypted with its account's seal key and stored under
`gipf:recovery:<dataId>`. Only a sign-in to that account can decrypt it. Secrets,
active sessions, and unrelated app data are excluded. Device quota/encryption
failure aborts a switch instead of deleting the only recovery copy.

Guest progress is retained separately in `gipf:guest:recovery`. Import requires the
unchecked-by-default checkbox; it never imports an outgoing account into another.
Logout revokes the server session and removes the cached session, the stored seal key,
the shared and legacy Anthropic slots, the Lichess slot and the account-key marker,
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
uses the same counters. Account traffic (session `establish`, keys, link, logout) is
20/minute per network identity and 20/minute per signed-in identity; the Auth0 login
and callback are 30/minute per network; sync is 120/minute per network identity and
account; AI is 30/minute per network identity shared across proxies, including Yinsh;
the Lichess explorer proxy is 60/minute per network. Counters store hashed identities.
Failed old-account password checks (linking) share one 20/minute per-network budget;
once spent, even a correct password gets 429 from that network until the window
expires. A missing account and a wrong password return the same generic 401, and
guesses against an old username never spend the owner's identity budget. A distributed
botnet can still multiply attempts across networks; Auth0's own attack protection
covers the sign-in itself.
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
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/chess/engine/account.test.js src/games/chess/engine/chessAccountEndpoint.test.js src/games/chess/engine/profileSync.test.js src/LandingPage.test.jsx src/LoginPage.test.jsx src/gamesLoginBoundary.test.js src/accountSession.test.js src/accountKeys.test.js src/games/chess/ChessGame.test.js
node --test tests/public-security.test.mjs tests/ai-security.test.mjs
# Explicit disposable Redis only; these tests FLUSHDB the container, so run them one file at a time.
export GIPF_TEST_REDIS_CONTAINER=gipf-test-public-accounts
docker run --rm -d --name "$GIPF_TEST_REDIS_CONTAINER" redis:7-alpine
node --test --test-concurrency=1 tests/auth-oidc-redis.test.mjs tests/account-redis.test.mjs tests/session-redis.test.mjs tests/match-redis.test.mjs tests/profile-arrays-redis.test.mjs tests/migration-activation-redis.test.mjs
# Real sign-in in Chromium against the synthetic provider, served as https://play.ramia.us.
PUBLIC_URL=/ npm run build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/auth-browser.mjs
npm run build
node tests/serve-public-security.mjs
# Browser fixture is http://127.0.0.1:3187/gipf; stop it before container cleanup.
docker stop "$GIPF_TEST_REDIS_CONTAINER"
```

`tests/auth-oidc-redis.test.mjs` runs the Auth0 flow against a synthetic OpenID
provider (discovery, JWKS, token endpoint, throwaway RS256 key): redirect parameters,
state/nonce/PKCE and signature failures, verified email, the return allowlist, session
and CSRF rules, key custody (ciphertext only at rest, AAD binding, rotation), the proxies
using account keys, and linking (happy path, wrong password, double link).
`tests/auth-browser.mjs` drives the built app in Chromium through sign-in, the link
offer, linking, a model request, sign-out and a silent second sign-in.

The fixtures use only synthetic local Redis and refuse real provider calls.
`GIPF_TEST_REDIS_CONTAINER` must explicitly name a `gipf-test-*` disposable
container; there is no shared-container default. `GIPF_TEST_PORT` can select a
nonconflicting loopback port. Before the browser smoke, seed its synthetic late
migration with `node tests/seed-browser-security.mjs`; this deliberately flushes
only that disposable container. Navigate Playwright to that fixture URL before
running `tests/browser-account-smoke.js`.
In that fixture `GET /gipf/api/auth/login` is a synthetic sign-in: it seeds a session for
the identity named by a `fixture-identity` cookie and returns to `/login?signedin=1`, so
the real device-side sign-in runs. The match fixtures (`tests/match-browser.mjs`,
`tests/match-import-browser.mjs`) expect `GIPF_TEST_PORT=3189`, and the ESM fixtures need
`PLAYWRIGHT_MODULE` to name Playwright's `index.mjs`. `scripts/landing-fixture` still
targets the pre-`/login` landing form and does not run.
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
work as a guest, and `/login` itself; and that no API answers 503 (health:
`GET /api/session` is 401 signed out, not 503). The full sign-in — including
silent SSO from home.ramia.us, adding keys, AI in Catan, linking an old account and
signing out — is checked by Nathan with a real identity. `x-vercel-forwarded-for` must
remain the end-user identity, or every visitor shares one rate-limit bucket.
