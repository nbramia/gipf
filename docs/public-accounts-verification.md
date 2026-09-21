# PR4 verification — 2026-09-20

Implementation base: `fdf80ef`, `origin/integration/ramia-22`.
No gate, routes, engine/training/model assets, live secrets, deployments, DNS, or
provider configuration changed. All fixtures are synthetic.

## Automated checks

Command:
```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/chess/engine/account.test.js src/games/chess/engine/chessAccountEndpoint.test.js src/games/chess/engine/profileSync.test.js src/LandingPage.test.jsx src/games/chess/ChessGame.test.js
```
Result: 5 suites / 56 tests passed. Covers fixed v1 derivation/decryption vector,
two-key compatibility, encrypted recovery, explicit guest import, late requests,
account switching, local Chess/Diplomacy saves, and quota failure preservation.

Command:
```sh
node --test tests/public-security.test.mjs tests/ai-security.test.mjs tests/account-redis.test.mjs
```
Result: 16 tests passed, including real Redis Lua for atomic NX registration,
claim ownership/idempotence/collision preservation, revision conflicts, two-instance
limits, model request bounds, provider redaction, and the threaded model route.

Command: `npm run build`.
Result: exit 0. Existing CRA dependency/Browserslist notices and the chess.js
missing source-map source warning remain; no new build errors.

Command:
```sh
./node_modules/.bin/eslint --no-eslintrc --config tests/security-eslint.cjs --resolve-plugins-relative-to . api/chessAccount.js api/chessProfile.js api/chessRating.js api/chessCoach.js api/catanRules.js api/splendorRules.js api/diplomacyAgent.js api/zertzAiMove.js api/testAI.js server/publicSecurity.js server/zertzWorker.js src/account.js src/AccountBoundary.jsx src/App.jsx src/LandingPage.jsx src/games/chess/engine/account.js src/games/chess/engine/profileSync.js src/games/chess/engine/ratingSync.js src/games/chess/ChessGame.jsx
```
Result: exit 0, zero errors, six pre-existing Chess hook dependency warnings.
`git diff --check` also passed. Full unedited local command logs retained for the
coordinator at `/tmp/gipf-focused-final.log`, `/tmp/gipf-node-final.log`,
`/tmp/gipf-build-final.log`, and `/tmp/gipf-lint.log`.

## Manual HTTP verification

Prerequisites/commands:
```sh
docker run --rm -d --name gipf-pr4-synthetic-redis -p 127.0.0.1:16389:6379 redis:7-alpine
node tests/serve-public-security.mjs
node tests/http-security-smoke.mjs
```
Server output:
```text
Synthetic fixture ready at http://127.0.0.1:3187/gipf
```
Complete smoke output:
```text
chessAccount: 200 ok
chessAccount: 401 bad_credentials
chessProfile: 200 ok
chessProfile: 401 bad_credentials
chessRating: 410 account_required
chessCoach: 401 missing_api_key
chessCoach: 401 upstream_error
catanRules: 401 missing_api_key
catanRules: 401 upstream_error
splendorRules: 401 missing_api_key
splendorRules: 401 upstream_error
diplomacyAgent: 401 missing_api_key
diplomacyAgent: 401 upstream_error
chessCoach: 401 upstream_error
testAI: 200 ok
zertzAiMove: 200 move returned
zertzAiMove: 500 Unable to calculate move
PASS: real HTTP handlers, synthetic Redis/provider boundary, valid and error paths
```
This runs real HTTP handlers through the current subpath, using a disposable
Redis store and a provider stub that refuses live model calls. The script asserts
statuses and no-store headers; the Zertz success computes a real move in its
bounded worker. Invalid credentials, missing ownership, retired legacy access,
missing BYO keys, upstream errors, and invalid board state follow explicit error
paths without leaking supplied secrets.

## Browser verification

