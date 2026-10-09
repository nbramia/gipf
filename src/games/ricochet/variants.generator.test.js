// Generator and board invariants for the non-default variants (12x12, fifth
// robot, diagonal barriers) over 300 seeds each.

import RicochetBoard from './RicochetBoard.js';
import { generateBoard } from './engine/generator.js';
import { CONFIGS, DEFAULT_CONFIG, configKey, normalizeConfig } from './engine/config.js';
import { COLORS, SHAPES, centerCellsOf, cellOf, rowOf, colOf } from './engine/geometry.js';

const N = 0; const E = 1; const S = 2; const W = 3;
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const VARIANTS = CONFIGS.filter(c => configKey(c) !== configKey(DEFAULT_CONFIG));
const SIZE12 = CONFIGS.filter(c => c.size === 12);

const wallBits = (walls, cell) => [0, 1, 2, 3].filter(d => walls[cell] & (1 << d));
const cheb = (a, b, size) => Math.max(Math.abs(rowOf(a, size) - rowOf(b, size)), Math.abs(colOf(a, size) - colOf(b, size)));
const manhattan = (a, b, size) => Math.abs(rowOf(a, size) - rowOf(b, size)) + Math.abs(colOf(a, size) - colOf(b, size));
const onRing = (cell, size) => {
  const r = rowOf(cell, size); const c = colOf(cell, size);
  return r === 0 || c === 0 || r === size - 1 || c === size - 1;
};
const quadrantOf = (cell, size) => {
  const h = size / 2;
  const top = rowOf(cell, size) < h; const left = colOf(cell, size) < h;
  return top ? (left ? 0 : 1) : (left ? 3 : 2);
};

describe.each(VARIANTS.map(c => [configKey(c), c]))('config %s', (_name, config) => {
  const { size } = config;
  const boards = SEEDS.map(seed => [seed, generateBoard(seed, config)]);
  const centre = centerCellsOf(size);
  const expectedTargets = size === 16 ? 17 : 9;

  test('is deterministic and does not depend on call order', () => {
    for (const [seed, board] of boards.slice(0, 60)) {
      const again = generateBoard(seed, { ...config });
      expect(Buffer.from(again.walls).toString('hex')).toBe(Buffer.from(board.walls).toString('hex'));
      expect(again.targets).toEqual(board.targets);
      expect(again.barriers).toEqual(board.barriers);
    }
    expect(Buffer.from(boards[0][1].walls).toString('hex')).not.toBe(Buffer.from(boards[1][1].walls).toString('hex'));
  });

  test('target count, colours, shapes and the single vortex', () => {
    for (const [seed, { targets }] of boards) {
      expect({ seed, n: targets.length }).toEqual({ seed, n: expectedTargets });
      expect(targets.map(t => t.id)).toEqual(Array.from({ length: expectedTargets }, (__, i) => i));
      const vortex = targets.filter(t => t.shape === 'vortex');
      expect({ seed, vortex: vortex.length }).toEqual({ seed, vortex: 1 });
      expect(vortex[0].color).toBeNull();
      const coloured = targets.filter(t => t.shape !== 'vortex');
      for (const t of coloured) {
        expect(COLORS).toContain(t.color);
        expect(SHAPES).toContain(t.shape);
      }
      if (size === 12) {
        // each colour twice, with two different shapes
        for (const color of COLORS) {
          const shapes = coloured.filter(t => t.color === color).map(t => t.shape);
          expect({ seed, color, n: shapes.length }).toEqual({ seed, color, n: 2 });
          expect(new Set(shapes).size).toBe(2);
        }
      } else {
        expect({ seed, pairs: new Set(coloured.map(t => `${t.color}/${t.shape}`)).size }).toEqual({ seed, pairs: 16 });
      }
    }
  });

  test('targets are L-corners, off the outer ring, clear of the centre and of each other', () => {
    for (const [seed, { walls, targets }] of boards) {
      for (const t of targets) {
        const bits = wallBits(walls, t.cell);
        const isL = bits.length === 2 && bits[0] % 2 !== bits[1] % 2;
        expect({ seed, id: t.id, isL }).toEqual({ seed, id: t.id, isL: true });
        expect({ seed, id: t.id, ring: onRing(t.cell, size) }).toEqual({ seed, id: t.id, ring: false });
        for (const c of centre) expect(cheb(t.cell, c, size)).toBeGreaterThan(1);
        for (const o of targets) {
          if (o.id !== t.id) expect({ seed, a: t.id, b: o.id, far: cheb(t.cell, o.cell, size) > 1 }).toEqual({ seed, a: t.id, b: o.id, far: true });
        }
      }
    }
  });

  test('walls are symmetric across every shared edge and the border is closed', () => {
    for (const [seed, { walls }] of boards.slice(0, 100)) {
      expect(walls.length).toBe(size * size);
      for (let cell = 0; cell < size * size; cell++) {
        for (let d = 0; d < 4; d++) {
          const row = rowOf(cell, size) + (d === N ? -1 : d === S ? 1 : 0);
          const col = colOf(cell, size) + (d === E ? 1 : d === W ? -1 : 0);
          const inside = row >= 0 && row < size && col >= 0 && col < size;
          const here = (walls[cell] & (1 << d)) !== 0;
          const expected = inside ? (walls[cellOf(row, col, size)] & (1 << ((d + 2) % 4))) !== 0 : true;
          expect({ seed, cell, d, here }).toEqual({ seed, cell, d, here: expected });
        }
      }
    }
  });

  test('the centre 2x2 block is solid and walled on every outside edge', () => {
    const h = size / 2;
    for (const [, { walls }] of boards.slice(0, 20)) {
      for (const cell of centre) expect(wallBits(walls, cell)).toEqual([0, 1, 2, 3]);
      for (const i of [h - 1, h]) {
        expect(walls[cellOf(h - 2, i, size)] & (1 << S)).toBeTruthy();
        expect(walls[cellOf(h + 1, i, size)] & (1 << N)).toBeTruthy();
        expect(walls[cellOf(i, h - 2, size)] & (1 << E)).toBeTruthy();
        expect(walls[cellOf(i, h + 1, size)] & (1 << W)).toBeTruthy();
      }
    }
  });

  test('diagonals: barrier count, placement rules and colour spread', () => {
    for (const [seed, { targets, barriers }] of boards) {
      if (!config.diagonals) { expect(barriers).toEqual([]); continue; }
      const perQuadrant = size === 16 ? 2 : 1;
      expect({ seed, n: barriers.length }).toEqual({ seed, n: perQuadrant * 4 });
      for (let q = 0; q < 4; q++) {
        expect({ seed, q, n: barriers.filter(b => quadrantOf(b.cell, size) === q).length }).toEqual({ seed, q, n: perQuadrant });
      }
      for (const b of barriers) {
        expect(['/', '\\']).toContain(b.orient);
        expect(COLORS).toContain(b.color);
        expect(targets.some(t => t.cell === b.cell)).toBe(false);
        expect(onRing(b.cell, size)).toBe(false);
        expect(centre).not.toContain(b.cell);
        for (const o of barriers) if (o !== b) expect(manhattan(b.cell, o.cell, size)).toBeGreaterThan(1);
      }
      // colours spread: every colour equally often
      for (const color of COLORS) {
        expect({ seed, color, n: barriers.filter(b => b.color === color).length }).toEqual({ seed, color, n: perQuadrant * 4 / 4 });
      }
      expect(new Set(barriers.map(b => b.cell)).size).toBe(barriers.length);
    }
  });

  test('robots start on distinct free cells; black exists only with the fifth robot', () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const board = new RicochetBoard({ seed, config, skipInitialHistory: true });
      const names = Object.keys(board.robots);
      expect(names).toEqual(config.fifthRobot ? [...COLORS, 'black'] : COLORS);
      const cells = Object.values(board.robots);
      expect(new Set(cells).size).toBe(cells.length);
      for (const c of cells) {
        expect(board.targets.some(t => t.cell === c)).toBe(false);
        expect(board.barriers.some(b => b.cell === c)).toBe(false);
        expect(centre).not.toContain(c);
      }
    }
  });
});

