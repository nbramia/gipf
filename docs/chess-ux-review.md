# Chess — UX / User-Flow Review

> **Status: implemented.** This audit was acted on in full; the findings below
> are kept as the record of what was wrong and why it mattered. Two corrections
> to the original text are marked inline where later work proved a finding
> inaccurate.

A ground-up review of the Chess game's user experience, covering general gameplay,
the three learning surfaces (coaching commentary, puzzles, opening learning), and
mobile specifically.

Method: a live browser walkthrough (desktop 1440×900 and phone 390×844, light and
dark, casual → blunder → puzzles → rated) plus six parallel code audits of
`ChessGame.jsx`, `coach/*`, `engine/*`, `chess.css`, and the API handlers.

Findings marked **[verified live]** were reproduced in the browser. The rest come
from code reading and are marked as such where the distinction matters.

**Nothing here is a correctness bug in the chess rules or the engine.** The rules
layer, engine truthfulness, and key security all remain sound (see
`chess-adversarial-review.md`). Everything below is experience, flow, and pedagogy.

*One exception surfaced while implementing these fixes:* `ChessBoard.pgn()`
delegated to an internal chess.js instance that `clone()` rebuilds from the
current FEN, so any cloned board — i.e. every board after the first move —
produced a PGN with a `[SetUp]`/`[FEN]` header and **zero moves**. That silently
broke PGN export. Fixed by replaying from the recorded move history, with
regression tests in `ChessBoard.test.js`.

---

## The one-paragraph version

The app is a *strong analysis engine wearing a thin coaching UI*. It reliably tells
you **what** happened — the eval, the better move, the opening's name, the
classification — and rarely tells you **why**, which is the thing a learner
actually needs. Three structural problems compound that: state is silently
destroyed at several junctions (refresh, rated toggle, puzzle exit), the learning
features are invisible unless you go looking for them, and on a phone the coaching
panel — the app's whole differentiator — sits below the fold during play.

---

## Priority 1 — Silent state loss

These are the most damaging because they violate the user's model of what's safe to
click, and there's no undo.

### 1.1 Exiting puzzles destroys your game *and* silently flips your color **[verified live]**
`ChessGame.jsx:1485-1487` → `startGame()` (821-842)

Reproduced: played `1.e4 c5 2.Ke2 e6` as White, clicked **Puzzles**, then **Exit
puzzles**. The game was gone, replaced by a fresh game in which the engine had
already played `1.d4`, the board was flipped, and I was now Black — despite
"Play as" still being set to White. No confirmation, no notice.

Two defects in one flow: an in-progress game discarded without warning, and a
color/orientation change the user never requested.

**Fix:** preserve the game across puzzle mode (stash and restore the board), or
confirm before discarding. Separately, honor the "Play as" setting on the game that
follows puzzle exit.
Severity: **high** · Effort: M

### 1.2 The Rated toggle discards the in-progress game with no confirmation **[verified live]**
`ChessGame.jsx:846-849` (`toggleRated`)

Flipping "Rated mode" calls `startGame()` unconditionally. It sits directly above
Difficulty in the same panel, so it's an easy misclick — and it wipes the board.

**Fix:** confirm when `movesPlayedCount > 0` and the game isn't over.
Severity: **high** · Effort: S

### 1.3 A page refresh loses the entire game
`ChessGame.jsx:82` — the board is in-memory React state only

There is no serialization of the current position, move list, or dialogue.
Diplomacy already persists `diplomacyGameState`; chess has no equivalent. A closed
tab or accidental reload destroys a long game, including a *rated* game in progress.

**Fix:** persist PGN + `humanColor` + mode + dialogue to localStorage each move and
rehydrate on mount; at minimum add a `beforeunload` guard.
Severity: **high** · Effort: M

### 1.4 Resign has no confirmation
`ChessGame.jsx:1521-1527`

One click ends the game. In rated mode that's an irreversible Elo loss, and it sits
in the same undifferentiated button strip as Flip and Undo.
Severity: medium · Effort: S

