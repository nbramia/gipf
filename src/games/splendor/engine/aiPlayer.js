// AI Player interface for Splendor.

import { applyMove } from './mcts.js';

async function getAIMove(mcts, board, simulations) {
  const move = await mcts.getBestMove(board, simulations);
  if (!move) return { move: null, confidence: 0 };
  const legalMoves = board.getLegalMoves();
  return {
    move,
    confidence: legalMoves.length === 1 ? 1 : 0.72,
  };
}

function applyAIMove(board, move) {
  return applyMove(board, move);
}

export { getAIMove, applyAIMove };
