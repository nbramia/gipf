// Test fixtures: hand-built boards on the bare grid (edges + centre block).

import RicochetBoard from './RicochetBoard.js';
import { emptyWalls, addWall, DIR_INDEX, cellOf } from './engine/geometry.js';

// walls: [[row, col, 'N'|'E'|'S'|'W']]; robots: {name: [row, col]};
// target: { at: [row, col], color } (color null = vortex).
// Optional: config ({ size, fifthRobot, diagonals }) and barriers
// [[row, col, '/' | '\\', color]] for the variants.
export function buildBoard({ walls = [], robots, target, config = null, barriers = [] }) {
  const size = config && config.size ? config.size : 16;
  const w = emptyWalls(size);
  for (const [r, c, d] of walls) addWall(w, cellOf(r, c, size), DIR_INDEX[d], size);
  const cells = {};
  for (const [name, [r, c]] of Object.entries(robots)) cells[name] = cellOf(r, c, size);
  const board = new RicochetBoard({
    walls: w,
    robots: cells,
    config,
    barriers: barriers.map(([r, c, orient, color]) => ({ cell: cellOf(r, c, size), orient, color })),
    targets: [{ id: 0, color: target.color, shape: target.color ? 'circle' : 'vortex', cell: cellOf(...target.at, size) }],
  });
  board.startRound(0);
  return board;
}

// Parking spots in three corners for robots that should stay out of the way.
export const FAR = { green: [15, 0], blue: [15, 15], yellow: [0, 15] };
