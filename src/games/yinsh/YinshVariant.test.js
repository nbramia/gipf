import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import YinshBoard from './YinshBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';
import MCTS from './engine/mcts.js';
import Game from './YinshGame';
import { createBoardWithSetup, placeMarkers } from './testHelpers.js';

let mockSaved = null;
jest.mock('../../MatchBoundary.jsx', () => ({
  __esModule: true,
  default: ({ children }) => children,
  useSavedMatch: () => mockSaved,
}));
jest.mock('./hooks/createAIWorker', () => ({
  createAIWorker: jest.fn(() => ({ postMessage: jest.fn(), terminate: jest.fn() })),
}));

const line = r => [-2, -1, 0, 1, 2].map(q => [q, r]);
const envelope = board => ({ v: 1, game: 'yinsh', id: 'synthetic', updatedAt: 1, state: encodeBoard(board), ui: { humanPlayer: 1, twoPlayerMode: true, showModal: false } });

// White to remove a row (one marker line) then a ring.
function rowPosition(rows, ringsToWin) {
  const board = new YinshBoard({ initialPhase: 'play', initialPlayer: 1, ringsToWin });
  for (const [player, markers] of rows) {
    for (const pos of markers) board.boardState[pos.join(',')] = { type: 'marker', player };
  }
  for (const [player, rings] of [[1, [[-3, 0], [-3, 1], [-3, 2]]], [2, [[3, -3], [3, -2], [3, -1]]]]) {
    for (const pos of rings) board.boardState[pos.join(',')] = { type: 'ring', player };
  }
  board.nextTurnPlayer = 2;
  board._startNextRowResolution();
  board.clearHistory();
  board._captureState();
  return board;
}

describe('Blitz variant', () => {
  test('one removed ring wins Blitz but not Standard', () => {
    for (const [target, over] of [[1, true], [3, false]]) {
      const board = rowPosition([[1, line(0)]], target);
      board.removeRow(line(0));
      board.handleClick(-3, 0);
      expect(board.gamePhase === 'game-over').toBe(over);
      expect(board.winner).toBe(over ? 1 : null);
      expect(board.isGameOver()).toBe(over ? 1 : null);
    }
  });

  test('new game takes the requested target, then keeps it; clone and serialization carry it', () => {
    const board = new YinshBoard();
    expect(board.ringsToWin).toBe(3);
    board.startNewGame(false, 1);
    expect(board.ringsToWin).toBe(1);
    board.startNewGame(false);
    expect(board.ringsToWin).toBe(1);
    expect(board.clone().ringsToWin).toBe(1);
    expect(YinshBoard.fromSerializedState(board.serializeState()).ringsToWin).toBe(1);
  });

  test('a resumed Blitz match keeps its variant; saves without the field decode as Standard', () => {
    const board = rowPosition([[1, line(0)]], 1);
    expect(decodeMatch(JSON.parse(JSON.stringify(envelope(board)))).board.ringsToWin).toBe(1);
    const old = JSON.parse(JSON.stringify(envelope(new YinshBoard())));
    delete old.state.ringsToWin;
    expect(decodeMatch(old).board.ringsToWin).toBe(3);
    const bad = JSON.parse(JSON.stringify(envelope(board)));
    bad.state.ringsToWin = 2;
    expect(() => decodeMatch(bad)).toThrow();
  });

  test('the engine finishes a Blitz game on the first ring', () => {
    const board = rowPosition([[1, line(0)]], 1);
    const engine = new MCTS();
    const row = engine.getRowRemovals(board)[0];
    engine._applyMove(board, { type: row.type, row: row.row });
    const ring = engine.getRingRemovals ? engine.getRingRemovals(board)[0] : null;
    if (ring) engine._applyMove(board, ring); else board.handleClick(-3, 0);
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
  });
});

