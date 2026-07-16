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
  test('tolerates null/undefined on either side', () => {
    expect(mergePuzzles(null, null)).toEqual({ v: 1, puzzles: {} });
    const local = { v: 1, puzzles: { p1: { a: 1, s: 0, t: 10 } } };
    expect(mergePuzzles(local, null)).toEqual(local);
    expect(mergePuzzles(null, local)).toEqual(local);
  });

  test('unions puzzle ids', () => {
    const local = { v: 1, puzzles: { p1: { a: 2, s: 1, t: 100 } } };
    const remote = { v: 1, puzzles: { p2: { a: 1, s: 0, t: 50 } } };
    const merged = mergePuzzles(local, remote);
    expect(merged.puzzles).toEqual({
      p1: { a: 2, s: 1, t: 100 },
      p2: { a: 1, s: 0, t: 50 },
    });
  });

  test('takes the per-field max on overlapping ids', () => {
    const local = { v: 1, puzzles: { p1: { a: 5, s: 1, t: 100 } } };
    const remote = { v: 1, puzzles: { p1: { a: 3, s: 2, t: 200 } } };
    const merged = mergePuzzles(local, remote);
    expect(merged.puzzles.p1).toEqual({ a: 5, s: 2, t: 200 });
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