Exact Playwright MCP invocation:
```json
{"filename":"/Users/nathanramia/orca/workspaces/gipf/public-accounts-22/tests/browser-account-smoke.js"}
```
Complete result:
```json
{"guestImported":true,"secondDevice":{"api":true,"lichess":true,"score":true},"logoutCleared":true,"accountBIsolated":true,"accountRecovery":true,"visibleConflict":true,"explicitCloudChoice":true}
```
The committed script creates two synthetic accounts and a separate browser
context, exercises visible forms, unlocks both keys on the second device, checks
saved score transfer, clears outgoing credentials, verifies B sees no A progress,
recovers A's local-only progress, and resolves a visible cloud/device conflict.
Every returned boolean is asserted by the script. The 409 console entry during
the conflict scenario is expected. No real credentials or browser traces are
included in this PR.

## Self-review resolutions and release boundary

- Registration's get/set overwrite race is replaced by SET NX.
- Legacy and public-ID read/write bypasses are removed; bounded claims atomically
  retain the source and preserve overlapping data for authenticated recovery.
- A transition originally waited on claims after changing identity; claims now
  finish before the switch, with account checks after awaits.
- Additional existing Chess/Diplomacy saves and all known preferences are included
  in outgoing recovery; no new snapshot format or engine restoration was added.
- Provider error text is no longer echoed. A pre-existing undefined opening-tool
  schema in the touched Chess proxy is mirrored from its existing browser schema,
  with a threaded-proxy regression test.
- Vercel function deadlines and Zertz worker includes are explicit; rewrites are
  semantically unchanged. Runtime packaging still requires deployment validation.

Coordinator-owned before public release: integrate `guardRequest` into the parallel
Yinsh `api/aiMove.js` repair; run independent adversarial review and the authoritative
full regression suite; verify HTTPS/platform behavior and worker bundling; configure
durable Redis and fixed legacy-claim dates; execute later origin migration/cutover
and PR5 match-save work. See [public account operations](public-accounts.md).

## Security review fixes — 2026-09-21

Review input: `8ef678f5b61138ed6c57a5c91319c23622401894` and the local
`/tmp/ramia22-gipf61-security-review-r1.md`. This section supersedes the older
Yinsh integration prerequisite and shared-container commands above. Use only an
explicit `GIPF_TEST_REDIS_CONTAINER=gipf-test-*` disposable container.

### Result and limits

- M1: the account-user counter is charged only after valid credentials. Twenty-five
  bad logins from different synthetic networks return generic 401s, leave that
  counter absent, and cannot prevent correct login or setKey from fresh networks.
  The shared network limit still rejects request 21, including across usernames
  and separately imported handler instances. This bounds guesses per network,
  not across a botnet; NAT users still share their network resource budget.
- M2: the owner, source-data, daily-budget, lifetime-budget, and copy/bind steps are
  one Lua transaction. Concurrent owner repeats cost one claim total; no-source
  IDs cost zero and remain unbound; competing owners have one winner; concurrent
  distinct sources stop at five without overshoot. Already-owned, foreign-owned,
  and no-source paths do not charge the daily/lifetime migration budget. General
  sync rate limits still apply. Chess mounts only sync; sign-in performs claims.
- Yinsh now uses the shared durable 30/minute AI bucket and 32 KiB size boundary,
  a worker terminated after 3000 ms, generic errors, and suppressed worker logs.
  Search settings, confidence/fallback policy, engine/model files, response shape,
  and ciphertext/credential derivation remain unchanged. Warm transposition state
  is now per worker; the duplicate result/intermediate caches are consolidated.
  The worker import closure and ten-second platform deadline are explicit.
- Security headers are deferred with a concrete CSP dependency/testing inventory in
  [operations](public-accounts.md). No hosted/Vercel/DNS/deploy actions occurred.

### Commands and evidence

```sh
export GIPF_TEST_REDIS_CONTAINER=gipf-test-security-fixes
docker run --rm -d --name "$GIPF_TEST_REDIS_CONTAINER" redis:7-alpine
node --test tests/public-security.test.mjs tests/ai-security.test.mjs tests/account-redis.test.mjs
CI=true npm test -- --watchAll=false --runInBand
npm run build
GIPF_TEST_PORT=3196 node tests/serve-public-security.mjs
GIPF_TEST_PORT=3196 node tests/http-security-smoke.mjs
node tests/seed-browser-security.mjs
# Navigate Playwright to http://127.0.0.1:3196/gipf; execute tests/browser-account-smoke.js.
# Separate disposable Redis for mutations; each mutation runs in a temporary source copy.
docker run --rm -d --name gipf-test-security-mutations redis:7-alpine
GIPF_TEST_REDIS_CONTAINER=gipf-test-security-mutations node tests/security-mutations.mjs
```

