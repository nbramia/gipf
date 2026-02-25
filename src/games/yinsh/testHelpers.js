// testHelpers.js
// Shared test utilities for Yinsh game testing

import YinshBoard from './YinshBoard.js';

/**
 * Create an empty board with no setup
 */
export function createEmptyBoard() {
  return new YinshBoard();
}

/**
 * Create a board with rings already placed in setup phase
 * @param {Array<{player: number, positions: Array<[number, number]>}>} ringConfig
 * @returns {YinshBoard}
 */
export function createBoardWithSetup(ringConfig) {
  const board = new YinshBoard({ skipInitialHistory: true });
  ringConfig.forEach(({ player, positions }) => {
    positions.forEach(([q, r]) => {
      const key = board._toKey(q, r);
      board.boardState[key] = { type: 'ring', player };
      board.ringsPlaced[player] = (board.ringsPlaced[player] || 0) + 1;
    });
  });

  // If both players have 5 rings, transition to play
  if (board.ringsPlaced[1] === YinshBoard.RINGS_PER_PLAYER &&
      board.ringsPlaced[2] === YinshBoard.RINGS_PER_PLAYER) {
    board.gamePhase = 'play';
    board.currentPlayer = 1;
  }

  // Capture the setup state as the initial history
  board._captureState();

  return board;
}

/**
 * Create a board with arbitrary pieces
 * @param {Array<{q: number, r: number, type: string, player: number}>} pieces
 * @returns {YinshBoard}
 */
export function createBoardWithPieces(pieces) {
  const board = new YinshBoard();
  pieces.forEach(({ q, r, type, player }) => {
    const key = board._toKey(q, r);
    board.boardState[key] = { type, player };
    if (type === 'ring') {
      board.ringsPlaced[player] = (board.ringsPlaced[player] || 0) + 1;
    }
  });
  return board;
}

/**
 * Place rings on an existing board
 * @param {YinshBoard} board
 * @param {Array<{player: number, positions: Array<[number, number]>}>} ringConfig
 */
export function placeRings(board, ringConfig) {
  ringConfig.forEach(({ player, positions }) => {
    positions.forEach(([q, r]) => {
      const key = board._toKey(q, r);
      board.boardState[key] = { type: 'ring', player };
      board.ringsPlaced[player] = (board.ringsPlaced[player] || 0) + 1;
    });
  });
}

/**
 * Place markers on an existing board
 * @param {YinshBoard} board
 * @param {Array<[number, number]>} positions
 * @param {number} player
 */
export function placeMarkers(board, positions, player) {
  positions.forEach(([q, r]) => {
    const key = board._toKey(q, r);
    board.boardState[key] = { type: 'marker', player };
  });
}

/**
 * Simulate a move on the board
 * @param {YinshBoard} board
 * @param {[number, number]} from - Starting position
 * @param {[number, number]} to - Ending position
 * @returns {boolean} - Whether the move was successful
 */
export function simulateMove(board, from, to) {
  const [q1, r1] = from;
  const [q2, r2] = to;

  // Select the ring
  board.handleClick(q1, r1);

  // Check if ring was selected
  if (!board.selectedRing) {
    return false;
  }

  // Try to move to destination
  board.handleClick(q2, r2);

  return true;
}

/**
 * Create a scenario with a completed row
 * @param {number} player - Player who owns the row
 * @param {[number, number]} startPos - Starting position
 * @param {[number, number]} direction - Direction vector [dq, dr]
 * @param {number} length - Length of the row (minimum 5)
 * @returns {YinshBoard}
 */
export function createRowScenario(player, startPos, direction, length = 5) {
  const board = new YinshBoard();
  board.gamePhase = 'play'; // Skip setup

  const [startQ, startR] = startPos;
  const [dq, dr] = direction;

  // Create the row of markers
  const markers = [];
  for (let i = 0; i < length; i++) {
    const q = startQ + (i * dq);
    const r = startR + (i * dr);
    markers.push([q, r]);
  }

  placeMarkers(board, markers, player);

  // Add a few rings for context (at positions that won't overlap with markers)
  placeRings(board, [
    { player: 1, positions: [[-1, -1], [-2, -2]] },
    { player: 2, positions: [[2, 3], [3, 3]] }
  ]);

  return board;
}

