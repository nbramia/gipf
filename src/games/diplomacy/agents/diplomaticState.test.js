import DiplomacyBoard, { POWERS } from '../DiplomacyBoard.js';
import {
  createDiplomaticState,
  recordPromise,
  recordAgreement,
  dropAgreement,
  relationKey,
  getTrust,
  getLedger,
  getAgreementsFor,
  getPromisesBy,
  agreementInvolves,
  agreementPartner,
  STATE_VERSION,
} from './diplomaticState.js';

describe('createDiplomaticState', () => {
  test('seeds a relation entry for every ordered pair of alive powers at trust 0', () => {
    const board = new DiplomacyBoard();
    const state = createDiplomaticState({ board, humanPower: 'england' });

    const alive = board.getPowerIds();
    const expectedPairs = alive.length * (alive.length - 1);
    expect(Object.keys(state.relations)).toHaveLength(expectedPairs);

    for (const from of alive) {
      for (const to of alive) {
        if (from === to) continue;
        const rel = state.relations[relationKey(from, to)];
        expect(rel).toEqual({ trust: 0, lastUpdatedPhase: null });
      }
    }
    // No self-relation.
    expect(state.relations['france>france']).toBeUndefined();
  });

  test('starts with empty agreements, promises, and ledger; version stamped', () => {
    const board = new DiplomacyBoard();
    const state = createDiplomaticState({ board, humanPower: 'france' });
    expect(state).toMatchObject({
      version: STATE_VERSION,
      humanPower: 'france',
      agreements: [],
      promises: [],
      promiseLedger: {},
    });
  });

  test('humanPower must be a valid POWERS member', () => {
    const board = new DiplomacyBoard();
    expect(() => createDiplomaticState({ board, humanPower: 'atlantis' })).toThrow();
    // null is allowed (all-AI game).
    const state = createDiplomaticState({ board, humanPower: null });
    expect(state.humanPower).toBeNull();
    expect(POWERS).toContain('france');
  });

  test('throws without a board', () => {
    expect(() => createDiplomaticState({ humanPower: 'france' })).toThrow();
  });
});

describe('recordPromise', () => {
  const board = new DiplomacyBoard();
  const base = createDiplomaticState({ board, humanPower: 'england' });

  test('appends a promise with the acting power defaulted to `from`', () => {
    const next = recordPromise(base, {
      id: 'p1',
      type: 'support',
      from: 'france',
      to: 'germany',
      expectedOrder: { type: 'support-move', unitLoc: 'bur', from: 'mun', to: 'ruh' },
      madePhase: 'Spring 1902',
    });
    expect(next.promises).toHaveLength(1);
    expect(next.promises[0]).toMatchObject({
      id: 'p1',
      from: 'france',
      to: 'germany',
      actingPower: 'france',
    });
  });

  test('is pure — does not mutate the input state', () => {
    const before = JSON.parse(JSON.stringify(base));
    recordPromise(base, { from: 'france', to: 'italy', type: 'support' });
    expect(base).toEqual(before);
    expect(base.promises).toHaveLength(0);
  });

  test('honors an explicit actingPower distinct from `from`', () => {
    const next = recordPromise(base, { from: 'france', to: 'germany', actingPower: 'germany' });
    expect(next.promises[0].actingPower).toBe('germany');
  });
});

describe('recordAgreement / dropAgreement', () => {
  const board = new DiplomacyBoard();
  const base = createDiplomaticState({ board, humanPower: 'england' });

  test('adds a typed agreement and is retrievable by party', () => {
    const next = recordAgreement(base, {
      id: 'a2',
      type: 'dmz',
      parties: ['france', 'italy'],
      provinces: ['pie', 'tyr'],
    });
    expect(next.agreements).toHaveLength(1);
    expect(getAgreementsFor(next, 'france')).toHaveLength(1);
    expect(getAgreementsFor(next, 'germany')).toHaveLength(0);
  });

  test('upserts by id (idempotent)', () => {
    let s = recordAgreement(base, { id: 'a1', type: 'non-aggression', parties: ['france', 'germany'] });
    s = recordAgreement(s, { id: 'a1', type: 'non-aggression', parties: ['france', 'germany'], note: 'renewed' });
    expect(s.agreements).toHaveLength(1);
    expect(s.agreements[0].note).toBe('renewed');
  });

  test('dropAgreement removes by id and is pure', () => {
    const withAgr = recordAgreement(base, { id: 'a9', type: 'support', from: 'france', to: 'germany' });
    const dropped = dropAgreement(withAgr, 'a9');
    expect(dropped.agreements).toHaveLength(0);
    expect(withAgr.agreements).toHaveLength(1); // input unchanged
  });

  test('is pure — input not mutated', () => {
    const before = JSON.parse(JSON.stringify(base));
    recordAgreement(base, { type: 'joint-attack', parties: ['france', 'germany'], target: 'italy' });
    expect(base).toEqual(before);
  });
});

describe('getters', () => {
  const board = new DiplomacyBoard();
  let state = createDiplomaticState({ board, humanPower: 'england' });

  test('getTrust returns 0 for an unseeded pair and the stored value otherwise', () => {
    expect(getTrust(state, 'france', 'germany')).toBe(0);
    expect(getTrust(state, 'nobody', 'someone')).toBe(0);
  });

  test('getLedger returns zeros when nothing recorded', () => {
    expect(getLedger(state, 'france', 'germany')).toEqual({ kept: 0, broken: 0 });
  });

  test('getPromisesBy filters by acting power', () => {
    state = recordPromise(state, { from: 'france', to: 'germany', actingPower: 'france' });
    state = recordPromise(state, { from: 'italy', to: 'austria', actingPower: 'italy' });
    expect(getPromisesBy(state, 'france')).toHaveLength(1);
    expect(getPromisesBy(state, 'italy')).toHaveLength(1);
    expect(getPromisesBy(state, 'turkey')).toHaveLength(0);
  });

  test('agreementInvolves / agreementPartner handle both parties and from/to shapes', () => {
    const dmz = { type: 'dmz', parties: ['france', 'italy'], provinces: ['pie'] };
    const support = { type: 'support', from: 'france', to: 'germany' };
    expect(agreementInvolves(dmz, 'italy')).toBe(true);
    expect(agreementInvolves(dmz, 'germany')).toBe(false);
    expect(agreementPartner(dmz, 'france')).toBe('italy');
    expect(agreementPartner(support, 'france')).toBe('germany');
    expect(agreementPartner(support, 'germany')).toBe('france');
    expect(agreementPartner(support, 'italy')).toBeNull();
  });
});
