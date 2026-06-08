import DiplomacyBoard, {
  POWERS,
  PROVINCES,
  SUPPLY_CENTERS,
  HOME_CENTERS,
  ARMY_ADJACENCY,
  FLEET_ADJACENCY,
  FLEET_COAST_ADJACENCY,
  COAST_PROVINCES,
  unitCanOccupy,
  adjacencyFor,
  baseProvince,
  coastOf,
  isSplitCoast,
} from './DiplomacyBoard.js';

// Set-equality assertion (order-independent) for adjacency lists.
function expectSameSet(actual, expected) {
  expect([...actual].sort()).toEqual([...expected].sort());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A bare board with no starting units/centers, parked in a given phase, so that
// adjudication tests can hand-place exactly the units they care about.
function emptyBoard({ phase = 'spring-orders', season = 'spring', year = 1901, maxYears = 1912 } = {}) {
  const board = new DiplomacyBoard({ skipInitialHistory: true, maxYears });
  board.units = {};
  board.phase = phase;
  board.season = season;
  board.year = year;
  return board;
}

function setUnits(board, units) {
  board.units = {};
  for (const [loc, spec] of Object.entries(units)) {
    board.units[loc] = { power: spec.power, type: spec.type };
  }
}

// Translate a *-plan object (from getLegalMoves / generate*Plans) into the
// applyMove envelope. Mirrors the documented shape mismatch in the issue.
function planToMove(plan, power) {
  if (plan.type === 'orders-plan') {
    return { type: 'orders', ordersByPower: { [power]: plan.orders } };
  }
  if (plan.type === 'retreats-plan') {
    return { type: 'retreats', retreatsByPower: { [power]: plan.retreats } };
  }
  if (plan.type === 'adjustments-plan') {
    return { type: 'adjustments', adjustmentsByPower: { [power]: plan.adjustments } };
  }
  return null;
}

// Assert that the board is in a legal positional state: at most one unit per
// province (the units map keys it that way) and every unit sits where it can.
function assertLegalState(board) {
  for (const [loc, unit] of Object.entries(board.units)) {
    expect(unitCanOccupy(unit.type, loc)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Data invariants
// ---------------------------------------------------------------------------

describe('Diplomacy map data invariants', () => {
  test('army adjacency is symmetric', () => {
    for (const [from, neighbors] of Object.entries(ARMY_ADJACENCY)) {
      for (const to of neighbors) {
        expect(ARMY_ADJACENCY[to]).toBeDefined();
        expect(ARMY_ADJACENCY[to]).toContain(from);
      }
    }
  });

  test('fleet adjacency is symmetric', () => {
    for (const [from, neighbors] of Object.entries(FLEET_ADJACENCY)) {
      for (const to of neighbors) {
        expect(FLEET_ADJACENCY[to]).toBeDefined();
        expect(FLEET_ADJACENCY[to]).toContain(from);
      }
    }
  });

  test('every adjacency id exists in PROVINCES with numeric coords', () => {
    const referenced = new Set();
    for (const map of [ARMY_ADJACENCY, FLEET_ADJACENCY]) {
      for (const [from, neighbors] of Object.entries(map)) {
        referenced.add(from);
        for (const to of neighbors) referenced.add(to);
      }
    }
    for (const id of referenced) {
      expect(PROVINCES[id]).toBeDefined();
    }
    for (const province of Object.values(PROVINCES)) {
      expect(typeof province.x).toBe('number');
      expect(typeof province.y).toBe('number');
      expect(Number.isFinite(province.x)).toBe(true);
      expect(Number.isFinite(province.y)).toBe(true);
    }
  });

  test('there are exactly 34 supply centers', () => {
    expect(SUPPLY_CENTERS.length).toBe(34);
  });

  test('22 home centers across 7 powers, each a supply center owned at start', () => {
    expect(POWERS.length).toBe(7);
    const total = POWERS.reduce((sum, power) => sum + HOME_CENTERS[power].length, 0);
    expect(total).toBe(22);

    const board = new DiplomacyBoard({ skipInitialHistory: true });
    for (const power of POWERS) {
      for (const center of HOME_CENTERS[power]) {
        expect(SUPPLY_CENTERS).toContain(center);
        expect(PROVINCES[center].supply).toBe(true);
        expect(board.supplyCenters[center]).toBe(power);
      }
    }
  });

  test('a fresh board has exactly 22 units matching INITIAL_UNITS', () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    expect(Object.keys(board.units).length).toBe(22);
    // Russia has 4, the other six have 3 each => 18 + 4 = 22.
    expect(board.getUnitCount('russia')).toBe(4);
    for (const power of POWERS.filter(p => p !== 'russia')) {
      expect(board.getUnitCount(power)).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Adjudication correctness
// ---------------------------------------------------------------------------

describe('Diplomacy adjudication', () => {
  test('an unopposed move succeeds', () => {
    const board = emptyBoard();
    setUnits(board, { BUD: { power: 'austria', type: 'army' } });

    expect(board.processOrders({ austria: [{ type: 'move', unitLoc: 'BUD', to: 'SER' }] })).toBe(true);
    expect(board.units.SER).toBeDefined();
    expect(board.units.SER.power).toBe('austria');
    expect(board.units.BUD).toBeUndefined();
  });

  test('two equal-strength moves into the same empty province both bounce', () => {
    const board = emptyBoard();
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      BUL: { power: 'turkey', type: 'army' },
    });

    board.processOrders({
      austria: [{ type: 'move', unitLoc: 'BUD', to: 'SER' }],
      turkey: [{ type: 'move', unitLoc: 'BUL', to: 'SER' }],
    });

    expect(board.units.SER).toBeUndefined();
    expect(board.units.BUD).toBeDefined();
    expect(board.units.BUL).toBeDefined();
  });

  test('a support-move dislodges a holding defender', () => {
    const board = emptyBoard();
    // BUD -> SER supported by TRI (TRI is army-adjacent to SER).
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
    });

    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      turkey: [{ type: 'hold', unitLoc: 'SER' }],
    });

    expect(board.units.SER.power).toBe('austria');
    // Defender is dislodged and must retreat.
    expect(board.pendingRetreats.some(r => r.unit.power === 'turkey')).toBe(true);
  });

  test("a unit can support ANOTHER power's move (cross-power support)", () => {
    const board = emptyBoard();
    // Germany's MUN supports Italy's VEN -> TYR, dislodging Austria in Tyrolia.
    setUnits(board, {
      VEN: { power: 'italy', type: 'army' },
      MUN: { power: 'germany', type: 'army' },
      TYR: { power: 'austria', type: 'army' },
    });

    // The support-move order for an opponent's unit must be offered to MUN.
    const supports = board.getLegalOrdersForUnit('MUN').filter(o => o.type === 'support-move');
    expect(supports.some(o => o.from === 'VEN' && o.to === 'TYR')).toBe(true);

    board.processOrders({
      italy: [{ type: 'move', unitLoc: 'VEN', to: 'TYR' }],
      germany: [{ type: 'support-move', unitLoc: 'MUN', from: 'VEN', to: 'TYR' }],
      austria: [{ type: 'hold', unitLoc: 'TYR' }],
    });

    expect(board.units.TYR.power).toBe('italy');
    expect(board.pendingRetreats.some(r => r.unit.power === 'austria')).toBe(true);
  });

  test('can support a move into a split-coast province (support is into the base)', () => {
    const board = emptyBoard();
    // Austria's army in Serbia supports Russia's fleet RUM -> BUL (a split coast).
    setUnits(board, {
      SER: { power: 'austria', type: 'army' },
      RUM: { power: 'russia', type: 'fleet' },
      BUL: { power: 'turkey', type: 'army' },
    });

    // The support option must be offered against the BASE province (BUL), even
    // though the fleet's actual destination is the coast-specific BUL/ec.
    const supports = board.getLegalOrdersForUnit('SER').filter(o => o.type === 'support-move');
    expect(supports.some(o => o.from === 'RUM' && o.to === 'BUL')).toBe(true);

    board.processOrders({
      russia: [{ type: 'move', unitLoc: 'RUM', to: 'BUL' }],
      austria: [{ type: 'support-move', unitLoc: 'SER', from: 'RUM', to: 'BUL' }],
      turkey: [{ type: 'hold', unitLoc: 'BUL' }],
    });

    // Russia takes Bulgaria (landing on a coast) and Turkey is dislodged.
    expect(board.units['BUL/ec'] ? board.units['BUL/ec'].power : board.units.BUL?.power).toBe('russia');
    expect(board.pendingRetreats.some(r => r.unit.power === 'turkey')).toBe(true);
  });

  test('support-move options are not truncated in dense positions', () => {
    const board = emptyBoard();
    const A = (power) => ({ power, type: 'army' });
    // Pack the provinces around Munich so it has > 28 legal support-moves (the
    // old hard cap of 28 silently dropped legal supports — often opponents').
    setUnits(board, {
      MUN: A('germany'),
      RUH: A('france'), KIE: A('russia'), BER: A('russia'), SIL: A('austria'),
      BOH: A('austria'), TYR: A('italy'), BUR: A('france'),
      HOL: A('england'), BEL: A('england'), PIC: A('france'), PAR: A('france'),
      GAS: A('france'), MAR: A('italy'), PIE: A('italy'), VEN: A('italy'),
      TRI: A('austria'), VIE: A('austria'), GAL: A('russia'), WAR: A('russia'),
      PRU: A('russia'), DEN: A('england'), SWE: A('russia'), HEL: A('england'),
    });
    const supports = board.getLegalOrdersForUnit('MUN').filter(o => o.type === 'support-move');
    expect(supports.length).toBeGreaterThan(28); // no longer capped
    expect(supports.some(o => board.units[o.from].power !== 'germany')).toBe(true);
  });

  test('a support is cut by an attacker other than the supported-against unit', () => {
    const board = emptyBoard();
    // Austria BUD -> SER supported by TRI. Russia ALB attacks TRI (the supporter),
    // cutting the support. Defender SER then holds 1 vs attack 1 => bounce.
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
      ALB: { power: 'russia', type: 'army' },
    });

    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      turkey: [{ type: 'hold', unitLoc: 'SER' }],
      russia: [{ type: 'move', unitLoc: 'ALB', to: 'TRI' }],
    });

    // Support cut: BUD's attack is strength 1, SER defends 1, so SER holds.
    expect(board.units.SER.power).toBe('turkey');
    expect(board.units.BUD).toBeDefined();
  });

  test('a support is NOT cut by the unit it is supporting against', () => {
    const board = emptyBoard();
    // Austria BUD -> SER, supported by TRI. The defender at SER attacks TRI.
    // TRI supports a move *into* SER, so an attack from SER must not cut it.
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
    });

    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      // SER counterattacks the supporter TRI; this attack must not cut the support.
      turkey: [{ type: 'move', unitLoc: 'SER', to: 'TRI' }],
    });

    // Support stands: BUD attacks with strength 2 and dislodges SER.
    expect(board.units.SER.power).toBe('austria');
    expect(board.pendingRetreats.some(r => r.unit.power === 'turkey')).toBe(true);
  });

  test('head-to-head with equal strength bounces both units', () => {
    const board = emptyBoard();
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });

    board.processOrders({
      austria: [{ type: 'move', unitLoc: 'BUD', to: 'GAL' }],
      russia: [{ type: 'move', unitLoc: 'GAL', to: 'BUD' }],
    });

    expect(board.units.BUD.power).toBe('austria');
    expect(board.units.GAL.power).toBe('russia');
  });

  test('head-to-head with unequal strength dislodges the weaker unit', () => {
    const board = emptyBoard();
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });

    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'GAL' },
        { type: 'support-move', unitLoc: 'VIE', from: 'BUD', to: 'GAL' },
      ],
      russia: [{ type: 'move', unitLoc: 'GAL', to: 'BUD' }],
    });

    expect(board.units.GAL.power).toBe('austria');
    expect(board.pendingRetreats.some(r => r.unit.power === 'russia')).toBe(true);
  });

  test('a convoy succeeds with a valid fleet path', () => {
    const board = emptyBoard();
    // Army LON convoyed by fleet NTH to coastal BEL (not army-adjacent to LON).
    setUnits(board, {
      LON: { power: 'england', type: 'army' },
      NTH: { power: 'england', type: 'fleet' },
    });

    board.processOrders({
      england: [
        { type: 'move', unitLoc: 'LON', to: 'BEL', viaConvoy: true },
        { type: 'convoy', unitLoc: 'NTH', from: 'LON', to: 'BEL' },
      ],
    });

    expect(board.units.BEL).toBeDefined();
    expect(board.units.BEL.power).toBe('england');
    expect(board.units.LON).toBeUndefined();
  });

  test('convoy disruption: dislodging the only convoying fleet fails the army move', () => {
    const board = emptyBoard();
    // England army LON convoyed by fleet NTH to BEL. France dislodges NTH with a
    // supported attack (SKA -> NTH supported by HEL). The army must stay home.
    setUnits(board, {
      LON: { power: 'england', type: 'army' },
      NTH: { power: 'england', type: 'fleet' },
      SKA: { power: 'france', type: 'fleet' },
      HEL: { power: 'france', type: 'fleet' },
    });

    board.processOrders({
      england: [
        { type: 'move', unitLoc: 'LON', to: 'BEL', viaConvoy: true },
        { type: 'convoy', unitLoc: 'NTH', from: 'LON', to: 'BEL' },
      ],
      france: [
        { type: 'move', unitLoc: 'SKA', to: 'NTH' },
        { type: 'support-move', unitLoc: 'HEL', from: 'SKA', to: 'NTH' },
      ],
    });

    // The convoying fleet is dislodged, so the army cannot teleport.
    expect(board.units.BEL).toBeUndefined();
    expect(board.units.LON).toBeDefined();
    expect(board.units.LON.power).toBe('england');
    // The dislodged fleet (England NTH) must retreat.
    expect(board.pendingRetreats.some(r => r.unit.power === 'england')).toBe(true);
  });

  test('dislodgement options exclude attacker origin, occupied, and contested provinces', () => {
    const board = emptyBoard();
    // Austria BUD -> SER (supported by TRI) dislodges Turkey SER.
    // SER army neighbors: TRI, BUD, RUM, BUL, GRE, ALB.
    //  - BUD is the attacker's origin -> excluded.
    //  - TRI is occupied by the surviving supporter -> excluded.
    //  - GRE is occupied by a surviving holder -> excluded.
    //  - BUL is contested (two equal units bounce into it) -> excluded.
    //  - ALB and RUM stay empty and are valid options.
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
      GRE: { power: 'turkey', type: 'army' },
      RUM: { power: 'russia', type: 'army' },
      CON: { power: 'turkey', type: 'army' },
    });

    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      turkey: [
        { type: 'hold', unitLoc: 'SER' },
        { type: 'hold', unitLoc: 'GRE' },
        // CON -> BUL bounces against RUM -> BUL, contesting BUL.
        { type: 'move', unitLoc: 'CON', to: 'BUL' },
      ],
      russia: [{ type: 'move', unitLoc: 'RUM', to: 'BUL' }],
    });

    const retreat = board.pendingRetreats.find(r => r.unitLoc === 'SER');
    expect(retreat).toBeTruthy();
    expect(retreat.options).not.toContain('BUD'); // attacker origin
    expect(retreat.options).not.toContain('TRI'); // occupied (supporter stayed)
    expect(retreat.options).not.toContain('GRE'); // occupied (holder)
    expect(retreat.options).not.toContain('BUL'); // contested
    expect(retreat.options).toContain('ALB'); // valid empty option
  });

  test('beleaguered garrison: two equal attackers both bounce and the occupant survives', () => {
    const board = emptyBoard();
    // SER occupied by Austria (holds). Turkey BUL and Russia RUM both attack SER
    // with strength 1. They standoff with each other, neither beats the defender.
    setUnits(board, {
      SER: { power: 'austria', type: 'army' },
      BUL: { power: 'turkey', type: 'army' },
      RUM: { power: 'russia', type: 'army' },
    });

    board.processOrders({
      austria: [{ type: 'hold', unitLoc: 'SER' }],
      turkey: [{ type: 'move', unitLoc: 'BUL', to: 'SER' }],
      russia: [{ type: 'move', unitLoc: 'RUM', to: 'SER' }],
    });

    expect(board.units.SER.power).toBe('austria');
    expect(board.units.BUL).toBeDefined();
    expect(board.units.RUM).toBeDefined();
    expect(board.pendingRetreats.length).toBe(0);
  });

  test('a power cannot dislodge its own unit (no self-dislodgement)', () => {
    const board = emptyBoard();
    // Austria BUD -> VIE (supported by TRI) but VIE is Austria's own holding unit.
    // The move must fail; no self-dislodgement even with superior strength.
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      VIE: { power: 'austria', type: 'army' },
    });

    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'VIE' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'VIE' },
        { type: 'hold', unitLoc: 'VIE' },
      ],
    });

    expect(board.units.VIE.power).toBe('austria');
    expect(board.units.BUD).toBeDefined(); // attack failed, stays home
    expect(board.pendingRetreats.length).toBe(0); // own unit never dislodged
  });
});

