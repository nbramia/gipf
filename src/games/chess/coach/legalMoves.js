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
    const parts = game.fen().split(' ');
    parts[1] = mv.color;
    parts[3] = '-';
    return new Chess(parts.join(' '))
      .moves({ verbose: true })
      .filter((m) => m.from === mv.to)
      .map((m) => m.san);
  } catch (_) {
    return [];
  }
}
