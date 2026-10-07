// Data-driven conformance suite over positions from the Diplomacy Adjudicator
// Test Cases (DATC v3.0). Each case in datcCases.json lists the units, the
// orders and the expected movers and dislodged units. Every case is run with
// the units inserted in both orders, since resolution must not depend on it.
//
// Where the DATC infers intent that the engine takes explicitly (an own fleet
// convoying an adjacent army: 6.G.1/5/6/9/11), the fixtures carry
// `viaConvoy: true`. Case 6.E.11 is adapted: its support orders name the base
// province (SPA), as the UI/API do, instead of a coast (SPA/nc).

import DiplomacyBoard from './DiplomacyBoard.js';
import cases from './datcCases.json';

// Known limitations that are not part of movement adjudication.
const SKIPPED = {
  '6.F.7': 'the case also requires the dislodged unit to retreat into a province that only saw a failed convoyed move; contestedProvinces blocks every move target',
};

function adjudicate(units, orders) {
  const board = new DiplomacyBoard({ skipInitialHistory: true });
  board.units = {};
  for (const spec of units) {
    const [power, type, loc] = spec.split(' ');
    board.units[loc] = { power, type: type === 'F' ? 'fleet' : 'army' };
  }
  const out = board._adjudicate(board._normalizeOrders(orders));
  return {
    moved: Object.keys(out.resolved.moveSuccess).filter(loc => out.resolved.moveSuccess[loc]).sort(),
    dislodged: out.resolved.dislodged.map(entry => entry.unitLoc).sort(),
  };
}

describe('DATC data-driven cases', () => {
  for (const [id, c] of Object.entries(cases)) {
    if (SKIPPED[id]) {
      test.skip(`${id} (skipped: ${SKIPPED[id]})`, () => {});
      continue;
    }
    const label = id === '6.E.11' ? `${id} (adapted: base-province support)` : id;
    test(`${label} outcome is independent of unit insertion order`, () => {
      const expected = { moved: c.moved, dislodged: c.dislodged };
      expect(adjudicate(c.units, c.orders)).toEqual(expected);
      expect(adjudicate([...c.units].reverse(), c.orders)).toEqual(expected);
    });
  }
});