- Focused account/UI Jest: **5 suites / 56 tests passed**.
- Node and real Redis: **24/24 passed**. Redis commands use asynchronous separate
  CLI processes, so racing requests actually reach Redis concurrently. Registration
  tests assert the winning credential without assuming which concurrent request wins.
- Full Jest: **57 suites / 1120 tests passed**. The first run exposed 16 stale
  Diplomacy endpoint fixture failures: its provider-only mock omitted the now-required
  Redis boundary. The fixture now stubs Redis separately, retaining the real guard
  and all upstream assertions; its 19 tests and the subsequent full suite pass.
- Build: **passed**. Existing CRA dependency/Browserslist/chess source-map notices
  remain. Scoped lint: **zero errors**, six pre-existing Chess hook warnings.
- HTTP: original auth/isolation/provider/Zertz checks plus real Yinsh success/error
  passed. Twenty bad-auth requests are followed by 429; resetting only the fixture
  network counter models a fresh network, and correct login/setKey both succeed
  with the account counter intact. Eight empty IDs, eight repeats, and a later real
  claim end with exactly two charged migrations.
- Browser: two synthetic accounts and a second browser context passed existing key,
  recovery, isolation, and explicit conflict-choice checks. Six actual Chess mounts
  emitted zero claim requests; eight empty claims then a later explicit guest import
  successfully recovered the synthetic cloud rating. Fixture preference conflicts
  caused by Chess initialization are resolved explicitly in the test.

Browser output:
```json
{"guestImported":true,"secondDevice":{"api":true,"lichess":true,"score":true},"logoutCleared":true,"accountBIsolated":true,"accountRecovery":true,"visibleConflict":true,"explicitCloudChoice":true,"mountClaims":0,"emptyClaims":true,"lateMigration":true}
```

All five intentional mutations were killed:
```text
KILLED: M1 public username pre-auth lockout
KILLED: M2 no-source lifetime consumption
KILLED: M2 repeat daily consumption
KILLED: Yinsh missing durable guard
KILLED: Yinsh weakened hard deadline
```

The hard deadline also terminates a real infinite-loop worker; the timer test asserts
no termination at 2999 ms and termination at 3000 ms. Local evidence logs:
`/tmp/gipf61-fixes-{focused,node,full,build,lint,http,mutations}.log`.

### Still required before opening public access

Land PR65's empty-array preservation fix (review M3) with or before PR61. Verify
end-user identity through both hostnames and the external rewrite (H-verify),
platform worker bundling, HTTPS/body/deadline behavior, and configured durable
storage/claim dates. Retain the production gate until those operational checks
pass. Shared-NAT saturation and distributed password guessing are documented
limitations of the network limiter. Older cached sessions need a sign-out/sign-in
within the claim window; this change does not rewrite historical migration records.
## Issue 62: profile JSON type preservation

The focused regression `tests/profile-arrays-redis.test.mjs` uses the actual
handler and actual Redis EVAL in a dedicated `gipf-r22-address-synthetic-redis`
container. Its REST transport adapter executes Redis commands, not mocked Lua
results. The adapter passes arguments through `redis-cli` text quoting, so byte
fidelity is established only for the fixture characters used (ASCII, quote,
backslash, newline); arbitrary control characters or non-UTF-8 values are not
covered. The fixture flushes only that named disposable container. It covers all
four profile sanitizers, preferences (including JSON strings and null), nested
arrays/objects retained from older records, partial writes, stale two-handler writes and injected byte-CAS interleaves,
claim ownership/collisions/retries, source/destination changes during claims,
retry exhaustion, lifetime limits, authentication and payload rejection, and a
real loopback HTTP handler smoke test. No browser or external provider is used.

