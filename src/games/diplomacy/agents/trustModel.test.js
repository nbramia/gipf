import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState, recordPromise, recordAgreement, getTrust, getLedger } from './diplomaticState.js';
import { TRUST_DELTAS, updateTrustAfterAdjudication } from './trustModel.js';

// A minimal stand-in for the board: trust diffing only reads orderHistory and
// baseProvince (a pure import), so a plain object with orderHistory + getPowerIds
// is all updateTrustAfterAdjudication needs. We seed real state off a real board.
function stateWith(extra = {}) {
  const board = new DiplomacyBoard();
  return { board, state: createDiplomaticState({ board, humanPower: 'england' }), ...extra };
}

function historyBoard(entry) {
  return { orderHistory: [entry] };
}

describe('updateTrustAfterAdjudication — support promises', () => {
  test('kept support: matching order raises trust and records kept===1', () => {
    let { state } = stateWith();
    state = recordPromise(state, {
      id: 'p1',
      type: 'support',
      from: 'france',
      to: 'germany',
      actingPower: 'france',
      expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
    });

    const board = historyBoard({
      phase: 'Fall 1902',
      orders: { bur: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' } },
      resolved: { moveSuccess: {}, cutSupports: [], dislodged: [], strengths: {} },
    });

    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['france'] });
    expect(getTrust(next, 'germany', 'france')).toBeCloseTo(TRUST_DELTAS.supportKept, 5);
    expect(getLedger(next, 'france', 'germany')).toEqual({ kept: 1, broken: 0 });
    // Verified promise cleared.
    expect(next.promises).toHaveLength(0);
  });

  test('broken support: actual order differs lowers trust and records broken===1', () => {
    let { state } = stateWith();
    state = recordPromise(state, {
      id: 'p1',
      type: 'support',
      from: 'france',
      to: 'germany',
      actingPower: 'france',
      expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
    });

    // France instead moved bur->mar (selfish), breaking the promise.
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: { bur: { type: 'move', unitLoc: 'bur', to: 'mar' } },
      resolved: { moveSuccess: { bur: true }, cutSupports: [], dislodged: [], strengths: {} },
    });

    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['france'] });
    expect(getTrust(next, 'germany', 'france')).toBeCloseTo(TRUST_DELTAS.supportBroken, 5);
    expect(getLedger(next, 'france', 'germany')).toEqual({ kept: 0, broken: 1 });
  });

  test('coast suffix on actual order still counts as kept', () => {
    let { state } = stateWith();
    state = recordPromise(state, {
      id: 'p1', type: 'support', from: 'russia', to: 'turkey', actingPower: 'russia',
      expectedOrder: { type: 'support-move', unitLoc: 'rum', from: 'bul', to: 'con' },
    });
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: { rum: { type: 'support-move', unitLoc: 'rum', from: 'BUL/ec', to: 'con' } },
      resolved: { moveSuccess: {}, cutSupports: [], dislodged: [], strengths: {} },
    });
    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['russia'] });
    expect(getLedger(next, 'russia', 'turkey')).toEqual({ kept: 1, broken: 0 });
  });
});

