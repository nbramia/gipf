# Instructions for AI Coding Agents

Critical instructions for AI agents (Claude, Cursor, Copilot, etc.) working on this codebase.

---

## Project Overview

Yinsh is a browser-based implementation of the GIPF Project board game, featuring a sophisticated MCTS AI opponent, undo/redo, move notation, and dark mode.

**Key Concepts:**
- **Separation of concerns**: YinshBoard (logic) / YinshGame (UI) / MCTS (AI) are independent modules
- **Axial hex coordinates**: Board uses `(q, r)` coordinate system stored as `"q,r"` string keys
- **Phase-driven state machine**: Game flows through `setup` → `play` → `remove-row` → `remove-ring` → `play` (loop) → `game-over`
- **Immutable UI updates**: YinshBoard mutates internally, then `.clone()` triggers React re-render

**Tech Stack:**
- React 18 (CRA) + Tailwind CSS
- SVG rendering for hexagonal board
- MCTS AI engine with dual evaluation: hand-crafted heuristics (default) or neural network value estimation
- Neural network: PyTorch training pipeline → ONNX export → onnxruntime-web browser inference
- Vercel serverless functions for API-mode AI
- Jest + React Testing Library (84 tests)

**Documentation:**
- [README.md](README.md) - Project overview for external users
- [docs/architecture.md](docs/architecture.md) - Codebase architecture and design
- [docs/ai-engine.md](docs/ai-engine.md) - AI system internals
- [docs/notation.md](docs/notation.md) - Move notation specification
- [docs/agents.md](docs/agents.md) - Practical development guide for AI agents

---

# Development Workflow

1. **Edit code**
2. **Test**: `CI=true npm test` (all 84 tests must pass)
3. **Build**: `npm run build` (must complete without errors)
4. **Manual test**: Play through all game phases in browser (`npm start`)
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
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

These guidelines bias toward caution over speed. For trivial tasks (simple typo fixes, obvious one-liners), use judgment — not every change needs the full rigor.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Game Rules Are Sacred

**Never break core game mechanics.** Yinsh is a faithfully implemented board game — rule violations break the entire experience.

Before modifying game logic:
- Read the game rules in the README and [docs/architecture.md](docs/architecture.md)
- Understand the row resolution queue system (most complex logic)
- Verify changes against official Yinsh rules
- Run the full test suite

**Row Resolution Queue** (the trickiest part):
- When a move creates rows, a queue is built: active player's rows first, then opponent's
- Player selects ONE row at a time for removal
- After each removal, re-check for new rows (added to FRONT of queue)
- Continue until queue empty, then remove-ring phase, then back to play

---

## Common Mistakes to Avoid

1. **Modifying YinshBoard without running tests** → Always run `CI=true npm test`
2. **Mixing UI code into YinshBoard.js** → YinshBoard is pure logic, no React
3. **Forgetting `_captureState()` after state changes** → Breaks undo/redo
4. **Forgetting `.clone()` after mutating board** → UI won't re-render
5. **Breaking localStorage keys** → Users lose their preferences and scores
6. **Pushing without testing** → Vercel does NOT run tests, broken code goes live immediately
7. **Making `getBestMove()` sync** → It's `async` (returns Promise) to support NN evaluation. Always `await` it
8. **Forgetting to update both valueNetwork.js and valueNetworkNode.js** → Browser uses onnxruntime-web, CLI scripts use onnxruntime-node

---

## Key Files

| File | Purpose |
|------|---------|
| `src/YinshBoard.js` | Pure game logic — state, rules, phases (no React) |
| `src/YinshGame.jsx` | React UI — SVG board, modals, interaction handlers |
| `src/engine/mcts.js` | MCTS AI engine — search, evaluation, heuristics + NN evaluation mode |
| `src/engine/features.js` | Feature extraction — converts board state to NN input tensors |
| `src/engine/valueNetwork.js` | Browser ONNX inference for value network (onnxruntime-web) |
| `src/engine/valueNetworkNode.js` | Node.js ONNX inference for CLI scripts (onnxruntime-node) |
| `src/engine/aiPlayer.js` | Shared AI move interface for UI and CLI scripts |
| `src/YinshNotation.js` | Chess-style move notation system |
| `api/aiMove.js` | Vercel serverless function for API-mode AI |
| `src/YinshBoard.test.js` | 84 comprehensive Jest tests |
| `src/testHelpers.js` | Test utilities and board state fixtures |

