#!/usr/bin/env node

/**
 * Tournament: Heuristic vs NN head-to-head for Zertz.
 *
 * Usage:
 *   node scripts/zertz/tournament.mjs --games 10 --sims 50
 *   node scripts/zertz/tournament.mjs --games 10 --sims 50 --model public/models/zertz-value-v1.onnx
 */

import ZertzBoard from '../../src/games/zertz/ZertzBoard.js';
import { MCTS, applyMove } from '../../src/games/zertz/engine/mcts.js';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const NUM_GAMES = parseInt(getArg('games', '10'), 10);
const SIMS = parseInt(getArg('sims', '100'), 10);
const MODEL_PATH = getArg('model', null);

let valueNetwork = null;

async function loadModel() {
  if (!MODEL_PATH) return;
  try {
    const { ValueNetwork } = await import('../../src/games/zertz/engine/valueNetworkNode.js');
    valueNetwork = new ValueNetwork();
    await valueNetwork.load(MODEL_PATH);
    console.log(`Loaded NN model: ${MODEL_PATH}`);
  } catch (e) {
    console.warn(`Failed to load model: ${e.message}`);
    console.log('Running heuristic vs heuristic instead');
  }
}

async function playGame(gameNum, nnPlaysAs) {
  const board = new ZertzBoard({ skipInitialHistory: true });
  const heuristicMcts = new MCTS({ evaluationMode: 'heuristic' });
  const nnMcts = valueNetwork
    ? new MCTS({ evaluationMode: 'nn', valueNetwork })
    : new MCTS({ evaluationMode: 'heuristic' }); // fallback

  let moveCount = 0;

  while (board.gamePhase !== 'game-over' && moveCount < 200) {
    const isNnTurn = board.currentPlayer === nnPlaysAs;
    const mcts = isNnTurn ? nnMcts : heuristicMcts;

    const move = await mcts.getBestMove(board, SIMS);
    if (!move) break;

    applyMove(board, move);
    moveCount++;
  }

  return { winner: board.winner, moves: moveCount };
}

async function main() {
  await loadModel();

  const results = { nn: 0, heuristic: 0, draw: 0 };
  const startTime = Date.now();

  console.log(`\nTournament: ${NUM_GAMES} games, ${SIMS} sims/move`);
  console.log(`NN: ${valueNetwork ? 'loaded' : 'heuristic (no model)'}`);
  console.log('---');

  for (let i = 0; i < NUM_GAMES; i++) {
    // Alternate which player the NN controls
    const nnPlaysAs = (i % 2) + 1;
    const { winner, moves } = await playGame(i, nnPlaysAs);

    let result;
    if (winner === null) {
      results.draw++;
      result = 'draw';
    } else if (winner === nnPlaysAs) {
      results.nn++;
      result = 'NN wins';
    } else {
      results.heuristic++;
      result = 'Heuristic wins';
    }

    console.log(`  Game ${i + 1}: NN=P${nnPlaysAs}, ${result} (${moves} moves)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('---');
  console.log(`Results: NN=${results.nn}, Heuristic=${results.heuristic}, Draws=${results.draw}`);
  console.log(`Time: ${elapsed}s`);

  // Exit code: 0 if NN wins majority, 1 otherwise
  // Also fail if no model was loaded (heuristic vs heuristic is meaningless)
  if (!valueNetwork) {
    console.log('FAIL: No NN model loaded — cannot evaluate.');
    process.exit(1);
  }
  if (results.nn > results.heuristic) {
    console.log('RESULT: NN wins the tournament.');
    process.exit(0);
  } else {
    console.log('RESULT: Heuristic wins or tied — NN not promoted.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
