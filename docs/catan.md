# Catan

The Catan implementation lives at `/catan`. The human plays as Player 1 against local MCTS opponents, with selectable Catan rule families and player counts.

## Rules Coverage

Implemented:

- 19-hex classic island and 30-hex 5-6 player island profiles
- 3-6 player base-game play with snake setup order
- 5-6 player Special Building Phase edition of the extension (the classic rules, labelled as such at setup and in Rules; not the newer paired-turns edition): after each player's turn, every other player in order may build and buy development cards (no dev-card play, no trading)
- Initial resource payout from the second settlement
- Dice production with settlement/city payouts and bank limits (a shortage voids the payout only when it affects multiple players; a single affected player receives the remaining stock)
- Robber on 7, automatic discard for players above seven cards, robber steal
- Roads, settlements, cities, bank trades, 3:1 and 2:1 ports
- Development cards: knight, victory point, road building, year of plenty, monopoly (25-card deck; the 5-6 player extension adds 9 for 34: 6 knights, 1 each of road building, year of plenty, monopoly)
- One development card per turn, never one bought that turn, playable before or after the roll. A knight's robber detour returns to the roll; a pre-roll Road Building must have its free roads placed before rolling
- Road Building is unplayable at the road piece limit, grants one road with one piece left, and must be resolved before the turn can end
- Largest army and longest road awards, including road severing: an opponent settlement that cuts the holder's road re-evaluates the award — a unique longer road takes the card, a tie sets it aside, and the incumbent keeps it on mere ties
- Victory only on your own turn: a player pushed to the target off-turn (severing transfer, special build) wins at the start of their next turn
- Player trades may not offer and request the same resource (no disguised gifts)
- Ruleset/scenario catalog for the core game, Seafarers, Cities & Knights, Traders & Barbarians, Explorers & Pirates, and 5-6 player extensions. Only rulesets with `engineLevel: 'Playable'` (base game, 5-6 extension) are offered at setup; a saved ruleset id that is not playable falls back to the base game (`getPlayableRuleset`). The other entries are a labelled reference section in the Rules panel
- Ruleset-specific victory target metadata, clamped to a base-engine-reachable ceiling (see below)
- Limited takeback: the human may undo only their own newest road, settlement or city placement (setup placements included) while nothing else has happened since (`getUndoablePlacement` / `undoPlacement`; the placement's history entry is tagged, so any later roll, card, steal, trade, discard or other move closes it). It restores the whole prior state, so resources, bank, longest road and VP are exact. The AI has no takeback move, and availability does not survive a reload. There is no general undo or redo in the UI
- Board zoom (buttons, pinch, Ctrl/Cmd + wheel), pan when zoomed (a drag never places a piece), and a hex inspector (tap on touch, hover on desktop) showing resource, number, roll probability and adjacent harbors

Also implemented (the action space is complete and faithful so the AI learns every real decision):

- Manual discard selection when a 7 is rolled (a real `discard` phase, one chosen card at a time, sequenced across every player over seven cards)
- Robber steal-target choice (one move per tile×victim) and a random steal (you don't get to pick the victim's best card)
- Year of Plenty / Monopoly resource choice; fully enumerated bank trades
- Player-to-player trades: offer a multi-resource give bundle for a multi-resource receive bundle to one, several, or all opponents; targets respond in order and the first able accepter completes it (no cap on the human's proposals). Targets who can't afford the ask are auto-skipped. Human UI: VP indicator, move-log feed, a full give/receive bank-trade picker, and pickers for discard / monopoly / Year of Plenty / robber victim / trade offers (validated inline) and responses.

Intentionally omitted:

- Full special-piece mechanics for non-base expansions such as ships, commodities, barbarians, wagons, and exploration missions. These are represented in the rules/scenario catalog for selection and reference, while the playable engine remains the base-game rules engine plus 5-6 support.

### Conformance suite

`src/games/catan/CatanConformance.test.js` locks the edge-case rules above with one targeted scenario test per area, plus a seeded self-play invariant soak (3, 4, and 6 players to termination) asserting after every move: every enumerated legal move applies on a clone, award holders match freshly recomputed road lengths and knight counts, bank + hands conserve every resource card, and wins land only on (or at the start of) the winner's own turn.

### Victory targets and termination

Every ruleset × scenario × player-count combination is exercised by `scripts/catan/audit-rulesets.mjs` (construction + full-game termination). Because the playable engine is base-game rules, it has no expansion VP sources (gold fields, metropolises, mission VP), so a catalog scenario's headline target (up to 17) can exceed what's actually reachable. The **reachable-target clamp** (`reachableTarget` in `catanRulesets.js`, the single source of truth for both engine and setup UI) caps the victory target to what the leader can plausibly amass given settlement-spot contention: 15/14/13/12 VP at 2/3/4-5/6 players. The setup screen shows the clamped value (with a `*` note) so the picker and board agree.

Live games have no round limit: play continues until someone reaches the target on their own turn. Simulation harnesses (self-play, tournaments, the ruleset audit, the conformance soak) opt in to a round cap with `CatanBoard.roundLimit = 100`; the VP leader then wins once the round count passes it. They also bound each game with a move cap.

### Trade discipline

The AI's `propose-trade` prior carries diminishing returns within a turn (`mcts.js`): the first offer is scored normally, each further one is penalized, so the AI makes its best deals and moves on instead of spamming the per-turn cap — fewer trade modals for the human, slightly shorter games. The penalty is deliberately gentle so clearly beneficial repeat trades still go through and AI-vs-AI strength is unchanged; a harder penalty shortens games further but costs strength. The AI enumerates at most 4 proposals per turn (`maxTradeProposalsPerTurn`); the human is not limited.

### Rules assistant (bring-your-own key)

The right rail has a "Rules Help" chat for asking about the active expansion — useful for the less familiar rulesets (Seafarers, Cities & Knights, Explorers & Pirates, etc.). It mirrors the chess coach's BYO-key model:

- `api/catanRules.js` is a Vercel serverless function that calls the Anthropic API with a key supplied in the request body (used once, never logged or persisted; no server-side fallback key).
- `src/games/catan/coach/rulesClient.js` reads the key from the shared `playApiKey` slot in `localStorage` and posts the running conversation. The key is entered only at `/login` (the panel links to `/login?return=/catan`) and every game uses it; legacy per-game keys (`chessApiKey` / `catanApiKey`) are migrated into the shared slot on first read. Each game keeps its own copy of this read logic, so the games stay independent (no cross-import).
- Each request carries the live game context (ruleset, edition, scenario, map, player count, victory target, module list), so answers are specific to what's in play. The system prompt also has the model distinguish the full tabletop rules of an expansion from what this base-engine app actually simulates, so it never claims a mechanic the app doesn't have.

Like the chess coach, this only works on the deployed site (or `vercel dev`); `npm start` alone doesn't serve `/api/*`.

## Architecture

Files:

| File | Purpose |
|------|---------|
| `src/games/catan/CatanBoard.js` | Pure game logic and rule enforcement |
| `src/games/catan/catanRulesets.js` | Rule family, scenario, map, player-count, and victory-target metadata |
| `src/games/catan/CatanGame.jsx` | React UI, SVG board, controls, AI turn loop, rules-help chat |
| `src/games/catan/catan.css` | Scoped `.game-catan` variables and board styling |
| `src/games/catan/coach/rulesClient.js` | Client + BYO-key storage for the rules assistant |
| `api/catanRules.js` | Serverless rules assistant (Claude, bring-your-own key) |
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

**How it's improved (the A/B ratchet):** every engine change plays the frozen reigning champion head-to-head, seat-balanced (`scripts/catan/compare-evals.mjs` vs `engine/_mcts_champion.js`), and ships only if it wins. The current engine combines softmax rollouts, an endgame-closing and leader-targeting evaluation, and deep search (see the difficulty presets below).

**Why the heuristic ships, not a network:** a full NN pipeline exists (`training/catan/`, `scripts/catan/train-loop.mjs`), but on a single machine it does not beat the heuristic. Heuristic distillation can only match the heuristic, the game-outcome label is too noisy, and the search-backed value target has a label-noise floor (from fair determinization, rollouts and finite simulations) that more model capacity does not overcome. Beating it would need many high-simulation searches per position across millions of positions. The deployed opponent is therefore the heuristic PUCT rollout-leaf tree with deep search.

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
