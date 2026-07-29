// gameHistory.test.js — the per-game history log: cap enforcement,
// corrupt/absent storage handling, accuracy trend (including too-little-data
// and direction correctness), opening report-card grouping + colour split,
// and null-accuracy exclusion in overall stats.

import {
  GAME_LOG_KEY,
  GAME_LOG_CAP,
  loadGameLog,
  saveGameLog,
  recordGame,
  accuracyTrend,
  openingReportCard,
  overallStats,
} from './gameHistory.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const game = (over = {}) => ({
  playedAt: NOW,
  result: 'win',
  color: 'w',
  rated: false,
  opponentKey: 'casual-1200',
  accuracy: 90,
  counts: { blunder: 0, mistake: 0, inaccuracy: 1 },
  opening: 'Italian Game',
  eco: 'C50',
  leftBookAtPly: 6,
  moves: 30,
  ...over,
});

describe('loadGameLog / saveGameLog', () => {
  beforeEach(() => localStorage.clear());

  test('returns [] when storage is empty', () => {
    expect(loadGameLog()).toEqual([]);
  });

  test('returns [] on corrupt JSON', () => {
    localStorage.setItem(GAME_LOG_KEY, '{not json');
    expect(loadGameLog()).toEqual([]);
  });

  test('returns [] when stored value is not an array', () => {
    localStorage.setItem(GAME_LOG_KEY, JSON.stringify({ oops: true }));
    expect(loadGameLog()).toEqual([]);
  });

  test('round-trips a log', () => {
    const log = [game()];
    saveGameLog(log);
    expect(loadGameLog()).toEqual(log);
  });

  test('saveGameLog never throws when localStorage is unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveGameLog([game()])).not.toThrow();
    spy.mockRestore();
  });
});

