# Instructions for AI Coding Agents

Critical instructions for AI agents (Claude, Cursor, Copilot, etc.) working on this codebase.

---

## Project Overview

GIPF Project is a multi-game React application hosting browser-based implementations of abstract strategy board games. Currently includes Yinsh (with AI) and Zertz. Games are code-split and served under a single deployment with client-side routing.

**Key Concepts:**
- **Multi-game monorepo**: Each game lives in `src/games/<name>/` with its own logic, UI, CSS, and tests
- **Shared infrastructure**: Routing, Tailwind, fonts, and deployment config are at the project root
- **Separation of concerns per game**: `<Game>Board` (logic) / `<Game>Game` (UI) are independent modules
- **CSS isolation**: Each game scopes its CSS variables under `.game-<name>` to prevent conflicts
- **Code splitting**: `React.lazy()` ensures visiting one game doesn't load another's bundle

**Tech Stack:**
- React 18 (CRA) + React Router 6 + Tailwind CSS
- SVG rendering for hexagonal boards
- MCTS AI engine with dual evaluation: heuristics or neural network (Yinsh only)
- Neural network: PyTorch training pipeline -> ONNX export -> onnxruntime-web browser inference
- Vercel serverless functions for API-mode AI
- Jest + React Testing Library (305 tests across 5 suites)

**Documentation:**
- [README.md](README.md) - Project overview for external users
- [docs/architecture.md](docs/architecture.md) - Codebase architecture and design
- [docs/ai-engine.md](docs/ai-engine.md) - AI system internals (Yinsh)
- [docs/notation.md](docs/notation.md) - Move notation specification (Yinsh)
- [docs/agents.md](docs/agents.md) - Practical development guide for AI agents

---

# Development Workflow

1. **Edit code**
2. **Test**: `CI=true npm test` (all 305 tests must pass)
3. **Build**: `npm run build` (must complete without errors)
4. **Manual test**: Play through game in browser (`npm start`)
5. **Deploy**: `git push origin main` (Vercel auto-deploys)

Use the below guidelines when executing tasks or pursuing goals that have more than basic complexity. These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

---

## Game Rules Are Sacred

**Never break core game mechanics.** These are faithful implementations of real board games -- rule violations break the entire experience.

Before modifying game logic for either game:
- Read the relevant `<Game>Board.js` to understand current rules
- Read [docs/architecture.md](docs/architecture.md) for the game's state machine
- Run the full test suite
- Verify changes against official game rules

**Yinsh Row Resolution Queue** (the trickiest part):
- When a move creates rows, a queue is built: active player's rows first, then opponent's
- Player selects ONE row at a time for removal
- After each removal, re-check for new rows (added to FRONT of queue)
- Continue until queue empty, then remove-ring phase, then back to play

**Zertz Forced Captures** (key rule):
- After placing a marble + removing a ring, check for jumps
- If any jump is available for the current player, they MUST jump (forced capture)
- Multi-jump sequences are supported -- a marble can continue jumping
- Isolated rings (disconnected from the main board) are captured along with their marbles

---

## Common Mistakes to Avoid

1. **Modifying game logic without running tests** -> Always run `CI=true npm test`
2. **Mixing UI code into Board classes** -> Board classes are pure logic, no React
3. **Forgetting `_captureState()` after state changes** -> Breaks undo/redo
4. **Forgetting `.clone()` after mutating board** -> UI won't re-render
5. **Breaking localStorage keys** -> Users lose their preferences and scores
6. **Pushing without testing** -> Vercel does NOT run tests, broken code goes live
7. **Making `getBestMove()` sync** -> It's `async` (returns Promise). Always `await` it
8. **Forgetting to update both valueNetwork.js and valueNetworkNode.js** -> Browser uses onnxruntime-web, CLI scripts use onnxruntime-node
9. **Adding CSS variables to `:root`** -> Use `.game-<name>` scoping instead
10. **Importing one game's code from another** -> Games must be fully independent

---

## Key Files

### Project Root

| File | Purpose |
|------|---------|
| `src/App.jsx` | React Router with lazy-loaded game routes |
| `src/LandingPage.jsx` | Landing page linking to each game |
| `src/index.css` | Tailwind directives + shared keyframes only |
| `vercel.json` | API rewrites + SPA catch-all for client-side routing |
| `public/index.html` | HTML shell with Google Fonts (Syne + Outfit) |
| `tailwind.config.js` | Font families (display, heading, body) |
| `jest.config.js` | Test config (auto-discovers `*.test.js` in all subdirs) |

### Yinsh (`src/games/yinsh/`)

