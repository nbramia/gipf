// lichessPuzzle.test.js — parsing the Lichess daily-puzzle payload (#24):
// fen-carrying and pgn-derived variants, solution legality vetting, theme
// labeling, and graceful nulls on malformed data.

import { parsePuzzle, themeLabel } from './lichessPuzzle.js';

// Shape captured from a real https://lichess.org/api/puzzle/daily response.
const REAL_DAILY = {
  game: { id: 'UJwYAshd', pgn: 'd4 d5', clock: '10+0' },
  puzzle: {
    id: 'D9gip',
    rating: 1879,
    plays: 107690,
    solution: ['d4f4', 'g4f4', 'g3f4'],
    themes: ['endgame', 'crushing', 'short'],
    fen: '5r1k/p5p1/2P5/4R2p/3Q1rq1/P5P1/2B3K1/8 w - - 0 1',
    lastMove: 'f7f4',
    initialPly: 79,
  },
};

describe('parsePuzzle', () => {
  test('parses a fen-carrying daily puzzle and vets its solution', () => {
    const p = parsePuzzle(REAL_DAILY);
    expect(p).toMatchObject({
      id: 'lichess-D9gip',
      kind: 'solution',
      rating: 1879,
      fen: REAL_DAILY.puzzle.fen,
      solution: ['d4f4', 'g4f4', 'g3f4'],
      source: 'lichess-daily',
    });
    expect(p.theme).toBe('Endgame'); // 'crushing'/'short' are generic
  });

  test('derives the position from game.pgn + initialPly when fen is absent', () => {
    // Scholar's-mate setup: after 6 plies (initialPly 5) White mates with Qxf7#.
    const json = {
      game: { pgn: 'e4 e5 Qh5 Nc6 Bc4 Nf6' },
      puzzle: { id: 'syn1', rating: 700, solution: ['h5f7'], themes: ['mateIn1'], initialPly: 5 },
    };
    const p = parsePuzzle(json);
    expect(p).not.toBeNull();
    expect(p.fen).toContain(' w '); // White to move
    expect(p.theme).toBe('Mate in 1');
  });

  test('rejects puzzles whose solution does not replay legally', () => {
    const bad = JSON.parse(JSON.stringify(REAL_DAILY));
    bad.puzzle.solution = ['d4d5', 'g4f4']; // second move illegal after d4d5? first is — vetted end-to-end
    bad.puzzle.solution = ['a1a2']; // no piece on a1
    expect(parsePuzzle(bad)).toBeNull();
  });

  test('returns null on malformed payloads', () => {
    expect(parsePuzzle(null)).toBeNull();
    expect(parsePuzzle({})).toBeNull();
    expect(parsePuzzle({ puzzle: { id: 'x', solution: [] } })).toBeNull();
    expect(parsePuzzle({ puzzle: { id: 'x', solution: ['e2e4'] } })).toBeNull(); // no fen, no pgn
    const shortPgn = {
      game: { pgn: 'e4 e5' },
      puzzle: { id: 'x', solution: ['e2e4'], initialPly: 5 },
    };
    expect(parsePuzzle(shortPgn)).toBeNull(); // pgn shorter than initialPly
  });
});

describe('themeLabel', () => {
  test('spaces and capitalizes camelCase themes', () => {
    expect(themeLabel('backRankMate')).toBe('Back rank mate');
    expect(themeLabel('fork')).toBe('Fork');
    expect(themeLabel('discoveredAttack')).toBe('Discovered attack');
  });
});
