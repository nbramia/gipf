// motifs.js — cheap, synchronous motif detection for the free (no-API-key)
// commentary path (docs/chess-ux-review.md #3.1).
//
// Pure chess.js, no engine calls. Given the FEN BEFORE a move and its SAN, this
// replays the move and inspects the resulting position for concrete, nameable
// facts: a hanging piece, a fork, a pin, a weakened king, lost castling rights,
// a development pattern. Precision over recall — every motif here is derived
// directly from board geometry / legal moves, never guessed. If nothing can be
// verified, the list is empty; that's the expected, safe outcome most of the
// time (this only needs to fire often enough to stop the fallback prose from
// repeating itself).

import { Chess } from 'chess.js';

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const FILES = 'abcdefgh';

function pieceName(type) {
  return PIECE_NAMES[type] || 'piece';
}

function otherColor(color) {
  return color === 'w' ? 'b' : 'w';
}

// Replay `san` from `fen`. Returns { game, move } or null if it doesn't apply
// (defensive — the payload should always carry a legal move, but a template
// fallback must never throw on unexpected input).
function replay(fen, san) {
  let game;
  try {
    game = new Chess(fen);
  } catch (_) {
    return null;
  }
  let move;
  try {
    move = game.move(san);
  } catch (_) {
    return null;
  }
  if (!move) return null;
  return { game, move };
}

// All squares currently occupied by `color`, as {square, type}.
function piecesOf(game, color) {
  const out = [];
  const board = game.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.color === color) out.push({ square: cell.square, type: cell.type });
    }
  }
  return out;
}

// The single best (highest-value) piece of `color` that is attacked with no
// legal recapture available — a genuinely hanging piece, not just "touched."
// Uses actual legal moves (not raw geometric attack squares) on both sides so
// pins/blocks are respected automatically.
function findHangingPiece(game, color) {
  const oppColor = otherColor(color);
  const captures = game.moves({ verbose: true }).filter((m) => m.captured);
  let best = null;
  for (const cap of captures) {
    const target = game.get(cap.to);
    if (!target || target.color !== color) continue;
    const after = new Chess(game.fen());
    after.move({ from: cap.from, to: cap.to, promotion: cap.promotion });
    const recaptures = after.moves({ verbose: true }).filter((m) => m.captured && m.to === cap.to);
    if (recaptures.length) continue; // defended
    const value = PIECE_VALUES[target.type] || 0;
    if (value <= 0) continue;
    if (!best || value > best.value) {
      best = { square: cap.to, type: target.type, value, byType: cap.piece };
    }
  }
  return best;
  // Note: oppColor is implied by `game`'s own turn (it's whoever is to move,
  // i.e. the opponent right after `color`'s move) — kept as a local name only
  // for readability of the filter above.
}

// Squares (occupied by `attackerColor`'s opponent) that a piece standing on
// `origin` currently attacks. Cheap because it only checks occupied squares.
function squaresAttackedFrom(game, origin, attackerColor) {
  const targets = piecesOf(game, otherColor(attackerColor));
  return targets.filter((t) => game.attackers(t.square, attackerColor).includes(origin));
}

// Does the piece that just landed on `destSquare` attack 2+ enemy pieces worth
// >=3 (minor or greater)? Pawns are excluded as attackers (every pawn capture
// "double-attacks" two squares by definition, which would make this noise).
function findFork(game, destSquare, moverColor) {
  const mover = game.get(destSquare);
  if (!mover || mover.color !== moverColor || mover.type === 'p' || mover.type === 'k') return null;
  const hit = squaresAttackedFrom(game, destSquare, moverColor).filter(
    (t) => t.type === 'k' || (PIECE_VALUES[t.type] || 0) >= 3
  );
  if (hit.length < 2) return null;
  return { attacker: mover.type, targets: hit };
}