| File | Purpose |
|------|---------|
| `YinshBoard.js` | Pure game logic -- state, rules, phases (no React) |
| `YinshGame.jsx` | React UI -- SVG board, modals, interaction handlers |
| `YinshNotation.js` | Chess-style move notation system |
| `yinsh.css` | Scoped CSS variables (`.game-yinsh`) + animations |
| `engine/mcts.js` | MCTS AI engine -- search, evaluation, heuristics + NN |
| `engine/features.js` | Feature extraction for NN input tensors |
| `engine/valueNetwork.js` | Browser ONNX inference (onnxruntime-web) |
| `engine/valueNetworkNode.js` | Node.js ONNX inference (onnxruntime-node) |
| `engine/aiPlayer.js` | Shared AI move interface for UI and CLI scripts |
| `hooks/useAIWorker.js` | React hook managing MCTS Web Worker lifecycle |
| `YinshBoard.test.js` | Jest tests covering all yinsh game logic |
| `testHelpers.js` | Test utilities and board state fixtures |

### Zertz (`src/games/zertz/`)

| File | Purpose |
|------|---------|
| `ZertzBoard.js` | Pure game logic -- rings, marbles, captures (no React) |
| `ZertzGame.jsx` | React UI -- SVG hex board, modals, interaction handlers |
| `zertz.css` | Scoped CSS variables (`.game-zertz`) + animations |
| `ZertzBoard.test.js` | Jest tests covering all zertz game logic |

### Infrastructure

| File | Purpose |
|------|---------|
| `api/aiMove.js` | Vercel serverless function for Yinsh API-mode AI |
| `scripts/*.mjs` | Self-play, training data generation, tournaments |
| `training/` | PyTorch model, training loop, ONNX export |
| `public/models/*.onnx` | Deployed neural network models |

### Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Dev server on localhost:3000 |
| `CI=true npm test` | Full test suite (305 tests, must all pass) |
| `npm run test:engine` | MCTS-specific engine tests |
| `npm run build` | Production build |
| `npm run generate-data` | Generate self-play training data (NDJSON) |
| `npm run tournament` | Head-to-head: heuristic vs NN MCTS |
| `npm run self-play` | AI vs AI self-play evaluation |

---

## Architecture -- Must Understand

### Routing

```
/           -> LandingPage (always in main bundle)
/yinsh      -> YinshGame (lazy-loaded chunk)
/zertz      -> ZertzGame (lazy-loaded chunk)
```

`React.lazy()` with `<Suspense>` ensures code splitting. Visiting `/zertz` does NOT load the yinsh MCTS engine bundle. The `vercel.json` catch-all rewrite ensures direct URL access works.

### CSS Isolation

Each game scopes its CSS variables under a wrapper class:
```
.game-yinsh { --color-bg-page: ...; }
.game-yinsh.dark { --color-bg-page: ...; }
.game-zertz { --color-bg-page: ...; }
.game-zertz.dark { --color-bg-page: ...; }
```

Animations are also prefixed (`yinsh-piece-fade-in`, `zertz-piece-fade-in`) and scoped (`.game-yinsh .piece-enter`). The shared `slide-in-right` keyframe lives in `index.css`.

When adding new CSS for a game, always scope it under the game's wrapper class.

### Yinsh Coordinate System

Axial hexagonal coordinates `(q, r)` with q, r in [-5, 5] and 8 corners excluded (85 valid intersections, 51 playable).

```
Storage:   boardState["q,r"] -> {type: 'ring'|'marker', player: 1|2}
Screen:    x = q * 50 + r * 25 + 300,  y = r * 43.3 + 300
Directions: [1,0] [0,1] [-1,1] [-1,0] [0,-1] [1,-1]
```

### Zertz Coordinate System

Axial hexagonal coordinates `(q, r)` where `max(|q|, |r|, |q+r|) <= 3` (37 positions).

```
Storage:   rings = Set of "q,r" keys; marbles["q,r"] = 'white'|'grey'|'black'
Screen:    x = 34 * (sqrt(3)*q + sqrt(3)/2*r),  y = 34 * 1.5 * r
Directions: [1,0] [-1,0] [0,1] [0,-1] [1,-1] [-1,1]
```

### State Flow (Both Games)

```
User Click -> <Game>Game.handleClick()
           -> <Game>Board.handleClick(q, r)  [mutates internal state]
           -> <Game>Board._captureState()     [save for undo/redo]
           -> setBoard(board.clone())         [React re-render]
```

The Board class is the single source of truth. React state is just a copy for rendering.

### Yinsh AI Flow

