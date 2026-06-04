import { validateStrategicIntent, STRATEGIC_INTENT_SCHEMA } from './strategicIntent.js';

const VALID = {
  power: 'france',
  allies: ['germany'],
  targets: ['italy'],
  supportDeals: [{ from: 'france', to: 'germany' }],
  dmz: ['pie', 'tyr'],
  betrayals: [{ type: 'non-aggression', partner: 'germany' }],
};

describe('validateStrategicIntent', () => {
  test('accepts the canonical example from the issue', () => {
    expect(validateStrategicIntent(VALID)).toBe(true);
  });

  test('accepts an empty-ish intent (no deals)', () => {
    expect(
      validateStrategicIntent({ power: 'italy', allies: [], targets: [], supportDeals: [], dmz: [], betrayals: [] })
    ).toBe(true);
  });

  test('rejects null / non-object without throwing', () => {
    expect(validateStrategicIntent(null)).toBe(false);
    expect(validateStrategicIntent('nope')).toBe(false);
    expect(validateStrategicIntent([])).toBe(false);
  });

  test('rejects a missing or empty power', () => {
    expect(validateStrategicIntent({ ...VALID, power: '' })).toBe(false);
    const { power, ...noPower } = VALID;
    expect(validateStrategicIntent(noPower)).toBe(false);
  });

  test('rejects non-string-array allies / targets / dmz', () => {
    expect(validateStrategicIntent({ ...VALID, allies: 'germany' })).toBe(false);
    expect(validateStrategicIntent({ ...VALID, targets: [1, 2] })).toBe(false);
    expect(validateStrategicIntent({ ...VALID, dmz: [{}] })).toBe(false);
  });

  test('rejects malformed supportDeals', () => {
    expect(validateStrategicIntent({ ...VALID, supportDeals: [{ from: 'france' }] })).toBe(false);
    expect(validateStrategicIntent({ ...VALID, supportDeals: ['france>germany'] })).toBe(false);
  });

  test('rejects malformed betrayals', () => {
    expect(validateStrategicIntent({ ...VALID, betrayals: [{ partner: 'germany' }] })).toBe(false);
    expect(validateStrategicIntent({ ...VALID, betrayals: [{ type: 'support', partner: 5 }] })).toBe(false);
  });

  test('rejects stray keys outside the contract', () => {
    expect(validateStrategicIntent({ ...VALID, extra: true })).toBe(false);
  });

  test('exports a schema description for downstream assertions', () => {
    expect(Object.keys(STRATEGIC_INTENT_SCHEMA).sort()).toEqual(
      ['allies', 'betrayals', 'dmz', 'power', 'supportDeals', 'targets']
    );
  });
});
