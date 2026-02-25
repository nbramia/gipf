# Development Guide for AI Agents

Practical guide for working on any part of the GIPF Project codebase. CLAUDE.md is the primary reference for rules and architecture -- this document covers **how** to work in each area.

---

## Quick Orientation

The codebase has five development areas:

| Area | Key Files | Test Command |
|------|-----------|--------------|
| **Yinsh Game Logic** | `src/games/yinsh/YinshBoard.js`, `YinshNotation.js` | `CI=true npm test` |
| **Zertz Game Logic** | `src/games/zertz/ZertzBoard.js` | `CI=true npm test` |
| **UI (either game)** | `src/games/<name>/<Name>Game.jsx` | `npm start` (manual) |
| **Yinsh AI Engine** | `src/games/yinsh/engine/mcts.js`, `aiPlayer.js` | `npm run test:engine` |
| **Routing / Landing** | `src/App.jsx`, `src/LandingPage.jsx` | `npm run build` |

Always verify your area's tests pass before and after changes.

---

## Game Logic (`src/games/<name>/<Name>Board.js`)

### How It Works

Both `YinshBoard` and `ZertzBoard` are ES module classes. Zero React dependency. Every game action flows through `handleClick(q, r)` -- the phase determines what happens.

**Yinsh phases:** `setup` -> `play` -> `remove-row` -> `remove-ring` -> `play` (loop) -> `game-over`

**Zertz phases:** `place-marble` -> `remove-ring` -> `capture` (if forced jumps exist) -> `place-marble` (next player) -> `game-over`

### How to Modify

1. **Read the existing code** around your change area
2. **Write a failing test first** in the game's test file
3. **Make the minimal change** in the Board class
4. **Run `CI=true npm test`** -- all 305 tests must pass
5. **Verify `npm run build`** -- catches import/syntax issues

### Patterns to Follow

**State mutation always calls `_captureState()`:**
```javascript
this.boardState[key] = { type: 'ring', player: this.currentPlayer };
this._captureState();
```

**Phase transitions use direct assignment:**
```javascript
this.gamePhase = 'remove-row';
```

**Coordinate handling:**
```javascript
const key = this._toKey(q, r);           // "q,r" string
const [q, r] = this._fromKey(key);       // back to numbers
```

### Writing Tests

**Yinsh** -- use helpers from `testHelpers.js`:
```javascript
import { createBoardWithPieces, simulateMove } from './testHelpers';

test('move flips markers', () => {
  const board = createBoardWithPieces([
    { q: 0, r: 0, type: 'ring', player: 1 },
    { q: 0, r: 1, type: 'marker', player: 2 },
  ]);
  board.gamePhase = 'play';
  board.currentPlayer = 1;
  board._captureState();
  simulateMove(board, [0, 0], [0, 2]);
});
```

**Zertz** -- construct boards directly:
```javascript
const board = new ZertzBoard({ skipInitialHistory: true });
board.marbles['0,0'] = 'white';
board.gamePhase = 'capture';
board._captureState();
```

Always pass `skipInitialHistory: true` when constructing test boards manually, then call `_captureState()` after setup.

---

## UI (`src/games/<name>/<Name>Game.jsx`)

### How It Works

Large functional components rendering SVG boards, settings panels, move history, and modals. Tailwind CSS for layout, CSS custom properties (from `<game>.css`) for theme colors.

**State lives in two places:**
- Board instance -- game state (source of truth)
- React `useState` hooks -- UI state (dark mode, panel visibility, etc.)

**The render cycle:**
```
User clicks SVG -> handle click
  -> board.handleClick(q, r)    // mutates board
  -> setBoard(board.clone())    // triggers re-render
```

### How to Modify

1. **Run `npm start`** and navigate to the game
2. **Find the relevant JSX** -- components are large but organized:
   - Top: state declarations and effects
   - Middle: event handlers
   - Bottom: JSX return with SVG board, panels, modals
3. **Make changes and verify visually** -- check all phases, both themes, mobile viewport
4. **Run `CI=true npm test`**

### CSS Rules

- All game-specific CSS goes in `<game>.css`, scoped under `.game-<name>`
- Never add CSS variables to `:root` -- scope them under the game wrapper
- New animations need prefixed keyframe names (`yinsh-*`, `zertz-*`)
- Shared CSS (only Tailwind directives and `slide-in-right`) lives in `src/index.css`

### localStorage

Both games persist preferences with game-prefixed keys. Never rename them without migration.

---

## Yinsh AI Engine (`src/games/yinsh/engine/`)

### How It Works

MCTS with UCB1 selection, configurable simulation count, and two leaf evaluation modes.

