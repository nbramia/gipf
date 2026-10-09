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

A round is dealt by the worker with `chooseNextRound(board, desiredLength(rating))`. The clock starts when the round is shown and pauses while the tab is hidden. Select a robot by clicking or tapping it, or with `R` `G` `B` `Y`. Input mode is stored in `ricochetInputMode` (`plan` or `live`, default `plan`) and changed in Settings.

**Plan mode (default).** The board does not move while a line is entered. Arrow keys, `W` `A` `S` `D`, the on-screen pad, a tap on the board (dominant axis from the selected robot) and a swipe each append a step (robot and direction) to the plan, shown as a chip list with a step count. Nothing indicates whether a step is legal: no direction arrows are drawn on the board, no pad direction is disabled, and a step whose robot cannot move still counts. `U`/Backspace removes the last step, `Esc` clears the plan, and `Enter` or Submit plays it on the board at about 0.3 s per step (near-instant with reduced motion), with a short bump for a blocked step. Input is locked during the replay. The plan is evaluated on a scratch board from the round's start positions:

- If the target's robot (any robot for the vortex) stops on the target at some step, the round is solved. Its move count is that step's index (blocked steps included), later steps are ignored, and the time is the moment of submission minus hidden-tab time. One history entry is recorded, and the "You" line in the results shows the submitted steps up to the solving step.
- Otherwise the final position is held for about 0.8 s, the robots return to the round start, and the plan stays for editing. The clock keeps running and nothing is recorded.

**Live mode.** Each move slides immediately. Only legal directions are offered (arrows beside the selected robot, enabled pad directions). `U`/Backspace undoes a move, including a reset, but never into the previous round; `Esc` resets the round. Neither stops the clock.

**Both modes.** Solving shows the results panel in place of the controls; "Show solution" replays the optimal line from the round's start and restores the solved position, and "Next puzzle" is available during a replay and cancels it. "Give up" asks for confirmation, replays the optimal line, scores 0 and records the round as revealed (with the number of steps entered). Dark mode is stored in `ricochetDarkMode`.

**Path traces.** An optional setting (`ricochetPathTraces`, `off` | `on`, default `off`, changed in Settings). When on, each move of the latest movement sequence is drawn under the robots as a semi-transparent line in the robot's colour from its start cell to its stop cell, with an arrowhead and a step number. A trace is a list of cell path points (start, any bend, end), drawn as one polyline, so deflections can be drawn later. The arrowhead stops 15 px short of the stop cell centre (the robot covers the centre) and the step number sits on the line, clear of the stop cell. A plan step that cannot move (wall or robot in the way) is drawn as a numbered bump: a short stub toward the obstacle ending in a cross, in the robot's colour. A trace that runs along an earlier one (for example a move and its reverse) is shifted sideways by 5 px per earlier overlapping trace so every step stays visible. Traces cover a plan submit (revealed step by step with the replay, kept on the snapped-back board after a failed submit until the plan is edited or submitted again), the Show solution and Give up replays (step by step), and live moves (following Undo, Reset and Redo). In the results panel the "You" and "Optimal" labels toggle their traces (Optimal is dashed); a solve shows "You" first and a reveal shows "Optimal". A new round clears everything. With the setting off no trace elements are rendered.

## Scoring and rating

- `quality = clamp(optimal / moves, 0, 1)`.
- Target time is 20 s per optimal move. `pace` is 1 at or below half the target, 0.3 at or beyond four times the target, and log-linear between.
- `score = quality x pace`; a revealed round scores 0.
- Rating starts at 1200 (floor 100). Round difficulty is `500 + 150 x optimal`; expected score is `1 / (1 + 10^((difficulty - rating) / 400))`; the change is `round(K x (score - expected))` with K 40 for the first 20 rounds (provisional), 24 up to 50, then 16.
- The next round targets an optimal length of `round((rating - 500) / 150)`, clamped to 2 to 12.
- History keeps the last 500 rounds in `ricochetHistory`; the rating and round count live in `ricochetRating`. The progress panel summarizes the last 20 rounds.

## Tests

`CI=true npm test` covers the engine suites and `RicochetGame.ui.test.jsx` (worker mocked): keyboard and click solves, one history entry per solve, give-up, undo/reset with the clock, hidden-tab time, and stale worker replies.
