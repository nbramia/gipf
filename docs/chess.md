# Chess

Play chess against Stockfish with a running
teaching dialogue after every move. Self-contained under `src/games/chess/`,
following the suite conventions (pure-logic Board, scoped CSS, lazy route,
`chess`-prefixed localStorage, no cross-game imports).

## Architecture

```
src/games/chess/
  ChessBoard.js          # Pure game logic wrapping chess.js (no React)
  ChessGame.jsx          # React UI (react-chessboard) + coaching/puzzle/PGN wiring
  chess.css              # Scoped under .game-chess / .game-chess.dark
  ChessBoard.test.js
  engine/
    stockfishLoader.js   # Loads Stockfish from a CDN inside a Blob Web Worker
    uci.js               # Pure UCI parsing (info / bestmove / MultiPV)
    difficulty.js        # Named tiers -> UCI_Elo + per-move time; Rated ladder
    uci.test.js
    rating.js            # Pure Elo math + matchmaking for Rated mode
    profileSync.js       # Cross-device profile sync (rating + history + puzzles + mistakes)
    account.js           # Re-export of src/account.js (Auth0 sign-in completion, account keys)
    playerHistory.js     # localStorage: per-opponent W/L/D history (chessOppHistory)
  hooks/
    useStockfish.js      # Engine lifecycle; getMove() + analyze(); serialized
    useMistakeDrill.js   # Drill session state machine for the mistake library
  components/
    MistakeReviewPanel.jsx # Post-game mistake list with Retry
  coach/
    classify.js          # Eval-swing -> blunder..best; formatEval
    analyzeMove.js       # Build engine-grounded coaching payloads; pv -> SAN
    legalMoves.js        # Legal SAN moves of a FEN (grounds the prompt)
    richText.jsx         # Safe markdown-subset renderer for coach text
    templates.js         # Deterministic fallback prose (never fabricates)
    coachClient.js       # BYO key + POST /api/chessCoach + fallback + thread loop
    mistakeStore.js      # Persistent mistake library + spaced-repetition scheduler
    analysisTools.js     # analyze_position tool: Claude-callable Stockfish
    openings.js          # ECO opening detection
    pgn.js               # PGN import/export glue
    accuracy.js          # Post-game accuracy summary
    puzzles.js           # Rated mate-in-1/2/3 bank + solver & scripted-line checkers
    puzzleProgress.js    # Player puzzle Elo + per-puzzle spaced repetition + session selection
    puzzleCoach.js       # Staged no-spoiler hints + refutation-grounded fail coaching
    lichessPuzzle.js     # Lichess daily puzzle fetch + vetted parser
    mateSolver.js        # Exhaustive forced-mate search (vets puzzles)
    material.js          # Captured pieces + material balance
    sound.js             # WebAudio move cues
api/chessCoach.js        # Vercel serverless coach endpoint
api/chessProfile.js      # Vercel serverless profile sync endpoint (rating + history + puzzles + mistakes)
api/chessAccount.js      # Account keys (server-encrypted)
```

## Engine (Stockfish)

Stockfish is **not** bundled into the repo. `stockfishLoader.js` creates a
same-origin Blob Web Worker whose only job is `importScripts()` of the engine
from a CDN (`stockfish.js@10.0.2`). That build is a self-contained asm.js engine,
so it needs **no** `SharedArrayBuffer` and therefore **no** COOP/COEP headers —
it runs on any static host. The worker speaks UCI; `useStockfish` parses the
streamed `info`/`bestmove` lines via `engine/uci.js`.

Two entry points, both serialized through a promise queue so they never collide
on the single engine:

- `getMove(fen, tierKey)` — the opponent's move, played at the selected strength
  (`UCI_LimitStrength` + `UCI_Elo`).
- `analyze(fen, {multipv})` — **full-strength** analysis used for coaching, so
  move evaluation is honest regardless of opponent difficulty.

### Difficulty tiers

`engine/difficulty.js` maps named tiers to `UCI_Elo` and a per-move time budget:
Beginner 1320, Casual 1500, Intermediate 1750, Advanced 2100, Master 2850.

## Coaching pipeline

After every move (human and AI):

