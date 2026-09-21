// Existing API search policy, isolated so even a stuck iteration can be terminated.
import { parentPort, workerData } from 'node:worker_threads';
import MCTS from '../src/games/yinsh/engine/mcts.js';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
const MAX_TIME_MS = 2500;
const MIN_SIMULATIONS = 30;
const CONFIDENCE_THRESHOLD = 0.75;
const boardClonePool = new WeakMap();
const startTime = Date.now();
const board = new YinshBoard();
board.deserialize(workerData);
const mcts = new MCTS();
let result = null;
let simulationCount = 0;

// Dynamic simulation count based on board complexity
const complexity = board.getComplexityLevel?.() || 1;
const MAX_SIMULATIONS = Math.min(500, Math.max(100, complexity * 50));

while (simulationCount < MAX_SIMULATIONS) {
  const currentTime = Date.now() - startTime;
  if (simulationCount >= MIN_SIMULATIONS && currentTime > MAX_TIME_MS) {
    console.log(`Time limit reached after ${currentTime}ms`);
    break;
  }

  // Get cached clone or create new one
  let boardClone = boardClonePool.get(board);
  if (!boardClone) {
    boardClone = board.clone();
    boardClonePool.set(board, boardClone);
  }

  const iterationResult = mcts.runIteration(boardClone);
  if (!iterationResult) break;

  simulationCount++;

  // Update best result
  if (!result || iterationResult.confidence > result.confidence) {
    result = iterationResult;

    // Exit early if we find a very good move
    if (result.confidence >= CONFIDENCE_THRESHOLD) {
      console.log('High-confidence move found, exiting early');
      break;
    }
  }

  if (simulationCount % 10 === 0) {
    console.log(`${simulationCount} simulations, confidence: ${result?.confidence}`);
  }
}

// Fallback to simple heuristic if no good move found
if (!result || result.confidence < 0.3) {
  console.log('Using fallback move selection');
  result = mcts.getFallbackMove(board);
}

parentPort.postMessage(result);
