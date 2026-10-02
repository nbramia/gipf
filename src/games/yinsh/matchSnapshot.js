import YinshBoard from './YinshBoard.js';
import { requireSnapshot, record, player, count } from '../../snapshotValidation.js';
const UI = ['humanPlayer', 'twoPlayerMode', 'showModal', 'difficulty', 'selectedSetupRing', 'scoreApplied'];
export const encodeBoard = board => ({ ...board.serializeState(), notation: { moveHistory: board.notation.moveHistory, currentMoveNumber: board.notation.currentMoveNumber } });
const KEYS = Object.keys(encodeBoard(new YinshBoard()));
export function decodeMatch(snapshot) {
  requireSnapshot(snapshot, 'yinsh', UI, KEYS);
  const s = snapshot.state;
  if (!player(s.currentPlayer) || !record(s.boardState) || !['setup','play','remove-row','remove-ring','game-over'].includes(s.gamePhase) ||
      !record(s.scores) || !record(s.ringsPlaced) || ![1,2].every(p => count(s.scores[p], 3) && count(s.ringsPlaced[p], 5)) ||
      !Array.isArray(s.validMoves) || !Array.isArray(s.rows) || !Array.isArray(s.rowResolutionQueue) || typeof s.pendingRowsAfterRingRemoval !== 'boolean' ||
      (snapshot.ui.humanPlayer !== undefined && !player(snapshot.ui.humanPlayer))) throw new Error('invalid_snapshot');
  const board = YinshBoard.fromSerializedState(s);
  for (const [key, piece] of Object.entries(s.boardState)) {
    const [q,r] = key.split(',').map(Number);
    if (!Number.isInteger(q) || !Number.isInteger(r) || !board._isInBounds(q,r) ||
        (piece && (!['ring','marker'].includes(piece.type) || !player(piece.player)))) throw new Error('invalid_snapshot');
  }
  if (!record(s.notation) || !Array.isArray(s.notation.moveHistory) || !count(s.notation.currentMoveNumber, 100000) ||
      s.notation.moveHistory.some(m => !record(m) || typeof m.notation !== 'string' || !player(m.player))) throw new Error('invalid_snapshot');
  board.notation.moveHistory = JSON.parse(JSON.stringify(s.notation.moveHistory));
  board.notation.currentMoveNumber = s.notation.currentMoveNumber;
  const coordinate = v => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && board._isInBounds(v[0],v[1]);
  const row = r => record(r) && player(r.player) && Array.isArray(r.markers) && r.markers.length === 5 && r.markers.every(coordinate);
  if ((s.selectedRing !== null && !coordinate(s.selectedRing)) || !s.validMoves.every(coordinate) ||
      !s.rows.every(row) || !s.rowResolutionQueue.every(q => record(q) && player(q.player) && Array.isArray(q.rows) && q.rows.every(row))) throw new Error('invalid_snapshot');
  board._captureState();
  return { board, ui: snapshot.ui };
}
