#!/usr/bin/env node
// Solver benchmark: plays chained rounds on generated boards and reports solve
// time (median / p95 / max) and the distribution of optimal lengths.
//
// Every round picks a random unclaimed target, solves it from the robots' current
// cells (they stay where the last round ended, as in the real game), then plays the
// optimal solution so the next round starts from a realistic position. One-move
// rounds are skipped, as the game never deals them. `--timeout` bounds each solve;
// timeouts and rounds with no solution within 20 moves are counted separately.
//
//   node scripts/ricochet-solver-bench.mjs --boards 40 --rounds 8 --timeout 5000

import RicochetBoard from '../src/games/ricochet/RicochetBoard.js';
import { solve } from '../src/games/ricochet/engine/solver.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

const boards = arg('boards', 40);
const roundsPerBoard = arg('rounds', 8);
const timeLimitMs = arg('timeout', 5000);
const seed0 = arg('seed', 1);

const times = [];
const lengths = new Map();
let timeouts = 0;
let beyondDepth = 0;

for (let b = 0; b < boards; b++) {
  const board = new RicochetBoard({ seed: seed0 + b, skipInitialHistory: true });
  for (let r = 0; r < roundsPerBoard; r++) {
    const open = board.targets.filter(t => !board.claimed.includes(t.id));
    if (open.length === 0) break;
    const target = open[Math.floor(board.random() * open.length)];
    const t0 = performance.now();
    const result = solve({ walls: board.walls, robots: board.robots, target }, { timeLimitMs });
    const ms = performance.now() - t0;
    if (!result) { beyondDepth++; continue; } // no solution within the default 20 moves
    if (result.timedOut) { timeouts++; times.push(ms); continue; }
    if (result.length < 2) { r--; board.claimed.push(target.id); continue; }
    times.push(ms);
    lengths.set(result.length, (lengths.get(result.length) || 0) + 1);
    board.startRound(target.id);
    for (const m of result.moves) board.applyMove(m);
  }
}

times.sort((a, b) => a - b);
const pct = p => times[Math.min(times.length - 1, Math.floor(p * times.length))];
console.log(`rounds: ${times.length}  timeouts: ${timeouts}  (limit ${timeLimitMs} ms)  beyond 20 moves: ${beyondDepth}`);
console.log(`solve time ms  median ${pct(0.5).toFixed(2)}  p95 ${pct(0.95).toFixed(2)}  max ${times[times.length - 1].toFixed(2)}`);
console.log('optimal length distribution:');
for (const len of [...lengths.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(len).padStart(2)}: ${lengths.get(len)}`);
}
