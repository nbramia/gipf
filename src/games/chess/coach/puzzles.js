// puzzles.js — tiered tactics puzzles + a sound, solver-based checker (#18).
//
// The bank has two kinds of puzzle:
//  - forced MATE puzzles (mateIn = 1, 2, or 3), checked by evaluatePuzzleMove
//    against the exhaustive mate solver (mateSolver.js): the position was
//    vetted offline to be a forced mate of exactly its stated depth, and
//    puzzles.test.js re-verifies that invariant on every run. Move checking
//    does NOT require a unique key — a move is "correct" if it keeps a
//    forced mate within the remaining move budget (exactly how mate-in-N
//    trainers work), and the engine plays the longest-resisting defense.
//  - non-mate TACTICAL puzzles (kind: 'solution', same shape lichessPuzzle.js
//    produces), checked by evaluateSolutionMove against a scripted UCI line:
//    the stored first move must be correct (any checkmate also wins, the
//    Lichess convention), the line ends without mate once the material is
//    won. These were vetted offline with the depth-limited material solver
//    (tacticSolver.js): the stored key move wins at least a set amount of
//    material against best defense and is the unique best try, and
//    puzzles.test.js re-verifies that invariant on every run.
//
// Because correctness is decided by a solver either way, the feedback can
// never be wrong (the #22 truthfulness principle).

import { Chess } from 'chess.js';
import { searchMate } from './mateSolver.js';

// Difficulty tier (from the game's selector) -> which mate length to train.
// Kept for tier-based entry; the adaptive trainer (#24) orders the whole bank
// by the player's puzzle rating instead (coach/puzzleProgress.js).
export const DIFFICULTY_TO_MATE_IN = {
  beginner: 1,
  casual: 1,
  intermediate: 2,
  advanced: 2,
  master: 3,
};

// Non-mate tactical themes each tier trains, layered on top of its mate
// bucket above so paired tiers (beginner/casual, intermediate/advanced) each
// get their own slice of mate puzzles (see puzzlesForDifficulty) AND a
// distinct set of tactical motifs, instead of everyone drawing from the same
// 3 buckets.
const TIER_THEMES = {
  beginner: [],
  casual: ['fork', 'back-rank'],
  intermediate: ['pin', 'skewer', 'removing the defender'],
  advanced: ['discovered attack', 'deflection', 'trapped piece'],
  master: [
    'fork',
    'pin',
    'skewer',
    'discovered attack',
    'deflection',
    'removing the defender',
    'back-rank',
    'trapped piece',
  ],
};