### 1.5 "Remove" on the API key / Lichess token is instant and irreversible
`ChessGame.jsx:1012-1016`, `1156-1159`

Severity: medium · Effort: S

---

## Priority 2 — Mobile

Measured on a 390×844 viewport with a game in progress.

### 2.1 The Coach panel is below the fold during play **[verified live]**
Single-column layout below `lg` (1024px); `ChessGame.jsx:1364`

Measured: the "Coach" heading sits at **y = 746px** on an 844px-tall viewport, with
total page height 1419px. In document order you must scroll past the board, the
captured trays, six control buttons, and the entire Moves panel to reach the
commentary. On a phone, the app's single differentiating feature is effectively
invisible while you play.

**Fix:** on mobile, move the coach above the move list, or make the latest
commentary line a compact sticky strip directly beneath the board with tap-to-expand.
Severity: **high** · Effort: M

### 2.2 30 interactive elements are under the 44×44px touch minimum **[verified live]**
Measured in-page via `getBoundingClientRect`:

| Element | Measured | Anchor |
|---|---|---|
| "Ask about this move →" | 121 × **16** | `ChessGame.jsx:1694-1704` |
| Toggle switches (×5) | 40 × **24** | `ChessGame.jsx:70` |
| Export / Import PGN | 54 × **26** | `ChessGame.jsx:1553-1562` |
| All primary buttons (New Game, Undo, Flip, Resign, Puzzles, Hint, …) | ⋯ × **38** | `ChessGame.jsx:1444-1542` |
| Modal close "✕" | small | `ChessGame.jsx:1993-1999` |
| Board square | **40 × 40** | react-chessboard |

The worst is "Ask about this move" at 16px tall — the entry point to the entire
Q&A feature is a hairline on a phone. Note there is no horizontal overflow
(scrollWidth == clientWidth), so this is purely a target-size problem.

**Fix:** bump the shared button padding to `py-2.5`/`py-3`, wrap toggles in a
44px-min row hit area, and promote "Ask about this move" to a real button.
Severity: **high** · Effort: S (largely find/replace)

### 2.3 Landscape phones get the tall mobile stack
The 2-column layout waits for `lg` (1024px), so an 844×390 landscape phone still
renders the full vertical stack into a 390px-tall viewport — the orientation with
the least room to spare. Tablets at 768px are also stuck in single column.
Severity: medium-high · Effort: M

### 2.4 Board coordinates are illegible on mobile, and worse in dark mode **[verified live]**
At 40px squares the rank/file labels are a few pixels tall; in dark mode they're
dark glyphs on mid-green squares. Disabled buttons ("Undo", "Export") also drop to
near-invisible contrast in dark mode.
Severity: medium · Effort: S

### 2.5 No safe-area insets, no `viewport-fit=cover`
`public/index.html:5`, `chess.css` (no `env(safe-area-inset-*)` anywhere)

The move-thread modal is `fixed inset-0` with its input row flush to the bottom
edge — on a notched iPhone that lands under the home indicator.
Severity: medium · Effort: S

### 2.6 Header spacer is a fixed `w-24` (96px)
`ChessGame.jsx:1354-1362` — tight on 320-360px devices.
Severity: low · Effort: S

**Non-issue, worth recording:** pinch-zoom is *not* blocked — the viewport meta has
no `maximum-scale`/`user-scalable=no`. TO_DO.md lists pinch-to-zoom as wanted; the
meta tag isn't what's standing in the way. Tap-to-move also already works alongside
drag, so touch users aren't drag-dependent.

---

## Priority 3 — Learning quality: the "what, not why" problem

This is the theme that runs through all three learning surfaces.

### 3.1 Blunder feedback assigns homework instead of teaching **[verified live]**
`coach/templates.js:60-78`

Actual output after I played `2.Ke2`:

> Ke2 — Blunder. After it, the evaluation is -2.4. Stronger was Nf3 (+0.8), e.g.
> Nf3 e6 Nc3 Nc6 d4…. **Check what Ke2 left loose, or what Nf3 would have stopped.**

