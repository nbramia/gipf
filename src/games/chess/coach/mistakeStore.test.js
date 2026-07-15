// mistakeStore.test.js — the persistent mistake library (#23): capture/dedupe,
// the 200-entry cap with solved-first eviction, the 1d/3d/7d review scheduler,
// drill correctness, the weakness profile, and localStorage round-tripping.

import {
  MISTAKE_STORAGE_KEY,
  MISTAKE_CAP,
  REVIEW_INTERVALS_MS,
  DRILL_CP_TOLERANCE,
  loadMistakes,
  saveMistakes,
  captureMistake,
  recordAttempt,
  dueMistakes,
  drillMoveCorrect,
  phaseOf,
  weaknessProfile,
} from './mistakeStore.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const sample = (over = {}) => ({
  fenBefore: over.fenBefore || `8/8/8/8/8/8/8/K6k w - - 0 ${over.moveNo || 1}`,
  movePlayed: 'Ka2',
  bestSan: 'Kb2',
  bestPv: ['Kb2', 'Kg2'],
  cpLoss: 180,
  classification: 'mistake',
  opening: null,
  moveNo: 12,
  ...over,
});

describe('captureMistake', () => {
  test('adds a new entry due immediately with fresh counters', () => {
    const { list, entry } = captureMistake([], sample(), NOW);
    expect(list).toHaveLength(1);
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBe(NOW);
    expect(entry.attempts).toBe(0);
    expect(entry.streak).toBe(0);
    expect(entry.nextDueAt).toBe(NOW);
  });

  test('dedupes by FEN: updates move data, resets streak, keeps attempts', () => {
    let { list } = captureMistake([], sample(), NOW);
    list = recordAttempt(list, list[0].id, true, NOW); // solved once
    expect(list[0].streak).toBe(1);

    const again = captureMistake(list, sample({ movePlayed: 'Kb1', cpLoss: 320, classification: 'blunder' }), NOW + 1000);
    expect(again.list).toHaveLength(1);
    expect(again.entry.id).toBe(list[0].id);
    expect(again.entry.movePlayed).toBe('Kb1');
    expect(again.entry.classification).toBe('blunder');
    expect(again.entry.attempts).toBe(1); // history kept
    expect(again.entry.streak).toBe(0); // lesson didn't stick — due again
    expect(again.entry.nextDueAt).toBe(NOW + 1000);
  });

  test('caps the library, evicting oldest solved entries first', () => {
    let list = [];
    for (let i = 0; i < MISTAKE_CAP; i += 1) {
      list = captureMistake(list, sample({ fenBefore: `fen-${i}` }), NOW + i).list;
    }
    // Solve an old-ish entry so it becomes the preferred eviction victim.
    const solvedId = list[5].id;
    list = recordAttempt(list, solvedId, true, NOW);

    const { list: next } = captureMistake(list, sample({ fenBefore: 'fen-new' }), NOW + 10_000);
    expect(next).toHaveLength(MISTAKE_CAP);
    expect(next.find((e) => e.id === solvedId)).toBeUndefined(); // solved evicted
    expect(next.find((e) => e.fenBefore === 'fen-0')).toBeTruthy(); // unsolved oldest kept
    expect(next.find((e) => e.fenBefore === 'fen-new')).toBeTruthy();
  });

  test('caps by evicting the oldest overall when nothing is solved', () => {
    let list = [];
    for (let i = 0; i < MISTAKE_CAP; i += 1) {
      list = captureMistake(list, sample({ fenBefore: `fen-${i}` }), NOW + i).list;
    }
    const { list: next } = captureMistake(list, sample({ fenBefore: 'fen-new' }), NOW + 10_000);
    expect(next).toHaveLength(MISTAKE_CAP);
    expect(next.find((e) => e.fenBefore === 'fen-0')).toBeUndefined();
  });
});

