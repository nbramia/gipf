import {
  recordRound, loadRating, loadHistory, validEntry, historyFor, setupsWithHistory, RATING_KEY, HISTORY_KEY,
} from './history.js';
import {
  VARIANT_KEY, VARIANT_RATINGS_KEY, parseVariant, readVariant, setupKey, setupLabel, isVariantKey,
} from './variants.js';

const ROUND = { optimal: 3, moves: 3, timeMs: 30000 };
const LIVE = '16-r4-d0-live';
const BIG = '12-r5-d1-plan';
const raw = (k) => localStorage.getItem(k);

beforeEach(() => localStorage.clear());

describe('setup keys', () => {
  test('the standard setup has no key; every other combination has a stable one', () => {
    expect(setupKey({ size: 16, fifthRobot: false, diagonals: false }, 'plan')).toBeNull();
    expect(setupKey({ size: 16, fifthRobot: false, diagonals: false }, 'live')).toBe('16-r4-d0-live');
    expect(setupKey({ size: 12, fifthRobot: false, diagonals: false }, 'plan')).toBe('12-r4-d0-plan');
    expect(setupKey({ size: 12, fifthRobot: true, diagonals: true }, 'plan')).toBe(BIG);
    expect(setupKey({ size: 16, fifthRobot: true, diagonals: false }, 'live')).toBe('16-r5-d0-live');
  });

  test('only well-formed non-standard keys are accepted', () => {
    expect(isVariantKey(LIVE)).toBe(true);
    for (const bad of ['16-r4-d0-plan', '', 'x', '20-r4-d0-plan', '16-r6-d0-live', '16-r4-d2-live', '16-r4-d0-sprint', null, 5, {}, '16-r4-d0-live ']) {
      expect(isVariantKey(bad)).toBe(false);
    }
  });

  test('labels name the setup', () => {
    expect(setupLabel(null)).toBe('Standard');
    expect(setupLabel(BIG)).toBe('12×12, black robot, barriers, Plan');
    expect(setupLabel(LIVE)).toBe('16×16, Live');
  });
});

describe('ricochetVariant', () => {
  test('a valid value round-trips; anything else is the default board', () => {
    localStorage.setItem(VARIANT_KEY, JSON.stringify({ size: 12, fifthRobot: true, diagonals: false }));
    expect(readVariant()).toEqual({ size: 12, fifthRobot: true, diagonals: false });
    const fallback = { size: 16, fifthRobot: false, diagonals: false };
    for (const bad of ['not json', '{"size":13,"fifthRobot":false,"diagonals":false}', '{"size":12}', '[1,2]', 'null', '"x"',
      '{"size":"12","fifthRobot":false,"diagonals":false}', '{"size":12,"fifthRobot":1,"diagonals":false}']) {
      localStorage.setItem(VARIANT_KEY, bad);
      expect(readVariant()).toEqual(fallback);
    }
    expect(parseVariant(undefined)).toEqual(fallback);
  });
});

