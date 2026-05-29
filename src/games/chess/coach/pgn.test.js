import { withHeaders, looksLikePgn } from './pgn';
import ChessBoard from '../ChessBoard';

describe('pgn — withHeaders', () => {
  test('prepends standard headers and keeps the movetext', () => {
    const out = withHeaders('1. e4 e5 2. Nf3 *', { white: 'Me', black: 'SF', date: '2026.05.29' });
    expect(out).toContain('[White "Me"]');
    expect(out).toContain('[Black "SF"]');
    expect(out).toContain('[Date "2026.05.29"]');
    expect(out).toContain('1. e4 e5 2. Nf3');
  });
  test('omits the date header when not provided', () => {
    const out = withHeaders('1. e4 *');
    expect(out).not.toContain('[Date');
  });
});

describe('pgn — looksLikePgn', () => {
  test('accepts movetext and header forms, rejects junk', () => {
    expect(looksLikePgn('1. e4 e5 2. Nf3')).toBe(true);
    expect(looksLikePgn('[Event "x"]\n\n1. d4')).toBe(true);
    expect(looksLikePgn('not a game')).toBe(false);
    expect(looksLikePgn('')).toBe(false);
    expect(looksLikePgn(null)).toBe(false);
  });
});

describe('pgn — round-trip via ChessBoard', () => {
  test('export then re-import reproduces the game (issue #16 AC)', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('c7', 'c5');
    b.move('g1', 'f3');
    const pgnText = withHeaders(b.pgn());
    expect(looksLikePgn(pgnText)).toBe(true);

    const c = new ChessBoard();
    expect(c.loadPgn(pgnText)).toBe(true);
    expect(c.sanHistory()).toEqual(['e4', 'c5', 'Nf3']);
    expect(c.fen()).toBe(b.fen());
  });
});
