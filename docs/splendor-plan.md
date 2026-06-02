# Splendor — Build Plan (v1)

Status: **planning** — not yet implemented. This document is the agreed spec for adding
Splendor as a new GIPF Project game, following the same conventions and rigor as `/catan`.

## Scope (locked)

- **Rules:** Faithful base-game Splendor, **2–4 players**. No expansions in v1; the rulesets
  module is structured so Cities of Splendor can be added later as a catalog (the way `/catan`
  lists expansions it doesn't fully simulate). Splendor Duel is a different game and is out of scope.
- **AI:** maxⁿ PUCT heuristic-rollout MCTS shipped; full self-play + ONNX training pipeline
  scaffolded behind a swappable `Evaluator` seam, NN left as a documented stretch.
- **Rules chat:** Bring-your-own-key rules assistant included, sharing the app-wide `gipfApiKey`
  (same model as the chess coach and Catan rules chat; identical storage logic, no cross-import).

## Why Splendor fits the Catan architecture

The same Board/Game split, maxⁿ search, determinization, and BYO-key chat all carry over.
Splendor is *simpler* than Catan in the two places Catan is hardest, and shares its one piece of
real sophistication (fair-play determinization).

| Dimension | Catan | Splendor | Implication |
|---|---|---|---|
| Players | 3–6, maxⁿ | 2–4, maxⁿ | Reuse per-node win-probability **vector** + maxⁿ backup |
| Hidden info | Opponent hands, dev deck | Deck order, opponents' blind-reserved cards | Reuse determinization |
| Stochasticity | Dice (chance nodes) | **None** once deck is determinized | **Drop the chance-node machinery** |
| Geometry | Hex topology, vertices/edges, longest-road graph | **None** (card grid + token piles) | CatanBoard's biggest complexity disappears |
| Setup | Snake placement | **None** — play starts immediately | Simpler state machine |
| Branching | Huge (trades, robber×victim) | Bounded, small (~≤40 moves/turn) | Faster MCTS convergence → effectively deeper search |

**Carried-over sophistication — fair-play determinization.** The AI must not see hidden deck order
or opponents' blind-reserved cards. Mirror Catan's `determinizeForSearch`: reshuffle the 3 hidden
decks and re-sample opponents' blind-reserved cards from a public-information belief; the real board
resolves the chosen move with the truth. Cards reserved face-up are public and stay known.

## Game data spec (Phase 0 — the rigor gate)

This is the highest-risk part of the project: faithful transcription, **not** code. Lock it first
with an invariant test before any logic is written.

- **Tokens (bank):** 5 gold (wild) always; colored = **4 / 5 / 7** each of white·blue·green·red·black
  for **2 / 3 / 4** players.
- **Cards:** 90 total — **40 tier-1, 30 tier-2, 20 tier-3**. Each card: `{ id, tier, cost{colors},
  bonus (one color), points (0–5) }`. Transcribed from the canonical distribution.
- **Nobles:** 10-card pool; **players + 1** placed each game; each is a bonus-count requirement
  worth **3 prestige**.
- **Win:** first to **15 prestige** *triggers* end-of-round; all players finish an equal number of
  turns; highest prestige wins; **tiebreak = fewest purchased development cards**.

A static seed → `mulberry32` shuffle (Catan's pattern) keeps games reproducible for tests.

## State machine

```
play  ──▶  [discard]      (only if the actor ends the turn holding > 10 tokens; one token at a time)
      ──▶  [noble-choice] (only if > 1 noble qualifies at end of turn; rare)
      ──▶  next player
                ⋮
            game-over      (after the round completes once any player has reached 15 prestige)
```

No setup phase, no dice.

## Moves (`getLegalMoves` / `applyMove`)

| Move | Shape | Notes |
|---|---|---|
| `take-three` | `{ type, colors: [3 distinct] }` | C(5,3)=10 max; fewer if piles empty |
| `take-two` | `{ type, color }` | only if that pile has **≥ 4** tokens |
| `reserve` | `{ type, cardId }` or `{ type, tier, fromDeck: true }` | max 3 reserved; grants 1 gold if available; deck-top reserve is hidden info |
| `buy` | `{ type, cardId, fromReserve?: bool }` | deterministic min-gold payment (bonuses → colored → gold for shortfall) |
| `discard-token` | `{ type, color }` | overflow sub-phase, one at a time |
| `choose-noble` | `{ type, nobleId }` | rare multi-qualification tiebreak |

A normal action ends the turn unless it triggers the discard or noble sub-phase. No `end-turn` move.

## Heuristic evaluation (Phase 2)

`evaluatePosition` / `scoreMove` weigh:
- Prestige points (primary), with public leader pressure (like Catan).
- Permanent bonus-card "engine" value — discounts weighted by how much they unlock affordable,
  high-value cards and nobles.
- Progress toward nobles (matching bonus counts).
- Token economy / flexibility and tempo (cheap high-point cards reachable soon).
- Reservation value (denying opponents a key card / securing a high-value buy).

## File layout (mirrors `/catan`)

```
src/games/splendor/
  SplendorBoard.js        # pure rules engine (much smaller than CatanBoard — no geometry)
  splendorCards.js        # static 90-card catalog + 10 nobles + per-player-count token/noble counts
  splendorRulesets.js     # player-count + (future) expansion catalog; victory target = 15
  SplendorGame.jsx        # React UI — card grid, token bank, player panels, AI loop, rules chat
  splendor.css            # .game-splendor / .game-splendor.dark scoped vars + animations
  SplendorBoard.test.js   # logic + AI-legality + full-game-termination tests
  coach/rulesClient.js    # BYO-key rules chat (shared gipfApiKey — identical pattern, no cross-import)
  engine/
    mcts.js               # maxⁿ PUCT + determinization + softmax heuristic-rollout evaluator (no chance nodes)
    mcts.worker.js        # worker entrypoint
    features.js           # feature extraction + policy-index mapping
    valueNetwork.js / valueNetworkNode.js   # ONNX inference (browser / node) — stretch
    aiPlayer.js           # shared AI move interface
  hooks/useAIWorker.js    # worker lifecycle hook
api/splendorRules.js      # serverless BYO-key rules assistant (ruleset-aware)
scripts/splendor/         # self-play, tournament, train-loop, audit, compare-evals  (stretch)
training/splendor/        # PyTorch model/dataset/train/export  (stretch)
docs/splendor.md          # rule coverage + AI/training doc (written at ship time)
```

Wiring: `App.jsx` lazy route, `LandingPage` card, localStorage keys
(`splendorDarkMode`, `splendorShowMoves`, `splendorDifficulty`, `splendorPlayerCount`,
`splendorRulesetId`), and CLAUDE.md / architecture.md / README updates.

## Phases & verification gates

Each phase must pass its gate before moving on (per the project's goal-driven workflow).

0. **Data lock** — transcribe `splendorCards.js`. → *verify:* invariant test (40/30/20 per tier,
   bonus-color & point distributions, bank sizes per player count, 10 nobles).
1. **Pure engine** — all moves, gold min-payment, 10-token discard sub-phase, noble grant/choice,
   replacement draw, end-of-round + tiebreak, `clone`/`_captureState`/`undo`/`redo`/`getStateHash`.
   → *verify:* Jest suite mirroring `CatanBoard.test.js` sections + a random self-play game that
   terminates with zero illegal moves.
2. **AI** — port Catan's maxⁿ PUCT, strip chance nodes, add Splendor determinization, heuristic
   eval + softmax rollouts, worker + hook + difficulty presets. → *verify:* legal full self-play
   within a per-move budget + a `compare-evals` A/B-vs-frozen-champion ratchet ("ship only if it wins").
3. **UI** — 3×4 card grid, token bank, player panels, nobles row, controls, AI turn loop, move log,
   discard/noble pickers, dark mode, settings, localStorage. → *verify:* manual play-through +
   clean `npm run build`.
4. **Rules chat** — `api/splendorRules.js` + `coach/rulesClient.js` (shared `gipfApiKey`, context-aware).
5. **Wiring & docs** — App route, LandingPage card, CLAUDE.md / architecture.md / README / `docs/splendor.md`.
6. **Stretch — training pipeline** — `scripts/splendor/*` + `training/splendor/*` behind the
   `Evaluator` seam. Note: Splendor is dice-free with lower branching, so the search-backed value
   target is plausibly **less noisy than Catan's** — the NN may be more tractable here. Still ship
   the heuristic engine first.

## Difficulty presets (starting point, tuned via the A/B ratchet)

Search depth is the reliable strength lever (Catan's lesson). Start around:

| Level | Simulations | Notes |
|---|---|---|
| Strong | ~1500 | |
| Expert | ~3000 | |
| Brutal | ~6000 | smaller branching than Catan → should stay well within a comfortable per-move budget |

## Non-goals / intentionally omitted (v1)

- Cities of Splendor expansion mechanics (catalog-only hook left for later).
- Splendor Duel (separate game, separate engine).
- A trained, deployed NN (pipeline scaffolded; training is a stretch).
