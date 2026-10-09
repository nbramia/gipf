#!/usr/bin/env node
// Writes the default-config golden fixture for Ricochet: for seeds 1-200, the
// generated walls/targets, the constructor's robot placement, and the optimal
// solution length of every target from that placement.
//
//   node scripts/ricochet-golden.mjs src/games/ricochet/fixtures/golden-default.json
//
// The committed fixture was recorded from the engine before the variant work and
// must never be regenerated to make a failing test pass.

import fs from 'fs';
import RicochetBoard from '../src/games/ricochet/RicochetBoard.js';
import { solve } from '../src/games/ricochet/engine/solver.js';

const out = {};
for (let seed = 1; seed <= 200; seed++) {
  const b = new RicochetBoard({ seed, skipInitialHistory: true });
  const optimal = b.targets.map(t => {
    const r = solve({ walls: b.walls, robots: b.robots, target: t }, { maxDepth: 14 });
    return r ? r.length : null;
  });
  out[seed] = {
    walls: Buffer.from(b.walls).toString('hex'),
    targets: b.targets,
    robots: b.robots,
    rngState: b.rngState,
    optimal,
  };
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
