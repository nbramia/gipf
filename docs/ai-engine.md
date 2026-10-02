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

Both modes share tree-search infrastructure and heuristic pre-sorting of root moves. NN mode can also supply root policy priors; leaf evaluation differs as follows:

- **Heuristic mode** (`_simulateWithRollout`): Plays out 12 moves using fast heuristic move selection, then scores the resulting position with `_evaluatePlayoutResult()`.
- **NN mode** (`_evaluateWithNN`): Calls `valueNetwork.evaluatePosition(board)` to get a scalar value in [-1, 1], scaled to ±5000 to match the heuristic score range.

The YINSH UI uses difficulty presets: Easy/Advanced/Expert request separate NN models at 100/150/200 simulations. `yinshDifficulty` stores the selection; `yinshEvaluationMode` is retained for preference migration. Constructor mode defaults and heuristic fallback are separate from these UI presets.

## MCTS Algorithm

The algorithm runs a configurable number of simulations, each consisting of four steps.

**1. Selection** -- Starting from the root, traverse the tree by selecting child nodes with the highest score. Selection uses one of two formulas depending on whether NN policy priors are available for this search:

```
UCB1 (fallback, no policy available):
UCB1 = value_for_acting_parent + 1.41 * sqrt(ln(parent_visits) / visits)

PUCT (AlphaZero-style, used whenever NN mode has fetched a root policy):
PUCT = normalizedQ + cPuct * prior * sqrt(parent_visits) / (1 + visits)
```

`cPuct = 2.5`. YINSH stores signed state values from `board.currentPlayer`'s perspective. Selection translates the child value to the acting parent's perspective before UCB1 or PUCT scoring. `normalizedQ` uses symmetric `qMin`/`qMax` bounds observed during backup and reset for each search. Policy priors are fetched at the root; YINSH's non-root priors remain zero. With no policy, YINSH falls back to UCB1. ZERTZ's explicit non-root UCB1 fallback is described separately below.

This balances exploitation (known good moves) with exploration (untried moves, or moves the policy favors).

**Root policy priors and Dirichlet noise** -- When NN mode is active, `getBestMove()` fetches a policy from the network before running simulations (`evaluatePositionWithPolicy`) and masks/softmaxes it over the legal moves' destination squares. The result is blended with Dirichlet noise for exploration: 75% network softmax + 25% noise, with noise sampled `Dirichlet(alpha = 0.3)`. This blended distribution becomes each root child's `prior` for PUCT.

**2. Expansion** -- When a leaf node is reached, add a new child node for one untried move. The child is added to the parent's `children` Map and registered in the transposition table.

**3. Simulation** -- Evaluate the expanded node. In heuristic mode, play out 12 moves with `_selectMoveByFastHeuristic()` then call `_evaluatePlayoutResult()`. In NN mode, run a single forward pass through the value network.

**4. Backpropagation** -- Evaluations belong to the evaluated state's current player. Each ancestor stores that result with a sign determined by its actual current player: same-player row/ring actions preserve the sign, and a player change inverts it. Terminal wins/losses use the same perspective convention (±10000); nonterminal NN values are scaled by 5000. Backup also updates symmetric Q bounds for PUCT.

After simulations, both `getBestMove()` and `runIteration()` select by visits, then mean value for the root's actual current player, then prior, then a stable serialized action key. Equal-visit low-budget searches therefore retain evaluated values, including same-player scoring actions. `getBestMove()` is `async` to support NN inference; heuristic-only calls resolve synchronously within the async wrapper.

### Fast Heuristic Pre-filter

Before MCTS simulations begin, `getBestMove()` runs `_selectMoveByFastHeuristic()` with full opponent lookahead on all legal moves. This catches:
- Immediate winning moves (returned with confidence 1.0, skipping MCTS entirely)
- High-confidence tactical moves (score >= 500, returned directly)
- Heuristic ordering of root moves so MCTS explores promising branches first

This pre-filter runs in both evaluation modes.

### Transposition Table

