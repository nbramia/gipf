# Play

Browser-based implementations of abstract strategy and classic board games, each with its own computer opponent. Play against the AI or another person, with full rule enforcement, undo/redo, and dark mode.

**[Play Now](https://play.ramia.us)** -- the author's hosted instance. This repository is the complete source; you can run it locally or deploy your own copy.

## Games

### Yinsh

Players compete using rings and markers on a hexagonal board. Place a marker in one of your rings, move the ring in a straight line, and flip any markers along the path. Form a row of 5 to score -- first to 3 points wins.

The opponent is a Monte Carlo tree search that can run on hand-written heuristics or be guided by a small trained neural network running in the browser. Includes chess-style move notation and difficulty settings. See [How the AI works](#how-the-ai-works) below.

### Zertz

Capture marbles by jumping over them on a shrinking hex board. On a turn, capture if a jump is available; otherwise place a marble and remove a free ring. Win by collecting sets of marbles (4 white, 5 grey, 6 black, or 3 of each).

Uses its own Monte Carlo search engine and neural network: Expert requests the trained model, while Easy and Advanced use heuristic search. Two-player mode, full undo/redo, and dark mode.

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

**Self-play neural networks (Yinsh, Zertz).** Each game has an independent Monte Carlo search engine and PyTorch training pipeline. Networks provide position values and, when available, destination-policy priors. Browser inference runs through ONNX Runtime Web in a Web Worker; failed model loading produces a visible heuristic-fallback notice. Request IDs and board versions prevent cancelled or stale AI responses from changing a newer position.

Offline training splits positions by source game before applying six rotations to training data; validation stays unaugmented. Historical data without game IDs uses a documented duplicate-position fallback that cannot reconstruct game boundaries. Candidates face an explicit incumbent before promotion: Yinsh's continuous loop uses a sequential probability ratio test, while Zertz requires wins in more than half of a fixed, alternating-side match. These gates are checks, not strength guarantees. See [AI engine documentation](docs/ai-engine.md) for compatibility, bootstrap, and training details.

**Classical search (Catan, Splendor, Chess).** Catan and Splendor use tree search with hand-written position evaluation rather than a trained network, running in Web Workers. Splendor plays a genuine multi-player maxⁿ search and handles hidden information fairly by re-sampling the parts of the state a player could not actually see. (A self-play network was trained for Splendor as an experiment; it did not beat the heuristic, so the heuristic is what ships.) Chess delegates to Stockfish rather than a hand-rolled engine, with one workaround worth noting: Stockfish's built-in strength limiter does not go below 1320 Elo, so beneath that the code searches at full strength and samples a deliberately weaker move from within a bounded evaluation window.

**Language-model negotiation (Diplomacy).** The six AI powers converse and negotiate through an Anthropic model, but the model only supplies dialogue and a self-reported (and deliberately distrusted) sense of who it likes. The decisions are cold, tested code: a trust ledger scores kept and broken promises against what each power actually ordered, a betrayal model weighs the tactical payoff of breaking a deal against its reputation cost, and honored deals are force-bound into legal support orders so talk and action stay consistent. A deal becomes binding only when the model emits it as a structured field, so free-form chat can never silently commit a power. Hidden AI-to-AI negotiation runs on a cheaper model than the human-facing replies to keep cost down.

## Quick Start

```bash
git clone https://github.com/nbramia/play.git
cd play
npm install
npm start
```

Opens at `http://localhost:3000` with a landing page. Navigate to `/yinsh`, `/zertz`, `/chess`, `/catan`, `/splendor`, or `/diplomacy`. Every game plays fully in the browser with no configuration and no account.

The bring-your-own-key features (the chess coach, the Catan and Splendor rules chat, and Diplomacy negotiation) call Anthropic through Vercel serverless functions, so they only work on a deployment or under `vercel dev`, not plain `npm start`. As a guest your key stays on your device. An optional account (sign-in at `/login`) stores the key encrypted on the server and syncs progress across devices.

## Development

```bash
npm start                 # Dev server with hot reload
CI=true npm test          # Run the full test suite
npm run test:engine       # Yinsh MCTS engine tests
npm run build             # Production build
```

**Training the self-play AI** (Yinsh; Zertz mirrors it under `scripts/zertz/`, Catan and Splendor under `scripts/catan/` and `scripts/splendor/`):

```bash
npm run generate-data -- --games 50     # Generate labeled self-play data
npm run train-iteration -- 14 50 200    # Example: candidate v14, 50 games, 200 sims
./scripts/continuous-train.sh           # Autonomous loop with gated auto-promotion
```

## Deploying your own copy

The app is a Create React App build plus Vercel serverless functions in `api/` (`vercel.json` holds the routing). Import the repository into Vercel, or run `vercel dev` locally, and it serves every game with no further setup.

Accounts are optional and need three things, all configured through environment variables (nothing deployment-specific is committed):

- **An OpenID Connect provider (Auth0).** Create a Regular Web Application whose only allowed callback is `https://<your host>/api/auth/callback`, and set `AUTH0_ISSUER_BASE_URL`, `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET`.
- **A Redis REST store** (Upstash or Vercel KV): `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
- **Two generated secrets:** `GAMES_SESSION_SECRET` (32+ characters) and `GAMES_KEY_ENCRYPTION_KEY` (base64 of 32 random bytes; `GAMES_KEY_ENCRYPTION_KEY_VERSION` and `scripts/rotate-games-keys.mjs` handle rotation).

Then set the production origin in two constants, `PRODUCTION_ORIGIN` in `server/session.js` and `SILENT_HOST` in `src/silentSignIn.js`, to your host. Each missing piece fails closed: sign-in reports itself unavailable or the account endpoints return 503, and guest play keeps working. See [AGENTS.md](AGENTS.md#deployment-and-ramiaus) for the full contract and [accounts](docs/public-accounts.md) for how sessions, key custody and sync work.

For the author's instance, `main` is the release branch: merging to `main` deploys play.ramia.us. There is no CI gate, so the full test suite and build must pass before merging.

## Project Structure

```
src/
  App.jsx                  # Router: lazy-loads each game
  LandingPage.jsx          # Game catalogue + link to /login
  LoginPage.jsx            # /login: sign in/out, account, Anthropic key and Lichess token
  landing.css              # Scoped catalogue and optional account styles
  index.css                # Shared Tailwind directives
  games/
    yinsh/                 # Game logic, React UI, engine/ (MCTS + NN), CSS, tests
    zertz/                 # Independent board, MCTS + NN, features, hooks, and tests
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

Deeper writeups live in [`docs/`](docs/): [architecture](docs/architecture.md), the [AI engine](docs/ai-engine.md), [accounts](docs/public-accounts.md), and per-game notes for [chess](docs/chess.md), [Catan](docs/catan.md), [Splendor](docs/splendor.md), and [Diplomacy](docs/diplomacy.md). Instructions for AI coding agents working in this repo are in [AGENTS.md](AGENTS.md).

Current matches in Chess, Yinsh, Zertz, and Catan resume locally after refresh.
Signing in also enables cloud matches, preferences and existing statistics, with
explicit conflict choices and recoverable alternatives. See
[resumable matches](docs/resumable-matches.md) for formats, recovery and limits.

## Credits

Game designs by Kris Burm (GIPF Project: Yinsh, Zertz), Klaus Teuber (Catan), Marc André (Splendor), and Allan B. Calhamer (Diplomacy). Chess play via [Stockfish](https://stockfishchess.org/). Built by Nathan Ramia.

## License

MIT (see [LICENSE](LICENSE)).
