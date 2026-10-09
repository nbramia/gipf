// The default configuration (16x16, four robots, no diagonals) must behave
// exactly as it did before the board variants existed. fixtures/golden-default.json
// was recorded from that engine (scripts/ricochet-golden.mjs): never regenerate it
// to make this test pass.

import RicochetBoard from './RicochetBoard.js';
import { solve } from './engine/solver.js';
import { generateBoard } from './engine/generator.js';
import golden from './fixtures/golden-default.json';

const hex = walls => Buffer.from(walls).toString('hex');
const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

test('the fixture covers seeds 1-200', () => {
  expect(Object.keys(golden)).toHaveLength(200);
});

test('generateBoard(seed) matches the golden walls and targets for seeds 1-200', () => {
  for (const seed of seeds) {
    const { walls, targets } = generateBoard(seed);
    expect({ seed, walls: hex(walls) }).toEqual({ seed, walls: golden[seed].walls });
    expect({ seed, targets }).toEqual({ seed, targets: golden[seed].targets });
  }
});

test('new RicochetBoard({seed}) keeps the golden robot placement and rng stream', () => {
  for (const seed of seeds) {
    const board = new RicochetBoard({ seed, skipInitialHistory: true });
    expect({ seed, robots: board.robots }).toEqual({ seed, robots: golden[seed].robots });
    expect({ seed, rng: board.rngState }).toEqual({ seed, rng: golden[seed].rngState });
  }
});

test('the solver finds the golden optimal length for every target, seeds 1-200', () => {
  for (const seed of seeds) {
    const board = new RicochetBoard({ seed, skipInitialHistory: true });
    const optimal = board.targets.map(t => {
      const r = solve({ walls: board.walls, robots: board.robots, target: t }, { maxDepth: 14 });
      return r ? r.length : null;
    });
    expect({ seed, optimal }).toEqual({ seed, optimal: golden[seed].optimal });
  }
});
