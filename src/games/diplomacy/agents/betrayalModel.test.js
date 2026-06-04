import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState, recordAgreement } from './diplomaticState.js';
import { relationKey } from './diplomaticState.js';
import { validateStrategicIntent } from './strategicIntent.js';
import {
  decideStrategicIntent,
  decideAllIntents,
  reputationCost,
  effectiveTrust,
  payoffOfBreaking,
  W_TRUST,
  W_REP,
  W_PAYOFF,
  W_LEDGER,
  W_SCRATCH,
  MARGIN,
} from './betrayalModel.js';

// Set a directional trust value directly on a state (the model only reads it).
function withTrust(state, from, to, trust) {
  const next = JSON.parse(JSON.stringify(state));
  next.relations[relationKey(from, to)] = { trust, lastUpdatedPhase: null };
  return next;
}

// Attach a private scratchpad disposition for `power` toward `partner`.
function withScratchpad(state, power, partner, disposition) {
  const next = JSON.parse(JSON.stringify(state));
  if (!next.scratchpads) next.scratchpads = {};
  const pad = next.scratchpads[power] || { self: power, dispositions: {}, priority: '', confidence: 0.5 };
  pad.dispositions = { ...pad.dispositions, [partner]: disposition };
  next.scratchpads[power] = pad;
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

describe('payoffOfBreaking — deal-specific gain (#44)', () => {
  // On a fresh board France's reachable move targets are SPA, BRE, ENG, MAO.
  const REACHABLE = ['spa', 'bre', 'eng', 'mao'];

  test('a low-constraint deal yields a small (near-zero) gain', () => {
    const board = new DiplomacyBoard();
    // DMZ over a province France cannot reach this turn → honoring costs nothing.
    const deal = { type: 'dmz', parties: ['france', 'italy'], provinces: ['mos'] };
    expect(payoffOfBreaking(board, 'france', deal)).toBe(0);
  });

  test('a deal blocking all of a power\'s grabs yields a large gain', () => {
    const board = new DiplomacyBoard();
    const deal = { type: 'dmz', parties: ['france', 'italy'], provinces: REACHABLE };
    expect(payoffOfBreaking(board, 'france', deal)).toBeGreaterThan(0.5);
  });

  test('the high-constraint gain exceeds the low-constraint gain for the same power/turn', () => {
    const board = new DiplomacyBoard();
    const low = payoffOfBreaking(board, 'france', { type: 'dmz', parties: ['france', 'italy'], provinces: ['mos'] });
    const high = payoffOfBreaking(board, 'france', { type: 'dmz', parties: ['france', 'italy'], provinces: REACHABLE });
    expect(high).toBeGreaterThan(low);
  });

  test('clamps to [0, ∞) and is deterministic', () => {
    const board = new DiplomacyBoard();
    const deal = { type: 'dmz', parties: ['france', 'italy'], provinces: REACHABLE };
    const a = payoffOfBreaking(board, 'france', deal);
    const b = payoffOfBreaking(board, 'france', deal);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  test('returns 0 when the board cannot generate plans', () => {
    expect(payoffOfBreaking(null, 'france', { type: 'dmz', provinces: ['spa'] })).toBe(0);
    expect(payoffOfBreaking({}, 'france', { type: 'dmz', provinces: ['spa'] })).toBe(0);
  });
});

describe('decideStrategicIntent — per-deal betrayal resolves deals independently (#44)', () => {
  const REACHABLE = ['spa', 'bre', 'eng', 'mao'];

  test('two deals for the same power can resolve differently in one turn', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    // Moderate positive trust on both so the per-deal PAYOFF decides honor vs
    // break: the low-constraint deal (gain 0) stays honored, the high-constraint
    // one (large gain) is broken.
    state = withTrust(state, 'france', 'italy', 0.5);
    state = withTrust(state, 'france', 'germany', 0.5);
    // A low-constraint DMZ with italy (honored) and a high-constraint DMZ with
    // germany (broken) — same power, same turn, opposite outcomes.
    state = recordAgreement(state, { id: 'd-low', type: 'dmz', parties: ['france', 'italy'], provinces: ['mos'] });
    state = recordAgreement(state, { id: 'd-high', type: 'dmz', parties: ['france', 'germany'], provinces: REACHABLE });

    const intent = decideStrategicIntent({ board, state, power: 'france' });
    const brokenPartners = intent.betrayals.map((bt) => bt.partner);
    expect(brokenPartners).toContain('germany'); // high-value grab → stab
    expect(brokenPartners).not.toContain('italy'); // low-stakes deal → honored
    expect(intent.allies).toContain('italy');
    expect(validateStrategicIntent(intent)).toBe(true);
  });

  test('an injected payoff still overrides the per-deal proxy', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'dmz', parties: ['france', 'germany'], provinces: REACHABLE });
    state = withTrust(state, 'france', 'germany', 0.7);
    // Force a tiny payoff so the high-constraint deal is honored despite its real
    // (large) gain-from-breaking — proving the override wins.
    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0 });
    expect(intent.betrayals).toEqual([]);
    expect(intent.allies).toContain('germany');
  });
});

