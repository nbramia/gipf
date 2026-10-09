import { scoreRound, targetMs } from './scoring';
import {
  DEFAULT_RATING, updateRating, kFactor, isProvisional, desiredLength, expectedScore, difficultyFor,
} from './rating';

const play = (rating, rounds, optimal, moves, timeMs) =>
  updateRating(rating, optimal, scoreRound({ optimal, moves, timeMs }).score, rounds);

describe('basics', () => {
  test('default rating and difficulty', () => {
    expect(DEFAULT_RATING).toBe(1200);
    expect(difficultyFor(6)).toBe(1400);
  });

  test('expected score is 0.5 when rating equals difficulty', () => {
    expect(expectedScore(1400, 1400)).toBeCloseTo(0.5, 12);
  });

  test('score equal to expectation leaves rating unchanged', () => {
    expect(updateRating(1100, 4, 0.5, 100).rating).toBe(1100);
  });
});

describe('K schedule and provisional flag', () => {
  test('boundaries at 20 and 50', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(19)).toBe(40);
    expect(kFactor(20)).toBe(24);
    expect(kFactor(49)).toBe(24);
    expect(kFactor(50)).toBe(16);
    expect(kFactor(500)).toBe(16);
  });

  test('provisional below 20 rounds only', () => {
    expect(isProvisional(0)).toBe(true);
    expect(isProvisional(19)).toBe(true);
    expect(isProvisional(20)).toBe(false);
  });

  test('delta magnitude follows K at each boundary', () => {
    // a perfect score against an equal-rated puzzle: delta = round(K * 0.5)
    expect(updateRating(1100, 4, 1, 19).delta).toBe(20);
    expect(updateRating(1100, 4, 1, 20).delta).toBe(12);
    expect(updateRating(1100, 4, 1, 49).delta).toBe(12);
    expect(updateRating(1100, 4, 1, 50).delta).toBe(8);
  });
});

describe('desiredLength', () => {
  test('tracks rating and clamps to [2, 12]', () => {
    expect(desiredLength(1200)).toBe(5);
    expect(desiredLength(950)).toBe(3);
    expect(desiredLength(100)).toBe(2);
    expect(desiredLength(800)).toBe(2);
    expect(desiredLength(2300)).toBe(12);
    expect(desiredLength(5000)).toBe(12);
  });
});

describe('both metrics matter', () => {
  const R = 1200;
  const optimal = 5;
  const t = targetMs(optimal);

  test('faster time, same moves => strictly larger gain', () => {
    const slow = play(R, 30, optimal, 7, 3 * t).rating;
    const fast = play(R, 30, optimal, 7, 1 * t).rating;
    expect(fast).toBeGreaterThan(slow);
  });

  test('fewer moves, same time => strictly larger gain', () => {
    const many = play(R, 30, optimal, 10, 2 * t).rating;
    const few = play(R, 30, optimal, 6, 2 * t).rating;
    expect(few).toBeGreaterThan(many);
  });

  test('fast but sloppy and optimal but slow both underperform perfect', () => {
    const perfect = play(R, 30, optimal, 5, 0.4 * t).rating;
    expect(play(R, 30, optimal, 10, 0.4 * t).rating).toBeLessThan(perfect);
    expect(play(R, 30, optimal, 5, 4 * t).rating).toBeLessThan(perfect);
  });
});

describe('simulated players', () => {
  function simulate(n, behaviour) {
    let rating = DEFAULT_RATING;
    for (let i = 0; i < n; i++) {
      const optimal = desiredLength(rating);
      const { moves, timeMs } = behaviour(i, optimal);
      rating = updateRating(rating, optimal, scoreRound({ optimal, moves, timeMs }).score, i).rating;
    }
    return rating;
  }
  const flat = (i, o) => ({ moves: 2 * o, timeMs: 3 * targetMs(o) });
  const speedOnly = (i, o) => ({ moves: 2 * o, timeMs: (3 - 2.6 * (i / 99)) * targetMs(o) });
  const accuracyOnly = (i, o) => ({
    moves: Math.max(o, Math.round(2 * o - (i / 99) * o)),
    timeMs: 3 * targetMs(o),
  });
  const both = (i, o) => ({ moves: accuracyOnly(i, o).moves, timeMs: speedOnly(i, o).timeMs });

  test('an improving player out-rates one who does not', () => {
    expect(simulate(100, both)).toBeGreaterThan(simulate(100, flat));
  });

  test('improving only speed, or only accuracy, each beats the static player', () => {
    const base = simulate(100, flat);
    expect(simulate(100, speedOnly)).toBeGreaterThan(base);
    expect(simulate(100, accuracyOnly)).toBeGreaterThan(base);
  });

  test('a perfect fast player converges upward', () => {
    const r = simulate(100, (i, o) => ({ moves: o, timeMs: 0.1 * targetMs(o) }));
    expect(r).toBeGreaterThan(DEFAULT_RATING + 300);
  });

  test('a 0-scoring player converges downward but never below 100', () => {
    let rating = DEFAULT_RATING;
    for (let i = 0; i < 400; i++) {
      rating = updateRating(rating, desiredLength(rating), 0, i).rating;
      expect(rating).toBeGreaterThanOrEqual(100);
    }
    expect(rating).toBeLessThan(DEFAULT_RATING - 500);
  });
});