// ---------------------------------------------------------------------------
// Retreats
// ---------------------------------------------------------------------------

describe('Diplomacy retreats', () => {
  function dislodgeOneUnit() {
    // Set up a board where Turkey's SER gets dislodged, leaving a retreat pending.
    const board = emptyBoard();
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
    });
    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      turkey: [{ type: 'hold', unitLoc: 'SER' }],
    });
    return board;
  }

  test('a legal retreat to an empty option succeeds', () => {
    const board = dislodgeOneUnit();
    const retreat = board.pendingRetreats.find(r => r.unitLoc === 'SER');
    expect(retreat).toBeTruthy();
    const dest = retreat.options[0];

    expect(board.processRetreats({ turkey: [{ type: 'retreat', unitLoc: 'SER', to: dest }] })).toBe(true);
    expect(board.units[dest]).toBeDefined();
    expect(board.units[dest].power).toBe('turkey');
  });

  test('a retreat to a non-option disbands the unit', () => {
    const board = dislodgeOneUnit();
    // BUD is the attacker origin and never a legal option; retreating there fails.
    expect(board.units.SER.power).toBe('austria'); // attacker now occupies SER
    expect(board.processRetreats({ turkey: [{ type: 'retreat', unitLoc: 'SER', to: 'BUD' }] })).toBe(true);
    // The dislodged Turkish unit is gone entirely.
    expect(board.getUnitCount('turkey')).toBe(0);
  });

  test('two units retreating to the same destination both disband', () => {
    const board = emptyBoard();
    // Dislodge two units that share a common empty retreat square.
    // Austria dislodges Russia GAL (-> options incl. UKR) and Turkey BUL (-> options incl. nothing shared easily).
    // Simpler: hand-build pendingRetreats with overlapping options.
    board.phase = 'spring-retreats';
    board.units = { TRI: { power: 'austria', type: 'army' } };
    board.pendingRetreats = [
      { unitLoc: 'BUD', unit: { power: 'russia', type: 'army' }, attackerFrom: 'VIE', options: ['GAL'] },
      { unitLoc: 'SER', unit: { power: 'turkey', type: 'army' }, attackerFrom: 'ALB', options: ['GAL'] },
    ];

    expect(board.processRetreats({
      russia: [{ type: 'retreat', unitLoc: 'BUD', to: 'GAL' }],
      turkey: [{ type: 'retreat', unitLoc: 'SER', to: 'GAL' }],
    })).toBe(true);

    // Collision: neither unit survives at GAL.
    expect(board.units.GAL).toBeUndefined();
    expect(board.getUnitCount('russia')).toBe(0);
    expect(board.getUnitCount('turkey')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Winter builds / disbands
// ---------------------------------------------------------------------------

describe('Diplomacy winter adjustments', () => {
  test('a power over its center count disbands down', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    // Austria owns 1 center but has 2 units => must disband 1.
    board.supplyCenters = { BUD: 'austria' };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      VIE: { power: 'austria', type: 'army' },
    });

    expect(board.processAdjustments({ austria: [{ type: 'disband', unitLoc: 'VIE' }] })).toBe(true);
    expect(board.getUnitCount('austria')).toBe(1);
    expect(board.units.VIE).toBeUndefined();
  });

  test('a power under its center count builds only on its own empty home centers', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    // Austria owns its 3 home centers but has 0 units => may build 3.
    board.supplyCenters = { BUD: 'austria', TRI: 'austria', VIE: 'austria' };
    board.units = {};

    // A build on a non-home center (SER) must be ignored; a home build accepted.
    expect(board.processAdjustments({
      austria: [
        { type: 'build', power: 'austria', unitType: 'army', loc: 'SER' }, // not a home -> ignored
        { type: 'build', power: 'austria', unitType: 'army', loc: 'BUD' }, // home -> accepted
      ],
    })).toBe(true);

    expect(board.units.SER).toBeUndefined();
    expect(board.units.BUD).toBeDefined();
    expect(board.units.BUD.power).toBe('austria');
  });

  test('builds are capped by open home centers even with a positive delta', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    // Austria owns 3 home centers + SER (4 centers) but only one home is empty:
    // BUD is occupied by its own army, TRI is occupied, VIE is empty.
    board.supplyCenters = { BUD: 'austria', TRI: 'austria', VIE: 'austria', SER: 'austria' };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'fleet' },
    });
    // delta = 4 centers - 2 units = 2, but only VIE is an open home => buildCount 1.
    const adj = board.getAdjustments().austria;
    expect(adj.delta).toBe(2);
    expect(adj.openHomes).toEqual(['VIE']);
    expect(adj.buildCount).toBe(1);

    expect(board.processAdjustments({
      austria: [
        { type: 'build', power: 'austria', unitType: 'army', loc: 'VIE' },
        { type: 'build', power: 'austria', unitType: 'army', loc: 'BUD' }, // occupied -> ignored
      ],
    })).toBe(true);

    expect(board.getUnitCount('austria')).toBe(3); // 2 existing + 1 build
    expect(board.units.VIE).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Game flow / lifecycle
