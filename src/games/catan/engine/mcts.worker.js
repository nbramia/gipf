// Web Worker for Catan MCTS computation.

import CatanBoard from '../CatanBoard.js';
import { MCTS } from './mcts.js';

self.onmessage = async function (event) {
  const { type, data } = event.data;
  if (type !== 'compute') return;

  try {
    const { boardState, simulations, maxChildren, rolloutSteps } = data;
    const board = CatanBoard.fromSerializedState(boardState);
    // rollout-leaf keeps the heuristic tree clearly stronger than the old bandit
    // (NN evaluator drops in here later via a model URL).
    const mcts = new MCTS({ maxChildren, rolloutSteps: rolloutSteps ?? 16 });
    const move = await mcts.getBestMove(board, simulations);

    self.postMessage({
      type: 'result',
      success: true,
      data: { move },
      stats: {
        simulations,
        phase: board.phase,
        player: board.currentPlayer,
      },
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
};
