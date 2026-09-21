import YinshBoard from './YinshBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
const envelope = board => ({ v: 1, game: 'yinsh', id: 'synthetic', updatedAt: 1, state: encodeBoard(board), ui: { humanPlayer: 1, twoPlayerMode: true, showModal: false } });
test('preserves selected ring and live scoring resolution queues without aliasing', () => {
  const b = new YinshBoard();
  b.gamePhase = 'remove-ring'; b.nextTurnPlayer = 2;
  b.rowResolutionQueue = [{ player: 2, rows: [{ player: 2, markers: [[0,0],[0,1],[0,2],[0,3],[0,4]] }] }];
  b.pendingRowsAfterRingRemoval = true;
  const snap = envelope(b);
  const restored = decodeMatch(JSON.parse(JSON.stringify(snap))).board;
  expect(restored.serializeState()).toEqual(b.serializeState());
  restored.rowResolutionQueue.length = 0;
  expect(b.rowResolutionQueue).toHaveLength(1);
});
test('rejects wrong game, future schema and invalid player', () => {
  const snap = envelope(new YinshBoard());
  expect(() => decodeMatch({ ...snap, game: 'zertz' })).toThrow();
  expect(() => decodeMatch({ ...snap, v: 2 })).toThrow();
  expect(() => decodeMatch({ ...snap, state: { ...snap.state, currentPlayer: 99 } })).toThrow();
});
