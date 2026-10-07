# Instructions for AI Coding Agents

Critical instructions for AI agents (Claude, Cursor, Copilot, etc.) working on this codebase.

---

## Project Overview

Play is a multi-game React application hosting browser-based implementations of board games. Currently includes Yinsh, Zertz, Chess, Catan, Splendor, and Diplomacy. Games are code-split and served from the root of one public deployment (play.ramia.us) with client-side routing. Accounts are optional Auth0 sign-in; every game plays as a guest.

**Key Concepts:**
- **Multi-game monorepo**: Each game lives in `src/games/<name>/` with its own logic, UI, CSS, and tests
- **Shared infrastructure**: Routing, Tailwind, fonts, and deployment config are at the project root
- **Separation of concerns per game**: `<Game>Board` (logic) / `<Game>Game` (UI) are independent modules
- **CSS isolation**: Each game scopes its CSS variables under `.game-<name>` to prevent conflicts
- **Code splitting**: `React.lazy()` ensures visiting one game doesn't load another's bundle

**Tech Stack:**
- React 18 (CRA) + React Router 6 + Tailwind CSS
- SVG rendering for hexagonal boards
- MCTS AI engines: YINSH and ZERTZ use game-tree MCTS; CATAN and SPLENDOR use a maxⁿ PUCT game-tree MCTS (per-player win-probability value, pluggable heuristic-rollout or NN evaluator). CATAN has dice chance nodes; SPLENDOR has none (deck order is its only hidden info, handled by determinization)
- Neural network: PyTorch training pipeline -> ONNX export -> onnxruntime-web browser inference
- Vercel serverless functions for API-mode AI
- Jest + React Testing Library (full suite auto-discovered across all game subdirs)

**Documentation:**
- [README.md](README.md) - Project overview for external users
- [docs/architecture.md](docs/architecture.md) - Codebase architecture and design
- [docs/ai-engine.md](docs/ai-engine.md) - AI system internals
- [docs/catan.md](docs/catan.md) - Catan rules coverage and AI/training details
- [docs/splendor.md](docs/splendor.md) - Splendor rules coverage and AI/training details
- [docs/diplomacy.md](docs/diplomacy.md) - Diplomacy rules coverage and AI/agents details
- [docs/notation.md](docs/notation.md) - Move notation specification (Yinsh)
- [docs/agents.md](docs/agents.md) - Practical development guide for AI agents
- [docs/public-accounts.md](docs/public-accounts.md) - Accounts, sessions, key custody and server contracts
- [docs/games-migration.md](docs/games-migration.md) - `/migration` export, staging and activation
- [docs/resumable-matches.md](docs/resumable-matches.md) - Match snapshots, sync and recovery

---

# Development Workflow

