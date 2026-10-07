import { describeSnapshot, gameLabel } from './matchSummary.js';
import ChessBoard from './games/chess/ChessBoard.js';
import { encodeBoard as encodeChess, decodeMatch as decodeChess } from './games/chess/matchSnapshot.js';
import YinshBoard from './games/yinsh/YinshBoard.js';
import { encodeBoard as encodeYinsh, decodeMatch as decodeYinsh } from './games/yinsh/matchSnapshot.js';
import ZertzBoard from './games/zertz/ZertzBoard.js';
import { encodeBoard as encodeZertz, decodeMatch as decodeZertz } from './games/zertz/matchSnapshot.js';
import CatanBoard from './games/catan/CatanBoard.js';
import { encodeBoard as encodeCatan, decodeMatch as decodeCatan } from './games/catan/matchSnapshot.js';

// A real envelope, proven valid by the game's own decoder.
const envelope = (game, state, decode) => {
  const snapshot = { v: 1, game, id: 'synthetic', updatedAt: 1760000000000, state, ui: {} };
  decode(snapshot);
  return snapshot;
};

test('names the game from the registry', () => {
  expect(gameLabel('yinsh')).toBe('YINSH');
  expect(gameLabel('unlisted')).toBe('UNLISTED');
});

test('chess counts real moves and ignores PGN header tokens', () => {
  const board = new ChessBoard('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'); // custom start: pgn() carries SetUp/FEN headers
  const before = envelope('chess', encodeChess(board), decodeChess);
  expect(before.state.pgn).toMatch(/\[FEN /);
  expect(describeSnapshot(before)).toContain('no moves yet');
  board.move('e2', 'e4'); board.move('e8', 'd8');
  expect(describeSnapshot(envelope('chess', encodeChess(board), decodeChess))).toContain('1 move');
  expect(describeSnapshot(envelope('chess', encodeChess(board), decodeChess))).not.toContain('1 moves');
});

test('different positions of every other game read differently', () => {
  const yinsh = new YinshBoard(); const y0 = envelope('yinsh', encodeYinsh(yinsh), decodeYinsh);
  yinsh.selectedSetupRing = { player: 1 };
  yinsh.handleClick(0, 1);
  expect(yinsh.ringsPlaced[1]).toBe(1);
  const y1 = envelope('yinsh', encodeYinsh(yinsh), decodeYinsh);
  expect(describeSnapshot(y0)).not.toBe(describeSnapshot(y1));

  const zertz = new ZertzBoard(); const z0 = envelope('zertz', encodeZertz(zertz), decodeZertz);
  zertz.selectMarbleColor('white');
  const [q, r] = zertz.getValidPlacements()[0].split(',').map(Number);
  zertz.placeMarble(q, r);
  const free = zertz.getFreeRings()[0];
  zertz.removeRing(...free.split(',').map(Number));
  const z1 = envelope('zertz', encodeZertz(zertz), decodeZertz);
  expect(describeSnapshot(z0)).not.toBe(describeSnapshot(z1));

  const catan = new CatanBoard({ seed: 1 }); const c0 = envelope('catan', encodeCatan(catan), decodeCatan);
  catan.turnNumber = 4;
  const c1 = envelope('catan', encodeCatan(catan), decodeCatan);
  expect(describeSnapshot(c0)).not.toBe(describeSnapshot(c1));
});

test('degrades gracefully for missing or unreadable values', () => {
  expect(describeSnapshot({ updatedAt: 0, state: {} })).toBe('Saved time unknown');
  expect(describeSnapshot(null)).toBe('No match saved');
  expect(describeSnapshot({ unreadable: 'x' })).toMatch(/Unreadable/);
});