// Absolute pin: does `color` have a sliding piece whose line runs through
// exactly one enemy piece to the enemy king? Returns the pinned piece's square
// and type, or null. Only absolute (to-the-king) pins are reported — relative
// pins/skewers require a value judgment about which piece to prioritize, which
// is easy to get wrong, so we stay silent on those rather than guess.
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
function slidingDirs(type) {
  if (type === 'r') return ROOK_DIRS;
  if (type === 'b') return BISHOP_DIRS;
  if (type === 'q') return [...ROOK_DIRS, ...BISHOP_DIRS];
  return [];
}
function toFileRank(square) {
  return [square.charCodeAt(0) - 97, parseInt(square[1], 10) - 1];
}
function toSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + (rank + 1);
}

function findAbsolutePin(game, attackerColor) {
  const enemyColor = otherColor(attackerColor);
  for (const p of piecesOf(game, attackerColor)) {
    const dirs = slidingDirs(p.type);
    if (!dirs.length) continue;
    const [f0, r0] = toFileRank(p.square);
    for (const [df, dr] of dirs) {
      let f = f0 + df;
      let r = r0 + dr;
      let blocker = null;
      for (;;) {
        const sq = toSquare(f, r);
        if (!sq) break;
        const occ = game.get(sq);
        if (occ) {
          if (!blocker) {
            if (occ.color === attackerColor) break; // own piece blocks the line
            blocker = { square: sq, type: occ.type };
          } else {
            if (occ.color === enemyColor && occ.type === 'k') {
              return { pinned: blocker, attacker: p.type, king: sq };
            }
            break;
          }
        }
        f += df;
        r += dr;
      }
    }
  }
  return null;
}

// King's legal, non-capture, off-back-rank escape squares (flight squares).
// Returns null (rather than a count) if it can't be computed safely — e.g.
// setTurn() rejects flipping to a side that would leave the actual side-to-
// move's king in an impossible "still in check after a null move" state. A
// null result means "skip this motif," never "assume zero."
function kingFlightCount(fen, color) {
  try {
    const clone = new Chess(fen);
    clone.setTurn(color);
    const kingSq = clone.findPiece({ type: 'k', color })[0];
    if (!kingSq) return null;
    const backRank = color === 'w' ? '1' : '8';
    const moves = clone.moves({ square: kingSq, verbose: true }) || [];
    return moves.filter((m) => m.to[1] !== backRank).length;
  } catch (_) {
    return null;
  }
}

const HOME_SQUARES = {
  n: { w: ['b1', 'g1'], b: ['b8', 'g8'] },
  b: { w: ['c1', 'f1'], b: ['c8', 'f8'] },
};

// Detect motifs for a move. Inputs are the position BEFORE the move (FEN),
// its SAN, and the color that played it. `inOpening` narrows the
// development-pattern checks to the phase where they're meaningful.
//
// Returns an ordered list of { code, text, polarity } — polarity is
// 'negative' | 'positive', a hint for which tone of commentary should use it.
// Never throws: this feeds the no-API-key fallback path, so any unexpected
// input degrades to "no motifs found" rather than breaking the commentary.
export function detectMotifs(args) {
  try {
    return detectMotifsUnsafe(args);
  } catch (_) {
    return [];
  }
}

