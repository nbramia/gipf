# Splendor — "Make the AI dramatically & verifiably smarter" plan

Status: **NN flywheel (Phase 3) completed, negative result — the heuristic ships.** The
trained net never significantly beat the heuristic rollout-leaf tree, so it's not deployed.
See [splendor.md](splendor.md) ("Neural network (trained, did NOT beat the heuristic —
heuristic stays)") for the full write-up and results. Of Phase 2's Track A items, single-
determinization for hidden info is built (`determinizeForSearch` in `engine/mcts.js`); a
transposition table and a determinization ensemble are still open, not built.

Goal (as originally framed): a Splendor AI that is measurably much stronger than the
shipped heuristic, with every gain proven, not asserted.

## What we learned from the other games

- **Yinsh NN won (80% vs heuristic)** because the game is 2-player, deterministic, perfect
  information → the value label (game outcome ±1) is clean and learnable.
- **Catan NN failed** (deployed heuristic instead) because dice + hidden hands + fair
  determinization + maxⁿ credit assignment give the value target a ~0.12 noise floor that
  more capacity can't beat. The lesson: **value-label noise, not compute/architecture, is
  the determining factor.** Catan's reliable lever was "more search."
- **Splendor sits between them and is a promising NN target**: no dice, almost all state is
  public (only deck order + rare blind reserves are hidden), small branching. **2-player
  Splendor is the cleanest setting (Yinsh-like)** and is where the NN is most likely to win
  first.

Compute here: 32-core CPU, **no GPU**. Fine — the model is a tiny MLP and self-play
parallelizes across cores; compute was never Catan's blocker.

## Decisions (locked)

- Sequence: **rig → heuristic+search → NN flywheel**.
- Compute: build + run a **detached, time-boxed gated flywheel** on this box.
- Success bar: **ELO ladder + A/B gate (>55% over 100+ games) + a tactical-positions suite.**

## Phase 1 — Verification rig (do first; everything gates on it)

- `scripts/splendor/ladder.mjs` — ELO gauntlet across {1-ply heuristic, champion, candidates,
  NN gens}. Turns "smarter" into a number.
- Tactical **benchmark positions** (in tests): winning buy, noble-for-the-win, prefer a buy
  over a take, don't overdraw past 10, block/deny. Proves competence + catches regressions.
- **Strength-vs-sims curve** — confirms the engine scales with thinking time.
- **Self-play health**: game-length distribution, % hitting the turn cap, avg winning prestige.
- Harden `compare-evals` with **confidence intervals** (40 games ≈ ±15%; gate on 100–200).

Gate: a reproducible ELO/strength baseline for today's champion.

## Phase 2 — Track A: heuristic + search (reliable, each A/B-gated)

- **Transposition table** in MCTS (Splendor has heavy move-order transpositions; it has none yet).
- **Determinization ensemble** — average the leaf value over K re-sampled determinizations (ISMCTS)
  to cut fairness variance.
- **Hyperparameter sweep** — `PUCT_C`, value/prior temps, `rolloutSteps`, `maxChildren`.
- **Eval/rollout upgrades** — tempo-to-next-point-card, noble-race awareness, gold flexibility,
  opponent reservation threats, end-game "who reaches 15 first". The rollout policy is the leaf
  signal, so these compound.

Gate: champion ELO up; candidate >55% vs prior champion over 100+ games; positions still pass.

## Phase 3 — Track B: NN flywheel (the dramatic bet, 2-player first)

- Port Catan's gated `train-loop.mjs` + `selfplay-parallel.mjs` (mostly scaffolded already).
- Beat Catan's failure mode: **scalar 2p zero-sum value** (not maxⁿ vector), **value averaged
  over multiple determinizations per position**, **high sims/position** (quality > quantity).
  Policy head trains on the MCTS visit distribution (already extracted).
- Flywheel: parallel self-play → fine-tune from best → export ONNX → gate vs champion →
  promote on win; sliding replay window; detached + time-boxed.
- Deploy behind the existing `Evaluator` seam. If it beats the heuristic in 2p, extend to 3-4p;
  if it stalls like Catan, document the finding and keep the (now stronger) heuristic.

## Phase 4 — Ship & document

Deploy the strongest evaluator, re-tune difficulty presets against the new ELO, write the AI
findings into `docs/splendor.md` (mirroring Catan's honest NN write-up).
