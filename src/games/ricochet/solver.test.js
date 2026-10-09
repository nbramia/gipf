import RicochetBoard from './RicochetBoard.js';
import { solve } from './engine/solver.js';
import { generateBoard } from './engine/generator.js';
import { buildBoard, FAR } from './testHelpers.js';

const NAMES = ['red', 'green', 'blue', 'yellow'];

// ---- independent oracle ----------------------------------------------------
// Plain breadth-first search over (red, green, blue, yellow) cells. It shares
// only the wall bytes with the solver; sliding is re-derived here cell by cell.

function oracleSlide(walls, from, dir, others) {
  let row = Math.floor(from / 16);
  let col = from % 16;
  const dr = [-1, 0, 1, 0][dir];
  const dc = [0, 1, 0, -1][dir];
  for (;;) {
    if (walls[row * 16 + col] & (1 << dir)) break;
    const nr = row + dr;
    const nc = col + dc;
    if (others.includes(nr * 16 + nc)) break;
    row = nr;
    col = nc;
  }
  return row * 16 + col;
}

// Minimum number of moves, searching at most `limit` deep; -1 if none that short.
function oracleOptimum(walls, robots, target, limit) {
  const goal = state => (target.color == null
    ? state.includes(target.cell)
    : state[NAMES.indexOf(target.color)] === target.cell);
  let frontier = [NAMES.map(n => robots[n])];
  if (goal(frontier[0])) return 0;
  const seen = new Set([frontier[0].join(',')]);
  for (let depth = 1; depth <= limit; depth++) {
    const next = [];
    for (const state of frontier) {
      for (let i = 0; i < 4; i++) {
        const others = state.filter((_, j) => j !== i);
        for (let d = 0; d < 4; d++) {
          const to = oracleSlide(walls, state[i], d, others);
          if (to === state[i]) continue;
          const child = state.slice();
          child[i] = to;
          if (goal(child)) return depth;
          const key = child.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return -1;
}

// Replays a solution on a real RicochetBoard; returns the finished board.
function replay(board, target, moves) {
  const b = board.clone();
  b.startRound(target.id);
  for (const m of moves) expect(b.applyMove(m)).toBeTruthy();
  return b;
}

describe('hand-built boards with known optimum', () => {
  const solveBoard = board => solve(
    { walls: board.walls, robots: board.robots, target: board.getTarget() },
    { maxDepth: 12 },
  );

  test('one move: a wall-free slide into a corner', () => {
    const board = buildBoard({ robots: { red: [0, 0], ...FAR, yellow: [3, 3] }, target: { at: [0, 15], color: 'red' } });
    expect(solveBoard(board).length).toBe(1);
  });

  test('two moves: slide then turn', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target: { at: [15, 14], color: 'red' } });
    // reach (15,14) needs a blocker at (15,15): blue is already there
    const result = solveBoard(board);
    expect(result.length).toBe(2);
    expect(oracleOptimum(board.walls, board.robots, board.getTarget(), 4)).toBe(2);
  });

  test('a target only reachable with a helper robot moving first', () => {
    // red on row 5 can only stop at (5,10) against a robot at (5,11);
    // green parks there with a wall under (5,11): green S from (0,11) stops on it.
    const layout = {
      walls: [[5, 11, 'S']],
      robots: { red: [5, 0], green: [0, 11], blue: [15, 15], yellow: [15, 0] },
      target: { at: [5, 10], color: 'red' },
    };
    const board = buildBoard(layout);
    const result = solveBoard(board);
    expect(result.length).toBe(2);
    expect(result.moves[0].robot).toBe('green');
    expect(result.moves[1]).toEqual({ robot: 'red', dir: 'E' });
    expect(oracleOptimum(board.walls, board.robots, board.getTarget(), 4)).toBe(2);
  });

  test('a helper needing two moves of its own', () => {
    const layout = {
      walls: [[5, 11, 'S'], [0, 11, 'E']],
      robots: { red: [5, 0], green: [0, 5], blue: [15, 15], yellow: [15, 0] },
      target: { at: [5, 10], color: 'red' },
    };
    const board = buildBoard(layout);
    const result = solveBoard(board);
    expect(result.length).toBe(3);
    expect(oracleOptimum(board.walls, board.robots, board.getTarget(), 5)).toBe(3);
    const done = replay(board, board.getTarget(), result.moves);
    expect(done.isSolved()).toBe(true);
  });

  test('the vortex is claimed by whichever robot gets there first', () => {
    const board = buildBoard({
      robots: { red: [2, 2], green: [5, 0], blue: [15, 15], yellow: [0, 15] },
      target: { at: [5, 15], color: null },
    });
    const result = solveBoard(board);
    expect(result).toEqual({ moves: [{ robot: 'green', dir: 'E' }], length: 1 });
  });

  test('a robot already on the target is a zero-move solution', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target: { at: [5, 5], color: 'red' } });
    expect(solveBoard(board)).toEqual({ moves: [], length: 0 });
  });

  test('null when nothing within maxDepth: an enclosed target', () => {
    // (5,5) walled on all four sides: no robot can ever stop there
    const board = buildBoard({
      walls: [[5, 5, 'N'], [5, 5, 'E'], [5, 5, 'S'], [5, 5, 'W']],
      robots: { red: [0, 0], ...FAR },
      target: { at: [5, 5], color: 'red' },
    });
    expect(solve({ walls: board.walls, robots: board.robots, target: board.getTarget() }, { maxDepth: 6 })).toBeNull();
  });

  test('maxDepth below the optimum yields null', () => {
    const board = buildBoard({ robots: { red: [5, 5], ...FAR }, target: { at: [15, 14], color: 'red' } });
    expect(solve({ walls: board.walls, robots: board.robots, target: board.getTarget() }, { maxDepth: 1 })).toBeNull();
  });
});

