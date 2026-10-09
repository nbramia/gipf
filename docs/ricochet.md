# Ricochet

Solo Ricochet Robots at `/ricochet`. Four robots on a 16 by 16 walled board (the engine also supports 12 by 12 boards, a fifth robot and diagonal barriers, below); each round shows one target symbol, and the player slides robots until the matching colour stops on it (the vortex accepts any robot). It is device-only: no account, cloud or resumable-match integration.

## Rules coverage

- A robot slides until a wall or another robot stops it. The centre 2x2 block is solid.
- Any robot may move; only the target-coloured robot (any robot for the vortex) can claim the target.
- 17 targets: each of 4 colours in each of 4 shapes (circle, triangle, square, hexagon) once, plus one vortex. Each sits in an L of two walls.
- The next round starts from wherever the robots ended. A claimed target is not dealt again; when none is usable a fresh board is generated.
- **Bounce rule.** The published game requires at least one ricochet before a target counts. Here a round whose optimal solution is one move is never dealt (`engine/rounds.js`), so any stop on the target solves it.

## Board variants (engine)

The board takes an optional config `{ size: 16 | 12, fifthRobot: false | true, diagonals: false | true }` (`engine/config.js`; default `{16, false, false}`; `CONFIGS` lists all eight). `new RicochetBoard({ seed, config })` builds it; the config and barrier list are part of `serializeState()`, and a state without them restores as the default board. `startNewGame` keeps the variant. The default config produces exactly the classic board, locked by `golden.test.js` against `fixtures/golden-default.json` (seeds 1 to 200: walls, targets, robot placement, optimal length of every target).

