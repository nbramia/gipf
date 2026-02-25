#!/usr/bin/env node
// self-play.mjs — AI vs AI self-play evaluation script.
// Usage: node scripts/self-play.mjs --games 10 --sims 100

// CRA/Jest use Babel transforms for imports; this script uses Node ESM with
// a direct path so we need to handle the module system. We dynamically import
// the source files which are ES modules.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, '..', 'src', 'games', 'yinsh');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultVal;
}

const NUM_GAMES = getArg('games', 10);
const SIMS = getArg('sims', 100);
const MAX_MOVES = 100;

// Dynamically import the ES modules
async function main() {
  // Import source modules
  const { default: YinshBoard } = await import(resolve(srcDir, 'YinshBoard.js'));
  const { default: MCTS } = await import(resolve(srcDir, 'engine', 'mcts.js'));
  const { getAIMove, applyAIMove } = await import(resolve(srcDir, 'engine', 'aiPlayer.js'));

  // Standard ring setup (symmetric, center-weighted)
  const STANDARD_RINGS = {
    1: [[0, -2], [-2, 0], [2, -2], [-1, -1], [1, -1]],
    2: [[0, 2], [2, 0], [-2, 2], [1, 1], [-1, 1]]
  };

  function setupBoard() {
    const board = new YinshBoard({ skipInitialHistory: true });
    for (const player of [1, 2]) {
      for (const [q, r] of STANDARD_RINGS[player]) {
        board.boardState[`${q},${r}`] = { type: 'ring', player };
        board.ringsPlaced[player]++;
      }
    }
    board.gamePhase = 'play';
    board.currentPlayer = 1;
    board._captureState();
    return board;
  }

  console.log(`\nSelf-Play Evaluation`);
  console.log(`Games: ${NUM_GAMES} | Simulations: ${SIMS} | Max moves: ${MAX_MOVES}`);
  console.log('─'.repeat(50));

  const results = { 1: 0, 2: 0, draw: 0 };
  const gameLengths = [];
  const totalStart = performance.now();

  for (let g = 0; g < NUM_GAMES; g++) {
    const board = setupBoard();
    const mcts = new MCTS();
    let moveCount = 0;
    const gameStart = performance.now();

    while (moveCount < MAX_MOVES) {
      const winner = board.isGameOver();
      if (winner) {
        results[winner]++;
        break;
      }

      if (board.getGamePhase() === 'game-over') {
        break;
      }

      const move = await getAIMove(mcts, board, SIMS);
      if (!move) {
        // No legal moves — stalemate or error
        break;
      }

      applyAIMove(board, move);
      moveCount++;
    }

    const gameElapsed = performance.now() - gameStart;
    const winner = board.isGameOver();

    if (moveCount >= MAX_MOVES && !winner) {
      results.draw++;
    }

    gameLengths.push(moveCount);

    const winnerStr = winner ? `P${winner} wins` : 'draw';
    const mps = (moveCount / (gameElapsed / 1000)).toFixed(1);
    console.log(
      `  Game ${g + 1}: ${winnerStr} in ${moveCount} moves (${(gameElapsed / 1000).toFixed(1)}s, ${mps} moves/s)`
    );
  }

  const totalElapsed = (performance.now() - totalStart) / 1000;
  const avgLength = gameLengths.length > 0
    ? (gameLengths.reduce((a, b) => a + b, 0) / gameLengths.length).toFixed(1)
    : 0;
  const totalMoves = gameLengths.reduce((a, b) => a + b, 0);

  console.log('─'.repeat(50));
  console.log(`Results:`);
  console.log(`  P1 (White) wins: ${results[1]}`);
  console.log(`  P2 (Black) wins: ${results[2]}`);
  console.log(`  Draws (${MAX_MOVES}+ moves): ${results.draw}`);
  console.log(`  Avg game length: ${avgLength} moves`);
  console.log(`  Total time: ${totalElapsed.toFixed(1)}s`);
  console.log(`  Total moves: ${totalMoves} (${(totalMoves / totalElapsed).toFixed(1)} moves/s)`);
}

main().catch(err => {
  console.error('Self-play error:', err);
  process.exit(1);
});
