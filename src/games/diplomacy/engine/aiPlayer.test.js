import DiplomacyBoard from '../DiplomacyBoard.js';
import { getOrders, getRetreats, getAdjustments, evaluatePosition, predictOpponentPlans } from './aiPlayer.js';

// ---------------------------------------------------------------------------
// Helpers (mirror DiplomacyBoard.test.js fixtures)
// ---------------------------------------------------------------------------

// A bare board with no starting units/centers, parked in a given phase, so each
// test hands-places exactly the units/centers it cares about.
function emptyBoard({ phase = 'spring-orders', season = 'spring', year = 1901, maxYears = 1912 } = {}) {
  const board = new DiplomacyBoard({ skipInitialHistory: true, maxYears });
  board.units = {};
  board.supplyCenters = {};
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

// Build a supplyCenters map where every center is owned by austria except one
// enemy-held center. This removes lone-grab temptations so the only positive
// play is dislodging the named enemy center, isolating the supported-attack
// criterion. Every center is named explicitly so a clone (which re-seeds home
// defaults for unset centers) preserves the same ownership.
function austriaWithEnemyCenter(center, enemy) {
  const map = {};
  for (const c of DiplomacyBoard.SUPPLY_CENTERS) map[c] = 'austria';
  map[center] = enemy;
  return map;
}

// Drop a per-power orders fragment into the matching *ByPower envelope and apply
// it to a clone, returning { ok, clone }. Throws propagate (the test wants none).
function applyOrders(board, power, orders) {
  const clone = board.clone();
  const ok = clone.applyMove({ type: 'orders', ordersByPower: { [power]: orders } });
  return { ok, clone };
}

// ---------------------------------------------------------------------------
// Positive criteria
// ---------------------------------------------------------------------------

describe('Diplomacy AI -- orders phase tactics', () => {
  test('supported attack beats a 1-strength defender (supporter holds, attacker moves)', async () => {
    // Austria armies in GAL + SIL attack russian-held WAR (a supply center).
    // GAL->WAR supported by SIL dislodges the defender; an unsupported bounce
    // would fail. WAR is the only enemy center adjacent, so it is the best play.
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    // WAR (russia) is the only enemy/neutral center the attackers can reach; the
    // other adjacent centers are pinned to austria so a lone grab is no better
    // than the supported dislodgement of WAR.
    board.supplyCenters = austriaWithEnemyCenter('WAR', 'russia');
    setUnits(board, {
      GAL: { power: 'austria', type: 'army' }, // GAL borders WAR
      SIL: { power: 'austria', type: 'army' }, // SIL borders WAR
      WAR: { power: 'russia', type: 'army' },
    });

    const { orders } = await getOrders(board, 'austria');
    const move = orders.find(o => o.type === 'move' && o.to === 'WAR');
    const support = orders.find(o => o.type === 'support-move' && o.to === 'WAR' && o.from === move?.unitLoc);
    expect(move).toBeDefined();
    expect(support).toBeDefined();

    // The supported attack actually dislodges the defender.
    const { ok, clone } = applyOrders(board, 'austria', orders);
    expect(ok).toBe(true);
    expect(clone.pendingRetreats.some(r => r.unit.power === 'russia')).toBe(true);
  });

  test('captures an undefended enemy supply center in fall (center count increases)', async () => {
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    board.supplyCenters = { SER: 'turkey', BUD: 'austria' };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' }, // BUD borders SER
    });

    const before = board.getSupplyCount('austria');
    const { orders } = await getOrders(board, 'austria');
    const { ok, clone } = applyOrders(board, 'austria', orders);
    expect(ok).toBe(true);
    expect(clone.getSupplyCount('austria')).toBeGreaterThan(before);
    expect(clone.supplyCenters.SER).toBe('austria');
  });

  test('best-response is at least as good as the raw greedy top plan', async () => {
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    board.supplyCenters = { GAL: null, SER: 'turkey' };
    setUnits(board, {
      VIE: { power: 'austria', type: 'army' },
      BOH: { power: 'austria', type: 'army' },
      BUD: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });

    const greedyTop = board.generateCandidatePlans('austria', { maxPlans: 1 })[0];
    const greedyClone = board.clone();
    greedyClone.applyMove({ type: 'orders', ordersByPower: { austria: greedyTop.orders } });
    const greedyValue = evaluatePosition(greedyClone, 'austria');

    const { orders } = await getOrders(board, 'austria', { difficulty: 'hard' });
    const brClone = board.clone();
    brClone.applyMove({ type: 'orders', ordersByPower: { austria: orders } });
    const brValue = evaluatePosition(brClone, 'austria');

    expect(brValue).toBeGreaterThanOrEqual(greedyValue);
  });

  test('intent === null still picks the supported attack', async () => {
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    board.supplyCenters = austriaWithEnemyCenter('WAR', 'russia');
    setUnits(board, {
      GAL: { power: 'austria', type: 'army' },
      SIL: { power: 'austria', type: 'army' },
      WAR: { power: 'russia', type: 'army' },
    });
    const { orders } = await getOrders(board, 'austria', { intent: null });
    expect(orders.some(o => o.type === 'support-move' && o.to === 'WAR')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Legality across all phases
// ---------------------------------------------------------------------------

describe('Diplomacy AI -- every returned order is accepted by applyMove', () => {
  test('spring orders accepted', async () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    const { orders } = await getOrders(board, 'austria');
    const { ok } = applyOrders(board, 'austria', orders);
    expect(ok).toBe(true);
  });

  test('fall orders accepted', async () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    board.phase = 'fall-orders';
    board.season = 'fall';
    const { orders } = await getOrders(board, 'germany');
    const { ok } = applyOrders(board, 'germany', orders);
    expect(ok).toBe(true);
  });

  test('orders survive _normalizeOrders unchanged (no illegal orders)', async () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    const { orders } = await getOrders(board, 'france');
    const byLoc = board._normalizeOrders({ france: orders });
    // Every returned order must appear unchanged in the normalized map; if the
    // engine had emitted an illegal order it would be replaced by a hold.
    for (const order of orders) {
      expect(byLoc[order.unitLoc]).toMatchObject(order);
    }
  });

  test('retreat orders accepted', async () => {
    const board = emptyBoard({ phase: 'spring-retreats', season: 'spring' });
    board.units = { TRI: { power: 'austria', type: 'army' } };
    board.pendingRetreats = [
      { unitLoc: 'BUD', unit: { power: 'russia', type: 'army' }, attackerFrom: 'VIE', options: ['GAL', 'RUM'] },
    ];
    const { retreats } = await getRetreats(board, 'russia');
    const clone = board.clone();
    expect(clone.applyMove({ type: 'retreats', retreatsByPower: { russia: retreats } })).toBe(true);
  });

  test('winter build orders accepted', async () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { BUD: 'austria', TRI: 'austria', VIE: 'austria' };
    board.units = {};
    const { adjustments } = await getAdjustments(board, 'austria');
    const clone = board.clone();
    expect(clone.applyMove({ type: 'adjustments', adjustmentsByPower: { austria: adjustments } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// intent hook
// ---------------------------------------------------------------------------

describe('Diplomacy AI -- intent bias', () => {
  test('allies: never attacks an ally unit when a non-attacking alternative exists', async () => {
    // Austria VIE could move into GAL (occupied by ally Russia) or hold/other.
    const board = emptyBoard({ phase: 'spring-orders', season: 'spring' });
    board.supplyCenters = { GAL: 'russia' };
    setUnits(board, {
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });
    const { orders } = await getOrders(board, 'austria', { intent: { allies: ['russia'] } });
    const attacksAlly = orders.some(o => o.type === 'move' && o.to === 'GAL');
    expect(attacksAlly).toBe(false);
  });

  test('supportDeals: a legally fulfillable deal appears in the plan', async () => {
    // France PAR can support BUR (BUR is adjacent to PAR). Deal {from: PAR, to: BUR}.
    const board = emptyBoard({ phase: 'spring-orders', season: 'spring' });
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      MAR: { power: 'france', type: 'army' }, // MAR borders BUR -> can move into BUR
    });
    const { orders } = await getOrders(board, 'france', {
      intent: { supportDeals: [{ from: 'PAR', to: 'BUR' }] },
    });
    const support = orders.find(
      o => o.unitLoc === 'PAR' && (o.type === 'support-move' || o.type === 'support-hold')
        && (o.to === 'BUR' || o.target === 'BUR')
    );
    expect(support).toBeDefined();
  });

  test('dmz: no order moves into a dmz province when an alternative exists', async () => {
    const board = emptyBoard({ phase: 'spring-orders', season: 'spring' });
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
    });
    const { orders } = await getOrders(board, 'france', { intent: { dmz: ['BUR'] } });
    expect(orders.some(o => o.type === 'move' && o.to === 'BUR')).toBe(false);
  });

  test('opponent prediction honours a known opponent intent (allies not attacked)', () => {
    // Austria BUD's natural objective is Rumania (a Russian-held supply
    // center); with Austria's recorded intent naming Russia an ally, the plans
    // France PREDICTS for Austria no longer attack it.
    const board = emptyBoard({ phase: 'spring-orders', season: 'spring' });
    board.supplyCenters = { RUM: 'russia' };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      RUM: { power: 'russia', type: 'army' },
      PAR: { power: 'france', type: 'army' },
    });
    const attacksRum = (plans) =>
      plans.some((orders) => orders.some((o) => o.type === 'move' && o.to === 'RUM'));

    const blind = predictOpponentPlans(board, 'france', 3, null);
    expect(attacksRum(blind.austria)).toBe(true);

    const informed = predictOpponentPlans(board, 'france', 3, {
      austria: { allies: ['russia'], targets: [], supportDeals: [], dmz: [], betrayals: [] },
    });
    expect(attacksRum(informed.austria)).toBe(false);
  });

  test('getOrders accepts an intents map and stays deterministic', async () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    const intents = {
      germany: { allies: ['russia'], targets: [], supportDeals: [], dmz: [], betrayals: [] },
    };
    const a = await getOrders(board, 'france', { seed: 3, intents });
    const b = await getOrders(board, 'france', { seed: 3, intents });
    expect(a.orders).toEqual(b.orders);
    expect(a.orders.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Deterministic mode
// ---------------------------------------------------------------------------

describe('Diplomacy AI -- deterministic mode', () => {
  test('same board + same seed returns identical orders', async () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    const a = await getOrders(board, 'russia', { seed: 7, difficulty: 'hard' });
    const b = await getOrders(board, 'russia', { seed: 7, difficulty: 'hard' });
    expect(a.orders).toEqual(b.orders);
  });
});

// ---------------------------------------------------------------------------
// Negative / boundary
// ---------------------------------------------------------------------------

describe('Diplomacy AI -- boundary cases', () => {
  test('no legal builds returns { adjustments: [] } and applyMove accepts it', async () => {
    // delta > 0 but all home centers occupied -> no open homes.
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { BUD: 'austria', TRI: 'austria', VIE: 'austria', SER: 'austria' };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'fleet' },
      VIE: { power: 'austria', type: 'army' },
    });
    const adj = board.getAdjustments().austria;
    expect(adj.delta).toBeGreaterThan(0);
    expect(adj.openHomes).toEqual([]);

    const { adjustments } = await getAdjustments(board, 'austria');
    expect(adjustments).toEqual([]);
    const clone = board.clone();
    expect(clone.applyMove({ type: 'adjustments', adjustmentsByPower: { austria: adjustments } })).toBe(true);
  });

  test('forced disbands returns exactly disbandCount lowest-value disbands', async () => {
    const board = emptyBoard({ phase: 'winter-build' });
    // Austria owns 1 center but has 3 units => must disband 2. The other home
    // centers are pinned to null so a clone (which re-seeds home defaults) keeps
    // the negative delta.
    board.supplyCenters = { BUD: 'austria', TRI: null, VIE: null };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'austria', type: 'army' },
    });
    const adj = board.getAdjustments().austria;
    expect(adj.disbandCount).toBe(2);

    const { adjustments } = await getAdjustments(board, 'austria');
    expect(adjustments.length).toBe(2);
    expect(adjustments.every(o => o.type === 'disband')).toBe(true);

    // The two disbanded units are the lowest-provinceValue ones.
    const allLocs = board.getUnitLocations('austria');
    const sortedByValue = [...allLocs].sort((a, b) => board.provinceValue('austria', a) - board.provinceValue('austria', b));
    const expectedLocs = new Set(sortedByValue.slice(0, 2));
    const gotLocs = new Set(adjustments.map(o => o.unitLoc));
    expect(gotLocs).toEqual(expectedLocs);

    const clone = board.clone();
    expect(clone.applyMove({ type: 'adjustments', adjustmentsByPower: { austria: adjustments } })).toBe(true);
    expect(clone.getUnitCount('austria')).toBe(1);
  });

  test('multi-unit colliding retreats avoid the same dest; no-option unit disbands', async () => {
    const board = emptyBoard({ phase: 'spring-retreats', season: 'spring' });
    board.units = { TRI: { power: 'austria', type: 'army' } };
    // Two russia units with distinct options plus a shared one; AI should not
    // send both to the same province when distinct legal options exist.
    board.pendingRetreats = [
      { unitLoc: 'BUD', unit: { power: 'russia', type: 'army' }, attackerFrom: 'VIE', options: ['GAL', 'RUM'] },
      { unitLoc: 'SER', unit: { power: 'russia', type: 'army' }, attackerFrom: 'ALB', options: ['GAL', 'BUL'] },
    ];
    const { retreats } = await getRetreats(board, 'russia');
    const targets = retreats.filter(r => r.to).map(r => r.to);
    expect(new Set(targets).size).toBe(targets.length); // no duplicate destinations

    const clone = board.clone();
    expect(clone.applyMove({ type: 'retreats', retreatsByPower: { russia: retreats } })).toBe(true);
    expect(clone.getUnitCount('russia')).toBe(2);
  });

  test('a unit with no legal retreat is disbanded (to: null)', async () => {
    const board = emptyBoard({ phase: 'spring-retreats', season: 'spring' });
    board.units = { TRI: { power: 'austria', type: 'army' } };
    board.pendingRetreats = [
      { unitLoc: 'BUD', unit: { power: 'russia', type: 'army' }, attackerFrom: 'VIE', options: [] },
    ];
    const { retreats } = await getRetreats(board, 'russia');
    const order = retreats.find(r => r.unitLoc === 'BUD');
    expect(order.to).toBeNull();
    const clone = board.clone();
    expect(clone.applyMove({ type: 'retreats', retreatsByPower: { russia: retreats } })).toBe(true);
    expect(clone.getUnitCount('russia')).toBe(0);
  });

  test('a power with zero units returns an empty orders fragment without throwing', async () => {
    const board = emptyBoard({ phase: 'spring-orders', season: 'spring' });
    setUnits(board, { PAR: { power: 'france', type: 'army' } });
    const { orders } = await getOrders(board, 'austria');
    expect(orders).toEqual([]);
    const { ok } = applyOrders(board, 'austria', orders);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-power resolution (mirrors the worker's internal loop)
// ---------------------------------------------------------------------------

describe('Diplomacy AI -- multi-power resolution', () => {
  test('resolves orders for all six AI powers in one pass; combined apply is legal', async () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true });
    const aiPowers = DiplomacyBoard.POWERS.filter(p => p !== 'england'); // 6 powers
    const byPower = {};
    for (const power of aiPowers) {
      const { orders } = await getOrders(board, power, { difficulty: 'easy' });
      byPower[power] = orders;
    }
    expect(Object.keys(byPower)).toHaveLength(6);

    // All six fragments applied together must be accepted by the forward model.
    const clone = board.clone();
    expect(clone.applyMove({ type: 'orders', ordersByPower: byPower })).toBe(true);
  });
});
