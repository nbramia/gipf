// solver.js
// Optimal Ricochet solver: iterative-deepening DFS over robot positions.
//
// Four or five robots (black is the fifth), 16x16 or 12x12, with or without
// diagonal barriers.
//
// Plain boards (no barriers):
// - Stops are precomputed per (cell, direction) ignoring robots; other robots
//   are applied at runtime by clipping that slide.
// - A lower-bound table (BFS from the target cell where a robot may stop on any
//   cell it passes, ignoring other robots) prunes branches that cannot reach the
//   target in the remaining moves. It never overestimates, so the first depth
//   with a solution is the minimum.
// Boards with barriers:
// - A slide's route depends on the robot's colour (a barrier deflects every robot
//   but its own colour), so routes are precomputed per (colour, cell, direction)
//   and another robot clips a route at the first cell it holds.
// - The lower bound is one table per colour: a move may end on any non-barrier
//   cell of the colour's route, so the bound stays admissible.
// Both:
// - A transposition table keyed on the robot cells stores the largest remaining
//   depth already searched without success. Entries are facts about a position,
//   so they stay valid across deepening iterations. Four robots fit one uint32
//   key (the original fast path); five need two words (lo + hi) and a
//   double-hashed table. Without barriers robots that cannot be told apart are
//   sorted into the key; with barriers colours matter, so cells are kept by
//   colour.
// - With one move left only the goal robot can finish (any robot for the
//   vortex), so only it is tried.

import { ALL_ROBOTS, DIRS, makeLayout, slideTrace, finishRoute, slide, stepsOf } from './geometry.js';

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_PROBES = 4;
let ttKeys = null;
let ttHi = null;
let ttDepth = null;
let ttDirty = false;

function resetTable(five) {
  if (!ttKeys) {
    ttKeys = new Uint32Array(TT_SIZE);
    ttDepth = new Uint8Array(TT_SIZE);
  } else if (ttDirty) {
    ttKeys.fill(0);
    ttDepth.fill(0);
    if (ttHi) ttHi.fill(0);
  }
  if (five && !ttHi) ttHi = new Uint32Array(TT_SIZE);
  ttDirty = false;
}

function buildStops(walls, size) {
  const cells = size * size;
  const stops = new Uint8Array(cells * 4);
  for (let c = 0; c < cells; c++) {
    for (let d = 0; d < 4; d++) stops[c * 4 + d] = slide(walls, c, d, null, size);
  }
  return stops;
}

// Minimum moves for a lone robot to stop on `target` from each cell, where a
// move may end on any cell along its slide. Walls are symmetric, so the reverse
// BFS expands along the same rays.
function buildLowerBound(stops, target, cells, steps) {
  const lb = new Uint8Array(cells).fill(255);
  const queue = new Uint16Array(cells);
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
        c += steps[d];
        if (lb[c] === 255) {
          lb[c] = next;
          queue[tail++] = c;
        }
      }
    }
  }
  return lb;
}

// ---- barrier boards ----------------------------------------------------------

// Routes per colour index: routes[colour][cell * 4 + dir] = { cells, stop }.
// `cells` is the raw route ignoring other robots (to the repeat if it loops) and
// `stop` the cell the robot ends on when nothing blocks it, or -1 if that move
// is illegal. Cached while the same board is solved again (one call per target).
let routeCache = null;

function buildRoutes(layout, barriers, nr) {
  if (routeCache && routeCache.walls === layout.walls && routeCache.barriers === barriers && routeCache.nr === nr) {
    return routeCache.routes;
  }
  const cells = layout.size * layout.size;
  const routes = [];
  for (let color = 0; color < nr; color++) {
    const table = new Array(cells * 4);
    for (let c = 0; c < cells; c++) {
      for (let d = 0; d < 4; d++) {
        const t = slideTrace(layout, c, d, color);
        const fin = finishRoute(layout, t.cells, t.loop);
        table[c * 4 + d] = { cells: t.cells, stop: fin ? fin[fin.length - 1] : -1 };
      }
    }
    routes.push(table);
  }
  routeCache = { walls: layout.walls, barriers, nr, routes };
  return routes;
}

// Lower bound for one colour: moves needed to stop on `target`, where a move may
// end on any non-barrier cell of the route. Solved level by level from the target.
function buildLowerBoundDiag(table, diag, target, cells) {
  const lb = new Uint8Array(cells).fill(255);
  lb[target] = 0;
  for (let level = 1; level < 255; level++) {
    let any = false;
    for (let s = 0; s < cells; s++) {
      if (lb[s] !== 255) continue;
      search: for (let d = 0; d < 4; d++) {
        const route = table[s * 4 + d].cells;
        for (let k = 1; k < route.length; k++) {
          const c = route[k];
          if (lb[c] === level - 1 && diag[c] === 0) {
            lb[s] = level;
            any = true;
            break search;
          }
        }
      }
    }
    if (!any) break;
  }
  return lb;
}

