# AI Engine (Yinsh)

The Yinsh AI opponent uses Monte Carlo Tree Search (MCTS) with two evaluation modes: hand-crafted heuristics (default) or a trained neural network value estimator. The MCTS implementation is in `src/games/yinsh/engine/mcts.js`; the value network pipeline spans `src/games/yinsh/engine/features.js`, `src/games/yinsh/engine/valueNetwork.js`, and `training/`.

> **Note:** This document covers the Yinsh AI only. Zertz does not currently have an AI opponent.

## Evaluation Modes

The MCTS constructor accepts an `evaluationMode` option:

```javascript
const mcts = new MCTS(100000, { evaluationMode: 'heuristic' });  // default
const mcts = new MCTS(100000, { evaluationMode: 'nn', valueNetwork });  // neural network
```

Both modes share the same MCTS tree search (selection, expansion, backpropagation) and heuristic pre-sorting of root moves. They differ only in how leaf nodes are evaluated during simulation:

- **Heuristic mode** (`_simulateWithRollout`): Plays out 12 moves using fast heuristic move selection, then scores the resulting position with `_evaluatePlayoutResult()`.
- **NN mode** (`_evaluateWithNN`): Calls `valueNetwork.evaluatePosition(board)` to get a scalar value in [-1, 1], scaled to ±5000 to match the heuristic score range.

Users toggle between modes via the "Neural Network AI" setting in the UI (stored as `yinshEvaluationMode` in localStorage).

## MCTS Algorithm

The algorithm runs a configurable number of simulations, each consisting of four steps:

**1. Selection** -- Starting from the root, traverse the tree by selecting child nodes with the highest UCB1 score:

```
UCB1 = (wins / visits) + 1.41 * sqrt(ln(parent_visits) / visits)
```

This balances exploitation (known good moves) with exploration (untried moves).

**2. Expansion** -- When a leaf node is reached, add a new child node for one untried move. The child is added to the parent's `children` Map and registered in the transposition table.

**3. Simulation** -- Evaluate the expanded node. In heuristic mode, play out 12 moves with `_selectMoveByFastHeuristic()` then call `_evaluatePlayoutResult()`. In NN mode, run a single forward pass through the value network.

**4. Backpropagation** -- Propagate the result back up the tree, updating visit counts and win statistics. Results are negated at each level for alternating players.

After all simulations, the root's child with the most visits is selected as the best move. `getBestMove()` is `async` to support NN inference; heuristic-only calls resolve synchronously within the async wrapper.

### Fast Heuristic Pre-filter

Before MCTS simulations begin, `getBestMove()` runs `_selectMoveByFastHeuristic()` with full opponent lookahead on all legal moves. This catches:
- Immediate winning moves (returned with confidence 1.0, skipping MCTS entirely)
- High-confidence tactical moves (score >= 500, returned directly)
- Heuristic ordering of root moves so MCTS explores promising branches first

This pre-filter runs in both evaluation modes.

### Transposition Table

A global hash map caches board states to reuse node statistics when the same position is reached via different move orders. The table is cleared at the start of each `getBestMove()` call and cleaned periodically to manage memory (max 100,000 entries).

## Heuristic Evaluation (Default Mode)

Leaf positions are scored by `_evaluatePlayoutResult()` using multiple factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Ring score difference | 5000x | Most important — tracks progress toward winning |
| 4-in-a-row | 1200 | Near-completion threats |
| 3-in-a-row | 300 | Building threats |
| Marker control | 50 | Raw material advantage |
| Ring mobility | 20 | Freedom of movement |
| Ring positioning | 30 | Central vs edge placement |
| Vulnerable markers | -40 | Markers exposed to opponent capture |

### Move Selection During Playouts

`_selectMoveByFastHeuristic()` evaluates moves by:
- Threat creation (2/3/4/5-in-a-row scoring)
- Flip bonuses (converting opponent markers)
- Disruption (breaking opponent rows)
- Penalties (creating opponent threats, self-destructive flips)
- Opponent response lookahead (full mode only, not during playouts)

## Neural Network Evaluation

### Architecture (~315K parameters)

```
Input:  4 x 11 x 11 planes + 5 scalars

Conv2d(4, 64, 3x3, pad=1) → BN → ReLU
ResBlock(64) x 4  [Conv→BN→ReLU→Conv→BN + skip]

Value head:
  Conv2d(64, 1, 1x1) → BN → ReLU → Flatten(121)
  Concat(121 + 5 meta = 126)
  Linear(126, 128) → ReLU → Linear(128, 1) → Tanh

Output: scalar in [-1, +1] (current player's winning probability)
```

### Feature Extraction (`src/games/yinsh/engine/features.js`)

Converts board state to neural network input:

**4 feature planes** (each 11x11, mapped via q+5, r+5):
| Plane | Content |
|-------|---------|
| 0 | Current player's rings |
| 1 | Current player's markers |
| 2 | Opponent's rings |
| 3 | Opponent's markers |

