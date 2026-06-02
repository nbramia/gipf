import {
  DEFAULT_RATING,
  kFactor,
  isProvisional,
  expectedScore,
  scoreFor,
  updateRating,
  nearestRung,
} from './rating';
import { RATING_LADDER } from './difficulty';

describe('rating — kFactor schedule', () => {
  test('provisional (large) while under 20 games, then steps down', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(19)).toBe(40);
    expect(kFactor(20)).toBe(20);
    expect(kFactor(39)).toBe(20);
    expect(kFactor(40)).toBe(10);
  });

  test('isProvisional matches the large-K window', () => {
    expect(isProvisional(0)).toBe(true);
    expect(isProvisional(19)).toBe(true);
    expect(isProvisional(20)).toBe(false);
  });
});

describe('rating — expectedScore', () => {
  test('equal ratings expect a draw', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
  });
  test('a 400-point edge is ~10:1 favourite', () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 4);
    expect(expectedScore(1500, 1900)).toBeCloseTo(1 / 11, 4);
  });
});

describe('rating — scoreFor', () => {
  test('maps results to numeric scores', () => {
    expect(scoreFor('win')).toBe(1);
    expect(scoreFor('draw')).toBe(0.5);
    expect(scoreFor('loss')).toBe(0);
  });
});

describe('rating — updateRating', () => {
  test('beating a much stronger opponent yields a big gain (provisional K)', () => {
    const { rating, delta } = updateRating(1000, 1400, 1, 0);
    // expected ≈ 0.09; delta ≈ round(40 * 0.91) ≈ 36
    expect(delta).toBeGreaterThan(30);
    expect(rating).toBe(1000 + delta);
  });

  test('losing to a much weaker opponent costs a lot', () => {
    const { delta } = updateRating(1800, 1200, 0, 50); // settled K=10
    // expected ≈ 0.97 → delta ≈ round(10 * -0.97) ≈ -10
    expect(delta).toBeLessThan(0);
  });

  test('an expected draw barely moves the rating', () => {
    const { delta } = updateRating(1500, 1500, 0.5, 50);
    expect(delta).toBe(0);
  });

  test('rating is floored at 100', () => {
    const { rating } = updateRating(110, 3000, 0, 0);
    expect(rating).toBeGreaterThanOrEqual(100);
  });

  test('symmetry: a win gains what the opponent would lose at equal K', () => {
    const win = updateRating(1500, 1700, 1, 0).delta;
    const loss = updateRating(1500, 1700, 0, 0).delta;
    // win delta is positive, loss delta negative; their spread equals K (40).
    expect(win - loss).toBe(40);
  });
});

describe('rating — nearestRung (matchmaking)', () => {
  test('snaps to the closest published rating', () => {
    expect(nearestRung(810, RATING_LADDER).rating).toBe(800);
    expect(nearestRung(1490, RATING_LADDER).rating).toBe(1500);
    expect(nearestRung(5000, RATING_LADDER).rating).toBe(3000);
    expect(nearestRung(100, RATING_LADDER).rating).toBe(800);
  });

  test('ties favour the stronger rung', () => {
    // 900 is equidistant from 800 and 1000 → pick 1000.
    expect(nearestRung(900, RATING_LADDER).rating).toBe(1000);
  });

  test('the default starting rating maps to a real rung', () => {
    const rung = nearestRung(DEFAULT_RATING, RATING_LADDER);
    expect(rung).toBeTruthy();
    expect(rung.spec).toBeTruthy();
  });
});

describe('rating — RATING_LADDER shape', () => {
  test('every rung has a rating and a usable engine spec', () => {
    for (const rung of RATING_LADDER) {
      expect(typeof rung.rating).toBe('number');
      const hasElo = 'elo' in rung.spec;
      const hasWeak = !!rung.spec.weak;
      expect(hasElo || hasWeak).toBe(true);
      expect(typeof rung.spec.moveTimeMs).toBe('number');
      if (hasWeak) {
        expect(rung.spec.weak.windowCp).toBeGreaterThan(0);
        expect(rung.spec.weak.pOff).toBeGreaterThan(0);
      }
    }
  });

  test('ratings are strictly increasing', () => {
    for (let i = 1; i < RATING_LADDER.length; i += 1) {
      expect(RATING_LADDER[i].rating).toBeGreaterThan(RATING_LADDER[i - 1].rating);
    }
  });

  test('sub-1320 rungs use weak sampling; the rest use the Elo limiter', () => {
    for (const rung of RATING_LADDER) {
      if (rung.rating < 1320) expect(rung.spec.weak).toBeTruthy();
      else expect('elo' in rung.spec).toBe(true);
    }
  });
});