| Script | Purpose |
|--------|---------|
| `npm start` | Dev server on localhost:3000 |
| `CI=true npm test` | Full test suite (84 tests, must all pass) |
| `npm run test:engine` | MCTS-specific engine tests |
| `npm run build` | Production build |
| `npm run generate-data` | Generate self-play training data (NDJSON) |
| `npm run tournament` | Head-to-head: heuristic vs NN MCTS |
| `npm run self-play` | AI vs AI self-play evaluation |
| `./pre-deploy-checklist.sh` | Automated pre-deploy verification |

| Training File | Purpose |
|---------------|---------|
| `training/model.py` | PyTorch model definition (315K params CNN + residual blocks) |
| `training/dataset.py` | NDJSON data loader for training |
| `training/train.py` | Training loop with checkpoint resume, data mixing, early stopping |
| `training/export_onnx.py` | Export trained model to ONNX (handles full checkpoint + legacy formats) |
| `public/models/yinsh-value-v1.onnx` | Current deployed ONNX model (served as static asset) |
| `scripts/train-iteration.sh` | One-command iteration: self-play → train → export → tournament → promote |

---

## Architecture — Must Understand

### Coordinate System

Axial hexagonal coordinates `(q, r)` with q, r in [-5, 5] and 8 corners excluded (85 valid intersections on the board, 51 playable intersections).

```
Storage:   boardState["q,r"] → {type: 'ring'|'marker', player: 1|2}
Screen:    x = q * 50 + r * 25 + 300,  y = r * 43.3 + 300
Directions: [1,0] [0,1] [-1,1] [-1,0] [0,-1] [1,-1]
```

### State Flow

```
User Click → YinshGame.handleIntersectionClick()
           → YinshBoard.handleClick(q, r)  [mutates internal state]
           → YinshBoard._captureState()     [save for undo/redo]
           → setYinshBoard(board.clone())   [React re-render]
```

YinshBoard is the single source of truth. React state is just a copy for rendering.

### AI Flow

```
User clicks "AI Suggest" → Worker: MCTS.getBestMove(board, simulations)
                         → Returns {move, destination, confidence}
User clicks "AI Move"    → board.handleClick() with AI's chosen move
                         → UI updates
```

Two execution modes: `local` (Web Worker, 200 sims) and `api` (Vercel serverless, 30-500 sims).

Two evaluation modes (toggled in Settings):
- **Heuristic** (default): 12-move rollouts with hand-crafted scoring (`_simulateWithRollout()`)
- **Neural Network**: ONNX value network predicts position value directly (`_evaluateWithNN()`)

### Value Network Pipeline

```
Self-play data generation (scripts/generate-training-data.mjs)
  → NDJSON: {board: [484], meta: [5], value: ±1.0}
  → PyTorch training (training/train.py) on MPS/CUDA/CPU
  → ONNX export (training/export_onnx.py)
  → public/models/yinsh-value-v1.onnx (served as static asset)
  → Browser: onnxruntime-web loads model in Web Worker
  → MCTS uses NN output (scaled to ±5000) instead of rollouts
```

Feature extraction (`src/engine/features.js`):
- 4 planes of 11x11 (current player rings, markers; opponent rings, markers)
- 5 scalar metadata (scores, ring counts, phase encoding)

### localStorage Keys (Backward Compatibility Required)

```
yinshDarkMode, yinshShowMoves, yinshRandomSetup,
yinshKeepScore, yinshWins, yinshShowMoveHistory,
yinshEvaluationMode
```

Never rename or restructure these without migration logic.

---

## Testing

```bash
CI=true npm test              # Full suite — all 84 must pass
npm test -- --watch           # Watch mode for development
npm run test:engine           # MCTS engine tests
```

**Before any deployment, ALL of these must be true:**
- [ ] `CI=true npm test` — 84 tests passing
- [ ] `npm run build` — completes without errors
- [ ] Manual play-through of all game phases (setup, play, remove-row, remove-ring, game-over)
- [ ] Undo/redo works in all phases
- [ ] Both light and dark mode render correctly

