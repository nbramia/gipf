import {
  BOARD_CAP, BOARD_KEY, GAME_MODE_KEY, STANDARD_SETUP, addResult, bestFor, loadBoard, newSession,
  puzzlePoints, readGameMode, sprintKey, sprintLength, summarize, validRecord,
  withSkip, withSolve, writeGameMode,
} from './sprint.js';
import { scoreRound } from './scoring.js';
import { PROGRESS_KEYS } from '../../../account.js';

beforeEach(() => localStorage.clear());

const rec = (over = {}) => ({ at: 1000, points: 100, solved: 2, skipped: 0, avgQuality: 1, ...over });
const stored = () => JSON.parse(localStorage.getItem(BOARD_KEY));
const sum = (points, solved = 1, at) => ({ points, solved, skipped: 0, avgQuality: 1, ...(at ? { at } : {}) });

describe('difficulty ramp', () => {
  test('starts at 3, adds 1 per 2 solves, caps at 9', () => {
    const seq = [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 40].map(sprintLength);
    expect(seq).toEqual([3, 3, 4, 4, 5, 5, 8, 8, 9, 9, 9]);
  });
});

describe('points', () => {
  test('are round(100 x quality x pace) from scoreRound', () => {
    for (const input of [
      { optimal: 3, moves: 3, timeMs: 1000 },
      { optimal: 4, moves: 6, timeMs: 45000 },
      { optimal: 5, moves: 5, timeMs: 400000 },
      { optimal: 9, moves: 11, timeMs: 90000 },
    ]) {
      const r = scoreRound(input);
      expect(puzzlePoints(input).points).toBe(Math.round(100 * r.quality * r.pace));
    }
    expect(puzzlePoints({ optimal: 3, moves: 3, timeMs: 1000 }).points).toBe(100);
    expect(puzzlePoints({ optimal: 3, moves: 6, timeMs: 1000 }).points).toBe(50);
  });
});

describe('session summary', () => {
  test('counts solved and skipped, totals points, averages quality, finds the best puzzle and optimal solves', () => {
    let s = newSession();
    s = withSolve(s, { optimal: 3, moves: 3, timeMs: 1000 }); // 100
    s = withSkip(s);
    s = withSolve(s, { optimal: 3, moves: 6, timeMs: 1000 }); // 50
    s = withSkip(s);
    const out = summarize(s);
    expect(out).toMatchObject({ solved: 2, skipped: 2, points: 150, optimalCount: 1 });
    expect(out.avgQuality).toBeCloseTo(0.75);
    expect(out.best.points).toBe(100);
  });

  test('an empty session is all zeros', () => {
    expect(summarize(newSession())).toMatchObject({ solved: 0, skipped: 0, points: 0, avgQuality: 0, best: null, optimalCount: 0 });
  });
});

describe('leaderboard keys', () => {
  test('use the variant key scheme including input mode; the standard setup has a key too', () => {
    const std = { size: 16, fifthRobot: false, diagonals: false };
    expect(sprintKey(std, 'plan')).toBe(STANDARD_SETUP);
    expect(sprintKey(std, 'live')).toBe('16-r4-d0-live');
    expect(sprintKey({ size: 12, fifthRobot: true, diagonals: true }, 'plan')).toBe('12-r5-d1-plan');
  });
});

