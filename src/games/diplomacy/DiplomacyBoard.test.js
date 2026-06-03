import DiplomacyBoard, {
  POWERS,
  PROVINCES,
  SUPPLY_CENTERS,
  HOME_CENTERS,
  ARMY_ADJACENCY,
  FLEET_ADJACENCY,
  unitCanOccupy,
} from './DiplomacyBoard.js';

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
