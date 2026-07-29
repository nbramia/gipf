import { detectOpening } from './openings';

describe('openings — detectOpening', () => {
  test('empty history is in book with no name', () => {
    const r = detectOpening([]);
    expect(r.name).toBeNull();
    expect(r.inBook).toBe(true);
    expect(r.depth).toBe(0);
  });

  test('names a simple first move', () => {
    expect(detectOpening(['e4']).name).toBe("King's Pawn");
    expect(detectOpening(['d4']).name).toBe("Queen's Pawn");
  });

  test('prefers the deepest matching variation', () => {
    const r = detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(r.name).toBe('Ruy Lopez');
    expect(r.depth).toBe(5);
  });

  test('detects a deep named variation (Najdorf)', () => {
    const r = detectOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
    expect(r.name).toBe('Sicilian, Najdorf');
    expect(r.eco).toBe('B90');
    expect(r.inBook).toBe(true);
  });

  test('flags leaving book and reports the ply', () => {
    // Italian through 5 plies, then a non-book 6th move.
    const r = detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6']);
    expect(r.name).toBe('Italian Game'); // deepest matched line still named
    expect(r.inBook).toBe(false);
    expect(r.leftBookAtPly).toBe(6);
  });

  test('an immediately offbeat move leaves book at ply 1', () => {
    const r = detectOpening(['a3']);
    expect(r.inBook).toBe(false);
    expect(r.leftBookAtPly).toBe(1);
    expect(r.name).toBeNull();
  });

  test('still in book when following a known line partway', () => {
    const r = detectOpening(['e4', 'e5', 'Nf3']);
    expect(r.name).toBe("King's Knight Opening");
    expect(r.inBook).toBe(true);
    expect(r.leftBookAtPly).toBeNull();
  });

  describe('idea fallback', () => {
    test('a named family reports its own idea', () => {
      const r = detectOpening(['e4', 'c5']);
      expect(r.name).toBe('Sicilian Defense');
      expect(r.idea).toMatch(/queenside pawn majority/);
    });

    test('a deep variation without its own idea falls back to the family idea', () => {
      const r = detectOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
      expect(r.name).toBe('Sicilian, Najdorf');
      expect(r.idea).toBe(detectOpening(['e4', 'c5']).idea);
    });

    test('empty history has no idea', () => {
      expect(detectOpening([]).idea).toBeNull();
    });

    test('an off-book move has no idea', () => {
      expect(detectOpening(['a3']).idea).toBeNull();
    });
  });

  describe('deep book lines', () => {
    test('London System', () => {
      const r = detectOpening(['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3', 'O-O', 'Nbd2', 'c5']);
      expect(r.name).toBe('London System');
      expect(r.inBook).toBe(true);
      expect(r.depth).toBe(12);
    });

    test('Catalan', () => {
      const r = detectOpening(['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4']);
      expect(r.name).toBe('Catalan');
      expect(r.inBook).toBe(true);
    });

    test('Vienna Game main line', () => {
      const r = detectOpening(['e4', 'e5', 'Nc3', 'Nf6', 'Bc4', 'Bc5', 'Qg4', 'O-O']);
      expect(r.name).toBe('Vienna Game, Main Line');
      expect(r.inBook).toBe(true);
    });

    test('Sicilian Dragon', () => {
      const r = detectOpening([
        'e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7',
      ]);
      expect(r.name).toBe('Sicilian, Dragon');
    });

    test('QGD main line', () => {
      const r = detectOpening([
        'd4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6',
      ]);
      expect(r.name).toBe("Queen's Gambit Declined, Main Line");
    });

    test('Caro-Kann Advance', () => {
      const r = detectOpening(['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'Be3', 'Qb6']);
      expect(r.name).toBe('Caro-Kann, Advance');
    });

    test('French Winawer', () => {
      const r = detectOpening([
        'e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7',
      ]);
      expect(r.name).toBe('French, Winawer');
    });
  });

  describe('transposition detection', () => {
    test('1.Nf3 d5 2.d4 Nf6 3.c4 transposes into a Queen\'s Gambit', () => {
      const r = detectOpening(['Nf3', 'd5', 'd4', 'Nf6', 'c4']);
      expect(r.name).toBe("Queen's Gambit");
      expect(r.inBook).toBe(true);
      expect(r.leftBookAtPly).toBeNull();
    });

    test('English move order transposing into a King\'s Indian Defense setup', () => {
      const r = detectOpening(['c4', 'Nf6', 'd4', 'g6']);
      expect(r.name).toBe("King's Indian Defense");
      expect(r.inBook).toBe(true);
      expect(r.leftBookAtPly).toBeNull();
    });

    test('Réti move order transposing into the King\'s Knight Opening', () => {
      // 1.Nf3 e5 is a real (offbeat) transposition attempt back to 1.e4 e5
      // territory once White plays e4 — same position as 1.e4 e5 2.Nf3.
      const r = detectOpening(['Nf3', 'e5']);
      // Nf3 e5 itself isn't a book line (Réti's book entry is just 'Nf3'),
      // so this stays keyed on the deepest matching prefix, not a position
      // match — but the position match kicks in once White actually
      // transposes with 2.e4, reaching the same FEN as 1.e4 e5 2.Nf3.
      expect(r.inBook).toBe(false);
      const r2 = detectOpening(['Nf3', 'e5', 'e4']);
      expect(r2.name).toBe("King's Knight Opening");
      expect(r2.inBook).toBe(true);
      expect(r2.leftBookAtPly).toBeNull();
    });

    test('a genuinely off-book move still reports leftBookAtPly correctly', () => {
      const r = detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'a5']);
      expect(r.inBook).toBe(false);
      expect(r.leftBookAtPly).toBe(6);
    });
  });
});