1. `analyze()` runs on the position **before** the move (MultiPV 3) and **after**
   it (MultiPV 1).
2. `coach/analyzeMove.js` turns that into a payload: real candidate moves with
   evals + principal variations (converted to SAN), the played move's resulting
   eval, and a classification from the eval swing (`coach/classify.js`).
3. `coach/coachClient.js` POSTs the payload to `/api/chessCoach`, which calls the
   Claude API and returns prose. On any failure it falls back to
   `coach/templates.js`, which assembles commentary **only** from the engine
   facts in the payload.

**Truthfulness:** every move named in commentary is a real MultiPV candidate and
every eval is the engine's own number. The template fallback cannot fabricate a
line, and the API prompt instructs the model to use only the supplied facts.
The payload also says who moved (`mover` engine/user, `playerColor`) so engine
moves are narrated as the opponent's, and carries the legal SAN moves of the
positions before and after the move (`coach/legalMoves.js`) so the model only
names moves that exist; the thread context gets the same. The classification
label is passed to the prompt and must agree with the prose. Replies are plain
text; `coach/richText.jsx` renders any stray markdown subset (bold, italic,
code, lists, line breaks) as React elements, never as HTML.

### Bring-your-own API key (security)

The app is open source and publicly shared, so there is **no maintainer key**:

- The key is entered only at `/login`. For a guest it stays in the browser,
  under a single slot shared across the whole app (`localStorage['playApiKey']`,
  read by `coach/coachClient.js`), and is sent per-request in the POST body to
  `/api/chessCoach` over HTTPS. A per-game key under `chessApiKey` or
  `catanApiKey` is moved into the shared slot the first time it's read. For a
  signed-in account the key is held encrypted on the server (see Accounts below).
- The server uses it for exactly one upstream call and **never** logs, persists,
  or reads a key from its own environment — there is no server-side fallback.
- It is never a `REACT_APP_` variable (those are bundled into client JS).
- CORS goes through the shared `server/cors.js` helper (local development
  origins only; production is same-origin).

If no key is set, the board, engine, and built-in (template) coaching all still
work.

## Move-thread Q&A (tool-use)

Any coached move can be expanded into a conversation ("Ask about this move").
This uses Claude **tool use**: Claude is given an `analyze_position` tool and
decides when it needs the engine, so it can check "what if" ideas live rather
than guessing.

Because Stockfish runs in the browser but Claude runs server-side, the loop is
**client-orchestrated** (`coach/coachClient.js → runThreadTurn`):

1. The client POSTs `{mode:'thread', context, messages, apiKey}` to
   `/api/chessCoach`, which forwards the conversation + tool schema to Claude and
   returns Claude's raw turn (`stop_reason` + `content`).
2. If `stop_reason === 'tool_use'`, the client runs the requested
   `analyze_position` call locally via `coach/analysisTools.js` (which applies any
   "what if" moves with chess.js and runs `useStockfish().analyze()`), then POSTs
   the `tool_result` back. This repeats (capped at a few rounds).
3. When Claude returns `end_turn`, its text is the answer.

`analyze_position` takes `{from: 'before'|'after', moves: [...], multipv}` — it
analyzes the position the move was played from (or the resulting position),
optionally after playing a short line. Every eval Claude cites therefore comes
from a real Stockfish search it requested; it **cannot fabricate** one (the same
truthfulness guarantee as the coaching pipeline, extended to the conversational layer). The system
prompt explicitly forbids stating an eval or line not obtained from the tool.

The full Anthropic message history (including tool calls/results) is kept on each
move's dialogue entry so the conversation has continuity. Threads are a key-only
feature — free-form Q&A has no template fallback. The endpoint marks the
move-context block with prompt caching so multi-round threads stay cheap.

## Game panel

The Game panel has two tabs. **Play** holds rated mode (with its rating card),
opponent strength, the clock and the colour choice. **Train** holds the puzzle
theme filter, repertoire pins and the mistake-drill opening filter; the Puzzles
and Train my mistakes buttons stay with the game controls. Rated games lock the
Train tab. The last tab is remembered on the device in `chessGameTab`. The tabs follow the
WAI-ARIA pattern: only the active tab is in the Tab order, Left/Right/Home/End
move between tabs, and those keys do not step through move history. The
confirmation dialog moves focus in, traps Tab, closes on Escape and returns focus.

