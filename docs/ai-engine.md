# AI Engine

The project uses game-local AI engines. YINSH and ZERTZ each have a trained neural-network pipeline; CATAN follows the same MCTS/self-play shape with game-specific heuristics and feature extraction but no trained network. Splendor, Chess, and Diplomacy use different approaches entirely (see the closing section).

## Catan

CATAN uses a Web Worker MCTS opponent for players 2-4. Because the game is four-player and stochastic, the implementation in `src/games/catan/engine/mcts.js` keeps search focused on root actions, then evaluates candidates with heuristic rollouts where every player uses the same fast policy. This avoids modeling opponent turns as cooperative tree branches.

The training-data path mirrors the YINSH/ZERTZ flow:

```bash
npm run catan:self-play -- --games 20 --sims 200
npm run catan:tournament -- --games 8 --sims-a 500 --sims-b 180
```

Feature extraction lives in `src/games/catan/engine/features.js`; documentation is in [catan.md](catan.md).

## Yinsh

The Yinsh AI opponent uses Monte Carlo Tree Search (MCTS) with two evaluation modes: hand-crafted heuristics (default) or a trained neural network value estimator. The MCTS implementation is in `src/games/yinsh/engine/mcts.js`; the value network pipeline spans `src/games/yinsh/engine/features.js`, `src/games/yinsh/engine/valueNetwork.js`, and `training/`.

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

The algorithm runs a configurable number of simulations, each consisting of four steps.

**1. Selection** -- Starting from the root, traverse the tree by selecting child nodes with the highest score. Selection uses one of two formulas depending on whether NN policy priors are available for this search:

```
UCB1 (fallback, no policy available):
UCB1 = (wins / visits) + 1.41 * sqrt(ln(parent_visits) / visits)

PUCT (AlphaZero-style, used whenever NN mode has fetched a root policy):
PUCT = normalizedQ + cPuct * prior * sqrt(parent_visits) / (1 + visits)
```

`cPuct = 2.5`. `normalizedQ` is the node's win rate min-max normalized against the `qMin`/`qMax` range observed so far this search (tracked during backpropagation, reset at the start of each `getBestMove()` call). `prior` comes from the network's policy output at the root (see below); non-root nodes get a prior of 0 unless a policy fetch assigned one. When NN mode hasn't produced a policy (heuristic mode, or a failed policy fetch), selection falls back to plain UCB1.

This balances exploitation (known good moves) with exploration (untried moves, or moves the policy favors).

**Root policy priors and Dirichlet noise** -- When NN mode is active, `getBestMove()` fetches a policy from the network before running simulations (`evaluatePositionWithPolicy`) and masks/softmaxes it over the legal moves' destination squares. The result is blended with Dirichlet noise for exploration: 75% network softmax + 25% noise, with noise sampled `Dirichlet(alpha = 0.3)`. This blended distribution becomes each root child's `prior` for PUCT.

**2. Expansion** -- When a leaf node is reached, add a new child node for one untried move. The child is added to the parent's `children` Map and registered in the transposition table.

**3. Simulation** -- Evaluate the expanded node. In heuristic mode, play out 12 moves with `_selectMoveByFastHeuristic()` then call `_evaluatePlayoutResult()`. In NN mode, run a single forward pass through the value network.

**4. Backpropagation** -- Propagate the result back up the tree, updating visit counts and win statistics, and updating the running `qMin`/`qMax` bounds used to normalize Q for PUCT. Results are negated at each level for alternating players.

After all simulations, the root's child with the most visits is selected as the best move. `getBestMove()` is `async` to support NN inference; heuristic-only calls resolve synchronously within the async wrapper.

### Fast Heuristic Pre-filter

Before MCTS simulations begin, `getBestMove()` runs `_selectMoveByFastHeuristic()` with full opponent lookahead on all legal moves. This catches:
- Immediate winning moves (returned with confidence 1.0, skipping MCTS entirely)
- High-confidence tactical moves (score >= 500, returned directly)
- Heuristic ordering of root moves so MCTS explores promising branches first

This pre-filter runs in both evaluation modes.

### Transposition Table

A global hash map caches board states to reuse node statistics when the same position is reached via different move orders. The table is cleared at the start of each `getBestMove()` call and cleaned periodically to manage memory (max 100,000 entries for Yinsh; Zertz uses the same pattern with a 50,000-entry cap).

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

### Architecture: dual-head policy-value net (~345K parameters)

The deployed net is trained with `--model-type policy-value` and has two heads sharing one trunk. A value-only variant (`YinshValueNet`, ~315K params) still exists as a legacy option in `training/model.py`.

