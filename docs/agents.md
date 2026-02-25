# Development Guide for AI Agents

Practical guide for working on any part of the Yinsh codebase. CLAUDE.md is the primary reference for rules and architecture — this document covers **how** to work in each area.

---

## Quick Orientation

The codebase has four development areas:

| Area | Key Files | Test Command |
|------|-----------|--------------|
| **Game Logic** | `src/YinshBoard.js`, `src/YinshNotation.js` | `CI=true npm test` |
| **UI** | `src/YinshGame.jsx`, `src/hooks/useAIWorker.js` | `npm start` (manual) |
| **AI Engine** | `src/engine/mcts.js`, `src/engine/aiPlayer.js` | `npm run test:engine` |
| **Value Network** | `src/engine/features.js`, `src/engine/valueNetwork*.js`, `training/` | Tournament scripts |

Always verify your area's tests pass before and after changes.

---

## Game Logic (`src/YinshBoard.js`)

### How It Works

YinshBoard is a 1,045-line ES module class. Zero React dependency. Every game action flows through `handleClick(q, r)` — the phase determines what happens.

```
handleClick(q, r) checks gamePhase:
  'setup'       → place ring for currentPlayer at (q,r)
  'play'        → first click selects ring, second click moves it
  'remove-row'  → click a marker in the highlighted row
  'remove-ring' → click one of your rings to sacrifice for a point
```

After each action: `_captureState()` saves an undo snapshot, phase may transition, `currentPlayer` may flip.

### How to Modify

1. **Read the existing code** around your change area — don't assume structure
2. **Write a failing test first** in `src/YinshBoard.test.js`
3. **Make the minimal change** in YinshBoard.js
4. **Run `CI=true npm test`** — all 84 tests must pass
5. **Verify `npm run build`** — CRA build catches import/syntax issues

### Patterns to Follow

**State mutation always calls `_captureState()`:**
```javascript
// Inside a method that changes game state
this.boardState[key] = { type: 'ring', player: this.currentPlayer };
this._captureState();
```

**Phase transitions use direct assignment:**
```javascript
this.gamePhase = 'remove-row';
// NOT a setState call — this is a plain class, not React
```

**Coordinate handling:**
```javascript
const key = this._toKey(q, r);           // "q,r" string
const [q, r] = this._fromKey(key);       // back to numbers
const valid = this._isValidPosition(q, r); // bounds check
```

**Row detection (`checkForRows`)** returns all possible 5-marker row subsets. Overlapping rows are valid — the player chooses which to remove.

### The Row Resolution Queue

This is the most complex logic. If asked to modify it, read it fully first.

```
1. Move creates rows → build queue (active player's rows first, then opponent's)
2. Player selects ONE row → markers removed
3. Re-check board for NEW rows → add to FRONT of queue
4. Repeat until queue empty
5. → remove-ring phase (sacrifice a ring for 1 point)
6. → back to play (or game-over if score == 3)
```

The queue is `this.rowResolutionQueue`, an array of `{player, rows}`. Modifications here require understanding that rows can cascade.

### Writing Tests

Use helpers from `src/testHelpers.js`:

```javascript
import { createBoardWithPieces, simulateMove, countPieces } from './testHelpers';

test('move flips markers', () => {
  const board = createBoardWithPieces([
    { q: 0, r: 0, type: 'ring', player: 1 },
    { q: 0, r: 1, type: 'marker', player: 2 },
    { q: 0, r: 2, type: 'ring', player: 1 },  // destination ring
  ]);
  board.gamePhase = 'play';
  board.currentPlayer = 1;
  board._captureState();

  simulateMove(board, [0, 0], [0, 2]);
  // Verify the marker at (0,1) flipped to player 1
});
```

**Always pass `skipInitialHistory: true`** when constructing boards manually in tests, then call `_captureState()` once after setup is complete.

---

## UI (`src/YinshGame.jsx`)

### How It Works

One large functional component (1,178 lines) that renders everything: SVG board, settings panel, move history, modals. Uses Tailwind CSS for styling and CSS custom properties for theme colors.

**State lives in two places:**
- `YinshBoard` instance — game state (the source of truth)
- React `useState` hooks — UI state (dark mode, panel visibility, etc.)

**The render cycle:**
```
User clicks SVG intersection → handleIntersectionClick(q, r)
  → board.handleClick(q, r)    // mutates board
  → setYinshBoard(board.clone()) // triggers re-render
```

### How to Modify

