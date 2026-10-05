import CatanBoard from './CatanBoard.js';
import { requireSnapshot, record, count } from '../../snapshotValidation.js';
const UI = ['showModal','gameConfig','selectedAction','lastMove','showTradeBuilder','tradeGive','tradeReceive','tradeTargets','showMonopolyPicker','showYopPicker','yopPick','robberVictimPicker','gameLog'];
// Undo history is a cache of full maps and grows beyond the bounded wire budget.
// Preserve the canonical current position, deck, RNG, and all pending actions.
export const encodeBoard = board => ({ ...board.serializeState(), stateHistory: [], historyIndex: -1 });
const KEYS = Object.keys(encodeBoard(new CatanBoard({ seed: 1 })));
export function decodeMatch(snapshot) {
  requireSnapshot(snapshot, 'catan', UI, KEYS);
  const s = snapshot.state;
  if (!count(s.playerCount,6) || s.playerCount < 3 || !Number.isInteger(s.currentPlayer) || s.currentPlayer < 1 || s.currentPlayer > s.playerCount ||
      !['setup-settlement','setup-road','roll','action','discard','robber','trade-response','paired-action','game-over'].includes(s.phase) ||
      !Array.isArray(s.tiles) || !record(s.vertices) || !record(s.edges) || !record(s.players) ||
      !Array.isArray(s.devDeck) || !Array.isArray(s.discardQueue) || !Number.isFinite(s.rngState) ||
      !Array.isArray(s.stateHistory) || s.stateHistory.length !== 0) throw new Error('invalid_snapshot');
  const board = CatanBoard.fromSerializedState(JSON.parse(JSON.stringify(s)));
  board.getLegalMoves();
  return { board, ui: snapshot.ui };
}