- **12x12.** Four 6x6 quadrants around a walled 2x2 centre (rows and columns 5 and 6). Each quadrant has 2 coloured L-corners (each colour twice, with two different shapes) and one quadrant also holds the vortex: 9 targets. One wall stub per quadrant, so one on each side of the board. Targets keep the 16x16 spacing rules scaled to the quadrant: off the outer ring, not touching the centre block, no two touching. All geometry takes a `size`.
- **Fifth robot (black).** A full robot: it moves, each of its moves counts, it blocks and is blocked. It starts on a random free cell (not a target, barrier or centre cell), drawn after the four colours so their placement is unchanged. It claims the vortex but never a coloured target. `board.robotNames` lists the robots in order (black last).
- **Diagonal barriers.** One cell each, orientation `/` or `\`, one of the four colours: 2 per quadrant on 16x16, 1 on 12x12, never on a target, the outer ring or the centre, never orthogonally adjacent to each other, colours spread evenly. They come from their own random stream, so the walls and targets of a seed are the same with or without them. A robot of the barrier's colour passes through; any other robot, black always, turns 90 degrees and keeps sliding (`/`: N to E, E to N, S to W, W to S; `\`: N to W, W to N, S to E, E to S). A deflection is not an extra move. A robot may not stop on a barrier cell: if the slide ends on one (wall or robot right behind it, including right after a deflection) it stops on the cell before it, and if that is its starting cell the move is illegal. A slide that re-enters the same (cell, direction) loops and is illegal.
- **For the UI.** `board.size`, `board.robotNames`, `board.barriers` (`{cell, orient, color}`), `board.getSlidePath(robot, dir)` (start, each turn cell, stop; `null` if illegal), and on a board with barriers each move record carries the same `path`. `geometry.js` exports `centerCellsOf(size)`, `cellOf`/`rowOf`/`colOf` with a `size` argument, and the slide primitive `slideCells` for the full cell-by-cell route.
- **Solver.** Without barriers it is the original search (per-cell stop table, one lower-bound table). With barriers, routes are precomputed per robot colour and clipped by other robots, and the lower bound is one table per colour (black deflects at every barrier; a move may end on any non-barrier cell of its route), so it stays admissible. Four robots keep a one-word transposition key; five use two words with double hashing. Without barriers interchangeable robots are sorted into the key, with barriers cells are kept by colour. `solve` takes `size` and `barriers` beside `walls`, `robots` and `target`; a `black` entry in `robots` means five robots.
- **Bench.** `node scripts/ricochet-solver-bench.mjs --all 1` reports every config; `--size 12 --five 1 --diag 1` picks one.

## Modules (`src/games/ricochet/`)

| File | Purpose |
|------|---------|
| `RicochetBoard.js` | Pure rules/state: seeded board, robots, `applyMove`, `startRound`, `resetRound`, undo/redo, serialize/clone |
| `engine/config.js` | Variant config: defaults, the eight combinations, normalization |
| `engine/geometry.js` | Grid indexing by size, wall bitmasks, slide, barrier-aware slide routes |
| `engine/generator.js` | Seeded board: four rotated quadrants, L-shaped target corners, edge stubs, diagonal barriers |
| `engine/solver.js` | Optimal solver (iterative deepening DFS, lower-bound tables, transposition table, time limit) |
| `engine/rounds.js` | `chooseNextRound`: the unclaimed target whose optimum is closest to the desired length |
| `engine/scoring.js`, `engine/rating.js`, `engine/history.js` | Per-round score, rating, persisted history |
| `engine/solver.worker.js`, `hooks/` | Dealing runs in a Web Worker; `useSolverWorker` drops replies from abandoned requests |
| `RicochetGame.jsx`, `RicochetBoardView.jsx`, `ricochet.css` | UI |

## Play flow

A round is dealt by the worker with `chooseNextRound(board, desiredLength(rating))`. The clock starts when the round is shown and pauses while the tab is hidden. Select a robot by clicking or tapping it, or with `R` `G` `B` `Y`. Input mode is stored in `ricochetInputMode` (`plan` or `live`, default `plan`) and changed in Settings.

**Plan mode (default).** The board does not move while a line is entered. Arrow keys, `W` `A` `S` `D`, the on-screen pad, a tap on the board (dominant axis from the selected robot) and a swipe each append a step (robot and direction) to the plan, shown as a chip list with a step count. Nothing indicates whether a step is legal: no direction arrows are drawn on the board, no pad direction is disabled, and a step whose robot cannot move still counts. `U`/Backspace removes the last step, `Esc` clears the plan, and `Enter` or Submit plays it on the board at about 0.3 s per step (near-instant with reduced motion), with a short bump for a blocked step. Input is locked during the replay. The plan is evaluated on a scratch board from the round's start positions:

- If the target's robot (any robot for the vortex) stops on the target at some step, the round is solved. Its move count is that step's index (blocked steps included), later steps are ignored, and the time is the moment of submission minus hidden-tab time. One history entry is recorded, and the "You" line in the results shows the submitted steps up to the solving step.
- Otherwise the final position is held for about 0.8 s, the robots return to the round start, and the plan stays for editing. The clock keeps running and nothing is recorded.

**Live mode.** Each move slides immediately. Only legal directions are offered (arrows beside the selected robot, enabled pad directions). `U`/Backspace undoes a move, including a reset, but never into the previous round; `Esc` resets the round. Neither stops the clock.

**Both modes.** Solving shows the results panel in place of the controls; "Show solution" replays the optimal line from the round's start and restores the solved position, and "Next puzzle" is available during a replay and cancels it. "Give up" asks for confirmation, replays the optimal line, scores 0 and records the round as revealed (with the number of steps entered). Dark mode is stored in `ricochetDarkMode`.

## Scoring and rating

- `quality = clamp(optimal / moves, 0, 1)`.
- Target time is 20 s per optimal move. `pace` is 1 at or below half the target, 0.3 at or beyond four times the target, and log-linear between.
- `score = quality x pace`; a revealed round scores 0.
- Rating starts at 1200 (floor 100). Round difficulty is `500 + 150 x optimal`; expected score is `1 / (1 + 10^((difficulty - rating) / 400))`; the change is `round(K x (score - expected))` with K 40 for the first 20 rounds (provisional), 24 up to 50, then 16.
- The next round targets an optimal length of `round((rating - 500) / 150)`, clamped to 2 to 12.
- History keeps the last 500 rounds in `ricochetHistory`; the rating and round count live in `ricochetRating`. The progress panel summarizes the last 20 rounds.

## Tests

`CI=true npm test` covers the engine suites (including `golden.test.js` for the default config, `variants.generator.test.js`, `variants.slide.test.js`, `variants.solver.test.js` with an independent breadth-first oracle for all eight configs, and `variants.state.test.js`) and `RicochetGame.ui.test.jsx` (worker mocked): keyboard and click solves, one history entry per solve, give-up, undo/reset with the clock, hidden-tab time, and stale worker replies.
