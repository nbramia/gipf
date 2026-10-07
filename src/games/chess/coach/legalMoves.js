// legalMoves.js — SAN list of every legal move in a position, so the coach can
// be told exactly which moves exist and never suggest an impossible one.

import { Chess } from 'chess.js';

export function legalSan(fen) {
  try {
    return new Chess(fen).moves();
  } catch (_) {
    return [];
  }
}

// SAN moves the piece that just moved would have from its new square if its
// owner were to move again (a "where can it retreat / go next" fact). Built
// by handing the move back to the mover in the post-move FEN; [] when that
// position is not valid (e.g. it would leave the other king in check).
export function movedPieceNextMoves(fenBefore, san) {
  try {
    const game = new Chess(fenBefore);
    const mv = game.move(san);
    // Handing the move back after a check would let the mover capture the king.
    if (game.isCheck()) return [];
    const parts = game.fen().split(' ');
    parts[1] = mv.color;
    parts[3] = '-';
    return new Chess(parts.join(' '))
      .moves({ verbose: true })
      .filter((m) => m.from === mv.to && m.captured !== 'k')
      .map((m) => m.san);
  } catch (_) {
    return [];
  }
}

const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

// The material the move changed, read from the position before it (chess.js
// reports the captured piece even for en passant). Keys are omitted when they
// do not apply, so a quiet move gives {}.
export function moveMaterial(fenBefore, san) {
  try {
    const mv = new Chess(fenBefore).move(san);
    return {
      ...(mv.captured && PIECE_NAMES[mv.captured] ? { captured: PIECE_NAMES[mv.captured] } : {}),
      ...(mv.promotion && PIECE_NAMES[mv.promotion] ? { promotion: PIECE_NAMES[mv.promotion] } : {}),
    };
  } catch (_) {
    return {};
  }
}
