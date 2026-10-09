// geometry.js
// Shared grid primitives for Ricochet: cell indexing, directions, wall bitmasks
// and the slide used by the board, generator and solver.
//
// A cell is `row * size + col` (size 16 or 12; the exported SIZE/CELLS describe
// the default 16x16 board, and every helper takes an optional `size`). `walls`
// is a byte array; bit `d` of walls[cell] is set when there is a wall on side
// `d` of that cell. Walls are always stored on both sides of the edge, and the
// centre 2x2 block is encoded as walls too (every side of every block cell, plus
// the facing side of each neighbour), so a slide never needs a separate
// "blocked cell" test.

export const SIZE = 16;
export const CELLS = SIZE * SIZE;

export const DIRS = ['N', 'E', 'S', 'W'];
export const DIR_INDEX = { N: 0, E: 1, S: 2, W: 3 };
export const DIR_STEP = [-SIZE, 1, SIZE, -1];
export const OPPOSITE = [2, 3, 0, 1];

export const ROBOTS = ['red', 'green', 'blue', 'yellow'];
export const COLORS = ROBOTS;
export const BLACK = 'black';
// Robot order with the optional fifth robot last. Index 4 (black) matches no barrier colour.
export const ALL_ROBOTS = [...ROBOTS, BLACK];
export const SHAPES = ['circle', 'triangle', 'square', 'hexagon'];
export const VORTEX = 'vortex';

export const cellsOf = size => size * size;
export const stepsOf = size => [-size, 1, size, -1];
export const centerCellsOf = size => {
  const h = size / 2;
  return [(h - 1) * size + h - 1, (h - 1) * size + h, h * size + h - 1, h * size + h];
};

export const CENTER_CELLS = centerCellsOf(SIZE);

export const cellOf = (row, col, size = SIZE) => row * size + col;
export const rowOf = (cell, size = SIZE) => (cell / size) | 0;
export const colOf = (cell, size = SIZE) => cell % size;

export function hasWall(walls, cell, dir) {
  return (walls[cell] & (1 << dir)) !== 0;
}

// Adds a wall on `dir` of `cell` and the matching wall on the neighbour. A wall
// on the board edge has no neighbour.
export function addWall(walls, cell, dir, size = SIZE) {
  walls[cell] |= 1 << dir;
  const row = rowOf(cell, size) + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
  const col = colOf(cell, size) + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
  if (row >= 0 && row < size && col >= 0 && col < size) {
    walls[cellOf(row, col, size)] |= 1 << OPPOSITE[dir];
  }
}

// Board edges and the walled centre block, nothing else.
export function emptyWalls(size = SIZE) {
  const walls = new Uint8Array(size * size);
  for (let i = 0; i < size; i++) {
    addWall(walls, cellOf(0, i, size), 0, size);
    addWall(walls, cellOf(size - 1, i, size), 2, size);
    addWall(walls, cellOf(i, 0, size), 3, size);
    addWall(walls, cellOf(i, size - 1, size), 1, size);
  }
  for (const cell of centerCellsOf(size)) {
    for (let d = 0; d < 4; d++) addWall(walls, cell, d, size);
  }
  return walls;
}

// Where a robot sliding from `cell` in `dir` stops if no other robot is in the
// way and there are no diagonal barriers. `occupied` (optional) is a
// cell->truthy lookup of blocking robots.
export function slide(walls, cell, dir, occupied = null, size = SIZE) {
  const step = dir === 0 ? -size : dir === 2 ? size : dir === 1 ? 1 : -1;
  const bit = 1 << dir;
  let cur = cell;
  while ((walls[cur] & bit) === 0) {
    const next = cur + step;
    if (occupied && occupied[next]) break;
    cur = next;
  }
  return cur;
}

// ---- diagonal barriers -------------------------------------------------------

// A barrier is { cell, orient: '/' | '\\', color }. Directions are N0 E1 S2 W3.
// '/' turns N->E, E->N, S->W, W->S; '\' turns N->W, W->N, S->E, E->S.
export const ORIENTS = ['/', '\\'];
const DEFLECT = [null, [1, 0, 3, 2], [3, 2, 1, 0]];

// What the slide code needs: size, walls and per-cell barrier tables
// (`diag`: 0 none, 1 '/', 2 '\'; `diagColor`: robot-colour index 0-3).
// `diag` is null when the board has no barriers.
export function makeLayout(size, walls, barriers = []) {
  const steps = stepsOf(size);
  if (!barriers || barriers.length === 0) return { size, walls, diag: null, diagColor: null, steps };
  const diag = new Uint8Array(size * size);
  const diagColor = new Uint8Array(size * size);
  for (const b of barriers) {
    diag[b.cell] = b.orient === '/' ? 1 : 2;
    diagColor[b.cell] = ROBOTS.indexOf(b.color);
  }
  return { size, walls, diag, diagColor, steps };
}

// The raw route of a slide from `cell` heading `dir`, for a robot of colour
// index `color` (0-3, or 4 for black), before the no-stopping-on-a-barrier rule:
// every cell entered, in order, starting with `cell`. `occupied` is a
// cell->truthy lookup of blocking robots and must not include the mover. If the
// route would circle forever (it re-enters a (cell, direction) state) it is
// returned up to that repeat with `loop: true`.
export function slideTrace(layout, cell, dir, color, occupied = null) {
  const { walls, diag, diagColor, steps } = layout;
  const cells = [cell];
  let cur = cell;
  let d = dir;
  let seen = null;
  for (;;) {
    if ((walls[cur] & (1 << d)) !== 0) break;
    const next = cur + steps[d];
    if (occupied && occupied[next]) break;
    cur = next;
    cells.push(cur);
    if (diag !== null && diag[cur] !== 0 && diagColor[cur] !== color) {
      d = DEFLECT[diag[cur]][d];
      const key = cur * 4 + d;
      if (seen === null) seen = [key];
      else if (seen.includes(key)) return { cells, loop: true };
      else seen.push(key);
    }
  }
  return { cells, loop: false };
}

// Applies the no-stopping rule to a route: a robot may not end on a barrier cell,
// so it backs up to the last non-barrier cell it passed. Returns the cells the
// robot moves through (start first, stop last), or null if the move is illegal
// (the route loops, or the robot would end where it started).
export function finishRoute(layout, cells, loop) {
  if (loop) return null;
  const { diag } = layout;
  let end = cells.length;
  if (diag !== null) while (end > 1 && diag[cells[end - 1]] !== 0) end--;
  if (end <= 1 || cells[end - 1] === cells[0]) return null;
  return end === cells.length ? cells : cells.slice(0, end);
}

// Every cell the robot moves through, or null if the move is illegal.
// `occupied` must not include the mover itself.
export function slideCells(layout, cell, dir, color, occupied = null) {
  const t = slideTrace(layout, cell, dir, color, occupied);
  return finishRoute(layout, t.cells, t.loop);
}

// The corner points of a route: start, each cell where the robot turned, stop.
export function waypoints(cells) {
  const out = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    if (cells[i] - cells[i - 1] !== cells[i + 1] - cells[i]) out.push(cells[i]);
  }
  out.push(cells[cells.length - 1]);
  return out;
}