**5 scalar metadata:**
| Index | Value | Normalization |
|-------|-------|---------------|
| 0 | Current player score | / 3 |
| 1 | Opponent score | / 3 |
| 2 | Current player rings on board | / 5 |
| 3 | Opponent rings on board | / 5 |
| 4 | Phase encoding | play=0, remove-row=0.5, remove-ring=1.0 |

Features are always from the **current player's perspective** — the network learns a single perspective and the feature extraction handles the rotation.

### Browser Inference (`src/games/yinsh/engine/valueNetwork.js`)

Uses `onnxruntime-web` (WASM backend) for browser inference. The model is lazy-loaded on first NN-mode request in the Web Worker:

```
Worker receives evaluationMode='nn'
  → import('valueNetwork.js')
  → loadValueNetwork('/models/yinsh-value-v1.onnx')
  → MCTS calls evaluatePosition() per simulation
```

### Node.js Inference (`src/games/yinsh/engine/valueNetworkNode.js`)

Uses `onnxruntime-node` (native backend) for CLI scripts (tournament, future training data generation with NN self-play). Same API as browser version.

### Training Pipeline (`training/`)

| File | Purpose |
|------|---------|
| `model.py` | PyTorch model definition (YinshValueNet) |
| `dataset.py` | NDJSON data loader |
| `train.py` | Training loop — Adam optimizer, cosine annealing, early stopping |
| `export_onnx.py` | Export to ONNX, verify with onnxruntime |
| `requirements.txt` | torch, onnx, onnxruntime, onnxscript |

**Training workflow:**
```bash
# 1. Generate self-play data
npm run generate-data -- --games 200 --sims 100

# 2. Train (uses MPS on Apple Silicon, CUDA on NVIDIA, CPU fallback)
cd training
.venv/bin/python3 train.py --data ../data/train.ndjson --epochs 30

# 3. Export to ONNX
.venv/bin/python3 export_onnx.py --checkpoint best.pt --output ../public/models/yinsh-value-v1.onnx

# 4. Verify with tournament
npm run tournament -- --games 5 --sims 50
```

**Data format** (NDJSON, one position per line):
```json
{"board": [484 floats], "meta": [5 floats], "value": 1.0}
```
- `board`: 4 x 11 x 11 feature planes flattened
- `meta`: 5 scalar metadata values
- `value`: +1.0 if current player won the game, -1.0 if lost

**Training config:** Batch size 256, Adam lr=1e-3 with cosine annealing to 1e-5, 90/10 train/val split, early stopping with patience 8.

### Current Model Status (v12)

Deployed model: v12 (`public/models/yinsh-value-v1.onnx`), 315K params (64 channels, 4 residual blocks, FC 128). Model lineage: v1 -> v3 -> v5 -> v8 -> v10 -> v12, each beating its predecessor in tournament. NN wins 80% against heuristic (16-4 in 20-game tournament at 50 sims). See CLAUDE.md for the full training pipeline.

## Multi-Phase Intelligence

The AI handles all game phases:

**Setup:** Evaluates ring placement positions for board coverage and central control.

**Play:** Full MCTS with the selected evaluation mode.

**Remove-row:** Evaluates which row removal leaves the best board position (considers clustering, mobility, and remaining threats).

**Remove-ring:** Evaluates which ring sacrifice is least costly (considers positional value, mobility impact, and endgame awareness).

## Execution Modes

### Local Mode (Default)

Runs MCTS in a Web Worker (`mcts.worker.js`) to prevent UI blocking. 200 simulations per move. The worker accepts `evaluationMode` in its message data and handles ONNX model loading internally.

### API Mode

Sends board state to a Vercel serverless function at `/api/aiMove`, which runs MCTS server-side with 30-500 simulations and a 2.5-second time budget. Currently heuristic-only (no NN support in serverless).

## Integration with Game Logic

The AI interacts with `YinshBoard` through its public API via `aiPlayer.js`:

- `getAIMove(mcts, board, simulations)` — returns `{from, to, type, row}` (async)
- `applyAIMove(board, move)` — applies move to board, returns `{flipped}`

For simulation, the AI clones the board with `board.clone()` to avoid mutating the real game state.

## CLI Tools

| Command | Purpose |
|---------|---------|
| `npm run self-play -- --games 10 --sims 100` | AI vs AI evaluation (heuristic) |
| `npm run generate-data -- --games 200 --sims 100` | Generate labeled training data |
| `npm run tournament -- --games 5 --sims 50` | Heuristic vs NN head-to-head |

## Testing

```bash
CI=true npm test          # Full suite (305 tests)
npm run test:engine       # MCTS-specific tests
npm run tournament        # Compare heuristic vs NN
```

When modifying AI behavior, play several complete games against the AI to verify it makes legal moves in all phases and doesn't exhibit degenerate strategies. Run the tournament to verify NN changes don't regress against the heuristic baseline.
