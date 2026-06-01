#!/usr/bin/env node
// Audit every ruleset × scenario × player-count: does it CONSTRUCT, and does a
// full AI game actually TERMINATE (reach the victory target)? The engine plays
// base Catan under each ruleset's map profile + victory target.
//
//   node scripts/catan/audit-rulesets.mjs

import CatanBoard from '../../src/games/catan/CatanBoard.js';
import { CATAN_RULESETS } from '../../src/games/catan/catanRulesets.js';
import { MCTS, applyMove } from '../../src/games/catan/engine/mcts.js';

const SIMS = 24;
// High enough to let the engine's MAX_GAME_TURNS (100) safety net fire even in
// move-heavy 5-6 player games (~50 moves/turn) before this cap is hit, so the
// audit reflects real termination rather than a premature move-cap cutoff.
const CAP = 6000;

async function playToEnd(board) {
  const eng = new MCTS({ maxChildren: 20, rolloutSteps: 12 });
  let moves = 0;
  while (board.phase !== 'game-over' && moves < CAP) {
    const m = await eng.getBestMove(board, SIMS);
    if (!m) return { moves, illegal: 'no-move' };
    if (!applyMove(board, m)) return { moves, illegal: JSON.stringify(m).slice(0, 60) };
    moves++;
  }
  return { moves };
}

// 1. Construction sweep — every ruleset × scenario × player-count.
console.log('=== CONSTRUCTION SWEEP (all combos) ===');
let constructFails = 0;
for (const rs of CATAN_RULESETS) {
  for (const pc of rs.playerCounts) {
    for (const sc of rs.scenarios) {
      try {
        const b = new CatanBoard({ seed: 1, rulesetId: rs.id, scenarioId: sc.id, playerCount: pc });
        const ok = b.tiles.length > 0 && Object.keys(b.vertices).length > 0
          && b.getLegalMoves().length > 0 && b.victoryTarget > 0;
        if (!ok) { console.log(`  FAIL build ${rs.id}/${sc.id} p${pc}`); constructFails++; }
      } catch (e) {
        console.log(`  THROW ${rs.id}/${sc.id} p${pc}: ${e.message}`);
        constructFails++;
      }
    }
  }
}
console.log(constructFails === 0 ? '  all combos construct OK' : `  ${constructFails} construction failures`);

// 2. Termination sweep — every ruleset × player-count at the highest-target
//    scenario (the hardest to finish), plus map coverage at min/max counts.
console.log('\n=== TERMINATION SWEEP (hardest scenario per ruleset × player-count) ===');
console.log('ruleset                  scen(target)            players  map       result');
const rows = [];
const SEEDS = 3;
for (const rs of CATAN_RULESETS) {
  const hardest = [...rs.scenarios].sort((a, b) => (b.target || 0) - (a.target || 0))[0];
  for (const pc of rs.playerCounts) {
    let map = '', target = 0, terminated = 0, stalled = 0, illegal = '', worstVP = 99;
    for (let s = 0; s < SEEDS; s++) {
      const board = new CatanBoard({ seed: 100 + pc * 13 + s * 7, rulesetId: rs.id, scenarioId: hardest.id, playerCount: pc });
      map = board.mapProfileId; target = board.victoryTarget;
      const r = await playToEnd(board);
      const maxVP = Math.max(...board.getPlayerIds().map(p => board.getVictoryPoints(p)));
      if (r.illegal) illegal = r.illegal;
      else if (board.phase === 'game-over') terminated++;
      else { stalled++; worstVP = Math.min(worstVP, maxVP); }
    }
    const status = illegal ? `ILLEGAL(${illegal})`
      : stalled === 0 ? `OK (${terminated}/${SEEDS})`
      : `STALL ${stalled}/${SEEDS} (worstVP ${worstVP}/${target})`;
    console.log(
      `${rs.id.padEnd(22)} ${hardest.id.slice(0, 15).padEnd(15)}(${String(target).padStart(2)})  ` +
      `${String(pc).padStart(2)}    ${map.padEnd(9)} ${status}`
    );
    rows.push({ rs: rs.id, sc: hardest.id, pc, target, terminated: stalled === 0 && !illegal, illegal: !!illegal, maxVP: worstVP });
  }
}

const stalls = rows.filter(r => !r.terminated && !r.illegal);
const illegals = rows.filter(r => r.illegal);
console.log('\n=== SUMMARY ===');
console.log(`construction failures: ${constructFails}`);
console.log(`illegal-move failures: ${illegals.length}`);
console.log(`non-terminating (stall): ${stalls.length}`);
if (stalls.length) console.log('  stalls:', stalls.map(s => `${s.rs}/${s.sc} p${s.pc} (maxVP ${s.maxVP}/${s.target})`).join(', '));
