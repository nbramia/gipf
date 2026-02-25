// aiPlayer.js
// Shared AI move logic for YinshGame and self-play script.
// Pure game logic — no React, no UI state.

/**
 * Get AI move for current board state. Wraps getBestMove and normalizes result.
 * @param {MCTS} mcts - MCTS engine instance
 * @param {YinshBoard} board - Current board state
 * @param {number} simulations - Number of MCTS simulations
 * @returns {Object|null} { from, to, type, row, rootNode } or null
 */
export async function getAIMove(mcts, board, simulations) {
  const result = await mcts.getBestMove(board, simulations);
  if (!result) return null;

  return {
    from: result.move || null,
    to: result.destination || null,
    type: result.type || 'move',
    row: result.row || null,
    rootNode: result.rootNode || null
  };
}

/**
 * Apply an AI move to the board. Handles all phases (play, remove-row, remove-ring, setup).
 * Pure game logic — no React, no UI state.
 * @param {YinshBoard} board - Board to mutate
 * @param {Object} move - { from, to, type, row }
 * @returns {Object} { flipped: [[q,r],...] } — metadata about the move for UI use
 */
export function applyAIMove(board, move) {
  const { from, to, type, row } = move;
  let flipped = [];

  if (type === 'remove-row') {
    // Click one marker in the row — handleClick removes the entire matching row
    if (row && row.length > 0) {
      board.handleClick(row[0][0], row[0][1]);
    }
  } else if (type === 'remove-ring') {
    board.handleClick(from[0], from[1]);
  } else if (type === 'place-ring' || board.getGamePhase() === 'setup') {
    // Setup phase: select a ring, then place it
    const currentPlayer = board.getCurrentPlayer();
    const ringsPlaced = board.getRingsPlaced();
    const ringIndex = ringsPlaced[currentPlayer] || 0;
    board.handleSetupRingClick(currentPlayer, ringIndex);
    board.handleClick(to[0], to[1]);
  } else {
    // Regular move (play phase)
    // Capture flipped marker positions before the move executes
    const boardState = board.getBoardState();
    const dq = Math.sign(to[0] - from[0]);
    const dr = Math.sign(to[1] - from[1]);
    let pq = from[0] + dq, pr = from[1] + dr;
    while (pq !== to[0] || pr !== to[1]) {
      const piece = boardState[`${pq},${pr}`];
      if (piece?.type === 'marker') {
        flipped.push([pq, pr]);
      }
      pq += dq;
      pr += dr;
    }

    board.handleClick(from[0], from[1]);
    board.handleClick(to[0], to[1]);
  }

  return { flipped };
}
