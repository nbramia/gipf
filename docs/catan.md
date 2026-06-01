# Catan

The Catan implementation lives at `/catan`. The human plays as Player 1 against local MCTS opponents, with selectable Catan rule families and player counts.

## Rules Coverage

Implemented:

- 19-hex classic island and 30-hex 5-6 player island profiles
- 3-6 player base-game play with snake setup order
- 5-6 player paired build phase after the rolling player's action phase
- Initial resource payout from the second settlement
- Dice production with settlement/city payouts and bank limits
- Robber on 7, automatic discard for players above seven cards, robber steal
- Roads, settlements, cities, bank trades, 3:1 and 2:1 ports
- Development cards: knight, victory point, road building, year of plenty, monopoly
- Largest army and longest road awards
- Ruleset/scenario catalog for the core game, Seafarers, Cities & Knights, Traders & Barbarians, Explorers & Pirates, and 5-6 player extensions
- Ruleset-specific victory target metadata
- Undo/redo support through the same board-state snapshot pattern used by the other games

Also implemented (the action space is complete and faithful so the AI learns every real decision):

- Manual discard selection when a 7 is rolled (a real `discard` phase, one chosen card at a time, sequenced across every player over seven cards)
- Robber steal-target choice (one move per tile×victim) and a random steal (you don't get to pick the victim's best card)
- Year of Plenty / Monopoly resource choice; fully enumerated bank trades
- Player-to-player trades: offer a multi-resource give bundle for a multi-resource receive bundle to one, several, or all opponents; targets respond in order and the first able accepter completes it (up to 4 proposals per turn). Targets who can't afford the ask are auto-skipped. Human UI: VP indicator, move-log feed, and pickers for discard / monopoly / Year of Plenty / robber victim / trade offers and responses.

Intentionally omitted:

- Full special-piece mechanics for non-base expansions such as ships, commodities, barbarians, wagons, and exploration missions. These are represented in the rules/scenario catalog for selection and reference, while the playable engine remains the base-game rules engine plus 5-6 support.

## Architecture

Files:

| File | Purpose |
|------|---------|
| `src/games/catan/CatanBoard.js` | Pure game logic and rule enforcement |
| `src/games/catan/catanRulesets.js` | Rule family, scenario, map, player-count, and victory-target metadata |
| `src/games/catan/CatanGame.jsx` | React UI, SVG board, controls, AI turn loop |
| `src/games/catan/catan.css` | Scoped `.game-catan` variables and board styling |
| `src/games/catan/engine/mcts.js` | PUCT game-tree MCTS (maxⁿ value, dice chance nodes, heuristic-rollout/NN evaluator) |
| `src/games/catan/engine/features.js` | Self-play feature extraction and policy targets |
| `src/games/catan/engine/valueNetwork.js` / `valueNetworkNode.js` | ONNX inference (browser / Node) for the NN evaluator |
| `training/catan/` | PyTorch policy+value model, dataset, train, ONNX export |
| `src/games/catan/engine/mcts.worker.js` | Web Worker entrypoint for browser AI |
| `src/games/catan/hooks/useAIWorker.js` | React worker lifecycle hook |
| `scripts/catan/generate-training-data.mjs` | Single-process self-play NDJSON generation |
| `scripts/catan/selfplay-parallel.mjs` | Fan-out self-play across worker processes |
| `scripts/catan/train-loop.mjs` | Time-boxed, gated self-play training flywheel |
| `scripts/catan/tournament.mjs` | A/B engine-variant / NN-vs-baseline tournament |
| `scripts/catan/compare-evals.mjs` | A/B challenger (`mcts.js`) vs frozen champion (`_mcts_champion.js`) |

The module follows the same Board/Game split as YINSH and ZERTZ: all rules live in `CatanBoard`, the UI mutates the board through public methods, then calls `.clone()` to trigger React rendering.

## AI