YINSH keeps a per-engine table of state statistics, cleared at each `getBestMove()` call and capped at 100,000 entries. Transpositions share current-player-relative visit/value statistics, while child maps and parent pointers stay local to each tree path. State hashes include phase, player, scores, setup counts, and the saved next player for scoring resolution. ZERTZ has its own table with a 50,000-entry cap.

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
  Output: signed value in [-1, +1] from the current player's perspective

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

Features are always from the **current player's perspective**; feature extraction assigns the player-relative channels, while rotational augmentation is a separate training operation. The 11x11 tensor embeds the board's 85 legal intersections; unused grid cells do not become legal moves.

### Browser Inference (`src/games/yinsh/engine/valueNetwork.js`)

Uses `onnxruntime-web` (WASM backend) for browser inference. The model is lazy-loaded on first NN-mode request in the Web Worker:

```
Worker receives evaluationMode='nn'
  → import('valueNetwork.js')
  → load the requested tier model at `${PUBLIC_URL}/models/...`
  → probe its tensor contract and require a finite value output
  → MCTS calls evaluatePosition() per simulation
```

Both games bundle `onnxruntime-web` and use single-threaded WASM. `PUBLIC_URL` is empty on a root deployment or `/gipf` on the shared-domain deployment. Workers cache only successfully loaded models; failed loads remain retryable. They report requested and actual evaluation modes, and the UI displays “Neural model unavailable — using heuristic AI” when an NN request falls back. A later successful load clears the notice.

Request IDs, worker identity, and board versions reject stale or duplicate results and errors. Reset, undo/redo, position changes, and AI settings changes cancel pending work; cancellation terminates that worker and discards its model cache. Main-thread fallback searches a clone and checks the same board version before applying a result. See the [browser repair report](yinsh-zertz-browser-repairs-2026-09-20.md) for the scoped Chromium production-build smoke evidence and its limitations.

### Node.js Inference (`src/games/yinsh/engine/valueNetworkNode.js`)

Uses `onnxruntime-node` (native backend) for tournaments and NN self-play generation. Each game has its own wrapper; ZERTZ's wrapper also selects the explicit feature schema described below.

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
# 1. Generate self-play data with the deployed incumbent
npm run generate-data -- --games 200 --sims 100 --mode nn \
  --model public/models/yinsh-value-v1.onnx

# 2. Train a candidate (set incumbent.pt to the checkpoint being continued)
training/.venv/bin/python3 training/train.py --data data/train.ndjson \
  --checkpoint training/incumbent.pt --augment --seed 42 --epochs 30 \
  --output training/candidate.pt

# 3. Export to ONNX
training/.venv/bin/python3 training/export_onnx.py \
  --checkpoint training/candidate.pt --output public/models/yinsh-candidate.onnx

# 4. Verify with tournament
npm run tournament -- --mode nn-vs-nn --games 5 --sims 50 \
  --model1 public/models/yinsh-candidate.onnx --model2 public/models/yinsh-value-v1.onnx