// Solves from `robots` ({red, green, blue, yellow[, black]}: cell). `target` is
// `{ cell, color }`; a null color is the vortex, which any robot (black too) may
// claim; black never claims a colour. `size` is 16 or 12; `barriers` is the
// board's diagonal barrier list.
// Returns { moves: [{robot, dir}], length } for a minimum-length solution,
// { timedOut: true } if the time limit ran out first, or null if there is no
// solution within maxDepth moves. The deadline is checked every 2048 nodes, so a
// limit is honoured to within that granularity, and a solution found just past
// the deadline is still returned.
export function solve({ walls, robots, target, size = 16, barriers = null }, { maxDepth = 20, timeLimitMs = Infinity } = {}) {
  const goalCell = target.cell;
  const nr = robots.black == null ? 4 : 5;
  const goalIdx = target.color == null ? -1 : ALL_ROBOTS.indexOf(target.color);
  const cells = size * size;
  const steps = stepsOf(size);
  const pos = new Uint8Array(nr);
  for (let i = 0; i < nr; i++) pos[i] = robots[ALL_ROBOTS[i]];

  const hasBarriers = !!barriers && barriers.length > 0;
  const layout = makeLayout(size, walls, hasBarriers ? barriers : []);
  const diag = layout.diag;
  const occ = hasBarriers ? new Uint8Array(cells) : null;
  if (hasBarriers) for (let i = 0; i < nr; i++) occ[pos[i]] = 1;

  let stops = null;
  let lb = null;
  let routes = null;
  let lbs = null;
  if (hasBarriers) {
    routes = buildRoutes(layout, barriers, nr);
    lbs = [];
    for (let i = 0; i < nr; i++) {
      // only the colours that may claim the target need a table
      lbs.push(goalIdx >= 0 && i !== goalIdx ? null : buildLowerBoundDiag(routes[i], diag, goalCell, cells));
    }
  } else {
    stops = buildStops(walls, size);
    lb = buildLowerBound(stops, goalCell, cells, steps);
  }

  // Cheapest completion over the robots allowed to claim the target.
  const bound = () => {
    if (hasBarriers) {
      if (goalIdx >= 0) return lbs[goalIdx][pos[goalIdx]];
      let best = 255;
      for (let i = 0; i < nr; i++) if (lbs[i][pos[i]] < best) best = lbs[i][pos[i]];
      return best;
    }
    if (goalIdx >= 0) return lb[pos[goalIdx]];
    let best = lb[pos[0]];
    for (let i = 1; i < nr; i++) if (lb[pos[i]] < best) best = lb[pos[i]];
    return best;
  };

  // Stop cell for robot i sliding in dir d, clipped by the other robots; its own
  // cell if it cannot move.
  const stopOfPlain = (i, d) => {
    const from = pos[i];
    let stop = stops[from * 4 + d];
    if (stop === from) return from;
    const step = steps[d];
    for (let j = 0; j < nr; j++) {
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

  // With barriers: walk the colour's route until it meets another robot, then
  // back off any barrier cell (a robot may not stop on one).
  const stopOfDiag = (i, d) => {
    const from = pos[i];
    const route = routes[i][from * 4 + d];
    const rc = route.cells;
    occ[from] = 0; // the mover's own start is not an obstacle
    let k = 1;
    while (k < rc.length && occ[rc[k]] === 0) k++;
    occ[from] = 1;
    if (k === rc.length) return route.stop < 0 ? from : route.stop;
    let e = k - 1;
    while (e > 0 && diag[rc[e]] !== 0) e--;
    return rc[e];
  };
  const stopOf = hasBarriers ? stopOfDiag : stopOfPlain;

  if (bound() === 0) return { moves: [], length: 0 };

  resetTable(nr === 5);
  const mvRobot = new Uint8Array(maxDepth + 1);
  const mvDir = new Uint8Array(maxDepth + 1);
  const deadline = timeLimitMs === Infinity ? Infinity : performance.now() + timeLimitMs;
  let nodes = 0;
  let aborted = false;

  // Four robots: one uint32 key.
  const keyOf4 = () => {
    let a;
    let b;
    let c;
    let g;
    if (hasBarriers) {
      return (pos[0] | (pos[1] << 8) | (pos[2] << 16) | (pos[3] << 24)) >>> 0;
    }
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

  // Five robots: two words. `hi` always has bit 8 set so a stored key is never
  // all-zero (zero marks an empty slot).
  const tmp = new Uint8Array(5);
  let keyLo = 0;
  let keyHi = 0;
  const keyOf5 = () => {
    if (hasBarriers) {
      keyLo = (pos[0] | (pos[1] << 8) | (pos[2] << 16) | (pos[3] << 24)) >>> 0;
      keyHi = pos[4] | 0x100;
      return;
    }
    // Interchangeable robots are sorted: the four non-goal robots (black
    // included) after the goal robot, or all five for the vortex.
    let n = 0;
    let first = 0;
    if (goalIdx >= 0) {
      first = pos[goalIdx];
      for (let i = 0; i < 5; i++) if (i !== goalIdx) tmp[n++] = pos[i];
    } else {
      for (let i = 0; i < 5; i++) tmp[n++] = pos[i];
    }
    for (let i = 1; i < n; i++) {
      const v = tmp[i];
      let j = i - 1;
      while (j >= 0 && tmp[j] > v) { tmp[j + 1] = tmp[j]; j--; }
      tmp[j + 1] = v;
    }
    if (goalIdx >= 0) {
      keyLo = (first | (tmp[0] << 8) | (tmp[1] << 16) | (tmp[2] << 24)) >>> 0;
      keyHi = tmp[3] | 0x100;
    } else {
      keyLo = (tmp[0] | (tmp[1] << 8) | (tmp[2] << 16) | (tmp[3] << 24)) >>> 0;
      keyHi = tmp[4] | 0x100;
    }
  };

  const ttLookup4 = key => {
    let h = Math.imul(key, 0x9E3779B1) >>> (32 - TT_BITS);
    for (let p = 0; p < TT_PROBES; p++, h = (h + 1) & TT_MASK) {
      if (ttKeys[h] === key) return ttDepth[h];
      if (ttKeys[h] === 0) return 0;
    }
    return 0;
  };

  const ttStore4 = (key, depth) => {
    ttDirty = true;
    let h = Math.imul(key, 0x9E3779B1) >>> (32 - TT_BITS);
    let victim = h;
    for (let p = 0; p < TT_PROBES; p++, h = (h + 1) & TT_MASK) {
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

  // Double hashing: the start slot and an odd stride come from different mixes.
  const slot5 = () => {
    const m = (Math.imul(keyLo, 0x9E3779B1) ^ Math.imul(keyHi, 0x85EBCA6B)) >>> 0;
    const h = Math.imul(m ^ (m >>> 15), 0x2C1B3C6D) >>> (32 - TT_BITS);
    const stride = (Math.imul(keyLo ^ Math.imul(keyHi, 0x27D4EB2F), 0x165667B1) >>> 20) | 1;
    return [h, stride];
  };

  const ttLookup5 = () => {
    let [h, stride] = slot5();
    for (let p = 0; p < TT_PROBES; p++, h = (h + stride) & TT_MASK) {
      if (ttHi[h] === 0) return 0;
      if (ttKeys[h] === keyLo && ttHi[h] === keyHi) return ttDepth[h];
    }
    return 0;
  };

  const ttStore5 = depth => {
    ttDirty = true;
    let [h, stride] = slot5();
    let victim = h;
    for (let p = 0; p < TT_PROBES; p++, h = (h + stride) & TT_MASK) {
      if (ttHi[h] === 0) { victim = h; break; }
      if (ttKeys[h] === keyLo && ttHi[h] === keyHi) {
        if (ttDepth[h] < depth) ttDepth[h] = depth;
        return;
      }
      if (ttDepth[h] < ttDepth[victim]) victim = h;
    }
    ttKeys[victim] = keyLo;
    ttHi[victim] = keyHi;
    ttDepth[victim] = depth;
  };

  const place = (i, cell) => {
    if (hasBarriers) { occ[pos[i]] = 0; occ[cell] = 1; }
    pos[i] = cell;
  };

  // True if the position can be solved in at most `left` more moves.
  const dfs = (left, ply) => {
    if ((++nodes & 2047) === 0 && performance.now() > deadline) aborted = true;
    if (aborted) return false;

    if (left === 1) {
      for (let i = 0; i < nr; i++) {
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

    let key4 = 0;
    if (nr === 4) {
      key4 = keyOf4();
      if (ttLookup4(key4) >= left) return false;
    } else {
      keyOf5();
      if (ttLookup5() >= left) return false;
    }
    // the key words are shared state: keep this node's own for the store below
    const myLo = keyLo;
    const myHi = keyHi;

    for (let n = 0; n < nr; n++) {
      // goal robot first: it is the likeliest to make progress
      const i = goalIdx >= 0 ? (n === 0 ? goalIdx : n <= goalIdx ? n - 1 : n) : n;
      const from = pos[i];
      for (let d = 0; d < 4; d++) {
        const stop = stopOf(i, d);
        if (stop === from) continue;
        place(i, stop);
        if (bound() < left) {
          mvRobot[ply] = i; mvDir[ply] = d;
          if (dfs(left - 1, ply + 1)) { place(i, from); return true; }
        }
        place(i, from);
        if (aborted) return false;
      }
    }
    if (nr === 4) ttStore4(key4, left);
    else { keyLo = myLo; keyHi = myHi; ttStore5(left); }
    return false;
  };

  for (let depth = Math.max(1, bound()); depth <= maxDepth; depth++) {
    if (dfs(depth, 0)) {
      const moves = [];
      for (let k = 0; k < depth; k++) moves.push({ robot: ALL_ROBOTS[mvRobot[k]], dir: DIRS[mvDir[k]] });
      return { moves, length: depth };
    }
    if (aborted) return { timedOut: true };
  }
  return null;
}