```
Input:  4 x 11 x 11 planes + 5 scalars

Conv2d(4, 64, 3x3, pad=1) → BN → ReLU
ResBlock(64) x 4  [Conv→BN→ReLU→Conv→BN + skip]

Value head:
  Conv2d(64, 1, 1x1) → BN → ReLU → Flatten(121)
  Concat(121 + 5 meta = 126)
  Linear(126, 128) → ReLU → Linear(128, 1) → Tanh
  Output: scalar in [-1, +1] (current player's winning probability)

Policy head:
  Conv2d(64, 2, 1x1) → BN → ReLU → Flatten(242)
  Linear(242, 121)
  Output: 121 raw logits, one per destination square on the 11x11 grid
  (softmax + legal-move masking happens in MCTS, not in the network)
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
| `model.py` | PyTorch model definitions (`YinshValueNet`, value-only; `YinshPolicyValueNet`, dual-head, deployed) |
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
{"board": [484 floats], "meta": [5 floats], "value": 1.0, "policy": [121 floats]}
```
- `board`: 4 x 11 x 11 feature planes flattened
- `meta`: 5 scalar metadata values
- `value`: +1.0 if current player won the game, -1.0 if lost
- `policy`: optional, 121-element move-visit distribution from self-play (`dataset.py` falls back to a uniform distribution over legal destinations when this field is absent)

`dataset.py` also applies 6-fold hexagonal rotation augmentation (the 6 axial rotations of the hex grid) when enabled, expanding each recorded position into 6 training examples with the board and policy target rotated consistently (meta scalars are rotation-invariant).

**Training config:** Batch size 256, Adam lr=1e-3 with cosine annealing to 1e-5, 90/10 train/val split, early stopping with patience 8.

### Model Promotion

There's no fixed "current model" to document here: checkpoints accumulate continuously and a new one only replaces the deployed model after it wins a gated match against the incumbent. The gate is a real SPRT (`scripts/tournament.mjs --sprt`): H0 p=0.5 vs H1 p=0.55, alpha=0.05, beta=0.10, capped at 40 games, with sides interleaved each game. A challenger that clears the SPRT `accept` threshold gets promoted; `reject` or hitting the game cap without a decision means it stays on the bench. This keeps the doc accurate regardless of how far training has progressed, rather than pinning a version number and win rate that go stale immediately.

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
CI=true npm test          # Full suite
npm run test:engine       # MCTS-specific tests
npm run tournament        # Compare heuristic vs NN
```

When modifying AI behavior, play several complete games against the AI to verify it makes legal moves in all phases and doesn't exhibit degenerate strategies. Run the tournament to verify NN changes don't regress against the heuristic baseline.

## Zertz

Zertz has its own trained network and training loop, structurally parallel to Yinsh's but with a few real differences.

**MCTS** (`src/games/zertz/engine/mcts.js`) uses the same PUCT/UCB1 split as Yinsh: PUCT (`cPuct = 2.5`) with policy priors plus Dirichlet noise (alpha 0.3, epsilon 0.25) when NN mode has a policy, falling back to UCB1 (exploration constant 1.414) otherwise. Its transposition table caps at 50,000 entries (vs Yinsh's 100,000), cleared each `getBestMove()` call.

**Network and features** (`src/games/zertz/engine/features.js`): 5 planes x 7x7 (ring presence, white/grey/black marble, free/removable rings) mapping the 37-hex board, plus 12 meta scalars. Own ONNX model, own `training/zertz/` pipeline (`model.py`, `dataset.py`, `train.py`, `export_onnx.py`), same shape as Yinsh's (self-play → train → export → tournament).

**Difficulty wiring in the UI** (`src/games/zertz/ZertzGame.jsx`): three tiers, `easy` and `advanced` (the default on load) run heuristic MCTS at 100/200 simulations; `expert` is the only tier that loads the trained network (`/models/zertz-value-v1.onnx`) at 300 simulations.

**Training loss adds heuristic distillation.** Unlike Yinsh, `training/zertz/train.py` blends a third loss term: `loss = value_loss + policy_loss + distill_weight * heuristic_loss`, where `heuristic_loss` regularizes the value head's prediction toward the hand-crafted heuristic evaluation (`--distill-weight`, default 0.5, 0 disables it). Yinsh's training loop has no equivalent term.

**Promotion gate is simpler, not SPRT.** `scripts/zertz/tournament.mjs` plays a fixed set of games and promotes on a plain win/tie majority check (NN wins more than heuristic across the tournament), not the sequential SPRT test Yinsh uses. `scripts/zertz/continuous-train.sh` drives the self-play → train → tournament → promote loop autonomously.

**API mode:** like Yinsh, `/api/zertzAiMove` is a heuristic-only serverless fallback (no NN support server-side).

## Other Game AI in This Repo

The rest of the GIPF suite uses approaches unrelated to the Yinsh/Zertz/Catan MCTS-plus-trained-network pattern:

- **Splendor** — a maxⁿ PUCT game-tree MCTS with a hand-written evaluation function and determinized handling of hidden information (opponents' blind reserves, shuffled decks). A trained self-play network was built and evaluated but did not beat the heuristic in gated play, so the heuristic ships. See [splendor.md](splendor.md).
- **Chess** — delegates move generation entirely to Stockfish, loaded as a self-contained asm.js build inside a same-origin Blob Web Worker (no server-side engine). See [chess.md](chess.md).
- **Diplomacy** — a best-response tactical search over orders, paired with an LLM-driven negotiation layer that gives each of the seven powers its own persona and lets them talk (and scheme) with the human and each other. See [diplomacy.md](diplomacy.md).
