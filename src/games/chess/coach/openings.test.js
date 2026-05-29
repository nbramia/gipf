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
});
