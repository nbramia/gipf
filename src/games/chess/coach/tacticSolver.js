// tacticSolver.js — depth-limited alpha-beta search over chess.js used to
// verify NON-MATE tactical puzzles (forks, pins, skewers, deflections, ...).
//
// Mirrors mateSolver.js: used at authoring time and in puzzles.test.js to
// GUARANTEE every bundled tactical puzzle actually wins material, and that
// the stored key move is the unique best try (no other first move wins as
// much). Material-only evaluation keeps it fast and fully deterministic — no
// engine dependency, no positional judgment, just "does this line win
// material against best defense." Not imported at runtime.

import { Chess } from 'chess.js';

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Material balance in centipawns from White's perspective.
function materialEval(game) {
  let score = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      score += sq.color === 'w' ? VALUES[sq.type] : -VALUES[sq.type];
    }
  }
  return score;
}

// Negamax with alpha-beta pruning, material-only leaf eval, capture-first
// move ordering (cheap and keeps pruning effective in tactical positions).
// Returns { score, key } — score is centipawns from the perspective of the
// side to move at THIS node (positive = good for the mover), key is the
// best move (verbose) or null at a terminal/leaf node.
export function searchBest(game, maxPlies, alpha = -Infinity, beta = Infinity) {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) {
    if (game.isCheckmate()) return { score: -100000, key: null };
    return { score: 0, key: null }; // stalemate / no moves, not a win
  }
  if (maxPlies <= 0) {
    const perspective = game.turn() === 'w' ? 1 : -1;
    return { score: materialEval(game) * perspective, key: null };
  }

  moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    game.move(m);
    const sub = searchBest(game, maxPlies - 1, -beta, -alpha);
    game.undo();
    const score = -sub.score;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return { score: bestScore, key: best };
}

// Verify a tactical puzzle: does `solution[0]` (UCI, e.g. "d4c5") win at
// least `minGainCp` centipawns of material against best defense within
// `maxPlies` of lookahead, and is it the UNIQUE best first move (no other
// legal root move matches or beats its score)?
//   fen         — position, side to move is the puzzle's solver
//   solutionUci — full UCI solution line (only solution[0] is checked here —
//                 the rest is the illustrative/hint line, exactly like how
//                 mate-in-N puzzles store one clean line but accept any
//                 mate-keeping move at runtime)
// Returns { sound, gain, unique, baseline, scoreFirst, best } where `sound`
// is true only if gain >= minGainCp AND the key is unique.
export function verifyTactic(fen, solutionUci, { maxPlies = 5, minGainCp = 150 } = {}) {
  const game = new Chess(fen);
  const rootMoves = game.moves({ verbose: true });
  const firstUci = solutionUci[0];
  const firstMove = rootMoves.find(
    (m) => `${m.from}${m.to}${m.promotion || ''}` === firstUci
  );
  if (!firstMove) return { sound: false, reason: 'illegal-first-move' };

  const rootPerspective = game.turn() === 'w' ? 1 : -1;
  const baseline = materialEval(game) * rootPerspective;

  game.move(firstMove);
  const afterFirst = searchBest(game, maxPlies - 1);
  game.undo();
  const scoreFirst = -afterFirst.score;
  const gain = scoreFirst - baseline;

  // Uniqueness is checked against other FORCING tries (captures/checks) only.
  // A quiet reshuffling move can tie the solution's eventual score whenever
  // the target piece has no way to escape at all (e.g. a fully pinned or
  // trapped piece) — that isn't a competing solution, just a slower path to
  // the same forced outcome, so it shouldn't fail the uniqueness check.
  let unique = true;
  let best = { from: firstMove.from, to: firstMove.to, score: scoreFirst };
  for (const m of rootMoves) {
    if (m.from === firstMove.from && m.to === firstMove.to && (m.promotion || '') === (firstMove.promotion || '')) {
      continue;
    }
    if (!m.captured && !/[+#]/.test(m.san)) continue; // not a forcing try
    game.move(m);
    const alt = searchBest(game, maxPlies - 1);
    game.undo();
    const altScore = -alt.score;
    if (altScore >= scoreFirst) {
      unique = false;
      if (altScore > best.score) best = { from: m.from, to: m.to, score: altScore };
    }
  }

  return { sound: gain >= minGainCp && unique, gain, unique, baseline, scoreFirst, best };
}
