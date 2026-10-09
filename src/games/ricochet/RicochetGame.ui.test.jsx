import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RicochetGame from './RicochetGame.jsx';
import { PROGRESS_KEYS } from '../../account.js';
import RicochetBoard from './RicochetBoard.js';
import { emptyWalls, cellOf } from './engine/geometry.js';

const mockWorkers = [];
jest.mock('./hooks/createAIWorker', () => ({
  createAIWorker: () => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    mockWorkers.push(worker);
    return worker;
  },
}));

// Bare grid. Red starts at the top-left corner; the first target is the
// bottom-right corner, reachable only as East then South (optimal 2). A second
// target at the bottom-left serves the follow-up round.
const scripted = () => new RicochetBoard({
  walls: emptyWalls(),
  robots: { red: cellOf(0, 0), green: cellOf(15, 0), blue: cellOf(14, 1), yellow: cellOf(1, 1) },
  targets: [
    { id: 0, color: 'red', shape: 'circle', cell: cellOf(15, 15) },
    { id: 1, color: 'red', shape: 'square', cell: cellOf(8, 0) },
  ],
});
const ROUND = { targetId: 0, length: 2, solution: [{ robot: 'red', dir: 'E' }, { robot: 'red', dir: 'S' }] };

const mount = () => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <RicochetGame createBoard={scripted} />
  </MemoryRouter>,
);
const worker = () => mockWorkers[mockWorkers.length - 1];
const lastRequestId = () => worker().postMessage.mock.calls.slice(-1)[0][0].requestId;
const deliver = (round, requestId = lastRequestId()) => act(() => {
  worker().onmessage({ data: { type: 'result', requestId, data: { round } } });
});
const press = (key) => act(() => { fireEvent.keyDown(window, { key }); });
const history = () => JSON.parse(localStorage.getItem('ricochetHistory') || '[]');
const results = () => screen.findByRole('region', { name: 'Round results' });

beforeEach(() => {
  localStorage.clear();
  mockWorkers.length = 0;
  jest.useRealTimers();
});

test('a dealt round is shown, with the target in the HUD and on the board', async () => {
  mount();
  expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
  expect(worker().postMessage.mock.calls[0][0].type).toBe('next');
  deliver(ROUND);
  expect(screen.queryByText('Dealing a puzzle…')).toBeNull();
  expect(screen.getByTestId('hud-target').textContent).toMatch(/Red circle/);
  expect(screen.getByTestId('current-target')).toBeTruthy();
});

test('solving by keyboard records exactly one history entry with the player moves and the optimal', async () => {
  mount();
  deliver(ROUND);
  press('ArrowRight');
  expect(screen.getByTestId('move-count').textContent).toBe('1');
  press('s');
  const panel = await results();
  expect(panel.textContent).toMatch(/Solved/);
  expect(screen.getByTestId('res-moves').textContent).toBe('2');
  expect(screen.getByTestId('res-optimal').textContent).toBe('2');
  expect(screen.getByTestId('res-score').textContent).toMatch(/%$/);
  const h = history();
  expect(h).toHaveLength(1);
  expect(h[0]).toMatchObject({ moves: 2, optimal: 2, revealed: false });
  // keys after the solve change nothing and add nothing
  press('ArrowLeft');
  expect(history()).toHaveLength(1);
});

test('solving by clicking a robot and the on-board arrows records one entry', async () => {
  mount();
  deliver(ROUND);
  fireEvent.click(screen.getByTestId('robot-blue'));
  expect(screen.getByRole('button', { name: 'Select blue robot' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByTestId('robot-red'));
  fireEvent.click(screen.getByTestId('arrow-E'));
  fireEvent.click(screen.getByTestId('arrow-S'));
  await results();
  expect(history()).toHaveLength(1);
  expect(history()[0]).toMatchObject({ moves: 2, optimal: 2 });
});

test('only legal directions are offered for the selected robot', async () => {
  mount();
  deliver(ROUND);
  // red sits in the top-left corner: it can go East and South only
  expect(screen.queryByTestId('arrow-N')).toBeNull();
  expect(screen.queryByTestId('arrow-W')).toBeNull();
  expect(screen.getByTestId('arrow-E')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Move north' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Move east' }).disabled).toBe(false);
});

