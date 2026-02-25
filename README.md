# Yinsh

A browser-based implementation of [Yinsh](https://en.wikipedia.org/wiki/YINSH), the abstract strategy board game from the GIPF Project series. Play against an AI opponent powered by Monte Carlo Tree Search with optional neural network position evaluation, full rule enforcement, undo/redo, move notation, and dark mode.

**[Play Now](https://yinsh-nathan-ramias-projects.vercel.app)**

## How to Play

Yinsh is a two-player game on a hexagonal board. Players compete using rings and markers to form rows of five.

**Setup:** Players alternate placing 5 rings each on the board.

**On your turn:**
1. Place a marker inside one of your rings
2. Move that ring in a straight line to an empty intersection
3. Any markers the ring jumps over are flipped to the opponent's color

**Scoring:** When you form a row of 5 consecutive markers in your color, remove those markers and sacrifice one of your rings. **First player to sacrifice 3 rings wins.**

The twist: every move flips markers along the path, so the board state is constantly shifting. Rows can appear and disappear for both players.

## Features

- **Complete rule implementation** including queue-based multi-row resolution and opponent row handling
- **AI opponent** powered by Monte Carlo Tree Search with two evaluation modes: hand-crafted heuristics (default) or a trained neural network value estimator (toggle in Settings)
- **Undo/redo** with full state history (Ctrl+Z / Ctrl+Y)
- **Move notation** in a chess-inspired format with game log export
- **Dark mode**, score tracking, move indicators, and mobile-responsive design

## Quick Start

```bash
git clone https://github.com/nbramia/yinsh.git
cd yinsh
npm install
npm start
```

Opens at `http://localhost:3000`.

## Development

```bash
npm start                 # Dev server with hot reload
CI=true npm test          # Run test suite (84 tests)
npm run test:engine       # MCTS engine tests
npm run build             # Production build
```

**Deployment:** Vercel auto-deploys on push to `main`. There is no CI gate -- tests must pass locally before pushing.

```bash
./pre-deploy-checklist.sh   # Automated pre-deploy verification
```

## Project Structure

```
src/
  YinshBoard.js           # Game logic -- rules, state, phases (no React)
  YinshGame.jsx           # React UI -- SVG board, modals, interaction
  YinshNotation.js        # Chess-style move notation system
  engine/
    mcts.js               # MCTS AI engine (heuristic + NN evaluation modes)
    features.js           # Board state → neural network input features
    valueNetwork.js       # Browser ONNX inference (onnxruntime-web)
    valueNetworkNode.js   # Node.js ONNX inference (onnxruntime-node)
    aiPlayer.js           # Shared AI move interface
scripts/
  generate-training-data.mjs  # Self-play → labeled NDJSON training data
  tournament.mjs              # Heuristic vs NN head-to-head comparison
training/
  model.py, train.py, ...     # PyTorch training pipeline → ONNX export
public/models/
  yinsh-value-v1.onnx         # Deployed value network model
api/
  aiMove.js               # Vercel serverless function for AI
docs/
  architecture.md         # Codebase architecture and design
  ai-engine.md            # AI system internals
  notation.md             # Move notation specification
```

See [docs/](docs/) for detailed technical documentation.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Ensure all 84 tests pass (`CI=true npm test`) and the build succeeds (`npm run build`)
4. Submit a pull request

## Tech Stack

React 18, Tailwind CSS, SVG rendering, custom MCTS engine with neural network value estimation (PyTorch → ONNX → onnxruntime-web), Vercel serverless functions, Jest.

## Credits

Game design by Kris Burm (GIPF Project). Built by Nathan Ramia.

## License

MIT