// ---------------------------------------------------------------------------

describe('Diplomacy lifecycle', () => {
  test('supply ownership updates after Fall, not after Spring', () => {
    // Spring: Austria sits on Turkey-owned SER -- ownership must NOT transfer.
    const springBoard = emptyBoard({ phase: 'spring-orders', season: 'spring' });
    springBoard.supplyCenters = { ...springBoard.supplyCenters, SER: 'turkey' };
    setUnits(springBoard, { SER: { power: 'austria', type: 'army' } });
    springBoard.processOrders({ austria: [{ type: 'hold', unitLoc: 'SER' }] });
    expect(springBoard.supplyCenters.SER).toBe('turkey');

    // Fall: same situation -- ownership transfers to Austria.
    const fallBoard = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    fallBoard.supplyCenters = { ...fallBoard.supplyCenters, SER: 'turkey' };
    setUnits(fallBoard, { SER: { power: 'austria', type: 'army' } });
    fallBoard.processOrders({ austria: [{ type: 'hold', unitLoc: 'SER' }] });
    expect(fallBoard.supplyCenters.SER).toBe('austria');
  });

  test('reaching 18 centers ends the game with that power as winner', () => {
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    // Give France 18 centers (it already controls them; a hold confirms ownership).
    const centers = SUPPLY_CENTERS.slice(0, 18);
    board.supplyCenters = {};
    for (const c of centers) board.supplyCenters[c] = 'france';
    // Place one french unit sitting on one of those centers so a fall resolution runs.
    setUnits(board, { [centers[0]]: { power: 'france', type: unitCanOccupy('army', centers[0]) ? 'army' : 'fleet' } });

    board.processOrders({ france: [{ type: 'hold', unitLoc: centers[0] }] });
    expect(board.phase).toBe('game-over');
    expect(board.winner).toBe('france');
  });

  test('exceeding maxYears ends the game with the leader as winner', () => {
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall', year: 1901, maxYears: 1901 });
    // France leads with 3 centers; nobody reaches 18.
    board.supplyCenters = { PAR: 'france', BRE: 'france', MAR: 'france', BUD: 'austria' };
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      BUD: { power: 'austria', type: 'army' },
    });

    // Fall 1901 with no builds advances to spring 1902 (> maxYears 1901) => game over.
    board.processOrders({
      france: [{ type: 'hold', unitLoc: 'PAR' }],
      austria: [{ type: 'hold', unitLoc: 'BUD' }],
    });
    // Drain any winter phase deterministically.
    if (board.phase === 'winter-build') board.processAdjustments({});

    expect(board.phase).toBe('game-over');
    expect(board.winner).toBe('france');
  });
});

