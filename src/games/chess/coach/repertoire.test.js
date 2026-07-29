import {
  REPERTOIRE_KEY,
  loadRepertoire,
  saveRepertoire,
  pinOpening,
  unpinOpening,
  isInRepertoire,
  suggestRepertoire,
  repertoireAdherence,
  deviationHint,
} from './repertoire.js';

function game({ color, opening = null, eco = null, result = 'win' }) {
  return { playedAt: Date.now(), result, color, opening, eco, accuracy: null, counts: {}, moves: [] };
}

describe('loadRepertoire / saveRepertoire', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty, well-formed repertoire when nothing is stored', () => {
    expect(loadRepertoire()).toEqual({ version: 1, white: [], black: [] });
  });

  it('never throws on corrupt JSON', () => {
    localStorage.setItem(REPERTOIRE_KEY, '{not json');
    expect(loadRepertoire()).toEqual({ version: 1, white: [], black: [] });
  });

  it('never throws when the stored shape is wrong', () => {
    localStorage.setItem(REPERTOIRE_KEY, JSON.stringify({ white: 'not-an-array', black: [] }));
    expect(loadRepertoire()).toEqual({ version: 1, white: [], black: [] });

    localStorage.setItem(REPERTOIRE_KEY, JSON.stringify(['array', 'not', 'object']));
    expect(loadRepertoire()).toEqual({ version: 1, white: [], black: [] });

    localStorage.setItem(REPERTOIRE_KEY, JSON.stringify(null));
    expect(loadRepertoire()).toEqual({ version: 1, white: [], black: [] });
  });

  it('filters non-string entries defensively', () => {
    localStorage.setItem(
      REPERTOIRE_KEY,
      JSON.stringify({ white: ['Italian Game', 42, null], black: [] })
    );
    expect(loadRepertoire().white).toEqual(['Italian Game']);
  });

  it('round-trips a saved repertoire', () => {
    const rep = { version: 1, white: ['Italian Game'], black: ['Sicilian Defense'] };
    saveRepertoire(rep);
    expect(loadRepertoire()).toEqual(rep);
  });

  it('save never throws even if localStorage.setItem throws', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded');
    };
    expect(() => saveRepertoire({ version: 1, white: [], black: [] })).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});

describe('pinOpening / unpinOpening / isInRepertoire', () => {
  it('pins a new opening', () => {
    const rep = { version: 1, white: [], black: [] };
    const next = pinOpening(rep, 'white', 'Italian Game');
    expect(next.white).toEqual(['Italian Game']);
    expect(next.black).toEqual([]);
    // original untouched
    expect(rep.white).toEqual([]);
  });

  it('pinning is idempotent (no duplicates)', () => {
    let rep = { version: 1, white: [], black: [] };
    rep = pinOpening(rep, 'white', 'Italian Game');
    rep = pinOpening(rep, 'white', 'Italian Game');
    expect(rep.white).toEqual(['Italian Game']);
  });

  it('unpins an existing opening', () => {
    let rep = { version: 1, white: ['Italian Game', 'Ruy Lopez'], black: [] };
    rep = unpinOpening(rep, 'white', 'Italian Game');
    expect(rep.white).toEqual(['Ruy Lopez']);
  });

  it('unpinning something absent is a no-op', () => {
    const rep = { version: 1, white: ['Ruy Lopez'], black: [] };
    const next = unpinOpening(rep, 'white', 'Sicilian Defense');
    expect(next.white).toEqual(['Ruy Lopez']);
  });

  it('isInRepertoire reports membership per colour', () => {
    const rep = { version: 1, white: ['Italian Game'], black: ['Sicilian Defense'] };
    expect(isInRepertoire(rep, 'white', 'Italian Game')).toBe(true);
    expect(isInRepertoire(rep, 'white', 'Sicilian Defense')).toBe(false);
    expect(isInRepertoire(rep, 'black', 'Sicilian Defense')).toBe(true);
  });

  it('isInRepertoire handles null/empty gracefully', () => {
    const rep = { version: 1, white: [], black: [] };
    expect(isInRepertoire(rep, 'white', null)).toBe(false);
    expect(isInRepertoire(rep, 'white', 'Anything')).toBe(false);
  });
});

describe('suggestRepertoire', () => {
  it('returns empty candidates for an empty log', () => {
    expect(suggestRepertoire([])).toEqual({ white: [], black: [] });
  });

  it('proposes openings meeting the minGames threshold, sorted most-played first', () => {
    const log = [
      ...Array(4).fill(game({ color: 'w', opening: 'Italian Game', eco: 'C50' })),
      ...Array(2).fill(game({ color: 'w', opening: 'Ruy Lopez', eco: 'C60' })),
      ...Array(1).fill(game({ color: 'w', opening: 'Scotch Game', eco: 'C44' })),
      ...Array(5).fill(game({ color: 'b', opening: 'Sicilian Defense', eco: 'B20' })),
    ];
    const result = suggestRepertoire(log, { minGames: 3 });
    expect(result.white).toEqual([{ name: 'Italian Game', eco: 'C50', games: 4 }]);
    expect(result.black).toEqual([{ name: 'Sicilian Defense', eco: 'B20', games: 5 }]);
  });

  it('sorts multiple qualifying openings by frequency descending', () => {
    const log = [
      ...Array(3).fill(game({ color: 'w', opening: 'Ruy Lopez', eco: 'C60' })),
      ...Array(6).fill(game({ color: 'w', opening: 'Italian Game', eco: 'C50' })),
    ];
    const result = suggestRepertoire(log, { minGames: 3 });
    expect(result.white.map((r) => r.name)).toEqual(['Italian Game', 'Ruy Lopez']);
  });

  it('ignores games with an unknown (null) opening', () => {
    const log = [
      ...Array(5).fill(game({ color: 'w', opening: null })),
      ...Array(3).fill(game({ color: 'w', opening: 'Italian Game', eco: 'C50' })),
    ];
    const result = suggestRepertoire(log, { minGames: 3 });
    expect(result.white).toEqual([{ name: 'Italian Game', eco: 'C50', games: 3 }]);
  });

  it('uses a sensible default minGames when not specified', () => {
    const log = [
      game({ color: 'w', opening: 'Italian Game', eco: 'C50' }),
      game({ color: 'w', opening: 'Italian Game', eco: 'C50' }),
    ];
    // Only 2 games played -- default threshold should not surface a single
    // one-off/two-off opening as a confident "you already play this" trend.
    expect(suggestRepertoire(log).white).toEqual([]);
  });
});

