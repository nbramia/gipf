// Web Worker that deals the next Ricochet round off the main thread.

import RicochetBoard from '../RicochetBoard.js';
import { chooseNextRound } from './rounds.js';

// Per-target solve limit: a slow device skips a hard target instead of stalling the deal.
const TARGET_TIME_LIMIT_MS = 400;

globalThis.onmessage = function (event) {
  const { type, requestId, data } = event.data;
  if (type !== 'next') return;
  try {
    const board = RicochetBoard.fromSerializedState(data.boardState);
    const round = chooseNextRound(board, data.desiredLength, { timeLimitMs: data.timeLimitMs ?? TARGET_TIME_LIMIT_MS });
    globalThis.postMessage({ type: 'result', requestId, data: { round } });
  } catch (error) {
    globalThis.postMessage({ type: 'error', requestId, error: error.message });
  }
};
