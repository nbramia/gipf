import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState, recordAgreement } from './diplomaticState.js';
import { relationKey } from './diplomaticState.js';
import { validateStrategicIntent } from './strategicIntent.js';
import {
  decideStrategicIntent,
  decideAllIntents,
  reputationCost,
  W_TRUST,
  W_REP,
  W_PAYOFF,
  MARGIN,
} from './betrayalModel.js';

// Set a directional trust value directly on a state (the model only reads it).
function withTrust(state, from, to, trust) {
  const next = JSON.parse(JSON.stringify(state));
  next.relations[relationKey(from, to)] = { trust, lastUpdatedPhase: null };
  return next;
}

describe('decideStrategicIntent — schema conformance', () => {
  test('output validates for every alive AI power on a fresh board', () => {
    const board = new DiplomacyBoard();
    const state = createDiplomaticState({ board, humanPower: 'england' });
    const intents = decideAllIntents({ board, state, humanPower: 'england' });
    const ai = board.getPowerIds().filter((p) => p !== 'england');
    expect(Object.keys(intents).sort()).toEqual(ai.sort());
    for (const power of ai) {
      expect(validateStrategicIntent(intents[power])).toBe(true);
      expect(intents[power].power).toBe(power);
    }
  });

  test('a power with no agreements yields a valid empty-ish intent with board threats', () => {
    const board = new DiplomacyBoard();
    const state = createDiplomaticState({ board, humanPower: 'england' });
    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0 });
    expect(validateStrategicIntent(intent)).toBe(true);
    expect(intent.allies).toEqual([]);
    expect(intent.supportDeals).toEqual([]);
    expect(intent.betrayals).toEqual([]);
    expect(intent.dmz).toEqual([]);
    // Targets are derived from the board even with no deals.
    expect(intent.targets.length).toBeGreaterThan(0);
    expect(intent.targets).not.toContain('france');
  });
});

describe('decideStrategicIntent — honor vs betray', () => {
  test('high trust + low payoff → honor (support deal kept, partner not a target)', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'support', from: 'france', to: 'germany' });
    state = withTrust(state, 'france', 'germany', 0.9);

    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0.05 });
    expect(intent.supportDeals).toContainEqual({ from: 'france', to: 'germany' });
    expect(intent.betrayals).toEqual([]);
    expect(intent.allies).toContain('germany');
    expect(intent.targets).not.toContain('germany');
  });

  test('low trust + high payoff → betray (partner → targets, deal → betrayals)', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'non-aggression', parties: ['france', 'germany'] });
    state = withTrust(state, 'france', 'germany', -0.5);

    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 1.0 });
    expect(intent.betrayals).toContainEqual({ type: 'non-aggression', partner: 'germany' });
    expect(intent.targets).toContain('germany');
    expect(intent.allies).not.toContain('germany');
    expect(intent.supportDeals).toEqual([]);
  });

  test('honored DMZ keeps the partner out of targets and lists its provinces', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, {
      id: 'a1', type: 'dmz', parties: ['france', 'italy'], provinces: ['pie', 'tyr'],
    });
    state = withTrust(state, 'france', 'italy', 0.8);

    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0.05 });
    expect(intent.dmz).toEqual(expect.arrayContaining(['pie', 'tyr']));
    expect(intent.targets).not.toContain('italy');
    expect(intent.allies).toContain('italy');
  });

  test('supportDeals (honored) and betrayals are disjoint and partition the support agreements', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    // Two support agreements: one honored (high trust), one betrayed (low trust).
    state = recordAgreement(state, { id: 'a1', type: 'support', from: 'france', to: 'germany' });
    state = recordAgreement(state, { id: 'a2', type: 'support', from: 'france', to: 'russia' });
    state = withTrust(state, 'france', 'germany', 0.9);
    state = withTrust(state, 'france', 'russia', -0.9);

    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0.5 });
    const honoredPartners = intent.supportDeals.map((d) => d.to);
    const brokenPartners = intent.betrayals.map((b) => b.partner);
    expect(honoredPartners).toContain('germany');
    expect(brokenPartners).toContain('russia');
    // Disjoint.
    expect(honoredPartners.filter((p) => brokenPartners.includes(p))).toEqual([]);
    // Together they cover both support agreements (2).
    expect(honoredPartners.length + brokenPartners.length).toBe(2);
  });
});

describe('decideStrategicIntent — determinism', () => {
  test('identical inputs produce identical output', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'support', from: 'france', to: 'germany' });
    state = withTrust(state, 'france', 'germany', 0.4);
    const a = decideStrategicIntent({ board, state, power: 'france', payoff: 0.2 });
    const b = decideStrategicIntent({ board, state, power: 'france', payoff: 0.2 });
    expect(a).toEqual(b);
  });

  test('does not mutate the input state', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'support', from: 'france', to: 'germany' });
    const before = JSON.parse(JSON.stringify(state));
    decideStrategicIntent({ board, state, power: 'france', payoff: 0.5 });
    expect(state).toEqual(before);
  });
});

describe('reputationCost', () => {
  test('an unblemished record carries the full reputational stake', () => {
    const board = new DiplomacyBoard();
    const state = createDiplomaticState({ board, humanPower: 'england' });
    expect(reputationCost(state, 'france', 'germany')).toBeCloseTo(0.5, 5);
  });

  test('a record of broken promises lowers the marginal cost of another betrayal', () => {
    const board = new DiplomacyBoard();
    const state = createDiplomaticState({ board, humanPower: 'england' });
    state.promiseLedger[relationKey('france', 'germany')] = { kept: 1, broken: 3 };
    // reliability = 1/4 = 0.25 → cost = 0.5 * 0.25 = 0.125
    expect(reputationCost(state, 'france', 'germany')).toBeCloseTo(0.125, 5);
  });
});

describe('exported weights', () => {
  test('all decision weights are numbers', () => {
    [W_TRUST, W_REP, W_PAYOFF, MARGIN].forEach((w) => expect(typeof w).toBe('number'));
  });
});
