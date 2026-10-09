// solver.js
// Optimal Ricochet solver: iterative-deepening DFS over robot positions.
//
// - Stops are precomputed per (cell, direction) ignoring robots; other robots
//   are applied at runtime by clipping that slide.
// - A lower-bound table (BFS from the target cell where a robot may stop on any
//   cell it passes, ignoring other robots) prunes branches that cannot reach the
//   target in the remaining moves. It never overestimates, so the first depth
//   with a solution is the minimum.
// - A transposition table keyed on (goal robot cell, sorted other cells) stores
//   the largest remaining depth already searched without success. Entries are
//   facts about a position, so they stay valid across deepening iterations.
// - With one move left only the goal robot can finish, so only it is tried.

import { CELLS, ROBOTS, DIRS, DIR_STEP, slide } from './geometry.js';

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_PROBES = 4;
let ttKeys = null;
let ttDepth = null;
let ttDirty = false;

function resetTable() {
  if (!ttKeys) {
    ttKeys = new Uint32Array(TT_SIZE);
    ttDepth = new Uint8Array(TT_SIZE);
  } else if (ttDirty) {
    ttKeys.fill(0);
    ttDepth.fill(0);
  }
  ttDirty = false;
}

function buildStops(walls) {
  const stops = new Uint8Array(CELLS * 4);
  for (let c = 0; c < CELLS; c++) {
    for (let d = 0; d < 4; d++) stops[c * 4 + d] = slide(walls, c, d);
  }
  return stops;
}

// Minimum moves for a lone robot to stop on `target` from each cell, where a
// move may end on any cell along its slide. Walls are symmetric, so the reverse
// BFS expands along the same rays.
function buildLowerBound(stops, target) {
  const lb = new Uint8Array(CELLS).fill(255);
  const queue = new Uint16Array(CELLS);
  let head = 0;
  let tail = 0;
  lb[target] = 0;
  queue[tail++] = target;
  while (head < tail) {
    const cell = queue[head++];
    const next = lb[cell] + 1;
    for (let d = 0; d < 4; d++) {
      const end = stops[cell * 4 + d];
      for (let c = cell; c !== end;) {
        c += DIR_STEP[d];
        if (lb[c] === 255) {
          lb[c] = next;
          queue[tail++] = c;
        }
      }
    }
  }
  return lb;
}

