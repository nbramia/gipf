// playerHistory.test.js — opponent-record and puzzle-progress stores:
// malformed-JSON recovery, result/attempt accumulation, formatting, and
// localStorage round-tripping. Style mirrors coach/mistakeStore.test.js.

import {
  OPP_HISTORY_KEY,
  PUZZLE_PROGRESS_KEY,
  loadOppHistory,
  saveOppHistory,
  recordGameResult,
  formatRecord,
  loadPuzzleProgress,
  savePuzzleProgress,
  recordPuzzleAttempt,
} from './playerHistory.js';

describe('loadOppHistory', () => {
  afterEach(() => localStorage.removeItem(OPP_HISTORY_KEY));

  test('returns an empty structure when nothing is stored', () => {
    expect(loadOppHistory()).toEqual({ v: 1, casual: {}, rated: {} });
  });

  test('recovers from malformed JSON', () => {
    localStorage.setItem(OPP_HISTORY_KEY, 'not json');
    expect(loadOppHistory()).toEqual({ v: 1, casual: {}, rated: {} });
  });

  test('recovers from valid JSON in the wrong shape', () => {
    localStorage.setItem(OPP_HISTORY_KEY, '{"nope":1}');
    expect(loadOppHistory()).toEqual({ v: 1, casual: {}, rated: {} });
  });
});

describe('recordGameResult', () => {
  test('accumulates casual results per opponent key', () => {
    let h = loadOppHistory();
    h = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'win' });
    h = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'win' });
    h = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'loss' });
    expect(h.casual.easy).toEqual({ w: 2, l: 1, d: 0 });
    expect(h.rated).toEqual({});
  });

  test('keeps rated and casual buckets independent for the same key', () => {
    let h = loadOppHistory();
    h = recordGameResult(h, { rated: true, opponentKey: '1500', result: 'draw' });
    h = recordGameResult(h, { rated: false, opponentKey: '1500', result: 'win' });
    expect(h.rated['1500']).toEqual({ w: 0, l: 0, d: 1 });
    expect(h.casual['1500']).toEqual({ w: 1, l: 0, d: 0 });
  });

  test('does not mutate the input history', () => {
    const h = loadOppHistory();
    const next = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'win' });
    expect(h.casual).toEqual({});
    expect(next).not.toBe(h);
  });
});

describe('formatRecord', () => {
  test('returns null when there are no games yet', () => {
    const h = loadOppHistory();
    expect(formatRecord(h, false, 'easy')).toBeNull();
  });

  test('formats wins-losses-draws', () => {
    let h = loadOppHistory();
    h = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'win' });
    h = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'win' });
    h = recordGameResult(h, { rated: false, opponentKey: 'easy', result: 'draw' });
    expect(formatRecord(h, false, 'easy')).toBe('2W-0L-1D');
  });
});

describe('puzzle progress', () => {
  afterEach(() => localStorage.removeItem(PUZZLE_PROGRESS_KEY));

  test('loadPuzzleProgress returns an empty structure on missing/malformed data', () => {
    expect(loadPuzzleProgress()).toEqual({ v: 1, puzzles: {} });
    localStorage.setItem(PUZZLE_PROGRESS_KEY, 'not json');
    expect(loadPuzzleProgress()).toEqual({ v: 1, puzzles: {} });
    localStorage.setItem(PUZZLE_PROGRESS_KEY, '{"nope":1}');
    expect(loadPuzzleProgress()).toEqual({ v: 1, puzzles: {} });
  });

  test('recordPuzzleAttempt increments attempts, solves when solved, and stamps time', () => {
    let p = loadPuzzleProgress();
    p = recordPuzzleAttempt(p, 'puz1', false, 1000);
    expect(p.puzzles.puz1).toEqual({ a: 1, s: 0, t: 1000 });
    p = recordPuzzleAttempt(p, 'puz1', true, 2000);
    expect(p.puzzles.puz1).toEqual({ a: 2, s: 1, t: 2000 });
  });

  test('does not mutate the input progress object', () => {
    const p = loadPuzzleProgress();
    const next = recordPuzzleAttempt(p, 'puz1', true, 500);
    expect(p.puzzles).toEqual({});
    expect(next).not.toBe(p);
  });
});

describe('localStorage persistence', () => {
  afterEach(() => {
    localStorage.removeItem(OPP_HISTORY_KEY);
    localStorage.removeItem(PUZZLE_PROGRESS_KEY);
  });

  test('opponent history round-trips through localStorage', () => {
    let h = loadOppHistory();
    h = recordGameResult(h, { rated: true, opponentKey: '2000', result: 'loss' });
    saveOppHistory(h);
    expect(loadOppHistory()).toEqual(h);
  });

  test('puzzle progress round-trips through localStorage', () => {
    let p = loadPuzzleProgress();
    p = recordPuzzleAttempt(p, 'puz1', true, 500);
    savePuzzleProgress(p);
    expect(loadPuzzleProgress()).toEqual(p);
  });
});