// ---------------------------------------------------------------------------
// State plumbing
// ---------------------------------------------------------------------------

describe('Diplomacy state plumbing', () => {
  test('fromSerializedState(serializeState()) reproduces getStateHash exactly', () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    board.processOrders({ austria: [{ type: 'move', unitLoc: 'BUD', to: 'SER' }] });
    const copy = DiplomacyBoard.fromSerializedState(board.serializeState());
    expect(copy.getStateHash()).toBe(board.getStateHash());
  });

  test('clone is independent', () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    const clone = board.clone();
    expect(clone.getStateHash()).toBe(board.getStateHash());

    clone.units.BUD = { power: 'turkey', type: 'fleet' };
    delete clone.units.VIE;
    expect(board.units.BUD.power).toBe('austria');
    expect(board.units.VIE).toBeDefined();
  });

  test('undo restores the prior hash and redo re-applies it', () => {
    const board = new DiplomacyBoard(); // keep history for undo/redo
    const before = board.getStateHash();
    expect(board.canUndo()).toBe(false);

    board.processOrders({ austria: [{ type: 'move', unitLoc: 'BUD', to: 'SER' }] });
    const after = board.getStateHash();
    expect(after).not.toBe(before);
    expect(board.canUndo()).toBe(true);

    expect(board.undo()).toBe(true);
    expect(board.getStateHash()).toBe(before);
    expect(board.canRedo()).toBe(true);

    expect(board.redo()).toBe(true);
    expect(board.getStateHash()).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// AI legality / self-play
// ---------------------------------------------------------------------------

describe('Diplomacy AI legality', () => {
  test('orders plans translate into accepted applyMove envelopes', () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    expect(board.isOrdersPhase()).toBe(true);

    for (const power of board.getPowerIds()) {
      const plans = board.getLegalMoves(power);
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans.slice(0, 3)) {
        const probe = board.clone();
        const move = planToMove(plan, power);
        expect(move).toBeTruthy();
        expect(probe.applyMove(move)).toBe(true);
        assertLegalState(probe);
      }
    }
  });

  test('retreats plans translate into accepted applyMove envelopes', () => {
    // Build a position with a pending retreat, then exercise retreat plans.
    const board = emptyBoard();
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
    });
    board.processOrders({
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      turkey: [{ type: 'hold', unitLoc: 'SER' }],
    });
    expect(board.isRetreatPhase()).toBe(true);

    const plans = board.getLegalMoves('turkey');
    expect(plans.length).toBeGreaterThan(0);
    const probe = board.clone();
    expect(probe.applyMove(planToMove(plans[0], 'turkey'))).toBe(true);
    assertLegalState(probe);
  });

  test('adjustments plans translate into accepted applyMove envelopes', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { BUD: 'austria', TRI: 'austria', VIE: 'austria' };
    board.units = {}; // 3 centers, 0 units => builds available
    expect(board.isWinterPhase()).toBe(true);

    const plans = board.getLegalMoves('austria');
    expect(plans.length).toBeGreaterThan(0);
    const probe = board.clone();
    expect(probe.applyMove(planToMove(plans[0], 'austria'))).toBe(true);
    assertLegalState(probe);
  });

  test('low-budget self-play reaches game-over without illegal moves', () => {
    // Small maxYears keeps the game short; every applyMove must succeed.
    const board = new DiplomacyBoard({ maxYears: 1903 });
    let moves = 0;
    while (board.phase !== 'game-over' && moves < 200) {
      if (board.isWinterPhase()) {
        const adjustmentsByPower = {};
        for (const power of board.getPowerIds()) {
          const plan = board.getLegalMoves(power)[0];
          if (plan) adjustmentsByPower[power] = plan.adjustments;
        }
        expect(board.applyMove({ type: 'adjustments', adjustmentsByPower })).toBe(true);
      } else if (board.isRetreatPhase()) {
        const retreatsByPower = {};
        for (const power of board.getPowerIds()) {
          const plan = board.getLegalMoves(power)[0];
          if (plan) retreatsByPower[power] = plan.retreats;
        }
        expect(board.applyMove({ type: 'retreats', retreatsByPower })).toBe(true);
      } else {
        const ordersByPower = {};
        for (const power of board.getPowerIds()) {
          const plan = board.getLegalMoves(power)[0];
          if (plan) ordersByPower[power] = plan.orders;
        }
        expect(board.applyMove({ type: 'orders', ordersByPower })).toBe(true);
      }
      assertLegalState(board);
      moves++;
    }

    expect(board.phase).toBe('game-over');
    expect(moves).toBeLessThan(200);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Split coasts (STP / SPA / BUL) -- issue #24
// ---------------------------------------------------------------------------

describe('Diplomacy split-coast helpers and data', () => {
  test('COAST_PROVINCES enumerates exactly STP, SPA, BUL with two coasts each', () => {
    expect(Object.keys(COAST_PROVINCES).sort()).toEqual(['BUL', 'SPA', 'STP']);
    expect(COAST_PROVINCES.STP).toEqual(['nc', 'sc']);
    expect(COAST_PROVINCES.SPA).toEqual(['nc', 'sc']);
    expect(COAST_PROVINCES.BUL).toEqual(['ec', 'sc']);
  });

  test('baseProvince strips a coast suffix and passes bare ids through', () => {
    expect(baseProvince('STP/sc')).toBe('STP');
    expect(baseProvince('BUL/ec')).toBe('BUL');
    expect(baseProvince('PAR')).toBe('PAR');
  });

  test('coastOf extracts the coast tag or null for bare ids', () => {
    expect(coastOf('BUL/ec')).toBe('ec');
    expect(coastOf('STP/nc')).toBe('nc');
    expect(coastOf('PAR')).toBeNull();
  });

  test('isSplitCoast is true only for STP, SPA, BUL', () => {
    expect(isSplitCoast('STP')).toBe(true);
    expect(isSplitCoast('SPA')).toBe(true);
    expect(isSplitCoast('BUL')).toBe(true);
    expect(isSplitCoast('BRE')).toBe(false);
    expect(isSplitCoast('NTH')).toBe(false);
  });

  test('PROVINCES resolves for any coast-keyed loc via the base id', () => {
    expect(PROVINCES[baseProvince('STP/sc')]).toBeDefined();
    expect(PROVINCES[baseProvince('SPA/nc')].name).toBe('Spain');
  });
});

describe('Diplomacy coast adjacency', () => {
  test('each coast resolves to its exact canonical neighbor set', () => {
    expectSameSet(adjacencyFor('fleet', 'STP/nc'), ['BAR', 'NWY']);
    expectSameSet(adjacencyFor('fleet', 'STP/sc'), ['BOT', 'FIN', 'LVN']);
    expectSameSet(adjacencyFor('fleet', 'SPA/nc'), ['MAO', 'GAS', 'POR']);
    expectSameSet(adjacencyFor('fleet', 'SPA/sc'), ['MAO', 'POR', 'WES', 'GOL', 'MAR']);
    expectSameSet(adjacencyFor('fleet', 'BUL/ec'), ['BLA', 'RUM', 'CON']);
    expectSameSet(adjacencyFor('fleet', 'BUL/sc'), ['AEG', 'CON', 'GRE']);
  });

  test('FLEET_COAST_ADJACENCY table matches adjacencyFor for every coast', () => {
    for (const [base, coasts] of Object.entries(COAST_PROVINCES)) {
      for (const coast of coasts) {
        const loc = `${base}/${coast}`;
        expectSameSet(FLEET_COAST_ADJACENCY[loc], adjacencyFor('fleet', loc));
      }
    }
  });

  test('a coast never lists the other coast of the same province', () => {
    expect(adjacencyFor('fleet', 'STP/nc')).not.toContain('STP');
    expect(adjacencyFor('fleet', 'STP/sc')).not.toContain('STP');
    expect(adjacencyFor('fleet', 'SPA/nc')).not.toContain('SPA');
    expect(adjacencyFor('fleet', 'BUL/ec')).not.toContain('BUL');
  });

  test('coasts share only genuinely-bordering neighbors', () => {
    const intersect = (a, b) => a.filter(x => b.includes(x));
    expectSameSet(intersect(adjacencyFor('fleet', 'STP/nc'), adjacencyFor('fleet', 'STP/sc')), []);
    expectSameSet(intersect(adjacencyFor('fleet', 'SPA/nc'), adjacencyFor('fleet', 'SPA/sc')), ['MAO', 'POR']);
    expectSameSet(intersect(adjacencyFor('fleet', 'BUL/ec'), adjacencyFor('fleet', 'BUL/sc')), ['CON']);
  });

  test('the base fleet entry is the union of its two coasts', () => {
    for (const [base, coasts] of Object.entries(COAST_PROVINCES)) {
      const union = [...new Set(coasts.flatMap(c => FLEET_COAST_ADJACENCY[`${base}/${c}`]))];
      expectSameSet(FLEET_ADJACENCY[base], union);
    }
  });
});

describe('Diplomacy split-coast movement legality', () => {
  function fleetBoard(units) {
    const board = emptyBoard();
    setUnits(board, units);
    return board;
  }

  test('a fleet on BAR can move to STP/nc; a fleet on BOT can move to STP/sc', () => {
    const board = fleetBoard({ BAR: { power: 'russia', type: 'fleet' } });
    expect(board.getMoveTargets('BAR')).toContain('STP/nc');
    expect(board.getMoveTargets('BAR')).not.toContain('STP/sc');

    const board2 = fleetBoard({ BOT: { power: 'russia', type: 'fleet' } });
    expect(board2.getMoveTargets('BOT')).toContain('STP/sc');
    expect(board2.getMoveTargets('BOT')).not.toContain('STP/nc');
  });

  test('a fleet on MAO lists both SPA coasts as targets', () => {
    const board = fleetBoard({ MAO: { power: 'france', type: 'fleet' } });
    const targets = board.getMoveTargets('MAO');
    expect(targets).toContain('SPA/nc');
    expect(targets).toContain('SPA/sc');
    expect(targets).not.toContain('SPA'); // never the bare base id
  });

  test('a fleet on STP/sc can move to BOT, FIN, LVN', () => {
    const board = fleetBoard({ 'STP/sc': { power: 'russia', type: 'fleet' } });
    const targets = board.getMoveTargets('STP/sc');
    expect(targets).toEqual(expect.arrayContaining(['BOT', 'FIN', 'LVN']));
  });

  test('getMoveTargets(BAR) yields STP/nc (reverse coast resolution)', () => {
    const board = fleetBoard({ BAR: { power: 'russia', type: 'fleet' } });
    expect(board.getMoveTargets('BAR')).toContain('STP/nc');
  });

  test('a fleet on STP/nc cannot reach south-coast neighbors', () => {
    const board = fleetBoard({ 'STP/nc': { power: 'russia', type: 'fleet' } });
    const targets = board.getMoveTargets('STP/nc');
    for (const to of ['BOT', 'FIN', 'LVN']) expect(targets).not.toContain(to);
    expect(targets).toEqual(expect.arrayContaining(['BAR', 'NWY']));
  });

  test('a fleet on STP/sc cannot reach north-coast neighbors', () => {
    const board = fleetBoard({ 'STP/sc': { power: 'russia', type: 'fleet' } });
    const targets = board.getMoveTargets('STP/sc');
    expect(targets).not.toContain('BAR');
    expect(targets).not.toContain('NWY');
  });

  test('BUL coasts gate the Black Sea / Aegean split', () => {
    const ec = fleetBoard({ 'BUL/ec': { power: 'turkey', type: 'fleet' } });
    expect(ec.getMoveTargets('BUL/ec')).not.toContain('AEG');
    expect(ec.getMoveTargets('BUL/ec')).not.toContain('GRE');
    const sc = fleetBoard({ 'BUL/sc': { power: 'turkey', type: 'fleet' } });
    expect(sc.getMoveTargets('BUL/sc')).not.toContain('BLA');
    expect(sc.getMoveTargets('BUL/sc')).not.toContain('RUM');
  });

  test('SPA coasts gate the Atlantic / Mediterranean split', () => {
    const sc = fleetBoard({ 'SPA/sc': { power: 'france', type: 'fleet' } });
    expect(sc.getMoveTargets('SPA/sc')).not.toContain('GAS');
    const nc = fleetBoard({ 'SPA/nc': { power: 'france', type: 'fleet' } });
    for (const to of ['WES', 'GOL', 'MAR']) expect(nc.getMoveTargets('SPA/nc')).not.toContain(to);
  });

  test('_sanitizeOrder returns null for coast-violating fleet moves', () => {
    const board = fleetBoard({ 'STP/nc': { power: 'russia', type: 'fleet' } });
    expect(board._sanitizeOrder({ type: 'move', unitLoc: 'STP/nc', to: 'BOT' })).toBeNull();
    expect(board._sanitizeOrder({ type: 'move', unitLoc: 'STP/nc', to: 'STP/sc' })).toBeNull();

    const sc = fleetBoard({ 'SPA/sc': { power: 'france', type: 'fleet' } });
    expect(sc._sanitizeOrder({ type: 'move', unitLoc: 'SPA/sc', to: 'GAS' })).toBeNull();

    const ec = fleetBoard({ 'BUL/ec': { power: 'turkey', type: 'fleet' } });
    expect(ec._sanitizeOrder({ type: 'move', unitLoc: 'BUL/ec', to: 'AEG' })).toBeNull();
  });

  test('_sanitizeOrder resolves a bare split destination to the one reachable coast', () => {
    const board = fleetBoard({ BAR: { power: 'russia', type: 'fleet' } });
    const order = board._sanitizeOrder({ type: 'move', unitLoc: 'BAR', to: 'STP' });
    expect(order).toEqual({ type: 'move', unitLoc: 'BAR', to: 'STP/nc', viaConvoy: false });
  });

  test('_sanitizeOrder rejects an ambiguous bare split destination (two coasts reachable)', () => {
    const board = fleetBoard({ MAO: { power: 'france', type: 'fleet' } });
    // MAO borders both SPA coasts, so a bare "to: SPA" is ambiguous.
    expect(board._sanitizeOrder({ type: 'move', unitLoc: 'MAO', to: 'SPA' })).toBeNull();
    expect(board._sanitizeOrder({ type: 'move', unitLoc: 'MAO', to: 'SPA/nc' }))
      .toEqual({ type: 'move', unitLoc: 'MAO', to: 'SPA/nc', viaConvoy: false });
  });
});

describe('Diplomacy split-coast support / convoy / retreat', () => {
  test('a fleet cannot support an action on the opposite coast of its own province', () => {
    const board = emptyBoard();
    setUnits(board, { 'STP/sc': { power: 'russia', type: 'fleet' } });
    expect(board.canSupport('fleet', 'STP/sc', 'STP/nc')).toBe(false);
    expect(board.canSupport('fleet', 'STP/nc', 'STP/sc')).toBe(false);
  });

  test('BLA can support a BUL/ec action but not a BUL/sc action', () => {
    const board = emptyBoard();
    setUnits(board, { BLA: { power: 'turkey', type: 'fleet' } });
    expect(board.canSupport('fleet', 'BLA', 'BUL/ec')).toBe(true);
    expect(board.canSupport('fleet', 'BLA', 'BUL/sc')).toBe(false);
  });

  test('a support-move into a split province respects the supporting fleet coast', () => {
    // BLA supports RUM -> BUL/ec (legal); RUM moves to BUL/ec with strength 2.
    const board = emptyBoard();
    setUnits(board, {
      RUM: { power: 'turkey', type: 'fleet' },
      BLA: { power: 'turkey', type: 'fleet' },
      'BUL/sc': { power: 'russia', type: 'fleet' },
    });
    board.processOrders({
      turkey: [
        { type: 'move', unitLoc: 'RUM', to: 'BUL/ec' },
        { type: 'support-move', unitLoc: 'BLA', from: 'RUM', to: 'BUL/ec' },
      ],
      russia: [{ type: 'hold', unitLoc: 'BUL/sc' }],
    });
    // Russia's BUL fleet is dislodged; Turkey's fleet now holds BUL on the east coast.
    expect(board.units['BUL/ec']).toMatchObject({ power: 'turkey', type: 'fleet' });
    expect(board.units['BUL/sc']).toBeUndefined();
    expect(board.units.BUL).toBeUndefined();
    expect(board.isRetreatPhase()).toBe(true);
  });

  test('a dislodged fleet on SPA/nc only retreats to its north-coast neighbors', () => {
    const board = emptyBoard();
    setUnits(board, {
      'SPA/nc': { power: 'france', type: 'fleet' },
      MAO: { power: 'england', type: 'fleet' },
      POR: { power: 'england', type: 'fleet' },
    });
    // MAO -> SPA/nc with POR support dislodges France.
    board.processOrders({
      england: [
        { type: 'move', unitLoc: 'MAO', to: 'SPA/nc' },
        { type: 'support-move', unitLoc: 'POR', from: 'MAO', to: 'SPA/nc' },
      ],
      france: [{ type: 'hold', unitLoc: 'SPA/nc' }],
    });
    expect(board.isRetreatPhase()).toBe(true);
    const pending = board.pendingRetreats.find(e => e.unitLoc === 'SPA/nc');
    expect(pending).toBeDefined();
    // Only north-coast neighbors, minus the attacker origin (MAO) and occupied (POR).
    expect(pending.options).toEqual(['GAS']);
    for (const south of ['WES', 'GOL', 'MAR']) expect(pending.options).not.toContain(south);
  });
});

describe('Diplomacy split-coast builds', () => {
  test('a fleet build in a split home emits one order per coast plus a bare army build', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters.STP = 'russia';
    board.units = {}; // STP open, +1 build available
    const orders = board.getLegalAdjustmentOrders('russia');
    const stpOrders = orders.filter(o => baseProvince(o.loc) === 'STP');
    const fleetBuilds = stpOrders.filter(o => o.unitType === 'fleet').map(o => o.loc).sort();
    const armyBuilds = stpOrders.filter(o => o.unitType === 'army').map(o => o.loc);
    expect(fleetBuilds).toEqual(['STP/nc', 'STP/sc']);
    expect(armyBuilds).toEqual(['STP']);
  });

  test('a fleet build in a non-split coastal home yields exactly one fleet option', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters.BRE = 'france';
    board.units = {};
    const fleetBuilds = board.getLegalAdjustmentOrders('france')
      .filter(o => o.loc === 'BRE' && o.unitType === 'fleet');
    expect(fleetBuilds).toHaveLength(1);
  });

  test('processAdjustments builds a fleet on the chosen coast of a split home', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { STP: 'russia' };
    board.units = {};
    board.adjustments = board.getAdjustments();
    board.processAdjustments({ russia: [{ type: 'build', power: 'russia', unitType: 'fleet', loc: 'STP/nc' }] });
    expect(board.units['STP/nc']).toMatchObject({ power: 'russia', type: 'fleet' });
    expect(board.units.STP).toBeUndefined();
  });

  test('a split home accepts at most one build even if both coast orders are sent', () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { STP: 'russia' };
    board.units = {};
    board.adjustments = board.getAdjustments();
    board.processAdjustments({
      russia: [
        { type: 'build', power: 'russia', unitType: 'fleet', loc: 'STP/nc' },
        { type: 'build', power: 'russia', unitType: 'fleet', loc: 'STP/sc' },
      ],
    });
    expect(board.getUnitCount('russia')).toBe(1);
  });
});

