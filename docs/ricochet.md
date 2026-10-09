# Ricochet

Solo Ricochet Robots at `/ricochet`. Four robots on a 16 by 16 walled board; each round shows one target symbol, and the player slides robots until the matching colour stops on it (the vortex accepts any robot). It is device-only: no account, cloud or resumable-match integration.

## Rules coverage

- A robot slides until a wall or another robot stops it. The centre 2x2 block is solid.
- Any robot may move; only the target-coloured robot (any robot for the vortex) can claim the target.
- 17 targets: each of 4 colours in each of 4 shapes (circle, triangle, square, hexagon) once, plus one vortex. Each sits in an L of two walls.
- The next round starts from wherever the robots ended. A claimed target is not dealt again; when none is usable a fresh board is generated.
- **Bounce rule.** The published game requires at least one ricochet before a target counts. Here a round whose optimal solution is one move is never dealt (`engine/rounds.js`), so any stop on the target solves it.

## Modules (`src/games/ricochet/`)

| File | Purpose |
|------|---------|
| `RicochetBoard.js` | Pure rules/state: seeded board, robots, `applyMove`, `startRound`, `resetRound`, undo/redo, serialize/clone |
| `engine/geometry.js` | Grid indexing, wall bitmasks, slide |
| `engine/generator.js` | Seeded board: four rotated quadrants, L-shaped target corners, edge stubs |
| `engine/solver.js` | Optimal solver (iterative deepening DFS, lower-bound table, transposition table, time limit) |
| `engine/rounds.js` | `chooseNextRound`: the unclaimed target whose optimum is closest to the desired length |
| `engine/scoring.js`, `engine/rating.js`, `engine/history.js` | Per-round score, rating, persisted history |
| `engine/solver.worker.js`, `hooks/` | Dealing runs in a Web Worker; `useSolverWorker` drops replies from abandoned requests |
| `RicochetGame.jsx`, `RicochetBoardView.jsx`, `ricochet.css` | UI |

## Play flow

A round is dealt by the worker with `chooseNextRound(board, desiredLength(rating))`. The clock starts when the round is shown and pauses while the tab is hidden. Controls: select a robot (click, tap, or `R` `G` `B` `Y`), then arrow keys or `W` `A` `S` `D`, a direction arrow drawn beside the robot (legal directions only), the on-screen pad, or a swipe. `U`/Backspace undoes, `Esc` resets the round; neither stops the clock. Solving records one history entry and shows the results panel; "Show solution" replays the optimal line from the round's start and restores the solved position. "Give up" asks for confirmation, replays the optimal line, scores 0 and records the round as revealed. Dark mode is stored in `ricochetDarkMode`.

## Scoring and rating

- `quality = clamp(optimal / moves, 0, 1)`.
- Target time is 20 s per optimal move. `pace` is 1 at or below half the target, 0.3 at or beyond four times the target, and log-linear between.
- `score = quality x pace`; a revealed round scores 0.
- Rating starts at 1200 (floor 100). Round difficulty is `500 + 150 x optimal`; expected score is `1 / (1 + 10^((difficulty - rating) / 400))`; the change is `round(K x (score - expected))` with K 40 for the first 20 rounds (provisional), 24 up to 50, then 16.
- The next round targets an optimal length of `round((rating - 500) / 150)`, clamped to 2 to 12.
- History keeps the last 500 rounds in `ricochetHistory`; the rating and round count live in `ricochetRating`. The progress panel summarizes the last 20 rounds.

## Tests

`CI=true npm test` covers the engine suites and `RicochetGame.ui.test.jsx` (worker mocked): keyboard and click solves, one history entry per solve, give-up, undo/reset with the clock, hidden-tab time, and stale worker replies.
