import ZertzBoard from './ZertzBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
test('restores a capture continuation, selected marble, pool and captured pieces', () => {
  const b = new ZertzBoard();
  b.gamePhase = 'capture'; b.jumpingMarble = '0,0'; b.captureStarted = true;
  b.marbles = { '0,0': 'white', '1,0': 'grey' }; b.captures[1].black = 2;
  const snapshot = { v: 1, game: 'zertz', id: 'synthetic', updatedAt: 1, state: encodeBoard(b), ui: { humanPlayer: 2, twoPlayerMode: false, showModal: false } };
  const restored = decodeMatch(JSON.parse(JSON.stringify(snapshot)));
  expect(restored.board.serializeState()).toEqual(b.serializeState());
  expect(restored.ui.humanPlayer).toBe(2);
  expect(restored.board.rings instanceof Set).toBe(true);
});