## Learning modes

- **Learning prompt:** a free-text "what do you want to learn" field whose
  text is threaded into the coaching payload to steer the explanations.
- **Opening detection:** `coach/openings.js` names the opening (deepest ECO
  match) and flags when play leaves book.
- **PGN:** export the current game (one header set, the game's result as the Result tag and terminal marker) or import one to review (`coach/pgn.js`). An import is a casual, fully unscored board (no rated, opponent-history or game-log writes, including moves played on from it), resets the clock and result state, and a PGN that declares a result is shown as finished rather than continued; the declared result is kept in the saved PGN's Result header so it survives a reload. A clock choice in Settings applies to the next new game, not the one in progress; a timeout is a draw when the other side cannot possibly checkmate (lichess material rules). Promotion (click or drag) uses an app-owned labelled chooser.
- **Automatic draws:** threefold repetition and the 50-move rule end the game at once, as on most online servers, and the result says so ("Draw by threefold repetition (claimed automatically)", "Draw by the 50-move rule (claimed automatically)"). Stalemate, insufficient material and timeout-versus-insufficient-material keep their own wording.
- **Accuracy summary:** at game end, a per-side accuracy % plus
  blunder/mistake/inaccuracy counts (`coach/accuracy.js`, Lichess-style curve).
- **Puzzles:** a rated, adaptive, coached trainer.
  See "Puzzle trainer" below.

## Puzzle trainer

The puzzle system is a rated, adaptive, coached trainer rather than a
fixed tier-gated list:

- **Bank:** mate-in-1/2/3 positions (`coach/puzzles.js`), each carrying a
  difficulty rating, theme, hint, and its canonical solver-derived solution
  line. Every mate-in-1/2 is re-proven by the exhaustive solver on each test
  run; mate-in-3 positions are proven exhaustively offline at authoring time
  and their stored line + key move re-verified in tests (the depth-5 proof is
  too slow per-run). Checking mate puzzles stays solver-based: any move that
  keeps a forced mate within the remaining budget counts.
- **Lichess daily puzzle:** each session tries the public, CORS-open,
  CC0-licensed `/api/puzzle/daily` (`coach/lichessPuzzle.js`); the parser
  replays the whole UCI solution to prove legality before accepting. These
  "solution"-kind puzzles use strict only-move checking (any checkmate also
  wins), with the opponent's replies scripted. Offline, the session simply
  has no daily puzzle.
- **Adaptive sessions + spaced repetition** (`coach/puzzleProgress.js`,
  `localStorage['chessPuzzleProgress']`): every first outcome per puzzle
  rates the player against the puzzle (Elo via `engine/rating.js`) and
  schedules the puzzle on the same 1d/3d/7d ladder as the mistake library.
  Sessions are due reviews first (longest overdue leading), then fresh
  puzzles nearest the player's rating.
- **Hints on request** (`coach/puzzleCoach.js`): stage 1 names only the
  theme (free); stage 2 names the key piece and its square — never the move —
  and counts as a miss. The Claude path is only ever sent what the stage
  allows it to say, so it cannot spoil; keyless, the deterministic text shows.
- **Fail coaching:** a wrong attempt is snapped back, rated, and explained
  from the engine's actual refutation line (one post-move analysis) without
  naming the correct move — Claude-phrased with a key, template otherwise.

## Mistake library & drills

Every mistake/blunder the human plays in a normal game is captured into a
persistent library (`coach/mistakeStore.js`, `localStorage['chessMistakes']`):
the position it was played from, the move, the engine's best line, centipawn
loss, classification, opening, and move number. Capture happens in the coaching
pipeline, so it costs nothing extra; puzzles, drills, and rated games are
excluded. Entries dedupe by position (repeating a mistake makes it due again)
and the library caps at 200 entries, evicting oldest solved first.

Two ways back into a captured position:

- **Post-game review:** at game end, `components/MistakeReviewPanel.jsx` lists
  the mistakes from that game with a Retry button each.
- **Train my mistakes:** a button next to Puzzles drills every entry currently
  due under the spaced-repetition schedule — a solved entry returns in 1 day,
  then 3, then 7; a miss makes it due again immediately.

A drill (`hooks/useMistakeDrill.js`) loads the position the mistake was played
from. The stored best move solves it instantly; any other move is judged by
live full-strength analysis and counts when it concedes under 50 centipawns —
the puzzle checker's honesty principle, so alternate good moves get credit.
Feedback flows through the normal `requestCommentary` pipeline (Claude when a
key is set, engine-grounded templates otherwise). "Show solution" reveals the
stored line and schedules the entry for another review.

The library also feeds coaching: `weaknessProfile()` condenses it into one line
(counts, dominant phase, repeated opening) that rides along in the coach
payload next to the learning goal, so live commentary can connect a move to the
player's recurring patterns.

## Rated mode

A rated Elo ladder mode, distinct from casual play against a fixed difficulty
tier:

- The player has a single Elo rating (`engine/rating.js`), starting at
  `DEFAULT_RATING` (1000), that updates after every rated game from a
  standard logistic expected-score formula.
- **K-factor schedule:** 40 while a rating is provisional, 20 once the player
  has some games in, 10 after that (`kFactor`, thresholds at 20 and 40 games
  played). A rating is considered provisional under 20 games.
- **Matchmaking:** a 9-rung opponent ladder (`RATING_LADDER` in
  `engine/difficulty.js`, ratings 800 through 3000) is matched to the
  player's current rating by nearest published rating (`nearestRung`). Rungs
  below Stockfish's ~1320 Elo floor are reached by sampling a weaker move
  from the full-strength MultiPV lines rather than by limiting engine
  strength, so evals stay honest even against the weakest rungs.
- **Cross-device sync (account-only):** rating is one of four domains synced by
  `engine/profileSync.js` -- see "Player profile & cross-device sync" below.
  Reads and writes are authenticated with a signed-in account (Auth0); a
  key-hash or other public identifier never authorizes access (see
  `docs/public-accounts.md`).
- **Abort window:** a new rated game is free until both sides have moved
  (fewer than two plies, so an engine opening as White does not count against
  the player). After that, anything that would discard the live game (New Rated
  Game, leaving rated mode, starting puzzles or mistake drills, importing a PGN)
  asks first and books a loss through the same writers as Resign (rating,
  rated-game count, opponent history, game log). Each writer is guarded once per
  game, so a finished or resigned game is never scored again.
- **Replacement through the match boundary:** choosing the other tab's or the
  cloud's match in a conflict, restoring a recovery backup, or "Keep backup and
  start new game" replaces the saved match without the game's buttons.
  `ChessGame` passes `ratedMatches.beforeReplace` to `MatchBoundary`, which
  confirms and then books the forfeit from the saved snapshot alone. Restoring an
  earlier snapshot of the same match id is a rewind and counts as abandoning the
  further-along state.
- **Scored match ids:** every scored match id (resign, finish, forfeit) is kept in
  `chessRatedScored` (last 200, device-local, not synced). A snapshot whose id is
  listed starts with its rated, history and log guards already set, so no
  retained copy of a scored match can score again.

## Player profile & cross-device sync

Beyond the rating, two more per-player records make returning play feel
continuous: a per-opponent win/loss/draw history, kept in separate buckets
for casual difficulty tiers and rated ladder rungs (they're scored on
different curves), and the puzzle trainer's own store (see "Puzzle trainer"
above) -- a player puzzle Elo plus per-puzzle spaced-repetition state. History
lives in localStorage (`chessOppHistory`, managed by `engine/playerHistory.js`);
puzzle progress lives in `chessPuzzleProgress`, managed by
`coach/puzzleProgress.js`. Both sit alongside the existing `chessRating` and
`chessMistakes` library.