The deployed opponents use a PUCT game-tree MCTS in a Web Worker. Catan is multi-player and stochastic, so the tree carries a per-node win-probability **vector** over players with maxⁿ backup (each node's to-move player maximizes their own component) rather than a single cooperative value. The dice roll — the engine's only stochastic transition — is handled as a chance node: roll edges sample an outcome each visit and key children by the total, so a roll edge's Q is a proper expectation over dice. Leaf evaluation is pluggable via an `Evaluator` seam: the deployed engine uses a **softmax** heuristic rollout at leaves (rollout-leaf); an NN evaluator (ONNX value+policy) can drop in behind the same interface.

**Fair play (no X-ray vision):** each search runs on a *determinized* clone — every opponent's hand is re-sampled to the same public card count but unknown contents (types drawn from their visible production), and the unseen dev deck is reshuffled. The AI plans on a believable guess and the real board resolves the move with the truth, exactly like a human. It never reads opponents' actual cards or the next dev card.

**How it's improved (the A/B ratchet):** every engine change plays the frozen reigning champion head-to-head, seat-balanced (`scripts/catan/compare-evals.mjs` vs `engine/_mcts_champion.js`), and ships only if it wins. Proven wins so far: softmax rollouts (+60% over greedy), endgame-closing + leader-targeting eval, and much deeper search (Strong/Expert/Brutal = 1500/3000/6000 sims, ~2.4s/move on Brutal).

**Neural-network status (closed on a single machine, pipeline kept):** a full pipeline exists (`training/catan/`, `scripts/catan/train-loop.mjs`) but the NN cannot beat the heuristic here. Three value targets were tested: heuristic distillation learns it cleanly (val_mse ~0.004) but can only *match* it (~16.7% win); the game-outcome label is far too noisy (5%); and the *search-backed* value — the correct AlphaZero target — has a ~0.12 label-noise floor (from the fair determinization + rollouts + finite sims) that more capacity can't beat (200k→1.5M→2.7M params: 0.128→0.123→0.138, the largest overfitting). Cracking it would need averaging many high-sim searches per position across millions of positions — a GPU-cluster project, not a local one. The deployed strength is therefore the heuristic PUCT rollout-leaf tree with deep search.

The heuristic values:

- Victory points and public leader pressure
- Production strength and resource diversity
- Resource progress toward cities, settlements, roads, and development cards
- Port value paired with production profile
- Robber placement, largest army, and longest road
- Expansion quality for setup settlements and road building

Difficulty presets:

| Level | Simulations | Max root children | Rollout depth |
|-------|-------------|-------------------|---------------|
| Strong | 1500 | 44 | 24 |
| Expert | 3000 | 50 | 28 |
| Brutal | 6000 | 56 | 32 |

(Brutal is ~2.4s/move. More search is the reliable strength lever — these are the deepest settings that stay within a comfortable per-move budget.)

## Training Data

Generate self-play data:

```bash
npm run catan:self-play -- --games 20 --sims 200
```

Output is NDJSON under `data/catan/` (gitignored) with:

- `tiles`: MAX_TILES(30) x 8 tile features (zero-padded for the 19-hex map)
- `players`: MAX_PLAYERS(6) x 18 player features, acting player first (perspective-relative)
- `meta`: 12 scalar game-state features
- `policy`: normalized MCTS root visit distribution (483 slots)
- `heuristic`: per-position heuristic value estimate (tanh, zero-centered)
- `winnerSeat`: perspective-relative seat of the eventual winner (value-head class target)
- `gameId`: board seed — group positions by game for a leakage-free train/val split

Parallel self-play and the gated training flywheel:

```bash
node scripts/catan/selfplay-parallel.mjs --games 600 --workers 24 --sims 100
node scripts/catan/train-loop.mjs --budget 28800 --run-id v1   # detached, time-boxed
```

Strength A/B (engine challenger vs frozen champion, or vs the heuristic baseline):

```bash
node scripts/catan/compare-evals.mjs --games 30 --sims 100 --rollout 30
npm run catan:tournament -- --games 20 --a-model public/models/m.onnx --b-mode tree
```
