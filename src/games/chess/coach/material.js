// material.js — captured-pieces and material-balance helpers (#21).
//
// Derives, from a chess.js board() array, which pieces each side has captured
// and the net material score. Pure functions over the standard piece-value
// table so the captured-pieces tray and material readout are testable.

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Full starting complement per side.
const FULL = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

// Count pieces by type for a given color from a chess.js board() (8x8, may hold
// nulls). Returns { p, n, b, r, q, k }.
function countByColor(board, color) {
  const counts = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.color === color) counts[sq.type] += 1;
    }
  }
  return counts;
}

// Pieces of `color` that have been captured = full complement minus those still
// on the board. Returned as an array of piece types, ordered q,r,b,n,p for a
// tidy tray. (Promotions can make this approximate; we clamp at 0.)
export function capturedPieces(board, color) {
  const onBoard = countByColor(board, color);
  const out = [];
  for (const type of ['q', 'r', 'b', 'n', 'p']) {
    const missing = Math.max(0, FULL[type] - onBoard[type]);
    for (let i = 0; i < missing; i += 1) out.push(type);
  }
  return out;
}

// Net material from White's perspective (+ = White ahead), in pawns.
export function materialBalance(board) {
  let score = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      const v = PIECE_VALUES[sq.type] || 0;
      score += sq.color === 'w' ? v : -v;
    }
  }
  return score;
}
