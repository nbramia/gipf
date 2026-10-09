// rounds.js
// Picks the next round for a solo game: of the unclaimed targets, the one whose
// optimal solution from the robots' current cells is closest to the length the
// caller wants.

import { solve } from './solver.js';

const MAX_LENGTH = 30;

// Returns { targetId, length, solution: [{robot, dir}] }, or
// { needsNewBoard: true } when no unclaimed target has a usable round (every
// target claimed, or none solvable in 2+ moves within the time limit). A
// one-move target is skipped because the bounce rule is implemented by never
// dealing a round whose optimum is 1. `timeLimitMs` bounds each solve.
export function chooseNextRound(board, desiredLength, { timeLimitMs = 2000 } = {}) {
  let best = [];
  let bestGap = Infinity;

  for (const target of board.targets) {
    if (board.claimed.includes(target.id)) continue;
    // A target only matters if it can land within the best gap so far, so cap
    // the search there instead of solving every target to its full optimum.
    const cap = Math.min(MAX_LENGTH, desiredLength + bestGap);
    const result = solve(
      { walls: board.walls, robots: board.robots, target, size: board.size, barriers: board.barriers },
      { maxDepth: cap, timeLimitMs },
    );
    if (!result || result.timedOut || result.length < 2) continue;
    const gap = Math.abs(result.length - desiredLength);
    if (gap > bestGap) continue;
    if (gap < bestGap) best = [];
    bestGap = gap;
    best.push({ targetId: target.id, length: result.length, solution: result.moves });
  }

  if (best.length === 0) return { needsNewBoard: true };
  return best[Math.floor(board.random() * best.length)];
}
