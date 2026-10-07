import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import YinshBoard from './YinshBoard.js';
import Game from './YinshGame';

let mockSaved = null;
jest.mock('../../MatchBoundary.jsx', () => ({
  __esModule: true,
  default: ({ children }) => children,
  useSavedMatch: () => mockSaved,
}));
jest.mock('./hooks/createAIWorker', () => ({
  createAIWorker: jest.fn(() => ({ postMessage: jest.fn(), terminate: jest.fn() })),
}));

function restore(board, ui = {}) {
  mockSaved = {
    restored: { board, ui: { twoPlayerMode: true, showModal: false, humanPlayer: 1, ...ui } },
    persist() {}, setTheme() {}, startNew() {}, isCurrent: () => true,
  };
}
function mount() {
  return render(<MemoryRouter><Game /></MemoryRouter>);
}
const cell = (q, r) => screen.getByLabelText(new RegExp(`at ${q},${r}$`));

beforeEach(() => {
  mockSaved = null;
  Element.prototype.scrollIntoView = jest.fn();
  localStorage.clear();
  localStorage.setItem('yinshTwoPlayer', 'true');
  localStorage.setItem('yinshRandomSetup', 'false');
});

function playBoard(rings, markers = []) {
  const state = {};
  rings.forEach(([q, r, player]) => { state[`${q},${r}`] = { type: 'ring', player }; });
  markers.forEach(([q, r, player]) => { state[`${q},${r}`] = { type: 'marker', player }; });
  return new YinshBoard({ initialBoardState: state, initialPhase: 'play', initialPlayer: 1, player1RingsPlaced: 5, player2RingsPlaced: 5 });
}

test('an off-axis destination is rejected without freezing the page', () => {
  restore(playBoard([[0, 0, 1], [3, 2, 2]]));
  mount();
  fireEvent.click(cell(0, 0));
  fireEvent.click(cell(2, -1)); // opposite-sign, unequal deltas: not a hex line; used to loop forever
  expect(screen.getByText(/Move ring/)).toBeTruthy();
  expect(screen.getByLabelText('Empty intersection at 2,-1')).toBeTruthy();
});

test('deselecting a ring clears its destination dots', () => {
  restore(playBoard([[0, 0, 1], [3, 2, 2]]));
  const { container } = mount();
  const dots = () => container.querySelectorAll('circle[opacity="0.8"]').length;
  fireEvent.click(cell(0, 0));
  expect(dots()).toBeGreaterThan(0);
  fireEvent.click(cell(0, 0));
  expect(dots()).toBe(0);
});

test('move history shows the player who actually moved', () => {
  mount();
  fireEvent.click(screen.getAllByRole('button', { name: 'New Game' })[0]);
  const spots = [[0, 0], [1, 1], [2, 2], [-1, 1]];
  spots.forEach(([q, r], i) => {
    const color = i % 2 === 0 ? 'White' : 'Black';
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${color} ring 1 of`) }));
    fireEvent.click(cell(q, r));
  });
  const rows = screen.getAllByText(/^R@/).slice(0, 4);
  const fills = rows.map(el => el.parentElement.querySelector('circle').getAttribute('fill'));
  expect(fills).toEqual([
    'var(--color-piece-white)', 'var(--color-piece-black)', 'var(--color-piece-white)', 'var(--color-piece-black)',
  ]);
});

test('setup tells the player to pick a tray ring first and labels each tray', () => {
  mount();
  fireEvent.click(screen.getAllByRole('button', { name: 'New Game' })[0]);
  expect(screen.getByText(/Select a ring below, then choose an empty intersection/)).toBeTruthy();
  expect(screen.getByText('White: 5 left')).toBeTruthy();
  expect(screen.getByText('Black: 5 left')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'White ring 1 of 5' }));
  expect(screen.getByText(/Choose an empty intersection/)).toBeTruthy();
});

test('switches expose accessible names', () => {
  mount();
  for (const name of ['Two Players', 'Dark Mode', 'Show Valid Moves', 'Random Setup', 'Keep Score', 'Show Move History']) {
    expect(screen.getByRole('switch', { name })).toBeTruthy();
  }
});

test('the settings drawer is a modal dialog with focus management', () => {
  restore(new YinshBoard());
  mount();
  const opener = screen.getByRole('button', { name: 'Settings' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.contains(document.activeElement)).toBe(true);
  // Tab wraps inside the dialog
  const focusables = dialog.querySelectorAll('button');
  focusables[focusables.length - 1].focus();
  fireEvent.keyDown(document.activeElement, { key: 'Tab' });
  expect(document.activeElement).toBe(focusables[0]);
  // The page behind is inert and shortcuts do nothing
  expect(opener.closest('[inert]')).not.toBeNull();
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(opener.closest('[inert]')).toBeNull();
});

test('Escape closes the rules dialog first and returns to the dialog beneath', () => {
  restore(new YinshBoard());
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
});

test('undo shortcut is inert while a dialog is open', () => {
  const board = new YinshBoard();
  board.handleSetupRingClick(1, 0); board.handleClick(0, 0);
  restore(board);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  expect(screen.getByLabelText('White ring at 0,0')).toBeTruthy();
});

test('a drawn exhaustion ending is shown as a draw', () => {
  const board = new YinshBoard();
  board.gamePhase = 'game-over';
  board.scores = { 1: 1, 2: 1 };
  restore(board, { showModal: true });
  mount();
  expect(screen.getByRole('dialog', { name: 'Draw!' })).toBeTruthy();
  expect(screen.getByText(/Rings removed: White 1, Black 1/)).toBeTruthy();
  expect(screen.getByText(/Draw: the marker pool is empty/)).toBeTruthy();
});

test('undoing a counted win and replaying it counts the match once', () => {
  localStorage.setItem('yinshKeepScore', 'true');
  const board = new YinshBoard({
    initialBoardState: { '0,0': { type: 'ring', player: 2 }, '1,1': { type: 'ring', player: 2 } },
    initialPhase: 'remove-ring', initialPlayer: 2, player2Score: 2,
  });
  restore(board);
  mount();
  const wins = () => JSON.parse(localStorage.getItem('yinshWins'));
  fireEvent.click(cell(0, 0));
  expect(wins()).toEqual({ 1: 0, 2: 1 });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  fireEvent.click(cell(0, 0));
  expect(wins()).toEqual({ 1: 0, 2: 1 });
});

test('redoing a counted win after undo counts the match once', () => {
  localStorage.setItem('yinshKeepScore', 'true');
  const board = new YinshBoard({
    initialBoardState: { '0,0': { type: 'ring', player: 2 }, '1,1': { type: 'ring', player: 2 } },
    initialPhase: 'remove-ring', initialPlayer: 2, player2Score: 2,
  });
  restore(board);
  mount();
  const wins = () => JSON.parse(localStorage.getItem('yinshWins'));
  fireEvent.click(cell(0, 0));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(wins()).toEqual({ 1: 0, 2: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(wins()).toEqual({ 1: 0, 2: 1 });
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
  expect(wins()).toEqual({ 1: 0, 2: 1 });
});

test('the home link is readable and does not wrap', () => {
  mount();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  const link = within(document.body).getByRole('link', { name: /Games/ });
  expect(link.className).toMatch(/text-sm/);
  expect(link.className).toMatch(/whitespace-nowrap/);
  expect(link.className).toMatch(/min-h-\[44px\]/);
  expect(link.className).not.toMatch(/opacity-40/);
});
