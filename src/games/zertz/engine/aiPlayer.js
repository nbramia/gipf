// AI Player interface for Zertz
// Provides getAIMove and applyAIMove functions

import { applyMove } from './mcts.js';

/**
 * Get the AI's best move for the current board state.
 * @param {MCTS} mcts - MCTS instance
 * @param {ZertzBoard} board - Current board state
 * @param {number} simulations - Number of MCTS simulations
 * @returns {Promise<{move: Object, confidence: number}>}
 */
export async function getAIMove(mcts, board, simulations) {
  const move = await mcts.getBestMove(board, simulations);
  if (!move) return { move: null, confidence: 0 };

  // Confidence based on whether it's a forced move
  const legalMoves = board.getLegalMoves();
  const confidence = legalMoves.length === 1 ? 1.0 : 0.7;

  return { move, confidence };
}

/**
 * Apply an AI move to the board using the proper two-step API.
 * @param {ZertzBoard} board - Board to apply move to
 * @param {Object} move - Move object from MCTS
 */
export function applyAIMove(board, move) {
  applyMove(board, move);
}