describe('Blitz search', () => {
  test('getBestMove completes the row that wins a Blitz game, then removes a ring', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const board = createBoardWithSetup([
      { player: 1, positions: [[4, 0], [-3, -2], [-2, -3], [-1, -4], [0, -4]] },
      { player: 2, positions: [[-4, 1], [-3, 2], [-2, 3], [-1, 4], [0, 4]] }
    ]);
    placeMarkers(board, [[0, 0], [1, 0], [2, 0], [3, 0]], 1);
    board.currentPlayer = 1;
    board.ringsToWin = 1;
    const engine = new MCTS();
    const play = await engine.getBestMove(board, 20);
    expect(play.move).toEqual([4, 0]);
    board.handleClick(4, 0);
    board.handleClick(...play.destination);
    expect(board.gamePhase).toBe('remove-row');
    const row = await engine.getBestMove(board, 20);
    engine._applyMove(board, row);
    expect(board.gamePhase).toBe('remove-ring');
    const ring = await engine.getBestMove(board, 20);
    board.handleClick(...ring.move);
    expect(board.gamePhase).toBe('game-over');
    expect(board.winner).toBe(1);
    console.log.mockRestore();
  }, 30000);
});

describe('row removal choice', () => {
  test('getRowToRemove names exactly the row a click removes', () => {
    // Six in a line: two overlapping windows; the click picks the first containing the marker.
    const six = [-3, -2, -1, 0, 1, 2].map(q => [q, -1]);
    const board = rowPosition([[1, six]], 3);
    const row = board.getRowToRemove(2, -1);
    expect(row.markers).toHaveLength(5);
    expect(board.getRowToRemove(0, 3)).toBeNull();
    board.handleClick(2, -1);
    expect(board.gamePhase).toBe('remove-ring');
    const left = Object.values(board.boardState).filter(p => p.type === 'marker').length;
    expect(left).toBe(1);
    expect(row.markers.some(([q]) => q === 2)).toBe(true);
  });
});

describe('Yinsh UI', () => {
  beforeEach(() => {
    mockSaved = null;
    Element.prototype.scrollIntoView = jest.fn();
    localStorage.clear();
    localStorage.setItem('yinshTwoPlayer', 'true');
    localStorage.setItem('yinshRandomSetup', 'false');
  });
  const restore = (board, ui = {}) => {
    mockSaved = {
      restored: { board, ui: { twoPlayerMode: true, showModal: false, humanPlayer: 1, ...ui } },
      persist() {}, setTheme() {}, startNew() {}, isCurrent: () => true,
    };
  };
  const mount = () => render(<MemoryRouter><Game /></MemoryRouter>);
  const cell = (q, r) => screen.getByLabelText(new RegExp(`at ${q},${r}$`));

  test('a reopened match explains the disabled Undo', () => {
    const board = new YinshBoard();
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);
    restore(decodeMatch(JSON.parse(JSON.stringify(envelope(board)))).board);
    mount();
    expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(true);
    expect(screen.getByText('Undo covers moves since this match was reopened.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-describedby')).toBe('yinsh-undo-note');
  });

  test('no Undo explanation for a fresh game', () => {
    mount();
    expect(screen.queryByText(/since this match was reopened/)).toBeNull();
  });

  test('hovering a history entry marks its points on the board', () => {
    const board = new YinshBoard();
    board.handleSetupRingClick(1, 0);
    board.handleClick(0, 0);
    restore(board);
    const { container } = mount();
    expect(container.querySelectorAll('[data-history-mark]')).toHaveLength(0);
    const entry = screen.getAllByRole('button', { name: /Move 1,/ })[0];
    fireEvent.mouseEnter(entry);
    expect(container.querySelectorAll('[data-history-mark]')).toHaveLength(1);
    fireEvent.mouseLeave(entry);
    expect(container.querySelectorAll('[data-history-mark]')).toHaveLength(0);
    fireEvent.click(entry);
    expect(container.querySelectorAll('[data-history-mark]')).toHaveLength(1);
  });

  test('hovering a marker previews exactly the five a click removes', () => {
    const six = [-3, -2, -1, 0, 1, 2].map(q => [q, -1]);
    const board = rowPosition([[1, six]], 3);
    restore(board);
    const { container } = mount();
    expect(container.querySelectorAll('[data-row-preview]')).toHaveLength(0);
    fireEvent.focus(cell(2, -1));
    expect(container.querySelectorAll('[data-row-preview]')).toHaveLength(5);
    fireEvent.blur(cell(2, -1));
    expect(container.querySelectorAll('[data-row-preview]')).toHaveLength(0);
  });

  test('settings offer Blitz for the next game and the choice is stored', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Blitz' })[0]);
    expect(localStorage.getItem('yinshVariant')).toBe('blitz');
    expect(screen.getAllByText(/Applies to the next New Game/).length).toBeGreaterThan(0);
  });
});