// Every puzzle carries a rough difficulty `rating` (anchors the player's
// puzzle Elo) and its canonical `solution` line (UCI, from mateSolver's
// solutionLine, or the key move for tactical puzzles) used by staged hints.
// Mate puzzles are still CHECKED by the solver — any mate-keeping move
// counts — the stored line is one clean answer.
export const PUZZLES = [
  // --- Mate in 1 ---
  { id: 'm1-back-rank', mateIn: 1, rating: 600, solution: ['a1a8'], fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', theme: 'Back-rank mate', hint: 'The king is trapped by its own pawns.' },
  { id: 'm1-two-rooks', mateIn: 1, rating: 500, solution: ['b6b8'], fen: '6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1', theme: 'Two-rook ladder', hint: 'One rook cuts off, the other delivers.' },
  { id: 'm1-scholar', mateIn: 1, rating: 700, solution: ['f3f7'], fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', theme: "Scholar's mate", hint: 'Queen and bishop strike the weakest square.' },
  { id: 'm1-queen-rank', mateIn: 1, rating: 650, solution: ['e1e8'], fen: '4r1k1/5ppp/8/8/8/8/5PPP/4Q1K1 w - - 0 1', theme: 'Queen back-rank', hint: 'Take the file the rook sits on.' },
  { id: 'm1-fools', mateIn: 1, rating: 550, solution: ['d8h4'], fen: 'rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR b KQkq - 0 1', theme: "Fool's mate", hint: "White's king is fatally exposed — bring the queen." },
  { id: 'm1-kiss', mateIn: 1, rating: 750, solution: ['f6e7'], fen: '4k3/8/4KQ2/8/8/8/8/8 w - - 0 1', theme: 'Kiss of death', hint: 'The queen steps up, shielded by her king.' },
  { id: 'm1-arabian', mateIn: 1, rating: 850, solution: ['a7h7'], fen: '7k/R7/5N2/8/8/8/8/K7 w - - 0 1', theme: 'Arabian mate', hint: 'Knight and rook team up in the corner.' },
  { id: 'm1-smothered', mateIn: 1, rating: 900, solution: ['h6f7'], fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1', theme: 'Smothered mate', hint: 'The king is buried by his own pieces — only a knight gets in.' },
  { id: 'm1-epaulette', mateIn: 1, rating: 900, solution: ['g3g6'], fen: '5rkr/8/8/8/8/6Q1/8/6K1 w - - 0 1', theme: 'Epaulette mate', hint: 'His own rooks block the escape — strike down the file.' },
  { id: 'm1-boden', mateIn: 1, rating: 950, solution: ['f1a6'], fen: '2kr4/3p4/8/8/5B2/8/8/2K2B2 w - - 0 1', theme: "Boden's mate", hint: 'Criss-crossing bishops; the king is blocked by his own pieces.' },
  // Additional mate-in-1 (generated + solver-verified offline): splits the
  // beginner/casual pool so the two tiers no longer share every puzzle.
  { id: 'm1-queen-edge-a', mateIn: 1, rating: 520, solution: ['d1a1'], fen: '8/8/8/8/k1K5/8/8/3Q4 w - - 0 1', theme: 'Queen & king (edge)', hint: 'The king is boxed against the side of the board.' },
  { id: 'm1-queen-corner-a', mateIn: 1, rating: 800, solution: ['a8g2'], fen: 'Q7/8/8/8/8/6K1/8/7k w - - 0 1', theme: 'Queen corner mate', hint: 'Swing the queen onto the long diagonal.' },
  { id: 'm1-queen-edge-b', mateIn: 1, rating: 580, solution: ['h4a4'], fen: 'k1K5/8/8/8/7Q/8/8/8 w - - 0 1', theme: 'Queen edge mate', hint: 'The queen slides all the way across the rank.' },
  { id: 'm1-king-assist-a', mateIn: 1, rating: 620, solution: ['c4d3'], fen: '8/8/8/8/2K5/8/8/1Q1k4 w - - 0 1', theme: 'King & queen (king delivers)', hint: 'The queen already covers everything — walk the king in.' },
  { id: 'm1-kiss-b', mateIn: 1, rating: 780, solution: ['e6f6'], fen: '3Q1k2/8/4K3/8/8/8/8/8 w - - 0 1', theme: 'Queen & king (kiss)', hint: 'The queen shields the king as he steps up.' },
  { id: 'm1-queen-edge-c', mateIn: 1, rating: 700, solution: ['e2g2'], fen: '8/8/8/8/8/5K2/4Q3/6k1 w - - 0 1', theme: 'Queen mate (edge)', hint: 'The king has nowhere to run along the rank.' },
  { id: 'm1-queen-corner-b', mateIn: 1, rating: 870, solution: ['c7b8'], fen: '7k/2Q5/7K/8/8/8/8/8 w - - 0 1', theme: 'Queen corner mate', hint: 'The king is pinned into the corner by its own king.' },
  { id: 'm1-queen-edge-d', mateIn: 1, rating: 640, solution: ['a7b7'], fen: 'k7/Q7/1K6/8/8/8/8/8 w - - 0 1', theme: 'Queen edge mate', hint: 'One step closer, and the king has no squares left.' },
  { id: 'm1-two-rooks-b', mateIn: 1, rating: 500, solution: ['b6d6'], fen: '8/8/1R1k2R1/8/8/8/7K/8 w - - 0 1', theme: 'Two-rook ladder', hint: 'One rook cuts the king off; the other cannot be reached.' },
  { id: 'm1-two-rooks-c', mateIn: 1, rating: 520, solution: ['h2h1'], fen: '8/8/8/8/2K5/7k/7R/6R1 w - - 0 1', theme: 'Two-rook ladder', hint: 'The rooks work together on adjacent files.' },
  { id: 'm1-two-rooks-d', mateIn: 1, rating: 540, solution: ['f5g5'], fen: '8/7R/8/5R2/8/7k/1K6/8 w - - 0 1', theme: 'Two-rook ladder', hint: 'Ladder the rook up one more rank.' },
  { id: 'm1-two-rooks-e', mateIn: 1, rating: 560, solution: ['c6h6'], fen: '7k/K7/2R5/8/8/8/6R1/8 w - - 0 1', theme: 'Two-rook ladder', hint: 'One rook holds the rank; slide the other across.' },
  { id: 'm1-two-rooks-f', mateIn: 1, rating: 590, solution: ['c5d6'], fen: '1R2k3/8/8/2K5/5R2/8/8/8 w - - 0 1', theme: 'Two-rook ladder', hint: 'The rooks already cover everything — bring the king closer.' },
  { id: 'm1-two-rooks-g', mateIn: 1, rating: 610, solution: ['c6c8'], fen: '7k/3R4/2R5/8/1K6/8/8/8 w - - 0 1', theme: 'Two-rook ladder', hint: 'The second rook delivers on the back rank.' },

  // --- Mate in 2 (solver-verified: shortest forced mate is exactly 3 plies,
  //     from a quiet position) ---
  { id: 'm2-rook-c', mateIn: 2, rating: 1100, solution: ['b2c3', 'a4a3', 'e5a5'], fen: '8/8/8/4R3/k7/8/1K6/8 w - - 0 1', theme: 'King & rook (cut-off)', hint: 'The rook cuts the king off; bring the king up to mate.' },
  { id: 'm2-rook-b', mateIn: 2, rating: 1150, solution: ['b6a6', 'b8a8', 'c1c8'], fen: '1k6/8/1K6/8/8/8/8/2R5 w - - 0 1', theme: 'King & rook', hint: 'The kings face off — bring the rook down to mate.' },
  { id: 'm2-queen-a', mateIn: 2, rating: 1000, solution: ['c6c7', 'a8a7', 'd1a4'], fen: 'k7/8/2K5/8/8/8/8/3Q4 w - - 0 1', theme: 'King & queen (corner)', hint: 'Box the king into the corner, then deliver.' },
  { id: 'm2-queen-b', mateIn: 2, rating: 1050, solution: ['c6b6', 'c8b8', 'd1d8'], fen: '2k5/8/2K5/8/8/8/8/3Q4 w - - 0 1', theme: 'King & queen', hint: 'Use the king for support, then the queen mates.' },
  // Additional mate-in-2 (generated + solver-verified offline): splits the
  // intermediate/advanced pool the same way.
  { id: 'm2-queen-c', mateIn: 2, rating: 1080, solution: ['f4g3', 'h1g1', 'b8b1'], fen: '1Q6/8/8/8/5K2/8/8/7k w - - 0 1', theme: 'King & queen (corner)', hint: 'Cut off the escape rank before the mate.' },
  { id: 'm2-queen-d', mateIn: 2, rating: 1120, solution: ['g8f7', 'h6h7', 'a5h5'], fen: '6K1/8/7k/Q7/8/8/8/8 w - - 0 1', theme: 'King & queen (edge)', hint: 'Approach with the king first, then swing the queen over.' },
  { id: 'm2-queen-e', mateIn: 2, rating: 1150, solution: ['d2c2', 'a1a2', 'f1a6'], fen: '8/8/8/8/8/8/3K4/k4Q2 w - - 0 1', theme: 'King & queen (corner)', hint: 'Take away a square first, then the queen finishes on the diagonal.' },
  { id: 'm2-queen-f', mateIn: 2, rating: 1180, solution: ['g4g8', 'h6h5', 'g8h7'], fen: '8/8/7k/8/5KQ1/8/8/8 w - - 0 1', theme: 'King & queen (edge)', hint: 'Cut the king off on the back rank, then close in.' },
  { id: 'm2-queen-g', mateIn: 2, rating: 1200, solution: ['e4b7', 'g8h8', 'b7g7'], fen: '6k1/8/5K2/8/4Q3/8/8/8 w - - 0 1', theme: 'King & queen (corner)', hint: 'Force the king into the corner before the mate.' },
  { id: 'm2-queen-h', mateIn: 2, rating: 1220, solution: ['h1h8', 'a7a6', 'h8a1'], fen: '8/k7/2K5/8/8/8/8/7Q w - - 0 1', theme: 'King & queen (edge)', hint: 'Cross the board on the back rank, then finish along the diagonal.' },
  { id: 'm2-queen-i', mateIn: 2, rating: 1240, solution: ['c8f5', 'a6a7', 'f5a5'], fen: '2Q5/2K5/k7/8/8/8/8/8 w - - 0 1', theme: 'King & queen (edge)', hint: 'The queen re-routes to the far edge for the mate.' },
  { id: 'm2-queen-j', mateIn: 2, rating: 1250, solution: ['e5f4', 'h5h4', 'e6h6'], fen: '8/8/4Q3/4K2k/8/8/8/8 w - - 0 1', theme: 'King & queen (edge)', hint: 'Shepherd the king toward the rim, then mate on the rank.' },
  { id: 'm2-rooks-a', mateIn: 2, rating: 1100, solution: ['e1e4', 'g4h3', 'a5h5'], fen: '8/8/8/R7/6k1/8/5K2/4R3 w - - 0 1', theme: 'Two-rook ladder (mate in 2)', hint: 'Cut off a rank, then ladder the other rook across.' },
  { id: 'm2-rooks-b', mateIn: 2, rating: 1130, solution: ['g7b7', 'c1c2', 'd4c4'], fen: '8/6R1/8/8/3R4/8/4K3/2k5 w - - 0 1', theme: 'Two-rook ladder (mate in 2)', hint: 'One rook seals the rank while the king closes in.' },
  { id: 'm2-rooks-c', mateIn: 2, rating: 1160, solution: ['f2f3', 'a2a1', 'f3a3'], fen: '1R6/8/8/8/8/8/k4R2/4K3 w - - 0 1', theme: 'Two-rook ladder (mate in 2)', hint: 'Free a square for the second rook to finish on the rank.' },
  { id: 'm2-rooks-d', mateIn: 2, rating: 1190, solution: ['h6g5', 'h2g3', 'e1e3'], fen: '8/8/7K/8/8/8/1R5k/4R3 w - - 0 1', theme: 'Two-rook ladder (mate in 2)', hint: 'Walk the king in, then ladder the rook across the rank.' },
  { id: 'm2-rooks-e', mateIn: 2, rating: 1210, solution: ['d5g5', 'h2h3', 'c1h1'], fen: '8/8/8/3R4/5K2/8/7k/2R5 w - - 0 1', theme: 'Two-rook ladder (mate in 2)', hint: 'Cut off the rank first, then finish on the file.' },
  { id: 'm2-rooks-f', mateIn: 2, rating: 1230, solution: ['a7g7', 'h2h3', 'd1h1'], fen: '8/R7/8/7K/8/8/7k/3R4 w - - 0 1', theme: 'Two-rook ladder (mate in 2)', hint: 'Seal the rank with one rook, mate with the other.' },

  // --- Mate in 3 (exhaustively vetted OFFLINE with mateSolver: shortest
  //     forced mate is exactly 5 plies; multiple king approaches work and the
  //     runtime checker accepts any mate-keeping move. Tests verify the
  //     stored line and that the key holds vs every defense — the full
  //     depth-5 proof is too slow to run per test.) ---
  { id: 'm3-kq-a', mateIn: 3, rating: 1400, solution: ['c4b5', 'a8b8', 'b5a6', 'b8a8', 'd7c8'], fen: 'k7/3Q4/8/8/2K5/8/8/8 w - - 0 1', theme: 'Queen box (mate in 3)', hint: 'The queen holds the cage shut; walk your king in.' },
  { id: 'm3-kq-b', mateIn: 3, rating: 1450, solution: ['f4e5', 'h8g8', 'e5f6', 'g8h8', 'e7g7'], fen: '7k/4Q3/8/8/5K2/8/8/8 w - - 0 1', theme: 'Queen box (mate in 3)', hint: 'The queen holds the cage shut; walk your king in.' },

  // --- Non-mate tactics (kind:'solution', checked by evaluateSolutionMove
  //     against the stored key move; solver-verified offline with
  //     tacticSolver.js — the key wins material at maxPlies:4/minGainCp:150
  //     and is the unique best try among forcing tries). Each has 2-3
  //     geometric variants (board-mirrored / file-shifted, still solver
  //     re-verified) so a tier training a theme isn't stuck on one shape. ---
  { id: 't-fork-a', kind: 'solution', rating: 750, solution: ['d5f6'], fen: '6k1/3q1p1p/8/3N4/8/6K1/5PPP/8 w - - 0 1', theme: 'fork', themes: ['fork'], hint: 'One knight move attacks two pieces at once.' },
  { id: 't-fork-b', kind: 'solution', rating: 770, solution: ['e5c6'], fen: '1k6/p1p1q3/8/4N3/8/1K6/PPP5/8 w - - 0 1', theme: 'fork', themes: ['fork'], hint: 'One knight move attacks two pieces at once.' },
  { id: 't-fork-c', kind: 'solution', rating: 790, solution: ['c5e6'], fen: '5k2/2q1p1p1/8/2N5/8/5K2/4PPP1/8 w - - 0 1', theme: 'fork', themes: ['fork'], hint: 'One knight move attacks two pieces at once.' },

  { id: 't-pin-a', kind: 'solution', rating: 1050, solution: ['b4e7'], fen: '5k2/4rppp/8/8/1B6/6K1/5PPP/8 w - - 0 1', theme: 'pin', themes: ['pin'], hint: 'The rook cannot be recaptured — the king is pinned behind it.' },
  { id: 't-pin-b', kind: 'solution', rating: 1070, solution: ['g4d7'], fen: '2k5/pppr4/8/8/6B1/1K6/PPP5/8 w - - 0 1', theme: 'pin', themes: ['pin'], hint: 'The rook cannot be recaptured — the king is pinned behind it.' },
  { id: 't-pin-c', kind: 'solution', rating: 1090, solution: ['a4d7'], fen: '4k3/3rppp1/8/8/B7/5K2/4PPP1/8 w - - 0 1', theme: 'pin', themes: ['pin'], hint: 'The rook cannot be recaptured — the king is pinned behind it.' },

  { id: 't-skewer-a', kind: 'solution', rating: 1100, solution: ['c1b2'], fen: '7r/8/8/4k3/8/8/8/K1B5 w - - 0 1', theme: 'skewer', themes: ['skewer'], hint: 'Check the king first; the rook has nowhere to hide behind it.' },
  { id: 't-skewer-b', kind: 'solution', rating: 1120, solution: ['f1g2'], fen: 'r7/8/8/3k4/8/8/8/5B1K w - - 0 1', theme: 'skewer', themes: ['skewer'], hint: 'Check the king first; the rook has nowhere to hide behind it.' },

  { id: 't-discovered-a', kind: 'solution', rating: 1350, solution: ['e4f6'], fen: '4q1k1/5ppp/8/8/4N3/6K1/5PPP/4R3 w - - 0 1', theme: 'discovered attack', themes: ['discovered attack'], hint: 'Moving the knight uncovers a much bigger threat.' },
  { id: 't-discovered-b', kind: 'solution', rating: 1370, solution: ['d4c6'], fen: '1k1q4/ppp5/8/8/3N4/1K6/PPP5/3R4 w - - 0 1', theme: 'discovered attack', themes: ['discovered attack'], hint: 'Moving the knight uncovers a much bigger threat.' },
  { id: 't-discovered-c', kind: 'solution', rating: 1390, solution: ['d4e6'], fen: '3q1k2/4ppp1/8/8/3N4/5K2/4PPP1/3R4 w - - 0 1', theme: 'discovered attack', themes: ['discovered attack'], hint: 'Moving the knight uncovers a much bigger threat.' },

  { id: 't-deflection-a', kind: 'solution', rating: 1500, solution: ['a1a8'], fen: '7k/1p3ppp/8/3q4/8/2B5/3n4/R5K1 w - - 0 1', theme: 'deflection', themes: ['deflection'], hint: 'The king is boxed in — only the queen can answer the check, and that costs her the knight.' },
  { id: 't-deflection-b', kind: 'solution', rating: 1520, solution: ['h1h8'], fen: 'k7/ppp3p1/8/4q3/8/5B2/4n3/1K5R w - - 0 1', theme: 'deflection', themes: ['deflection'], hint: 'The king is boxed in — only the queen can answer the check, and that costs her the knight.' },

  { id: 't-remove-defender-a', kind: 'solution', rating: 1150, solution: ['b5c6'], fen: '6k1/5ppp/2b5/1B1r4/8/6K1/5PPP/8 w - - 0 1', theme: 'removing the defender', themes: ['removing the defender'], hint: "The rook's only guard is undefended itself." },
  { id: 't-remove-defender-b', kind: 'solution', rating: 1170, solution: ['g5f6'], fen: '1k6/ppp5/5b2/4r1B1/8/1K6/PPP5/8 w - - 0 1', theme: 'removing the defender', themes: ['removing the defender'], hint: "The rook's only guard is undefended itself." },
  { id: 't-remove-defender-c', kind: 'solution', rating: 1190, solution: ['a5b6'], fen: '5k2/4ppp1/1b6/B1r5/8/5K2/4PPP1/8 w - - 0 1', theme: 'removing the defender', themes: ['removing the defender'], hint: "The rook's only guard is undefended itself." },

  { id: 't-back-rank-a', kind: 'solution', rating: 950, solution: ['d1d8'], fen: '3b3k/5pp1/8/8/8/6K1/5PPP/3R4 w - - 0 1', theme: 'back-rank', themes: ['back-rank'], hint: "The king's own pawns leave him no room to escape the rank." },
  { id: 't-back-rank-b', kind: 'solution', rating: 970, solution: ['e1e8'], fen: 'k3b3/1pp5/8/8/8/1K6/PPP5/4R3 w - - 0 1', theme: 'back-rank', themes: ['back-rank'], hint: "The king's own pawns leave him no room to escape the rank." },
  { id: 't-back-rank-c', kind: 'solution', rating: 990, solution: ['c1c8'], fen: '2b3k1/4pp2/8/8/8/5K2/4PPP1/2R5 w - - 0 1', theme: 'back-rank', themes: ['back-rank'], hint: "The king's own pawns leave him no room to escape the rank." },

  { id: 't-trapped-a', kind: 'solution', rating: 1000, solution: ['a1a8'], fen: 'n3k3/1pp5/8/8/8/8/5PPP/R3K3 w - - 0 1', theme: 'trapped piece', themes: ['trapped piece'], hint: 'The knight in the corner has nowhere to go.' },
  { id: 't-trapped-b', kind: 'solution', rating: 1020, solution: ['h1h8'], fen: '3k3n/5pp1/8/8/8/8/PPP5/3K3R w - - 0 1', theme: 'trapped piece', themes: ['trapped piece'], hint: 'The knight in the corner has nowhere to go.' },
];

export function getPuzzle(id) {
  return PUZZLES.find((p) => p.id === id) || null;
}

// Canonical label for a puzzle's theme, for the user-facing theme filter
// (docs/chess-ux-review.md #5, "no theme filter for puzzles"). Tactical
// puzzles store a lowercase, single-motif `theme` (see `themes`); mate
// puzzles use display-ready but ad-hoc strings, and some of those name the
// same motif the tactical bank calls 'back-rank' ('Back-rank mate', 'Queen
// back-rank'). This folds those into one bucket per motif instead of
// exposing the raw inconsistency to the filter UI.
const THEME_LABEL_OVERRIDES = {
  'back-rank': 'Back-rank',
  'Back-rank mate': 'Back-rank',
  'Queen back-rank': 'Back-rank',
};

export function themeLabel(theme) {
  if (THEME_LABEL_OVERRIDES[theme]) return THEME_LABEL_OVERRIDES[theme];
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

// Distinct, display-ready themes present in a puzzle bank, each with how many
// puzzles carry it. Sorted by count (most common first), ties broken
// alphabetically. Populates the theme-filter UI.
export function listThemes(bank) {
  const counts = new Map();
  for (const p of bank) {
    if (!p.theme) continue;
    const label = themeLabel(p.theme);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
}

// What a learner actually chooses between when deciding what to drill.
//
// `listThemes` is faithful to the data, but the data has 28 distinct themes —
// 20 of them one- or two-puzzle mating patterns ('Arabian mate', 'Epaulette
// mate', 'Queen box (mate in 3)'). Rendered as filter chips that's a wall of
// choices nobody wants to read, which is worse than offering no filter at all.
// A learner thinks in motifs: "drill my forks", "practise mating patterns".
// So mate puzzles collapse into one bucket and the tactical motifs stay
// distinct. Returns [{ group, count, themes }] where `themes` are the raw
// labels to hand to selectSession's `themes` option.
export const MATE_GROUP = 'Checkmate patterns';

export function listThemeGroups(bank) {
  const groups = new Map();
  for (const p of bank) {
    if (!p.theme) continue;
    const label = themeLabel(p.theme);
    const group = p.mateIn ? MATE_GROUP : label;
    if (!groups.has(group)) groups.set(group, { group, count: 0, themes: new Set() });
    const g = groups.get(group);
    g.count += 1;
    g.themes.add(label);
  }
  return [...groups.values()]
    .map((g) => ({ group: g.group, count: g.count, themes: [...g.themes] }))
    // Mating patterns first (the biggest, most familiar bucket), then motifs
    // by how much material there is to drill.
    .sort((a, b) =>
      a.group === MATE_GROUP ? -1 : b.group === MATE_GROUP ? 1 : b.count - a.count || a.group.localeCompare(b.group)
    );
}

// Tier-based entry: DIFFICULTY_TO_MATE_IN buckets by mate depth as before,
// but paired tiers (beginner/casual share a mate-in bucket; intermediate/
// advanced share the next) now split that bucket by rating so they draw
// different puzzles, and each tier layers on its own tactical themes
// (TIER_THEMES) so the whole selection is a genuinely distinct pool per
// tier — a mix of mate depth and tactical motifs, not one shared bucket.
export function puzzlesForDifficulty(difficultyKey) {
  const mateIn = DIFFICULTY_TO_MATE_IN[difficultyKey] || 1;
  const matePool = PUZZLES.filter((p) => p.mateIn === mateIn).sort((a, b) => a.rating - b.rating);
  const half = Math.ceil(matePool.length / 2);
  let mates = matePool;
  if (difficultyKey === 'beginner' || difficultyKey === 'intermediate') {
    mates = matePool.slice(0, half);
  } else if (difficultyKey === 'casual' || difficultyKey === 'advanced') {
    mates = matePool.slice(half);
  }
  const themes = TIER_THEMES[difficultyKey] || [];
  const tactics = PUZZLES.filter((p) => p.kind === 'solution' && themes.includes(p.theme));
  const pool = [...mates, ...tactics];
  // Fall back to the whole set if a tier somehow has no puzzles.
  return pool.length ? pool : PUZZLES;
}

// Plies the attacker has to deliver mate for a mate-in-N puzzle.
export function budgetPliesFor(mateIn) {
  return mateIn * 2 - 1;
}

// Evaluate a player's attempt against a scripted UCI solution (Lichess-style
// puzzles, #24, and this bank's non-mate tactics). Lichess solutions are
// validated "only moves": the exact solution move is required, except any
// checkmate always wins (their mate-in-1 convention). The opponent's replies
// come from the script, not a solver.
//   fen      — current position (player to move)
//   solution — remaining UCI moves, player's first: ['e2e4','e7e5',...]
// Returns shapes mirroring evaluatePuzzleMove, plus `solution` = what remains
// after the player's move and the scripted reply.
export function evaluateSolutionMove(fen, solution, from, to, promotion) {
  const game = new Chess(fen);
  let mv;
  try {
    mv = game.move({ from, to, promotion });
  } catch (_) {
    return { legal: false };
  }
  if (!mv) return { legal: false };

  if (game.isCheckmate()) {
    return { legal: true, solved: true, correct: true, played: mv.san };
  }

  const expected = solution[0];
  const uci = `${mv.from}${mv.to}${mv.promotion || ''}`;
  if (uci !== expected) {
    return { legal: true, correct: false, solved: false, played: mv.san };
  }
  if (solution.length === 1) {
    // Scripted line ends here without mate (e.g. decisive material win).
    return { legal: true, solved: true, correct: true, played: mv.san };
  }

  // Play the scripted reply and hand back the rest of the line.
  const replyUci = solution[1];
  const reply = game.move({
    from: replyUci.slice(0, 2),
    to: replyUci.slice(2, 4),
    promotion: replyUci.length > 4 ? replyUci[4] : undefined,
  });
  if (!reply) {
    // Malformed script — treat the player's correct move as a solve.
    return { legal: true, solved: true, correct: true, played: mv.san };
  }
  return {
    legal: true,
    correct: true,
    solved: false,
    played: mv.san,
    reply: { from: reply.from, to: reply.to, promotion: reply.promotion, san: reply.san },
    fenAfter: game.fen(),
    solution: solution.slice(2),
  };
}

// Evaluate a player's attempt in a puzzle position.
//   fen          — current puzzle position (player to move)
//   budgetPlies  — remaining plies the player has to force mate
//   from,to,promo
// Returns one of:
//   { legal:false }
//   { legal:true, solved:true,  played }                              (delivered mate)
//   { legal:true, correct:true,  solved:false, played,                (kept the mate)
//       reply:{from,to,promotion,san}, fenAfter, budgetPlies: n-2 }
//   { legal:true, correct:false, solved:false, played }               (let the mate slip)
export function evaluatePuzzleMove(fen, budgetPlies, from, to, promotion) {
  const game = new Chess(fen);
  let mv;
  try {
    mv = game.move({ from, to, promotion });
  } catch (_) {
    return { legal: false };
  }
  if (!mv) return { legal: false };

  if (game.isCheckmate()) {
    return { legal: true, solved: true, correct: true, played: mv.san };
  }

  // Opponent to move. The move is correct only if EVERY reply still lets the
  // player force mate within the remaining budget (budgetPlies - 2).
  const remaining = budgetPlies - 2;
  const replies = game.moves({ verbose: true });
  if (replies.length === 0 || remaining < 1) {
    // Stalemate, or no budget left without mate => not the solution.
    return { legal: true, correct: false, solved: false, played: mv.san };
  }

  let best = null;
  let bestDist = -1;
  for (const r of replies) {
    game.move(r);
    const sub = searchMate(game, remaining);
    game.undo();
    if (!sub) {
      return { legal: true, correct: false, solved: false, played: mv.san };
    }
    if (sub.dist > bestDist) {
      bestDist = sub.dist;
      best = r;
    }
  }

  // Correct, not yet mate: engine plays the longest-resisting defense.
  game.move(best);
  return {
    legal: true,
    correct: true,
    solved: false,
    played: mv.san,
    reply: { from: best.from, to: best.to, promotion: best.promotion, san: best.san },
    fenAfter: game.fen(),
    budgetPlies: remaining,
  };
}
