// generator.js
// Procedural Ricochet board: four 8x8 quadrants, each generated in one canonical
// orientation (top-left, outer edges north and west, centre block at the inner
// corner) and rotated into place around the centre. Pure and deterministic per seed.

import {
  SIZE, COLORS, SHAPES, VORTEX, CENTER_CELLS,
  cellOf, rowOf, colOf, addWall, emptyWalls,
} from './geometry.js';

const HALF = SIZE / 2;

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let n = t;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const randInt = (random, lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

// Rotates a canonical (top-left quadrant) cell and direction clockwise `turns`
// quarter turns about the board centre.
function rotateCell(row, col, turns) {
  let r = row;
  let c = col;
  for (let i = 0; i < turns; i++) [r, c] = [c, SIZE - 1 - r];
  return cellOf(r, c);
}
const rotateDir = (dir, turns) => (dir + turns) % 4;

const tooClose = (a, b) =>
  Math.abs(rowOf(a) - rowOf(b)) <= 1 && Math.abs(colOf(a) - colOf(b)) <= 1;

// Local (canonical) cells an L-corner may occupy: off the outer row/column and
// not touching (even diagonally) the centre block, which sits at local (7,7).
function cornerCandidates() {
  const out = [];
  for (let r = 1; r < HALF; r++) {
    for (let c = 1; c < HALF; c++) {
      if (r >= HALF - 2 && c >= HALF - 2) continue;
      out.push([r, c]);
    }
  }
  return out;
}
const CANDIDATES = cornerCandidates();

// Picks `count` mutually non-adjacent corners for one quadrant, also clear of
// the global cells already taken by earlier quadrants. Always succeeds within a
// few attempts; the candidate area is 46 cells for at most 5 corners.
function pickCorners(count, turns, taken, random) {
  for (;;) {
    const chosen = [];
    for (const [r, c] of shuffle(CANDIDATES, random)) {
      const cell = rotateCell(r, c, turns);
      if (taken.some(t => tooClose(t, cell)) || chosen.some(o => tooClose(o.cell, cell))) continue;
      chosen.push({ cell, r, c });
      if (chosen.length === count) return chosen;
    }
  }
}

export function generateBoard(seed) {
  const random = mulberry32(seed);
  const walls = emptyWalls();
  const targets = [];

  // Latin square over (colour, quadrant) -> shape, so every colour x shape pair
  // appears exactly once on the board.
  const shapeOrder = shuffle(SHAPES, random);
  const vortexQuadrant = randInt(random, 0, 3);
  const taken = [...CENTER_CELLS];

  for (let q = 0; q < 4; q++) {
    const colorOrder = shuffle(COLORS, random);
    const corners = pickCorners(q === vortexQuadrant ? 5 : 4, q, taken, random);
    corners.forEach((corner, i) => {
      // Two perpendicular walls: one horizontal (N/S), one vertical (E/W).
      const horizontal = random() < 0.5 ? 0 : 2;
      const vertical = random() < 0.5 ? 1 : 3;
      addWall(walls, corner.cell, rotateDir(horizontal, q));
      addWall(walls, corner.cell, rotateDir(vertical, q));
      taken.push(corner.cell);
      if (i < 4) {
        const color = colorOrder[i];
        targets.push({ color, shape: shapeOrder[(COLORS.indexOf(color) + q) % 4], cell: corner.cell });
      } else {
        targets.push({ color: null, shape: VORTEX, cell: corner.cell });
      }
    });

    // One stub on each of the quadrant's two outer edges (canonical north and
    // west), a wall perpendicular to the edge, kept off the corner and the seam.
    const north = randInt(random, 1, HALF - 3);
    const west = randInt(random, 1, HALF - 3);
    addWall(walls, rotateCell(0, north, q), rotateDir(1, q));
    addWall(walls, rotateCell(west, 0, q), rotateDir(2, q));
  }

  targets.sort((a, b) => a.cell - b.cell);
  targets.forEach((t, id) => { t.id = id; });
  return { walls, targets };
}