Before the correction, five of the initial seven regressions failed: empty
mistake arrays became objects on WRITE and CLAIM, and a damaged mistakes domain
could be silently replaced. The implementation retains the JSON record format,
compares exact stored snapshots in Lua, and stores JS-serialized JSON opaquely.
See `public-accounts.md` for the explicit `legacy_shape_conflict` behavior and
operator recovery limitation. This focused evidence is not the parent PR61
security review, an authoritative full-suite run, or authorization to deploy or
remove the public gate.


## PR65 review corrections

Focused local commands (synthetic data only):

```sh
docker run --rm -d --name gipf-r22-address-synthetic-redis redis:7-alpine
node --test tests/profile-arrays-redis.test.mjs
docker stop gipf-r22-address-synthetic-redis
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/chess/engine/profileSync.test.js
npm run build
./node_modules/.bin/eslint --no-eslintrc --config tests/security-eslint.cjs --resolve-plugins-relative-to . api/chessProfile.js src/games/chess/engine/profileSync.js
git diff --check
```

Results: 19/19 Redis tests and 24/24 client tests pass; build and focused lint
exit 0 with existing CRA/Browserslist and chess.js source-map warnings.
`git diff --check` passes.

The Redis regressions exercise the real handler/Lua and loopback HTTP, including
bundled history+mistakes recovery from the known empty-object case, preservation
of nonempty object-valued version-1 `mistakes.entries`, healthy claim alternatives,
empty stored JSON, missing-to-empty races in WRITE and CLAIM, and aggregate claim
timing. Client tests
cover safe reconciliation, preservation of input objects, and the actual bundled
write request. The synthetic clock tests advance time for preflight and every
command: one stops before the first EVAL, another stops during a contention retry.
The original PR65 used three attempts; integration permits six only when time permits. Exact bytes are compared
with an explicit presence prefix; no digest CAS or authorization/quota policy
change was made.

Maximum-count payload evidence: 200 mistakes with maximum ASCII string lengths,
500 puzzle records with 64-character IDs, both history sides with 32 maximum-length
keys, capped counters, a current profile and five complete retained alternatives.
The tested mistakes domain is 127,019 bytes; the final record is 1,301,530 bytes;
the largest JSON REST EVAL bodies are 2,790,578 bytes for CLAIM and 2,789,878 bytes
for WRITE. The fixture performs all five claims and a subsequent full-domain write,
then verifies profile and retained alternatives. These are measured UTF-8 wire
sizes, including JSON escaping, not merely the logical request size.

This is a supported **local test envelope**, not an absolute maximum byte size:
Unicode/escaping changes byte lengths, mistakes allow up to 262,144 serialized
bytes, and accumulated domains/alternatives can exceed the 300,000-byte incoming
request limit. Retained historical JSON has no new aggregate size cap in this
patch; arbitrary old data therefore has no finite enforced record maximum.
No provider-plan payload limit or hosted latency was checked. The 17-second
command admission budget leaves 3 seconds under `maxDuration:20`, but event-loop
stalls, unusually large historical JSON parsing/serialization, and hosted timeout
behavior still require coordinator-owned deployment verification. An ambiguous
EVAL timeout retains existing atomicity: same-owner claim retries are idempotent,
while a committed-but-timed-out write returns 503 and leaves the client revision
stale, causing later writes to conflict until a read or reload refreshes it. In the integrated implementation, only successful new data-bearing claims consume quota.

Client non-array entries are skipped for reconciliation, not recovered. Nonempty
object-valued version-1 `mistakes.entries` still reject the entire game-end bundle,
including history, with the existing generic client sync error; operator recovery
remains necessary. When reconciliation includes mistakes, the initial sign-in push
bundles them with every other changed domain and is rejected the same way; without
healthy alternatives this recurs on every load. Standalone rating and puzzle saves
still sync. Other non-array shapes are not protected by this replacement guard.
Empty-object compatibility does not establish that every malformed
object came from cjson. No full suite, live provider call, production data access,
PR61 security certification, or deployment is part of this evidence.