describe('Diplomacy split-coast serialization & compat', () => {
  test('a board with F STP/sc round-trips through serialize/deserialize with the coast preserved', () => {
    const board = emptyBoard();
    setUnits(board, { 'STP/sc': { power: 'russia', type: 'fleet' } });
    const copy = DiplomacyBoard.fromSerializedState(board.serializeState());
    expect(copy.units['STP/sc']).toMatchObject({ power: 'russia', type: 'fleet' });
    expect(copy.getStateHash()).toBe(board.getStateHash());
    expect(copy.getStateHash()).toContain('STP/sc');
  });

  test('a legacy bare split-coast fleet normalizes to its default coast on load', () => {
    const legacy = {
      units: {
        STP: { power: 'russia', type: 'fleet' },
        SPA: { power: 'france', type: 'fleet' },
        BUL: { power: 'turkey', type: 'fleet' },
      },
      phase: 'spring-orders',
      season: 'spring',
      year: 1901,
    };
    const board = DiplomacyBoard.fromSerializedState(legacy);
    expect(board.units['STP/sc']).toMatchObject({ power: 'russia', type: 'fleet' });
    expect(board.units['SPA/sc']).toMatchObject({ power: 'france', type: 'fleet' });
    expect(board.units['BUL/sc']).toMatchObject({ power: 'turkey', type: 'fleet' });
    expect(board.units.STP).toBeUndefined();
    expect(board.units.SPA).toBeUndefined();
    expect(board.units.BUL).toBeUndefined();
  });

  test('a legacy bare ARMY on a split province stays a bare base id', () => {
    const board = DiplomacyBoard.fromSerializedState({
      units: { BUL: { power: 'turkey', type: 'army' } },
      phase: 'spring-orders', season: 'spring', year: 1901,
    });
    expect(board.units.BUL).toMatchObject({ power: 'turkey', type: 'army' });
  });

  test('clone preserves split-coast keys', () => {
    const board = emptyBoard();
    setUnits(board, {
      'STP/nc': { power: 'russia', type: 'fleet' },
      'BUL/ec': { power: 'turkey', type: 'fleet' },
    });
    const clone = board.clone();
    expect(clone.units['STP/nc']).toMatchObject({ power: 'russia', type: 'fleet' });
    expect(clone.units['BUL/ec']).toMatchObject({ power: 'turkey', type: 'fleet' });
  });

  test('the default new game starts Russia with a fleet at STP/sc', () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    expect(board.units['STP/sc']).toMatchObject({ power: 'russia', type: 'fleet' });
    expect(board.units.STP).toBeUndefined();
  });
});

