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
