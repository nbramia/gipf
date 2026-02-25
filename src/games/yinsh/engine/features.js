// features.js — Extract neural network input features from a YinshBoard.
// Shared between training data generation (Node) and browser inference.
//
// Output format:
//   board: Float32Array(4 * 11 * 11 = 484)  — 4 feature planes
//   meta:  Float32Array(5)                   — scalar metadata
//
// Feature planes (each 11x11, index = plane * 121 + (r+5) * 11 + (q+5)):
//   0: Current player's rings   (1.0 where present, 0.0 elsewhere)
//   1: Current player's markers
//   2: Opponent's rings
//   3: Opponent's markers
//
// Metadata scalars:
//   0: currentPlayerScore / 3
//   1: opponentScore / 3
//   2: currentPlayerRings / 5  (rings remaining on board)
//   3: opponentRings / 5
//   4: phase encoding (play=0, remove-row=0.5, remove-ring=1.0)

const GRID_SIZE = 11;
const PLANE_SIZE = GRID_SIZE * GRID_SIZE; // 121
const NUM_PLANES = 4;
const NUM_META = 5;

export const BOARD_FEATURES = NUM_PLANES * PLANE_SIZE; // 484
export const META_FEATURES = NUM_META;                  // 5
export const TOTAL_FEATURES = BOARD_FEATURES + META_FEATURES; // 489

/**
 * Extract NN input features from a YinshBoard instance.
 * @param {YinshBoard} board
 * @returns {{ board: Float32Array, meta: Float32Array }}
 */
export function extractFeatures(board) {
  const boardData = new Float32Array(BOARD_FEATURES);
  const meta = new Float32Array(NUM_META);

  const currentPlayer = board.getCurrentPlayer();
  const opponent = currentPlayer === 1 ? 2 : 1;
  const boardState = board.getBoardState();

  // Fill feature planes from board state
  for (const [coord, piece] of Object.entries(boardState)) {
    const [q, r] = coord.split(',').map(Number);
    const x = q + 5; // Map -5..5 to 0..10
    const y = r + 5;

    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) continue;

    const idx = y * GRID_SIZE + x;
    const isCurrentPlayer = piece.player === currentPlayer;

    if (piece.type === 'ring') {
      boardData[(isCurrentPlayer ? 0 : 2) * PLANE_SIZE + idx] = 1.0;
    } else if (piece.type === 'marker') {
      boardData[(isCurrentPlayer ? 1 : 3) * PLANE_SIZE + idx] = 1.0;
    }
  }

  // Metadata scalars
  const scores = board.getScores();
  meta[0] = scores[currentPlayer] / 3;
  meta[1] = scores[opponent] / 3;

  // Count rings on board
  let currentRings = 0;
  let opponentRings = 0;
  for (const piece of Object.values(boardState)) {
    if (piece.type === 'ring') {
      if (piece.player === currentPlayer) currentRings++;
      else opponentRings++;
    }
  }
  meta[2] = currentRings / 5;
  meta[3] = opponentRings / 5;

  // Phase encoding
  const phase = board.getGamePhase();
  if (phase === 'remove-ring') {
    meta[4] = 1.0;
  } else if (phase === 'remove-row') {
    meta[4] = 0.5;
  } else {
    meta[4] = 0.0; // play, setup, game-over
  }

  return { board: boardData, meta };
}
