import YinshBoard from './YinshBoard.js';
import MCTS from './engine/mcts.js';
import { applyAIMove } from './engine/aiPlayer.js';

const line = r => [-2, -1, 0, 1, 2].map(q => [q, r]);

function position(rows, mover = 1) {
  const board = new YinshBoard({ initialPhase: 'play', initialPlayer: mover });
  for (const [player, markers] of rows) {
    for (const pos of markers) board.boardState[pos.join(',')] = { type: 'marker', player };
  }
  for (const [player, rings] of [[1, [[-3, 0], [-3, 1], [-3, 2]]], [2, [[3, -3], [3, -2], [3, -1]]]]) {
    for (const pos of rings) board.boardState[pos.join(',')] = { type: 'ring', player };
  }
  board.nextTurnPlayer = 3 - mover;
  board._startNextRowResolution();
  board.clearHistory();
  board._captureState();
  return board;
}

test('two disjoint rows score two rings without stale actions, across history and restoration', () => {
  const board = position([[1, line(0)], [1, line(2)]]);
  const engine = new MCTS();
  const first = engine.getRowRemovals(board)[0];
  applyAIMove(board, { type: first.type, row: first.row });
  expect(board.gamePhase).toBe('remove-ring');
  expect(board.removeRow(line(2))).toBe(false);
  const pending = JSON.parse(JSON.stringify(board.serializeState()));
  expect(board.undo()).toBe(true);
  expect(board.gamePhase).toBe('remove-row');
  expect(board.redo()).toBe(true);
  expect(board.serializeState()).toEqual(pending);

  for (const restored of [board.clone(), YinshBoard.fromSerializedState(board.serializeState()), board]) {
    restored.handleClick(-3, 0);
    expect(restored.currentPlayer).toBe(1);
    expect(restored.gamePhase).toBe('remove-row');
    expect(restored.scores).toEqual({ 1: 1, 2: 0 });
    const before = JSON.stringify(restored.serializeState());
    restored.handleClick(...first.row[0]);
    expect(restored.removeRow(first.row)).toBe(false);
    expect(JSON.stringify(restored.serializeState())).toBe(before);
    const second = engine.getRowRemovals(restored)[0];
    engine._applyMove(restored, second);
    expect(restored.gamePhase).toBe('remove-ring');
    restored.handleClick(-3, 1);
    expect(restored.gamePhase).toBe('play');
    expect(restored.currentPlayer).toBe(2);
    expect(restored.scores).toEqual({ 1: 2, 2: 0 });
    expect(restored.rows).toEqual([]);
    expect(restored.rowResolutionQueue).toEqual([]);
    expect(restored.nextTurnPlayer).toBeNull();
    expect(engine.getLegalMoves(restored).length).toBeGreaterThan(0);
  }
});

test.each([1, 2])('mover %i resolves before opponent and opponent then takes the ordinary turn', mover => {
  // Enter resolution by a real ring move, which leaves the fifth marker.
  const board = position([[mover, line(0)], [3 - mover, line(2)]], mover);
  board.gamePhase = 'play';
  board.currentPlayer = mover;
  board.boardState['2,0'] = { type: 'ring', player: mover };
  board.handleClick(2, 0);
  board.handleClick(2, -1);
  expect(board.currentPlayer).toBe(mover);
  expect(board.removeRow(line(0))).toBe(true);
  board.handleClick(2, -1);
  expect(board.currentPlayer).toBe(3 - mover);
  expect(board.gamePhase).toBe('remove-row');
  expect(board.removeRow(line(2))).toBe(true);
  board.handleClick(...(mover === 1 ? [3, -3] : [-3, 0]));
  expect(board.scores).toEqual({ 1: 1, 2: 1 });
  expect(board.gamePhase).toBe('play');
  expect(board.currentPlayer).toBe(3 - mover);
});

