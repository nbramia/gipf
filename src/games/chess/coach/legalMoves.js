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
