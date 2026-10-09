import {
  scoreRound, paceFor, qualityFor, targetMs,
  TARGET_MS_PER_OPTIMAL_MOVE, FAST_FRACTION, SLOW_MULTIPLE, MIN_PACE,
} from './scoring';

describe('constants', () => {
  test('match the spec', () => {
    expect(TARGET_MS_PER_OPTIMAL_MOVE).toBe(20000);
    expect(FAST_FRACTION).toBe(0.5);
    expect(SLOW_MULTIPLE).toBe(4);
    expect(MIN_PACE).toBe(0.3);
  });
});

describe('pace', () => {
  const opt = 5;
  const t = targetMs(opt); // 100000

  test('exactly 1 at 0.5x target and below', () => {
    expect(paceFor(opt, 0.5 * t)).toBe(1);
    expect(paceFor(opt, 0.1 * t)).toBe(1);
    expect(paceFor(opt, 0)).toBe(1);
  });

  test('exactly 0.3 at 4x target and above', () => {
    expect(paceFor(opt, 4 * t)).toBe(0.3);
    expect(paceFor(opt, 100 * t)).toBe(0.3);
  });

  test('continuous at both knees', () => {
    expect(paceFor(opt, 0.5 * t + 1)).toBeGreaterThan(0.999);
    expect(paceFor(opt, 0.5 * t + 1)).toBeLessThanOrEqual(1);
    expect(paceFor(opt, 4 * t - 1)).toBeLessThan(0.3001);
    expect(paceFor(opt, 4 * t - 1)).toBeGreaterThanOrEqual(0.3);
  });

  test('monotonic non-increasing and strictly decreasing between knees', () => {
    let prev = 1;
    for (let ms = 0; ms <= 5 * t; ms += t / 50) {
      const p = paceFor(opt, ms);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
    expect(paceFor(opt, t)).toBeLessThan(paceFor(opt, 0.6 * t));
    expect(paceFor(opt, 2 * t)).toBeLessThan(paceFor(opt, t));
  });

  test('log-scale midpoint: geometric mean of knees gives halfway pace', () => {
    // sqrt(0.5 * 4) = sqrt(2) x target
    expect(paceFor(opt, Math.SQRT2 * t)).toBeCloseTo(0.65, 10);
  });

  test('target scales with optimal length', () => {
    expect(paceFor(2, 20000)).toBe(1); // 0.5 x 40000
    expect(paceFor(10, 20000)).toBe(1);
    expect(paceFor(1, 80000)).toBe(0.3);
  });
});

describe('quality', () => {
  test('1.0 at optimal, fractional above, clamped to [0,1]', () => {
    expect(qualityFor(4, 4)).toBe(1);
    expect(qualityFor(4, 8)).toBe(0.5);
    expect(qualityFor(4, 3)).toBe(1); // impossible, guarded
    expect(qualityFor(4, 0)).toBe(0);
  });
});

describe('scoreRound', () => {
  const base = { optimal: 5, moves: 5, timeMs: 1000 };

  test('perfect and fast scores 1', () => {
    expect(scoreRound(base).score).toBe(1);
  });

  test('revealed or gave up scores 0 even if otherwise perfect', () => {
    expect(scoreRound({ ...base, revealed: true }).score).toBe(0);
    expect(scoreRound({ ...base, gaveUp: true }).score).toBe(0);
  });

  test('both quality and pace affect the score', () => {
    const perfect = scoreRound(base).score;
    const moreMoves = scoreRound({ ...base, moves: 10 }).score;
    const slower = scoreRound({ ...base, timeMs: 200000 }).score;
    expect(moreMoves).toBeLessThan(perfect);
    expect(slower).toBeLessThan(perfect);
    expect(scoreRound({ ...base, moves: 10, timeMs: 200000 }).score).toBeLessThan(
      Math.min(moreMoves, slower)
    );
  });

  test('score is the product, stays in [0,1]', () => {
    const r = scoreRound({ optimal: 4, moves: 8, timeMs: 4 * targetMs(4) });
    expect(r.score).toBeCloseTo(0.5 * 0.3, 12);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