test('third ring ends resolution before another own row or opponent third row', () => {
  const board = position([[1, line(0)], [1, line(1)], [2, line(2)]]);
  board.scores = { 1: 2, 2: 2 };
  board.removeRow(line(0));
  board.handleClick(-3, 0);
  expect(board.winner).toBe(1);
  expect(board.gamePhase).toBe('game-over');
  expect(board.rowResolutionQueue).toEqual([]);
  board.handleClick(0, 2);
  board.handleClick(3, -3);
  expect(board.scores).toEqual({ 1: 3, 2: 2 });
  expect(board.boardState['0,2']).toEqual({ type: 'marker', player: 2 });
});

test.each(['search', 'live', 'fallback'])('%s removes precisely the second window of six markers', mode => {
  const six = [-2, -1, 0, 1, 2, 3].map(q => [q, 0]);
  const board = position([[1, six]]);
  const engine = new MCTS();
  const move = engine.getRowRemovals(board).find(action => action.row[0][0] === -1);
  expect(move.row).toEqual(six.slice(1));
  if (mode === 'search') engine._applyMove(board, move);
  else if (mode === 'live') applyAIMove(board, { type: move.type, row: move.row });
  else {
    jest.spyOn(engine, 'getLegalMoves').mockReturnValue([move]);
    const fallback = engine.getFallbackMove(board);
    applyAIMove(board, { type: fallback.type, row: fallback.row });
  }
  expect(board.boardState['-2,0']).toEqual({ type: 'marker', player: 1 });
  for (const pos of six.slice(1)) expect(board.boardState[pos.join(',')]).toBeUndefined();
  board.handleClick(-3, 0);
  expect(board.scores[1]).toBe(1);
  expect(board.gamePhase).toBe('play');
  expect(board.currentPlayer).toBe(2);
});

test('intersecting rows score once, and invalid full-row actions leave history untouched', () => {
  const vertical = [-2, -1, 0, 1, 2].map(r => [0, r]);
  const board = position([[1, line(0)], [1, vertical]]);
  for (const invalid of [null, line(0).slice(1), Array(5).fill([0, 0]), [[0]], [...line(0).slice(0, 4), [1, 1]]]) {
    const before = JSON.stringify(board.serializeState());
    expect(board.removeRow(invalid)).toBe(false);
    expect(JSON.stringify(board.serializeState())).toBe(before);
    expect(board.historyIndex).toBe(0);
  }
  board.removeRow(vertical);
  board.handleClick(-3, 0);
  expect(board.scores[1]).toBe(1);
  expect(board.gamePhase).toBe('play');
  expect(board.boardState['1,0']).toEqual({ type: 'marker', player: 1 });
  expect(board.removeRow(line(0))).toBe(false);
});

test('pending next turn distinguishes otherwise identical transposition positions', () => {
  const board = position([[1, line(0)]]);
  const other = board.clone();
  other.nextTurnPlayer = 1;
  expect(other.getStateHash()).not.toBe(board.getStateHash());
  for (const candidate of [board, other]) {
    candidate.removeRow(line(0));
    candidate.handleClick(-3, 0);
  }
  expect(board.currentPlayer).toBe(2);
  expect(other.currentPlayer).toBe(1);
});

test('an opponent-only row scores before that opponent takes the next turn', () => {
  const board = position([[2, line(0)]], 1);
  expect(board.currentPlayer).toBe(2);
  board.removeRow(line(0));
  board.handleClick(3, -3);
  expect(board.gamePhase).toBe('play');
  expect(board.currentPlayer).toBe(2);
  expect(board.scores).toEqual({ 1: 0, 2: 1 });
});

test('deserialized resolution state does not alias the source board', () => {
  const board = position([[1, line(0)]]);
  const restored = YinshBoard.fromSerializedState(board.serializeState());
  restored.boardState['0,0'].player = 2;
  restored.rows[0].markers[0][0] = 99;
  restored.rowResolutionQueue[0].rows.length = 0;
  expect(board.boardState['0,0'].player).toBe(1);
  expect(board.rows[0].markers[0][0]).toBe(-2);
  expect(board.rowResolutionQueue[0].rows).toHaveLength(1);
});
