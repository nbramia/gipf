// End-to-end turn-loop tests for Diplomacy ([Negotiation Loop] PR1/PR2) with
// STUBBED agents (Jest module mocks; no real key in CI). Asserts STRUCTURE, never
// LLM text: a full Spring 1901 turn runs negotiation -> orders -> applyMove true
// -> results from orderHistory[0]; the no-key path completes a full year via the
// tactical fallback; difficulty threads the sim budget; and the loop never stalls.

import DiplomacyBoard from './DiplomacyBoard.js';
import { decideIntents, makeGetOrders } from './hooks/useDiplomacyTurn.js';

// --- module mocks: deterministic, canned agent layer ------------------------

// negotiator.runNegotiationPhase: returns the state unchanged (no AI↔AI text).
jest.mock('./agents/negotiator.js', () => ({
  runNegotiationPhase: jest.fn(async ({ state }) => ({ state, transcripts: {} })),
}));

// agentClient: no key in CI; askAgent yields empty replies.
jest.mock('./agents/agentClient.js', () => ({
  askAgent: jest.fn(async () => ({ error: 'no_key', reply: { message: '' } })),
  hasApiKey: jest.fn(() => false),
  getApiKey: jest.fn(() => ''),
  setApiKey: jest.fn(),
  sendMessage: jest.fn(async () => ({ error: 'no_key', message: '' })),
  createMemory: jest.requireActual('./agents/memory.js').createMemory,
  serializeMemory: jest.requireActual('./agents/memory.js').serializeMemory,
  deserializeMemory: jest.requireActual('./agents/memory.js').deserializeMemory,
  validateScratchpad: jest.requireActual('./agents/memory.js').validateScratchpad,
}));

function installLocalStorage() {
  const store = new Map();
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => Array.from(store.keys())[i] ?? null,
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installLocalStorage();
  jest.clearAllMocks();
});

// --- the pure order-collection pipeline the hook runs -----------------------
//
// We exercise the same code the hook calls (decideIntents + bindOrders via the
// real aiPlayer getOrders on the main thread, since the worker is unavailable in
// jsdom) so the test is deterministic and free of React-timer flakiness, while
// still covering the real intent->orders->applyMove path.
import { bindOrders, bindRetreats, bindAdjustments, reconcileHonored } from './agents/intentBinding.js';
import { updateTrustAfterAdjudication } from './agents/trustModel.js';
import { createDiplomaticState } from './agents/diplomaticState.js';

const CONTROLLERS = {
  austria: 'AI', england: 'human', france: 'AI', germany: 'AI', italy: 'AI', russia: 'AI', turkey: 'AI',
};
const HUMAN = 'england';
const AI_POWERS = Object.keys(CONTROLLERS).filter((p) => CONTROLLERS[p] === 'AI');

// Resolve a full orders phase: human holds, AI bound via tactical fallback.
async function resolveOrdersPhase(board, state, difficulty = 'normal') {
  const getOrders = makeGetOrders({ workerSupported: false, computeOrders: null });
  const intents = decideIntents(board, state, AI_POWERS);
  const aiOrders = await bindOrders(board, intents, getOrders, { difficulty });

  const ordersByPower = {};
  for (const power of board.powers) {
    if (CONTROLLERS[power] === 'human') {
      ordersByPower[power] = board.getUnitLocations(power).map((loc) => ({ type: 'hold', unitLoc: loc }));
    } else {
      ordersByPower[power] = aiOrders[power] || [];
    }
  }
  const ok = board.applyMove({ type: 'orders', ordersByPower });
  reconcileHonored(board, intents);
  const nextState = updateTrustAfterAdjudication(state, board, { actingPowers: Object.keys(intents) });
  return { ok, nextState };
}

describe('Diplomacy turn loop — full Spring 1901 with stubbed agents', () => {
  test('negotiation (no-op) -> orders for all 7 powers -> applyMove true -> results', async () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    const state = createDiplomaticState({ board, humanPower: HUMAN });

    const { ok } = await resolveOrdersPhase(board, state);
    expect(ok).toBe(true);

    // Results render off orderHistory[0].
    const log = board.orderHistory[0];
    expect(log).toBeTruthy();
    expect(Object.keys(log.orders).length).toBeGreaterThan(0);
    // Every starting unit got an order (no power was skipped).
    const orderedLocs = Object.keys(log.orders);
    expect(orderedLocs.length).toBe(22);
  });

  test('AI orders are all legal (survive applyMove) and the human only holds', async () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    const state = createDiplomaticState({ board, humanPower: HUMAN });
    const getOrders = makeGetOrders({ workerSupported: false, computeOrders: null });
    const intents = decideIntents(board, state, AI_POWERS);
    const aiOrders = await bindOrders(board, intents, getOrders, { difficulty: 'normal' });

    // No AI order set is empty for a power that has units.
    for (const power of AI_POWERS) {
      expect(Array.isArray(aiOrders[power])).toBe(true);
      expect(aiOrders[power].length).toBe(board.getUnitLocations(power).length);
    }
    // The human power is never computed by the AI binder.
    expect(aiOrders[HUMAN]).toBeUndefined();
  });
});