```
User clicks "AI Suggest" -> Worker: MCTS.getBestMove(board, simulations)
                         -> Returns {move, destination, confidence}
User clicks "AI Move"    -> board.handleClick() with AI's chosen move
                         -> UI updates
```

Two execution modes: `local` (Web Worker, 200 sims) and `api` (Vercel serverless, 30-500 sims).

Two evaluation modes (toggled in Settings):
- **Heuristic** (default): 12-move rollouts with hand-crafted scoring
- **Neural Network**: ONNX value network predicts position value directly

### localStorage Keys

**Yinsh:**
```
yinshDarkMode, yinshShowMoves, yinshRandomSetup,
yinshKeepScore, yinshWins, yinshShowMoveHistory,
yinshEvaluationMode
```

**Zertz:**
```
zertzDarkMode, zertzShowMoves
```

Never rename or restructure these without migration logic.

---

## Testing

```bash
CI=true npm test              # Full suite -- all 305 must pass
npm test -- --watch           # Watch mode for development
npm run test:engine           # MCTS engine tests
```

**Before any deployment, ALL of these must be true:**
- [ ] `CI=true npm test` -- 305 tests passing
- [ ] `npm run build` -- completes without errors
- [ ] Manual play-through of modified game(s) in browser

---

## Deployment

Vercel auto-deploys on push to `main`. There is no CI gate -- **you are the gate.**

```bash
git push origin main          # Deploy (only after all checks pass)
```

Production URL: https://gipf.vercel.app

CORS origins for the Yinsh AI API are in `api/aiMove.js` (two lists -- main handler and error handler). Update both if adding a new domain.

---

## Adding a New Game

To add a new GIPF Project game (e.g., DVONN, TZAAR):

1. Create `src/games/<name>/` with `<Name>Board.js`, `<Name>Game.jsx`, `<name>.css`, `<Name>Board.test.js`
2. Scope all CSS under `.game-<name>` and `.game-<name>.dark`
3. Add the wrapper class to the root div in `<Name>Game.jsx`
4. Add `import './<name>.css'` to the game component
5. Add a lazy route in `src/App.jsx`
6. Add a card to `src/LandingPage.jsx`
7. Use `<name>` prefix for localStorage keys

Games must be fully self-contained -- no imports between game directories.

---

## Training Pipeline (Yinsh)

### Current State

**Deployed model**: v12 (`public/models/yinsh-value-v1.onnx`), 315K params
**Best checkpoint**: `training/v12.pt`
**Model lineage**: v1 -> v3 -> v5 -> v8 -> v10 -> v12 (each beat its predecessor)
**NN vs Heuristic**: NN wins 80% (16-4 in 20-game tournament at 50 sims)

### How to Continue Training

**Step 1: Generate self-play data**
```bash
node scripts/generate-training-data.mjs --games 50 --sims 200 \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/vNEXT_selfplay.ndjson
```

**Step 2: Combine with previous data**
```bash
cat data/vA_selfplay.ndjson data/vB_selfplay.ndjson > data/combined_vNEXT.ndjson
```

**Step 3: Train**
```bash
training/.venv/bin/python3 training/train.py \
  --data data/combined_vNEXT.ndjson \
  --checkpoint training/v12.pt \
  --augment --lr 2e-4 --epochs 40 --patience 12 \
  --output training/vNEXT.pt
```

**Step 4: Export to ONNX**
```bash
training/.venv/bin/python3 training/export_onnx.py \
  --checkpoint training/vNEXT.pt \
  --output public/models/yinsh-value-vNEXT.onnx
```

**Step 5: Tournament (only promote if new model wins)**
```bash
node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn \
  --model1 public/models/yinsh-value-vNEXT.onnx \
  --model2 public/models/yinsh-value-v1.onnx
```

### Key Learnings

1. Combined multi-gen data beats single-gen
2. `--augment` (6-fold hex rotation) is critical -- never skip
3. Always fine-tune from the best checkpoint
4. Lower LR (2e-4 to 5e-4) for mature models
5. Quality > quantity: 50 games at 200 sims beats 200 games at 50 sims
6. Val MSE doesn't predict tournament strength -- always verify with tournament

---

## Data Safety -- CRITICAL

APFS filesystem corruption has zeroed out training data and model checkpoints before.

### Mandatory Safety Protocol

1. Before starting: Commit and push working code
2. After generating data: `file <path>` (zeroed files show as `empty`)
3. After training: `file training/vNEXT.pt` (valid = `Zip archive data`)
4. After ONNX export: `file public/models/yinsh-value-vNEXT.onnx` (valid = `data`)