describe('per-setup rating and history', () => {
  test('a standard round records into ricochetRating and ricochetHistory with no variant field', () => {
    const entry = recordRound(ROUND);
    expect(entry).not.toHaveProperty('variant');
    expect(JSON.parse(raw(RATING_KEY))).toEqual({ rating: entry.ratingAfter, rounds: 1 });
    expect(raw(VARIANT_RATINGS_KEY)).toBeNull();
    const h = JSON.parse(raw(HISTORY_KEY));
    expect(h).toHaveLength(1);
    expect('variant' in h[0]).toBe(false);
    expect(loadRating()).toEqual({ rating: entry.ratingAfter, rounds: 1 });
  });

  test('a variant round records only into its own key and never changes the standard rating', () => {
    recordRound(ROUND);
    const standardBefore = raw(RATING_KEY);
    const entry = recordRound({ ...ROUND, variant: LIVE });
    expect(entry.variant).toBe(LIVE);
    expect(entry.ratingBefore).toBe(1200); // starts from the default, not the standard rating
    expect(raw(RATING_KEY)).toBe(standardBefore);
    expect(JSON.parse(raw(VARIANT_RATINGS_KEY))).toEqual({ [LIVE]: { rating: entry.ratingAfter, rounds: 1 } });
    expect(loadRating(LIVE).rounds).toBe(1);
    expect(loadRating(BIG)).toEqual({ rating: 1200, rounds: 0 });
    // each setup continues from its own rating
    const second = recordRound({ ...ROUND, variant: LIVE });
    expect(second.ratingBefore).toBe(entry.ratingAfter);
    expect(raw(RATING_KEY)).toBe(standardBefore);
    expect(loadHistory()).toHaveLength(3);
  });

  test('a standard round does not touch a variant rating', () => {
    recordRound({ ...ROUND, variant: BIG });
    const before = raw(VARIANT_RATINGS_KEY);
    recordRound(ROUND);
    expect(raw(VARIANT_RATINGS_KEY)).toBe(before);
  });

  test('an unknown variant key records nothing', () => {
    expect(recordRound({ ...ROUND, variant: '16-r4-d0-plan' })).toBeNull();
    expect(recordRound({ ...ROUND, variant: 'junk' })).toBeNull();
    expect(raw(RATING_KEY)).toBeNull();
    expect(raw(VARIANT_RATINGS_KEY)).toBeNull();
    expect(raw(HISTORY_KEY)).toBeNull();
  });

  test('entries without a variant stay valid; a bad variant field is rejected', () => {
    const entry = recordRound(ROUND);
    expect(validEntry(entry)).toBe(true);
    const variantEntry = recordRound({ ...ROUND, variant: LIVE });
    expect(validEntry(variantEntry)).toBe(true);
    for (const bad of ['16-r4-d0-plan', 'x', 5, null, '', '16-r4-d0-live\n']) {
      expect(validEntry({ ...entry, variant: bad })).toBe(false);
    }
  });

  test('corrupt ricochetVariantRatings falls back to a fresh rating, keeping the valid entries', () => {
    for (const bad of ['not json', '[1]', 'null', '"x"', '5']) {
      localStorage.setItem(VARIANT_RATINGS_KEY, bad);
      expect(loadRating(LIVE)).toEqual({ rating: 1200, rounds: 0 });
    }
    localStorage.setItem(VARIANT_RATINGS_KEY, JSON.stringify({
      [LIVE]: { rating: 1310, rounds: 4 },
      [BIG]: { rating: 'high', rounds: 1 },
      '16-r4-d0-plan': { rating: 1500, rounds: 9 },
      junk: { rating: 1500, rounds: 9 },
      '12-r4-d0-live': { rating: 50, rounds: 2 },
    }));
    expect(loadRating(LIVE)).toEqual({ rating: 1310, rounds: 4 });
    expect(loadRating(BIG)).toEqual({ rating: 1200, rounds: 0 });
    expect(loadRating('12-r4-d0-live')).toEqual({ rating: 1200, rounds: 0 });
    expect(loadRating()).toEqual({ rating: 1200, rounds: 0 }); // the standard rating is not in that map
    // recording over a corrupt map repairs it
    recordRound({ ...ROUND, variant: BIG });
    expect(Object.keys(JSON.parse(raw(VARIANT_RATINGS_KEY))).sort()).toEqual([LIVE, BIG].sort());
  });

  test('history and setups are split by variant', () => {
    recordRound(ROUND);
    recordRound({ ...ROUND, variant: LIVE });
    recordRound({ ...ROUND, variant: BIG });
    recordRound({ ...ROUND, variant: LIVE });
    const h = loadHistory();
    expect(historyFor(h, null)).toHaveLength(1);
    expect(historyFor(h, LIVE)).toHaveLength(2);
    expect(historyFor(h, BIG)).toHaveLength(1);
    expect(setupsWithHistory(h)).toEqual([null, BIG, LIVE]);
    expect(setupsWithHistory([])).toEqual([]);
  });
});

describe('the history cap is per setup', () => {
  const seed = (variant, n, at0 = 0) => {
    const base = recordRound({ ...ROUND, variant });
    localStorage.removeItem(HISTORY_KEY);
    return Array.from({ length: n }, (_, i) => ({ ...base, at: at0 + i, ...(variant ? { variant } : {}) }));
  };
  const store = (entries) => localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));

  test('playing variants never pushes standard entries out', () => {
    const standard = seed(null, 500);
    const live = seed(LIVE, 500, 1000);
    store([...standard, ...live]);
    expect(loadHistory()).toHaveLength(1000);
    recordRound({ ...ROUND, variant: LIVE, at: 5000 });
    const h = loadHistory();
    expect(historyFor(h, null)).toHaveLength(500);
    expect(historyFor(h, null)[0].at).toBe(0); // the oldest standard entry is still there
    expect(historyFor(h, LIVE)).toHaveLength(500);
    expect(historyFor(h, LIVE)[0].at).toBe(1001); // only the oldest Live entry went
    expect(historyFor(h, LIVE).slice(-1)[0].at).toBe(5000);
  });

  test('a standard setup over the cap drops its own oldest entries only', () => {
    store([...seed(null, 500), ...seed(LIVE, 3, 1000)]);
    recordRound({ ...ROUND, at: 9000 });
    const h = loadHistory();
    expect(historyFor(h, null)).toHaveLength(500);
    expect(historyFor(h, null)[0].at).toBe(1);
    expect(historyFor(h, LIVE)).toHaveLength(3);
  });
});