// Solves from `robots` ({red,green,blue,yellow}: cell). `target` is
// `{ cell, color }`; a null color is the vortex, which any robot may claim.
// Returns { moves: [{robot, dir}], length } for a minimum-length solution,
// { timedOut: true } if the time limit ran out first, or null if there is no
// solution within maxDepth moves.
export function solve({ walls, robots, target }, { maxDepth = 20, timeLimitMs = Infinity } = {}) {
  const goalCell = target.cell;
  const goalIdx = target.color == null ? -1 : ROBOTS.indexOf(target.color);
  const pos = new Uint8Array(4);
  ROBOTS.forEach((name, i) => { pos[i] = robots[name]; });

  const stops = buildStops(walls);
  const lb = buildLowerBound(stops, goalCell);

  // Cheapest completion over the robots allowed to claim the target.
  const bound = () => {
    if (goalIdx >= 0) return lb[pos[goalIdx]];
    return Math.min(lb[pos[0]], lb[pos[1]], lb[pos[2]], lb[pos[3]]);
  };

  // Stop cell for robot i sliding in dir d, clipped by the other robots.
  const stopOf = (i, d) => {
    const from = pos[i];
    let stop = stops[from * 4 + d];
    if (stop === from) return from;
    const step = DIR_STEP[d];
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      const p = pos[j];
      const off = p - from;
      if (step > 0) {
        if (off > 0 && p <= stop && off % step === 0) stop = p - step;
      } else if (off < 0 && p >= stop && off % step === 0) {
        stop = p - step;
      }
    }
    return stop;
  };

  if (bound() === 0) return { moves: [], length: 0 };

  resetTable();
  const mvRobot = new Uint8Array(maxDepth + 1);
  const mvDir = new Uint8Array(maxDepth + 1);
  const deadline = timeLimitMs === Infinity ? Infinity : performance.now() + timeLimitMs;
  let nodes = 0;
  let aborted = false;

  const keyOf = () => {
    let a;
    let b;
    let c;
    let g;
    if (goalIdx >= 0) {
      g = pos[goalIdx];
      const o = [0, 1, 2, 3].filter(i => i !== goalIdx);
      a = pos[o[0]]; b = pos[o[1]]; c = pos[o[2]];
    } else {
      g = pos[0]; a = pos[1]; b = pos[2]; c = pos[3];
      // vortex: all four are interchangeable, so sort every cell
      if (g > a) [g, a] = [a, g];
      if (b > c) [b, c] = [c, b];
      if (g > b) [g, b] = [b, g];
      if (a > c) [a, c] = [c, a];
      if (a > b) [a, b] = [b, a];
    }
    if (a > b) [a, b] = [b, a];
    if (b > c) [b, c] = [c, b];
    if (a > b) [a, b] = [b, a];
    return (g | (a << 8) | (b << 16) | (c << 24)) >>> 0;
  };

  const ttLookup = key => {
    let h = Math.imul(key, 0x9E3779B1) >>> (32 - TT_BITS);
    for (let p = 0; p < TT_PROBES; p++, h = (h + 1) & (TT_SIZE - 1)) {
      if (ttKeys[h] === key) return ttDepth[h];
      if (ttKeys[h] === 0) return 0;
    }
    return 0;
  };

  const ttStore = (key, depth) => {
    ttDirty = true;
    let h = Math.imul(key, 0x9E3779B1) >>> (32 - TT_BITS);
    let victim = h;
    for (let p = 0; p < TT_PROBES; p++, h = (h + 1) & (TT_SIZE - 1)) {
      if (ttKeys[h] === key) {
        if (ttDepth[h] < depth) ttDepth[h] = depth;
        return;
      }
      if (ttKeys[h] === 0) { victim = h; break; }
      if (ttDepth[h] < ttDepth[victim]) victim = h;
    }
    ttKeys[victim] = key;
    ttDepth[victim] = depth;
  };

  // True if the position can be solved in at most `left` more moves.
  const dfs = (left, ply) => {
    if ((++nodes & 2047) === 0 && performance.now() > deadline) aborted = true;
    if (aborted) return false;

    if (left === 1) {
      for (let i = 0; i < 4; i++) {
        if (goalIdx >= 0 && i !== goalIdx) continue;
        for (let d = 0; d < 4; d++) {
          if (stopOf(i, d) === goalCell) {
            mvRobot[ply] = i; mvDir[ply] = d;
            return true;
          }
        }
      }
      return false;
    }

    const key = keyOf();
    if (ttLookup(key) >= left) return false;

    for (let n = 0; n < 4; n++) {
      // goal robot first: it is the likeliest to make progress
      const i = goalIdx >= 0 ? (n === 0 ? goalIdx : n <= goalIdx ? n - 1 : n) : n;
      const from = pos[i];
      for (let d = 0; d < 4; d++) {
        const stop = stopOf(i, d);
        if (stop === from) continue;
        pos[i] = stop;
        if (bound() < left) {
          mvRobot[ply] = i; mvDir[ply] = d;
          if (dfs(left - 1, ply + 1)) { pos[i] = from; return true; }
        }
        pos[i] = from;
        if (aborted) return false;
      }
    }
    ttStore(key, left);
    return false;
  };

  for (let depth = Math.max(1, bound()); depth <= maxDepth; depth++) {
    if (dfs(depth, 0)) {
      const moves = [];
      for (let k = 0; k < depth; k++) moves.push({ robot: ROBOTS[mvRobot[k]], dir: DIRS[mvDir[k]] });
      return { moves, length: depth };
    }
    if (aborted) return { timedOut: true };
  }
  return null;
}
