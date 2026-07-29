// puzzleProgress.test.js — player puzzle Elo, per-puzzle spaced repetition,
// adaptive session selection, and localStorage round-tripping (#24).

import { DEFAULT_RATING } from '../engine/rating.js';
import { REVIEW_INTERVALS_MS } from './mistakeStore.js';
import {
  PUZZLE_PROGRESS_KEY,
  loadProgress,
  saveProgress,
  recordPuzzleResult,
  selectSession,
  dueCount,
} from './puzzleProgress.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const puzzle = (id, rating, theme) => ({ id, rating, fen: 'x', mateIn: 1, ...(theme ? { theme } : {}) });

const fresh = () => ({ rating: DEFAULT_RATING, attempts: 0, puzzles: {} });

describe('recordPuzzleResult', () => {
  test('a solve raises the rating, a miss lowers it', () => {
    const up = recordPuzzleResult(fresh(), puzzle('a', 1000), true, NOW);
    expect(up.rating).toBeGreaterThan(DEFAULT_RATING);
    const down = recordPuzzleResult(fresh(), puzzle('a', 1000), false, NOW);
    expect(down.rating).toBeLessThan(DEFAULT_RATING);
    expect(up.attempts).toBe(1);
  });

  test('beating a much stronger puzzle earns more than a weak one', () => {
    const strong = recordPuzzleResult(fresh(), puzzle('s', 1800), true, NOW);
    const weak = recordPuzzleResult(fresh(), puzzle('w', 600), true, NOW);
    expect(strong.rating - DEFAULT_RATING).toBeGreaterThan(weak.rating - DEFAULT_RATING);
  });

  test('solves walk the 1d/3d/7d ladder; a miss resets and stays due', () => {
    let p = fresh();
    p = recordPuzzleResult(p, puzzle('a', 1000), true, NOW);
    expect(p.puzzles.a.streak).toBe(1);
    expect(p.puzzles.a.nextDueAt).toBe(NOW + REVIEW_INTERVALS_MS[0]);
    p = recordPuzzleResult(p, puzzle('a', 1000), true, NOW + DAY);
    expect(p.puzzles.a.nextDueAt).toBe(NOW + DAY + REVIEW_INTERVALS_MS[1]);
    p = recordPuzzleResult(p, puzzle('a', 1000), false, NOW + 5 * DAY);
    expect(p.puzzles.a.streak).toBe(0);
    expect(p.puzzles.a.nextDueAt).toBe(NOW + 5 * DAY);
    expect(p.puzzles.a.attempts).toBe(3);
    expect(p.puzzles.a.solves).toBe(2);
    expect(p.puzzles.a.lastResult).toBe('failed');
  });
});

describe('selectSession', () => {
  test('due reviews lead (longest overdue first), then fresh nearest rating', () => {
    let p = { rating: 1200, attempts: 30, puzzles: {} };
    p = recordPuzzleResult(p, puzzle('due-late', 900), true, NOW - 10 * DAY); // overdue
    p = recordPuzzleResult(p, puzzle('due-early', 900), true, NOW - 12 * DAY); // more overdue
    p = recordPuzzleResult(p, puzzle('scheduled', 900), true, NOW - 1000); // not due yet

    const bank = [
      puzzle('far', 2000),
      puzzle('near', 1250),
      puzzle('due-late', 900),
      puzzle('scheduled', 900),
      puzzle('due-early', 900),
      puzzle('mid', 1500),
    ];
    const session = selectSession(p, bank, NOW);
    expect(session.map((x) => x.id)).toEqual(['due-early', 'due-late', 'near', 'mid', 'far']);
  });

  test('respects the session size cap', () => {
    const bank = Array.from({ length: 30 }, (_, i) => puzzle(`p${i}`, 1000 + i));
    expect(selectSession(fresh(), bank, NOW, 10)).toHaveLength(10);
  });

  test('options.themes restricts the pool while preserving due-first ordering', () => {
    let p = { rating: 1200, attempts: 30, puzzles: {} };
    p = recordPuzzleResult(p, puzzle('due-fork', 900, 'fork'), true, NOW - 10 * DAY); // overdue, fork
    p = recordPuzzleResult(p, puzzle('due-pin', 900, 'pin'), true, NOW - 12 * DAY); // more overdue, pin

    const bank = [
      puzzle('fresh-fork', 1250, 'fork'),
      puzzle('fresh-pin', 1250, 'pin'),
      puzzle('due-fork', 900, 'fork'),
      puzzle('due-pin', 900, 'pin'),
    ];
    const session = selectSession(p, bank, NOW, 10, { themes: ['Fork'] });
    expect(session.map((x) => x.id)).toEqual(['due-fork', 'fresh-fork']);
  });

  test('omitting options.themes leaves behavior identical to the positional call', () => {
    const bank = [puzzle('a', 1000, 'fork'), puzzle('b', 1100, 'pin')];
    expect(selectSession(fresh(), bank, NOW, 10)).toEqual(selectSession(fresh(), bank, NOW, 10, {}));
  });

  test('a theme filter matching nothing returns an empty session, not a fallback', () => {
    const bank = [puzzle('a', 1000, 'fork'), puzzle('b', 1100, 'pin')];
    expect(selectSession(fresh(), bank, NOW, 10, { themes: ['Skewer'] })).toEqual([]);
  });

  test('dueCount counts only seen-and-due puzzles', () => {
    let p = fresh();
    p = recordPuzzleResult(p, puzzle('a', 1000), false, NOW); // due now
    p = recordPuzzleResult(p, puzzle('b', 1000), true, NOW); // due in a day
    const bank = [puzzle('a', 1000), puzzle('b', 1000), puzzle('c', 1000)];
    expect(dueCount(p, bank, NOW)).toBe(1);
    expect(dueCount(p, bank, NOW + 2 * DAY)).toBe(2);
  });
});

describe('persistence', () => {
  afterEach(() => localStorage.removeItem(PUZZLE_PROGRESS_KEY));

  test('round-trips and survives junk', () => {
    const p = recordPuzzleResult(fresh(), puzzle('a', 1000), true, NOW);
    saveProgress(p);
    expect(loadProgress()).toEqual(p);

    localStorage.setItem(PUZZLE_PROGRESS_KEY, 'not json');
    expect(loadProgress()).toEqual(fresh());
    localStorage.setItem(PUZZLE_PROGRESS_KEY, '{"rating":"oops"}');
    expect(loadProgress()).toEqual(fresh());
  });
});
