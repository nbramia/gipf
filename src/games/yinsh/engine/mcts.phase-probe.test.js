import YinshBoard from '../YinshBoard.js';
import MCTS from './mcts.js';

function position(markers = [], rings = [[1, -3, 2], [2, 3, -2]]) {
  const board = new YinshBoard({ initialPhase: 'play' });
  for (const [player, q, r] of markers) board.boardState[`${q},${r}`] = { type: 'marker', player };
  for (const [player, q, r] of rings) board.boardState[`${q},${r}`] = { type: 'ring', player };
  return board;
}

function moveRing(board, from, to) {
  board.handleClick(...from);
  board.handleClick(...to);
}

afterEach(() => jest.restoreAllMocks());

test('root candidate creating an opponent-only row is penalized without incompatible reply probes', () => {
  const board = position([...[ -2, -1, 1, 2 ].map(q => [2, q, 0]), [1, 0, 0]],
    [[1, 0, -1], [2, 3, -2]]);
  const engine = new MCTS();
  const move = { type: 'move-ring', start: [0, -1], end: [0, 1] };
  const after = board.clone();
  moveRing(after, move.start, move.end);
  expect(after.gamePhase).toBe('remove-row');
  expect(after.currentPlayer).toBe(2);
  expect(after.checkForRows().map(row => row.player)).toEqual([2]);
  const before = board.serializeState();
  const penalty = jest.spyOn(engine, '_getOpponentResponsePenalty');
  const probe = jest.spyOn(engine, '_simulateAndCheckWin');
  const errors = jest.spyOn(console, 'error');
  engine._selectMoveByFastHeuristic([move], board);
  expect(penalty).toHaveReturnedWith(10000);
  // The candidate itself is tested from the original play state for each color.
  expect(probe.mock.calls.every(([, state]) => state.getGamePhase() === 'play')).toBe(true);
  expect(errors).not.toHaveBeenCalled();
  expect(board.serializeState()).toEqual(before);
});

test.each([false, true])('mover scoring never probes ring replies (opponent row pending: %s)', opponentRow => {
  const markers = [-2, -1, 0, 1].map(q => [1, q, 0]);
  if (opponentRow) markers.push(...[-2, -1, 0, 1, 2].map(q => [2, q, 2]));
  const board = position(markers, [[1, 2, 0], [2, 3, -2]]);
  moveRing(board, [2, 0], [2, -1]);
  expect(board.gamePhase).toBe('remove-row');
  expect(board.currentPlayer).toBe(1);
  const engine = new MCTS();
  const probe = jest.spyOn(engine, '_simulateAndCheckWin');
  for (const phase of ['remove-row', 'remove-ring']) {
    expect(board.gamePhase).toBe(phase);
    const before = board.serializeState();
    expect(engine._getOpponentResponsePenalty(board, 2)).toBe(opponentRow ? 10000 : 0);
    expect(board.serializeState()).toEqual(before);
    if (phase === 'remove-row') expect(board.removeRow(board.checkForRows().find(row => row.player === 1).markers)).toBe(true);
  }
  expect(probe).not.toHaveBeenCalled();
});

test('opponent ring removal remains a scoring threat after its markers are gone', () => {
  const board = position([...[ -2, -1, 1, 2 ].map(q => [2, q, 0]), [1, 0, 0]],
    [[1, 0, -1], [2, 3, -2]]);
  moveRing(board, [0, -1], [0, 1]);
  expect(board.removeRow(board.checkForRows()[0].markers)).toBe(true);
  expect(board.gamePhase).toBe('remove-ring');
  expect(board.checkForRows()).toEqual([]);
  const engine = new MCTS();
  const probe = jest.spyOn(engine, '_simulateAndCheckWin');
  expect(engine._getOpponentResponsePenalty(board, 2)).toBe(10000);
  expect(probe).not.toHaveBeenCalled();
});

test.each([1, 2])('terminal winner %i ends reply lookahead', winner => {
  const board = position([-2, -1, 0, 1].map(q => [winner, q, 0]), [[winner, 2, 0], [3 - winner, 3, -2]]);
  board.currentPlayer = winner;
  board.scores[winner] = 2;
  moveRing(board, [2, 0], [2, -1]);
  expect(board.removeRow(board.checkForRows()[0].markers)).toBe(true);
  board.handleClick(2, -1);
  expect(board.gamePhase).toBe('game-over');
  expect(board.isGameOver()).toBe(winner);
  const engine = new MCTS();
  const probe = jest.spyOn(engine, '_simulateAndCheckWin');
  const before = board.serializeState();
  expect(engine._getOpponentResponsePenalty(board, 2)).toBe(winner === 2 ? 10000 : 0);
  expect(probe).not.toHaveBeenCalled();
  expect(board.serializeState()).toEqual(before);
});

test.each([[2, 500], [3, 3000], [4, 10000]])('legal opponent reply completing %i existing markers retains threat penalty', (count, expected) => {
  const board = position(Array.from({ length: count }, (_, i) => [2, i - 2, 0]),
    [[1, -3, 2], [2, count - 2, 0]]);
  moveRing(board, [-3, 2], [-2, 2]);
  expect(board.gamePhase).toBe('play');
  expect(board.currentPlayer).toBe(2);
  const engine = new MCTS();
  const probe = jest.spyOn(engine, '_simulateAndCheckWin');
  const before = board.serializeState();
  expect(engine._getOpponentResponsePenalty(board, 2)).toBe(expected);
  expect(probe).toHaveBeenCalled();
  expect(probe.mock.calls.every(([, state, player]) => state.getGamePhase() === 'play' && state.getCurrentPlayer() === player)).toBe(true);
  expect(board.serializeState()).toEqual(before);
});

test('ordinary ring reply enumeration requires the opponent to be the actual actor', () => {
  const board = position();
  const engine = new MCTS();
  const rings = jest.spyOn(engine, '_getPlayerRings');
  expect(engine._getOpponentResponsePenalty(board, 2)).toBe(0);
  expect(rings).not.toHaveBeenCalled();
});
