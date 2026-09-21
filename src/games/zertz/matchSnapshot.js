import ZertzBoard from './ZertzBoard.js';
import { requireSnapshot, record, player, count } from '../../snapshotValidation.js';
const UI = ['humanPlayer', 'twoPlayerMode', 'showModal', 'difficulty', 'lastMoveKeys'];
export const encodeBoard = board => board.serializeState();
const KEYS = Object.keys(encodeBoard(new ZertzBoard()));
export function decodeMatch(snapshot) {
  requireSnapshot(snapshot, 'zertz', UI, KEYS);
  const s = snapshot.state;
  if (!player(s.currentPlayer) || !['place-marble','remove-ring','capture','game-over'].includes(s.gamePhase) ||
      !Array.isArray(s.rings) || s.rings.length > 37 || !record(s.marbles) || !record(s.pool) || !record(s.captures) ||
      ![s.pool,s.captures[1],s.captures[2]].every(b => b && ['white','grey','black'].every(c => count(b[c], 24))) ||
      (snapshot.ui.humanPlayer !== undefined && !player(snapshot.ui.humanPlayer))) throw new Error('invalid_snapshot');
  for (const key of s.rings) {
    const [q,r] = String(key).split(',').map(Number);
    if (!Number.isInteger(q) || !Number.isInteger(r) || Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r)) > 3) throw new Error('invalid_snapshot');
  }
  for (const [key,color] of Object.entries(s.marbles)) if (!s.rings.includes(key) || !['white','grey','black'].includes(color)) throw new Error('invalid_snapshot');
  const board = ZertzBoard.fromSerializedState(JSON.parse(JSON.stringify(s)));
  board._captureState();
  return { board, ui: snapshot.ui };
}