describe('Diplomacy split-coast regression guards', () => {
  test('army adjacency for STP, SPA, BUL is unchanged', () => {
    expectSameSet(ARMY_ADJACENCY.STP, ['NWY', 'FIN', 'LVN', 'MOS']);
    expectSameSet(ARMY_ADJACENCY.SPA, ['POR', 'GAS', 'MAR']);
    expectSameSet(ARMY_ADJACENCY.BUL, ['SER', 'RUM', 'CON', 'GRE']);
  });

  test('supply-center ownership keys remain bare base ids even with a coast fleet', () => {
    const board = emptyBoard({ season: 'fall', phase: 'fall-orders' });
    board.supplyCenters = { STP: null };
    setUnits(board, { 'STP/sc': { power: 'russia', type: 'fleet' } });
    board._updateSupplyOwnership();
    expect(board.supplyCenters.STP).toBe('russia');
    expect(board.supplyCenters['STP/sc']).toBeUndefined();
  });

  test('an army moves into and out of a split province using the bare base id', () => {
    const board = emptyBoard();
    setUnits(board, { MOS: { power: 'russia', type: 'army' } });
    expect(board.getMoveTargets('MOS')).toContain('STP');
    board.processOrders({ russia: [{ type: 'move', unitLoc: 'MOS', to: 'STP' }] });
    expect(board.units.STP).toMatchObject({ power: 'russia', type: 'army' });
    expect(board.units['STP/sc']).toBeUndefined();
  });

  test('no non-split province gains or loses fleet adjacency (sampled)', () => {
    expectSameSet(FLEET_ADJACENCY.BRE, ['ENG', 'MAO', 'PIC', 'GAS']);
    expectSameSet(FLEET_ADJACENCY.NTH, ['NWG', 'NWY', 'SKA', 'DEN', 'HEL', 'HOL', 'BEL', 'ENG', 'LON', 'YOR', 'EDI']);
    expectSameSet(FLEET_ADJACENCY.GAS, ['MAO', 'BRE', 'SPA']);
  });

  test('getStateHash for a board with no split-coast fleets is stable', () => {
    // A board whose only split-province units are armies (bare ids) must hash
    // exactly as it would have pre-change: no coast suffixes appear anywhere.
    const board = emptyBoard();
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      BUL: { power: 'turkey', type: 'army' },
      STP: { power: 'russia', type: 'army' },
    });
    const hash = board.getStateHash();
    expect(hash).not.toContain('/');
    expect(hash).toContain('BUL:ta');
    expect(hash).toContain('STP:ra');
    // Round-trips identically.
    expect(DiplomacyBoard.fromSerializedState(board.serializeState()).getStateHash()).toBe(hash);
  });
});

