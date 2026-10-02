# GIPF release candidate integration

## Result and identity

Local integration verdict: **ACCEPT**, subject to the unchanged hosted release gates below.
This is a draft integration candidate, not authorization to publish or remove the public gate.

The assigned clean child branch `nbramia/gipf-release-candidate-22` started at
exact PR69 merge `ba52d0d32fe3c2311003f800ea63ec13b186de0e` and merges exact corrected
PR70 head `2748c96f78ebc06b723e8e2c1779575f087d3aad`. Both are retained as merge
parents. Target: `integration/ramia-22`. Neither source ref was edited or pushed.

Read before integration:

- Claude's PR70 ACCEPT re-review: `/tmp/ramia22-gipf70-bounds-review-r2.md`.
- PR69 security ACCEPT review: `/tmp/ramia22-gipf69-security-review.md`.
- Design acceptance: `/tmp/routing-design-22-audit/pr64-evidence.md` and the
  existing `docs/design-security-integration.md`.

## Conflict resolutions

1. `api/chessProfile.js` (text conflict): retain PR69's `hash` security import and
   PR70's `512kb` parser setting. The migration import/dispatch, 512 KiB migration
   limit, separate migration bucket, and ordinary 300,000-byte limit coexist with
   the accepted empty-claim, atomic budget, retry and one-owner legacy claim code.
2. `tests/account-redis.test.mjs` (text conflict): retain PR69's asynchronous
   `redis-fixture.mjs` imports and expanded tests; remove the redundant inline
   helper from PR70. This file is byte-identical to PR69 after resolution.
3. `src/games/diplomacy/agents/endpoint.test.js` (semantic merge conflict): Git
   combined PR69's old wrapper returning a constant Redis count with PR70's
   real-guard counter fixture. The first full Jest run caught the resulting
   500 versus expected 429. Select the exact reviewed PR70 test file, preserving
   real guard, store failure, payload and provider assertions. The production
   endpoint is unchanged. A removed-guard mutation fails these assertions.
4. `tests/match-browser.mjs` (fixture compatibility): the account boundary now
   blocks a transition before the match boundary. Update the expected alert to
   PR70's exact account-boundary message, retaining the assertion that the game
   is unmounted. The first browser run passed all four game persistence scenarios
   before timing out on the obsolete text; the corrected run is recorded below.

`AccountBoundary.jsx` automatically merges PR70's generation/hydration fences
with PR69's content-before-recovery ordering. Relative to PR70, its only delta is
that already accepted JSX placement. The existing presentation regression and
production browser verify the first keyboard stop remains YINSH.

## Preserved scope

Byte comparisons against PR69 confirm unchanged catalogue JSX/CSS/registry,
account endpoint, shared security guard, all AI/provider endpoints, middleware,
Vercel configuration, dependencies/lockfile and HTML shell. No game engine,
training code or model assets changed. The account module copies, migration
implementation, profile client, match store and router equal exact PR70; both
account copies remain identical. Credential derivation/encryption formats and
accepted account/API behavior are preserved.

The changed-file credential signature scan found no live-looking provider,
GitHub, AWS or private keys. This is a bounded heuristic scan, supplemented by
migration/browser tests that assert secret exclusion from exports and recovery.
All test identities, passwords, provider responses and Redis data are synthetic.

## Verification

Evidence directory: `/tmp/gipf-release-candidate-22/`. Existing dependencies were
linked temporarily from `public-accounts-22/node_modules`; no package installation
or dependency change. Node/Playwright use `/opt/homebrew/opt/node@22/bin/node`.

| Check | Result | Evidence |
|---|---|---|
| Full Jest after fixture resolution | 84 suites / 1,412 tests pass | `jest-final.log` |
| Node security, real Redis account/profile/match/migration, Yinsh | 70 pass, no failures/skips | `node.log` |
| Production builds, `/gipf` and root | Both pass | `build-subpath.log`, `build-root.log` |
| Scoped runtime lint | No errors, seven inherited Chess hook warnings | `lint.log` |
| Resolved endpoint test lint | Pass | `lint-endpoint.log` |
| Browser fixture lint | Pass with inherited import-order rule disabled | `lint-browser-final.log` |
| Real loopback HTTP smoke | Auth, isolation, claim budgets, redaction, Yinsh/Zertz workers pass | `http.log` |
| Migration staging, both paths | Nine scenario groups each, zero API requests/page errors | `staging-subpath.log`, `staging-root.log` |
| Migration activation, both paths | Four scenario groups each, zero page errors | `activation-subpath.log`, `activation-root.log` |
| Account browser | Import, second device, key unlock, logout, A/B isolation, recovery, conflict, zero mount claims and later migration pass | `account-browser.log` |
| Four-game browser | Reload, cross-device, offline drain, conflicts, malformed/quota recovery and shared-tab isolation pass | `match-browser-final.log` |
| Explicit guest match import | Default-off isolation, consented import and repeated-import preservation pass | `match-import-browser.log` |
| Production design and six guest launches | 1280/480/320px, focus, consent, confirmation/error, overflow and all six mounted games pass | `production-design.log`, screenshots |
| Security mutations | Five of five killed | `mutations.log` |
| Migration mutations | Five of five killed | `migration-mutations.log` |
| Profile-array/claim/client mutations | Seven of seven killed | `profile-mutations-final.log` |
| Diplomacy guard mutation | Killed | `diplomacy-guard-mutation-result.log` |
| Scope, credential signatures and diff whitespace | Pass | `scope-credentials.log`, `git diff --check` |