The last sentence is the app handing the question back to the person who already
didn't know the answer. Every non-book move gets this same three-clause skeleton, so
across a 40-move game it reads as a form letter — and this is the **default**
experience, since most users never add an API key.

**Fix:** add cheap chess.js-based motif detection (hanging piece, available fork,
back-rank weakness, king-shelter damage, undeveloped pieces) and splice a concrete
clause in, so the free path names the idea rather than pointing at it.
Severity: **high** · Effort: L

### 3.2 Opening names are labels, not lessons
`coach/openings.js:15-58`, `coach/openingCoach.js:127-143`

The app says "Sicilian Defense" and "masters play this 34% of the time." It never
says what the Sicilian is *for*. There's no plan, no pawn-structure idea, no typical
middlegame goal — the difference between naming an opening and teaching one.

**Fix:** attach a 1-2 sentence "idea" string per opening family and surface it the
first time that opening appears. Static data addition, no new dependencies.
Severity: **high** · Effort: M

### 3.3 The opening book is ~58 entries, average depth ~4 plies
`coach/openings.js:15-58`

Ruy Lopez stops at `3.Bb5`. No London, no Catalan, no Vienna, no Closed Ruy, no
Four Knights. Most real games leave the table by move 4-6, at which point the user
gets flagged as "left book" while still in completely standard theory.
Severity: **high** · Effort: M

### 3.4 Transpositions are not recognized
`coach/openings.js:76-97` — `detectOpening` does literal SAN-prefix matching

`1.Nf3 d5 2.d4 Nf6 3.c4` never gets identified as a Queen's Gambit. Worse, it gets
flagged "left book." Transposition is a core intermediate concept and the tool
currently teaches the opposite of it.

**Fix:** match on position (FEN) rather than move sequence.
Severity: **high** · Effort: L

### 3.5 Puzzle failures explain in prose but never show the refutation
`ChessGame.jsx:681-696` — **[verified live]**

Actual output after a wrong move:

> Qd2 doesn't work — after Ka7 Qb2 Ka6 the chance is gone. The king & queen
> (corner) idea is still there; look again.

The text is good. But `Ka7 Qb2 Ka6` is a line the learner has to visualize
unaided — for a spatial, pattern-recognition skill, that's the weakest possible
channel. The piece just snaps back with no board feedback at all.

**Fix:** animate the refutation on the board (ghost replay) before snapping back.
Severity: **high** · Effort: M

### 3.6 Rated mode gives zero learning feedback, even after the game ends
`ChessGame.jsx:434` — `coachOnMove` returns early when rated

Suppressing hints *during* a rated game is correct. But because the analysis never
runs, `moveStats` stays empty, so there's no accuracy report, no blunder count, and
no move classifications **after** the result is locked in either. The mode where a
learner most wants to know how they did is the one that tells them nothing.

Same issue for openings: rated games get no opening name and no book/left-book
status, though neither leaks any advantage.

**Fix:** run analysis silently during rated games and reveal the summary only at
game end. Split "opening identification" from "coaching" so naming survives.
Severity: **high** · Effort: M

### 3.7 The puzzle bank is 16 hand-authored positions, all checkmate patterns
`coach/puzzles.js:34-61` — 10 mate-in-1, 4 mate-in-2, 2 mate-in-3
**[verified live: session showed "Puzzle 1/11"]** (10 session + 1 Lichess daily)

Beginner and Casual draw from the identical mate-in-1 pool; Intermediate and
Advanced share the same 4 positions. There are no forks, pins, skewers, deflections,
or win-material puzzles at all — only mate-finding, which is a narrow slice of
tactical vision. A returning player exhausts the content in a session or two.

**Fix:** bulk-import a public puzzle set (Lichess publishes CC0 databases). Hand
authoring won't scale here.
Severity: **high** · Effort: L

### 3.8 Puzzle titles give away the answer **[verified live]**
Observed header:

