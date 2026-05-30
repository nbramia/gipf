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
    difficulty.js        # Named tiers -> UCI_Elo + per-move time
    uci.test.js
  hooks/
    useStockfish.js      # Engine lifecycle; getMove() + analyze(); serialized
  coach/
    classify.js          # Eval-swing -> blunder..best; formatEval
    analyzeMove.js       # Build engine-grounded coaching payloads; pv -> SAN
    templates.js         # Deterministic fallback prose (never fabricates)
    coachClient.js       # BYO key + POST /api/chessCoach + fallback + thread loop
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

- The key is entered in the UI and stored only in the browser under
  `localStorage['chessApiKey']`.
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
- **Puzzles (#18):** mate-in-1 tactics, each verified to have a unique solution
  (`coach/puzzles.js`).

## localStorage keys

```
chessDarkMode, chessShowMoves, chessDifficulty, chessLearningGoal,
chessShowEvalBar, chessSound, chessApiKey
```

## Tests

All chess logic is covered by Jest suites under `src/games/chess/` (board rules,
UCI parsing, classification, openings, PGN, accuracy, puzzles, material, sound).
Run the full suite with `CI=true npm test`.