1. **Edit code**
2. **Test**: `CI=true npm test` (the full suite must pass)
3. **Build**: `npm run build` (must complete without errors)
4. **Manual test**: Play through game in browser (`npm start`)
5. **Release**: open a PR against `main`; merging it deploys to production (see [Deployment and ramia.us](#deployment-and-ramiaus))

## Deployment and ramia.us

This repository is public and open source. Everything here, including these
instructions, is readable by anyone, so never commit secrets, environment values,
personal data, or details of private infrastructure.

**What runs where.** The author's instance is `https://play.ramia.us`, one Vercel
project that builds production from `main` and serves the app from the domain root,
ungated. `main` is the release branch: merging a PR to `main` deploys to production, so
open PRs against `main` and treat the merge as the release. There is no other
deployment; `ramia.us/play` only redirects here, and nothing in this repo should use it
as a route or prefix.

**Relationship to the rest of ramia.us.** play.ramia.us is one app on the author's
personal domain. Routing for the wider domain (redirects such as `ramia.us/play`) and the
shared sign-in that the author's other apps use (for example home.ramia.us) live in a
separate private repository. Changes there aren't made from here. What this repo relies
on from that setup is a small contract, listed below; if you think it needs to change,
say so rather than working around it in this code.

- **Sign-in is optional.** Every game plays as a guest. Signing in uses OpenID Connect
  against an Auth0 tenant that the author's other apps share, through this app's own
  dedicated Auth0 application (Regular Web Application). If the visitor already has an
  Auth0 session on that tenant, for example from signing in at home.ramia.us, this app
  signs in silently with `prompt=none` (`src/silentSignIn.js`); otherwise it shows a
  Sign in button. Signing in here grants nothing elsewhere.
- **Callback URL.** The Auth0 application allows exactly one callback,
  `<production origin>/api/auth/callback`. The production origin is the constant
  `PRODUCTION_ORIGIN` in `server/session.js`; the silent sign-in host is
  `SILENT_HOST` in `src/silentSignIn.js`. Sign-in completes only on that origin, so
  preview deployments cannot sign in. Test sign-in with the synthetic provider
  (`tests/auth-oidc-redis.test.mjs`, `tests/auth-browser.mjs`).
- **Game catalogue.** `public/tiles.json` is generated from `src/games-registry.js` by
  the `prebuild` step (`scripts/emit-tiles.mjs`); each href is the game's root route.
  Portals (the author's home.ramia.us is one) read `<production origin>/tiles.json` and
  resolve each href against that origin, so adding a game to the registry is all it
  takes to appear there.
- **Paths.** Code uses root-absolute paths: `/api/x`, `/models/x.onnx`,
  `<BrowserRouter>` with no basename.

**Configuration is environment variables only.** No deployment-specific value is
committed. The server reads these names (set them for Production and Preview; values
live in the hosting provider, never in the repo):

| Variable | Purpose |
|---|---|
| `AUTH0_ISSUER_BASE_URL` | Auth0 tenant URL (issuer) |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | This app's own Auth0 Regular Web Application |
| `GAMES_SESSION_SECRET` | 32+ characters; seals the short-lived sign-in transaction cookie |
| `GAMES_KEY_ENCRYPTION_KEY` | Base64 of 32 random bytes; encrypts account-held API keys |
| `GAMES_KEY_ENCRYPTION_KEY_VERSION`, `GAMES_KEY_ENCRYPTION_KEY_V<n>` | KEK version, and earlier KEKs kept readable during rotation (`scripts/rotate-games-keys.mjs`) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Redis REST store for accounts, sessions, profiles and rate limits (the `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aliases also work; see `server/publicSecurity.js`) |

`VERCEL`, `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_BRANCH_URL` are set by the platform.
Everything fails closed: without the Auth0 variables sign-in redirects back to `/login`
with an "unavailable" notice; without the store the account and profile endpoints return
503; without the KEK account keys return 503. Guest play is unaffected in every case.
Previews share the production store, so hosted checks use synthetic data only.

**Running your own copy.** A fork can deploy with its own Auth0 tenant and its own
Redis/Upstash store: create a Regular Web Application whose only callback is
`https://<your host>/api/auth/callback`, set `PRODUCTION_ORIGIN` and `SILENT_HOST` to your
host, and set the variables above. Beyond those two constants, `ramia.us` appears only
in user-facing copy (the sign-in wording in `src/LoginPage.jsx`), comments,
the PGN `Site` tag (`src/games/chess/coach/pgn.js`) and test fixtures.

Use the below guidelines when executing tasks or pursuing goals that have more than basic complexity. These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

---

## Game Rules Are Sacred

**Never break core game mechanics.** These are faithful implementations of real board games -- rule violations break the entire experience.

Before modifying game logic for either game:
- Read the relevant `<Game>Board.js` to understand current rules
- Read [docs/architecture.md](docs/architecture.md) for the game's state machine
- Run the full test suite
- Verify changes against official game rules

**Yinsh Row Resolution Queue** (the trickiest part):
- When a move creates rows, a queue is built: active player's rows first, then opponent's
- Player selects ONE row at a time for removal
- After each removal, re-check for new rows (added to FRONT of queue)
- Continue until queue empty, then remove-ring phase, then back to play

**Zertz Forced Captures** (key rule):
- After placing a marble + removing a ring, check for jumps
- If any jump is available for the current player, they MUST jump (forced capture)
- Multi-jump sequences are supported -- a marble can continue jumping
- Isolated rings (disconnected from the main board) are captured along with their marbles

---

## Common Mistakes to Avoid

1. **Modifying game logic without running tests** -> Always run `CI=true npm test`
2. **Mixing UI code into Board classes** -> Board classes are pure logic, no React
3. **Forgetting `_captureState()` after state changes** -> Breaks undo/redo
4. **Forgetting `.clone()` after mutating board** -> UI won't re-render
5. **Breaking localStorage keys** -> Users lose their preferences and scores
6. **Pushing without testing** -> Vercel does NOT run tests, broken code goes live
7. **Making `getBestMove()` sync** -> It's `async` (returns Promise). Always `await` it
8. **Forgetting to update both valueNetwork.js and valueNetworkNode.js** -> Browser uses onnxruntime-web, CLI scripts use onnxruntime-node
9. **Adding CSS variables to `:root`** -> Use `.game-<name>` scoping instead
10. **Importing one game's code from another** -> Games must be fully independent

---

## Key Files

### Project Root

| File | Purpose |
|------|---------|
| `src/App.jsx` | React Router with lazy-loaded game routes |
| `src/LandingPage.jsx` | Landing page linking to each game + a single "Sign in" / account link to `/login` |
| `src/LoginPage.jsx` | `/login`: the only place to sign in (Auth0, the ramia.us sign-in), sign out (here or everywhere), and enter the Anthropic key and Lichess token (held server-encrypted on the account when signed in, device-only for guests) |
| `api/auth.js`, `server/auth0.js` | Auth0 login, callback and logout (openid-client: code + PKCE, state, nonce, RS256 signature, verified email) |
| `api/session.js`, `server/session.js` | Sign-in sessions: opaque cookie, 30-day idle / 90-day absolute expiry, sign-out everywhere index, CSRF checks; `establish` hands the device its seal key |
| `server/identity.js`, `server/keyCustody.js` | One identity per Auth0 subject and its data id; AES-256-GCM key custody (AAD bound to identity, slot and key version; KEK rotation) |
| `server/accountKeys.js`, `src/accountKeys.js` | The proxies' key lookup (body key for guests, account key for a session) and the browser's which-keys-exist marker |
| `server/publicSecurity.js`, `server/cors.js` | Shared API boundary (JSON-only bodies, size limits, Redis rate limits, session `authenticate`) and the CORS helper (local dev origins only; production is same-origin) |
| `src/loginReturn.js` | `/login?return=` allowlist (exact `games-registry.js` paths, else `/`) and `loginHref()`, which games use for their "Sign in / add key" link |
| `src/landing.css` | Scoped catalogue and optional account presentation styles |
| `src/account.js` | The one account module: Auth0 sign-in completion, sign-out, account keys, recovery sealing, and the startup drop of an unreadable stored session (chess's `engine/account.js` re-exports it) |
| `src/MatchBoundary.jsx` | Match hydration, persistence context, conflict choices, and recovery UI |
| `src/matchStore.js` | Account-bound local match storage, recovery alternatives, and cloud CAS requests |
| `src/matchSchema.js` | Shared versioned match envelope and size/field validation |
| `src/snapshotValidation.js` | Shared snapshot state/UI validation helpers for game adapters |
| `src/matchBoundary.css` | App-level match chrome with scoped light/dark theme variables |
| `server/matchValidation.js` | Server match validation using each game's decoder |
| `server/chessLogValidation.js` | Bounded validation of existing Chess finished-game statistics |
| `src/index.css` | Tailwind directives + shared keyframes only |
| `vercel.json` | API rewrites + SPA catch-all for client-side routing |
| `src/games-registry.js` | The one list of games — read by the landing page and by the tile-manifest build step |
| `scripts/emit-tiles.mjs` | `prebuild` step writing `public/tiles.json` (root hrefs) for the Home landing page |
| `public/index.html` | HTML shell with Google Fonts (Syne + Outfit) |
| `tailwind.config.js` | Font families (display, heading, body) |
| `jest.config.js` | Test config (auto-discovers `*.test.js` in all subdirs) |

App-owned match boundary and snapshot-validation modules are imported directly by
the game UIs and adapters; game engines remain self-contained with no imports
between game directories. The same holds for the account module: one app-level
`src/account.js`, which Chess re-exports, `src/loginReturn.js` for the games' `/login` links,
and `src/accountKeys.js`, which the games' key clients read to know an account key exists.

### Yinsh (`src/games/yinsh/`)

| File | Purpose |
|------|---------|
| `YinshBoard.js` | Pure game logic -- state, rules, phases (no React) |
| `matchSnapshot.js` | Portable board encoding and validated match restoration |
| `YinshGame.jsx` | React UI -- SVG board, modals, interaction handlers |
| `YinshNotation.js` | Chess-style move notation system |
| `yinsh.css` | Scoped CSS variables (`.game-yinsh`) + animations |
| `engine/mcts.js` | MCTS AI engine -- search, evaluation, heuristics + NN |
| `engine/features.js` | Feature extraction for NN input tensors |
| `engine/valueNetwork.js` | Browser ONNX inference (onnxruntime-web) |
| `engine/valueNetworkNode.js` | Node.js ONNX inference (onnxruntime-node) |
| `engine/aiPlayer.js` | Shared AI move interface for UI and CLI scripts |
| `hooks/useAIWorker.js` | React hook managing MCTS Web Worker lifecycle |
| `YinshBoard.test.js` | Jest tests covering all yinsh game logic |
| `testHelpers.js` | Test utilities and board state fixtures |

### Zertz (`src/games/zertz/`)

| File | Purpose |
|------|---------|
| `ZertzBoard.js` | Pure game logic -- rings, marbles, captures (no React) |
| `matchSnapshot.js` | Portable board encoding and validated match restoration |
| `ZertzGame.jsx` | React UI -- SVG hex board, modals, interaction handlers |
| `zertz.css` | Scoped CSS variables (`.game-zertz`) + animations |
| `ZertzBoard.test.js` | Jest tests covering all zertz game logic |

### Chess (`src/games/chess/`)

| File | Purpose |
|------|---------|
| `ChessBoard.js` | Pure game logic over chess.js -- moves, draws, undo/redo, PGN, clone (no React) |
| `matchSnapshot.js` | Portable board encoding and validated match restoration |
| `ChessGame.jsx` | React UI (react-chessboard) -- play, coaching panel, puzzles, PGN, accuracy |
| `chess.css` | Scoped CSS variables (`.game-chess`) + animations |
| `ChessBoard.test.js` | Jest tests for chess game logic |
| `engine/stockfishLoader.js` | Loads Stockfish from a CDN in a Blob Web Worker (no bundled binary) |
| `engine/uci.js` | Pure UCI parsing (info / bestmove / MultiPV) + `chooseWeakenedMove` (sub-1320 sampling) |
| `engine/difficulty.js` | Named tiers -> UCI_Elo; `RATING_LADDER` (Rated-mode opponents 800-3000) |
| `engine/rating.js` | Pure Elo math: K-factor, expected score, `updateRating`, `nearestRung`, `mergeRating` |
| `engine/profileSync.js` | Cross-device profile sync client for the signed-in account (rating + opponent history + puzzles + mistakes; merges stored `legacyProfiles` copies) |
| `engine/account.js` | Re-export of the app-level `src/account.js` |
| `engine/playerHistory.js` | localStorage store: per-opponent W/L/D history (`chessOppHistory`) |
| `coach/motifs.js` | Pure chess.js position facts (hanging piece, fork, pin, king-shelter, development) feeding the keyless commentary |
| `coach/tacticSolver.js` | Depth-limited material search verifying non-mate tactical puzzles (mirrors `mateSolver.js`) |
| `coach/gameHistory.js` | Finished-game log + accuracy trend / opening report card aggregation (`chessGameLog`) |
| `coach/repertoire.js` | Pinned openings per colour, self-populating suggestions, adherence + live deviation hints |
| `components/ProgressPanel.jsx` | Cross-game progress: accuracy sparkline, trend, per-opening report card with drill entry |
| `hooks/useStockfish.js` | Engine lifecycle; `getMove()` (opponent) + `analyze()` (coaching), serialized |
| `coach/*.js` | classify, analyzeMove, templates, coachClient, openings, pgn, accuracy, puzzles, material, sound |
| `api/chessCoach.js` | Vercel serverless coach (Claude API, **bring-your-own key**, no server fallback) |
| `api/chessProfile.js` | Authenticated, revisioned Chess profile and separate four-game settings scope (Chess, Yinsh, Zertz, Catan; Splendor preferences stay on the device), match scope and `/migration` activation. See `docs/public-accounts.md` |
| `api/chessAccount.js` | Signed-in account keys (`setKeys`, stored server-encrypted); any other action is 400 |

See [docs/chess.md](docs/chess.md) for the engine + coaching pipeline and the BYO-key security model.

**Rated mode** (`chessRated`/`chessRating`/`chessRatedGames`): a single Elo that
updates from wins/losses/draws vs a matched `RATING_LADDER` rung. Undo/flip/coach/eval
are locked out while rated. Cross-device sync goes through the authenticated profile
endpoint `api/chessProfile.js` (rating, opponent history, puzzle/mistake progress). Sync needs a Redis REST store
(`KV_REST_API_URL` + `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` aliases);
without it the endpoints return 503 and ratings persist in localStorage only. An
account, signed in through Auth0 at `/login`, also carries the API key + Lichess
explorer token + profile across devices; the HttpOnly session cookie set by the
Auth0 callback authorizes everything after. The coach reaches the Lichess explorer
through `api/chessCoach.js` (`mode: 'explorer'`) when the token is on the account.
Public IDs never authorize persistence. See [docs/public-accounts.md](docs/public-accounts.md).

### Catan (`src/games/catan/`)

| File | Purpose |
|------|---------|
| `CatanBoard.js` | Pure 3-6 player Catan rules engine -- setup, production, robber, builds, dev cards, P2P trades, discard, awards |
| `matchSnapshot.js` | Portable board encoding and validated match restoration |
| `CatanGame.jsx` | React UI -- SVG board, player panels, controls, AI turn loop, rules-help chat |
| `catan.css` | Scoped CSS variables (`.game-catan`) + animations |
| `engine/mcts.js` | PUCT game-tree MCTS (maxⁿ value, dice chance nodes, heuristic-rollout/NN evaluator) |
| `engine/features.js` | Self-play feature extraction and policy targets |
| `hooks/useAIWorker.js` | React hook managing Catan MCTS Web Worker lifecycle |
| `coach/rulesClient.js` | Rules-assistant client + BYO Anthropic key storage (shared `playApiKey`, reused across chess + Catan) |
| `api/catanRules.js` | Vercel serverless rules assistant (Claude API, **bring-your-own key**, ruleset-aware) |
| `CatanBoard.test.js` | Jest tests covering core Catan logic and AI legality |
| `CatanConformance.test.js` | Official-rules conformance tests + seeded self-play invariant soak |

See [docs/catan.md](docs/catan.md) for rule coverage and AI/training details.

### Splendor (`src/games/splendor/`)

| File | Purpose |
|------|---------|
| `SplendorBoard.js` | Pure 2-4 player base-game rules engine -- token takes, reserve+gold, validated chosen-or-automatic payment buys, discard, nobles, final-round end + tiebreak |
| `matchSnapshot.js` | Portable board encoding (hidden decks included) and strict validated match restoration |
| `splendorCards.js` | Canonical 90-card deck, 10 nobles, token/noble setup constants (cross-validated, test-locked) |
| `SplendorGame.jsx` | React UI -- card market, token bank, player panels, payment chooser, AI turn loop, offline quick rules + rules-help chat |
| `splendor.css` | Scoped CSS variables (`.game-splendor`) + animations |
| `engine/mcts.js` | maxⁿ PUCT game-tree MCTS (no chance nodes; determinization for hidden deck/reserves; heuristic-rollout/NN evaluator) |
| `engine/features.js` | Self-play feature extraction and policy targets |
| `hooks/useAIWorker.js` | React hook managing Splendor MCTS Web Worker lifecycle |
| `coach/rulesClient.js` | Rules-assistant client + BYO Anthropic key storage (shared `playApiKey`) |
| `api/splendorRules.js` | Vercel serverless rules assistant (Claude API, **bring-your-own key**) |
| `SplendorBoard.test.js` | Jest tests: data invariants, full rules, AI legality, self-play termination |

See [docs/splendor.md](docs/splendor.md) for rule coverage and AI/training details.

### Diplomacy (`src/games/diplomacy/`)

| File | Purpose |
|------|---------|
| `DiplomacyBoard.js` | Pure seven-power rules engine -- 1901 Europe map, armies/fleets, hold/move/support/convoy, simultaneous adjudication, retreats, Winter builds/disbands, split coasts (STP/SPA/BUL), serialize/restore |
| `DiplomacyGame.jsx` | React UI -- SVG map, order entry, negotiation/chat panel, turn loop, save/resume |
| `diplomacy.css` | Scoped CSS variables (`.game-diplomacy`) + animations |
| `engine/` | Tactical best-response order AI (`aiPlayer.js`) + Web Worker (`mcts.worker.js`) |
| `agents/` | Conversational LLM agents -- personas, memory, AI-to-AI negotiation, trust/betrayal model, intent binding, chat panel |
| `hooks/` | React hooks -- AI worker lifecycle (`useAIWorker.js`) + turn-loop controller (`useDiplomacyTurn.js`) |
| `api/diplomacyAgent.js` | Vercel serverless conversational agent (Claude API, **bring-your-own key**) |

See [docs/diplomacy.md](docs/diplomacy.md) for rule coverage and AI/agents details.

### Infrastructure

| File | Purpose |
|------|---------|
| `api/aiMove.js` | Vercel serverless function for Yinsh API-mode AI |
| `scripts/*.mjs` | Self-play, training data generation, tournaments |
| `training/` | PyTorch model, training loop, ONNX export |
| `public/models/*.onnx` | Deployed neural network models |

### Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Dev server on localhost:3000 |
| `CI=true npm test` | Full test suite (must all pass) |
| `npm run test:engine` | MCTS-specific engine tests |
| `npm run build` | Production build |
| `npm run generate-data` | Generate self-play training data (NDJSON) |
| `npm run tournament` | Head-to-head: heuristic vs NN MCTS |
| `npm run self-play` | AI vs AI self-play evaluation |
| `npm run catan:self-play` | Generate Catan self-play training data |
| `npm run catan:tournament` | Strong-vs-baseline Catan AI evaluation |
| `npm run splendor:self-play` | Generate Splendor self-play training data |
| `npm run splendor:tournament` | A-vs-B Splendor AI evaluation (NN vs heuristic, etc.) |

---

## Architecture -- Must Understand

### Routing

```
/           -> LandingPage (always in main bundle)
/login      -> LoginPage (sign in/out, account and keys; ?return=/<game> from the registry)
/yinsh      -> YinshGame (lazy-loaded chunk)
/zertz      -> ZertzGame (lazy-loaded chunk)
/chess      -> ChessGame (lazy-loaded chunk)
/catan      -> CatanGame (lazy-loaded chunk)
/splendor   -> SplendorGame (lazy-loaded chunk)
/diplomacy  -> DiplomacyGame (lazy-loaded chunk)
/migration  -> GamesMigration (outside the account boundary; local export/stage, authenticated activation)
```

`React.lazy()` with `<Suspense>` ensures code splitting. Visiting `/zertz` does NOT load the yinsh MCTS engine bundle. The `vercel.json` catch-all rewrite ensures direct URL access works.

### CSS Isolation

Each game scopes its CSS variables under a wrapper class:
```
.game-yinsh { --color-bg-page: ...; }
.game-yinsh.dark { --color-bg-page: ...; }
.game-zertz { --color-bg-page: ...; }
.game-zertz.dark { --color-bg-page: ...; }
.game-catan { --color-bg-page: ...; }
.game-catan.dark { --color-bg-page: ...; }
.game-splendor { --spl-bg: ...; }
.game-splendor.dark { --spl-bg: ...; }
.game-diplomacy { --dip-bg: ...; }
.game-diplomacy.dark { --dip-bg: ...; }
```

Animations are also prefixed (`yinsh-piece-fade-in`, `zertz-piece-fade-in`) and scoped (`.game-yinsh .piece-enter`). The shared `slide-in-right` keyframe lives in `index.css`.

App-level match chrome uses `.match-chrome` / `.match-chrome.dark` and `--match-*`
variables in `src/matchBoundary.css`, separate from the game wrappers.

When adding new CSS for a game, always scope it under the game's wrapper class.

### Yinsh Coordinate System

Axial hexagonal coordinates `(q, r)` with q, r in [-5, 5] and 8 corners excluded (85 valid intersections, 51 playable).

```
Storage:   boardState["q,r"] -> {type: 'ring'|'marker', player: 1|2}
Screen:    x = q * 50 + r * 25 + 300,  y = r * 43.3 + 300
Directions: [1,0] [0,1] [-1,1] [-1,0] [0,-1] [1,-1]
```

### Zertz Coordinate System

Axial hexagonal coordinates `(q, r)` where `max(|q|, |r|, |q+r|) <= 3` (37 positions).

```
Storage:   rings = Set of "q,r" keys; marbles["q,r"] = 'white'|'grey'|'black'
Screen:    x = 34 * (sqrt(3)*q + sqrt(3)/2*r),  y = 34 * 1.5 * r
Directions: [1,0] [-1,0] [0,1] [0,-1] [1,-1] [-1,1]
```

### State Flow (Both Games)

```
User Click -> <Game>Game.handleClick()
           -> <Game>Board.handleClick(q, r)  [mutates internal state]
           -> <Game>Board._captureState()     [save for undo/redo]
           -> setBoard(board.clone())         [React re-render]
```

The Board class is the single source of truth. React state is just a copy for rendering.

### Yinsh AI Flow

```
User clicks "AI Suggest" -> Worker: MCTS.getBestMove(board, simulations)
                         -> Returns {move, destination, confidence}
User clicks "AI Move"    -> board.handleClick() with AI's chosen move
                         -> UI updates
```

Two execution modes: `local` (Web Worker, 200 sims) and `api` (Vercel serverless, 30-500 sims).

Two evaluation modes (toggled in Settings):
- **Heuristic** (default): 12-move rollouts with hand-crafted scoring
- **Neural Network**: ONNX value network predicts position value directly

### localStorage Keys

**Yinsh:**
```
yinshDarkMode, yinshShowMoves, yinshRandomSetup,
yinshKeepScore, yinshWins, yinshShowMoveHistory,
yinshEvaluationMode,
yinshVariant,                # Variant for the next New Game: standard | blitz
yinshMatch:v1, yinshMatchSync:v1, yinshMatchRecovery:v1
```

**Zertz:**
```
zertzDarkMode, zertzShowMoves,
zertzMatch:v1, zertzMatchSync:v1, zertzMatchRecovery:v1
```

**Chess:**

```
chessDarkMode, chessShowMoves, chessDifficulty, chessLearningGoal,
chessShowEvalBar, chessSound,
chessRated, chessRating, chessRatedGames,  # Rated mode: toggle, current Elo, games played
chessMistakes,                             # Mistake library: captured positions + review schedule
chessOppHistory,                           # Per-opponent W/L/D record (casual tiers + rated rungs)
chessPuzzleProgress,                       # Puzzle trainer: player puzzle Elo + per-puzzle review schedule
chessGameState,                            # Legacy source; converted once when chessMatch:v1 is absent
chessMatch:v1, chessMatchSync:v1, chessMatchRecovery:v1,
chessStatsRecovery:v1,                     # Retained finished-game log alternatives
chessGameLog,                              # Finished games (capped) feeding the cross-game progress panel
chessRepertoire,                           # Openings the player intends to play, per colour (adherence + deviation nudges)
chessTimeControl,                          # Optional clock: off | 3+2 | 5+0 | 10+0 | 15+10
chessPuzzleShowTheme,                      # Opt in to seeing the puzzle theme/mate-in-N before solving
chessIntroSeen, chessKeyNudgeDismissed     # One-time onboarding banner + BYO-key nudge dismissals
chessGameTab                               # Game panel tab: play | train
```

**Catan:**

```
catanDarkMode, catanShowMoves, catanDifficulty, catanRulesetId,
catanPlayerCount, catanScenarioId,
catanMatch:v1, catanMatchSync:v1, catanMatchRecovery:v1
```

**Splendor:**

```
splendorDarkMode, splendorDifficulty, splendorPlayerCount,
splendorMatch:v1, splendorMatchSync:v1, splendorMatchRecovery:v1
```

**Diplomacy:**

```
diplomacyDarkMode, diplomacyShowOrders,
diplomacySettings,    # new-game setup: power, difficulty, personaSpice, maxYears
diplomacyGameState    # versioned in-progress save (board snapshot + UI phase + controllers)
```

**Shared (app-wide):**

```
playApiKey   # one BYO Anthropic key, used by the chess coach, the Catan and
             # Splendor rules chats, and Diplomacy negotiation. Entered only at
             # /login (synced encrypted when signed in, device-only for guests). Per-game chessApiKey /
             # catanApiKey values are moved into it on first read. Each game keeps an identical
             # copy of the storage helper (no cross-game import).
play:account-transition # Temporary account-switch lease marker {id, until}
playAccount  # cached account session {v:3, username, usernameId, sid}: no
             # secret. The server session is the HttpOnly __Host-games_session
             # cookie; the seal key is a non-extractable CryptoKey in IndexedDB.
             # Any other stored shape is removed at startup (progress stays as
             # guest progress). Written only by /login; games read it and link to
             # /login?return=/<game> for sign-in and keys. Signing
             # out clears credentials and visible progress; outgoing progress
             # is retained encrypted in play:recovery:<usernameId>.
```

Never rename or restructure these without migration logic. `src/storageRename.js` is the
pattern: imported first by `src/index.js`, it moves the legacy `gipf*` / `gipf:*` keys in
localStorage and sessionStorage to their `play` names, idempotently, keeping any value
already under the new name. The `gipf-account` IndexedDB database moves to `play-account`
the first time `src/account.js` opens the key store, not at startup.

The server's Redis keys share the `play:` prefix. Domain-separation strings fed to hashes
and encryption (`gipf-games-identity:v1` in `server/identity.js`, `gipf-games-key:v1` in
`server/keyCustody.js`, `gipf-games` in `server/auth0.js`) keep their original values: they
are part of the stored data's format, and changing one would orphan every identity or
make every stored key undecryptable.

---

## Testing

```bash
CI=true npm test              # Full Jest suite -- all tests must pass
npm test -- --watch           # Watch mode for development
npm run test:engine           # MCTS engine tests
node --test tests/public-security.test.mjs tests/ai-security.test.mjs tests/test_yinsh_api.mjs tests/emit-tiles.test.mjs

# Server suites against real Redis: a disposable play-test-* container only (they FLUSHDB it), one file at a time.
export PLAY_TEST_REDIS_CONTAINER=play-test-local
docker run --rm -d --name "$PLAY_TEST_REDIS_CONTAINER" redis:7-alpine
node --test --test-concurrency=1 tests/auth-oidc-redis.test.mjs tests/account-redis.test.mjs tests/session-redis.test.mjs tests/match-redis.test.mjs tests/profile-arrays-redis.test.mjs tests/migration-activation-redis.test.mjs

# Real sign-in in Chromium against a synthetic provider (needs the build and Playwright's index.mjs).
npm run build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/auth-browser.mjs
docker stop "$PLAY_TEST_REDIS_CONTAINER"

# Lint (the repo has no default ESLint config; this is the project config).
./node_modules/.bin/eslint --no-eslintrc --config tests/security-eslint.cjs --resolve-plugins-relative-to . <files>
```

Other browser fixtures (`tests/*-browser.mjs`, served by `tests/serve-public-security.mjs`)
are described in `docs/public-accounts.md`, `docs/resumable-matches.md` and
`docs/games-migration.md`.

**Before any deployment, ALL of these must be true:**
- [ ] `CI=true npm test` -- full suite passing
- [ ] Server suites passing when `api/`, `server/` or account code changed
- [ ] `npm run build` -- completes without errors
- [ ] Manual play-through of modified game(s) in browser

---

## Deployment

Merging to `main` deploys production (see [Deployment and ramia.us](#deployment-and-ramiaus)).
There is no CI gate -- **you are the gate**: run every check above before a PR is merged,
and never push directly to `main`.

Rollback: note the current production deployment before merging (`vercel inspect
<production host>` from a checkout linked to the Vercel project), and roll back with
`vercel rollback <deployment-url-or-id>` or by promoting that deployment in the Vercel
dashboard. A rollback restores the previous build; it does not undo store changes.

CORS is one shared helper, `server/cors.js`, used by every serverless endpoint. Its
allowlist holds only local development origins: the app calls its own origin, so
production needs no CORS entry.

---

## Adding a New Game

To add a new GIPF Project game (e.g., DVONN, TZAAR):

1. Create `src/games/<name>/` with `<Name>Board.js`, `<Name>Game.jsx`, `<name>.css`, `<Name>Board.test.js`
2. Scope all CSS under `.game-<name>` and `.game-<name>.dark`
3. Add the wrapper class to the root div in `<Name>Game.jsx`
4. Add `import './<name>.css'` to the game component
5. Add a lazy route in `src/App.jsx`
6. Add an entry to `src/games-registry.js` (the landing page and `tiles.json` read it)
7. Use `<name>` prefix for localStorage keys

Games must be fully self-contained -- no imports between game directories.

---

## Training Pipeline (Yinsh)

### Models and checkpoints

**Deployed champion**: `public/models/yinsh-value-v1.onnx` (the Expert tier; Easy and Advanced load
`yinsh-value-easy.onnx` and `yinsh-value-advanced.onnx`, see `DIFFICULTY_CONFIG` in `YinshGame.jsx`)
**Best checkpoint**: the path in `.deployed-checkpoint` (checkpoints and data are local, not committed)
**Automated loop**: `scripts/continuous-train.sh` (see `.claude/commands/train.md`)

### How to Continue Training

**Step 1: Generate self-play data**
```bash
node scripts/generate-training-data.mjs --games 50 --sims 200 \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/vNEXT_selfplay.ndjson
```

**Step 2: Combine with previous data**
```bash
cat data/vA_selfplay.ndjson data/vB_selfplay.ndjson > data/combined_vNEXT.ndjson
```

**Step 3: Train**
```bash
training/.venv/bin/python3 training/train.py \
  --data data/combined_vNEXT.ndjson \
  --checkpoint "$(cat .deployed-checkpoint)" \
  --augment --lr 2e-4 --epochs 40 --patience 12 \
  --output training/vNEXT.pt
```

**Step 4: Export to ONNX**
```bash
training/.venv/bin/python3 training/export_onnx.py \
  --checkpoint training/vNEXT.pt \
  --output public/models/yinsh-value-vNEXT.onnx
```

**Step 5: Tournament (only promote if new model wins)**
```bash
node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn \
  --model1 public/models/yinsh-value-vNEXT.onnx \
  --model2 public/models/yinsh-value-v1.onnx
```

### Key Learnings

1. Combined multi-gen data beats single-gen
2. `--augment` (6-fold hex rotation) is critical -- never skip
3. Always fine-tune from the best checkpoint
4. Lower LR (2e-4 to 5e-4) for mature models
5. Quality > quantity: 50 games at 200 sims beats 200 games at 50 sims
6. Val MSE doesn't predict tournament strength -- always verify with tournament

---

## Data Safety -- CRITICAL

APFS filesystem corruption can zero out training data and model checkpoints.

### Mandatory Safety Protocol

1. Before starting: Commit and push working code
2. After generating data: `file <path>` (zeroed files show as `empty`)
3. After training: `file training/vNEXT.pt` (valid = `Zip archive data`)
4. After ONNX export: `file public/models/yinsh-value-vNEXT.onnx` (valid = `data`)