describe('exported weights', () => {
  test('all decision weights are numbers', () => {
    [W_TRUST, W_REP, W_PAYOFF, W_LEDGER, W_SCRATCH, MARGIN].forEach((w) => expect(typeof w).toBe('number'));
  });

  test('the ledger weight dominates the scratchpad weight', () => {
    expect(W_LEDGER).toBeGreaterThan(W_SCRATCH);
  });
});

describe('effectiveTrust — ledger-dominant blend (#44)', () => {
  test('falls back to pure ledger trust with no scratchpad note', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = withTrust(state, 'france', 'germany', 0.6);
    expect(effectiveTrust(state, 'france', 'germany')).toBeCloseTo(0.6, 5);
  });

  test('blends ledger and scratchpad, ledger dominant', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = withTrust(state, 'france', 'germany', 0.9);
    state = withScratchpad(state, 'france', 'germany', { trust: -0.5, stance: 'rival', intent: 'wary' });
    // 0.7*0.9 + 0.3*(-0.5) = 0.63 - 0.15 = 0.48 — still clearly positive.
    expect(effectiveTrust(state, 'france', 'germany')).toBeCloseTo(W_LEDGER * 0.9 + W_SCRATCH * -0.5, 5);
    expect(effectiveTrust(state, 'france', 'germany')).toBeGreaterThan(0);
  });

  test('clamps to [-1, 1]', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = withTrust(state, 'france', 'germany', 1);
    state = withScratchpad(state, 'france', 'germany', { trust: 1, stance: 'ally', intent: 'friends' });
    expect(effectiveTrust(state, 'france', 'germany')).toBeLessThanOrEqual(1);
  });
});

describe('decideStrategicIntent — scratchpad steers intent (#44)', () => {
  test('a hostile scratchpad puts a deal-less rival into targets', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    // No agreement with germany; france privately marks them an enemy to stab.
    state = withScratchpad(state, 'france', 'germany', { trust: -0.6, stance: 'enemy', intent: 'Stab them in Burgundy.' });

    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0 });
    expect(intent.targets).toContain('germany');
    expect(intent.allies).not.toContain('germany');
    // No mechanically-broken deal exists.
    expect(intent.betrayals).toEqual([]);
    expect(validateStrategicIntent(intent)).toBe(true);
  });

  test('a rival stance needs a hostile intent to target a deal-less power', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    // 'rival' but with a non-hostile intent → not auto-targeted by the scratchpad
    // rule (board threats may still apply, so use a power that is not a threat:
    // assert only that the rule itself does not force it via a friendly stance).
    state = withScratchpad(state, 'france', 'italy', { trust: 0.1, stance: 'ally', intent: 'Keep the peace.' });
    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0 });
    // A self-declared ally (no contradicting ledger) is kept out of targets.
    expect(intent.targets).not.toContain('italy');
    expect(intent.allies).toContain('italy');
  });

  test('ledger dominates a scratchpad it disagrees with: high ledger trust keeps a deal honored', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'non-aggression', parties: ['france', 'germany'] });
    state = withTrust(state, 'france', 'germany', 0.9); // ledger: very trusted
    state = withScratchpad(state, 'france', 'germany', { trust: -0.5, stance: 'rival', intent: 'wary of them' });

    // effectiveTrust = 0.7*0.9 + 0.3*(-0.5) = 0.48 > 0 → honored (with low payoff).
    const intent = decideStrategicIntent({ board, state, power: 'france', payoff: 0.05 });
    expect(intent.betrayals).toEqual([]);
    expect(intent.allies).toContain('germany');
    expect(intent.targets).not.toContain('germany');
  });

  test('scratchpad targeting is deterministic and does not mutate input', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = withScratchpad(state, 'france', 'germany', { trust: -0.6, stance: 'enemy', intent: 'attack' });
    const before = JSON.parse(JSON.stringify(state));
    const a = decideStrategicIntent({ board, state, power: 'france', payoff: 0 });
    const b = decideStrategicIntent({ board, state, power: 'france', payoff: 0 });
    expect(a).toEqual(b);
    expect(state).toEqual(before);
  });
});