```

**Data format** (NDJSON, one position per line):
```json
{"gameId": "uuid", "board": [484 floats], "meta": [5 floats], "value": 1.0, "policy": [121 floats]}
```
- `board`: 4 x 11 x 11 feature planes flattened
- `meta`: 5 scalar metadata values
- `value`: +1.0 if current player won the game, -1.0 if lost
- `gameId`: a UUID shared by all positions from one game, unique across processes and runs
- `policy`: optional, 121-element move-visit distribution from self-play (`dataset.py` falls back to a uniform distribution over all 121 tensor cells when absent; historical records do not provide a legal-action mask)

Both trainers assign whole source games to train or validation before applying 6-fold hexagonal rotation augmentation to training only. Validation contains original, unaugmented positions. `--seed` (default 42) controls group assignment, appended-data sampling, and PyTorch randomness. The holdout is approximately 10% of source groups, so its position count may differ from 10% of records. Primary and sampled appended records are grouped together, preventing duplicate game IDs from crossing the split.

Legacy NDJSON without `gameId` remains readable and emits a warning during splitting. Its fallback groups identical board/meta inputs and their rotations, ignoring labels and policy targets; a position represented by a legacy record also ties matching identified games together. This duplicate-identity protection applies to those legacy identities, not all recurring positions in different identified games. Historical game boundaries cannot be recovered: the fallback **cannot guarantee source-game isolation** for legacy records. New validation losses therefore should not be compared directly with old position-split, augmented-validation losses. Empty data or fewer than two independent groups raises an actionable error; small training subsets keep their final partial batch instead of silently training zero batches.

**YINSH trainer defaults:** Batch size 256, Adam lr=1e-3 with cosine annealing to 1e-5, approximately 90/10 source-group split, early stopping with patience 8. Shell wrappers override several training defaults.

### Model Promotion

YINSH's continuous loop uses SPRT (`scripts/tournament.mjs --sprt`): H0 p=0.5 versus H1 p=0.55, alpha=0.05, beta=0.10, capped at 40 games with alternating sides. Only `accept` permits promotion; rejection or an inconclusive game cap keeps the incumbent. The one-shot wrapper uses a fixed candidate-versus-incumbent tournament. Passing either gate is evidence from that match, not a general strength guarantee.

Both parallel generators await every worker's completion and successful exit before atomically publishing the merged dataset. Missing completion, failed workers, missing files, malformed records, or mismatched position counts fail the command and preserve worker artifacts for recovery. Drawn games contribute no labeled positions; an entirely empty generation fails. YINSH randomized setup draws exclusively from `YinshBoard.generateGridPoints()` (85 legal points) and verifies all ten ring placements.

Promotion validates the complete candidate ONNX bundle with `scripts/verify-model.py`, including any referenced external tensors, and publishes a single embedded-weight model through an atomic file replacement. An embedded candidate does not require a `.onnx.data` sidecar. Candidate versions must not overwrite the deployed `v1` pointer before evaluation. No training data or model artifacts should be pushed during regression testing.

## Multi-Phase Intelligence

The AI handles all game phases:

**Setup:** Evaluates ring placement positions for board coverage and central control.

**Play:** Full MCTS with the selected evaluation mode.

**Remove-row:** Executes an explicit, validated five-marker row. Each row is immediately followed by its owner's scoring-ring removal; only then are remaining rows recomputed, with the original mover's rows before the opponent's. See [row resolution](architecture.md#row-resolution-queue).

**Remove-ring:** Evaluates which ring sacrifice is least costly (considers positional value, mobility impact, and endgame awareness).

## Execution Modes

### Local Mode (Default)

Runs MCTS in a Web Worker (`mcts.worker.js`) with the selected difficulty's simulation count. The worker accepts `evaluationMode` and a model path, handles ONNX loading internally, and reports the actual mode used.

### API Mode

The optional Vercel endpoint `${PUBLIC_URL}/api/aiMove` runs heuristic MCTS server-side with 30-500 simulations and a 2.5-second time budget. The browser uses local workers by default. See the [snapshot and resolved-response contract](yinsh-api.md); the endpoint restores canonical state and awaits search results.

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

Use deterministic legality, perspective, and search regressions, plus full-suite/build checks, when modifying AI behavior. Browser play-throughs and heuristic benchmarks provide additional evidence; promotion still requires the explicit incumbent gate.

## Zertz

Zertz has its own trained network and training loop, structurally parallel to Yinsh's but with a few real differences.

**MCTS** (`src/games/zertz/engine/mcts.js`) uses PUCT (`cPuct = 2.5`) at the root when policy priors are available, with Dirichlet noise (alpha 0.3, epsilon 0.25). Non-root nodes have no policy priors and explicitly use UCB1 (exploration constant 1.414), as does heuristic-only search. Its transposition table caps at 50,000 entries and is cleared each search.

Opening positions have 111 legal actions. With a smaller simulation budget, root expansion follows available policy priors without pruning any action. Final choice compares visits, mean evaluated value, prior, then a stable move key, so equal-visit children do not default to the first random expansion. ZERTZ stores edge values for the player choosing the action; placement/removal and mandatory jump chains do not flip value simply because another action occurred.

**Feature compatibility:** ZERTZ owns `engine/features.js` and `training/zertz/`. Feature-v2 adds a sixth, one-hot plane identifying the forced jumping marble during a capture chain; it is zero outside capture or before a jumper is selected. This distinguishes otherwise identical positions with different legal continuations. The first five planes (rings, three marble colors, removable rings), 12 meta scalars, and 49 destination-policy logits retain their previous meanings.

| Contract | Legacy v1 | New v2 |
|----------|-----------|--------|
| Board tensor | `[batch, 5, 7, 7]` (245 floats per record) | `[batch, 6, 7, 7]` (294 floats per record) |
| Meta tensor | `[batch, 12]` | `[batch, 12]` |
| ONNX inputs | `board_input`, `meta_input` | `board_v2_input`, `meta_input` |
| NDJSON tag | `featureVersion: 1`, or untagged exact legacy shape | `featureVersion: 2` required |

Browser and Node loaders use the versioned input names to select extraction, then probe the tensor contract and finite value output. Browser adapters additionally reject missing, empty, or nonfinite declared policy output. Unknown names or incompatible shapes fail loading. Export also writes `zertz.feature_version` and `zertz.feature_schema` metadata; checkpoints store `feature_version`, with untagged five-plane input-convolution weights accepted explicitly as legacy v1. Definitions live in `src/games/zertz/engine/features.js` and `training/zertz/schema.py`.

New self-play writes v2 records plus `gameId`, including when an explicit legacy network supplies evaluations through its v1 extraction path. Training rejects mixed v1/v2 datasets and incompatible checkpoints; historical arrays cannot recover missing jumping-marble identity. Generate fresh v2 data and train a new model without a v1 `--checkpoint`, for example:

```bash
PYTHONPATH=training training/.venv/bin/python3 training/zertz/train.py \
  --data data/zertz/fresh-v2.ndjson --feature-version 2 --augment --seed 42 \
  --output-dir training/zertz/candidate-v2
