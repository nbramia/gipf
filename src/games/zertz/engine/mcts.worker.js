// Web Worker for Zertz MCTS computation
// Runs MCTS search off the main thread

import ZertzBoard from '../ZertzBoard.js';
import { MCTS } from './mcts.js';

// Cache for loaded value networks
const loadedModels = new Map();

async function getValueNetwork(modelPath) {
  if (!modelPath) return null;
  if (loadedModels.has(modelPath)) return loadedModels.get(modelPath);

  try {
    const { ValueNetwork } = await import('./valueNetwork.js');
    const vn = new ValueNetwork();
    await vn.load(modelPath);
    loadedModels.set(modelPath, vn);
    return vn;
  } catch (e) {
    console.warn('Failed to load value network:', e.message);
    return null;
  }
}

self.onmessage = async function (e) {
  const { type, data } = e.data;

  if (type !== 'compute') return;

  try {
    const { boardState, simulations, evaluationMode, modelPath } = data;

    // Reconstruct board from serialized state
    const board = ZertzBoard.fromSerializedState(boardState);

    // Load value network if needed
    let valueNetwork = null;
    if (evaluationMode === 'nn' && modelPath) {
      valueNetwork = await getValueNetwork(modelPath);
    }

    // Create MCTS instance and find best move
    const mcts = new MCTS({
      evaluationMode: valueNetwork ? evaluationMode : 'heuristic',
      valueNetwork,
    });

    const move = await mcts.getBestMove(board, simulations);

    self.postMessage({
      type: 'result',
      data: { move },
      success: true,
      stats: {
        simulations,
        phase: board.gamePhase,
        evaluationMode: valueNetwork ? evaluationMode : 'heuristic',
      },
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err.message,
      stack: err.stack,
      success: false,
    });
  }
};
