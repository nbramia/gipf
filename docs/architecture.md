# Architecture

## Project Structure

GIPF Project is a multi-game React application. Each game is self-contained in `src/games/<name>/` and lazy-loaded via React Router. Games share only the routing shell, Tailwind config, fonts, and deployment infrastructure.

```
src/
  App.jsx              # BrowserRouter + React.lazy routes
  LandingPage.jsx      # Landing page with game cards
  index.css            # Tailwind directives + shared keyframes
  index.js             # React DOM entry point
  games/
    yinsh/             # Complete Yinsh game (logic + UI + AI + CSS + tests)
    zertz/             # Complete Zertz game (logic + UI + CSS + tests)
api/                   # Vercel serverless functions
scripts/               # CLI tools (self-play, training, tournaments)
training/              # PyTorch training pipeline
public/models/         # ONNX neural network models
```

## Routing and Code Splitting

`App.jsx` uses `React.lazy()` for game components:

```jsx
const YinshGame = lazy(() => import('./games/yinsh/YinshGame.jsx'));
const ZertzGame = lazy(() => import('./games/zertz/ZertzGame.jsx'));
```

This means visiting `/zertz` never loads the Yinsh MCTS engine or ONNX runtime. `LandingPage` is eagerly loaded since it's the entry point.

`vercel.json` routes API calls to serverless functions and everything else to `index.html` for client-side routing:
```json
{ "source": "/api/:path*", "destination": "/api/:path*" },
{ "source": "/(.*)", "destination": "/index.html" }
```

## CSS Isolation

Both games define CSS custom properties with overlapping names (`--color-bg-page`, `--color-accent`, etc.) but different values. They're isolated by scoping under wrapper classes:

- Yinsh: `.game-yinsh` and `.game-yinsh.dark` (in `src/games/yinsh/yinsh.css`)
- Zertz: `.game-zertz` and `.game-zertz.dark` (in `src/games/zertz/zertz.css`)

Animation keyframes are prefixed (`yinsh-piece-fade-in`, `zertz-piece-fade-in`) and animation classes are scoped (`.game-yinsh .piece-enter`). The only shared keyframe is `slide-in-right` in `src/index.css`.

Each game component's root div includes the wrapper class:
```jsx
<div className={`game-yinsh min-h-screen ... ${darkMode ? 'dark' : ''}`}>
```

## Game Architecture Pattern

Both games follow the same separation of concerns:

| Module | Responsibility |
|--------|----------------|
| `<Game>Board.js` | Pure game logic -- state, rules, phase transitions. No React, no UI. |
| `<Game>Game.jsx` | React UI -- SVG board rendering, modals, interaction handlers, localStorage. |
| `<game>.css` | Scoped CSS variables and animations. |
| `<Game>Board.test.js` | Jest tests for game logic. |

This separation means:
- AI can simulate game logic without UI overhead
- Tests run without React
- Each module can be understood independently
- Games don't import from each other

---

## Yinsh

### Files

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/games/yinsh/YinshBoard.js` | ~1,050 | Pure game logic -- state, rules, phase transitions |
| `src/games/yinsh/YinshGame.jsx` | ~1,180 | React UI -- SVG board, modals, interactions, AI integration |
| `src/games/yinsh/engine/mcts.js` | ~2,400 | AI engine -- MCTS, heuristic + NN evaluation |

Supporting files:

| File | Purpose |
|------|---------|
| `YinshNotation.js` | Chess-style move notation |
| `engine/features.js` | Board state -> NN input feature extraction |
| `engine/valueNetwork.js` | Browser ONNX inference (onnxruntime-web) |
| `engine/valueNetworkNode.js` | Node.js ONNX inference (onnxruntime-node) |
| `engine/aiPlayer.js` | Shared AI move interface for UI and CLI |
| `hooks/useAIWorker.js` | React hook managing MCTS Web Worker lifecycle |
| `testHelpers.js` | Board state fixtures and test utilities |

### Coordinate System

Axial hexagonal coordinates `(q, r)` where both range from -5 to 5, with 8 corner positions excluded, giving 85 grid points (51 playable intersections).

**Storage:** `boardState["q,r"]` -> `{type: 'ring'|'marker', player: 1|2}`

**Screen conversion:**
```
x = q * 50 + r * 25 + 300
y = r * 43.3 + 300
```

**Six hexagonal directions:** `[1,0] [0,1] [-1,1] [-1,0] [0,-1] [1,-1]`

### Game Phase State Machine

```
setup --> play --> remove-row --> remove-ring --> play (loop)
                                      |
                                (if score == 3)
                                      |
                                 game-over
