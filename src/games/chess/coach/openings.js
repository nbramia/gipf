// openings.js — lightweight opening-book detection (issue #15).
//
// A curated set of common openings/variations keyed by their leading SAN move
// sequence. Detection walks the longest matching prefix of the game's SAN list,
// so deeper variations win over their parents. We also report the ply at which
// play left book (the first move not matching any known continuation), which the
// coach surfaces as a "left book" flag.
//
// This is intentionally a compact, dependency-free table covering mainstream
// openings a learner will meet early — not a full ECO database. Pure data +
// pure functions so it is fully unit-testable.

// name + SAN move list (space-separated). Order matters only in that a longer
// matching sequence is preferred; we sort by length at lookup time.
export const OPENING_BOOK = [
  { eco: 'B00', name: "King's Pawn", moves: 'e4' },
  { eco: 'A00', name: "Queen's Pawn", moves: 'd4' },
  { eco: 'A04', name: 'Réti Opening', moves: 'Nf3' },
  { eco: 'A10', name: 'English Opening', moves: 'c4' },

  { eco: 'C20', name: "King's Pawn Game", moves: 'e4 e5' },
  { eco: 'C40', name: "King's Knight Opening", moves: 'e4 e5 Nf3' },
  { eco: 'C44', name: 'Scotch Game', moves: 'e4 e5 Nf3 Nc6 d4' },
  { eco: 'C45', name: 'Scotch Game', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4' },
  { eco: 'C50', name: 'Italian Game', moves: 'e4 e5 Nf3 Nc6 Bc4' },
  { eco: 'C50', name: 'Giuoco Piano', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5' },
  { eco: 'C53', name: 'Giuoco Piano (main)', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3' },
  { eco: 'C55', name: 'Two Knights Defense', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6' },
  { eco: 'C60', name: 'Ruy Lopez', moves: 'e4 e5 Nf3 Nc6 Bb5' },
  { eco: 'C65', name: 'Ruy Lopez, Berlin Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 Nf6' },
  { eco: 'C68', name: 'Ruy Lopez, Morphy Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 a6' },
  { eco: 'C30', name: "King's Gambit", moves: 'e4 e5 f4' },
  { eco: 'C42', name: 'Petrov Defense', moves: 'e4 e5 Nf3 Nf6' },

  { eco: 'B20', name: 'Sicilian Defense', moves: 'e4 c5' },
  { eco: 'B21', name: 'Sicilian, Smith-Morra Gambit', moves: 'e4 c5 d4' },
  { eco: 'B27', name: 'Sicilian Defense', moves: 'e4 c5 Nf3' },
  { eco: 'B22', name: 'Sicilian, Alapin', moves: 'e4 c5 c3' },
  { eco: 'B90', name: 'Sicilian, Najdorf', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6' },
  { eco: 'B10', name: 'Caro-Kann Defense', moves: 'e4 c6' },
  { eco: 'C00', name: 'French Defense', moves: 'e4 e6' },
  { eco: 'C02', name: 'French, Advance', moves: 'e4 e6 d4 d5 e5' },
  { eco: 'B01', name: 'Scandinavian Defense', moves: 'e4 d5' },
  { eco: 'B07', name: 'Pirc Defense', moves: 'e4 d6 d4 Nf6 Nc3 g6' },
  { eco: 'B02', name: 'Alekhine Defense', moves: 'e4 Nf6' },

  { eco: 'D06', name: "Queen's Gambit", moves: 'd4 d5 c4' },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: 'd4 d5 c4 dxc4' },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: 'd4 d5 c4 e6' },
  { eco: 'D10', name: 'Slav Defense', moves: 'd4 d5 c4 c6' },
  { eco: 'E60', name: "King's Indian Defense", moves: 'd4 Nf6 c4 g6' },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: 'd4 Nf6 c4 e6 Nc3 Bb4' },
  { eco: 'E12', name: "Queen's Indian Defense", moves: 'd4 Nf6 c4 e6 Nf3 b6' },
  { eco: 'A45', name: 'Indian Game', moves: 'd4 Nf6' },
  { eco: 'A80', name: 'Dutch Defense', moves: 'd4 f5' },
  { eco: 'D70', name: 'Grünfeld Defense', moves: 'd4 Nf6 c4 g6 Nc3 d5' },
  { eco: 'A40', name: "Queen's Pawn, Modern", moves: 'd4 g6' },
];

// Precompute the move arrays once.
const BOOK = OPENING_BOOK.map((o) => ({ ...o, seq: o.moves.split(' ') }));

// Given the SAN history (array like ['e4','c5','Nf3']), return:
//   { eco, name, line, depth, inBook, leftBookAtPly }
// where `line` is the matched opening, `depth` is how many plies matched, and
// `leftBookAtPly` is the 1-based ply where the game diverged from ALL book
// lines (null while still following at least one book line's prefix).
export function detectOpening(sanHistory) {
  const san = sanHistory || [];
  if (san.length === 0) {
    return { eco: null, name: null, line: null, depth: 0, inBook: true, leftBookAtPly: null };
  }

  // Best (longest) opening whose full sequence is a prefix of the game.
  let best = null;
  for (const o of BOOK) {
    if (o.seq.length > san.length) continue;
    let match = true;
    for (let i = 0; i < o.seq.length; i += 1) {
      if (o.seq[i] !== san[i]) {
        match = false;
        break;
      }
    }
    if (match && (!best || o.seq.length > best.seq.length)) best = o;
  }

  // Are we still "in book" — i.e., does some book line extend the current game,
  // or exactly match it? If no book line shares the full current prefix, the
  // game has left book.
  let maxSharedPrefix = 0;
  for (const o of BOOK) {
    let i = 0;
    while (i < o.seq.length && i < san.length && o.seq[i] === san[i]) i += 1;
    if (i > maxSharedPrefix) maxSharedPrefix = i;
  }
  const inBook = maxSharedPrefix === san.length || (best && best.seq.length === san.length);
  const leftBookAtPly = inBook ? null : maxSharedPrefix + 1;

  return {
    eco: best ? best.eco : null,
    name: best ? best.name : null,
    line: best || null,
    depth: best ? best.seq.length : 0,
    inBook: !!inBook,
    leftBookAtPly,
  };
}
