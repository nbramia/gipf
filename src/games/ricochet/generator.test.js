import { generateBoard } from './engine/generator.js';
import { SIZE, COLORS, SHAPES, CENTER_CELLS, cellOf, rowOf, colOf } from './engine/geometry.js';

const N = 0; const E = 1; const S = 2; const W = 3;
const wallBits = (walls, cell) => [0, 1, 2, 3].filter(d => walls[cell] & (1 << d));
const quadrantOf = cell => (rowOf(cell) < 8 ? (colOf(cell) < 8 ? 0 : 1) : (colOf(cell) < 8 ? 3 : 2));
const chebyshev = (a, b) => Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));

const boards = Array.from({ length: 600 }, (_, i) => [i + 1, generateBoard(i + 1)]);

test('17 targets: each colour x shape once plus one vortex', () => {
  for (const [seed, { targets }] of boards) {
    expect({ seed, n: targets.length }).toEqual({ seed, n: 17 });
    const pairs = new Set();
    let vortex = 0;
    for (const t of targets) {
      if (t.shape === 'vortex') { vortex++; expect(t.color).toBeNull(); continue; }
      expect(COLORS).toContain(t.color);
      expect(SHAPES).toContain(t.shape);
      pairs.add(`${t.color}/${t.shape}`);
    }
    expect({ seed, vortex }).toEqual({ seed, vortex: 1 });
    expect({ seed, pairs: pairs.size }).toEqual({ seed, pairs: 16 });
    expect(targets.map(t => t.id)).toEqual(Array.from({ length: 17 }, (_, i) => i));
  }
});

test('every target cell is exactly an L of two perpendicular walls', () => {
  for (const [seed, { walls, targets }] of boards) {
    for (const t of targets) {
      const bits = wallBits(walls, t.cell);
      const ok = bits.length === 2 && bits[0] % 2 !== bits[1] % 2;
      expect({ seed, id: t.id, ok }).toEqual({ seed, id: t.id, ok: true });
    }
  }
});

test('walls are symmetric across every shared edge, and the border is closed', () => {
  for (const [seed, { walls }] of boards) {
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      for (let d = 0; d < 4; d++) {
        const row = rowOf(cell) + (d === N ? -1 : d === S ? 1 : 0);
        const col = colOf(cell) + (d === E ? 1 : d === W ? -1 : 0);
        const inside = row >= 0 && row < SIZE && col >= 0 && col < SIZE;
        const here = (walls[cell] & (1 << d)) !== 0;
        const expected = inside ? (walls[cellOf(row, col)] & (1 << ((d + 2) % 4))) !== 0 : true;
        expect({ seed, cell, d, here }).toEqual({ seed, cell, d, here: expected });
      }
    }
  }
});

test('the centre block is solid and walled on every outside edge', () => {
  const { walls } = boards[0][1];
  for (const cell of CENTER_CELLS) expect(wallBits(walls, cell)).toEqual([0, 1, 2, 3]);
  for (let i = 7; i <= 8; i++) {
    expect(walls[cellOf(6, i)] & (1 << S)).toBeTruthy();
    expect(walls[cellOf(9, i)] & (1 << N)).toBeTruthy();
    expect(walls[cellOf(i, 6)] & (1 << E)).toBeTruthy();
    expect(walls[cellOf(i, 9)] & (1 << W)).toBeTruthy();
  }
});

test('quadrants: one target of each colour per quadrant, vortex in exactly one', () => {
  for (const [seed, { targets }] of boards) {
    const vortexQuadrants = new Set();
    for (let q = 0; q < 4; q++) {
      const inQ = targets.filter(t => quadrantOf(t.cell) === q);
      const coloured = inQ.filter(t => t.color);
      expect({ seed, q, n: coloured.length }).toEqual({ seed, q, n: 4 });
      expect(new Set(coloured.map(t => t.color)).size).toBe(4);
      if (inQ.some(t => !t.color)) vortexQuadrants.add(q);
    }
    expect({ seed, v: vortexQuadrants.size }).toEqual({ seed, v: 1 });
  }
});

test('each board side carries one stub per quadrant, clear of the corners and the seam', () => {
  // Walls on the outer ring that run perpendicular to the border, i.e. between
  // two neighbouring border cells. stubs.X lists the lower cell index of each.
  for (const [seed, { walls }] of boards) {
    const stubs = { N: [], E: [], S: [], W: [] };
    for (let i = 0; i < SIZE - 1; i++) {
      if (walls[cellOf(0, i)] & (1 << E)) stubs.N.push(i);
      if (walls[cellOf(SIZE - 1, i)] & (1 << E)) stubs.S.push(i);
      if (walls[cellOf(i, 0)] & (1 << S)) stubs.W.push(i);
      if (walls[cellOf(i, SIZE - 1)] & (1 << S)) stubs.E.push(i);
    }
    for (const side of ['N', 'E', 'S', 'W']) {
      expect({ seed, side, n: stubs[side].length }).toEqual({ seed, side, n: 2 });
      const halves = stubs[side].map(i => (i < 8 ? 0 : 1)).sort();
      expect({ seed, side, halves }).toEqual({ seed, side, halves: [0, 1] });
      for (const i of stubs[side]) {
        expect(i).toBeGreaterThanOrEqual(1);
        expect(i).toBeLessThanOrEqual(SIZE - 3);
        expect(i).not.toBe(7);
      }
    }
  }
});

test('no other walls: only edges, centre, 17 L-corners (2 walls) and 8 stubs', () => {
  for (const [seed, { walls }] of boards) {
    let interior = 0;
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      if (CENTER_CELLS.includes(cell)) continue;
      for (const d of [E, S]) {
        const row = rowOf(cell) + (d === S ? 1 : 0);
        const col = colOf(cell) + (d === E ? 1 : 0);
        if (row >= SIZE || col >= SIZE) continue;
        if (CENTER_CELLS.includes(cellOf(row, col))) continue;
        if (walls[cell] & (1 << d)) interior++;
      }
    }
    expect({ seed, interior }).toEqual({ seed, interior: 17 * 2 + 8 });
  }
});

test('targets are off the outer ring, clear of the centre block and of each other', () => {
  for (const [seed, { targets }] of boards) {
    for (const t of targets) {
      const r = rowOf(t.cell);
      const c = colOf(t.cell);
      expect({ seed, ring: r === 0 || c === 0 || r === 15 || c === 15 }).toEqual({ seed, ring: false });
      for (const cc of CENTER_CELLS) expect({ seed, ok: chebyshev(t.cell, cc) >= 2 }).toEqual({ seed, ok: true });
    }
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        expect({ seed, i, j, ok: chebyshev(targets[i].cell, targets[j].cell) >= 2 }).toEqual({ seed, i, j, ok: true });
      }
    }
  }
});

test('deterministic per seed, and seeds give different boards', () => {
  for (const seed of [1, 2, 77, 4242]) {
    const a = generateBoard(seed);
    const b = generateBoard(seed);
    expect(Array.from(a.walls)).toEqual(Array.from(b.walls));
    expect(a.targets).toEqual(b.targets);
  }
  const layouts = new Set(boards.map(([, b]) => b.targets.map(t => t.cell).join(',')));
  expect(layouts.size).toBeGreaterThan(590);
});