```

**Setup:** 10 rings placed alternately (5 per player). After the 10th, phase transitions to `play`.

**Play:** Select a ring, move it along a straight line. A marker is placed at the origin. Jumped markers flip. If rows of 5 form, phase transitions to `remove-row`.

**Remove-row:** Queue-based iterative resolution. Active player's rows first, then opponent's. Each removal triggers a re-check for new rows. Most complex logic in the codebase.

**Remove-ring:** Sacrifice one ring to score. If score reaches 3, game over.

### Row Resolution Queue

```javascript
rowResolutionQueue = [
  { player: activePlayer, rows: [...] },
  { player: opponent,     rows: [...] }
]
```

Active player resolves ONE row at a time. After each removal, re-check for new rows (added to FRONT of queue). After active player finishes, opponent resolves theirs. Only when the queue is empty does the game proceed.

### AI Architecture

Two execution modes:
- **Local**: Web Worker (`mcts.worker.js`), 200 simulations per move
- **API**: Vercel serverless at `/api/aiMove`, 30-500 sims with 2.5s time budget

Two evaluation modes:
- **Heuristic**: 12-move rollouts + hand-crafted scoring (`_evaluatePlayoutResult()`)
- **Neural Network**: ONNX value network (`_evaluateWithNN()`), scaled to +/-5000

### Value Network Pipeline

```
Self-play data generation (scripts/generate-training-data.mjs)
  -> NDJSON: {board: [484], meta: [5], value: +/-1.0}
  -> PyTorch training (training/train.py)
  -> ONNX export (training/export_onnx.py)
  -> public/models/yinsh-value-v1.onnx
  -> Browser: onnxruntime-web loads model in Web Worker
  -> MCTS uses NN output instead of rollouts
```

Feature extraction (`engine/features.js`):
- 4 planes of 11x11 (current player rings, markers; opponent rings, markers)
- 5 scalar metadata (scores, ring counts, phase encoding)

### localStorage Keys

```
yinshDarkMode, yinshShowMoves, yinshRandomSetup,
yinshKeepScore, yinshWins, yinshShowMoveHistory, yinshEvaluationMode
```

---

## Zertz

### Files

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/games/zertz/ZertzBoard.js` | ~795 | Pure game logic -- rings, marbles, captures, isolation |
| `src/games/zertz/ZertzGame.jsx` | ~667 | React UI -- SVG hex board, modals, interactions |
| `src/games/zertz/ZertzBoard.test.js` | ~2,728 | Comprehensive Jest tests |

### Coordinate System

Axial hexagonal coordinates `(q, r)` where `max(|q|, |r|, |q+r|) <= 3`, giving 37 positions.

**Storage:**
- `rings`: `Set` of `"q,r"` string keys (positions that still have rings)
- `marbles`: `{"q,r": 'white'|'grey'|'black'}` (marbles placed on rings)
- `pool`: `{white: n, grey: n, black: n}` (shared marble supply)
- `captures`: `{1: {white, grey, black}, 2: {white, grey, black}}`

**Screen conversion:**
```
x = 34 * (sqrt(3) * q + sqrt(3)/2 * r)
y = 34 * 1.5 * r
```

### Game Phase State Machine

```
place-marble --> remove-ring --> (check forced captures)
                                      |
                              capture (if jumps exist)
                                      |
                              (multi-jump loop)
                                      |
                              place-marble (next player)
                                      |
                              game-over (if win condition met)
```

**Place-marble:** Select a marble color from the shared pool, place it on any empty ring.

**Remove-ring:** Remove one ring from the board edge (must have no marble, must be on the perimeter). After removal, check for isolated groups -- rings disconnected from the main board are removed along with their marbles (captured by the player who caused the isolation).

**Capture (forced):** If the current player has any marble that can jump over an adjacent marble into an empty ring, they MUST execute the jump. Jumped marbles are captured. Multi-jump sequences are supported.

**Win conditions:** First player to capture 4 white, 5 grey, 6 black, or 3 of each color wins.

### localStorage Keys

```
zertzDarkMode, zertzShowMoves
```

---

## Shared Infrastructure

### State Management (Both Games)

```
User Click
  -> <Game>Game.handleClick(q, r)
    -> <Game>Board.handleClick(q, r)     // mutates internal state
      -> <Game>Board._captureState()      // snapshot for undo/redo
    -> setBoard(board.clone())           // React re-render
```

The Board class is the single source of truth. React state holds a clone for rendering. After any mutation, `.clone()` must be called to trigger re-render.

### Undo/Redo (Both Games)

`_captureState()` creates a deep snapshot after every successful move. Both games support:
- History limited to prevent memory issues (50 for Yinsh, 100 for Zertz)
- `undo()` / `redo()` restore from snapshots
- Redo history cleared when a new move is made after undo
- History cleared on new game
- Test helpers use `skipInitialHistory: true`

### Testing

305 tests across 5 suites, auto-discovered by `testMatch: ['**/*.test.js']`:
- `YinshBoard.test.js` -- game logic
- `ZertzBoard.test.js` -- game logic
- `mcts.test.js` -- MCTS unit tests
- `mcts.positions.test.js` -- positional AI tests
- `mcts.benchmark.test.js` -- performance tests

```bash
CI=true npm test          # All 305 must pass before deployment
```
