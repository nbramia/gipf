// puzzles.js — curated tactics puzzles + a pure checker (issue #18).
//
// Every bundled puzzle is a forced mate-in-1 whose solution is the UNIQUE
// mating move. This is enforced two ways: each entry below was verified with
// chess.js (exactly one mating move from the position), and puzzles.test.js
// re-checks that invariant on every test run. Restricting the set to
// objectively-correct positions means the checker validates a solve with zero
// ambiguity and the feedback can never be wrong — the truthfulness principle
// that governs the rest of the coach (#22).

import { Chess } from 'chess.js';

export const PUZZLES = [
  {
    id: 'back-rank',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    solution: 'a1a8',
    theme: 'Back-rank mate',
    hint: 'The enemy king is trapped by its own pawns.',
  },
  {
    id: 'scholar',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    solution: 'f3f7',
    theme: "Scholar's mate",
    hint: 'A classic queen-and-bishop strike on the weakest square.',
  },
  {
    id: 'two-rooks',
    fen: '6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1',
    solution: 'b6b8',
    theme: 'Two-rook ladder mate',
    hint: 'One rook cuts off the escape, the other delivers.',
  },
  {
    id: 'queen-back-rank',
    fen: '4r1k1/5ppp/8/8/8/8/5PPP/4Q1K1 w - - 0 1',
    solution: 'e1e8',
    theme: 'Queen back-rank mate',
    hint: 'Take the file the rook is sitting on.',
  },
  {
    id: 'king-and-queen',
    fen: '7k/5Q2/5K2/8/8/8/8/8 w - - 0 1',
    solution: 'f7g7',
    theme: 'King-and-queen mate',
    hint: 'The queen needs the king’s support to deliver mate in the corner.',
  },
  {
    id: 'fools-mate',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR b KQkq - 0 1',
    solution: 'd8h4',
    theme: "Fool's mate",
    hint: 'White’s kingside is fatally weakened — bring the queen.',
  },
];

export function getPuzzle(id) {
  return PUZZLES.find((p) => p.id === id) || null;
}

// Check a player's attempt (from/to[/promotion]) against a puzzle.
// Returns { legal, solved, mate, played } where:
//   legal  — the move was legal in the puzzle position
//   solved — the move matches the unique solution AND delivers mate
//   mate   — the move delivers checkmate
//   played — the SAN of the attempted move (null if illegal)
export function checkSolution(puzzle, from, to, promotion) {
  const game = new Chess(puzzle.fen);
  let mv;
  try {
    mv = game.move({ from, to, promotion });
  } catch (_) {
    return { legal: false, solved: false, mate: false, played: null };
  }
  if (!mv) return { legal: false, solved: false, mate: false, played: null };

  const uci = `${mv.from}${mv.to}${mv.promotion || ''}`;
  const mate = game.isCheckmate();
  const solved = uci === puzzle.solution && mate;
  return { legal: true, solved, mate, played: mv.san };
}
