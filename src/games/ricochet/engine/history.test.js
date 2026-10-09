import {
  recordRound, loadHistory, loadRating, summarize, HISTORY_CAP, HISTORY_KEY, RATING_KEY,
} from './history';
import { kFactor } from './rating';

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

const entry = (o = {}) => ({
  at: 1, optimal: 4, moves: 4, timeMs: 10000, revealed: false,
  quality: 1, pace: 1, score: 1, ratingBefore: 1200, ratingAfter: 1210, ...o,
});

describe('recordRound', () => {
  test('returns entry with all fields and persists rating + history', () => {
    const e = recordRound({ optimal: 4, moves: 4, timeMs: 5000, at: 123 });
    expect(Object.keys(e).sort()).toEqual(
      ['at', 'moves', 'optimal', 'pace', 'quality', 'ratingAfter', 'ratingBefore', 'revealed', 'score', 'timeMs'].sort()
    );
    expect(e.at).toBe(123);
    expect(e.score).toBe(1);
    expect(e.ratingBefore).toBe(1200);
    expect(e.ratingAfter).toBeGreaterThan(1200);
    expect(loadRating()).toEqual({ rating: e.ratingAfter, rounds: 1 });
    expect(loadHistory()).toEqual([e]);
  });

  test('revealed rounds score 0 and lower the rating', () => {
    const e = recordRound({ optimal: 4, moves: 4, timeMs: 1000, revealed: true });
    expect(e.score).toBe(0);
    expect(e.revealed).toBe(true);
    expect(e.ratingAfter).toBeLessThan(e.ratingBefore);
  });

  test('uses the K schedule from the stored round count', () => {
    localStorage.setItem(RATING_KEY, JSON.stringify({ rating: 1100, rounds: 20 }));
    const e = recordRound({ optimal: 4, moves: 4, timeMs: 1000 });
    expect(e.ratingAfter - 1100).toBe(Math.round(kFactor(20) * 0.5));
    expect(loadRating().rounds).toBe(21);
  });

  test('cap at 500 keeps the newest', () => {
    const seeded = Array.from({ length: HISTORY_CAP }, (_, i) => entry({ at: i }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(seeded));
    recordRound({ optimal: 4, moves: 4, timeMs: 1000, at: 9999 });
    const h = loadHistory();
    expect(h).toHaveLength(HISTORY_CAP);
    expect(h[0].at).toBe(1);
    expect(h[h.length - 1].at).toBe(9999);
  });
});

describe('invalid input', () => {
  test.each([
    ['negative time', { optimal: 4, moves: 4, timeMs: -1 }],
    ['NaN time', { optimal: 4, moves: 4, timeMs: NaN }],
    ['moves below optimal', { optimal: 4, moves: 3, timeMs: 1000 }],
    ['zero optimal', { optimal: 0, moves: 0, timeMs: 1000 }],
    ['negative optimal', { optimal: -2, moves: 3, timeMs: 1000 }],
    ['NaN moves', { optimal: 4, moves: NaN, timeMs: 1000 }],
  ])('%s is rejected without touching storage', (_n, input) => {
    expect(recordRound(input)).toBeNull();
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem(RATING_KEY)).toBeNull();
  });

  test.each([[undefined], [null], [5], ['x']])('non-object input %p returns null', (input) => {
    expect(recordRound(input)).toBeNull();
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem(RATING_KEY)).toBeNull();
  });

  test('fractional optimal or moves is rejected', () => {
    expect(recordRound({ optimal: 4.5, moves: 5, timeMs: 1000 })).toBeNull();
    expect(recordRound({ optimal: 4, moves: 5.5, timeMs: 1000 })).toBeNull();
  });

  test('revealed round may have fewer moves than optimal', () => {
    expect(recordRound({ optimal: 4, moves: 0, timeMs: 1000, revealed: true })).not.toBeNull();
  });
});