```

Keep old models and datasets on their explicit legacy paths; do not combine historical v1 files into the new dataset. Export the new checkpoint to a separate candidate path and use the incumbent tournament gate before any promotion. Deployment filenames are champion pointers, not feature-version tags, and this migration does not replace shipped weights.

### ZERTZ feature-v2 bootstrap

Both ZERTZ wrappers preflight the selected checkpoint and existing generation files before launching self-play. They require a v2 checkpoint to continue training and reject v1 with an explicit bootstrap instruction. `DATA_DIR` defaults to `data/zertz/feature-v2`; set it to another dedicated v2 directory if needed. Historical `data/zertz/v*_selfplay.ndjson` files remain untouched and are not searched by the default loop. An explicitly selected directory containing legacy records, invalid JSON, or incompatible feature shapes/tags fails preflight rather than silently mixing schemas.

The wrappers also pass the deployed ONNX path to preflight. A resumed v2 checkpoint requires v2 ONNX input names and a successful six-plane inference probe; legacy, unknown, corrupt, and missing deployed models fail before Node self-play. Schema agreement does not prove exact weight identity: installation must still pair the champion checkpoint with its own exported ONNX. Explicit scratch preflight supplies `--deployed-model` with an absent path and omits `--checkpoint`; both incumbent artifacts must be absent. Manual bootstrap using a v1 evaluation model follows the individual commands below, outside the normal wrappers.

To bootstrap from a legacy incumbent, run the following steps manually from the repository root, using fresh candidate paths. Legacy NN inference is still available for generating correctly tagged v2 records; the missing identity is extracted from each live board, never fabricated from old data.

```bash
mkdir -p data/zertz/feature-v2
node scripts/zertz/parallel-selfplay.mjs --games 50 --sims 200 --workers 6 \
  --mode nn --model public/models/zertz-value-v1.onnx \
  --output data/zertz/feature-v2/bootstrap.ndjson
PYTHONPATH=training training/.venv/bin/python3 training/zertz/train.py \
  --data data/zertz/feature-v2/bootstrap.ndjson --feature-version 2 \
  --augment --seed 42 --output-dir training/zertz/bootstrap-v2
PYTHONPATH=training training/.venv/bin/python3 training/zertz/export_onnx.py \
  --checkpoint training/zertz/bootstrap-v2/best.pt \
  --output public/models/zertz-bootstrap-v2.onnx