> Puzzle 1/11: White to play, **mate in 2**. (**King & queen (corner)** · rated 1000)

Both the move count and the mating pattern are stated up front. Naming the pattern
is most of the solve.

**Fix:** show the theme only after solving (or on hint request); make "mate in N"
disclosure a setting.
Severity: medium · Effort: S

### 3.9 Move classification thresholds are never explained
`coach/classify.js:10-19`

"Excellent," "Inaccuracy," "Mistake," "Blunder" appear color-coded with no legend.
A beginner has no idea 15cp separates Good from Excellent — the labels degrade into
vibes instead of a calibration they could learn to predict.
Severity: low · Effort: S

### 3.10 The "book" label covers up to 90cp of loss
`ChessGame.jsx:483-507` (`SOUND_OPENING_BAND = 90`)

Within the first 24 plies, any move losing ≤90cp is relabeled "book" even with no
ECO match — but 90cp is squarely inside this codebase's own "inaccuracy" band
(60-130cp in `classify.js`). A genuinely shaky opening move gets presented as
established theory. This is the one finding that brushes against the truthfulness
principle the project states elsewhere.

**Fix:** keep "Book" for real ECO matches; label the eval-band case "Playable."
Severity: medium · Effort: S

### 3.11 Weak-tier opponent commentary can narrate a move that wasn't played
`coach/templates.js:31-37`, `analyzeMove.js:69-71` (MultiPV = 3)

At sub-1320 tiers `chooseWeakenedMove` deliberately samples a weaker move. If that
move isn't in the engine's top 3, `describeAiMove` falls back to `candidates[0]` —
so the opponent narrates "This was the strongest, so I chose it" about a *different*
move than the one on the board. Code-read, not reproduced live, but the fallback
path is unconditional.
Severity: medium · Effort: M

---

## Priority 4 — Discoverability: features nobody finds

### 4.1 There is no first-run onboarding of any kind **[verified live]**
The app drops you onto a live board. Nothing explains that there's a coach, a rated
ladder, puzzles, a mistake library, or an account system. The only pointer to the
whole coaching feature is one sentence in the coach placeholder — **which disappears
permanently after move 1**.
Severity: **high** · Effort: S

### 4.2 Settings auto-collapses on move 1, hiding the API key, account, and Lichess token
`ChessGame.jsx:356-369`

The collapse fires exactly when the user starts playing — i.e. right before the
commentary that would make them curious about richer coaching appears. Everything
behind it (key setup, account, explorer token) becomes a click behind an unlabeled
`<summary>`.
Severity: medium · Effort: S

### 4.3 No guidance on obtaining an Anthropic key, and no cost expectation
`ChessGame.jsx:1830-1862`

The label reads "Anthropic API key (for richer coaching)" with a `sk-ant-…`
placeholder. There is no link to console.anthropic.com, no mention that it needs a
developer account with billing (distinct from a claude.ai subscription), and no cost
estimate. For a non-technical learner this is the single largest drop-off point in
the funnel.

**Fix:** add the link and one line — "~a few cents per game."
Severity: **high** · Effort: S

### 4.4 A bad API key fails silently and permanently
`coach/coachClient.js:62-91`

Any non-empty string is accepted. A typo'd key never errors — it just falls back to
templates forever, indistinguishable from having no key. The user concludes "Claude
coaching isn't very good" rather than "my key is wrong."

**Fix:** flag entries where `source === 'template'` *despite* a key being set, and
add a format check plus an optional "Test key" round-trip.
Severity: **high** · Effort: S

### 4.5 The Lichess token instruction isn't even a link
`ChessGame.jsx:1960-1962` — plain text "lichess.org → Preferences → API access
tokens," no `<a href>`, no note that the scope is read-only. The reason the explorer
now requires auth is documented only in `docs/chess.md`, never shown to the user.
Severity: medium · Effort: S