describe('corrupt storage', () => {
  test('corrupt JSON is ignored', () => {
    localStorage.setItem(HISTORY_KEY, '{nope');
    localStorage.setItem(RATING_KEY, '][');
    expect(loadHistory()).toEqual([]);
    expect(loadRating()).toEqual({ rating: 1200, rounds: 0 });
    expect(() => recordRound({ optimal: 4, moves: 4, timeMs: 1 })).not.toThrow();
    expect(loadHistory()).toHaveLength(1);
  });

  test('wrong top-level types are ignored', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ a: 1 }));
    localStorage.setItem(RATING_KEY, JSON.stringify([1200]));
    expect(loadHistory()).toEqual([]);
    expect(loadRating()).toEqual({ rating: 1200, rounds: 0 });
  });

  test('bad rating shapes fall back to default', () => {
    for (const bad of [{ rating: '1300', rounds: 3 }, { rating: 1300 }, { rating: 1300, rounds: -1 },
      { rating: 5, rounds: 3 }, { rating: 1300, rounds: 1.5 }, null]) {
      localStorage.setItem(RATING_KEY, JSON.stringify(bad));
      expect(loadRating()).toEqual({ rating: 1200, rounds: 0 });
    }
  });

  test('invalid and partial entries are dropped, valid ones kept', () => {
    const good = entry({ at: 5 });
    const { score: _omitted, ...partial } = entry();
    localStorage.setItem(HISTORY_KEY, JSON.stringify([
      good, partial, null, 7, 'x', entry({ moves: '4' }), entry({ revealed: 'no' }),
      entry({ score: 2 }), entry({ optimal: 0 }), entry({ timeMs: -1 }), entry({ at: null }),
      entry({ ratingAfter: null }), entry({ ratingBefore: 99 }), entry({ ratingAfter: 50 }),
      entry({ moves: 3 }),
    ]));
    expect(loadHistory()).toEqual([good]);
  });

  test.each([
    ['fractional optimal', { optimal: 4.5, moves: 5 }],
    ['fractional moves', { moves: 4.5 }],
    ['fractional ratingBefore', { ratingBefore: 1200.5 }],
    ['fractional ratingAfter', { ratingAfter: 1210.5 }],
    ['quality inconsistent with moves', { moves: 8, quality: 1, score: 1 }],
    ['pace inconsistent with time', { timeMs: 400000, quality: 1, score: 1, pace: 1 }],
    ['score inconsistent with quality x pace', { score: 0.9 }],
    ['revealed but nonzero score', { revealed: true }],
  ])('stored %s is dropped', (_n, over) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry(over)]));
    expect(loadHistory()).toEqual([]);
  });

  test('consistent entries survive, including a slow, sloppy one', () => {
    const e = entry({ moves: 8, timeMs: 320000, quality: 0.5, pace: 0.3, score: 0.15 });
    localStorage.setItem(HISTORY_KEY, JSON.stringify([e]));
    expect(loadHistory()).toEqual([e]);
  });

  test('getItem throwing does not throw', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadHistory()).toEqual([]);
    expect(loadRating().rating).toBe(1200);
  });

  test('setItem throwing does not throw and still returns the entry', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    let e;
    expect(() => { e = recordRound({ optimal: 4, moves: 4, timeMs: 1000 }); }).not.toThrow();
    expect(e.score).toBe(1);
  });
});

describe('summarize', () => {
  const h = [
    entry({ optimal: 2, moves: 2, timeMs: 4000, quality: 1, ratingAfter: 1210 }),
    entry({ optimal: 4, moves: 8, timeMs: 8000, quality: 0.5, ratingAfter: 1190 }),
    entry({ optimal: 5, moves: 5, timeMs: 25000, quality: 1, ratingAfter: 1200 }),
    entry({ optimal: 4, moves: 4, timeMs: 8000, revealed: true, quality: 1, score: 0, ratingAfter: 1180 }),
  ];

  test('known fixture over full window', () => {
    const s = summarize(h);
    expect(s.ratingSeries).toEqual([1210, 1190, 1200, 1180]);
    expect(s.roundsPlayed).toBe(4);
    expect(s.avgQuality).toBeCloseTo((1 + 0.5 + 1) / 3, 10); // revealed round excluded
    expect(s.avgSecondsPerOptimalMove).toBeCloseTo(3, 10); // revealed round excluded: (2 + 2 + 5) / 3
    expect(s.optimalShare).toBeCloseTo(0.5, 10); // revealed round does not count
    expect(s.revealedCount).toBe(1);
  });

  test('window limits stats to the latest rounds but not the rating series', () => {
    const s = summarize(h, { window: 2 });
    expect(s.ratingSeries).toHaveLength(4);
    expect(s.roundsPlayed).toBe(2);
    expect(s.avgQuality).toBeCloseTo(1, 10);
    expect(s.revealedCount).toBe(1);
    expect(s.optimalShare).toBeCloseTo(0.5, 10);
  });

  test('avgQuality ignores revealed rounds', () => {
    const s = summarize([entry({ quality: 0.5 }), entry({ revealed: true, quality: 1 })]);
    expect(s.avgQuality).toBeCloseTo(0.5, 10);
    expect(s.roundsPlayed).toBe(2);
    expect(s.revealedCount).toBe(1);
  });

  test('avgSecondsPerOptimalMove ignores revealed rounds', () => {
    const s = summarize([entry({ timeMs: 8000, optimal: 4 }), entry({ revealed: true, timeMs: 80000, optimal: 4 })]);
    expect(s.avgSecondsPerOptimalMove).toBeCloseTo(2, 10);
  });

  test('empty history yields zeros', () => {
    expect(summarize([])).toEqual({
      ratingSeries: [], roundsPlayed: 0, avgQuality: 0,
      avgSecondsPerOptimalMove: 0, optimalShare: 0, revealedCount: 0,
    });
  });
});
