// generator.js
// Procedural Ricochet board: four quadrants (8x8 on the 16x16 board, 6x6 on the
// 12x12), each generated in one canonical orientation (top-left, outer edges
// north and west, centre block at the inner corner) and rotated into place around
// the centre. Diagonal barriers, when asked for, come from a separate random
// stream so they never change the walls or targets of the same seed. Pure and
// deterministic per seed and config.

import {
  COLORS, SHAPES, VORTEX, ORIENTS,
  cellOf, rowOf, colOf, addWall, emptyWalls, centerCellsOf,
} from './geometry.js';
import { normalizeConfig } from './config.js';

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

// Rotates a canonical (top-left quadrant) cell clockwise `turns` quarter turns
// about the board centre.
function rotateCell(row, col, turns, size) {
  let r = row;
  let c = col;
  for (let i = 0; i < turns; i++) [r, c] = [c, size - 1 - r];
  return cellOf(r, c, size);
}
const rotateDir = (dir, turns) => (dir + turns) % 4;

const tooClose = (a, b, size) =>
  Math.abs(rowOf(a, size) - rowOf(b, size)) <= 1 && Math.abs(colOf(a, size) - colOf(b, size)) <= 1;

// Local (canonical) cells an L-corner may occupy: off the outer row/column and
// not touching (even diagonally) the centre block, which sits at the quadrant's
// inner corner.
function cornerCandidates(half) {
  const out = [];
  for (let r = 1; r < half; r++) {
    for (let c = 1; c < half; c++) {
      if (r >= half - 2 && c >= half - 2) continue;
      out.push([r, c]);
    }
  }
  return out;
}
const CANDIDATES = { 16: cornerCandidates(8), 12: cornerCandidates(6) };

// Picks `count` mutually non-adjacent corners for one quadrant, also clear of
// the global cells already taken by earlier quadrants. Always succeeds within a
// few attempts: the candidate area is 46 cells (16x16) or 21 (12x12) for at most
// 5 or 3 corners.
function pickCorners(count, turns, taken, random, size) {
  for (;;) {
    const chosen = [];
    for (const [r, c] of shuffle(CANDIDATES[size], random)) {
      const cell = rotateCell(r, c, turns, size);
      if (taken.some(t => tooClose(t, cell, size)) || chosen.some(o => tooClose(o.cell, cell, size))) continue;
      chosen.push({ cell, r, c });
      if (chosen.length === count) return chosen;
    }
  }
}

// 16x16: 17 targets, every colour x shape once plus one vortex, 4 coloured
// corners per quadrant, two edge stubs per quadrant.
// 12x12: 9 targets, 2 coloured corners per quadrant (every colour twice with two
// different shapes) plus one vortex, one edge stub per quadrant.
function generateLayout(seed, size) {
  const random = mulberry32(seed);
  const half = size / 2;
  const small = size === 12;
  const walls = emptyWalls(size);
  const targets = [];

  // 16x16: Latin square over (colour, quadrant) -> shape. 12x12: quadrant q holds
  // the ring colours q and q+1, so each colour sits in two adjacent quadrants.
  const shapeOrder = shuffle(SHAPES, random);
  const vortexQuadrant = randInt(random, 0, 3);
  const ring = small ? shuffle(COLORS, random) : null;
  const perQuadrant = small ? 2 : 4;
  const taken = [...centerCellsOf(size)];

  for (let q = 0; q < 4; q++) {
    const colorOrder = small ? null : shuffle(COLORS, random);
    const corners = pickCorners(q === vortexQuadrant ? perQuadrant + 1 : perQuadrant, q, taken, random, size);
    corners.forEach((corner, i) => {
      // Two perpendicular walls: one horizontal (N/S), one vertical (E/W).
      const horizontal = random() < 0.5 ? 0 : 2;
      const vertical = random() < 0.5 ? 1 : 3;
      addWall(walls, corner.cell, rotateDir(horizontal, q), size);
      addWall(walls, corner.cell, rotateDir(vertical, q), size);
      taken.push(corner.cell);
      if (i < perQuadrant) {
        if (small) {
          const k = (q + i) % 4;
          targets.push({ color: ring[k], shape: shapeOrder[(k + i) % 4], cell: corner.cell });
        } else {
          const color = colorOrder[i];
          targets.push({ color, shape: shapeOrder[(COLORS.indexOf(color) + q) % 4], cell: corner.cell });
        }
      } else {
        targets.push({ color: null, shape: VORTEX, cell: corner.cell });
      }
    });

    // Edge stubs: a wall perpendicular to the edge, kept off the corner and the
    // seam. 16x16 has one on each of the quadrant's two outer edges (canonical
    // north and west); 12x12 has one, on the canonical north edge, so each side
    // of the board gets exactly one.
    const north = randInt(random, 1, half - 3);
    addWall(walls, rotateCell(0, north, q, size), rotateDir(1, q), size);
    if (!small) {
      const west = randInt(random, 1, half - 3);
      addWall(walls, rotateCell(west, 0, q, size), rotateDir(2, q), size);
    }
  }

  targets.sort((a, b) => a.cell - b.cell);
  targets.forEach((t, id) => { t.id = id; });
  return { walls, targets };
}

// Diagonal barriers: 2 per quadrant on 16x16, 1 per quadrant on 12x12. Never on
// a target, the outer ring or the centre block, and never orthogonally adjacent
// to another barrier. Colours cycle through all four, shuffled, so they are
// spread evenly.
function generateBarriers(seed, size, targets) {
  const random = mulberry32((Math.imul(seed >>> 0, 0x9E3779B1) ^ 0xD1A60A1) >>> 0);
  const perQuadrant = size === 16 ? 2 : 1;
  const blocked = new Set([...centerCellsOf(size), ...targets.map(t => t.cell)]);
  const colors = [];
  while (colors.length < 4 * perQuadrant) colors.push(...shuffle(COLORS, random));
  const barriers = [];
  const half = size / 2;
  for (let q = 0; q < 4; q++) {
    const rowLo = q < 2 ? 1 : half;
    const colLo = q === 0 || q === 3 ? 1 : half;
    const options = [];
    for (let r = rowLo; r < rowLo + half - 1; r++) {
      for (let c = colLo; c < colLo + half - 1; c++) options.push(cellOf(r, c, size));
    }
    const candidates = shuffle(options, random);
    let placed = 0;
    for (const cell of candidates) {
      if (placed === perQuadrant) break;
      if (blocked.has(cell)) continue;
      if (barriers.some(b => Math.abs(rowOf(b.cell, size) - rowOf(cell, size)) + Math.abs(colOf(b.cell, size) - colOf(cell, size)) <= 1)) continue;
      barriers.push({ cell, orient: ORIENTS[randInt(random, 0, 1)], color: colors[barriers.length] });
      placed++;
    }
  }
  return barriers.sort((a, b) => a.cell - b.cell);
}

// Returns { walls, targets, barriers, size }. The default config yields exactly
// the classic board; barriers is empty unless `config.diagonals`.
export function generateBoard(seed, config) {
  const cfg = normalizeConfig(config);
  const { walls, targets } = generateLayout(seed, cfg.size);
  const barriers = cfg.diagonals ? generateBarriers(seed, cfg.size, targets) : [];
  return { walls, targets, barriers, size: cfg.size };
}
