// profileSync.test.js — pure merge functions (mergeHistory/mergePuzzles/
// mergeMistakes) and profileIdFromKey. Style mirrors rating.test.js.
//
// jsdom (this project's jest test environment) doesn't implement
// SubtleCrypto, so we polyfill globalThis.crypto with Node's built-in
// webcrypto for this test file only — production code (browsers) already
// has a native Web Crypto API.

import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { ratingIdFromKey } from './ratingSync.js';
import { profileIdFromKey, mergeHistory, mergePuzzles, mergeMistakes } from './profileSync.js';
import { MISTAKE_CAP } from '../coach/mistakeStore.js';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

describe('profileIdFromKey', () => {
  test('produces a 64-char hex id', async () => {
    const id = await profileIdFromKey('sk-ant-abc123');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  test('matches ratingIdFromKey for the same key (same namespace, so ratings carry over)', async () => {
    const key = 'sk-ant-shared-key';
    expect(await profileIdFromKey(key)).toBe(await ratingIdFromKey(key));
  });

  test('returns null for an empty or missing key', async () => {
    expect(await profileIdFromKey('')).toBeNull();
    expect(await profileIdFromKey(null)).toBeNull();
    expect(await profileIdFromKey(undefined)).toBeNull();
  });
});

describe('mergeHistory', () => {
  test('tolerates null/undefined on either side', () => {
    const empty = { v: 1, casual: {}, rated: {} };
    expect(mergeHistory(null, null)).toEqual(empty);
    expect(mergeHistory(undefined, undefined)).toEqual(empty);
    const local = { v: 1, casual: { easy: { w: 1, l: 0, d: 0 } }, rated: {} };
    expect(mergeHistory(local, null)).toEqual(local);
    expect(mergeHistory(null, local)).toEqual(local);
  });

  test('unions disjoint opponent keys', () => {
    const local = { v: 1, casual: { easy: { w: 1, l: 0, d: 0 } }, rated: {} };
    const remote = { v: 1, casual: { hard: { w: 0, l: 1, d: 0 } }, rated: {} };
    const merged = mergeHistory(local, remote);
    expect(merged.casual).toEqual({
      easy: { w: 1, l: 0, d: 0 },
      hard: { w: 0, l: 1, d: 0 },
    });
  });

  test('takes the per-counter max on overlapping keys', () => {
    const local = { v: 1, casual: {}, rated: { r1500: { w: 3, l: 1, d: 0 } } };
    const remote = { v: 1, casual: {}, rated: { r1500: { w: 2, l: 4, d: 1 } } };
    const merged = mergeHistory(local, remote);
    expect(merged.rated.r1500).toEqual({ w: 3, l: 4, d: 1 });
  });
});

describe('mergePuzzles', () => {
  const rec = (over = {}) => ({ attempts: 1, solves: 1, streak: 1, nextDueAt: 1000, lastResult: 'solved', ...over });

  test('tolerates null/undefined on either side', () => {
    expect(mergePuzzles(null, null)).toEqual({ rating: 1000, attempts: 0, puzzles: {} });
    const local = { rating: 1200, attempts: 5, puzzles: { p1: rec() } };
    expect(mergePuzzles(local, null)).toEqual(local);
    expect(mergePuzzles(null, local)).toEqual(local);
  });

  test('top level: more total attempts wins the (rating, attempts) pair', () => {
    const local = { rating: 1100, attempts: 3, puzzles: {} };
    const remote = { rating: 1300, attempts: 7, puzzles: {} };
    expect(mergePuzzles(local, remote)).toMatchObject({ rating: 1300, attempts: 7 });
    expect(mergePuzzles(remote, local)).toMatchObject({ rating: 1300, attempts: 7 });
  });

  test('top level tiebreak: equal attempts -> higher rating wins', () => {
    const local = { rating: 1400, attempts: 4, puzzles: {} };
    const remote = { rating: 1250, attempts: 4, puzzles: {} };
    expect(mergePuzzles(local, remote)).toMatchObject({ rating: 1400, attempts: 4 });
  });

  test('unions disjoint puzzle ids', () => {
    const local = { rating: 1000, attempts: 1, puzzles: { p1: rec() } };
    const remote = { rating: 1000, attempts: 1, puzzles: { p2: rec({ lastResult: 'failed' }) } };
    const merged = mergePuzzles(local, remote);
    expect(merged.puzzles).toEqual({
      p1: rec(),
      p2: rec({ lastResult: 'failed' }),
    });
  });

  test('conflict: attempts/solves take the per-field max', () => {
    const local = { rating: 1000, attempts: 1, puzzles: { p1: rec({ attempts: 5, solves: 1, nextDueAt: 1000 }) } };
    const remote = { rating: 1000, attempts: 1, puzzles: { p1: rec({ attempts: 3, solves: 2, nextDueAt: 1000 }) } };
    const merged = mergePuzzles(local, remote);
    expect(merged.puzzles.p1.attempts).toBe(5);
    expect(merged.puzzles.p1.solves).toBe(2);
  });

  test('conflict: scheduling fields travel as a unit from the later nextDueAt', () => {
    const local = { rating: 1000, attempts: 1, puzzles: { p1: rec({ streak: 1, nextDueAt: 1000, lastResult: 'failed' }) } };
    const remote = { rating: 1000, attempts: 1, puzzles: { p1: rec({ streak: 3, nextDueAt: 5000, lastResult: 'solved' }) } };
    const merged = mergePuzzles(local, remote);
    expect(merged.puzzles.p1).toMatchObject({ streak: 3, nextDueAt: 5000, lastResult: 'solved' });
  });

  test('conflict tiebreak: equal nextDueAt -> the entry with more attempts wins the scheduling unit', () => {
    const local = { rating: 1000, attempts: 1, puzzles: { p1: rec({ attempts: 2, streak: 1, nextDueAt: 1000, lastResult: 'failed' }) } };
    const remote = { rating: 1000, attempts: 1, puzzles: { p1: rec({ attempts: 5, streak: 4, nextDueAt: 1000, lastResult: 'solved' }) } };
    const merged = mergePuzzles(local, remote);
    expect(merged.puzzles.p1).toMatchObject({ streak: 4, nextDueAt: 1000, lastResult: 'solved' });
  });
});

describe('mergeMistakes', () => {
  const entry = (over = {}) => ({
    id: 'm1',
    fenBefore: 'fen-a',
    movePlayed: 'Ka2',
    bestSan: 'Kb2',
    bestPv: [],
    cpLoss: 100,
    classification: 'mistake',
    opening: null,
    moveNo: 10,
    createdAt: 1000,
    attempts: 0,
    streak: 0,
    nextDueAt: 1000,
    ...over,
  });

  test('tolerates null/undefined on either side', () => {
    expect(mergeMistakes(null, null)).toEqual([]);
    expect(mergeMistakes(undefined, undefined)).toEqual([]);
    const local = [entry()];
    expect(mergeMistakes(local, null)).toEqual(local);
    expect(mergeMistakes(null, local)).toEqual(local);
  });

  test('unions entries by fenBefore', () => {
    const local = [entry({ fenBefore: 'a' })];
    const remote = [entry({ fenBefore: 'b' })];
    const merged = mergeMistakes(local, remote);
    expect(merged.map((e) => e.fenBefore).sort()).toEqual(['a', 'b']);
  });

  test('conflict: higher attempts wins', () => {
    const local = [entry({ fenBefore: 'a', attempts: 3 })];
    const remote = [entry({ fenBefore: 'a', attempts: 5 })];
    expect(mergeMistakes(local, remote)).toHaveLength(1);
    expect(mergeMistakes(local, remote)[0].attempts).toBe(5);
    expect(mergeMistakes(remote, local)[0].attempts).toBe(5); // order-independent
  });

  test('conflict tiebreak: equal attempts -> higher nextDueAt wins', () => {
    const local = [entry({ fenBefore: 'a', attempts: 2, nextDueAt: 1000 })];
    const remote = [entry({ fenBefore: 'a', attempts: 2, nextDueAt: 2000 })];
    expect(mergeMistakes(local, remote)[0].nextDueAt).toBe(2000);
  });

  test('conflict tiebreak: equal attempts and nextDueAt -> higher createdAt wins', () => {
    const local = [entry({ fenBefore: 'a', attempts: 2, nextDueAt: 1000, createdAt: 500 })];
    const remote = [entry({ fenBefore: 'a', attempts: 2, nextDueAt: 1000, createdAt: 900 })];
    expect(mergeMistakes(local, remote)[0].createdAt).toBe(900);
  });

  test('enforces the 200 cap, evicting solved entries first', () => {
    const local = [];
    for (let i = 0; i < MISTAKE_CAP; i += 1) {
      local.push(entry({ fenBefore: `fen-${i}`, createdAt: i, nextDueAt: i }));
    }
    local[5] = { ...local[5], streak: 1 }; // mark solved -> preferred eviction victim
    const remote = [entry({ fenBefore: 'fen-new', createdAt: 999999, nextDueAt: 999999 })];
    const merged = mergeMistakes(local, remote);
    expect(merged).toHaveLength(MISTAKE_CAP);
    expect(merged.find((e) => e.fenBefore === 'fen-5')).toBeUndefined();
    expect(merged.find((e) => e.fenBefore === 'fen-0')).toBeTruthy(); // unsolved oldest kept
    expect(merged.find((e) => e.fenBefore === 'fen-new')).toBeTruthy();
  });
});
