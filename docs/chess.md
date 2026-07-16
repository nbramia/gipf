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
    profileSync.js       # Cross-device profile sync -- supersedes ratingSync (rating + history + puzzles + mistakes)
    account.js           # Username+password accounts: PBKDF2 credential derivation, API-key encryption, session cache
    playerHistory.js     # localStorage: per-opponent W/L/D history (chessOppHistory)
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
    puzzles.js           # Rated mate-in-1/2/3 bank + solver & scripted-line checkers (#18, #24)
    puzzleProgress.js    # Player puzzle Elo + per-puzzle spaced repetition + session selection (#24)
    puzzleCoach.js       # Staged no-spoiler hints + refutation-grounded fail coaching (#24)
    lichessPuzzle.js     # Lichess daily puzzle fetch + vetted parser (#24)
    mateSolver.js        # Exhaustive forced-mate search (vets puzzles)
    material.js          # Captured pieces + material balance (#21)
    sound.js             # WebAudio move cues (#21)
api/chessCoach.js        # Vercel serverless coach endpoint
api/chessProfile.js      # Vercel serverless profile sync endpoint (rating + history + puzzles + mistakes)
api/chessAccount.js      # Vercel serverless account store (username+password, encrypted API key)
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
- **Puzzles (#18, overhauled #24):** a rated, adaptive, coached trainer.
  See "Puzzle trainer" below.

## Puzzle trainer

The puzzle system (#24) is a rated, adaptive, coached trainer rather than a
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
- **Cross-device sync (optional):** rating is one of four domains synced by
  `engine/profileSync.js` -- see "Player profile & cross-device sync" below.
  The id is the SHA-256 hash of the player's Anthropic API key (namespaced
  before hashing), the same id `ratingSync.js` used, so a rating already
  synced under the old endpoint carries over unchanged. `api/chessProfile.js`
  mirrors every rating write to the legacy `chess:rating:{id}` key, so a
  client still calling `api/chessRating.js` directly stays coherent.

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
puzzles, mistakes -- against `api/chessProfile.js`, under the same opaque
key-hash id as rated-mode sync. On load it fetches the remote profile,
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

Like rated-mode sync, this is entirely optional: without a configured Vercel
KV store the endpoint replies `{configured: false}` and every helper no-ops
back to local-only, and without a BYO API key there's no id to sync under at
all -- everything just works from localStorage as it always has. Signed into
an account (see "Accounts" below), the profile id is the account's
password-derived id instead of the key hash.

## Accounts (username + password)

On top of the key-hash sync above, Chess also offers a lightweight
username+password account, so a player can sign in once per machine instead
of re-pasting an Anthropic API key everywhere. It's the same profile sync
underneath -- an account just gives it a memorable id and lets it carry the
API key too.

Every secret is derived client-side from the password
(`engine/account.js#deriveCredentials`: PBKDF2-SHA256, 310k iterations, salt
`'gipf-chess-account:v1:' + lowercase(username)`). The 768 derived bits split
into an `authToken` (sent to the server for read/write authorization, stored
there only as its SHA-256 hash), an AES-GCM-256 key that never leaves the
browser, and a `profileId` that's unguessable without the password. The
Anthropic API key is encrypted client-side under that AES key before it's
ever sent, so **the server can never read anyone's API key** --
`api/chessAccount.js` stores it only as `{iv, ct}` ciphertext. There is no
email and no password reset: a forgotten password just means a new account.
Accepted risks, both judged fine for data this low-stakes (game history plus
an encrypted key blob): no rate limiting (online password guessing against a
username is possible) and no recovery.

The BYO Lichess opening-explorer token (`chessLichessToken`,
`coach/openingCoach.js`) rides along the same account the same way --
encrypted client-side under the same AES key and stored as an optional
`encLichess` sibling ciphertext, so accounts created before this addition
simply have none and behave exactly as before. Both Settings' Account block
and the landing-page widget decrypt it into `chessLichessToken` on sign-in,
and saving a new token from Settings while signed in re-encrypts and pushes
it, exactly like the API key.

Settings' Account block offers Create Account / Sign In / Sign Out. Signing
in fetches the stored `enc` record and decrypts it into the shared
`gipfApiKey` slot, so the coach lights up with nothing else entered; profile
sync switches from the key-hash id to the account's `profileId`, and any
existing local profile plus legacy key-hash remote profile are merged into
the account profile via the same per-domain merge functions `profileSync.js`
already uses. Changing the API key while signed in re-encrypts it and pushes
the new ciphertext (`pushEncryptedKey`). Account profiles reuse
`api/chessProfile.js` unchanged -- the `profileId` doubles as the opaque id
that endpoint already expects.

Like every other optional sync path in this app, it degrades cleanly: without
a configured Vercel KV store `api/chessAccount.js` replies
`{configured: false}`; signed out, everything is exactly the old behavior
(key-hash sync, or local-only with no key at all).

The same account can also be created or signed into from the landing page
(`src/account.js`, an identical copy of `engine/account.js` per the
per-consumer-copy convention) -- the synced key lights up every game's AI
chat feature (chess coach, Catan/Splendor rules chat, Diplomacy agent chat),
while profile sync (history/puzzles/mistakes/Elo) stays chess-only.

## localStorage keys

```
chessDarkMode, chessShowMoves, chessDifficulty, chessLearningGoal,
chessShowEvalBar, chessSound, chessLichessToken, chessRated, chessRating,
chessRatedGames, chessMistakes, chessOppHistory, chessPuzzleProgress

gipfApiKey  # shared app-wide (all games), not chess-prefixed
gipfAccount # shared app-wide (landing page + chess settings block); cached account session
```

## Opening coaching (master stats)

Openings have many sound paths, so opening moves are not judged by eval-loss vs.
the single engine best move. A move that stays in a known ECO line
(`coach/openings.js`) — or is within a wide eval band — is labeled **Book**
(neutral), never inaccuracy/mistake. This works with no network dependency.

When a **Lichess token** is set (`coach/openingCoach.js`, BYO, stored in
`localStorage['chessLichessToken']` and, for a signed-in account, synced the
same encrypted way as the API key -- see Accounts above), the coach also
fetches the Lichess masters
opening explorer and reports real popularity — "the Nth most-common master move,
played in X% of games, scoring Y%" — plus the other popular choices. The explorer
is auth-gated (locked down after DDoS attacks), so it requires a free read-only
token; without one, coaching degrades gracefully to the "Book" label.

## Tests

All chess logic is covered by Jest suites under `src/games/chess/` (board rules,
UCI parsing, classification, openings, PGN, accuracy, puzzles, material, sound).
Run the full suite with `CI=true npm test`.
