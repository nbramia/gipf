// Pure board-state serializer for the Diplomacy agents. Turns a live
// DiplomacyBoard into a compact, prompt-friendly context object for one power:
// the phase, that power's centers/units, every rival's counts, which rivals
// border it, contested provinces, and recent turn results.
//
// Pure: no network, no React. Consumed by agentClient.js (sent to the endpoint)
// and unit-tested directly against `new DiplomacyBoard()`.

import {
  POWERS,
  POWER_NAMES,
  SUPPLY_CENTERS,
  adjacencyFor,
  baseProvince,
} from '../DiplomacyBoard.js';

// Set of base provinces this power's units are adjacent to (army + fleet reach),
// used to detect bordering rivals.
function reachableBases(board, power) {
  const reach = new Set();
  for (const { loc, type } of board.getUnits(power)) {
    reach.add(baseProvince(loc));
    for (const adj of adjacencyFor(type, loc)) reach.add(baseProvince(adj));
  }
  return reach;
}

// Compact, one-line descriptions of the most recent resolved turns, drawn from
// board.orderHistory (most-recent-first). Each entry is rendered as a short
// human-readable summary; details are kept terse to bound prompt size.
function recentResults(board, limit = 3) {
  const history = Array.isArray(board.orderHistory) ? board.orderHistory : [];
  return history.slice(0, limit).map((entry) => {
    if (entry.adjustments) {
      const n = Object.keys(entry.adjustments).length;
      return `${entry.phase}: ${n} adjustment${n === 1 ? '' : 's'} resolved.`;
    }
    const resolved = entry.resolved || {};
    const moves = Object.values(resolved).filter((r) => r && r.type === 'move');
    const succeeded = moves.filter((r) => r.success).length;
    const dislodged = Array.isArray(entry.retreats) ? entry.retreats.length : 0;
    const parts = [];
    parts.push(`${moves.length} move${moves.length === 1 ? '' : 's'} ordered, ${succeeded} succeeded`);
    if (dislodged) parts.push(`${dislodged} dislodged`);
    return `${entry.phase}: ${parts.join(', ')}.`;
  });
}

// serializeBoardContext(board, { power }) -> compact context object.
export function serializeBoardContext(board, { power } = {}) {
  if (!board || !power) {
    throw new Error('serializeBoardContext requires a board and { power }');
  }

  const reach = reachableBases(board, power);

  const youUnits = board.getUnits(power);
  const youCenters = board.getSupplyCenters(power);

  const rivals = POWERS.filter((p) => p !== power).map((p) => {
    // Neighbours = powers whose units can reach a province this power can also
    // reach (their spheres of movement touch), so contact is imminent.
    const rivalReach = reachableBases(board, p);
    const neighbor = [...rivalReach].some((b) => reach.has(b));
    return {
      power: p,
      name: POWER_NAMES[p] || p,
      centers: board.getSupplyCount(p),
      units: board.getUnitCount(p),
      neighbor,
    };
  });

  // Threats: contested provinces from the last adjudication that touch this
  // power's reach, plus any rival unit sitting on a province adjacent to us.
  const contested = Array.isArray(board.contestedProvinces) ? board.contestedProvinces : [];
  const threats = Array.from(
    new Set(contested.map(baseProvince).filter((p) => reach.has(p)))
  );

  // Board-wide totals: 34 supply centers in play and the live unit count. Note
  // that ownership of all 34 is only resolved each Fall, so at the opening only
  // the 22 home centers carrying a unit have an owner — supplyCenterTotal counts
  // the centers ON THE BOARD, not currently-owned ones.
  const unitTotal = POWERS.reduce((sum, p) => sum + board.getUnitCount(p), 0);

  return {
    phase: board.getPhaseLabel(),
    season: board.season,
    year: board.year,
    supplyCenterTotal: SUPPLY_CENTERS.length,
    unitTotal,
    you: {
      power,
      name: POWER_NAMES[power] || power,
      centers: youCenters.length,
      units: youUnits.length,
      centerList: youCenters.map(baseProvince),
      unitList: youUnits.map((u) => `${u.type === 'fleet' ? 'F' : 'A'} ${u.loc}`),
    },
    rivals,
    threats,
    recentResults: recentResults(board),
  };
}