### 4.6 Explorer failures are indistinguishable from having no token
`coach/openingCoach.js:54-66` — `fetchOpeningStats` returns `null` for no-token,
HTTP error, network error, and malformed response alike. A user with an expired
token gets the exact same experience as one with no token.
Severity: low · Effort: S

### 4.7 "Ask about this move" is a dead end without a key
`ChessGame.jsx:1694-1704` vs. `2027-2055` — the link renders unconditionally; the
key requirement is only disclosed *inside* the modal after you click.
Severity: medium · Effort: S

### 4.8 Puzzles has no due-count badge, though `dueCount()` already exists
`coach/puzzleProgress.js:97-102` is exported and never imported. "Train my mistakes
(1)" shows a live count; "Puzzles" shows nothing — an inconsistency between two
identical spaced-repetition mechanisms, and the whole point of SRS is the nudge to
return.
Severity: **high** · Effort: S (one-line fix)

### 4.9 Sync status is only visible inside Rated mode
`ChessGame.jsx:1746-1757`

`profileSync` carries four domains (rating, opponent history, puzzles, mistakes) for
everyone, but the only sync indicator lives in the rated branch. A signed-in casual
player has no way to confirm their puzzle progress is following them across devices.
Severity: medium · Effort: M

### 4.10 The strongest privacy story in the app is never told to the user
`ChessGame.jsx` Account block

Client-side PBKDF2, AES-GCM, server sees only a hash and ciphertext — genuinely
well-built, documented in code comments and `docs/chess.md`, and completely absent
from the UI where someone is deciding whether to trust it. The API key and Lichess
fields both get a privacy line; the account block gets none.
Severity: medium · Effort: S

---

## Priority 5 — Flow, feedback, and dead ends

### 5.1 Difficulty is labeled in raw Elo
`ChessGame.jsx:1771-1775` — "Beginner (~1320)", "Casual (~1500)" … "Master (~2850)"

Most casual players don't know their own rating, so the numbers calibrate nothing.
**Fix:** add a plain-language descriptor per tier ("makes clear mistakes" →
"superhuman").
Severity: **high** · Effort: S

### 5.2 Game-over is a dead end
`ChessGame.jsx:1503-1543` — the control row doesn't change when the game ends. No
"Rematch," no "Play the other color," no emphasized next action. The user re-derives
"click New Game" from five identical buttons.
Severity: **high** · Effort: S

### 5.3 Puzzle sessions silently wrap around instead of ending
`ChessGame.jsx:899`, `854-882` — `loadPuzzleFrom` uses modulo, so "Next puzzle"
after the last one returns to puzzle 1 with no acknowledgment. `SESSION_SIZE = 10`
implies a session concept the UI never completes: no "8/10 solved, rating +24"
summary.
Severity: **high** · Effort: M

### 5.4 The move list is inert
`ChessGame.jsx:1579-1589` — **[verified live: no clickable move elements in the DOM]**

