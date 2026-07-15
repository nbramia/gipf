# Chess

The third game in the GIPF suite: play chess against Stockfish with a running
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
    ratingSync.js        # Cross-device rating sync client (keyed by key hash)
  hooks/
    useStockfish.js      # Engine lifecycle; getMove() + analyze(); serialized
    useMistakeDrill.js   # Drill session state machine for the mistake library (#23)
  components/
    MistakeReviewPanel.jsx # Post-game mistake list with Retry (#23)
  coach/
    classify.js          # Eval-swing -> blunder..best; formatEval
    analyzeMove.js       # Build engine-grounded coaching payloads; pv -> SAN
    templates.js         # Deterministic fallback prose (never fabricates)
    coachClient.js       # BYO key + POST /api/chessCoach + fallback + thread loop
    mistakeStore.js      # Persistent mistake library + spaced-repetition scheduler (#23)
    analysisTools.js     # analyze_position tool: Claude-callable Stockfish
    openings.js          # ECO opening detection (#15)
    pgn.js               # PGN import/export glue (#16)
    accuracy.js          # Post-game accuracy summary (#17)
    puzzles.js           # Tiered mate-in-1/2 tactics + solver-based checker (#18)
    mateSolver.js        # Exhaustive forced-mate search (vets puzzles)
    material.js          # Captured pieces + material balance (#21)
    sound.js             # WebAudio move cues (#21)
api/chessCoach.js        # Vercel serverless coach endpoint
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

### Bring-your-own API key (security)

The app is open source and publicly shared, so there is **no maintainer key**:

- The key is entered in the UI and stored only in the browser, under a single
  slot shared across the whole app (`localStorage['gipfApiKey']`): a key saved
  in Chess is also used by Catan's rules chat, and vice versa
  (`coach/coachClient.js`). A legacy per-game key under `chessApiKey` is
  migrated into the shared slot automatically the first time it's read.
- It is sent per-request in the POST body to `/api/chessCoach` over HTTPS.
- The server uses it for exactly one upstream call and **never** logs, persists,
  or reads a key from its own environment — there is no server-side fallback.
- It is never a `REACT_APP_` variable (those are bundled into client JS).
- CORS mirrors `api/aiMove.js` (allowlist applied in both success and error
  paths; OPTIONS preflight handled).

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
#22 truthfulness guarantee, extended to the conversational layer). The system
prompt explicitly forbids stating an eval or line not obtained from the tool.

The full Anthropic message history (including tool calls/results) is kept on each
move's dialogue entry so the conversation has continuity. Threads are a key-only
feature — free-form Q&A has no template fallback. The endpoint marks the
move-context block with prompt caching so multi-round threads stay cheap.

## Learning modes

- **Learning prompt (#14):** a free-text "what do you want to learn" field whose
  text is threaded into the coaching payload to steer the explanations.
- **Opening detection (#15):** `coach/openings.js` names the opening (deepest ECO
  match) and flags when play leaves book.
- **PGN (#16):** export the current game or import one to review (`coach/pgn.js`).
- **Accuracy summary (#17):** at game end, a per-side accuracy % plus
  blunder/mistake/inaccuracy counts (`coach/accuracy.js`, Lichess-style curve).
- **Puzzles (#18):** mate-in-1 and mate-in-2 tactics, tier-driven (lower
  difficulty tiers train mate-in-1, higher tiers mate-in-2). Each authored
  position is vetted offline by an exhaustive forced-mate solver
  (`coach/mateSolver.js`) for soundness. During live play, correctness is not
  "match a stored key": any move that keeps a forced mate within the
  remaining ply budget counts as correct, re-solved live on each move
  (`coach/puzzles.js`).

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
- **Cross-device sync (optional):** `engine/ratingSync.js` can persist the
  rating record to the server, keyed by the SHA-256 hash of the player's
  Anthropic API key (namespaced before hashing) rather than the key itself,
  so the raw key never leaves the browser for this feature. Sync degrades
  gracefully to local-only if no server-side store is configured.

## localStorage keys

```
chessDarkMode, chessShowMoves, chessDifficulty, chessLearningGoal,
chessShowEvalBar, chessSound, chessLichessToken, chessRated, chessRating,
chessRatedGames, chessMistakes

gipfApiKey  # shared app-wide (Chess + Catan), not chess-prefixed
```

## Opening coaching (master stats)

Openings have many sound paths, so opening moves are not judged by eval-loss vs.
the single engine best move. A move that stays in a known ECO line
(`coach/openings.js`) — or is within a wide eval band — is labeled **Book**
(neutral), never inaccuracy/mistake. This works with no network dependency.

When a **Lichess token** is set (`coach/openingCoach.js`, BYO, stored only in
`localStorage['chessLichessToken']`), the coach also fetches the Lichess masters
opening explorer and reports real popularity — "the Nth most-common master move,
played in X% of games, scoring Y%" — plus the other popular choices. The explorer
is auth-gated (locked down after DDoS attacks), so it requires a free read-only
token; without one, coaching degrades gracefully to the "Book" label.

## Tests

All chess logic is covered by Jest suites under `src/games/chess/` (board rules,
UCI parsing, classification, openings, PGN, accuracy, puzzles, material, sound).
Run the full suite with `CI=true npm test`.