function detectMotifsUnsafe({ fen, san, moverColor, inOpening }) {
  if (!fen || !san || !moverColor) return [];
  const replayed = replay(fen, san);
  if (!replayed) return [];
  const { game, move } = replayed;
  const oppColor = otherColor(moverColor);
  const motifs = [];

  // 1. Hanging piece left behind by the move.
  const hanging = findHangingPiece(game, moverColor);
  if (hanging) {
    motifs.push({
      code: 'hanging-piece',
      polarity: 'negative',
      text: `the ${pieceName(hanging.type)} on ${hanging.square} is now hanging — it's attacked and nothing can recapture`,
    });
  }

  // 2. Fork / double attack created by the moved piece.
  const fork = findFork(game, move.to, moverColor);
  if (fork) {
    const label =
      fork.attacker === 'n' ? 'knight fork' : fork.attacker === 'q' ? 'queen fork' : 'double attack';
    const names = fork.targets.map((t) => `the ${pieceName(t.type)} on ${t.square}`);
    const list = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    motifs.push({
      code: 'fork',
      polarity: 'positive',
      text: `that's a ${label} — the ${pieceName(fork.attacker)} on ${move.to} attacks ${list} at once`,
    });
  }

  // 3. Pin created on the opponent (attacking piece pinned to their king).
  const pinCreated = findAbsolutePin(game, moverColor);
  if (pinCreated) {
    motifs.push({
      code: 'pin-created',
      polarity: 'positive',
      text: `it also pins the ${pieceName(pinCreated.pinned.type)} on ${pinCreated.pinned.square} to the king on ${pinCreated.king}`,
    });
  }

  // 4. Own piece walked into a pin against the mover's own king.
  const pinWalkedInto = findAbsolutePin(game, oppColor);
  if (pinWalkedInto && pinWalkedInto.pinned.type !== 'k') {
    motifs.push({
      code: 'pin-walked-into',
      polarity: 'negative',
      text: `the ${pieceName(pinWalkedInto.pinned.type)} on ${pinWalkedInto.pinned.square} is now pinned to your king on ${pinWalkedInto.king}`,
    });
  }

  // 5. Back-rank vulnerability newly created (had a flight square, now has none).
  const kingSq = game.findPiece({ type: 'k', color: moverColor })[0];
  const backRank = moverColor === 'w' ? '1' : '8';
  if (kingSq && kingSq[1] === backRank) {
    const before = kingFlightCount(fen, moverColor);
    const after = kingFlightCount(game.fen(), moverColor);
    if (before !== null && after !== null && before > 0 && after === 0) {
      motifs.push({
        code: 'back-rank-vulnerability',
        polarity: 'negative',
        text: `your king on ${kingSq} has no flight square now — watch for back-rank tricks`,
      });
    }
  }

  // 6. King shelter damage: a pawn shielding a castled king pushed forward.
  if (move.piece === 'p' && kingSq && kingSq[1] === backRank && kingSq[0] !== 'e') {
    const kingFile = kingSq.charCodeAt(0) - 97;
    const fromFile = move.from.charCodeAt(0) - 97;
    if (Math.abs(fromFile - kingFile) <= 1 && !move.captured) {
      motifs.push({
        code: 'king-shelter-damage',
        polarity: 'negative',
        text: `it also loosens the pawn cover in front of your king on ${kingSq}`,
      });
    }
  }

  // 7. Castling rights lost by something other than castling itself.
  if (move.san !== 'O-O' && move.san !== 'O-O-O') {
    const rightsLetters = moverColor === 'w' ? ['K', 'Q'] : ['k', 'q'];
    const before = (fen.split(' ')[2] || '').split('').filter((c) => rightsLetters.includes(c));
    const after = (game.fen().split(' ')[2] || '').split('').filter((c) => rightsLetters.includes(c));
    if (before.length > 0 && after.length < before.length) {
      motifs.push({
        code: 'lost-castling-rights',
        polarity: 'negative',
        text: `it also gives up castling rights`,
      });
    }
  }

  // 8/9. Development pattern (opening only): first outing for a minor piece,
  // vs. moving one that already left its home square earlier.
  if (inOpening && (move.piece === 'n' || move.piece === 'b')) {
    const homes = HOME_SQUARES[move.piece][moverColor];
    if (homes.includes(move.from)) {
      motifs.push({
        code: 'developing-move',
        polarity: 'positive',
        text: `it brings a new piece into the game`,
      });
    } else if (!homes.includes(move.to)) {
      motifs.push({
        code: 'redeveloping-piece',
        polarity: 'negative',
        text: `it moves the same ${pieceName(move.piece)} again instead of developing a new piece`,
      });
    }
  }

  return motifs;
}