---

## Deployment

Vercel auto-deploys on push to `main`. There is no CI gate — **you are the gate.**

```bash
./pre-deploy-checklist.sh     # Automated checks
git push origin main          # Deploy (only after all checks pass)
```

Production URL: https://yinsh-nathan-ramias-projects.vercel.app

---

## Training Pipeline

### Current State (as of v12)

**Deployed model**: v12 (`public/models/yinsh-value-v1.onnx`), 315K params
**Best checkpoint**: `training/v12.pt`
**Model lineage**: v1 → v3 → v5 → v8 → v10 → v12 (each beat its predecessor in tournament)
**NN vs Heuristic**: NN wins 80% (16-4 in 20-game tournament at 50 sims)

### How to Continue Training

Follow these exact steps. This is the proven recipe that produced 5 consecutive breakthroughs.

**Step 1: Determine the next version number**
```bash
# Check what checkpoints exist
ls training/v*.pt | sort -V | tail -5
# The next version is the highest number + 1
# As of last session: v13 was the last attempted, so next is v14
# The BEST checkpoint to fine-tune from is the deployed one (currently v12)
```

**Step 2: Generate self-play data from the deployed model**
```bash
node scripts/generate-training-data.mjs --games 50 --sims 200 \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/vNEXT_selfplay.ndjson
```
- Use `--sims 200` (minimum 150). Higher sims = higher quality data. Quality >>> quantity.
- 50 games produces ~2,500-2,700 positions. This is enough with augmentation.
- After completion, verify: `file data/vNEXT_selfplay.ndjson` should show "JSON data" or "ASCII text"

**Step 3: Combine with previous high-quality data**
```bash
# Combine the 2-3 most recent self-play datasets (all 150+ sims)
cat data/vA_selfplay.ndjson data/vB_selfplay.ndjson data/vC_selfplay.ndjson > data/combined_vNEXT.ndjson
wc -l data/combined_vNEXT.ndjson  # Should be 5,000-10,000 positions
```
- Combining 3+ generations of data is KEY. Single-gen training tends to plateau.
- Only combine data generated at 100+ sims. Old 50-sim data is low quality.
- Available high-quality data files: v7 (200 sims), v8 (200 sims), v9 (150 sims), v10 (200 sims), v12 (200 sims)

**Step 4: Train with augmentation and data mixing**
```bash
training/.venv/bin/python3 training/train.py \
  --data data/combined_vNEXT.ndjson \
  --checkpoint training/v12.pt \
  --data-append data/vOLDER_selfplay.ndjson --merge-ratio 0.3 \
  --augment --lr 2e-4 --epochs 40 --patience 12 \
  --output training/vNEXT.pt
```
Critical flags:
- `--checkpoint training/v12.pt` — ALWAYS fine-tune from the best model
- `--augment` — 6-fold hex rotation, multiplies data 6x. NEVER skip this.
- `--lr 2e-4` to `5e-4` — lower LR works better when fine-tuning a good model
- `--data-append` + `--merge-ratio 0.3` — mix in one more older dataset for diversity
- After completion, verify: `file training/vNEXT.pt` should show "Zip archive data"

**Step 5: Export to ONNX**
```bash
training/.venv/bin/python3 training/export_onnx.py \
  --checkpoint training/vNEXT.pt \
  --output public/models/yinsh-value-vNEXT.onnx
```
- Verify BOTH files: `file public/models/yinsh-value-vNEXT.onnx public/models/yinsh-value-vNEXT.onnx.data`
- Both should show "data" (NOT "empty")

**Step 6: Tournament (20 games)**
```bash
node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn \
  --model1 public/models/yinsh-value-vNEXT.onnx \
  --model2 public/models/yinsh-value-v1.onnx
```
- Exit code 0 = model1 wins, 1 = model2 wins, 2 = tie
- **Only promote if model1 wins** (exit code 0)

**Step 7: If new model wins — deploy and commit**
```bash
cp public/models/yinsh-value-vNEXT.onnx public/models/yinsh-value-v1.onnx
cp public/models/yinsh-value-vNEXT.onnx.data public/models/yinsh-value-v1.onnx.data
file public/models/yinsh-value-v1.onnx.data  # Verify: should show "data"

git add public/models/yinsh-value-v1.onnx public/models/yinsh-value-v1.onnx.data
git commit -m "feat: deploy vNEXT model — beats vPREV X-Y in 20-game tournament"
git push origin main
```