describe('optimality against a breadth-first oracle', () => {
  test('matches the oracle on 200+ random generated rounds (optimum <= 6)', () => {
    let checked = 0;
    let withHelpers = 0;
    for (let seed = 1; seed <= 400 && checked < 220; seed++) {
      const board = new RicochetBoard({ seed, skipInitialHistory: true });
      for (const target of board.targets) {
        if (checked >= 220) break;
        const result = solve({ walls: board.walls, robots: board.robots, target }, { maxDepth: 6 });
        if (!result || result.timedOut) continue; // optimum above 6
        // the oracle must find nothing shorter and must find exactly this length
        const optimum = oracleOptimum(board.walls, board.robots, target, result.length);
        expect({ seed, id: target.id, solver: result.length }).toEqual({ seed, id: target.id, solver: optimum });
        // and the sequence is playable and ends solved
        const done = replay(board, target, result.moves);
        expect(done.isSolved()).toBe(true);
        expect(result.moves).toHaveLength(result.length);
        if (result.moves.some(m => target.color && m.robot !== target.color)) withHelpers++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(200);
    // make sure the sample really exercises helper-robot solutions
    expect(withHelpers).toBeGreaterThan(20);
  });

  test('when the solver says optimum > 6 the oracle finds nothing within 6', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked < 12; seed++) {
      const board = new RicochetBoard({ seed, skipInitialHistory: true });
      for (const target of board.targets) {
        if (checked >= 12) break;
        const result = solve({ walls: board.walls, robots: board.robots, target }, { maxDepth: 7 });
        if (result && !result.timedOut && result.length === 7) {
          expect(oracleOptimum(board.walls, board.robots, target, 6)).toBe(-1);
          expect(oracleOptimum(board.walls, board.robots, target, 7)).toBe(7);
          checked++;
        }
      }
    }
    expect(checked).toBe(12);
  });

  test('longer solutions replay legally and end solved', () => {
    for (const seed of [3, 11, 19]) {
      const { walls, targets } = generateBoard(seed);
      const board = new RicochetBoard({ seed, walls, targets, skipInitialHistory: true });
      for (const target of targets.slice(0, 6)) {
        const result = solve({ walls, robots: board.robots, target }, { maxDepth: 14, timeLimitMs: 4000 });
        if (!result || result.timedOut) continue;
        expect(replay(board, target, result.moves).isSolved()).toBe(true);
      }
    }
  });
});

describe('time limit', () => {
  test('a hard round returns { timedOut: true } promptly', () => {
    // seed 10, target 7: optimal length 15, well over a second to prove
    const board = new RicochetBoard({ seed: 10, skipInitialHistory: true });
    const t0 = performance.now();
    const result = solve({ walls: board.walls, robots: board.robots, target: board.targets[7] }, { timeLimitMs: 25 });
    const elapsed = performance.now() - t0;
    expect(result).toEqual({ timedOut: true });
    expect(elapsed).toBeLessThan(500);
  });

  test('the same round solves optimally given enough time', () => {
    const board = new RicochetBoard({ seed: 10, skipInitialHistory: true });
    const result = solve({ walls: board.walls, robots: board.robots, target: board.targets[7] }, { timeLimitMs: 20000 });
    expect(result.length).toBe(15);
    expect(replay(board, board.targets[7], result.moves).isSolved()).toBe(true);
  }, 30000);

  test('the transposition table does not leak between calls', () => {
    const a = new RicochetBoard({ seed: 4, skipInitialHistory: true });
    const b = new RicochetBoard({ seed: 5, skipInitialHistory: true });
    const first = solve({ walls: a.walls, robots: a.robots, target: a.targets[3] }, { maxDepth: 9 });
    solve({ walls: b.walls, robots: b.robots, target: b.targets[3] }, { maxDepth: 9 });
    const again = solve({ walls: a.walls, robots: a.robots, target: a.targets[3] }, { maxDepth: 9 });
    expect(again).toEqual(first);
  });
});