1. **Run `npm start`** — keep the dev server running
2. **Find the relevant JSX** — the component is large but logically organized:
   - Top: state declarations and effects
   - Middle: event handlers
   - Bottom: JSX return with SVG board, panels, modals
3. **Make changes and verify visually** — check all phases, both themes, mobile viewport
4. **Run `CI=true npm test`** — even for UI changes (some tests render the component)

### SVG Board Rendering

The board is an `<svg>` element with hex grid points rendered as circles and lines. Key coordinate conversion:

```javascript
const x = q * 50 + r * 25 + 300;
const y = r * 43.3 + 300;
```

Rings are SVG circles with stroke, markers are filled circles. Valid move indicators are semi-transparent circles.

### Theming

Colors use CSS custom properties set on the root element:
```css
--color-bg, --color-text, --color-board-bg, --color-line, ...
```

Dark mode toggles these variables. New colors must be added to both light and dark theme definitions.

### Fonts

`Syne` (headings) and `Outfit` (body) via Google Fonts. Loaded in `public/index.html`.

### localStorage

All persisted preferences use `yinsh`-prefixed keys. Never rename them without migration. See CLAUDE.md for the full list.

---

## AI Engine (`src/engine/mcts.js`)

### How It Works

MCTS with UCB1 selection, configurable simulation count, and two leaf evaluation modes.

```
getBestMove(board, simulations):
  1. Fast heuristic pre-scan of all root moves (catches immediate wins)
  2. If no tactical shortcut → run N MCTS simulations:
     a. Selection: traverse tree by UCB1
     b. Expansion: add one child node
     c. Simulation: evaluate leaf (heuristic rollout OR NN forward pass)
     d. Backpropagation: update win/visit stats up the tree
  3. Return move with highest visit count
```

### How to Modify

**Heuristic weights** are in `_evaluatePlayoutResult()`. Changing these affects AI play quality — verify with tournaments:
```bash
node scripts/tournament.mjs --games 10 --sims 50 --mode heuristic-vs-nn \
  --model public/models/yinsh-value-v1.onnx
```

**Move ordering** is in `_selectMoveByFastHeuristic()`. This pre-sorts root moves before MCTS, which significantly affects search efficiency.

**Transposition table** is module-level (`transpositionTable`). Keyed by `board.getStateHash()`. Cleared between games.

### The Two Evaluation Modes

| Mode | Method | Speed | Quality |
|------|--------|-------|---------|
| `heuristic` | `_simulateWithRollout()` — 12-move rollout + scoring | Fast | Good |
| `nn` | `_evaluateWithNN()` — ONNX forward pass, scaled to +/-5000 | Slower per eval | Better |

The NN mode requires a `valueNetwork` instance passed to the MCTS constructor.

### `aiPlayer.js` — The Shared Interface

Both the UI and CLI scripts use `aiPlayer.js` to interact with MCTS:

```javascript
import { getAIMove, applyAIMove } from './engine/aiPlayer.js';

const move = await getAIMove(mcts, board, 200);
const result = applyAIMove(board, move);
// result.flipped = number of markers flipped (for play moves)
```

`applyAIMove` handles all phases — it calls `board.handleClick()` the right number of times depending on the move type.

---

## Value Network

### The Dual-File Rule

Browser and Node.js use different ONNX runtimes but the same inference logic:

| File | Runtime | Used By |
|------|---------|---------|
| `src/engine/valueNetwork.js` | `onnxruntime-web` (WASM) | Browser Web Worker |
| `src/engine/valueNetworkNode.js` | `onnxruntime-node` (native) | CLI scripts |

Both export a `ValueNetwork` class with the same API: `load(path)`, `evaluatePosition(board)`, `isLoaded()`. **Changes must be mirrored in both files.**

### Feature Extraction (`features.js`)

Converts a `YinshBoard` to NN input:
- `board`: Float32Array(484) — 4 planes of 11x11 (current player rings, markers; opponent rings, markers)
- `meta`: Float32Array(5) — normalized scores, ring counts, phase encoding

**Always from current player's perspective** — the network doesn't know which player number it is, only "my pieces" vs "their pieces."

### Training Pipeline

See CLAUDE.md "Training Pipeline" section for the detailed step-by-step procedure and the `/train` skill for automated training runs.

Key files:
- `training/model.py` — 315K param CNN with 4 residual blocks
- `training/dataset.py` — NDJSON loader with 6-fold hex augmentation
- `training/train.py` — Training loop with checkpoint resume
- `training/export_onnx.py` — PyTorch to ONNX conversion
- `scripts/train-iteration.sh` — Full self-improvement cycle

