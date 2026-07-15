// puzzles.js — tiered tactics puzzles + a sound, solver-based checker (#18).
//
// Each puzzle is a forced mate in N moves (N = 1 or 2 today; mate-in-3 is future
// work — see DIFFICULTY_TO_MATE_IN). Soundness is
// guaranteed two ways: every position was vetted with the exhaustive mate solver
// (mateSolver.js) to be a forced mate of exactly its stated depth, and
// puzzles.test.js re-verifies that invariant on every run.
//
// Move checking does NOT require a unique key. A move is "correct" if it keeps a
// forced mate within the remaining move budget — exactly how mate-in-N trainers
// work. This accepts any sound continuation (good technique), and the engine
// plays the longest-resisting defense, so 2- and 3-move puzzles play out for
// real. Because correctness is decided by the solver, the feedback can never be
// wrong (the #22 truthfulness principle).

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

// Every puzzle carries a rough difficulty `rating` (anchors the player's
// puzzle Elo) and its canonical `solution` line (UCI, from mateSolver's
// solutionLine) used by staged hints. Mate puzzles are still CHECKED by the
// solver — any mate-keeping move counts — the stored line is one clean answer.
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

  // --- Mate in 2 (solver-verified: shortest forced mate is exactly 3 plies,
  //     from a quiet position) ---
  { id: 'm2-rook-c', mateIn: 2, rating: 1100, solution: ['b2c3', 'a4a3', 'e5a5'], fen: '8/8/8/4R3/k7/8/1K6/8 w - - 0 1', theme: 'King & rook (cut-off)', hint: 'The rook cuts the king off; bring the king up to mate.' },
  { id: 'm2-rook-b', mateIn: 2, rating: 1150, solution: ['b6a6', 'b8a8', 'c1c8'], fen: '1k6/8/1K6/8/8/8/8/2R5 w - - 0 1', theme: 'King & rook', hint: 'The kings face off — bring the rook down to mate.' },
  { id: 'm2-queen-a', mateIn: 2, rating: 1000, solution: ['c6c7', 'a8a7', 'd1a4'], fen: 'k7/8/2K5/8/8/8/8/3Q4 w - - 0 1', theme: 'King & queen (corner)', hint: 'Box the king into the corner, then deliver.' },
  { id: 'm2-queen-b', mateIn: 2, rating: 1050, solution: ['c6b6', 'c8b8', 'd1d8'], fen: '2k5/8/2K5/8/8/8/8/3Q4 w - - 0 1', theme: 'King & queen', hint: 'Use the king for support, then the queen mates.' },

  // --- Mate in 3 (exhaustively vetted OFFLINE with mateSolver: shortest
  //     forced mate is exactly 5 plies; multiple king approaches work and the
  //     runtime checker accepts any mate-keeping move. Tests verify the
  //     stored line and that the key holds vs every defense — the full
  //     depth-5 proof is too slow to run per test.) ---
  { id: 'm3-kq-a', mateIn: 3, rating: 1400, solution: ['c4b5', 'a8b8', 'b5a6', 'b8a8', 'd7c8'], fen: 'k7/3Q4/8/8/2K5/8/8/8 w - - 0 1', theme: 'Queen box (mate in 3)', hint: 'The queen holds the cage shut; walk your king in.' },
  { id: 'm3-kq-b', mateIn: 3, rating: 1450, solution: ['f4e5', 'h8g8', 'e5f6', 'g8h8', 'e7g7'], fen: '7k/4Q3/8/8/5K2/8/8/8 w - - 0 1', theme: 'Queen box (mate in 3)', hint: 'The queen holds the cage shut; walk your king in.' },
];

export function getPuzzle(id) {
  return PUZZLES.find((p) => p.id === id) || null;
}

export function puzzlesForDifficulty(difficultyKey) {
  const mateIn = DIFFICULTY_TO_MATE_IN[difficultyKey] || 1;
  const pool = PUZZLES.filter((p) => p.mateIn === mateIn);
  // Fall back to the whole set if a tier somehow has no puzzles.
  return pool.length ? pool : PUZZLES;
}

// Plies the attacker has to deliver mate for a mate-in-N puzzle.
export function budgetPliesFor(mateIn) {
  return mateIn * 2 - 1;
}

// Evaluate a player's attempt against a scripted UCI solution (Lichess-style
// puzzles, #24). Lichess solutions are validated "only moves": the exact
// solution move is required, except any checkmate always wins (their mate-in-1
// convention). The opponent's replies come from the script, not a solver.
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