describe('12x12 structure', () => {
  const boards = SEEDS.map(seed => [seed, generateBoard(seed, { size: 12 })]);

  test('two coloured corners in every quadrant and the vortex in exactly one', () => {
    for (const [seed, { targets }] of boards) {
      const perQuadrant = [0, 0, 0, 0];
      const vortexQuadrants = new Set();
      for (const t of targets) {
        const q = quadrantOf(t.cell, 12);
        if (t.shape === 'vortex') vortexQuadrants.add(q);
        else perQuadrant[q]++;
      }
      expect({ seed, perQuadrant }).toEqual({ seed, perQuadrant: [2, 2, 2, 2] });
      expect({ seed, vortexQuadrants: vortexQuadrants.size }).toEqual({ seed, vortexQuadrants: 1 });
    }
  });

  test('one wall stub on each side of the board, perpendicular to the edge', () => {
    for (const [seed, { walls }] of boards) {
      const along = { top: 0, bottom: 0, left: 0, right: 0 };
      for (let i = 0; i < 11; i++) {
        if (walls[cellOf(0, i, 12)] & (1 << E)) along.top++;
        if (walls[cellOf(11, i, 12)] & (1 << E)) along.bottom++;
        if (walls[cellOf(i, 0, 12)] & (1 << S)) along.left++;
        if (walls[cellOf(i, 11, 12)] & (1 << S)) along.right++;
      }
      expect({ seed, along }).toEqual({ seed, along: { top: 1, bottom: 1, left: 1, right: 1 } });
    }
  });

  test('16x16 variants keep two stubs per side', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { walls } = generateBoard(seed, { size: 16, diagonals: true });
      let top = 0;
      for (let i = 0; i < 15; i++) if (walls[cellOf(0, i)] & (1 << E)) top++;
      expect(top).toBe(2);
    }
  });
});

describe('config handling', () => {
  test('missing fields default; unsupported sizes throw', () => {
    expect(normalizeConfig()).toEqual({ size: 16, fifthRobot: false, diagonals: false });
    expect(normalizeConfig({ size: 12 })).toEqual({ size: 12, fifthRobot: false, diagonals: false });
    expect(() => normalizeConfig({ size: 14 })).toThrow();
    expect(SIZE12).toHaveLength(4);
    expect(CONFIGS).toHaveLength(8);
  });

  test('barriers do not change the walls or targets of the same seed and size', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      for (const size of [16, 12]) {
        const plain = generateBoard(seed, { size });
        const diag = generateBoard(seed, { size, diagonals: true });
        expect(Buffer.from(diag.walls).toString('hex')).toBe(Buffer.from(plain.walls).toString('hex'));
        expect(diag.targets).toEqual(plain.targets);
      }
    }
  });
});
