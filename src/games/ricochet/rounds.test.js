import RicochetBoard from './RicochetBoard.js';
import { chooseNextRound } from './engine/rounds.js';
import { solve } from './engine/solver.js';
import { buildBoard, FAR } from './testHelpers.js';

// Optimal length of every unclaimed target from the board's current robots.
function lengthsByTarget(board) {
  const out = {};
  for (const t of board.targets) {
    if (board.claimed.includes(t.id)) continue;
    const r = solve({ walls: board.walls, robots: board.robots, target: t }, { maxDepth: 30, timeLimitMs: 20000 });
    out[t.id] = r && !r.timedOut ? r.length : null;
  }
  return out;
}

describe('chooseNextRound', () => {
  test('returns the closest-to-desired length, never <2, never claimed, round after round', () => {
    const board = new RicochetBoard({ seed: 21 });
    const desired = 5;
    let rounds = 0;
    for (; rounds < 17; rounds++) {
      const lengths = lengthsByTarget(board);
      const usable = Object.entries(lengths).filter(([, len]) => len != null && len >= 2);
      const pick = chooseNextRound(board, desired, { timeLimitMs: 20000 });
      if (usable.length === 0) {
        expect(pick).toEqual({ needsNewBoard: true });
        break;
      }
      const bestGap = Math.min(...usable.map(([, len]) => Math.abs(len - desired)));
      expect(pick.needsNewBoard).toBeUndefined();
      expect(board.claimed).not.toContain(pick.targetId);
      expect(pick.length).toBeGreaterThanOrEqual(2);
      expect(pick.length).toBe(lengths[pick.targetId]);
      expect(Math.abs(pick.length - desired)).toBe(bestGap);
      expect(pick.solution).toHaveLength(pick.length);

      // play it out: the solution must really solve the chosen target
      board.startRound(pick.targetId);
      for (const m of pick.solution) expect(board.applyMove(m)).toBeTruthy();
      expect(board.isSolved()).toBe(true);
    }
    expect(rounds).toBeGreaterThan(3);
    expect(new Set(board.claimed).size).toBe(board.claimed.length);
  }, 120000);

  test('different desired lengths pick different rounds', () => {
    const board = new RicochetBoard({ seed: 8 });
    const lengths = lengthsByTarget(board);
    const usable = Object.values(lengths).filter(l => l != null && l >= 2);
    const lo = Math.min(...usable);
    const hi = Math.max(...usable);
    expect(hi).toBeGreaterThan(lo);
    expect(chooseNextRound(board, 2).length).toBe(lo);
    expect(chooseNextRound(board, 30).length).toBe(hi);
  }, 60000);

  test('ties are broken with the board PRNG, deterministically', () => {
    const a = new RicochetBoard({ seed: 8 });
    const b = new RicochetBoard({ seed: 8 });
    expect(chooseNextRound(a, 6)).toEqual(chooseNextRound(b, 6));
    // a tie really exists at some length on this board, and both targets can be chosen
    const lengths = Object.values(lengthsByTarget(a));
    const counts = {};
    for (const l of lengths) counts[l] = (counts[l] || 0) + 1;
    const tied = Number(Object.keys(counts).find(l => counts[l] >= 3 && l >= 2));
    expect(tied).toBeGreaterThanOrEqual(2);
    const picked = new Set();
    for (let s = 0; s < 30; s++) {
      const board = new RicochetBoard({ seed: 8 });
      for (let i = 0; i < s; i++) board.random();
      picked.add(chooseNextRound(board, tied).targetId);
    }
    expect(picked.size).toBeGreaterThan(1);
  }, 60000);

  test('signals a new board when every target is claimed', () => {
    const board = new RicochetBoard({ seed: 2 });
    board.claimed = board.targets.map(t => t.id);
    expect(chooseNextRound(board, 6)).toEqual({ needsNewBoard: true });
  });

  test('signals a new board when the only target is a one-move round', () => {
    const board = buildBoard({ robots: { red: [5, 0], ...FAR }, target: { at: [5, 15], color: 'red' } });
    board.currentTargetId = null;
    expect(chooseNextRound(board, 4)).toEqual({ needsNewBoard: true });
  });

  test('a target that cannot be solved is not offered', () => {
    const board = buildBoard({
      walls: [[5, 5, 'N'], [5, 5, 'E'], [5, 5, 'S'], [5, 5, 'W']],
      robots: { red: [0, 0], ...FAR },
      target: { at: [5, 5], color: 'red' },
    });
    board.currentTargetId = null;
    expect(chooseNextRound(board, 4, { timeLimitMs: 2000 })).toEqual({ needsNewBoard: true });
  });
});
