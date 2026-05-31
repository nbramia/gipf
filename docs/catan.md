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

Intentionally omitted for solo speed:

- Player-to-player trade negotiation
- Manual discard selection when a 7 is rolled
- Full special-piece mechanics for non-base expansions such as ships, commodities, barbarians, wagons, and exploration missions. These are represented in the rules/scenario catalog for selection and reference, while the playable engine remains the base-game rules engine plus 5-6 support.

## Architecture

Files:

| File | Purpose |
|------|---------|
| `src/games/catan/CatanBoard.js` | Pure game logic and rule enforcement |
| `src/games/catan/catanRulesets.js` | Rule family, scenario, map, player-count, and victory-target metadata |
| `src/games/catan/CatanGame.jsx` | React UI, SVG board, controls, AI turn loop |
| `src/games/catan/catan.css` | Scoped `.game-catan` variables and board styling |
| `src/games/catan/engine/mcts.js` | Root-focused MCTS with heuristic rollouts |
| `src/games/catan/engine/features.js` | Self-play feature extraction and policy targets |
| `src/games/catan/engine/mcts.worker.js` | Web Worker entrypoint for browser AI |
| `src/games/catan/hooks/useAIWorker.js` | React worker lifecycle hook |
| `scripts/catan/generate-training-data.mjs` | Self-play NDJSON generation |
| `scripts/catan/tournament.mjs` | Strong-vs-baseline AI tournament |

The module follows the same Board/Game split as YINSH and ZERTZ: all rules live in `CatanBoard`, the UI mutates the board through public methods, then calls `.clone()` to trigger React rendering.

## AI

The deployed opponents use MCTS in a Web Worker. Catan is multi-player and stochastic, so the search is root-focused: it samples legal root actions with UCB, then uses fast heuristic rollouts for the rest of the game. This avoids treating opponent turns as cooperative branches.

The heuristic values:

- Victory points and public leader pressure
- Production strength and resource diversity
- Resource progress toward cities, settlements, roads, and development cards
- Port value paired with production profile
- Robber placement, largest army, and longest road
- Expansion quality for setup settlements and road building

Difficulty presets:

| Level | Simulations | Max root children |
|-------|-------------|-------------------|
| Strong | 260 | 34 |
| Expert | 420 | 42 |
| Brutal | 650 | 50 |

## Training Data

Generate self-play data:

```bash
npm run catan:self-play -- --games 20 --sims 200
```

Output is NDJSON under `data/catan/` with:

- `tiles`: 19 x 8 tile features
- `players`: 4 x 18 player features from the acting player's perspective
- `meta`: 12 scalar game-state features
- `policy`: normalized MCTS root visit distribution
- `heuristic`: current heuristic value estimate
- `value`: final game result for the acting player

Run a strength check:

```bash
npm run catan:tournament -- --games 8 --sims-a 500 --sims-b 180
```