describe('recordAttempt scheduling', () => {
  test('successes walk the 1d → 3d → 7d ladder and stick at 7d', () => {
    let { list } = captureMistake([], sample(), NOW);
    const id = list[0].id;

    list = recordAttempt(list, id, true, NOW);
    expect(list[0].streak).toBe(1);
    expect(list[0].nextDueAt).toBe(NOW + REVIEW_INTERVALS_MS[0]);

    list = recordAttempt(list, id, true, NOW + DAY);
    expect(list[0].streak).toBe(2);
    expect(list[0].nextDueAt).toBe(NOW + DAY + REVIEW_INTERVALS_MS[1]);

    list = recordAttempt(list, id, true, NOW + 4 * DAY);
    expect(list[0].streak).toBe(3);
    expect(list[0].nextDueAt).toBe(NOW + 4 * DAY + REVIEW_INTERVALS_MS[2]);

    list = recordAttempt(list, id, true, NOW + 11 * DAY);
    expect(list[0].streak).toBe(4);
    expect(list[0].nextDueAt).toBe(NOW + 11 * DAY + REVIEW_INTERVALS_MS[2]); // stays 7d
  });

  test('a miss resets the streak and keeps the entry due now', () => {
    let { list } = captureMistake([], sample(), NOW);
    const id = list[0].id;
    list = recordAttempt(list, id, true, NOW);
    list = recordAttempt(list, id, false, NOW + DAY);
    expect(list[0].streak).toBe(0);
    expect(list[0].attempts).toBe(2);
    expect(list[0].nextDueAt).toBe(NOW + DAY);
  });

  test('leaves other entries untouched', () => {
    let list = captureMistake([], sample({ fenBefore: 'a' }), NOW).list;
    list = captureMistake(list, sample({ fenBefore: 'b' }), NOW).list;
    const next = recordAttempt(list, list[0].id, true, NOW);
    expect(next[1]).toEqual(list[1]);
  });
});

describe('dueMistakes', () => {
  test('returns only due entries, longest-overdue first', () => {
    let list = captureMistake([], sample({ fenBefore: 'a' }), NOW).list;
    list = captureMistake(list, sample({ fenBefore: 'b' }), NOW + 5).list;
    list = captureMistake(list, sample({ fenBefore: 'c' }), NOW + 10).list;
    // Solve 'a' so it's scheduled out a day.
    list = recordAttempt(list, list.find((e) => e.fenBefore === 'a').id, true, NOW + 20);

    const due = dueMistakes(list, NOW + 100);
    expect(due.map((e) => e.fenBefore)).toEqual(['b', 'c']);

    const later = dueMistakes(list, NOW + 20 + DAY);
    expect(later.map((e) => e.fenBefore)).toEqual(['b', 'c', 'a']);
  });
});

describe('drillMoveCorrect', () => {
  test('the stored best move always counts, even with no analysis', () => {
    expect(drillMoveCorrect({ bestSan: 'Nf3', playedSan: 'Nf3' })).toBe(true);
  });
  test('another move counts only inside the centipawn tolerance', () => {
    expect(drillMoveCorrect({ bestSan: 'Nf3', playedSan: 'Nc3', cpLoss: DRILL_CP_TOLERANCE - 1 })).toBe(true);
    expect(drillMoveCorrect({ bestSan: 'Nf3', playedSan: 'Nc3', cpLoss: DRILL_CP_TOLERANCE })).toBe(false);
    expect(drillMoveCorrect({ bestSan: 'Nf3', playedSan: 'Nc3' })).toBe(false); // no analysis, no credit
  });
});

describe('weaknessProfile', () => {
  test('stays quiet until there is a real pattern', () => {
    const { list } = captureMistake([], sample(), NOW);
    expect(weaknessProfile([])).toBe('');
    expect(weaknessProfile(list)).toBe('');
  });

  test('summarizes counts, dominant phase, and a repeated opening', () => {
    let list = [];
    list = captureMistake(list, sample({ fenBefore: 'a', classification: 'blunder', moveNo: 18, opening: 'Italian Game' }), NOW).list;
    list = captureMistake(list, sample({ fenBefore: 'b', classification: 'mistake', moveNo: 22, opening: 'Italian Game' }), NOW).list;
    list = captureMistake(list, sample({ fenBefore: 'c', classification: 'blunder', moveNo: 25, opening: null }), NOW).list;

    const line = weaknessProfile(list);
    expect(line).toContain('2 blunders');
    expect(line).toContain('1 mistake');
    expect(line).toContain('middlegame');
    expect(line).toContain('Italian Game');
  });

  test('phaseOf buckets by move number', () => {
    expect(phaseOf(5)).toBe('opening');
    expect(phaseOf(20)).toBe('middlegame');
    expect(phaseOf(40)).toBe('endgame');
  });
});

describe('localStorage persistence', () => {
  afterEach(() => localStorage.removeItem(MISTAKE_STORAGE_KEY));

  test('round-trips the library and survives junk', () => {
    const { list } = captureMistake([], sample(), NOW);
    saveMistakes(list);
    expect(loadMistakes()).toEqual(list);

    localStorage.setItem(MISTAKE_STORAGE_KEY, 'not json');
    expect(loadMistakes()).toEqual([]);
    localStorage.setItem(MISTAKE_STORAGE_KEY, '{"nope":1}');
    expect(loadMistakes()).toEqual([]);
  });
});
