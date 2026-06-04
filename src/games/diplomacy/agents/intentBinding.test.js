import DiplomacyBoard from '../DiplomacyBoard.js';
import {
  bindOrders,
  bindRetreats,
  bindAdjustments,
  reconcileHonored,
} from './intentBinding.js';

// ---------------------------------------------------------------------------
// Helpers (mirror DiplomacyBoard.test.js / aiPlayer.test.js fixtures)
// ---------------------------------------------------------------------------

// A bare board with no starting units/centers, parked in a given phase, so each
// test hands-places exactly the units it cares about.
function emptyBoard({ phase = 'spring-orders', season = 'spring', year = 1901 } = {}) {
  const board = new DiplomacyBoard({ skipInitialHistory: true });
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

// A stub tactical engine the test controls. `scripts[power]` (a function or
// array of orders) supplies that power's fragment; powers with no script fall
// back to a competent baseline (the board's top candidate plan). `throwFor`
// names a power for which the stub throws (engine-failure simulation). Returns
// the contract shape `{ orders: [...] }`.
function makeStub({ scripts = {}, throwFor = null } = {}) {
  return async function getOrders(board, power, options = {}) {
    if (throwFor && power === throwFor) throw new Error(`stub failure for ${power}`);
    const script = scripts[power];
    if (typeof script === 'function') return { orders: script(board, power, options) };
    if (Array.isArray(script)) return { orders: script };
    // Competent baseline: the board's own top candidate plan.
    const plans = board.generateCandidatePlans(power);
    return { orders: (plans[0] && plans[0].orders) || [] };
  };
}

function holds(board, power) {
  return board.getUnitLocations(power).map((unitLoc) => ({ type: 'hold', unitLoc }));
}

// ---------------------------------------------------------------------------
// bindOrders -- honoring & shapes
// ---------------------------------------------------------------------------

describe('bindOrders -- deal honoring & legality', () => {
  test('a legal supportDeal yields exactly that support order, verified vs getLegalOrdersForUnit', async () => {
    // France PAR can support MAR's move into BUR (PAR & MAR both border BUR).
    const board = emptyBoard();
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      MAR: { power: 'france', type: 'army' },
    });
    const intentByPower = {
      france: { ...emptyIntent(), supportDeals: [{ from: 'MAR', to: 'BUR' }] },
    };
    // Stub returns only holds; the binding must inject the committed support.
    const getOrders = makeStub({ scripts: { france: holds(board, 'france') } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const support = ordersByPower.france.find(
      (o) => o.type === 'support-move' && o.from === 'MAR' && o.to === 'BUR',
    );
    expect(support).toBeDefined();
    // The injected support must be a genuinely legal order for its unit.
    const legal = board.getLegalOrdersForUnit(support.unitLoc);
    expect(
      legal.some((o) => o.type === 'support-move' && o.from === 'MAR' && o.to === 'BUR'),
    ).toBe(true);
  });

  test('all ordersByPower are accepted by applyMove and the support survives in orderHistory[0].orders', async () => {
    const board = emptyBoard();
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      MAR: { power: 'france', type: 'army' },
    });
    const intentByPower = {
      france: { ...emptyIntent(), supportDeals: [{ from: 'MAR', to: 'BUR' }] },
    };
    const getOrders = makeStub({ scripts: { france: holds(board, 'france') } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const clone = board.clone();
    expect(clone.applyMove({ type: 'orders', ordersByPower })).toBe(true);
    const issued = clone.orderHistory[0].orders;
    const support = Object.values(issued).find(
      (o) => o.type === 'support-move' && o.from === 'MAR' && o.to === 'BUR',
    );
    expect(support).toBeDefined(); // not silently downgraded to hold
  });
});

// ---------------------------------------------------------------------------
// betrayal & precedence
// ---------------------------------------------------------------------------

describe('bindOrders -- betrayal precedence', () => {
  test('a betrayal referencing the deal partner omits the support', async () => {
    // Austria VIE could support russian GAL holding; the deal partner is russia.
    const board = emptyBoard();
    setUnits(board, {
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });
    const intentByPower = {
      austria: {
        ...emptyIntent(),
        supportDeals: [{ from: 'GAL', to: 'GAL' }], // support-hold of russian GAL
        betrayals: [{ type: 'support', partner: 'russia' }],
      },
    };
    const getOrders = makeStub({ scripts: { austria: holds(board, 'austria') } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const support = ordersByPower.austria.find((o) => o.type && o.type.startsWith('support'));
    expect(support).toBeUndefined();
  });

  test('a deal in both supportDeals and betrayals -> betrayal wins (support absent)', async () => {
    const board = emptyBoard();
    setUnits(board, {
      VIE: { power: 'austria', type: 'army' },
      BOH: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });
    const intentByPower = {
      austria: {
        ...emptyIntent(),
        // VIE supporting russian GAL hold AND betraying russia.
        supportDeals: [{ from: 'GAL', to: 'GAL' }],
        betrayals: [{ type: 'support', partner: 'russia' }],
      },
    };
    const getOrders = makeStub({ scripts: { austria: holds(board, 'austria') } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    expect(ordersByPower.austria.some((o) => o.type && o.type.startsWith('support'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ally / DMZ non-reintroduction
// ---------------------------------------------------------------------------

describe('bindOrders -- ally / DMZ respect', () => {
  test('injecting a committed support never reintroduces an ally attack', async () => {
    // France supports italian PIE hold; the engine fragment already avoids
    // attacking the ally. The injected support is a non-moving order, so the
    // result still attacks no ally unit.
    const board = emptyBoard();
    setUnits(board, {
      MAR: { power: 'france', type: 'army' },
      PIE: { power: 'italy', type: 'army' },
    });
    const intentByPower = {
      france: {
        ...emptyIntent(),
        allies: ['italy'],
        supportDeals: [{ from: 'PIE', to: 'PIE' }], // support-hold ally PIE
      },
    };
    const getOrders = makeStub({ scripts: { france: holds(board, 'france') } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    // No order attacks the ally's province PIE.
    expect(ordersByPower.france.some((o) => o.type === 'move' && o.to === 'PIE')).toBe(false);
    // The committed support was injected.
    expect(
      ordersByPower.france.some((o) => o.type === 'support-hold' && o.target === 'PIE'),
    ).toBe(true);
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });

  test('the engine fragment is passed through unchanged when no committed supports apply (DMZ respected upstream)', async () => {
    const board = emptyBoard();
    setUnits(board, { PAR: { power: 'france', type: 'army' } });
    // Engine (stub) returns a hold (respecting a DMZ on BUR); binding adds nothing.
    const intentByPower = { france: { ...emptyIntent(), dmz: ['BUR'] } };
    const getOrders = makeStub({ scripts: { france: [{ type: 'hold', unitLoc: 'PAR' }] } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    expect(ordersByPower.france.some((o) => o.type === 'move' && o.to === 'BUR')).toBe(false);
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cross-power coordination
// ---------------------------------------------------------------------------

describe('bindOrders -- cross-power coordination', () => {
  test('A supports B move into X and B moves: support + move co-occur and the move succeeds', async () => {
    // Austria GAL -> WAR (russian) supported by Austria SIL; russia holds WAR.
    // Here both supporter and mover are the SAME power (austria) but the deal
    // mechanism is identical: the mover at GAL is named by the deal `from`, the
    // dest WAR by `to`, and SIL injects the support-move.
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    board.supplyCenters = { WAR: 'russia' };
    setUnits(board, {
      GAL: { power: 'austria', type: 'army' },
      SIL: { power: 'austria', type: 'army' },
      WAR: { power: 'russia', type: 'army' },
    });
    const intentByPower = {
      austria: {
        ...emptyIntent(),
        targets: ['russia'],
        supportDeals: [{ from: 'GAL', to: 'WAR' }],
      },
      russia: emptyIntent(),
    };
    // Austria's mover plan: GAL -> WAR (the move the deal supports), SIL holds
    // (will be overwritten by the injected support). Russia holds WAR.
    const getOrders = makeStub({
      scripts: {
        austria: [
          { type: 'move', unitLoc: 'GAL', to: 'WAR' },
          { type: 'hold', unitLoc: 'SIL' },
        ],
        russia: [{ type: 'hold', unitLoc: 'WAR' }],
      },
    });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    // SIL issues the support-move; GAL issues the move.
    expect(
      ordersByPower.austria.some(
        (o) => o.type === 'support-move' && o.from === 'GAL' && o.to === 'WAR',
      ),
    ).toBe(true);
    expect(
      ordersByPower.austria.some((o) => o.type === 'move' && o.unitLoc === 'GAL' && o.to === 'WAR'),
    ).toBe(true);

    const clone = board.clone();
    expect(clone.applyMove({ type: 'orders', ordersByPower })).toBe(true);
    expect(clone.orderHistory[0].resolved.moveSuccess['GAL']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reconcileHonored
// ---------------------------------------------------------------------------

describe('reconcileHonored', () => {
  test('an issued, uncut committed support is honored; a betrayed deal is broken', async () => {
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    board.supplyCenters = { WAR: 'russia' };
    setUnits(board, {
      GAL: { power: 'austria', type: 'army' },
      SIL: { power: 'austria', type: 'army' },
      WAR: { power: 'russia', type: 'army' },
    });
    const intentByPower = {
      austria: {
        ...emptyIntent(),
        targets: ['russia'],
        supportDeals: [{ from: 'GAL', to: 'WAR' }],
      },
    };
    const getOrders = makeStub({
      scripts: {
        austria: [
          { type: 'move', unitLoc: 'GAL', to: 'WAR' },
          { type: 'hold', unitLoc: 'SIL' },
        ],
      },
    });
    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const resolved = board.clone();
    // Russia holds WAR so the support survives.
    ordersByPower.russia = [{ type: 'hold', unitLoc: 'WAR' }];
    resolved.applyMove({ type: 'orders', ordersByPower });

    const report = reconcileHonored(resolved, intentByPower);
    expect(report.austria.honored).toContainEqual({ from: 'GAL', to: 'WAR' });
    expect(report.austria.broken).toHaveLength(0);
  });

  test('a betrayed committed deal is reported broken', async () => {
    const board = emptyBoard();
    setUnits(board, {
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
    });
    const intentByPower = {
      austria: {
        ...emptyIntent(),
        supportDeals: [{ from: 'GAL', to: 'GAL' }],
        betrayals: [{ type: 'support', partner: 'russia' }],
      },
    };
    const getOrders = makeStub({ scripts: { austria: holds(board, 'austria') } });
    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const resolved = board.clone();
    ordersByPower.russia = [{ type: 'hold', unitLoc: 'GAL' }];
    resolved.applyMove({ type: 'orders', ordersByPower });

    const report = reconcileHonored(resolved, intentByPower);
    expect(report.austria.broken).toContainEqual({ from: 'GAL', to: 'GAL' });
    expect(report.austria.honored).toHaveLength(0);
  });

  test('a committed support that was issued but CUT is reported broken', async () => {
    // Austria SIL supports GAL -> WAR, but russia's PRU -> SIL cuts the support.
    const board = emptyBoard({ phase: 'fall-orders', season: 'fall' });
    board.supplyCenters = { WAR: 'russia' };
    setUnits(board, {
      GAL: { power: 'austria', type: 'army' },
      SIL: { power: 'austria', type: 'army' },
      WAR: { power: 'russia', type: 'army' },
      PRU: { power: 'russia', type: 'army' }, // PRU borders SIL -> cuts the support
    });
    const intentByPower = {
      austria: { ...emptyIntent(), targets: ['russia'], supportDeals: [{ from: 'GAL', to: 'WAR' }] },
    };
    const getOrders = makeStub({
      scripts: {
        austria: [
          { type: 'move', unitLoc: 'GAL', to: 'WAR' },
          { type: 'hold', unitLoc: 'SIL' },
        ],
      },
    });
    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const resolved = board.clone();
    ordersByPower.russia = [
      { type: 'hold', unitLoc: 'WAR' },
      { type: 'move', unitLoc: 'PRU', to: 'SIL' }, // cuts SIL's support
    ];
    resolved.applyMove({ type: 'orders', ordersByPower });

    // Confirm the support was issued and then cut.
    const supportLoc = Object.entries(resolved.orderHistory[0].orders).find(
      ([, o]) => o.type === 'support-move' && o.from === 'GAL' && o.to === 'WAR',
    )[0];
    expect(resolved.orderHistory[0].resolved.cutSupports).toContain(supportLoc);

    const report = reconcileHonored(resolved, intentByPower);
    expect(report.austria.broken).toContainEqual({ from: 'GAL', to: 'WAR' });
    expect(report.austria.honored).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// retreat / build binding
// ---------------------------------------------------------------------------

describe('bindRetreats', () => {
  test('routes a dislodged unit to a legal option and applyMove accepts it', async () => {
    const board = emptyBoard({ phase: 'spring-retreats', season: 'spring' });
    board.units = { TRI: { power: 'austria', type: 'army' } };
    board.pendingRetreats = [
      { unitLoc: 'BUD', unit: { power: 'russia', type: 'army' }, attackerFrom: 'VIE', options: ['GAL', 'RUM'] },
    ];
    const intentByPower = { russia: emptyIntent() };
    const getOrders = makeStub();

    const retreatsByPower = await bindRetreats(board, intentByPower, getOrders);
    const r = retreatsByPower.russia[0];
    expect(r.to === null || ['GAL', 'RUM'].includes(r.to)).toBe(true);
    const clone = board.clone();
    expect(clone.applyMove({ type: 'retreats', retreatsByPower })).toBe(true);
  });

  test('avoids a DMZ option when another legal option exists', async () => {
    const board = emptyBoard({ phase: 'spring-retreats', season: 'spring' });
    board.units = {};
    board.pendingRetreats = [
      { unitLoc: 'BUD', unit: { power: 'russia', type: 'army' }, attackerFrom: 'VIE', options: ['GAL', 'RUM'] },
    ];
    const intentByPower = { russia: { ...emptyIntent(), dmz: ['GAL'] } };
    const getOrders = makeStub();

    const retreatsByPower = await bindRetreats(board, intentByPower, getOrders);
    expect(retreatsByPower.russia[0].to).toBe('RUM');
    expect(board.clone().applyMove({ type: 'retreats', retreatsByPower })).toBe(true);
  });
});

describe('bindAdjustments', () => {
  test('builds within buildCount to legal open homes; applyMove accepts it', async () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { BUD: 'austria', TRI: 'austria', VIE: 'austria' };
    board.units = {};
    const intentByPower = { austria: emptyIntent() };
    const getOrders = makeStub();

    const adjustmentsByPower = await bindAdjustments(board, intentByPower, getOrders);
    const info = board.getAdjustments().austria;
    expect(adjustmentsByPower.austria.length).toBeLessThanOrEqual(info.buildCount);
    expect(adjustmentsByPower.austria.every((o) => o.type === 'build')).toBe(true);
    expect(board.clone().applyMove({ type: 'adjustments', adjustmentsByPower })).toBe(true);
  });

  test('disbands within disbandCount; applyMove accepts it', async () => {
    const board = emptyBoard({ phase: 'winter-build' });
    board.supplyCenters = { BUD: 'austria', TRI: null, VIE: null };
    setUnits(board, {
      BUD: { power: 'austria', type: 'army' },
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'austria', type: 'army' },
    });
    const intentByPower = { austria: emptyIntent() };
    const getOrders = makeStub();

    const adjustmentsByPower = await bindAdjustments(board, intentByPower, getOrders);
    const info = board.getAdjustments().austria;
    expect(adjustmentsByPower.austria.length).toBe(info.disbandCount);
    expect(adjustmentsByPower.austria.every((o) => o.type === 'disband')).toBe(true);
    expect(board.clone().applyMove({ type: 'adjustments', adjustmentsByPower })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// negative / boundary
// ---------------------------------------------------------------------------

describe('bindOrders -- negative / boundary', () => {
  test('an illegal promised support is omitted yet applyMove still true', async () => {
    // France PAR is asked to support a move into a province no french unit can
    // reach the support for (no unit adjacent to the dest). The support is illegal
    // and must be dropped.
    const board = emptyBoard();
    setUnits(board, { PAR: { power: 'france', type: 'army' } });
    const intentByPower = {
      france: { ...emptyIntent(), supportDeals: [{ from: 'MOS', to: 'SEV' }] }, // unreachable
    };
    const getOrders = makeStub({ scripts: { france: [{ type: 'hold', unitLoc: 'PAR' }] } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    expect(ordersByPower.france.some((o) => o.type && o.type.startsWith('support'))).toBe(false);
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });

  test('empty intentByPower never stalls and produces an accepted (empty) result', async () => {
    const board = emptyBoard();
    setUnits(board, { PAR: { power: 'france', type: 'army' } });
    const getOrders = makeStub();

    const ordersByPower = await bindOrders(board, {}, getOrders);
    expect(ordersByPower).toEqual({});
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });

  test('empty per-power intent falls back to no-intent getOrders, still accepted', async () => {
    const board = emptyBoard();
    setUnits(board, { PAR: { power: 'france', type: 'army' } });
    let sawIntentOption = false;
    const getOrders = async (b, power, options = {}) => {
      if ('intent' in options) sawIntentOption = true;
      return { orders: [{ type: 'hold', unitLoc: 'PAR' }] };
    };

    const ordersByPower = await bindOrders(board, { france: emptyIntent() }, getOrders);
    expect(sawIntentOption).toBe(false); // empty intent -> no-intent call
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });

  test('a throwing getOrders for one power falls back without affecting others', async () => {
    const board = emptyBoard();
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      MUN: { power: 'germany', type: 'army' },
    });
    const intentByPower = {
      france: { ...emptyIntent(), targets: ['germany'] }, // intent -> stub throws for france
      germany: { ...emptyIntent(), targets: ['france'] },
    };
    // Throws only on the FIRST (intent) call for france; the no-intent fallback
    // succeeds via the baseline plan.
    const getOrders = async (b, power, options = {}) => {
      if (power === 'france' && 'intent' in options) throw new Error('boom');
      const plans = b.generateCandidatePlans(power);
      return { orders: (plans[0] && plans[0].orders) || [] };
    };

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    expect(Array.isArray(ordersByPower.france)).toBe(true);
    expect(Array.isArray(ordersByPower.germany)).toBe(true);
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });

  test('a getOrders that throws on every call falls back to holds', async () => {
    const board = emptyBoard();
    setUnits(board, { PAR: { power: 'france', type: 'army' } });
    const getOrders = makeStub({ scripts: {}, throwFor: 'france' });
    const intentByPower = { france: { ...emptyIntent(), targets: ['germany'] } };

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    expect(ordersByPower.france).toEqual([{ type: 'hold', unitLoc: 'PAR' }]);
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });

  test('conflicting deals (two committed supports for one unit) resolve deterministically', async () => {
    // France has a single non-mover unit (PAR) that could support EITHER of two
    // moves into provinces adjacent to PAR. Two committed deals both resolve to
    // PAR as the supporter -> keep the first by stable order, drop the rest.
    const board = emptyBoard();
    setUnits(board, {
      PAR: { power: 'france', type: 'army' },
      BRE: { power: 'france', type: 'army' }, // BRE can move into PIC
      MAR: { power: 'france', type: 'army' }, // MAR can move into BUR
    });
    // PAR borders both PIC and BUR, so it can support either move.
    const intentByPower = {
      france: {
        ...emptyIntent(),
        supportDeals: [
          { from: 'BRE', to: 'PIC' },
          { from: 'MAR', to: 'BUR' },
        ],
      },
    };
    const getOrders = makeStub({ scripts: { france: holds(board, 'france') } });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    const parSupports = ordersByPower.france.filter(
      (o) => o.unitLoc === 'PAR' && o.type && o.type.startsWith('support'),
    );
    // PAR can only issue one support; the deterministic choice is the first deal.
    expect(parSupports.length).toBeLessThanOrEqual(1);
    expect(board.clone().applyMove({ type: 'orders', ordersByPower })).toBe(true);
    // Determinism: a second identical bind yields the same result.
    const again = await bindOrders(board, intentByPower, getOrders);
    expect(again).toEqual(ordersByPower);
  });

  test('simultaneous mutual betrayal: neither support is issued and both are broken', async () => {
    // Austria and Russia each had a support deal with the other and each betrays.
    const board = emptyBoard();
    setUnits(board, {
      VIE: { power: 'austria', type: 'army' },
      GAL: { power: 'russia', type: 'army' },
      BOH: { power: 'austria', type: 'army' },
      SIL: { power: 'russia', type: 'army' },
    });
    const intentByPower = {
      austria: {
        ...emptyIntent(),
        supportDeals: [{ from: 'GAL', to: 'GAL' }], // austria would support russian GAL
        betrayals: [{ type: 'support', partner: 'russia' }],
      },
      russia: {
        ...emptyIntent(),
        supportDeals: [{ from: 'VIE', to: 'VIE' }], // russia would support austrian VIE
        betrayals: [{ type: 'support', partner: 'austria' }],
      },
    };
    const getOrders = makeStub({
      scripts: { austria: holds(board, 'austria'), russia: holds(board, 'russia') },
    });

    const ordersByPower = await bindOrders(board, intentByPower, getOrders);
    expect(ordersByPower.austria.some((o) => o.type && o.type.startsWith('support'))).toBe(false);
    expect(ordersByPower.russia.some((o) => o.type && o.type.startsWith('support'))).toBe(false);

    const resolved = board.clone();
    resolved.applyMove({ type: 'orders', ordersByPower });
    const report = reconcileHonored(resolved, intentByPower);
    expect(report.austria.broken).toContainEqual({ from: 'GAL', to: 'GAL' });
    expect(report.russia.broken).toContainEqual({ from: 'VIE', to: 'VIE' });
  });
});

// Local helper mirroring the module's notion of an empty intent (kept here so
// tests don't import non-exported internals).
function emptyIntent() {
  return { allies: [], targets: [], supportDeals: [], dmz: [], betrayals: [] };
}
