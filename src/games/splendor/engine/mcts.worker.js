// Web Worker for Splendor MCTS computation.

import SplendorBoard from '../SplendorBoard.js';
import { MCTS } from './mcts.js';

self.onmessage = async function (event) {
  const { type, data } = event.data;
  if (type !== 'compute') return;

  let requestId;
  try {
    const { boardState, simulations, maxChildren, rolloutSteps } = data;
    requestId = data.requestId;
    const board = SplendorBoard.fromSerializedState(boardState);
    const mcts = new MCTS({ maxChildren, rolloutSteps: rolloutSteps ?? 28 });
    const move = await mcts.getBestMove(board, simulations);

    self.postMessage({
      type: 'result',
      success: true,
      requestId,
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
      requestId,
      error: error.message,
      stack: error.stack,
    });
  }
};
