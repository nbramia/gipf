// The solver against an independent breadth-first oracle, for all eight configs.
//
// The oracle shares only the slide primitive (slideCells, with the board layout)
// with the engine; the search, goal test, state handling and ordering are its
// own. For every sampled round the solver's length L must be (a) reachable: its
// moves replayed with the oracle's own move application reach the goal in exactly
// L steps, and (b) minimal: a breadth-first search finds nothing in L-1 steps.

import RicochetBoard from './RicochetBoard.js';
import { buildBoard } from './testHelpers.js';
import { solve } from './engine/solver.js';
import { CONFIGS, configKey } from './engine/config.js';
import { ALL_ROBOTS, DIRS, makeLayout, slideCells } from './engine/geometry.js';

jest.setTimeout(300000);

const ROUNDS_PER_CONFIG = 150;
const MAX_LENGTH = 6;
const MAX_LENGTH_6 = 40; // length-6 proofs are the expensive ones; cap them per config

function makeOracle(board) {
  const layout = makeLayout(board.size, board.walls, board.barriers);
  const n = board.robotNames.length;
  const cells = board.size * board.size;

  const move = (state, i, d) => {
    const occ = new Uint8Array(cells);
    for (let j = 0; j < n; j++) if (j !== i) occ[state[j]] = 1;
    const route = slideCells(layout, state[i], d, i, occ);
    return route ? route[route.length - 1] : state[i];
  };

  const isGoal = (state, target) => (target.color == null
    ? state.includes(target.cell)
    : state[ALL_ROBOTS.indexOf(target.color)] === target.cell);

  // Smallest depth <= limit at which the goal appears, or -1.
  const optimum = (start, target, limit) => {
    if (isGoal(start, target)) return 0;
    let frontier = [start];
    const seen = new Set([start.join(',')]);
    for (let depth = 1; depth <= limit; depth++) {
      const next = [];
      for (const state of frontier) {
        for (let i = 0; i < n; i++) {
          for (let d = 0; d < 4; d++) {
            const to = move(state, i, d);
            if (to === state[i]) continue;
            const child = state.slice();
            child[i] = to;
            if (isGoal(child, target)) return depth;
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
  };

  const replay = (start, target, moves) => {
    const state = start.slice();
    moves.forEach(m => {
      const i = ALL_ROBOTS.indexOf(m.robot);
      const to = move(state, i, DIRS.indexOf(m.dir));
      expect(to).not.toBe(state[i]); // every solver move really moves
      state[i] = to;
    });
    return isGoal(state, target);
  };

  return { optimum, replay };
}

describe.each(CONFIGS.map(c => [configKey(c), c]))('solver vs oracle, config %s', (_name, config) => {
  test(`matches the oracle on ${ROUNDS_PER_CONFIG} rounds of optimal length <= ${MAX_LENGTH}`, () => {
    let checked = 0;
    let six = 0;
    let beyond = 0;
    const lengths = new Map();
    for (let seed = 1; checked < ROUNDS_PER_CONFIG && seed < 400; seed++) {
      const board = new RicochetBoard({ seed, config, skipInitialHistory: true });
      const oracle = makeOracle(board);
      const start = board.robotNames.map(r => board.robots[r]);
      for (const target of board.targets) {
        if (checked >= ROUNDS_PER_CONFIG) break;
        const result = solve(
          { walls: board.walls, robots: board.robots, target, size: board.size, barriers: board.barriers },
          { maxDepth: MAX_LENGTH },
        );
        if (!result) {
          // nothing within 6 moves: the oracle agrees that nothing is within 4
          if (beyond++ < 60) expect(oracle.optimum(start, target, 4)).toBe(-1);
          continue;
        }
        expect(result.timedOut).toBeUndefined();
        if (result.length === MAX_LENGTH) {
          if (six >= MAX_LENGTH_6) continue;
          six++;
        }
        expect(oracle.replay(start, target, result.moves)).toBe(true);
        expect(result.moves).toHaveLength(result.length);
        expect({ seed, id: target.id, shorter: oracle.optimum(start, target, result.length - 1) })
          .toEqual({ seed, id: target.id, shorter: -1 });
        lengths.set(result.length, (lengths.get(result.length) || 0) + 1);
        checked++;
      }
    }
    expect(checked).toBe(ROUNDS_PER_CONFIG);
    // the sample is not trivial: it spans several lengths
    expect(lengths.size).toBeGreaterThanOrEqual(3);
  });

  test('solutions replayed on a real RicochetBoard solve the round', () => {
    let replayed = 0;
    for (let seed = 500; replayed < 12 && seed < 600; seed++) {
      const board = new RicochetBoard({ seed, config, skipInitialHistory: true });
      const target = board.targets[seed % board.targets.length];
      const result = solve(
        { walls: board.walls, robots: board.robots, target, size: board.size, barriers: board.barriers },
        { maxDepth: 5 },
      );
      if (!result || result.length < 1) continue;
      board.startRound(target.id);
      for (const m of result.moves) expect(board.applyMove(m)).toBeTruthy();
      expect(board.isSolved()).toBe(true);
      expect(board.moves).toHaveLength(result.length);
      replayed++;
    }
    expect(replayed).toBe(12);
  });
});

describe('solver details', () => {
  test('black solves the vortex but never a coloured target', () => {
    const config = { size: 16, fifthRobot: true, diagonals: false };
    const layout = color => buildBoard({
      config,
      walls: [[5, 10, 'E']],
      robots: { red: [0, 0], green: [15, 0], blue: [15, 15], yellow: [0, 15], black: [5, 3] },
      target: { at: [5, 10], color },
    });
    const run = (b, maxDepth) => solve(
      { walls: b.walls, robots: b.robots, target: b.getTarget(), size: 16, barriers: [] },
      { maxDepth },
    );
    expect(run(layout(null), 3).moves).toEqual([{ robot: 'black', dir: 'E' }]);
    // black's slide onto a red target is not a solution: red has to get there
    const red = run(layout('red'), 8);
    expect(red.length).toBeGreaterThan(1);
    expect(red.moves[red.moves.length - 1].robot).toBe('red');
  });

  test('black never counts as the goal robot of a coloured target', () => {
    const board = new RicochetBoard({
      seed: 7,
      config: { size: 12, fifthRobot: true, diagonals: false },
      skipInitialHistory: true,
    });
    for (const target of board.targets.filter(t => t.color)) {
      const result = solve({ walls: board.walls, robots: board.robots, target, size: 12, barriers: [] }, { maxDepth: 6 });
      if (!result) continue;
      const b = board.clone();
      b.startRound(target.id);
      for (const m of result.moves) b.applyMove(m);
      expect(b.isSolved()).toBe(true);
      // the last move is made by the target's colour
      expect(result.moves[result.moves.length - 1].robot).toBe(target.color);
    }
  });
});
