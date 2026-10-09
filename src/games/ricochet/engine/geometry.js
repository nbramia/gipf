// geometry.js
// Shared grid primitives for Ricochet: cell indexing, directions, wall bitmasks
// and the robot-free slide used by the board, generator and solver.
//
// A cell is `row * SIZE + col`. `walls` is a 256-entry byte array; bit `d` of
// walls[cell] is set when there is a wall on side `d` of that cell. Walls are
// always stored on both sides of the edge, and the centre 2x2 block is encoded
// as walls too (every side of every block cell, plus the facing side of each
// neighbour), so a slide never needs a separate "blocked cell" test.

export const SIZE = 16;
export const CELLS = SIZE * SIZE;

export const DIRS = ['N', 'E', 'S', 'W'];
export const DIR_INDEX = { N: 0, E: 1, S: 2, W: 3 };
export const DIR_STEP = [-SIZE, 1, SIZE, -1];
export const OPPOSITE = [2, 3, 0, 1];

export const ROBOTS = ['red', 'green', 'blue', 'yellow'];
export const COLORS = ROBOTS;
export const SHAPES = ['circle', 'triangle', 'square', 'hexagon'];
export const VORTEX = 'vortex';

export const CENTER_CELLS = [7 * SIZE + 7, 7 * SIZE + 8, 8 * SIZE + 7, 8 * SIZE + 8];

export const cellOf = (row, col) => row * SIZE + col;
export const rowOf = cell => (cell / SIZE) | 0;
export const colOf = cell => cell % SIZE;

export function hasWall(walls, cell, dir) {
  return (walls[cell] & (1 << dir)) !== 0;
}

// Adds a wall on `dir` of `cell` and the matching wall on the neighbour. A wall
// on the board edge has no neighbour.
export function addWall(walls, cell, dir) {
  walls[cell] |= 1 << dir;
  const row = rowOf(cell) + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
  const col = colOf(cell) + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
  if (row >= 0 && row < SIZE && col >= 0 && col < SIZE) {
    walls[cellOf(row, col)] |= 1 << OPPOSITE[dir];
  }
}

// Board edges and the walled centre block, nothing else.
export function emptyWalls() {
  const walls = new Uint8Array(CELLS);
  for (let i = 0; i < SIZE; i++) {
    addWall(walls, cellOf(0, i), 0);
    addWall(walls, cellOf(SIZE - 1, i), 2);
    addWall(walls, cellOf(i, 0), 3);
    addWall(walls, cellOf(i, SIZE - 1), 1);
  }
  for (const cell of CENTER_CELLS) {
    for (let d = 0; d < 4; d++) addWall(walls, cell, d);
  }
  return walls;
}

// Where a robot sliding from `cell` in `dir` stops if no other robot is in the
// way. `occupied` (optional) is a cell->truthy lookup of blocking robots.
export function slide(walls, cell, dir, occupied = null) {
  const step = DIR_STEP[dir];
  const bit = 1 << dir;
  let cur = cell;
  while ((walls[cur] & bit) === 0) {
    const next = cur + step;
    if (occupied && occupied[next]) break;
    cur = next;
  }
  return cur;
}
