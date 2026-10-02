import ChessBoard from './ChessBoard.js';
import { requireSnapshot } from '../../snapshotValidation.js';
const UI = ['humanColor','orientation','resigned','rated','difficulty','clock','timeControl','flagged','ratedApplied','historyApplied','gameLogged','dialogue','moveStats','gameMistakes'];
export const encodeBoard = board => ({ pgn: board.pgn(), initialFen: board.positions[0] });
export function decodeMatch(snapshot) {
  requireSnapshot(snapshot, 'chess', UI, ['pgn','initialFen']);
  if (typeof snapshot.state.pgn !== 'string' || typeof snapshot.state.initialFen !== 'string') throw new Error('invalid_snapshot');
  const board = new ChessBoard(snapshot.state.initialFen);
  if (snapshot.state.pgn.trim() && !board.loadPgn(snapshot.state.pgn)) throw new Error('invalid_snapshot');
  if (board.positions[0] !== snapshot.state.initialFen) throw new Error('invalid_snapshot');
  if (snapshot.ui.humanColor && !['w','b'].includes(snapshot.ui.humanColor)) throw new Error('invalid_snapshot');
  if (snapshot.ui.clock && !['w','b'].every(p => Number.isFinite(snapshot.ui.clock[p]) && snapshot.ui.clock[p] >= 0)) throw new Error('invalid_snapshot');
  return { board, ui: snapshot.ui };
}
export function fromLegacy(legacy) {
  if (!legacy || legacy.v !== 1 || typeof legacy.pgn !== 'string') throw new Error('invalid_snapshot');
  const board = new ChessBoard();
  if (legacy.pgn.trim() && !board.loadPgn(legacy.pgn)) throw new Error('invalid_snapshot');
  const ui = Object.fromEntries(UI.filter(k => k in legacy).map(k => [k, legacy[k]]));
  // Historical terminal snapshots did not carry application flags. Their stats
  // already live in legacy profile stores; never count those matches a second time.
  if (board.result() || legacy.resigned) Object.assign(ui, { ratedApplied: true, historyApplied: true, gameLogged: true });
  return { v: 1, game: 'chess', id: 'legacy-chess', updatedAt: 0, state: encodeBoard(board), ui };
}