`engine/profileSync.js` syncs all four as one profile -- rating, history,
puzzles, mistakes -- against `api/chessProfile.js`, authenticated by the
signed-in account's session cookie. On load it fetches the remote profile,
merges it with the local one, and writes the merged result back both
locally and remotely; pushes also happen at game end, on a puzzle result,
and after a rated result. Merges are pure and conflict-free: rating reuses
the existing monotonic `mergeRating`; history takes a per-counter max per
opponent; puzzles mirror that same monotonic logic at the top level (the
side with more total attempts wins the player-rating pair) and union
per-puzzle records by id, taking the max of attempts/solves and moving the
scheduling fields (streak/nextDueAt/lastResult) together from whichever side
rescheduled the puzzle more recently; mistakes union by position
(`fenBefore`), keeping whichever entry has more attempts or is due further
out, then re-applying the 200-entry cap.

Sync is optional for the player: without an account, everything works from
localStorage. The server side needs a Redis REST store
(`KV_REST_API_URL`/`KV_REST_API_TOKEN` or the `UPSTASH_REDIS_REST_*` aliases); when
the store is missing or unreachable the endpoints return 503 and the client stays
local-only.

## Accounts

Chess offers an optional account, signed in at `/login` with the ramia.us sign-in
(Auth0: Google or email and password), so a player signs in once per machine instead of
re-pasting an Anthropic API key everywhere. The account authorizes the profile sync
above and carries the API key and Lichess token, which are stored encrypted on the
server and added to coach and explorer requests there, so they never reach the browser;
there is no maintainer-funded fallback.

