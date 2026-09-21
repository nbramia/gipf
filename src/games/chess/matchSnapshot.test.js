import ChessBoard from './ChessBoard.js';
import { encodeBoard, decodeMatch, fromLegacy } from './matchSnapshot.js';
test('keeps full repetition history and valid empty initial positions', () => {
  const b = new ChessBoard();
  for (let i=0;i<2;i++) { b.move('g1','f3'); b.move('g8','f6'); b.move('f3','g1'); b.move('f6','g8'); }
  const snap = { v: 1, game: 'chess', id: 'synthetic', updatedAt: 1, state: encodeBoard(b), ui: { humanColor: 'w', orientation: 'white', ratedApplied: true } };
  expect(decodeMatch(snap).board.result().type).toBe('threefold');
  expect(decodeMatch({ ...snap, state: encodeBoard(new ChessBoard()) }).board.sanHistory()).toEqual([]);
});
test('legacy conversion preserves source data and scoring flags', () => {
  const legacy = { v: 1, pgn: '', humanColor: 'b', rated: true };
  expect(fromLegacy(legacy).ui.humanColor).toBe('b');
  expect(legacy).toEqual({ v: 1, pgn: '', humanColor: 'b', rated: true });
});
