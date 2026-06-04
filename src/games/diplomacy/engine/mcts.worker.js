// Web Worker for Diplomacy AI order computation.
//
// Named mcts.worker.js for parity with the other games even though Diplomacy is
// simultaneous-move and uses best-response search rather than turn-based MCTS.
// It deserializes the board, runs getOrders/getRetreats/getAdjustments for the
// requested power(s) -- looping internally so all AI powers resolve in one
// request -- and posts the per-power fragments keyed by power.

import DiplomacyBoard from '../DiplomacyBoard.js';
import { getOrders, getRetreats, getAdjustments } from './aiPlayer.js';

self.onmessage = async function (event) {
  const { type, data } = event.data || {};
  if (type !== 'compute') return;

  try {
    const { boardState, powers, options } = data;
    const board = DiplomacyBoard.fromSerializedState(boardState);
    const list = Array.isArray(powers) ? powers : [powers];

    const result = {};
    let phaseKind = null;
    for (const power of list) {
      if (board.isOrdersPhase()) {
        const { orders } = await getOrders(board, power, options);
        result[power] = orders;
        phaseKind = 'orders';
      } else if (board.isRetreatPhase()) {
        const { retreats } = await getRetreats(board, power, options);
        result[power] = retreats;
        phaseKind = 'retreats';
      } else if (board.isWinterPhase()) {
        const { adjustments } = await getAdjustments(board, power, options);
        result[power] = adjustments;
        phaseKind = 'adjustments';
      } else {
        result[power] = [];
      }
    }

    self.postMessage({
      type: 'result',
      success: true,
      data: { phase: phaseKind, byPower: result },
      stats: { powers: list, phase: board.phase },
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