describe('Diplomacy convoy coherence (AI orders)', () => {
  test('getConvoyTargets only routes through the army owner\'s own fleets', () => {
    const board = emptyBoard();
    setUnits(board, { DEN: { power: 'germany', type: 'army' }, NTH: { power: 'england', type: 'fleet' } });
    expect(board.getConvoyTargets('DEN')).not.toContain('LON'); // England's fleet won't carry it
    setUnits(board, { DEN: { power: 'germany', type: 'army' }, NTH: { power: 'germany', type: 'fleet' } });
    expect(board.getConvoyTargets('DEN')).toContain('LON'); // own fleet carries it
  });

  test('makeOrdersCoherent demotes a convoy move that no fleet is carrying', () => {
    const board = emptyBoard();
    setUnits(board, { YOR: { power: 'england', type: 'army' }, NTH: { power: 'england', type: 'fleet' } });
    // Army told to sail to NWY but the fleet moves off to NWG instead of convoying.
    const cleaned = board.makeOrdersCoherent(
      [{ type: 'move', unitLoc: 'YOR', to: 'NWY', viaConvoy: true }, { type: 'move', unitLoc: 'NTH', to: 'NWG' }],
      'england'
    );
    const yor = cleaned.find((o) => o.unitLoc === 'YOR');
    expect(yor.viaConvoy).toBeFalsy(); // no dead sail
  });

  test('makeOrdersCoherent keeps a convoy move that a fleet actually carries', () => {
    const board = emptyBoard();
    setUnits(board, { YOR: { power: 'england', type: 'army' }, NTH: { power: 'england', type: 'fleet' } });
    const orders = [
      { type: 'move', unitLoc: 'YOR', to: 'NWY', viaConvoy: true },
      { type: 'convoy', unitLoc: 'NTH', from: 'YOR', to: 'NWY' },
    ];
    const cleaned = board.makeOrdersCoherent(orders, 'england');
    const yor = cleaned.find((o) => o.unitLoc === 'YOR');
    expect(yor).toEqual({ type: 'move', unitLoc: 'YOR', to: 'NWY', viaConvoy: true });
  });

  test('buildConvoyPlan pairs the army sail with its fleet\'s convoy order', () => {
    const board = emptyBoard();
    setUnits(board, { YOR: { power: 'england', type: 'army' }, NTH: { power: 'england', type: 'fleet' } });
    const plan = board.buildConvoyPlan('england', 'YOR', 'NWY');
    expect(plan).not.toBeNull();
    expect(plan.orders).toContainEqual({ type: 'move', unitLoc: 'YOR', to: 'NWY', viaConvoy: true });
    expect(plan.orders).toContainEqual({ type: 'convoy', unitLoc: 'NTH', from: 'YOR', to: 'NWY' });
  });
});