describe('recordGame', () => {
  test('appends an entry', () => {
    const log = recordGame([], game());
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(game());
  });

  test('does not mutate the input log', () => {
    const original = [game()];
    const next = recordGame(original, game({ result: 'loss' }));
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  test('caps the log at GAME_LOG_CAP, dropping the oldest first', () => {
    let log = [];
    for (let i = 0; i < GAME_LOG_CAP + 10; i += 1) {
      log = recordGame(log, game({ playedAt: NOW + i }));
    }
    expect(log).toHaveLength(GAME_LOG_CAP);
    // The oldest 10 were evicted; the log should start at playedAt NOW+10.
    expect(log[0].playedAt).toBe(NOW + 10);
    expect(log[log.length - 1].playedAt).toBe(NOW + GAME_LOG_CAP + 9);
  });
});

describe('accuracyTrend', () => {
  test('reports nulls when there are too few games', () => {
    const log = [game(), game(), game()];
    const trend = accuracyTrend(log);
    expect(trend.direction).toBeNull();
    expect(trend.recentMean).toBeNull();
    expect(trend.earlierMean).toBeNull();
  });

  test('excludes null-accuracy games from the sample-size check', () => {
    // 5 with accuracy + 3 without — still under MIN_TREND_GAMES(6) of usable data.
    const log = [
      game({ accuracy: 80 }),
      game({ accuracy: 80 }),
      game({ accuracy: 80 }),
      game({ accuracy: 80 }),
      game({ accuracy: 80 }),
      game({ accuracy: null }),
      game({ accuracy: null }),
      game({ accuracy: null }),
    ];
    expect(accuracyTrend(log).direction).toBeNull();
  });

  test('detects an improving trend', () => {
    const log = [
      game({ accuracy: 60 }),
      game({ accuracy: 62 }),
      game({ accuracy: 61 }),
      game({ accuracy: 90 }),
      game({ accuracy: 92 }),
      game({ accuracy: 91 }),
    ];
    const trend = accuracyTrend(log);
    expect(trend.direction).toBe('improving');
    expect(trend.earlierMean).toBeLessThan(trend.recentMean);
  });

  test('detects a declining trend', () => {
    const log = [
      game({ accuracy: 92 }),
      game({ accuracy: 91 }),
      game({ accuracy: 90 }),
      game({ accuracy: 61 }),
      game({ accuracy: 62 }),
      game({ accuracy: 60 }),
    ];
    expect(accuracyTrend(log).direction).toBe('declining');
  });

  test('detects a steady trend within the epsilon', () => {
    const log = [
      game({ accuracy: 80 }),
      game({ accuracy: 81 }),
      game({ accuracy: 79 }),
      game({ accuracy: 80 }),
      game({ accuracy: 81 }),
      game({ accuracy: 80 }),
    ];
    expect(accuracyTrend(log).direction).toBe('steady');
  });

  test('respects the limit option to only look at recent games', () => {
    const stale = Array.from({ length: 10 }, () => game({ accuracy: 40 }));
    const recent = [
      game({ accuracy: 90 }),
      game({ accuracy: 91 }),
      game({ accuracy: 90 }),
      game({ accuracy: 92 }),
      game({ accuracy: 91 }),
      game({ accuracy: 90 }),
    ];
    const trend = accuracyTrend([...stale, ...recent], { limit: 6 });
    expect(trend.games).toHaveLength(6);
    expect(trend.recentMean).toBeGreaterThan(80);
  });
});

describe('openingReportCard', () => {
  test('groups by opening and sorts most-played first', () => {
    const log = [
      game({ opening: 'Italian Game', eco: 'C50' }),
      game({ opening: 'Italian Game', eco: 'C50' }),
      game({ opening: 'Sicilian Defense', eco: 'B20' }),
    ];
    const report = openingReportCard(log);
    expect(report[0].name).toBe('Italian Game');
    expect(report[0].games).toBe(2);
    expect(report[1].name).toBe('Sicilian Defense');
    expect(report[1].games).toBe(1);
  });

  test('tracks W/L/D per opening', () => {
    const log = [
      game({ opening: 'Italian Game', result: 'win' }),
      game({ opening: 'Italian Game', result: 'loss' }),
      game({ opening: 'Italian Game', result: 'draw' }),
    ];
    const [row] = openingReportCard(log);
    expect(row.w).toBe(1);
    expect(row.l).toBe(1);
    expect(row.d).toBe(1);
  });

  test('splits games by colour', () => {
    const log = [
      game({ opening: 'Sicilian Defense', color: 'b', result: 'win' }),
      game({ opening: 'Sicilian Defense', color: 'b', result: 'win' }),
      game({ opening: 'Sicilian Defense', color: 'w', result: 'loss' }),
    ];
    const [row] = openingReportCard(log);
    expect(row.byColor.b.games).toBe(2);
    expect(row.byColor.b.w).toBe(2);
    expect(row.byColor.w.games).toBe(1);
    expect(row.byColor.w.l).toBe(1);
  });

  test('excludes null accuracy/leftBookAtPly from their averages', () => {
    const log = [
      game({ opening: 'Italian Game', accuracy: 80, leftBookAtPly: 8 }),
      game({ opening: 'Italian Game', accuracy: null, leftBookAtPly: null }),
    ];
    const [row] = openingReportCard(log);
    expect(row.avgAccuracy).toBe(80);
    expect(row.avgLeftBookAtPly).toBe(8);
  });

  test('games with no opening group under Unknown', () => {
    const log = [game({ opening: null, eco: null })];
    const report = openingReportCard(log);
    expect(report[0].name).toBeNull();
    expect(report).toHaveLength(1);
  });

  test('empty log yields empty report', () => {
    expect(openingReportCard([])).toEqual([]);
  });
});

describe('overallStats', () => {
  test('handles an empty log honestly', () => {
    const stats = overallStats([]);
    expect(stats.games).toBe(0);
    expect(stats.avgAccuracy).toBeNull();
    expect(stats.blundersPerGame).toBeNull();
    expect(stats.halves).toBeNull();
  });

  test('computes totals and record', () => {
    const log = [
      game({ result: 'win', accuracy: 90, counts: { blunder: 0, mistake: 1, inaccuracy: 0 } }),
      game({ result: 'loss', accuracy: 70, counts: { blunder: 2, mistake: 0, inaccuracy: 0 } }),
      game({ result: 'draw', accuracy: 80, counts: { blunder: 1, mistake: 0, inaccuracy: 0 } }),
    ];
    const stats = overallStats(log);
    expect(stats.games).toBe(3);
    expect(stats.record).toEqual({ w: 1, l: 1, d: 1 });
    expect(stats.avgAccuracy).toBe(80);
    expect(stats.blundersPerGame).toBe(1);
  });

  test('excludes null-accuracy games from the mean rather than treating them as zero', () => {
    const log = [game({ accuracy: 100 }), game({ accuracy: null })];
    const stats = overallStats(log);
    expect(stats.avgAccuracy).toBe(100);
  });

  test('compares first vs second half of the log', () => {
    const log = [
      game({ accuracy: 60, counts: { blunder: 2, mistake: 0, inaccuracy: 0 } }),
      game({ accuracy: 62, counts: { blunder: 2, mistake: 0, inaccuracy: 0 } }),
      game({ accuracy: 90, counts: { blunder: 0, mistake: 0, inaccuracy: 0 } }),
      game({ accuracy: 92, counts: { blunder: 0, mistake: 0, inaccuracy: 0 } }),
    ];
    const stats = overallStats(log);
    expect(stats.halves.firstHalf.avgAccuracy).toBe(61);
    expect(stats.halves.secondHalf.avgAccuracy).toBe(91);
    expect(stats.halves.firstHalf.blundersPerGame).toBe(2);
    expect(stats.halves.secondHalf.blundersPerGame).toBe(0);
  });

  test('a single-game log still produces a halves comparison', () => {
    const stats = overallStats([game({ accuracy: 80 })]);
    expect(stats.halves).not.toBeNull();
    expect(stats.halves.firstHalf.games + stats.halves.secondHalf.games).toBe(1);
  });
});
