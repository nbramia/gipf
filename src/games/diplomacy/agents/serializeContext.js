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

// Render one order as a terse, human-readable line (the location identifies the
// unit). Mirrors the UI's describeOrder.
function describeOrderShort(order) {
  const u = order.unitLoc;
  switch (order.type) {
    case 'move': return `${u} → ${order.to}${order.viaConvoy ? ' (convoy)' : ''}`;
    case 'support-hold': return `${u} S ${order.target}`;
    case 'support-move': return `${u} S ${order.from} → ${order.to}`;
    case 'convoy': return `${u} C ${order.from} → ${order.to}`;
    case 'hold':
    default: return `${u} holds`;
  }
}

// The most recent entry that actually resolved orders (skips adjustment phases).
function lastOrdersEntry(board) {
  const history = Array.isArray(board.orderHistory) ? board.orderHistory : [];
  return history.find((e) => e && e.orders) || null;
}

// A power's OWN orders last turn, with move outcomes — the record it must not
// contradict (its own moves are public once resolved).
function ownLastOrders(board, power) {
  const entry = lastOrdersEntry(board);
  if (!entry) return [];
  const moveSuccess = (entry.resolved && entry.resolved.moveSuccess) || {};
  const out = [];
  for (const [loc, order] of Object.entries(entry.orders)) {
    if (order.power !== power) continue;
    let line = describeOrderShort(order);
    if (order.type === 'move') line += moveSuccess[loc] ? ' (succeeded)' : ' (bounced/failed)';
    out.push(line);
  }
  return out;
}

// Every power's MOVE orders last turn, with outcome — the public record of who
// went where, so an agent is aware of attacks and advances across the board.
function lastTurnMoves(board, limit = 16) {
  const entry = lastOrdersEntry(board);
  if (!entry) return [];
  const moveSuccess = (entry.resolved && entry.resolved.moveSuccess) || {};
  const out = [];
  for (const [loc, order] of Object.entries(entry.orders)) {
    if (order.type !== 'move') continue;
    const who = POWER_NAMES[order.power] || order.power || 'A power';
    out.push(`${who}: ${order.unitLoc} → ${order.to} ${moveSuccess[loc] ? '✓' : '✗ (failed)'}`);
  }
  return out.slice(0, limit);
}

// Compact, one-line summaries of the most recent resolved turns, drawn from
// board.orderHistory (most-recent-first). Terse, to bound prompt size.
function recentResults(board, limit = 3) {
  const history = Array.isArray(board.orderHistory) ? board.orderHistory : [];
  return history.slice(0, limit).map((entry) => {
    if (entry.adjustments) {
      const n = Object.keys(entry.adjustments).length;
      return `${entry.phase}: ${n} adjustment${n === 1 ? '' : 's'} resolved.`;
    }
    const orders = entry.orders || {};
    const moveSuccess = (entry.resolved && entry.resolved.moveSuccess) || {};
    const moveLocs = Object.entries(orders).filter(([, o]) => o.type === 'move');
    const succeeded = moveLocs.filter(([loc]) => moveSuccess[loc]).length;
    const dislodged = Array.isArray(entry.retreats) ? entry.retreats.length : 0;
    const parts = [`${moveLocs.length} move${moveLocs.length === 1 ? '' : 's'} ordered, ${succeeded} succeeded`];
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
      lastOrders: ownLastOrders(board, power),
    },
    rivals,
    threats,
    lastMoves: lastTurnMoves(board),
    recentResults: recentResults(board),
  };
}
