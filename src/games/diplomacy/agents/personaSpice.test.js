// Persona spice (the setup slider) must change what the AI powers are and do:
// persona temperament extremity, the honor-vs-betray margin, and the tone the
// agent prompt carries. api/diplomacyAgent.js is covered in endpoint.test.js.

import DiplomacyBoard from '../DiplomacyBoard.js';
import { createDiplomaticState, recordAgreement, relationKey } from './diplomaticState.js';
import { decideStrategicIntent, reputationCost, breakMargin, MARGIN } from './betrayalModel.js';
import {
  PERSONAS,
  buildPersonas,
  ensureSpice,
  normalizeSpice,
  DEFAULT_SPICE,
} from './personas.js';

describe('buildPersonas', () => {
  test('0.5 reproduces the base temperaments exactly', () => {
    const mid = buildPersonas(0.5);
    for (const power of Object.keys(PERSONAS)) {
      expect(mid[power].temperament.trust).toBeCloseTo(PERSONAS[power].temperament.trust, 10);
      expect(mid[power].temperament.aggression).toBeCloseTo(PERSONAS[power].temperament.aggression, 10);
    }
  });

  test('different spice values give different personas; higher spice is more extreme', () => {
    const calm = buildPersonas(0);
    const wild = buildPersonas(1);
    for (const power of Object.keys(PERSONAS)) {
      const dist = (p) => Math.abs(p.temperament.aggression - 0.5) + Math.abs(p.temperament.trust - 0.5);
      expect(dist(wild[power])).toBeGreaterThan(dist(calm[power]));
      expect(wild[power].temperament).not.toEqual(calm[power].temperament);
      expect(calm[power].spice).toBe(0);
      expect(wild[power].spice).toBe(1);
    }
  });

  test('knobs stay within [0, 1] and the base PERSONAS are never mutated', () => {
    const before = JSON.stringify(PERSONAS);
    const wild = buildPersonas(1);
    for (const p of Object.values(wild)) {
      for (const v of Object.values(p.temperament)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(JSON.stringify(PERSONAS)).toBe(before);
  });

  test('normalizeSpice clamps and defaults', () => {
    expect(normalizeSpice(5)).toBe(1);
    expect(normalizeSpice(-1)).toBe(0);
    expect(normalizeSpice(undefined)).toBe(DEFAULT_SPICE);
    expect(normalizeSpice('nope')).toBe(DEFAULT_SPICE);
  });
});

describe('ensureSpice (restoring a save)', () => {
  test('personas from before spice existed take the fallback spice', () => {
    const legacy = { france: { ...PERSONAS.france }, england: { ...PERSONAS.england } };
    const restored = ensureSpice(legacy, 1);
    expect(restored.france.spice).toBe(1);
    expect(restored.france.temperament).not.toEqual(PERSONAS.france.temperament);
  });

  test('personas that already carry spice are kept as saved', () => {
    const saved = buildPersonas(0.2);
    expect(ensureSpice(saved, 1)).toBe(saved);
  });

  test('a missing persona set is rebuilt from the fallback', () => {
    expect(ensureSpice(null, 0).france.spice).toBe(0);
  });
});

describe('betrayal margin', () => {
  test('is the base MARGIN with no persona or at 0.5, wider when calm, thinner when spicy', () => {
    expect(breakMargin(null)).toBeCloseTo(MARGIN, 10);
    expect(breakMargin({ spice: 0.5 })).toBeCloseTo(MARGIN, 10);
    expect(breakMargin({ spice: 0 })).toBeGreaterThan(MARGIN);
    expect(breakMargin({ spice: 1 })).toBeLessThan(MARGIN);
  });

  test('the same borderline deal is honored by a restrained power and broken by a spicy one', () => {
    const board = new DiplomacyBoard();
    let state = createDiplomaticState({ board, humanPower: 'england' });
    state = recordAgreement(state, { id: 'a1', type: 'non-aggression', parties: ['france', 'germany'] });
    state = JSON.parse(JSON.stringify(state));
    state.relations[relationKey('france', 'germany')] = { trust: 0, lastUpdatedPhase: null };

    // Pick the payoff so (breakScore - honorScore) sits exactly at the base MARGIN.
    const payoff = MARGIN + 0.7 * reputationCost(state, 'france', 'germany');
    const personas = buildPersonas(0);
    const spicy = buildPersonas(1);
    const calmIntent = decideStrategicIntent({ board, state, power: 'france', payoff, persona: personas.france });
    const spicyIntent = decideStrategicIntent({ board, state, power: 'france', payoff, persona: spicy.france });
    expect(calmIntent.betrayals).toEqual([]);
    expect(spicyIntent.betrayals).toContainEqual({ type: 'non-aggression', partner: 'germany' });
  });
});