describe('repertoireAdherence', () => {
  it('reports null/zeroed shape when a colour has no pinned repertoire', () => {
    const rep = { version: 1, white: [], black: [] };
    const log = [game({ color: 'w', opening: 'Italian Game' })];
    const result = repertoireAdherence(log, rep);
    expect(result.white).toEqual({
      pinned: [],
      totalGames: 0,
      onPlanGames: 0,
      offPlanGames: 0,
      overallAdherencePct: null,
    });
  });

  it('reports null percentages when pinned but no games played as that colour', () => {
    const rep = { version: 1, white: ['Italian Game'], black: [] };
    const result = repertoireAdherence([], rep);
    expect(result.white).toEqual({
      pinned: [{ name: 'Italian Game', gamesReached: 0, pctOfGames: null }],
      totalGames: 0,
      onPlanGames: 0,
      offPlanGames: 0,
      overallAdherencePct: null,
    });
  });

  it('computes per-opening and overall adherence', () => {
    const rep = { version: 1, white: ['Italian Game', 'Ruy Lopez'], black: [] };
    const log = [
      game({ color: 'w', opening: 'Italian Game' }),
      game({ color: 'w', opening: 'Italian Game' }),
      game({ color: 'w', opening: 'Ruy Lopez' }),
      game({ color: 'w', opening: 'Scotch Game' }), // known but off-plan
      game({ color: 'b', opening: 'Italian Game' }), // wrong colour, ignored
    ];
    const result = repertoireAdherence(log, rep);
    expect(result.white.totalGames).toBe(4);
    expect(result.white.onPlanGames).toBe(3);
    expect(result.white.offPlanGames).toBe(1);
    expect(result.white.overallAdherencePct).toBe(75);
    expect(result.white.pinned).toEqual(
      expect.arrayContaining([
        { name: 'Italian Game', gamesReached: 2, pctOfGames: 50 },
        { name: 'Ruy Lopez', gamesReached: 1, pctOfGames: 25 },
      ])
    );
  });

  it('counts null/unknown openings as off-plan only when a pin exists for that colour', () => {
    const rep = { version: 1, white: ['Italian Game'], black: [] };
    const log = [
      game({ color: 'w', opening: 'Italian Game' }),
      game({ color: 'w', opening: null }),
      game({ color: 'b', opening: null }), // black has no pins -- see next assertion
    ];
    const white = repertoireAdherence(log, rep).white;
    expect(white.totalGames).toBe(2);
    expect(white.onPlanGames).toBe(1);
    expect(white.offPlanGames).toBe(1);

    // Black has no pinned repertoire, so its null-opening game contributes
    // nothing -- there is no plan to have deviated from.
    const black = repertoireAdherence(log, rep).black;
    expect(black).toEqual({
      pinned: [],
      totalGames: 0,
      onPlanGames: 0,
      offPlanGames: 0,
      overallAdherencePct: null,
    });
  });
});

describe('deviationHint', () => {
  it('is silent when the colour has no pinned repertoire', () => {
    const rep = { version: 1, white: [], black: [] };
    expect(deviationHint(rep, 'white', { name: 'Sicilian Defense' })).toBeNull();
  });

  it('is silent when the detected opening is unknown', () => {
    const rep = { version: 1, white: ['Italian Game'], black: [] };
    expect(deviationHint(rep, 'white', { name: null })).toBeNull();
    expect(deviationHint(rep, 'white', null)).toBeNull();
  });

  it('is silent when the detected opening IS in the repertoire', () => {
    const rep = { version: 1, white: ['Italian Game', 'Ruy Lopez'], black: [] };
    expect(deviationHint(rep, 'white', { name: 'Ruy Lopez' })).toBeNull();
  });

  it('names the deviation and the pinned plan when they differ', () => {
    const rep = { version: 1, white: ['Italian Game'], black: [] };
    const hint = deviationHint(rep, 'white', { name: 'Scotch Game' });
    expect(hint).toMatch(/Scotch Game/);
    expect(hint).toMatch(/Italian Game/);
  });

  it('lists multiple pinned choices in the hint', () => {
    const rep = { version: 1, white: ['Italian Game', 'Ruy Lopez'], black: [] };
    const hint = deviationHint(rep, 'white', { name: 'Scotch Game' });
    expect(hint).toMatch(/Italian Game/);
    expect(hint).toMatch(/Ruy Lopez/);
  });
});