node scripts/zertz/tournament.mjs --mode nn-vs-nn --games 20 --sims 100 \
  --model1 public/models/zertz-bootstrap-v2.onnx \
  --model2 public/models/zertz-value-v1.onnx
```

Stop on any error or a nonzero tournament exit. These steps do not install the candidate. Only after the candidate wins and an explicit decision to install it, update the model and matching checkpoint pointer:

```bash
training/.venv/bin/python3 scripts/verify-model.py public/models/zertz-bootstrap-v2.onnx \
  --destination public/models/zertz-value-v1.onnx
echo training/zertz/bootstrap-v2/best.pt > training/zertz/.deployed-checkpoint
```

The next normal one-shot invocation is `DATA_DIR=data/zertz/feature-v2 ./scripts/zertz/train-iteration.sh <unused-version> 50 200` (replace `<unused-version>` with an unused integer greater than 1). The continuous path is `DATA_DIR=data/zertz/feature-v2 ./scripts/zertz/continuous-train.sh --max-iterations 1`; first check that `training/zertz/.current-version`, if present, names an unused candidate version. Both paths resume the recorded v2 champion, generate with the deployed NN, and keep the explicit incumbent gate. The continuous script retains its existing commit/push behavior after promotion, so it is not a dry run. If no incumbent exists, manual generation can use `--mode heuristic`, but neither the wrappers nor the bootstrap procedure treats that absence as a tournament win.

**Difficulty wiring in the UI** (`src/games/zertz/ZertzGame.jsx`): `easy` and `advanced` (the default) run heuristic MCTS at 100/200 simulations; `expert` requests `${PUBLIC_URL}/models/zertz-value-v1.onnx` at 300 simulations. An unavailable or incompatible model is visibly reported as heuristic fallback.

**Training loss adds heuristic distillation.** Unlike Yinsh, `training/zertz/train.py` blends a third loss term: `loss = value_loss + policy_loss + distill_weight * heuristic_loss`, where `heuristic_loss` regularizes the value head's prediction toward the hand-crafted heuristic evaluation (`--distill-weight`, default 0.5, 0 disables it). Yinsh's training loop has no equivalent term.

**Promotion gate:** `scripts/zertz/tournament.mjs --mode nn-vs-nn --model1 candidate.onnx --model2 incumbent.onnx --games 20` alternates candidate sides and requires candidate wins in more than half of all games (draws count in the denominator). Missing, corrupt, unloaded, or incompatible models fail before results. The separate `--mode heuristic-vs-nn --model candidate.onnx` mode is a benchmark; wrappers never use it for promotion. Both ZERTZ wrappers resume `training/zertz/.deployed-checkpoint` (or an explicitly supplied `CHECKPOINT` for initialization) and use the deployed incumbent for NN self-play. They do not infer the champion from the latest numbered checkpoint. Without an incumbent, scratch training may produce a candidate, but bootstrap installation requires an explicit operator choice and is never an automatic tournament win.

Focused regression command (use an environment with `training/requirements.txt` installed): `PYTHONPATH=training python3 -m unittest discover -s tests -p 'test_training*.py' -v`. Subprocess fixtures isolate coordinators, tournament failures, and shell-wrapper continuation from actual training/promotion/push actions.

**API mode:** like Yinsh, `/api/zertzAiMove` is a heuristic-only serverless fallback (no NN support server-side).

## Other Game AI in This Repo

The rest of the GIPF suite uses approaches unrelated to the Yinsh/Zertz/Catan MCTS-plus-trained-network pattern:

- **Splendor** — a maxⁿ PUCT game-tree MCTS with a hand-written evaluation function and determinized handling of hidden information (opponents' blind reserves, shuffled decks). A trained self-play network was built and evaluated but did not beat the heuristic in gated play, so the heuristic ships. See [splendor.md](splendor.md).
- **Chess** — delegates move generation entirely to Stockfish, loaded as a self-contained asm.js build inside a same-origin Blob Web Worker (no server-side engine). See [chess.md](chess.md).
- **Diplomacy** — a best-response tactical search over orders, paired with an LLM-driven negotiation layer that gives each of the seven powers its own persona and lets them talk (and scheme) with the human and each other. See [diplomacy.md](diplomacy.md).