describe('leaderboard', () => {
  test('keeps the top 10 per setup, sorted by points, then more solved, then the earlier date', () => {
    const key = STANDARD_SETUP;
    for (let i = 0; i < 14; i++) addResult(key, sum(50 + i * 10, 3), 5000 + i);
    const list = loadBoard()[key];
    expect(list).toHaveLength(BOARD_CAP);
    expect(list.map(r => r.points)).toEqual([180, 170, 160, 150, 140, 130, 120, 110, 100, 90]);
    expect(stored()[key]).toHaveLength(BOARD_CAP);
  });

  test('ties go to more solved, then the earlier date', () => {
    const key = '12-r4-d0-live';
    addResult(key, sum(100, 3), 3000);
    addResult(key, sum(100, 4), 4000);
    addResult(key, sum(100, 3), 2000);
    addResult(key, sum(100, 4), 1000);
    const order = loadBoard()[key].map(r => [r.solved, r.at]);
    expect(order).toEqual([[4, 1000], [4, 4000], [3, 2000], [3, 3000]]);
  });

  test('setups are separate and a session that misses the top 10 changes nothing', () => {
    for (let i = 0; i < 10; i++) addResult('16-r4-d0-live', sum(200 + i, 2), i);
    addResult(STANDARD_SETUP, sum(10, 1), 1);
    const before = JSON.stringify(loadBoard());
    const miss = addResult('16-r4-d0-live', sum(5, 1), 99);
    expect(miss.rank).toBe(-1);
    expect(miss.newBest).toBe(false);
    expect(JSON.stringify(loadBoard())).toBe(before);
    expect(bestFor(loadBoard(), STANDARD_SETUP).points).toBe(10);
  });

  test('flags a new personal best only for the top spot, and not on an empty or tied-lower result', () => {
    expect(addResult(STANDARD_SETUP, sum(100, 3), 1).newBest).toBe(true); // first score on an empty board
    expect(addResult(STANDARD_SETUP, sum(90, 3), 2)).toMatchObject({ newBest: false, rank: 1 });
    expect(addResult(STANDARD_SETUP, sum(100, 3), 3)).toMatchObject({ newBest: false, rank: 1 }); // tie, later date
    expect(addResult(STANDARD_SETUP, sum(101, 1), 4)).toMatchObject({ newBest: true, rank: 0 });
  });

  test('a session with no solved puzzle is not recorded', () => {
    const out = addResult(STANDARD_SETUP, { points: 0, solved: 0, skipped: 4, avgQuality: 0 });
    expect(out.rank).toBe(-1);
    expect(localStorage.getItem(BOARD_KEY)).toBeNull();
  });

  test('an unknown setup key is not recorded', () => {
    expect(addResult('bogus', sum(100, 2)).rank).toBe(-1);
    expect(localStorage.getItem(BOARD_KEY)).toBeNull();
  });

  test.each([
    ['not json', '{nope'],
    ['null', 'null'],
    ['an array', '[1,2]'],
    ['a string', '"x"'],
    ['numbers', '42'],
  ])('corrupt storage (%s) reads as empty and can be written over', (_, raw) => {
    localStorage.setItem(BOARD_KEY, raw);
    expect(loadBoard()).toEqual({});
    addResult(STANDARD_SETUP, sum(120, 2), 7);
    expect(loadBoard()[STANDARD_SETUP]).toHaveLength(1);
  });

  test('bad setups and bad records inside valid storage are dropped, good ones kept', () => {
    localStorage.setItem(BOARD_KEY, JSON.stringify({
      [STANDARD_SETUP]: [
        rec({ points: 90 }),
        rec({ points: -1 }),
        rec({ points: 1.5 }),
        rec({ solved: '2' }),
        rec({ avgQuality: 2 }),
        rec({ at: NaN }),
        rec({ skipped: -3 }),
        null, 7, 'x', [],
        rec({ points: 95, extra: 'ignored' }),
      ],
      '16-r4-d0-live': 'not a list',
      '99-r4-d0-live': [rec()],
      '12-r5-d1-plan': [rec({ points: 10 })],
    }));
    const board = loadBoard();
    expect(Object.keys(board).sort()).toEqual(['12-r5-d1-plan', STANDARD_SETUP].sort());
    expect(board[STANDARD_SETUP].map(r => r.points)).toEqual([95, 90]);
    expect(board[STANDARD_SETUP][0]).toEqual({ at: 1000, points: 95, solved: 2, skipped: 0, avgQuality: 1 });
  });

  test('an oversized stored list is re-sorted and capped on load', () => {
    const many = Array.from({ length: 25 }, (_, i) => rec({ points: i, at: i }));
    localStorage.setItem(BOARD_KEY, JSON.stringify({ [STANDARD_SETUP]: many }));
    const list = loadBoard()[STANDARD_SETUP];
    expect(list).toHaveLength(BOARD_CAP);
    expect(list[0].points).toBe(24);
  });

  test('validRecord is strict', () => {
    expect(validRecord(rec())).toBe(true);
    expect(validRecord(rec({ avgQuality: -0.1 }))).toBe(false);
    expect(validRecord({})).toBe(false);
  });

  test('never touches the Classic rating or history keys', () => {
    addResult(STANDARD_SETUP, sum(100, 2), 1);
    expect(Object.keys(localStorage).sort()).toEqual([BOARD_KEY]);
  });
});

describe('storage keys', () => {
  test('the game mode defaults to classic and only accepts sprint', () => {
    expect(readGameMode()).toBe('classic');
    writeGameMode('sprint');
    expect(localStorage.getItem(GAME_MODE_KEY)).toBe('sprint');
    expect(readGameMode()).toBe('sprint');
    localStorage.setItem(GAME_MODE_KEY, 'bogus');
    expect(readGameMode()).toBe('classic');
  });

  test('both keys are account progress keys', () => {
    expect(PROGRESS_KEYS).toEqual(expect.arrayContaining(['ricochetGameMode', 'ricochetSprintBoard']));
  });
});