Profile reads and writes require proven account ownership: the session cookie
issued at sign-in (see [public account operations](public-accounts.md#sessions)). No
public identifier can read or write progress. Shared Redis rate counters bound sign-up, sync, and model
requests across instances. Missing
storage or limiter configuration returns 503; guest play remains local.

A profile may carry source copies of imported progress in `legacyProfiles`; the
monotonic Chess merge rules reconcile them without adding the same statistics twice.
See [public account operations](public-accounts.md) for exact contracts and setup.

Sign-in asks whether to import this device's guest progress. Signing out clears
local credentials and visible progress, retaining a recovery copy encrypted with
the outgoing account's seal key. Signing into another account cannot load that
copy. Switching reloads the app, and other open tabs reload on identity changes;
pending profile responses also verify the originating account before applying.
Cloud writes use revisions: conflicts retain local data and show a sync warning.

Sign-in, sign-out and key entry live only at `/login`; Chess shows the account
and key status in Settings and links to `/login?return=/chess`. Shared
preferences for Chess/Yinsh/Zertz/Catan, existing Yinsh scores, and Chess
finished-game statistics (`chessGameLog`) use a separate revisioned settings scope.
Chess rating/history/puzzles/mistakes keep their
existing domains. Versioned current-match snapshots support local resume and
authenticated cloud sync; see [resumable matches](resumable-matches.md).

## localStorage keys

```
chessDarkMode, chessShowMoves, chessDifficulty, chessLearningGoal,
chessShowEvalBar, chessSound, chessLichessToken, chessRated, chessRating,
chessRatedGames, chessMistakes, chessOppHistory, chessPuzzleProgress,
chessGameTab, chessRatedScored,
chessMatch:v1, chessMatchSync:v1, chessMatchRecovery:v1, chessStatsRecovery:v1

playApiKey  # shared app-wide (all games), not chess-prefixed
playAccount # shared app-wide, written only by /login; cached account session
```

## Opening coaching (master stats)

Openings have many sound paths, so opening moves are not judged by eval-loss vs.
the single engine best move. A move that stays in a known ECO line
(`coach/openings.js`) — or is within a wide eval band — is labeled **Book**
(neutral), never inaccuracy/mistake. This works with no network dependency.

When a **Lichess token** is set (`coach/openingCoach.js`, BYO: a guest's in
`localStorage['chessLichessToken']`, queried from the browser; a signed-in
account's held on the server, which queries the explorer itself through
`api/chessCoach.js` `mode: 'explorer'` -- see Accounts above), the coach also
fetches the Lichess masters
opening explorer and reports real popularity — "the Nth most-common master move,
played in X% of games, scoring Y%" — plus the other popular choices. The explorer
is auth-gated (locked down after DDoS attacks), so it requires a free read-only
token; without one, coaching degrades gracefully to the "Book" label.

## Tests

All chess logic is covered by Jest suites under `src/games/chess/` (board rules,
UCI parsing, classification, openings, PGN, accuracy, puzzles, material, sound).
Run the full suite with `CI=true npm test`.
