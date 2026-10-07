import { withHeaders, looksLikePgn, parsePlayerHeaders, resultToken, parseDeclaredResult } from './pgn';
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

describe('pgn — parsePlayerHeaders', () => {
  test('reads White/Black from a full PGN with headers', () => {
    const pgn = withHeaders('1. e4 e5 *', { white: 'Magnus', black: 'Human' });
    expect(parsePlayerHeaders(pgn)).toEqual({ white: 'Magnus', black: 'Human' });
  });

  test('returns nulls for missing headers, no throw on bare movetext', () => {
    expect(parsePlayerHeaders('1. e4 e5 2. Nf3')).toEqual({ white: null, black: null });
    expect(parsePlayerHeaders('')).toEqual({ white: null, black: null });
    expect(parsePlayerHeaders(null)).toEqual({ white: null, black: null });
  });

  test('tolerates only one of the two headers being present', () => {
    expect(parsePlayerHeaders('[White "Me"]\n\n1. e4 *')).toEqual({ white: 'Me', black: null });
  });
});

describe('pgn — round-trip via ChessBoard', () => {
  test('export then re-import reproduces the game', () => {
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

describe('pgn — export headers and result', () => {
  test('replaces chess.js placeholder headers and writes the result twice', () => {
    const b = new ChessBoard();
    ['f3', 'e5', 'g4', 'Qh4#'].forEach((san) => {
      const m = b.allLegalMoves().find((x) => x.san === san);
      b.move(m.from, m.to);
    });
    const out = withHeaders(b.pgn(), { white: 'Stockfish', black: 'Human', result: resultToken({ winner: 'black' }) });
    expect(out.match(/\[Event /g)).toHaveLength(1);
    expect(out.match(/\[White /g)).toHaveLength(1);
    expect(out).toContain('[Result "0-1"]');
    expect(out.trim().endsWith('2. g4 Qh4# 0-1')).toBe(true);
  });

  test('keeps SetUp/FEN headers from a custom start', () => {
    const b = new ChessBoard('7k/8/8/8/8/8/R7/K7 w - - 0 1');
    const m = b.allLegalMoves().find((x) => x.san === 'Ra3');
    b.move(m.from, m.to);
    const out = withHeaders(b.pgn());
    expect(out).toContain('[FEN "7k/8/8/8/8/8/R7/K7 w - - 0 1"]');
    expect(out).toContain('[Result "*"]');
  });

  test('resultToken and parseDeclaredResult', () => {
    expect(resultToken(null)).toBe('*');
    expect(resultToken({ winner: 'white' })).toBe('1-0');
    expect(resultToken({ winner: null })).toBe('1/2-1/2');
    expect(parseDeclaredResult('[Result "0-1"]\n\n1. e4 0-1')).toBe('black');
    expect(parseDeclaredResult('1. e4 e5 1/2-1/2')).toBe('draw');
    expect(parseDeclaredResult('[Result "*"]\n\n1. e4 *')).toBeNull();
  });
});