Activation checks use the actual handler and real isolated Redis, including
512 KiB input/storage rejection, no claim on rejection, lost committed response,
reload/resume, delayed second-tab hydration, match/statistics/extras activation,
durable replay/recovery, and account isolation. Staging additionally executes
the unchanged middleware against synthetic origins and rejects anonymous access.
Browser interception is installed before navigation, with external traffic
blocked. Production design screenshots at 320px were inspected for readable
content, unclipped controls, visible focus, warning and error text.

Mutation probes run on temporary copies. Migration probes remove the byte cap,
ledger cap, ledger CAS comparison, command deadline and receipt owner check.
Profile probes cover JSON array encoding, snapshot comparison, source comparison,
malformed-data retention, deadline admission, client array guard and input copy.
The initial source-comparison probe also changed the destination, so its retained
destination CAS masked the mutant; the final probe isolates a missing-to-empty
source race. An initial profile mutation launch used a container name rejected by
the fixture guard; that launch is not counted as mutation evidence.

Representative commands (from the candidate checkout):

```sh
CI=true npm test -- --watchAll=false --runInBand
GIPF_TEST_REDIS_CONTAINER=gipf-test-rc22-synthetic-redis \
GIPF_SYNTHETIC_REDIS=gipf-test-rc22-synthetic-redis \
/opt/homebrew/opt/node@22/bin/node --test --test-concurrency=1 \
  tests/public-security.test.mjs tests/ai-security.test.mjs \
  tests/account-redis.test.mjs tests/profile-arrays-redis.test.mjs \
  tests/match-redis.test.mjs tests/migration-activation-redis.test.mjs \
  tests/test_yinsh_api.mjs
npm run build
BUILD_PATH=/tmp/gipf-release-candidate-22/build-root PUBLIC_URL=/ npm run build
PLAYWRIGHT_MODULE=/Users/nathanramia/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs \
  /opt/homebrew/opt/node@22/bin/node tests/migration-activation-browser.mjs
# Repeat for tests/migration-browser.mjs, then both with:
# MIGRATION_BUILD=/tmp/gipf-release-candidate-22/build-root MIGRATION_PREFIX=''
```

Disposable Redis: `gipf-test-rc22-synthetic-redis`,
`gipf-migration-activation-synthetic-redis`, `gipf-test-rc22-browser`,
`gipf-test-rc22-match`, `gipf-test-rc22-mutations`. Local browser servers use ports
3221 and 3222. The inherited shared `gipf-pr4-synthetic-redis` is untouched.
Local wrappers adapt origin, imports, isolation and container names only.

## Remaining release gates and limits

This clears combined local PR69/PR70 verification, including the accepted PR61
and PR65 security, array and design contracts. It does not clear hosted identity
through both hostnames/rewrite, HTTPS/security headers, request-size/duration,
worker packaging, production KV/auth and fixed claim dates, old-origin/alias
protection, PWA/service-worker behavior, or the PR61 provider-security hold.
Keep the draft and public gate until the coordinator resolves those gates.

PR70 review's nonblocking test gaps around token cap, receipt cap and a missing
ledger remain inherited; this integration does not claim exhaustive mutation
coverage. Portable files over 512 KiB remain staged and cannot activate as a whole.
On providers that preparse `req.body`, the application limit measures reserialized
JSON; the platform parsing boundary still needs hosted validation. Aggregate
multi-account storage exposure remains separate from the 4 MiB migration ledger.

No hosted preview was visited and no provider, DNS, deploy, or configuration
operation was performed. A branch push/draft PR may trigger the repository's
existing automatic CI/preview integration; those results are not hosted evidence.
The unchanged HTML requests Google Fonts and Chess requests its Stockfish CDN;
both were blocked in browser verification. The browser fixture retains its inherited top-level dynamic Playwright import
before static imports; separate lint disables only `import/first` after recording
that existing violation. Existing CRA, Browserslist and
chess.js source-map warnings remain. Guest launches certify route/board mounting,
not full manual play-through of every engine.