---

## CLI Scripts (`scripts/`)

All scripts are ES modules (`.mjs`). They import from `src/` at runtime.

### Running Scripts

```bash
# Self-play data generation (the longest-running script)
node scripts/generate-training-data.mjs --games 50 --sims 200 \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/v14_selfplay.ndjson

# Tournament: NN vs heuristic
node scripts/tournament.mjs --games 10 --sims 50 \
  --mode heuristic-vs-nn --model public/models/yinsh-value-v1.onnx

# Tournament: model vs model
node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn \
  --model1 public/models/yinsh-value-vNEW.onnx \
  --model2 public/models/yinsh-value-v1.onnx

# AI self-play evaluation
node scripts/self-play.mjs --games 10 --sims 100
```

### Common Patterns in Scripts

Scripts construct boards directly (bypassing `handleClick` for setup) using a fixed ring layout:
```javascript
const STANDARD_RINGS = { 1: [[0,-4],[2,-4],...], 2: [[-2,4],[0,4],...] };
```

They use `skipInitialHistory: true` and set `gamePhase = 'play'` manually.

---

## Debugging

### Game Logic Issues

1. **Add a test** that reproduces the bug in `YinshBoard.test.js`
2. **Use `board.getBoardState()`** to inspect state at any point
3. **Check phase transitions** — most bugs are phase-related
4. **Check the row resolution queue** — if rows aren't resolving correctly

### AI Issues

1. **Run position tests**: `npm run test:engine`
2. **Inspect with low sims**: Run `getBestMove(board, 10)` and log the move tree
3. **Compare modes**: Tournament heuristic vs NN to see if one mode is broken

### NN/ONNX Issues

1. **Verify file integrity**: `file public/models/yinsh-value-v1.onnx.data`
2. **Test inference**: Load model and evaluate a known position
3. **Check features**: Log `extractFeatures(board)` output to verify tensor shape
4. **SIGBUS (exit 138)**: File is zeroed — see Data Safety in CLAUDE.md

### UI Issues

1. **Check both themes** (light and dark)
2. **Check mobile viewport** (the board scales responsively)
3. **Check all game phases** — UI elements change per phase
4. **Check `npm run build`** — catches issues the dev server ignores

---

## Task Playbooks

### "Fix a bug in game logic"
1. Read the relevant section of `YinshBoard.js`
2. Write a test that reproduces the bug
3. Fix the bug
4. Verify: `CI=true npm test` (all 84 pass)
5. Verify: `npm run build`

### "Add a new UI feature"
1. Read the relevant section of `YinshGame.jsx`
2. Implement the feature
3. Test manually in browser (`npm start`) — check both themes, all phases
4. Verify: `CI=true npm test` and `npm run build`

### "Improve the AI"
1. Read `src/engine/mcts.js` (the specific section you're modifying)
2. Make changes
3. Verify: `npm run test:engine`
4. Run a tournament to measure improvement vs baseline
5. Verify: `CI=true npm test` and `npm run build`

### "Continue NN training"
1. Read CLAUDE.md "Training Pipeline" section
2. Or use the `/train <time budget>` skill for automated training
3. Follow the exact steps — augmentation, combined data, low LR, tournament verification

### "Deploy changes"
1. `CI=true npm test` — all 84 pass
2. `npm run build` — no errors
3. Manual play-through if game logic changed
4. `git push origin main` — Vercel auto-deploys

---

## File Modification Checklist

Before modifying any file, check which other files may need coordinated changes:

| If you modify... | Also check/update... |
|---|---|
| `YinshBoard.js` | Tests in `YinshBoard.test.js`, AI in `mcts.js` (if it reads changed state) |
| `YinshGame.jsx` | Manual testing in browser, both themes |
| `mcts.js` | Engine tests, position tests, tournament baseline |
| `features.js` | Both `valueNetwork.js` and `valueNetworkNode.js`, retraining may be needed |
| `valueNetwork.js` | Mirror changes to `valueNetworkNode.js` |
| `valueNetworkNode.js` | Mirror changes to `valueNetwork.js` |
| `model.py` | `export_onnx.py`, both valueNetwork files, all existing checkpoints become incompatible |
| `training/train.py` | `train-iteration.sh`, `/train` skill docs |
| `testHelpers.js` | Any test file that imports from it |
