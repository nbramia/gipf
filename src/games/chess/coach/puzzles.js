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
// Tier -> mate length. (Mate-in-3 with a lone piece is rare to source cleanly;
// Master trains the hardest mate-in-2s for now. Mate-in-3 is future work.)
export const DIFFICULTY_TO_MATE_IN = {
  beginner: 1,
  casual: 1,
  intermediate: 2,
  advanced: 2,
  master: 2,
};

export const PUZZLES = [
  // --- Mate in 1 ---
  { id: 'm1-back-rank', mateIn: 1, fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', theme: 'Back-rank mate', hint: 'The king is trapped by its own pawns.' },
  { id: 'm1-two-rooks', mateIn: 1, fen: '6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1', theme: 'Two-rook ladder', hint: 'One rook cuts off, the other delivers.' },
  { id: 'm1-scholar', mateIn: 1, fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', theme: "Scholar's mate", hint: 'Queen and bishop strike the weakest square.' },
  { id: 'm1-queen-rank', mateIn: 1, fen: '4r1k1/5ppp/8/8/8/8/5PPP/4Q1K1 w - - 0 1', theme: 'Queen back-rank', hint: 'Take the file the rook sits on.' },
  { id: 'm1-fools', mateIn: 1, fen: 'rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR b KQkq - 0 1', theme: "Fool's mate", hint: "White's king is fatally exposed — bring the queen." },

  // --- Mate in 2 (solver-verified: shortest forced mate is exactly 3 plies,
  //     from a quiet position) ---
  { id: 'm2-rook-c', mateIn: 2, fen: '8/8/8/4R3/k7/8/1K6/8 w - - 0 1', theme: 'King & rook (cut-off)', hint: 'The rook cuts the king off; bring the king up to mate.' },
  { id: 'm2-rook-b', mateIn: 2, fen: '1k6/8/1K6/8/8/8/8/2R5 w - - 0 1', theme: 'King & rook', hint: 'The kings face off — bring the rook down to mate.' },
  { id: 'm2-queen-a', mateIn: 2, fen: 'k7/8/2K5/8/8/8/8/3Q4 w - - 0 1', theme: 'King & queen (corner)', hint: 'Box the king into the corner, then deliver.' },
  { id: 'm2-queen-b', mateIn: 2, fen: '2k5/8/2K5/8/8/8/8/3Q4 w - - 0 1', theme: 'King & queen', hint: 'Use the king for support, then the queen mates.' },
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