/**
 * Verify board state matches expected configuration
 * @param {YinshBoard} board
 * @param {Object} expected
 * @param {number} [expected.phase] - Expected game phase
 * @param {number} [expected.currentPlayer] - Expected current player
 * @param {Object} [expected.scores] - Expected scores {1: X, 2: Y}
 * @param {Object} [expected.ringsPlaced] - Expected rings placed {1: X, 2: Y}
 * @param {number} [expected.pieceCount] - Expected total pieces on board
 */
export function verifyBoardState(board, expected) {
  const errors = [];

  if (expected.phase !== undefined && board.gamePhase !== expected.phase) {
    errors.push(`Expected phase '${expected.phase}', got '${board.gamePhase}'`);
  }

  if (expected.currentPlayer !== undefined && board.currentPlayer !== expected.currentPlayer) {
    errors.push(`Expected current player ${expected.currentPlayer}, got ${board.currentPlayer}`);
  }

  if (expected.scores) {
    if (board.scores[1] !== expected.scores[1]) {
      errors.push(`Expected player 1 score ${expected.scores[1]}, got ${board.scores[1]}`);
    }
    if (board.scores[2] !== expected.scores[2]) {
      errors.push(`Expected player 2 score ${expected.scores[2]}, got ${board.scores[2]}`);
    }
  }

  if (expected.ringsPlaced) {
    if (board.ringsPlaced[1] !== expected.ringsPlaced[1]) {
      errors.push(`Expected player 1 rings placed ${expected.ringsPlaced[1]}, got ${board.ringsPlaced[1]}`);
    }
    if (board.ringsPlaced[2] !== expected.ringsPlaced[2]) {
      errors.push(`Expected player 2 rings placed ${expected.ringsPlaced[2]}, got ${board.ringsPlaced[2]}`);
    }
  }

  if (expected.pieceCount !== undefined) {
    const actualCount = Object.keys(board.boardState).length;
    if (actualCount !== expected.pieceCount) {
      errors.push(`Expected ${expected.pieceCount} pieces on board, got ${actualCount}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Board state verification failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Count pieces of a specific type and player
 * @param {YinshBoard} board
 * @param {string} type - 'ring' or 'marker'
 * @param {number} [player] - Optional player filter
 * @returns {number}
 */
export function countPieces(board, type, player = null) {
  return Object.values(board.boardState).filter(piece => {
    if (piece.type !== type) return false;
    if (player !== null && piece.player !== player) return false;
    return true;
  }).length;
}

/**
 * Get all pieces of a specific type
 * @param {YinshBoard} board
 * @param {string} type - 'ring' or 'marker'
 * @param {number} [player] - Optional player filter
 * @returns {Array<{q: number, r: number, player: number}>}
 */
export function getPieces(board, type, player = null) {
  const pieces = [];
  for (const [key, piece] of Object.entries(board.boardState)) {
    if (piece.type === type && (player === null || piece.player === player)) {
      const [q, r] = board._fromKey(key);
      pieces.push({ q, r, player: piece.player });
    }
  }
  return pieces;
}

/**
 * Check if a position is occupied
 * @param {YinshBoard} board
 * @param {number} q
 * @param {number} r
 * @returns {boolean}
 */
export function isOccupied(board, q, r) {
  const key = board._toKey(q, r);
  return !!board.boardState[key];
}

/**
 * Get piece at position
 * @param {YinshBoard} board
 * @param {number} q
 * @param {number} r
 * @returns {Object|null}
 */
export function getPieceAt(board, q, r) {
  const key = board._toKey(q, r);
  return board.boardState[key] || null;
}

/**
 * Create a complex board state for testing multiple rows
 * @returns {YinshBoard}
 */
export function createComplexRowScenario() {
  const board = new YinshBoard();
  board.gamePhase = 'play';

  // Create two intersecting rows for player 1
  // Horizontal row at r=0
  placeMarkers(board, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 1);

  // Diagonal row through [2, 0]
  placeMarkers(board, [[2, -2], [2, -1], [2, 1], [2, 2]], 1);

  // Add some rings
  placeRings(board, [
    { player: 1, positions: [[-1, -1], [-2, -2]] },
    { player: 2, positions: [[5, 5], [4, 4]] }
  ]);

  return board;
}