You cannot click a move to review that position. `ChessBoard` already supports
arbitrary pointer positions (that's how undo works); it's just not exposed for
read-only browsing. Basic expectation of any chess UI.
Severity: medium · Effort: M

### 5.5 The eval bar's caption reads as an eval but is material **[verified live]**
`ChessGame.jsx:1411`

The label directly beside the eval bar read **"Even"** while the bar's own
`aria-label` read **"Evaluation -1.1"**. Not a bug — "Even" is the material readout
(`material > 0 ? 'White +N' : … : 'Even'`) — but placed next to an eval bar with no
"Material:" prefix, it reads as a contradiction.
**Fix:** prefix the label, e.g. "Material: even."
Severity: medium · Effort: S

### 5.6 "Play as White / Black" shows no selected state **[verified live]**
Both buttons carry identical classes and neither sets `aria-pressed` — there is no
visual or assistive indication of which color is active.
Severity: medium · Effort: S

### 5.7 Rated-mode lockouts are explained only after you commit
`ChessGame.jsx:1721-1758` — the explanation lives inside the panel that appears
*after* the toggle already started a new rated game.

Also **[verified live]**: rated mode persists across reload, so a returning user
lands in a stripped UI (no coach, no eval, no Puzzles button, no "Train my
mistakes") with the explanation collapsed behind the Game panel. The Puzzles entry
point disappears entirely with no note that toggling Rated off restores it.
Severity: medium · Effort: S

### 5.8 ~2s of dead air before every commentary line
`ChessGame.jsx:445-448`, `useStockfish.js:70-125`

Each move fires `Promise.all([analyze(before, multipv:3), analyze(after, multipv:1)])`
against a single-flight engine queue at 1000ms movetime each — so they serialize to
~2s, and can queue behind the opponent's own search. Feedback is "thinking…" static
text; **[verified live]** the opponent entry shows a bare "Analyzing…".
**Fix:** show a staged indicator, or give coaching its own lower-priority worker.
Severity: **high** · Effort: M

### 5.9 Engine-thinking has no visual cue on the board
`ChessGame.jsx:1319-1320` — status-line text only; the board doesn't visibly
lock or dim, so "did my move register?" is a real question at Master tier.
Severity: low · Effort: S

### 5.10 Captured-piece trays dominate puzzle mode **[verified live]**
In a 3-piece mate puzzle, the trays still render two dense rows of ~16 glyphs
directly above and below the board — visually louder than the puzzle itself, and
easy to misread as pieces sitting on the board edge.
Severity: medium · Effort: S

### 5.11 PGN import always assumes you played White
`ChessGame.jsx:1253-1255` — hardcoded `setHumanColor('w')`, ignoring the
`[White]`/`[Black]` headers. Import a game you played as Black and every "You" /
"Opponent" label in the review is inverted.
Severity: medium · Effort: S

### 5.12 No password confirmation field, in a system with no password recovery
`ChessGame.jsx:1020-1021` — only a ≥6-character check. Combined with the documented
"no email, no reset," a typo at creation produces a permanently dead account, and
the user won't discover it until they try a second device.
Severity: **high** · Effort: S

### 5.13 Signing out deliberately keeps your API key on the device — and doesn't say so
`ChessGame.jsx:1136-1139`

Intentional per the code comment, but undisclosed. On a shared machine, someone who
signs out to "log out" leaves their Anthropic key behind.
Severity: **high** · Effort: S

### 5.14 Hint cost is disclosed only in a hover tooltip
`ChessGame.jsx:1472-1477` — `title="Piece hint (counts as a miss)"`. Hover doesn't
exist on touch, so mobile users get rating docked for something they were never told
was costly. **[verified live: rating went 1000 → 980 on a wrong move.]**
Severity: medium · Effort: S

### 5.15 Puzzle rating shows no delta, unlike rated games
`ChessGame.jsx:1499` vs. the `ratedDelta` display at `1382-1389`. Same Elo math,
same file — one shows "+12/-8," the other shows a bare number.
Severity: medium · Effort: S

### 5.16 Mid-game difficulty changes take effect immediately and silently
`ChessGame.jsx:1765-1776`, `375-378` — `moveSpec` recomputes live, so the dropdown
changes opponent strength on the next engine move. Either an undocumented escape
hatch or a bug; nothing in the UI says which.
Severity: low · Effort: S

### 5.17 No keyboard or SAN move entry
`ChessGame.jsx:781-819` — pointer-only. Chess is unusually keyboard-friendly (SAN
input is a standard alternative UI); its absence is a real accessibility gap.
Severity: medium · Effort: M

### 5.18 CDN engine failure suggests a recovery that can't work
`engine/stockfishLoader.js:13-14`, `ChessGame.jsx:1317-1318` — "check your
connection and start a new game," but a new game re-fails for the same reason. No
retry button, no mention that an ad-blocker or proxy blocking jsdelivr is the likely
cause.
Severity: low · Effort: S

### 5.19 No time controls anywhere
No clock state exists. Notable mainly because "Rated" strongly implies a
Lichess/Chess.com-style ladder, where time controls are assumed.
Severity: medium · Effort: L

### 5.20 Commentary renders newest-first while the move list renders oldest-first
`ChessGame.jsx:1663` (`dialogue.slice().reverse()`) — reviewing a game means
flipping reading direction between two adjacent panels.
Severity: low · Effort: S

---

## Smaller items

- **Coach panel wastes its whole column in rated mode** — one static paragraph
  occupying the largest panel for the entire game (`ChessGame.jsx:1635-1641`).
- ~~**`describePuzzleFail` is dead code**~~ — **incorrect.** It is reached via
  `coachClient.js`'s `kind: 'puzzle-fail'` template path, which `ChessGame.jsx`
  drives through `buildFailPayload` + `requestCommentary`. Not dead; no fix needed.
- **`weaknessProfile()` never reaches keyless users** — computed at
  `coach/mistakeStore.js:114-140`, consumed only by the Claude path. The
  template fallback never reads it, and it's never shown as a standalone stat.
- **Inaccuracies are excluded from the mistake library** (`ChessGame.jsx:513-532`)
  with the >130cp boundary invisible to the user — arguably the most improvable
  category for intermediate players.
- **Puzzle SRS streak data is tracked and never shown** — `coach/puzzleProgress.js:52-56`
  drives a 1d/3d/7d ladder the user can't see working.
- **Lichess daily puzzle joins mid-session silently**, changing the "N/M" denominator
  the user is tracking (`ChessGame.jsx:888-897`).
- **Hints degrade silently after an alternate sound move** — you pay the same cost
  for a vague "keep going" with no explanation why (`coach/puzzleCoach.js:26-31`).
- **Puzzle-hint LLM rephrasing has no spoiler guard** — the prompt instructs Claude
  not to name moves, but nothing validates the response (`api/chessCoach.js:107`).
- **Two account UIs have drifted** — landing page and in-game copy differ, and only
  the landing page mentions the key also powers Catan/Splendor/Diplomacy.
- **No theme/difficulty filter for puzzles**, though every entry is already tagged.
- **No repertoire concept** — no way to declare "I play the Ruy Lopez" and get
  feedback against it. Zero hits for "repertoire" in the codebase.
- **No cross-game progress view** — accuracy trend, blunder rate over time, opening
  report card. The data largely exists; nothing aggregates it.
- **Settings is one flat list** mixing dark mode with account credentials, no
  sub-headers.
- **Rated jargon undefined** — "Provisional," "rung," "1000?" appear with no
  explanation. **[verified live: the header reads "You 1000? · Opponent 1000"]**
- **Puzzle rating and game Elo** are two unrelated 4-digit numbers with no note that
  they measure different things.
- **Material tray is coupled to the eval-bar toggle** — turning off the eval bar to
  avoid engine assistance also removes the captured-piece count, which is just
  arithmetic, not a hint.

---

## Suggested sequencing

**Quick wins (all S, mostly one-liners, high user-visible payoff):**
Puzzles due-count badge (4.8) · difficulty descriptors (5.1) · rematch button (5.2) ·
"Material:" prefix (5.5) · Play-as selected state (5.6) · touch-target padding sweep
(2.2) · Anthropic key link + cost line (4.3) · failed-key badge (4.4) · password
confirm field (5.12) · sign-out key disclosure (5.13) · confirm on rated toggle (1.2)
and resign (1.4) · hide the puzzle theme until solved (3.8).

**Then the structural fixes:**
Game persistence (1.3) · puzzle-exit state and color bug (1.1) · mobile coach
placement (2.1) · post-game analysis in rated mode (3.6) · puzzle session-end
summary (5.3) · clickable move list (5.4) · coaching latency (5.8).

**Then the content and pedagogy work — the highest ceiling, the largest effort:**
Motif-based commentary so the free path teaches (3.1) · opening ideas and a deeper
book (3.2, 3.3) · position-based transposition detection (3.4) · bulk puzzle import
with non-mate tactics (3.7) · board-animated puzzle refutations (3.5).
