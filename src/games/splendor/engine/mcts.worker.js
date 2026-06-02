// Web Worker for Splendor MCTS computation.

import SplendorBoard from '../SplendorBoard.js';
import { MCTS } from './mcts.js';

self.onmessage = async function (event) {
  const { type, data } = event.data;
  if (type !== 'compute') return;

  try {
    const { boardState, simulations, maxChildren, rolloutSteps } = data;
    const board = SplendorBoard.fromSerializedState(boardState);
    const mcts = new MCTS({ maxChildren, rolloutSteps: rolloutSteps ?? 28 });
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
