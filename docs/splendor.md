# Splendor

The Splendor implementation lives at `/splendor`. The human plays as Player 1 (red)
against 1–3 local MCTS opponents, racing to 15 prestige. See
[splendor-plan.md](splendor-plan.md) for the original build plan.

## Rules Coverage

Faithful **base-game Splendor, 2–4 players**. Implemented:

- The canonical 90 development cards (40/30/20 across tiers 1/2/3) and 10 noble tiles.
  The card set was cross-validated against two independent public datasets and is
  locked by invariant tests (`SplendorBoard.test.js`) — see [Data fidelity](#data-fidelity).
- Token bank scaled by player count (4/5/7 colored gems for 2/3/4 players + 5 gold),
  nobles in play = players + 1.
- The four turn actions: take 3 different gems, take 2 of one color (pile ≥ 4),
  reserve a card (from the market or blind off a deck) taking 1 gold if available,
  and purchase a card (from the market or your reserve), gold paying any shortfall.
- The 10-token hand limit as a real discard sub-phase (one token returned at a time),
  the 3-reserved-card limit, automatic noble visits (with a choice when more than one
  qualifies), market replacement draws, and the 15-prestige **final-round** end
  condition with the **fewest-cards** tiebreak.
- Undo/redo via the same board-state snapshot pattern as the other games.

**Intentionally omitted (v1):** the Cities of Splendor expansions (Cities, Strongholds,
Trading Posts, The Orient) and the two-player Splendor Duel (a separate game). The
rules-help chat will explain these on request but makes clear the app doesn't simulate them.

### Data fidelity

Card-data correctness is the highest-risk part of a faithful implementation, so it's the
first thing locked. `splendorCards.js` was generated from data cross-validated against
`seal256/splendor` (`assets/cards.csv`) and `andrzejchmura/splendor` (`src/cards.json`),
which are byte-for-byte identical as multisets. `SplendorBoard.test.js` asserts the full
composition (40/30/20 per tier, 8/6/4 cards per bonus color per tier, the published
prestige distribution, the 3×(3/3/3)+5×(4/4) noble split, bank sizes, and the 15-point
target). Don't edit costs without re-validating against those sources.

## Architecture

The module follows the same Board/Game split as the other games: all rules live in
`SplendorBoard`, the UI mutates the board through public methods, then calls `.clone()`
to trigger React rendering.

| File | Purpose |
|------|---------|
| `src/games/splendor/SplendorBoard.js` | Pure rules/state engine (no React) |
| `src/games/splendor/splendorCards.js` | Canonical 90-card deck, 10 nobles, token/noble setup constants |
| `src/games/splendor/SplendorGame.jsx` | React UI — card market, token bank, player panels, AI loop, rules chat |
| `src/games/splendor/splendor.css` | Scoped `.game-splendor` variables and styling |
| `src/games/splendor/coach/rulesClient.js` | Client + BYO-key storage for the rules assistant |
| `api/splendorRules.js` | Serverless rules assistant (Claude, bring-your-own key) |
| `src/games/splendor/engine/mcts.js` | maxⁿ PUCT game-tree MCTS (heuristic-rollout / NN evaluator) |
| `src/games/splendor/engine/features.js` | Feature extraction + policy-index mapping for self-play |
| `src/games/splendor/engine/valueNetwork.js` / `valueNetworkNode.js` | ONNX inference (browser / Node) for the NN evaluator seam |
| `src/games/splendor/engine/mcts.worker.js` | Web Worker entrypoint for browser AI |
| `src/games/splendor/hooks/useAIWorker.js` | React worker lifecycle hook |
| `training/splendor/` | PyTorch policy+value model, dataset, train, ONNX export (scaffold) |
| `scripts/splendor/generate-training-data.mjs` | Self-play NDJSON generation |
| `scripts/splendor/tournament.mjs` | A-vs-B strength tournament (e.g. NN vs heuristic) |
| `scripts/splendor/compare-evals.mjs` | A/B challenger (`mcts.js`) vs frozen champion (`_mcts_champion.js`) |

## AI

The deployed opponents use a **maxⁿ PUCT game-tree MCTS** in a Web Worker. Splendor is
multi-player, so each node carries a per-player **win-probability vector** with maxⁿ
backup (each node's to-move player maximizes their own component), exactly like Catan.

**No chance nodes.** Splendor's only hidden element is the order of the three draw decks
(and opponents' blind-reserved cards), which is fixed once shuffled — so every move is a
**deterministic** transition inside the search clone. This is simpler than Catan, which
needs dice chance nodes.

**Fair play (no X-ray vision):** each search runs on a *determinized* clone. The three
decks are re-shuffled and each opponent's **blind**-reserved cards (reserved face-down
from a deck — the tier is public, the card is not) are re-sampled from the unseen pool of
the matching tier. The observer's own hand, the face-up market, public (face-up) reserves,
purchased cards, and nobles are left untouched. The AI plans on a believable guess; the
real board resolves the move with the truth, exactly like a human.

Leaf evaluation is pluggable via an `Evaluator` seam: the deployed engine uses a **softmax
heuristic rollout** at leaves; an NN evaluator (ONNX value+policy) drops in behind the same
`{ values, priors }` interface. The heuristic values prestige and leader pressure,
permanent bonus-card "engine" strength and color diversity, proximity to the available
nobles, token economy (gold is the most flexible), and the prestige of cards the player can
afford now.

**The A/B ratchet:** every engine change plays the frozen reigning champion head-to-head,
seat-balanced (`scripts/splendor/compare-evals.mjs` vs `engine/_mcts_champion.js`), and
ships only if it wins — then copy `mcts.js` → `_mcts_champion.js`.

Difficulty presets (search depth is the reliable strength lever; Splendor's small branching
keeps even deep search cheap, ~0.4 ms/sim):

Leaf-rollout depth was swept with `scripts/splendor/ladder.mjs --rollout-set` (28 ranks best;
shallower loses accuracy, deeper adds cost/variance without gain), so the presets use 28.

A demand-memoization speedup (computing per-colour token demand once per scoring pass instead
of per candidate move — it was the #1 profiler hot spot) roughly **2.5×'d search throughput**
(~1950 → ~5000 sims/sec; `scripts/splendor/bench.mjs`). The presets were raised ~2.5× to spend
that on more search at the **same move latency** — a free strength gain: the strong preset's
1200→3000 jump is **+190 Elo** (h-3000 beat h-1200 18–6, 75%, Wilson CI [55%, 88%], significant):

| Level | Simulations | Max root children | Rollout depth |
|-------|-------------|-------------------|---------------|
| Strong | 3000 | 36 | 28 |
| Expert | 6000 | 44 | 28 |
| Brutal | 12000 | 50 | 30 |

## Verification rig (how strength is proven)

Strength is measured, not asserted (`docs/splendor-ai-plan.md`):

- `scripts/splendor/ladder.mjs` — Bradley-Terry **ELO** gauntlet across engines. Confirms the
  engine scales with search: 40 / 150 / 500 sims ≈ **1212 / 1563 / 1724 Elo**.
- `engine/positions.test.js` — tactical benchmarks (winning buy, noble-for-the-win,
  prefer-buy-over-take, keep-the-gold). Competence proof + regression guard.
- `scripts/splendor/compare-evals.mjs` and `tournament.mjs` — head-to-head with a **Wilson 95%
  CI** and a significance verdict; the flywheel/ratchet promote only when the lower bound clears
  50%, never on noise. Output also reports self-play health (plies/game, cap-hits, prestige).

## Neural network (trained, did NOT beat the heuristic — heuristic stays)

A full AlphaZero-style flywheel exists (`scripts/splendor/selfplay-parallel.mjs`,
`train-loop.mjs`, `training/splendor/`) behind the `Evaluator` seam. It was run for real
(13 generations, 2-player, ~3,900 self-play games, gated vs the heuristic). **The NN never
significantly beat the heuristic rollout-leaf and is not deployed** — the live engine remains
the heuristic PUCT rollout-leaf tree.

Results (gate = NN vs heuristic, 60 games/gen):
- Win-rate climbed 1.7% → ~15% across generations, then **plateaued ~15%** at 2× sims.
- Even at **10× sims (≈ equal wall-clock**, since an NN leaf is one forward pass vs a 28-step
  rollout), the best generation reached only **23.3%** (95% CI [11.8%, 40.9%] — significantly
  worse). Its value scales with search but can't close the gap.

This reproduces Catan's finding (their distillation maxed ~16.7%). Two compounding causes:
1. **Cold start.** The gate requires beating the heuristic before NN-guided self-play kicks in,
   but the net can't clear that bar from heuristic-outcome data alone — so self-play never
   improved past heuristic quality (a chicken-and-egg the flywheel can't bootstrap here).
2. **Value vs lookahead.** A 1-ply NN value replaces a 28-step rollout; to win it must be a far
   better positional evaluator than the hand heuristic, and a small MLP on noisy 2-player
   outcome labels isn't.

What would actually be needed (a real project, not a CPU afternoon): train the value head on
**search-backed targets** (the AlphaZero target, averaged over determinizations to fight label
noise), a **larger network**, and **orders of magnitude more self-play** — ideally on a GPU.
The pipeline and rig are in place to attempt that later. Meanwhile the reliable lever remains
search depth, and the deployed presets already run it deep.

Feature encoding (`features.js`): `players` (4×14, perspective-relative) + `market` (12×12)
+ `meta` (16) = 216 input floats; policy = 230 move slots; value = 4 seat logits (softmax
→ win-prob over seats relative to the to-move player).

## Training data

```bash
npm run splendor:self-play -- --games 20 --players 4 --sims 200
```

Output is NDJSON under `data/splendor/` (gitignored): perspective-relative
`players`/`market`/`meta` planes, the normalized MCTS root-visit `policy` target, the
`heuristic` value, the eventual `winnerSeat` (value-head class target), and `gameId` for a
leakage-free train/val split.

Strength A/B:

```bash
node scripts/splendor/compare-evals.mjs --games 30 --sims 120 --rollout 24
node scripts/splendor/tournament.mjs --games 20 --a-mode nn --a-model public/models/splendor-value-v1.onnx
```

## Rules assistant (bring-your-own key)

A "Rules Help" chat (mirroring the chess coach and Catan rules chat) answers questions about
Splendor, grounded in the live game context. `api/splendorRules.js` calls the Anthropic API
with a key supplied in the request body (used once, never logged or persisted; no server-side
fallback). `coach/rulesClient.js` stores the key in `localStorage` under the shared
`gipfApiKey` slot — a key saved in chess or Catan is reused here and vice versa. Like the
other assistants, it only works on the deployed site (or `vercel dev`); `npm start` alone
doesn't serve `/api/*`.