test('give up asks first, then records a revealed zero-score entry', async () => {
  mount();
  deliver(ROUND);
  press('ArrowRight');
  fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(history()).toHaveLength(0);
  expect(screen.queryByRole('region', { name: 'Round results' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
  const panel = await results();
  expect(panel.textContent).toMatch(/Solution revealed/);
  expect(history()).toHaveLength(1);
  expect(history()[0]).toMatchObject({ revealed: true, score: 0, optimal: 2 });
  expect(screen.getByTestId('res-score').textContent).toBe('0%');
  // the optimal line is being replayed: Next puzzle waits for it
  expect(screen.getByRole('button', { name: 'Next puzzle' }).disabled).toBe(true);
});

describe('with fake timers', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });

  test('undo and reset neither stop the clock nor record anything', () => {
    mount();
    deliver(ROUND);
    advance(3000);
    expect(screen.getByTestId('clock').textContent).toBe('0:03');
    press('ArrowRight');
    expect(screen.getByTestId('move-count').textContent).toBe('1');
    press('u');
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    expect(history()).toHaveLength(0);
    advance(2000);
    expect(screen.getByTestId('clock').textContent).toBe('0:05');
  });

  test('reset puts the robots back and the clock keeps running', () => {
    mount();
    deliver(ROUND);
    advance(2000);
    press('ArrowRight');
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(0, 15)));
    press('Escape');
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    expect(screen.getByTestId('robot-red').getAttribute('data-cell')).toBe(String(cellOf(0, 0)));
    advance(2000);
    expect(screen.getByTestId('clock').textContent).toBe('0:04');
    expect(history()).toHaveLength(0);
  });

  test('time while the tab is hidden is excluded from the recorded time', () => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const setVisibility = (v) => act(() => { visibility = v; document.dispatchEvent(new Event('visibilitychange')); });
    try {
      mount();
      deliver(ROUND);
      advance(3000);
      setVisibility('hidden');
      advance(60000);
      setVisibility('visible');
      advance(2000);
      press('ArrowRight');
      press('ArrowDown');
      expect(history()).toHaveLength(1);
      expect(history()[0].timeMs).toBe(5000);
    } finally {
      delete document.visibilityState;
    }
  });

  test('a stale worker reply after Next puzzle is ignored', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight');
    press('ArrowDown');
    advance(2000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    const firstId = lastRequestId();
    fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }));
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    expect(lastRequestId()).toBeGreaterThan(firstId);

    // a late duplicate of the first request's answer (its target is already claimed)
    deliver(ROUND, firstId);
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    expect(screen.queryByTestId('current-target')).toBeNull();

    deliver({ targetId: 1, length: 3, solution: [] });
    expect(screen.queryByText('Dealing a puzzle…')).toBeNull();
    expect(screen.getByTestId('hud-target').textContent).toMatch(/Red square/);
    expect(screen.getByTestId('move-count').textContent).toBe('0');
  });
});

test('the dark mode choice is stored under ricochetDarkMode', () => {
  const { container } = mount();
  expect(container.querySelector('.game-ricochet').classList.contains('dark')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
  expect(localStorage.getItem('ricochetDarkMode')).toBe('false');
  expect(container.querySelector('.game-ricochet').classList.contains('dark')).toBe(false);
});

test('overlays take focus, close on Escape and give focus back', () => {
  mount();
  deliver(ROUND);
  const opener = screen.getByRole('button', { name: 'How to play' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'How to play' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(dialog.textContent).toMatch(/Alex Randolph/);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('the progress panel shows rating, the provisional marker and recent rounds', async () => {
  mount();
  deliver(ROUND);
  press('ArrowRight');
  press('ArrowDown');
  await results();
  fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
  const dialog = screen.getByRole('dialog', { name: 'Progress' });
  expect(screen.getByTestId('progress-rating').textContent).toMatch(/\?$/);
  expect(dialog.textContent).toMatch(/2 \/ 2 moves/);
});

test('Ricochet device keys are cleared and retained with the rest of the account progress', () => {
  expect(PROGRESS_KEYS).toEqual(expect.arrayContaining(['ricochetDarkMode', 'ricochetRating', 'ricochetHistory']));
});
