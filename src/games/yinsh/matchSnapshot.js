import YinshBoard from './YinshBoard.js';
import { requireSnapshot, record, player, count } from '../../snapshotValidation.js';
const UI = ['humanPlayer', 'twoPlayerMode', 'showModal', 'difficulty', 'selectedSetupRing', 'scoreApplied'];
export const encodeBoard = board => ({ ...board.serializeState(), notation: { moveHistory: board.notation.moveHistory, currentMoveNumber: board.notation.currentMoveNumber } });
const KEYS = Object.keys(encodeBoard(new YinshBoard()));
// Matches saved before the Blitz variant carry no target and decode as Standard.
const LEGACY_KEYS = KEYS.filter(k => k !== 'ringsToWin');
const TARGETS = [YinshBoard.RINGS_TO_WIN, YinshBoard.BLITZ_RINGS_TO_WIN];
export function decodeMatch(snapshot) {
  requireSnapshot(snapshot, 'yinsh', UI, snapshot?.state && 'ringsToWin' in snapshot.state ? KEYS : LEGACY_KEYS);
  const s = snapshot.state;
  if ('ringsToWin' in s && !TARGETS.includes(s.ringsToWin)) throw new Error('invalid_snapshot');
  const target = s.ringsToWin ?? YinshBoard.RINGS_TO_WIN;
  if (!player(s.currentPlayer) || !record(s.boardState) || !['setup','play','remove-row','remove-ring','game-over'].includes(s.gamePhase) ||
      !record(s.scores) || !record(s.ringsPlaced) || ![1,2].every(p => count(s.scores[p], target) && count(s.ringsPlaced[p], 5)) ||
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
  const markers = Object.values(s.boardState).filter(piece => piece?.type === 'marker').length;
  if (markers > YinshBoard.MARKER_POOL || (s.winner !== null && s.winner !== undefined && !player(s.winner)) ||
      (s.gamePhase === 'game-over' && !s.winner && !(s.scores[1] === s.scores[2] && markers >= YinshBoard.MARKER_POOL))) throw new Error('invalid_snapshot');
  board.notation.moveHistory = JSON.parse(JSON.stringify(s.notation.moveHistory));
  board.notation.currentMoveNumber = s.notation.currentMoveNumber;
  const coordinate = v => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && board._isInBounds(v[0],v[1]);
  const row = r => record(r) && player(r.player) && Array.isArray(r.markers) && r.markers.length === 5 && r.markers.every(coordinate);
  if ((s.selectedRing !== null && !coordinate(s.selectedRing)) || !s.validMoves.every(coordinate) ||
      !s.rows.every(row) || !s.rowResolutionQueue.every(q => record(q) && player(q.player) && Array.isArray(q.rows) && q.rows.every(row))) throw new Error('invalid_snapshot');
  // A save written before the pool rule can hold a full pool mid-play: adjudicate it now.
  if (board.gamePhase === 'play' && board._countMarkers() >= YinshBoard.MARKER_POOL) board._endByMarkerExhaustion();
  board._captureState();
  return { board, ui: snapshot.ui };
}
