import { DIFFICULTY_TIERS, DEFAULT_TIER_KEY, RATING_LADDER, getTier } from './difficulty';

describe('difficulty — DIFFICULTY_TIERS blurbs', () => {
  test('every tier has a non-empty plain-language blurb', () => {
    DIFFICULTY_TIERS.forEach((t) => {
      expect(typeof t.blurb).toBe('string');
      expect(t.blurb.length).toBeGreaterThan(0);
    });
  });

  test('blurbs are distinct across tiers', () => {
    const blurbs = DIFFICULTY_TIERS.map((t) => t.blurb);
    expect(new Set(blurbs).size).toBe(blurbs.length);
  });

  test('the default tier is a real tier key', () => {
    expect(DIFFICULTY_TIERS.some((t) => t.key === DEFAULT_TIER_KEY)).toBe(true);
  });
});

describe('difficulty — getTier', () => {
  test('looks up a tier by key', () => {
    expect(getTier('master').elo).toBe(2850);
  });

  test('falls back to the default tier for an unknown key', () => {
    expect(getTier('nonsense').key).toBe(DEFAULT_TIER_KEY);
  });
});

describe('difficulty — RATING_LADDER stays intact', () => {
  test('is ordered by ascending rating', () => {
    for (let i = 1; i < RATING_LADDER.length; i++) {
      expect(RATING_LADDER[i].rating).toBeGreaterThan(RATING_LADDER[i - 1].rating);
    }
  });
});
