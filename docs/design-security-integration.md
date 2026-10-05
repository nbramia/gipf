# Public Games design and accepted security integration

## Source identity

Created Orca child worktree
`/Users/nathanramia/orca/workspaces/gipf/gipf-design-security-child-22`, branch
`nbramia/gipf-design-security-child-22`, from accepted integration
`052b1af4ecf6b24353e1d3ad63ca9a0dfdb6b821` (PR68, accepted PR61 + exact PR65).
Merged exact public-games-design PR64 head
`d198bcff5813b563abc11998c6b78ec5a6e058a4` with both parents retained.
Target is `integration/ramia-22`. PR64 and PR68 source branches were not edited
or pushed. No hosted check, deployment command, provider request, or production
data access was performed.

## Resolution and preserved contracts

Git merged the 13 PR64 presentation, documentation, and fixture files without
text conflicts. The production browser check nevertheless found a composition
conflict: PR65's global Statistics recovery button preceded the catalogue and
became the first keyboard stop. `AccountBoundary.jsx` now renders page content
before those recovery controls. The controls, dialog, ownership assertions,
recovery storage, state, and service handlers are unchanged; account conflicts
and errors still precede the page. An integrated React regression checks that
YINSH is the first focusable control and that recovery can still open and close.
This placement applies across games as well as the catalogue.

The old account and match-import browser fixtures accessed consent before opening
the form. They now open the form first and retain all prior assertions; the
account fixture additionally asserts unchecked consent on every sign-in.

Byte comparison confirms existing LandingPage state and account service handlers
are identical to the accepted integration. APIs, server code, account crypto and
session module, game engines/UIs, profile/match storage, schema/validation,
router, package/lockfile, HTML shell and Vercel config are unchanged. The only
AccountBoundary change relocates existing JSX; its behavior is preserved.

PR64's registry order, routes, descriptions, local SVG motifs, scoped light
palette, two-column desktop and single-column mobile design remain intact.
The optional account area follows all games, retains visible consent, error,
confirmation and no-password-reset copy, and handles Enter in the displayed mode.

## Verification

Logs and browser wrappers are in `/tmp/gipf-design-security-22/`. Jest and build
use the existing dependency tree; no packages were installed or changed.
Node/Playwright checks use `/opt/homebrew/opt/node@22/bin/node` and the existing
Playwright installation. Default Node 18.16.1 rejected the Node concurrency flag
and modern Playwright; those invocations were rerun with Node 22.

| Check | Result | Evidence |
|---|---|---|
| Full Jest, initial exact merge | 79 suites / 1,311 tests passed | `jest.log` |
| Full Jest after recovery-placement regression | 79 suites / 1,312 tests passed | `jest-final.log` |
| Node security, real Redis account/match/array, Yinsh | 58 passed, zero failed/skipped | `node.log` |
| Production build after placement correction | Passed | `build-final.log` |
| Scoped lint on all API/server and relevant account/match/design files | Zero errors, eight inherited hook warnings | `lint-final.log` |
| Browser-expression fixture lint | Passed with only the standalone-expression rule disabled | `lint-browser-expression.log` |
| Real loopback HTTP handlers | Auth, isolation, claim budgets, provider-error redaction and real AI workers passed | `http.log` |
| Final production account browser | Every assertion passed; mountClaims=0 | `account-browser-final.log` |
| Four-game persistence browser | Reload, second device, offline drain, conflict preservation passed | `match-browser.log` |
| Explicit guest import | Default off, explicit import, repeat preserving account edits passed | `match-import-browser.log` |
| Synthetic design fixture | Keyboard, mode/confirmation, consent, 480/320 overflow, reduced motion passed | `design-browser.log` |
| Actual production design + six guest routes | 1280/480/320, focus, consent, errors, confirmation, warning, no overflow; all six real game wrappers passed | `production-design.log` |

Full commands:

```sh
CI=true npm test -- --watchAll=false --runInBand
npm run build
GIPF_TEST_REDIS_CONTAINER=gipf-test-design-22 /opt/homebrew/opt/node@22/bin/node \
  --test --test-concurrency=1 tests/public-security.test.mjs \
  tests/ai-security.test.mjs tests/account-redis.test.mjs \
  tests/profile-arrays-redis.test.mjs tests/match-redis.test.mjs tests/test_yinsh_api.mjs
```

The fixed-name array and match Redis tests used newly created disposable containers
`gipf-r22-address-synthetic-redis` and `gipf-pr5-synthetic-redis`. Account and match
browser fixtures used separate `gipf-test-design-browser-22` and
`gipf-test-design-match-22` containers, avoiding cross-suite data resets.
Browser wrappers change only local origin, container and module import paths.
Browser traffic outside loopback was blocked; server providers were synthetic.
The four-game run began before the JSX placement correction; its final shared-tab
account transition used the rebuilt assets. The final account, explicit import,
production design and full Jest runs use the corrected implementation.

The account browser covers explicit guest import, cross-device API/Lichess keys
and scores, logout cleanup, A/B isolation, encrypted recovery, explicit cloud
conflicts, six Chess mounts with zero claims, empty claims and later migration.
The match run also checks stable Chess statistics, malformed/future snapshot
backup, visible quota failure with local play mounted, and shared-device identity
transition protection. Guest launches establish route and mounted-board behavior;
they do not claim full manual play-through of every engine.

Inspected production screenshots include `production-320.png` and
`production-form-1280.png`: readable catalogue, no clipped fields, visible focus,
error and warning, optional account area after games. Additional screenshots at
all three widths are beside the logs. Synthetic fixture contrast assertions use
literal palette pairs, not computed styles; their minimum is 5.37:1. Production
layout was checked separately with actual Tailwind preflight.

Build retains inherited Browserslist/CRA dependency and chess.js source-map
warnings. Broad lint initially rejected the existing standalone arrow-function
browser fixture under `no-unused-expressions`; its intentionally evaluable format
is retained and that one rule is disabled only for its separate lint invocation.

## External fonts, trackers, CSP and release boundary

No external fonts, trackers, third-party scripts, dependencies, or CSP changes
were introduced. LandingPage uses installed Georgia/Avenir Next/Trebuchet fonts
and local decorative SVGs. Its stylesheet has no remote imports or URLs.
The unchanged HTML shell still requests Google Fonts (Syne, Outfit, Cormorant
Garamond), even though the catalogue uses local fonts. The actual production
browser observed and blocked that request plus the inherited Stockfish CDN URL;
it observed no tracker request in the exercised paths. This bounded observation
is not an audit of every optional game feature.

Vercel headers/config and existing CSP absence remain unchanged. The accepted
operations document still defers CSP pending Google Fonts, Stockfish CDN/blob
workers, ONNX/WASM and subpath/rewrite inventory. This work neither weakens nor
establishes a CSP. Hosted identity through both hostnames/rewrite, security headers,
worker bundling/deadlines, durable Redis configuration, fixed legacy claim dates,
and hosted payload/latency checks remain coordinator-owned release gates.
Keep the public gate and draft status until those independent requirements pass.
