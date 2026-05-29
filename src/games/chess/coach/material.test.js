import { capturedPieces, materialBalance, PIECE_VALUES } from './material';
import ChessBoard from '../ChessBoard';

describe('material — starting position', () => {
  test('no captures and even material at the start', () => {
    const b = new ChessBoard();
    expect(capturedPieces(b.board(), 'w')).toEqual([]);
    expect(capturedPieces(b.board(), 'b')).toEqual([]);
    expect(materialBalance(b.board())).toBe(0);
  });
});

describe('material — after a capture', () => {
  test('capthuring a pawn shows it in the tray and shifts the balance', () => {
    const b = new ChessBoard();
    b.move('e2', 'e4');
    b.move('d7', 'd5');
    b.move('e4', 'd5'); // white captures a black pawn
    // One black pawn captured; none for white.
    expect(capturedPieces(b.board(), 'b')).toEqual(['p']);
    expect(capturedPieces(b.board(), 'w')).toEqual([]);
    // White is up one pawn.
    expect(materialBalance(b.board())).toBe(1);
  });
});

describe('material — value table', () => {
  test('queen worth 9, rook 5, minor 3, pawn 1, king 0', () => {
    expect(PIECE_VALUES).toMatchObject({ q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 });
  });
});
