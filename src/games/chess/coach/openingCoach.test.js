import { summarizeBookMove, describeBookMove, OPENING_MAX_PLY } from './openingCoach';

// Sample shaped like the Lichess masters explorer response after 1.e4
// (Black to move). Numbers are illustrative but in the real format.
const statsAfterE4 = {
  white: 17056,
  draws: 16201,
  black: 7510,
  moves: [
    { uci: 'c7c5', san: 'c5', white: 4988, draws: 5673, black: 2484 },
    { uci: 'e7e5', san: 'e5', white: 4422, draws: 4470, black: 2235 },
    { uci: 'e7e6', san: 'e6', white: 2100, draws: 1900, black: 900 },
    { uci: 'c7c6', san: 'c6', white: 1500, draws: 1400, black: 700 },
  ],
};

describe('openingCoach — summarizeBookMove', () => {
  test('recognizes a popular master move and ranks it', () => {
    // Black plays c5 (most popular here).
    const b = summarizeBookMove(statsAfterE4, 'c5', 'b');
    expect(b).not.toBeNull();
    expect(b.isBook).toBe(true);
    expect(b.rank).toBe(1);
    expect(b.games).toBe(4988 + 5673 + 2484);
    // Black's score = (black wins + half draws) / games.
    expect(b.scorePct).toBeGreaterThan(0);
    expect(b.scorePct).toBeLessThan(100);
  });

  test('a sound but less common move is still book, with a higher rank number', () => {
    const b = summarizeBookMove(statsAfterE4, 'c6', 'b'); // Caro-Kann, 4th here
    expect(b.isBook).toBe(true);
    expect(b.rank).toBe(4);
  });

  test('lists the other popular alternatives', () => {
    const b = summarizeBookMove(statsAfterE4, 'e5', 'b');
    const altSans = b.alternatives.map((a) => a.san);
    expect(altSans).toContain('c5');
    expect(altSans).not.toContain('e5'); // not itself
    expect(b.alternatives.length).toBeLessThanOrEqual(3);
  });

  test('returns null for a move not in the masters DB', () => {
    expect(summarizeBookMove(statsAfterE4, 'Na6', 'b')).toBeNull();
  });

  test('returns null for a move below the games threshold', () => {
    const sparse = { white: 10, draws: 0, black: 0, moves: [{ san: 'h6', white: 2, draws: 0, black: 0 }] };
    expect(summarizeBookMove(sparse, 'h6', 'b')).toBeNull();
  });

  test('handles empty / malformed stats safely', () => {
    expect(summarizeBookMove(null, 'e5', 'b')).toBeNull();
    expect(summarizeBookMove({ moves: [] }, 'e5', 'b')).toBeNull();
  });
});

describe('openingCoach — ranks by game count, not array order', () => {
  // Mirrors real Lichess behavior: a more-popular move can appear later in the
  // array (after 1.e4, e5 is listed before c5 despite c5 having more games).
  const unsorted = {
    white: 100, draws: 100, black: 100,
    moves: [
      { san: 'e5', white: 30, draws: 30, black: 30 }, // 90 games, listed first
      { san: 'c5', white: 40, draws: 40, black: 40 }, // 120 games, listed second
    ],
  };
  test('the higher-game-count move is rank 1 even if listed second', () => {
    expect(summarizeBookMove(unsorted, 'c5', 'b').rank).toBe(1);
    expect(summarizeBookMove(unsorted, 'e5', 'b').rank).toBe(2);
  });
});

describe('openingCoach — score perspective', () => {
  test('white and black scores of the same move are complementary', () => {
    const stats = {
      white: 100, draws: 0, black: 100,
      moves: [{ san: 'd5', white: 60, draws: 20, black: 20 }],
    };
    const w = summarizeBookMove(stats, 'd5', 'w').scorePct; // (60+10)/100 = 70
    const b = summarizeBookMove(stats, 'd5', 'b').scorePct; // (20+10)/100 = 30
    expect(w).toBe(70);
    expect(b).toBe(30);
  });
});

describe('openingCoach — describeBookMove', () => {
  test('produces engine-grounded prose with rank, share and alternatives', () => {
    const b = summarizeBookMove(statsAfterE4, 'c5', 'b');
    const text = describeBookMove('c5', 'Sicilian Defense', b);
    expect(text).toMatch(/Book/);
    expect(text).toMatch(/Sicilian Defense/);
    expect(text).toMatch(/master games/);
    expect(text).toMatch(/most popular/);
  });

  test('empty for a non-book move', () => {
    expect(describeBookMove('Na6', null, null)).toBe('');
  });
});

describe('openingCoach — constants', () => {
  test('opening depth is a sane ply count', () => {
    expect(OPENING_MAX_PLY).toBeGreaterThanOrEqual(16);
  });
});