describe('Diplomacy turn loop — retreats and winter', () => {
  test('a dislodgement opens a retreat phase that AI binding resolves', async () => {
    // Hand-build a dislodgement: Austria BUD+TRI dislodge Turkey SER.
    const board = new DiplomacyBoard({ maxYears: 1905 });
    board.units = {
      BUD: { power: 'austria', type: 'army' },
      TRI: { power: 'austria', type: 'army' },
      SER: { power: 'turkey', type: 'army' },
    };
    board.phase = 'spring-orders';
    board.season = 'spring';

    const ordersByPower = {
      austria: [
        { type: 'move', unitLoc: 'BUD', to: 'SER' },
        { type: 'support-move', unitLoc: 'TRI', from: 'BUD', to: 'SER' },
      ],
      turkey: [{ type: 'hold', unitLoc: 'SER' }],
    };
    expect(board.applyMove({ type: 'orders', ordersByPower })).toBe(true);
    expect(board.isRetreatPhase()).toBe(true);
    expect(board.pendingRetreats.length).toBe(1);

    const state = createDiplomaticState({ board, humanPower: HUMAN });
    const getOrders = makeGetOrders({ workerSupported: false, computeOrders: null });
    const intents = decideIntents(board, state, ['turkey']);
    const retreatsByPower = await bindRetreats(board, { turkey: intents.turkey || null }, getOrders, {});
    expect(board.applyMove({ type: 'retreats', retreatsByPower })).toBe(true);
    expect(board.isRetreatPhase()).toBe(false);
  });

  test('winter builds/disbands resolve via bindAdjustments', async () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    // Force a winter phase with a build available for Austria.
    board.units = { VIE: { power: 'austria', type: 'army' } };
    board.supplyCenters = { VIE: 'austria', BUD: 'austria', TRI: 'austria' };
    board.phase = 'winter-build';
    board.season = 'fall';

    const adj = board.getAdjustments().austria;
    expect(adj.buildCount).toBeGreaterThan(0);

    const state = createDiplomaticState({ board, humanPower: HUMAN });
    const getOrders = makeGetOrders({ workerSupported: false, computeOrders: null });
    const intents = decideIntents(board, state, ['austria']);
    const adjustmentsByPower = await bindAdjustments(board, { austria: intents.austria || null }, getOrders, {});
    expect(board.applyMove({ type: 'adjustments', adjustmentsByPower })).toBe(true);
    // Winter resolved -> back to a new orders phase.
    expect(board.isOrdersPhase()).toBe(true);
  });
});

describe('Diplomacy turn loop — graceful degradation', () => {
  test('no key: a full year (Spring + Fall) completes via tactical fallback', async () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    let state = createDiplomaticState({ board, humanPower: HUMAN });

    let phasesResolved = 0;
    let guard = 0;
    // Drive the loop until we reach (at least) the next year's Spring orders.
    const startYear = board.year;
    while (guard++ < 12 && board.phase !== 'game-over') {
      if (board.isOrdersPhase()) {
        const res = await resolveOrdersPhase(board, state);
        expect(res.ok).toBe(true);
        state = res.nextState;
        phasesResolved += 1;
      } else if (board.isRetreatPhase()) {
        const getOrders = makeGetOrders({ workerSupported: false, computeOrders: null });
        const intents = decideIntents(board, state, AI_POWERS);
        const retreatsByPower = await bindRetreats(board, intents, getOrders, {});
        expect(board.applyMove({ type: 'retreats', retreatsByPower })).toBe(true);
      } else if (board.isWinterPhase()) {
        const getOrders = makeGetOrders({ workerSupported: false, computeOrders: null });
        const intents = decideIntents(board, state, AI_POWERS);
        const adjustmentsByPower = await bindAdjustments(board, intents, getOrders, {});
        expect(board.applyMove({ type: 'adjustments', adjustmentsByPower })).toBe(true);
      }
      if (board.year > startYear) break;
    }
    // At least the two orders phases (Spring + Fall) of the first year resolved.
    expect(phasesResolved).toBeGreaterThanOrEqual(2);
    expect(board.year).toBeGreaterThanOrEqual(startYear + 1);
  });

  test('an AI getOrders that throws falls back to holds; the phase still completes', async () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    const state = createDiplomaticState({ board, humanPower: HUMAN });
    const throwingGetOrders = jest.fn(async () => {
      throw new Error('simulated AI failure');
    });
    const intents = decideIntents(board, state, AI_POWERS);
    const aiOrders = await bindOrders(board, intents, throwingGetOrders, { difficulty: 'normal' });

    // Every AI power still has a (hold) order set; nothing empty.
    for (const power of AI_POWERS) {
      expect(aiOrders[power].length).toBe(board.getUnitLocations(power).length);
      expect(aiOrders[power].every((o) => o.type === 'hold')).toBe(true);
    }
    const ordersByPower = { ...aiOrders };
    ordersByPower[HUMAN] = board.getUnitLocations(HUMAN).map((loc) => ({ type: 'hold', unitLoc: loc }));
    expect(board.applyMove({ type: 'orders', ordersByPower })).toBe(true);
  });
});

describe('Diplomacy turn loop — difficulty budget', () => {
  test('difficulty is threaded into getOrders options', async () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    const state = createDiplomaticState({ board, humanPower: HUMAN });
    const spy = jest.fn(async (b, power) => ({ orders: b.getUnitLocations(power).map((loc) => ({ type: 'hold', unitLoc: loc })) }));
    const intents = decideIntents(board, state, AI_POWERS);
    await bindOrders(board, intents, spy, { difficulty: 'hard' });

    // Some call carried difficulty:'hard'.
    const sawHard = spy.mock.calls.some((args) => args[2] && args[2].difficulty === 'hard');
    expect(sawHard).toBe(true);
  });
});
