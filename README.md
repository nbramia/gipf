# GIPF Project

Browser-based implementations of abstract strategy board games from the [GIPF Project](https://en.wikipedia.org/wiki/GIPF_project) series. Play against AI or another human, with full rule enforcement, undo/redo, and dark mode.

**[Play Now](https://gipf.vercel.app)**

## Games

### Yinsh

Players compete using rings and markers on a hexagonal board. Place a marker in one of your rings, move the ring in a straight line, and flip any markers along the path. Form a row of 5 to score -- first to 3 points wins.

Features a trained neural network AI opponent (MCTS + ONNX value network), move notation, and difficulty settings.

### Zertz

Capture marbles by jumping over them on a shrinking hex board. After placing a marble and removing an edge ring, check for forced jumps. Win by collecting sets of marbles (4 white, 5 grey, 6 black, or 3 of each).

Two-player game with full undo/redo and dark mode.

## Quick Start

```bash
git clone https://github.com/nbramia/gipf.git
cd gipf
npm install
npm start
```

Opens at `http://localhost:3000` with a landing page. Navigate to `/yinsh` or `/zertz`.

## Development

```bash
npm start                 # Dev server with hot reload
CI=true npm test          # Run full test suite (305 tests)
npm run test:engine       # Yinsh MCTS engine tests
npm run build             # Production build
```

**Deployment:** Vercel auto-deploys on push to `main`. There is no CI gate -- tests must pass locally before pushing.

## Project Structure

```
src/
  App.jsx                  # Router — lazy-loads game components
  LandingPage.jsx          # Landing page with game links
  index.css                # Shared Tailwind directives
  games/
    yinsh/
      YinshBoard.js        # Game logic (no React)
      YinshGame.jsx        # React UI + SVG board
      YinshNotation.js     # Chess-style move notation
      yinsh.css            # Scoped CSS variables + animations
      engine/
        mcts.js            # MCTS AI (heuristic + NN evaluation)
        features.js        # Board state -> NN input features
        valueNetwork.js    # Browser ONNX inference (onnxruntime-web)
        valueNetworkNode.js # Node.js ONNX inference (onnxruntime-node)
        aiPlayer.js        # Shared AI move interface
      hooks/
        useAIWorker.js     # React hook for MCTS Web Worker
    zertz/
      ZertzBoard.js        # Game logic (no React)
      ZertzGame.jsx        # React UI + SVG board
      zertz.css            # Scoped CSS variables + animations
api/
  aiMove.js                # Vercel serverless function (Yinsh AI)
scripts/                   # Training data generation, tournaments
training/                  # PyTorch training pipeline -> ONNX export
public/models/             # ONNX neural network models
docs/                      # Technical documentation
```

## Tech Stack

React 18 + React Router 6 (code-split), Tailwind CSS, SVG rendering, custom MCTS engine with neural network value estimation (PyTorch -> ONNX -> onnxruntime-web), Vercel serverless functions, Jest.

## Credits

Game designs by Kris Burm (GIPF Project). Built by Nathan Ramia.

## License

MIT