**Step 7b: If new model loses/ties — DON'T deploy, try the combined-data approach**
- The immediate successor after a breakthrough usually ties or loses
- Skip single-gen training and go straight to combining 3+ generations of data
- Lower the LR further (try 2e-4 if you used 3e-4)

### Key Learnings (Verified Across 13 Iterations)

1. **Combined multi-gen data beats single-gen**: Combining 3+ generations of self-play data consistently produces breakthroughs
2. **Augmentation is critical**: `--augment` (6-fold hex rotation) multiplies data 6x and dramatically improves generalization
3. **Fine-tuning beats from-scratch**: Always start from the best checkpoint, never train from random init
4. **Lower LR for mature models**: Use 2e-4 to 5e-4 (not the default 1e-3) when fine-tuning
5. **Quality > quantity**: 50 games at 200 sims beats 200 games at 50 sims
6. **Val MSE doesn't predict tournament strength**: Always verify with actual tournament play
7. **Post-breakthrough regression is normal**: The next immediate iteration usually ties — combine more data to break through again

### Model Architecture

| Version | Channels | Blocks | FC Size | Params | Notes |
|---------|----------|--------|---------|--------|-------|
| v1 (original) | 32 | 3 | 64 | 65K | Obsolete, `best.pt` |
| v2+ (current) | 64 | 4 | 128 | 315K | All deployed models use this |

`model.py` defaults to 315K architecture. Only need `YinshValueNet(channels=32, num_blocks=3, fc_size=64)` for loading the original v1 checkpoint.

### ValueNetwork Class Pattern

Both `valueNetworkNode.js` and `valueNetwork.js` export a `ValueNetwork` class for multi-model support (needed for NN-vs-NN tournaments). Backward-compatible module-level functions (`loadValueNetwork`, `evaluatePosition`, `isLoaded`) delegate to a default instance.

### Available Data Files (as of v13)

High-quality (150-200 sims, use these for training):
- `data/v7_selfplay.ndjson` — 2,907 positions (200 sims, from v5)
- `data/v8_selfplay.ndjson` — 2,704 positions (200 sims, from v5)
- `data/v9_selfplay.ndjson` — 2,665 positions (150 sims, from v8)
- `data/v10_selfplay.ndjson` — 2,679 positions (200 sims, from v10)
- `data/v12_selfplay.ndjson` — 2,619 positions (200 sims, from v12)

Lower quality (50-100 sims, use as secondary `--data-append` only):
- `data/v5_selfplay.ndjson` — 2,689 positions (100 sims)
- `data/v6_selfplay.ndjson` — 5,371 positions (100 sims)

---

## Data Safety — CRITICAL

**APFS filesystem corruption has zeroed out training data and model checkpoints before.** Files show correct metadata (size, timestamps) but contain all zeros. This is a disk/OS-level issue.

### Mandatory Safety Protocol for Long Training Operations

1. **Before starting**: Commit and push working code to GitHub
2. **After generating data**: Verify files with `file <path>` (zeroed files show as `empty`)
3. **After training**: Verify `.pt` checkpoints with `file <path>` (valid checkpoints show as `Zip archive data`)
4. **After ONNX export**: Verify BOTH `.onnx` AND `.onnx.data` files with `file <path>`
5. **Periodically during long runs**: Check that output files have real content with `wc -l` or `head -c 100`

### Quick Integrity Check

```bash
# Check all critical files at once
file training/*.pt public/models/*.onnx public/models/*.onnx.data data/*.ndjson
# Valid .pt files: "Zip archive data"
# Valid .onnx files: "data" (not "empty")
# Valid .onnx.data files: "data" (not "empty")
# Valid .ndjson files: "ASCII text" or "Unicode text" (not "empty")
```

### Recovery from Corruption

If files are zeroed:
1. Git: `git clone` from GitHub remote, copy `.git/` back
2. Model: Re-export from surviving `.pt` checkpoint (`best.pt` is the last resort)
3. Data: Must be regenerated (no backup source)
4. Node modules: `rm -rf node_modules && npm install`
