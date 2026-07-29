# GIPF Project

Browser-based implementations of abstract strategy and classic board games, each with its own computer opponent. Play against the AI or another person, with full rule enforcement, undo/redo, and dark mode.

**[Play Now](https://gipf.vercel.app)**

## Games

### Yinsh

Players compete using rings and markers on a hexagonal board. Place a marker in one of your rings, move the ring in a straight line, and flip any markers along the path. Form a row of 5 to score -- first to 3 points wins.

The opponent is a Monte Carlo tree search that can run on hand-written heuristics or be guided by a small trained neural network running in the browser. Includes chess-style move notation and difficulty settings. See [How the AI works](#how-the-ai-works) below.

### Zertz

Capture marbles by jumping over them on a shrinking hex board. After placing a marble and removing an edge ring, check for forced jumps. Win by collecting sets of marbles (4 white, 5 grey, 6 black, or 3 of each).

Shares Yinsh's search engine: its harder setting uses a trained neural network, the easier ones use heuristic search. Two-player mode, full undo/redo, and dark mode.

### Chess

Play against Stockfish across five strength tiers or a rated Elo ladder. Stockfish runs as a single-threaded asm.js build loaded into a Web Worker, so it works on a static host with no special server headers. An optional coach explains each move, if you bring your own Anthropic API key, using only the engine's own evaluations so it cannot invent a line; with no key, a deterministic template produces the same commentary from the same numbers. Also includes a per-move question-and-answer thread (the engine is exposed to the model as a tool it can call), opening detection with optional master-game statistics, solver-verified mate-in-1 and mate-in-2 puzzles, and PGN import/export.

### Catan

Base-game Catan against three MCTS opponents. Build roads, settlements, and cities; trade through the bank and ports; play development cards; move the robber; and race to 10 victory points.

The opponents run a root-focused Monte Carlo tree search in a Web Worker (from 1,500 to 6,000 simulations per move depending on difficulty), scoring positions with a hand-tuned evaluation of production, ports, development cards, longest road, and how close anyone is to winning. Randomized balanced boards, full undo/redo.

### Splendor

Collect gem tokens, build an engine of discounted development cards, and court nobles. Take 3 different gems or 2 of one, reserve cards (with a gold wild), and buy cards for prestige -- race 1-3 opponents to 15 points.

The AI is a maxⁿ tree search (the multi-player generalization of minimax, where each player maximizes their own score) that handles hidden information fairly: rather than reading opponents' face-down reserved cards or the true deck order, it re-samples them into a believable world before searching. Includes a bring-your-own-key rules-help chat, full undo/redo, and 2-4 player support.

### Diplomacy

Classic seven-power Diplomacy on the standard 1901 Europe map. Command armies and fleets with hold, move, support, and convoy orders that adjudicate simultaneously each season, with support-cutting, dislodgement, retreats, winter builds, and split coasts handled by a from-scratch engine. Negotiate with the six AI powers, then race to control 18 of the 34 supply centers for a solo victory.

Each AI power can hold a real conversation (bring your own Anthropic API key) and negotiates privately with the others behind your back. What a power says is bound to what it does: a trust ledger tracks which promises were kept or broken, a separate model decides whether to honor or break each deal, and honored deals are forced onto the board as real support orders. The tactical side is a best-response search over cloned board states in a Web Worker. See [How the AI works](#how-the-ai-works) below.

## How the AI works

Each game has its own opponent, and they fall into three families.

**Self-play neural networks (Yinsh, Zertz).** These use Monte Carlo tree search in the AlphaZero mold: PUCT selection guided by a small residual network that outputs both a move policy and a position value, with Dirichlet noise at the root for exploration and a transposition table so positions reached by different move orders share statistics. The network (a few hundred thousand parameters) runs entirely in the browser through ONNX Runtime Web (WASM) inside a Web Worker, so the UI never blocks. Training happens offline in PyTorch: the current network plays games against itself, those positions train a candidate, and the candidate replaces the incumbent only if it wins a gated head-to-head match (Yinsh uses a sequential probability ratio test; Zertz a simpler majority gate). Training data is augmented 6-fold using the board's rotational symmetry, and the loop runs unattended, committing each promotion. Yinsh has the longer training lineage; Zertz's is shorter and also distills toward the hand-written heuristic to stay anchored early on.

**Classical search (Catan, Splendor, Chess).** Catan and Splendor use tree search with hand-written position evaluation rather than a trained network, running in Web Workers. Splendor plays a genuine multi-player maxⁿ search and handles hidden information fairly by re-sampling the parts of the state a player could not actually see. (A self-play network was trained for Splendor as an experiment; it did not beat the heuristic, so the heuristic is what ships.) Chess delegates to Stockfish rather than a hand-rolled engine, with one workaround worth noting: Stockfish's built-in strength limiter does not go below 1320 Elo, so beneath that the code searches at full strength and samples a deliberately weaker move from within a bounded evaluation window.

**Language-model negotiation (Diplomacy).** The six AI powers converse and negotiate through an Anthropic model, but the model only supplies dialogue and a self-reported (and deliberately distrusted) sense of who it likes. The decisions are cold, tested code: a trust ledger scores kept and broken promises against what each power actually ordered, a betrayal model weighs the tactical payoff of breaking a deal against its reputation cost, and honored deals are force-bound into legal support orders so talk and action stay consistent. A deal becomes binding only when the model emits it as a structured field, so free-form chat can never silently commit a power. Hidden AI-to-AI negotiation runs on a cheaper model than the human-facing replies to keep cost down.

## Quick Start

```bash
git clone https://github.com/nbramia/gipf.git
cd gipf
npm install
npm start
```

Opens at `http://localhost:3000` with a landing page. Navigate to `/yinsh`, `/zertz`, `/chess`, `/catan`, `/splendor`, or `/diplomacy`.

The bring-your-own-key features (the chess coach, the Catan and Splendor rules chat, and Diplomacy negotiation) call Anthropic through Vercel serverless functions, so they only work on the deployed site or under `vercel dev`, not plain `npm start`. An optional account (username + password, no email) syncs your API key across devices from a widget on the landing page.

## Development

```bash
npm start                 # Dev server with hot reload
CI=true npm test          # Run the full test suite
npm run test:engine       # Yinsh MCTS engine tests
npm run build             # Production build
```

**Training the self-play AI** (Yinsh; Zertz mirrors it under `scripts/zertz/`, Catan and Splendor under `scripts/catan/` and `scripts/splendor/`):

```bash
npm run self-play                       # Generate self-play games
npm run train-iteration                 # One self-play -> train -> tournament cycle
./scripts/continuous-train.sh           # Autonomous loop with gated auto-promotion
```

**Deployment:** Vercel auto-deploys on push to `main`. There is no CI gate -- tests must pass locally before pushing.

It is served from two places off the same build: its own project at
[gipf.vercel.app](https://gipf.vercel.app), and `ramia.us/gipf`, a subpath of a shared
domain reached by a rewrite from the [ramia](https://github.com/nbramia/ramia) shell. The
app therefore cannot assume it owns the URL root -- the deploy prefix comes from `homepage`
in `package.json`, and `PUBLIC_URL` carries it into the router and into every serverless
call. See CLAUDE.md for what that constrains.

## Project Structure

```
src/
  App.jsx                  # Router: lazy-loads each game
  LandingPage.jsx          # Landing page with game cards
  index.css                # Shared Tailwind directives
  games/
    yinsh/                 # Game logic, React UI, engine/ (MCTS + NN), CSS, tests
    zertz/                 # Same shape as yinsh; shares the self-play engine design
    chess/                 # chess.js rules, Stockfish loader, coach/ (LLM), engine/, hooks/
    catan/                 # Board + UI + engine/ (MCTS in a Web Worker)
    splendor/              # Board + UI + engine/ (maxⁿ MCTS), coach/ (rules chat)
    diplomacy/             # Adjudication engine, engine/ (tactical AI), agents/ (LLM negotiation)
api/                       # Vercel serverless functions (AI moves + bring-your-own-key LLM)
scripts/                   # Self-play, tournaments, continuous-train loops (per game)
training/                  # PyTorch training pipeline -> ONNX export (per game)
public/models/             # Deployed ONNX networks
docs/                      # Per-game and architecture documentation
```

## Tech Stack

React + React Router (code-split), Tailwind CSS, SVG rendering. The AI spans three approaches: self-play neural networks (PyTorch -> ONNX -> onnxruntime-web) for Yinsh and Zertz; hand-written MCTS and maxⁿ search in Web Workers for Catan and Splendor; Stockfish (asm.js) for chess; and an Anthropic-model negotiation layer for Diplomacy. Vercel serverless functions back the bring-your-own-key LLM features. Tests in Jest.

## Documentation

Deeper writeups live in [`docs/`](docs/): [architecture](docs/architecture.md), the [AI engine](docs/ai-engine.md), and per-game notes for [chess](docs/chess.md), [Catan](docs/catan.md), [Splendor](docs/splendor.md), and [Diplomacy](docs/diplomacy.md).

## Credits

Game designs by Kris Burm (GIPF Project: Yinsh, Zertz), Klaus Teuber (Catan), Marc André (Splendor), and Allan B. Calhamer (Diplomacy). Chess play via [Stockfish](https://stockfishchess.org/). Built by Nathan Ramia.

## License

MIT (see [LICENSE](LICENSE)).