```
getBestMove(board, simulations):
  1. Fast heuristic pre-scan of all root moves (catches immediate wins)
  2. If no tactical shortcut -> run N MCTS simulations:
     a. Selection: traverse tree by UCB1
     b. Expansion: add one child node
     c. Simulation: evaluate leaf (heuristic rollout OR NN forward pass)
     d. Backpropagation: update win/visit stats
  3. Return move with highest visit count
```

### How to Modify

**Heuristic weights** are in `_evaluatePlayoutResult()`. Verify with tournaments:
```bash
node scripts/tournament.mjs --games 10 --sims 50
```

**Move ordering** is in `_selectMoveByFastHeuristic()`. Pre-sorts root moves for search efficiency.

**Transposition table** is module-level. Keyed by `board.getStateHash()`. Cleared between games.

### The Dual-File Rule

Browser and Node.js use different ONNX runtimes:

| File | Runtime | Used By |
|------|---------|---------|
| `valueNetwork.js` | `onnxruntime-web` (WASM) | Browser Web Worker |
| `valueNetworkNode.js` | `onnxruntime-node` (native) | CLI scripts |

Both export a `ValueNetwork` class with the same API. **Changes must be mirrored in both files.**

---

## CLI Scripts (`scripts/`)

All scripts are ES modules (`.mjs`). They resolve game source files via:
```javascript
const srcDir = resolve(__dirname, '..', 'src', 'games', 'yinsh');
```

### Running Scripts

```bash
# Self-play data generation
node scripts/generate-training-data.mjs --games 50 --sims 200 \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/v14_selfplay.ndjson

# Tournament: model vs model
node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn \
  --model1 public/models/yinsh-value-vNEW.onnx \
  --model2 public/models/yinsh-value-v1.onnx

# AI self-play evaluation
node scripts/self-play.mjs --games 10 --sims 100
```

---

## Adding a New Game

1. Create `src/games/<name>/` with `<Name>Board.js`, `<Name>Game.jsx`, `<name>.css`, `<Name>Board.test.js`
2. Follow the Board/Game separation pattern -- Board has zero React dependencies
3. Scope CSS: `.game-<name>` for light, `.game-<name>.dark` for dark, prefix all keyframes
4. Add wrapper class to root div: `className={`game-<name> min-h-screen ...`}`
5. Add `import './<name>.css'` to game component
6. Add lazy route in `src/App.jsx`
7. Add card in `src/LandingPage.jsx`
8. Use `<name>` prefix for all localStorage keys
9. Run `CI=true npm test && npm run build` to verify

---

## Debugging

### Game Logic Issues

1. Add a test that reproduces the bug
2. Use `board.getBoardState()` (Yinsh) or `board.rings` / `board.marbles` (Zertz) to inspect state
3. Check phase transitions -- most bugs are phase-related
4. For Yinsh: check the row resolution queue
5. For Zertz: check forced capture detection and isolation logic

### AI Issues (Yinsh)

1. Run position tests: `npm run test:engine`
2. Inspect with low sims: `getBestMove(board, 10)` and log the move tree
3. Compare modes: tournament heuristic vs NN

### UI Issues

1. Check both themes (light and dark)
2. Check mobile viewport
3. Check all game phases
4. Run `npm run build` -- catches issues dev server ignores

---

## Task Playbooks

### "Fix a bug in game logic"
1. Read the relevant Board class
2. Write a test that reproduces the bug
3. Fix the bug
4. Verify: `CI=true npm test` (all 305 pass)
5. Verify: `npm run build`

### "Add a new UI feature"
1. Read the relevant Game component
2. Implement the feature
3. Test manually (`npm start`) -- both themes, all phases
4. Verify: `CI=true npm test` and `npm run build`

### "Improve the Yinsh AI"
1. Read `src/games/yinsh/engine/mcts.js`
2. Make changes
3. Verify: `npm run test:engine`
4. Run tournament to measure improvement
5. Verify: `CI=true npm test` and `npm run build`

### "Deploy changes"
1. `CI=true npm test` -- all 305 pass
2. `npm run build` -- no errors
3. Manual play-through if game logic changed
4. `git push origin main` -- Vercel auto-deploys

---

## File Modification Checklist

| If you modify... | Also check/update... |
|---|---|
| `YinshBoard.js` | Tests, `mcts.js` if it reads changed state |
| `ZertzBoard.js` | Tests in `ZertzBoard.test.js` |
| `<Game>Game.jsx` | Manual browser testing, both themes |
| `mcts.js` | Engine tests, position tests, tournament baseline |
| `features.js` | Both `valueNetwork.js` and `valueNetworkNode.js`, retraining may be needed |
| `valueNetwork.js` | Mirror changes to `valueNetworkNode.js` |
| `<game>.css` | Both light and dark mode rendering |
| `App.jsx` | All routes still work, build succeeds |
| `LandingPage.jsx` | Visual check in browser |
| `index.css` | Both games still render correctly |
| `api/aiMove.js` | CORS origins (TWO lists -- main handler and error handler) |
