// openings.js — lightweight opening-book detection (issue #15).
//
// A curated set of common openings/variations keyed by their leading SAN move
// sequence. Detection walks the longest matching prefix of the game's SAN list,
// so deeper variations win over their parents. We also report the ply at which
// play left book (the first move not matching any known continuation), which the
// coach surfaces as a "left book" flag.
//
// This is intentionally a compact table covering mainstream openings a
// learner will meet early — not a full ECO database. Pure data + pure
// functions so it is fully unit-testable; chess.js is used only to compute
// FEN positions for transposition detection, not to validate legality of
// moves played in the app.
import { Chess } from 'chess.js';

// name + SAN move list (space-separated). Order matters only in that a longer
// matching sequence is preferred; we sort by length at lookup time.
export const OPENING_BOOK = [
  {
    eco: 'B00',
    name: "King's Pawn",
    moves: 'e4',
    idea: 'Grabs the center and opens lines for the queen and bishop right away — the most direct way to fight for e5 and d5.',
  },
  {
    eco: 'A00',
    name: "Queen's Pawn",
    moves: 'd4',
    idea: 'Claims the center more solidly than 1.e4, opening a diagonal for the light-squared bishop while keeping the position flexible.',
  },
  {
    eco: 'A04',
    name: 'Réti Opening',
    moves: 'Nf3',
    idea: "Develops a piece before committing any pawns, keeping the option to build a center with d4/c4 or press it from the flank instead.",
  },
  {
    eco: 'A10',
    name: 'English Opening',
    moves: 'c4',
    idea: "Fights for the d5 square from the side rather than head-on, usually leading to slower maneuvering instead of an early clash.",
  },

  { eco: 'C20', name: "King's Pawn Game", moves: 'e4 e5', idea: 'Both sides stake a claim in the center immediately; the fight is over who gets the freer pieces and the safer king first.' },
  { eco: 'C40', name: "King's Knight Opening", moves: 'e4 e5 Nf3' },
  {
    eco: 'C44',
    name: 'Scotch Game',
    moves: 'e4 e5 Nf3 Nc6 d4',
    idea: 'White opens the center early and trades pawns to get quick piece activity instead of a slow build-up.',
  },
  { eco: 'C45', name: 'Scotch Game', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4' },
  {
    eco: 'C50',
    name: 'Italian Game',
    moves: 'e4 e5 Nf3 Nc6 Bc4',
    idea: "Aims the bishop at f7, the weakest point in Black's camp, and tries to build a strong center with c3 and d4.",
  },
  { eco: 'C50', name: 'Giuoco Piano', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5' },
  { eco: 'C53', name: 'Giuoco Piano (main)', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3' },
  {
    eco: 'C55',
    name: 'Two Knights Defense',
    moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6',
    idea: 'Black develops quickly and dares White to grab a pawn with Ng5, accepting sharp tactics in exchange for fast development.',
  },
  {
    eco: 'C60',
    name: 'Ruy Lopez',
    moves: 'e4 e5 Nf3 Nc6 Bb5',
    idea: "Pins the knight defending e5 and quietly pressures the center, aiming to make Black's position awkward before the middlegame even starts.",
  },
  { eco: 'C65', name: 'Ruy Lopez, Berlin Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 Nf6' },
  { eco: 'C68', name: 'Ruy Lopez, Morphy Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 a6' },
  {
    eco: 'C84',
    name: 'Ruy Lopez, Closed',
    moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5',
  },
  {
    eco: 'C69',
    name: 'Ruy Lopez, Exchange',
    moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6',
    idea: "White trades the bishop for the knight to leave Black with doubled pawns, aiming for a favorable endgame rather than an early attack.",
  },
  {
    eco: 'C30',
    name: "King's Gambit",
    moves: 'e4 e5 f4',
    idea: "White offers the f-pawn to open the f-file and build a big center, trading material for a fast attack.",
  },
  {
    eco: 'C42',
    name: 'Petrov Defense',
    moves: 'e4 e5 Nf3 Nf6',
    idea: 'Black meets the threat to e5 by counterattacking e4 rather than defending it, aiming for a solid, symmetrical game.',
  },
  {
    eco: 'C25',
    name: 'Vienna Game',
    moves: 'e4 e5 Nc3',
    idea: 'White develops the queenside knight before Nf3, keeping the option of an early f4 pawn storm or a quieter build-up.',
  },
  { eco: 'C26', name: 'Vienna Game, Main Line', moves: 'e4 e5 Nc3 Nf6 Bc4 Bc5 Qg4 O-O' },
  {
    eco: 'C47',
    name: 'Four Knights Game',
    moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6',
    idea: 'Both sides develop naturally and symmetrically, delaying the fight for the center until every piece is ready to support it.',
  },
  { eco: 'C47', name: 'Four Knights, Scotch Variation', moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6 d4 exd4 Nxd4 Bb4 Nxc6 bxc6' },

  {
    eco: 'B20',
    name: 'Sicilian Defense',
    moves: 'e4 c5',
    idea: 'Black fights for the center asymmetrically, trading the c-pawn for influence over d4 and a queenside pawn majority for the middlegame and endgame.',
  },
  { eco: 'B21', name: 'Sicilian, Smith-Morra Gambit', moves: 'e4 c5 d4' },
  { eco: 'B27', name: 'Sicilian Defense', moves: 'e4 c5 Nf3' },
  { eco: 'B22', name: 'Sicilian, Alapin', moves: 'e4 c5 c3' },
  { eco: 'B90', name: 'Sicilian, Najdorf', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6' },
  { eco: 'B70', name: 'Sicilian, Dragon', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7' },
  { eco: 'B33', name: 'Sicilian, Sveshnikov', moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6' },
  { eco: 'B56', name: 'Sicilian, Classical', moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Bg5 e6' },
  {
    eco: 'B10',
    name: 'Caro-Kann Defense',
    moves: 'e4 c6',
    idea: "Black supports d5 without boxing in the light-squared bishop, aiming for a solid, hard-to-attack structure.",
  },
  { eco: 'B12', name: 'Caro-Kann, Advance', moves: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Qb6' },
  { eco: 'B18', name: 'Caro-Kann, Classical', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6' },
  {
    eco: 'C00',
    name: 'French Defense',
    moves: 'e4 e6',
    idea: "Black builds a solid pawn chain with d5, temporarily boxing in the light bishop, and plans to attack White's center with c5 later.",
  },
  { eco: 'C02', name: 'French, Advance', moves: 'e4 e6 d4 d5 e5' },
  { eco: 'C08', name: 'French, Tarrasch', moves: 'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6' },
  { eco: 'C15', name: 'French, Winawer', moves: 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7' },
  {
    eco: 'B01',
    name: 'Scandinavian Defense',
    moves: 'e4 d5',
    idea: 'Black trades the center immediately to get the queen developed early, accepting a small loss of time for simple, solid development.',
  },
  { eco: 'B01', name: 'Scandinavian Defense, Main Line', moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5' },
  {
    eco: 'B07',
    name: 'Pirc Defense',
    moves: 'e4 d6 d4 Nf6 Nc3 g6',
    idea: "Black lets White build a big pawn center and plans to attack it later with well-placed pieces rather than contesting it right away.",
  },
  {
    eco: 'B02',
    name: 'Alekhine Defense',
    moves: 'e4 Nf6',
    idea: "Black provokes White's pawns forward with early knight moves, planning to attack the overextended center once it's built.",
  },

  {
    eco: 'D06',
    name: "Queen's Gambit",
    moves: 'd4 d5 c4',
    idea: "White offers the c-pawn to open lines and build a big center; Black usually declines and fights for the center instead of grabbing the pawn.",
  },
  { eco: 'D06', name: "Queen's Gambit", moves: 'd4 d5 c4 Nf6 Nf3' },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: 'd4 d5 c4 dxc4' },
  {
    eco: 'D30',
    name: "Queen's Gambit Declined",
    moves: 'd4 d5 c4 e6',
    idea: 'Black keeps the center solid with e6 rather than grabbing the c-pawn, accepting a temporarily passive bishop for a very sturdy position.',
  },
  { eco: 'D37', name: "Queen's Gambit Declined, Main Line", moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6' },
  {
    eco: 'D10',
    name: 'Slav Defense',
    moves: 'd4 d5 c4 c6',
    idea: 'Black defends d5 with the c-pawn instead of e6, keeping the light-squared bishop free to develop outside the pawn chain.',
  },
  { eco: 'D17', name: 'Slav Defense, Main Line', moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6' },
  {
    eco: 'E60',
    name: "King's Indian Defense",
    moves: 'd4 Nf6 c4 g6',
    idea: 'Black lets White build a big center and develops the bishop onto the long diagonal to attack it later, often with a kingside pawn storm.',
  },
  { eco: 'E92', name: "King's Indian Defense, Main Line", moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5' },
  {
    eco: 'E20',
    name: 'Nimzo-Indian Defense',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4',
    idea: "Black pins White's knight to disrupt the center before it forms, prioritizing piece activity over an immediate central presence.",
  },
  {
    eco: 'E12',
    name: "Queen's Indian Defense",
    moves: 'd4 Nf6 c4 e6 Nf3 b6',
    idea: 'Black develops the bishop onto the long diagonal to pressure e4 from a distance, playing a flexible, positional game.',
  },
  {
    eco: 'A45',
    name: 'Indian Game',
    moves: 'd4 Nf6',
    idea: 'Black develops a knight before committing any central pawns, keeping options open for a King\'s Indian, Nimzo, or Queen\'s Indian setup.',
  },
  {
    eco: 'A80',
    name: 'Dutch Defense',
    moves: 'd4 f5',
    idea: 'Black stakes an early claim on e4 with the f-pawn, aiming for active piece play on the kingside at the cost of some king safety.',
  },
  {
    eco: 'D70',
    name: 'Grünfeld Defense',
    moves: 'd4 Nf6 c4 g6 Nc3 d5',
    idea: 'Black lets White build a big pawn center and immediately strikes at it with c5 and pressure down the long diagonal, rather than occupying the center directly.',
  },
  { eco: 'D85', name: 'Grünfeld Defense, Exchange Variation', moves: 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7' },
  { eco: 'A40', name: "Queen's Pawn, Modern", moves: 'd4 g6' },

  {
    eco: 'D02',
    name: 'London System',
    moves: 'd4 d5 Nf3 Nf6 Bf4 e6 e3 Bd6 Bg3 O-O Nbd2 c5',
    idea: 'White builds the same solid setup (d4, Bf4, e3) against almost anything Black plays, trading opening theory for a simple, repeatable plan.',
  },
  {
    eco: 'E00',
    name: 'Catalan',
    moves: 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4',
    idea: 'White develops the bishop onto the long diagonal while keeping a Queen\'s Gambit-style center, building long-term pressure on the queenside.',
  },

  {
    eco: 'A30',
    name: 'English, Symmetrical',
    moves: 'c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7 O-O O-O',
  },
  {
    eco: 'A29',
    name: 'English, Reversed Sicilian',
    moves: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6',
    idea: "White plays a Sicilian Defense with an extra tempo, using the flank pawn to fight for the center instead of occupying it directly.",
  },
];

// Precompute the move arrays once.
const BOOK = OPENING_BOOK.map((o) => ({ ...o, seq: o.moves.split(' ') }));

// Resolve each entry's "idea": its own, or (if it has none) the idea of the
// nearest ancestor — the longest other book line whose sequence is a strict
// prefix of this one and that carries its own idea. Precomputed once so a
// deep, unnamed-idea variation (e.g. a specific Sicilian line) still surfaces
// its family's idea (e.g. the Sicilian Defense's) without a per-call search.
for (const entry of BOOK) {
  if (entry.idea) continue;
  let ancestor = null;
  for (const o of BOOK) {
    if (o === entry || !o.idea || o.seq.length >= entry.seq.length) continue;
    let isPrefix = true;
    for (let i = 0; i < o.seq.length; i += 1) {
      if (o.seq[i] !== entry.seq[i]) {
        isPrefix = false;
        break;
      }
    }
    if (isPrefix && (!ancestor || o.seq.length > ancestor.seq.length)) ancestor = o;
  }
  entry.resolvedIdea = ancestor ? ancestor.idea : null;
}
for (const entry of BOOK) {
  if (entry.resolvedIdea === undefined) entry.resolvedIdea = entry.idea || null;
}

// Precompute the position (FEN) reached at the end of each book line, so
// transpositions can be recognized regardless of move order. Only the
// board-placement and side-to-move FEN fields are kept — castling rights,
// en passant, and the halfmove/fullmove counters are stripped — so two book
// lines (or a book line and the game) that reach the same position with
// different move counts still match. Built once at module load; this runs
// on every move made in a game, so it must not be recomputed per call.
function truncatedFen(chess) {
  return chess.fen().split(' ').slice(0, 2).join(' ');
}

const FEN_TO_ENTRY = new Map();
for (const entry of BOOK) {
  try {
    const chess = new Chess();
    for (const san of entry.seq) chess.move(san);
    const key = truncatedFen(chess);
    const existing = FEN_TO_ENTRY.get(key);
    if (!existing || entry.seq.length > existing.seq.length) FEN_TO_ENTRY.set(key, entry);
  } catch {
    // A malformed line in the table would throw here at load time — skip it
    // rather than crash the app; the SAN-prefix path still covers it.
  }
}

// Given the SAN history (array like ['e4','c5','Nf3']), return:
//   { eco, name, line, depth, idea, inBook, leftBookAtPly }
// where `line` is the matched opening, `depth` is how many plies its line
// covers, `idea` is the resolved 1-2 sentence explanation of the opening's
// plan, and `leftBookAtPly` is the 1-based ply where the game diverged from
// ALL book lines (null while still following, or transposing into, one).
export function detectOpening(sanHistory) {
  const san = sanHistory || [];
  if (san.length === 0) {
    return { eco: null, name: null, line: null, depth: 0, idea: null, inBook: true, leftBookAtPly: null };
  }

  // Best (longest) opening whose full sequence is a prefix of the game.
  let prefixBest = null;
  for (const o of BOOK) {
    if (o.seq.length > san.length) continue;
    let match = true;
    for (let i = 0; i < o.seq.length; i += 1) {
      if (o.seq[i] !== san[i]) {
        match = false;
        break;
      }
    }
    if (match && (!prefixBest || o.seq.length > prefixBest.seq.length)) prefixBest = o;
  }

  // Also check whether the game's current position transposes into a known
  // book position, even if the move order doesn't literally match any book
  // line's prefix.
  let posMatch = null;
  try {
    const chess = new Chess();
    for (const move of san) chess.move(move);
    posMatch = FEN_TO_ENTRY.get(truncatedFen(chess)) || null;
  } catch {
    posMatch = null;
  }

  // Prefer whichever match is deeper/more specific.
  let best = prefixBest;
  if (posMatch && (!best || posMatch.seq.length > best.seq.length)) best = posMatch;

  // Are we still "in book" — i.e., does some book line extend the current game,
  // or exactly match it (by move order or by transposition)? If not, the game
  // has left book.
  let maxSharedPrefix = 0;
  for (const o of BOOK) {
    let i = 0;
    while (i < o.seq.length && i < san.length && o.seq[i] === san[i]) i += 1;
    if (i > maxSharedPrefix) maxSharedPrefix = i;
  }
  const inBook =
    maxSharedPrefix === san.length || (prefixBest && prefixBest.seq.length === san.length) || !!posMatch;
  const leftBookAtPly = inBook ? null : maxSharedPrefix + 1;

  return {
    eco: best ? best.eco : null,
    name: best ? best.name : null,
    line: best || null,
    depth: best ? best.seq.length : 0,
    idea: best ? best.resolvedIdea : null,
    inBook: !!inBook,
    leftBookAtPly,
  };
}