describe('updateTrustAfterAdjudication — non-aggression / DMZ violations', () => {
  test('a france-unit move into a germany-occupied province lowers trust', () => {
    let { state } = stateWith();
    state = recordAgreement(state, {
      id: 'a1',
      type: 'non-aggression',
      parties: ['france', 'germany'],
      // The orchestrator records where each power sat / what it ordered this turn.
      actorOrderLocs: { france: ['bur'], germany: ['mun', 'ruh'] },
    });

    // France's bur moved into mun (a province Germany occupied).
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: {
        bur: { type: 'move', unitLoc: 'bur', to: 'mun' },
        mun: { type: 'hold', unitLoc: 'mun' },
        ruh: { type: 'hold', unitLoc: 'ruh' },
      },
      resolved: { moveSuccess: { bur: false }, cutSupports: [], dislodged: [], strengths: {} },
    });

    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['france', 'germany'] });
    expect(getTrust(next, 'germany', 'france')).toBeCloseTo(TRUST_DELTAS.nonAggressionBroken, 5);
    // Germany did not aggress, so France's trust toward Germany is unchanged.
    expect(getTrust(next, 'france', 'germany')).toBe(0);
  });

  test('DMZ violation: moving into a DMZ province lowers trust', () => {
    let { state } = stateWith();
    state = recordAgreement(state, {
      id: 'a2',
      type: 'dmz',
      parties: ['france', 'italy'],
      provinces: ['pie', 'tyr'],
      actorOrderLocs: { france: ['mar'], italy: ['ven'] },
    });
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: {
        mar: { type: 'move', unitLoc: 'mar', to: 'pie' }, // into the DMZ
        ven: { type: 'hold', unitLoc: 'ven' },
      },
      resolved: { moveSuccess: { mar: true }, cutSupports: [], dislodged: [], strengths: {} },
    });
    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['france', 'italy'] });
    expect(getTrust(next, 'italy', 'france')).toBeCloseTo(TRUST_DELTAS.nonAggressionBroken, 5);
  });

  test('acting-power resolution: two powers moving to the same province — no misattribution', () => {
    let { state } = stateWith();
    // Non-aggression between france and germany. Italy ALSO moves into mun, but
    // Italy is not a party, so France must NOT be blamed for Italy's move.
    state = recordAgreement(state, {
      id: 'a1',
      type: 'non-aggression',
      parties: ['france', 'germany'],
      actorOrderLocs: { france: ['bur'], germany: ['mun'] },
    });
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: {
        bur: { type: 'hold', unitLoc: 'bur' },     // France stayed put — honored
        tyr: { type: 'move', unitLoc: 'tyr', to: 'mun' }, // Italy attacked mun
        mun: { type: 'hold', unitLoc: 'mun' },
      },
      resolved: { moveSuccess: { tyr: false }, cutSupports: [], dislodged: [], strengths: {} },
    });
    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['france', 'germany'] });
    // France honored; trust toward France unchanged.
    expect(getTrust(next, 'germany', 'france')).toBe(0);
    expect(getLedger(next, 'france', 'germany')).toEqual({ kept: 0, broken: 0 });
  });
});

describe('updateTrustAfterAdjudication — invariants', () => {
  test('trust is clamped to [-1, 1] over repeated breaks', () => {
    let { state } = stateWith();
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: { bur: { type: 'move', unitLoc: 'bur', to: 'mar' } },
      resolved: { moveSuccess: {}, cutSupports: [], dislodged: [], strengths: {} },
    });
    for (let i = 0; i < 5; i++) {
      state = recordPromise(state, {
        id: `p${i}`, type: 'support', from: 'france', to: 'germany', actingPower: 'france',
        expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
      });
      state = updateTrustAfterAdjudication(state, board, { actingPowers: ['france'] });
    }
    expect(getTrust(state, 'germany', 'france')).toBe(-1);
  });

  test('is pure — the input state is deep-equal before and after', () => {
    let { state } = stateWith();
    state = recordPromise(state, {
      id: 'p1', type: 'support', from: 'france', to: 'germany', actingPower: 'france',
      expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
    });
    const before = JSON.parse(JSON.stringify(state));
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: { bur: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' } },
      resolved: { moveSuccess: {}, cutSupports: [], dislodged: [], strengths: {} },
    });
    updateTrustAfterAdjudication(state, board, { actingPowers: ['france'] });
    expect(state).toEqual(before);
  });

  test('negative: an unrelated order causes zero trust change', () => {
    let { state } = stateWith();
    state = recordPromise(state, {
      id: 'p1', type: 'support', from: 'france', to: 'germany', actingPower: 'france',
      expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
    });
    // Only turkey moved; france issued no order at all this turn.
    const board = historyBoard({
      phase: 'Fall 1902',
      orders: { ank: { type: 'move', unitLoc: 'ank', to: 'con' } },
      resolved: { moveSuccess: { ank: true }, cutSupports: [], dislodged: [], strengths: {} },
    });
    // France's promise is verified (it acted by NOT issuing the support) and so
    // counts as broken — but a power NOT in actingPowers is skipped entirely.
    const next = updateTrustAfterAdjudication(state, board, { actingPowers: ['turkey'] });
    expect(getTrust(next, 'germany', 'france')).toBe(0);
    expect(getLedger(next, 'france', 'germany')).toEqual({ kept: 0, broken: 0 });
    // Promise untouched because france didn't resolve this turn.
    expect(next.promises).toHaveLength(1);
  });

  test('no orders entry (retreat/adjustment turn) is a no-op', () => {
    const { state } = stateWith();
    const board = { orderHistory: [{ phase: 'Winter 1902', adjustments: {} }] };
    expect(updateTrustAfterAdjudication(state, board, { actingPowers: ['france'] })).toBe(state);
  });
});
