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
  // the optimal line is being replayed; Next puzzle stays available, Show solution does not
  expect(screen.getByRole('button', { name: 'Next puzzle' }).disabled).toBe(false);
  expect(screen.getByRole('button', { name: 'Show solution' }).disabled).toBe(true);
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
  expect(screen.getByTestId('progress-rating').textContent).not.toMatch(/\?/);
  expect(dialog.textContent).toMatch(/provisional/);
  expect(dialog.textContent).toMatch(/2 \/ 2 moves/);
});

test('Ricochet device keys are cleared and retained with the rest of the account progress', () => {
  expect(PROGRESS_KEYS).toEqual(expect.arrayContaining(['ricochetDarkMode', 'ricochetRating', 'ricochetHistory']));
});

test('the HUD and results show a provisional tag instead of a question mark', async () => {
  mount();
  deliver(ROUND);
  expect(screen.getByTestId('hud-rating').textContent).toBe('1200');
  expect(screen.getByText('provisional').getAttribute('title')).toMatch(/20 rounds/);
  press('ArrowRight');
  press('ArrowDown');
  const panel = await results();
  expect(panel.textContent).toMatch(/provisional/);
});

describe('comparing your line with the optimal one', () => {
  const steps = (label) => [...screen.getByRole('list', { name: label }).querySelectorAll('li')];
  test('lists both lines and marks where they diverge', async () => {
    mount();
    deliver(ROUND);
    press('y'); press('ArrowLeft'); press('r'); press('ArrowRight'); press('ArrowDown');
    await results();
    expect(screen.getByRole('list', { name: 'You moves' }).textContent).toBe('Y←R→R↓');
    expect(screen.getByRole('list', { name: 'Optimal moves' }).textContent).toBe('R→R↓');
    expect(steps('You moves').map(li => li.classList.contains('is-diverged'))).toEqual([true, false, false]);
    expect(steps('Optimal moves').map(li => li.classList.contains('is-diverged'))).toEqual([true, false]);
  });
  test('an optimal solve marks nothing', async () => {
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown');
    await results();
    expect(screen.getByRole('list', { name: 'You moves' }).textContent).toBe('R→R↓');
    expect(document.querySelectorAll('.is-diverged')).toHaveLength(0);
  });
  test('give up shows only the optimal line', async () => {
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
    await results();
    expect(screen.queryByRole('list', { name: 'You moves' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Optimal moves' }).textContent).toBe('R→R↓');
  });
});

describe('pointer input on the board', () => {
  const centre = (row, col) => [8 + col * 40 + 20, 8 + row * 40 + 20];
  let svg;
  beforeAll(() => {
    if (!window.PointerEvent) {
      window.PointerEvent = class extends MouseEvent {
        constructor(type, init = {}) {
          super(type, init);
          this.pointerId = init.pointerId;
          this.isPrimary = init.isPrimary ?? true;
        }
      };
    }
  });
  beforeEach(() => {
    mount();
    deliver(ROUND);
    svg = screen.getByRole('img', { name: /Ricochet board/ });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 656, height: 656, right: 656, bottom: 656 });
  });
  const tapAt = ([x, y]) => { fireEvent.pointerDown(svg, { clientX: x, clientY: y }); fireEvent.pointerUp(svg, { clientX: x, clientY: y }); };
  const redCell = () => Number(screen.getByTestId('robot-red').getAttribute('data-cell'));

  test('tapping empty board moves the selected robot along the dominant axis', () => {
    tapAt(centre(1, 12));
    expect(redCell()).toBe(cellOf(0, 15));
    expect(screen.getByTestId('move-count').textContent).toBe('1');
  });
  test('tapping vertically moves along the vertical axis', () => {
    tapAt(centre(9, 2));
    expect(redCell()).toBe(cellOf(14, 0)); // stops against green in the corner
  });
  test('tapping a robot cell selects it and moves nothing', () => {
    tapAt(centre(0, 0));
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    tapAt(centre(1, 1)); // yellow's cell
    expect(screen.getByRole('button', { name: 'Select yellow robot' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('move-count').textContent).toBe('0');
  });
  test('a swipe from a robot slides it in the swipe direction', () => {
    const [x, y] = centre(0, 0);
    fireEvent.pointerDown(svg, { clientX: x, clientY: y });
    fireEvent.pointerUp(svg, { clientX: x + 80, clientY: y + 5 });
    expect(redCell()).toBe(cellOf(0, 15));
  });
  test('a swipe elsewhere moves the selected robot', () => {
    const [x, y] = centre(8, 3);
    fireEvent.pointerDown(svg, { clientX: x, clientY: y });
    fireEvent.pointerUp(svg, { clientX: x + 5, clientY: y + 80 });
    expect(redCell()).toBe(cellOf(14, 0));
  });
  test('right and middle clicks do not move the selected robot', () => {
    for (const button of [1, 2]) {
      fireEvent.pointerDown(svg, { clientX: 628, clientY: 28, button });
      fireEvent.pointerUp(svg, { clientX: 628, clientY: 28, button });
    }
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    expect(redCell()).toBe(cellOf(0, 0));
  });
  test('a second touch does not overwrite the swipe in progress', () => {
    const [x, y] = centre(0, 0);
    fireEvent.pointerDown(svg, { clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 300, pointerId: 2, isPrimary: false });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 300, pointerId: 2, isPrimary: false });
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    fireEvent.pointerUp(svg, { clientX: x + 80, clientY: y, pointerId: 1, isPrimary: true });
    expect(redCell()).toBe(cellOf(0, 15)); // the first finger's swipe still counts
  });
  test('tapping an on-board arrow moves exactly once', () => {
    const arrow = screen.getByTestId('arrow-E');
    fireEvent.pointerDown(arrow, { clientX: 100, clientY: 28 });
    fireEvent.pointerUp(arrow, { clientX: 100, clientY: 28 });
    fireEvent.click(arrow);
    expect(screen.getByTestId('move-count').textContent).toBe('1');
  });
});

describe('solution replay (fake timers)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });
  const at = (name) => Number(screen.getByTestId(`robot-${name}`).getAttribute('data-cell'));

  test('Show solution replays from the start, then restores the solved position', () => {
    mount();
    deliver(ROUND);
    press('y'); press('ArrowLeft'); press('r'); press('ArrowRight'); press('ArrowDown');
    advance(2000);
    expect(at('yellow')).toBe(cellOf(1, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    expect(at('yellow')).toBe(cellOf(1, 1)); // back at the round's start
    expect(at('red')).toBe(cellOf(0, 0));
    advance(500);
    expect(at('red')).toBe(cellOf(0, 15)); // first optimal move
    advance(5000);
    expect(at('red')).toBe(cellOf(15, 15));
    expect(at('yellow')).toBe(cellOf(1, 0)); // the player's own end position again
    expect(screen.getByRole('button', { name: 'Next puzzle' }).disabled).toBe(false);
    expect(history()).toHaveLength(1);
  });

  test('a revealed round ends on the optimal positions and the next round starts from them', () => {
    mount();
    deliver(ROUND);
    press('y'); press('ArrowLeft');
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
    expect(screen.getByRole('button', { name: 'Show solution' }).disabled).toBe(true);
    advance(5000);
    expect(screen.getByRole('button', { name: 'Show solution' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Next puzzle' }).disabled).toBe(false);
    expect(at('red')).toBe(cellOf(15, 15));
    expect(at('yellow')).toBe(cellOf(1, 1)); // the player's yellow move is not kept
    expect(at('green')).toBe(cellOf(15, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }));
    deliver({ targetId: 1, length: 3, solution: [] });
    expect(screen.getByTestId('hud-target').textContent).toMatch(/Red square/);
    expect(at('red')).toBe(cellOf(15, 15));
    expect(at('yellow')).toBe(cellOf(1, 1));
    expect(history()).toHaveLength(1);
  });
});

describe('finished rounds', () => {
  test('the results panel takes the place of the controls, which return with the next round', async () => {
    mount();
    deliver(ROUND);
    expect(screen.getByRole('region', { name: 'Controls' })).toBeTruthy();
    press('ArrowRight'); press('ArrowDown');
    await results();
    expect(screen.queryByRole('region', { name: 'Controls' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next puzzle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }));
    deliver({ targetId: 1, length: 3, solution: [] });
    expect(screen.getByRole('region', { name: 'Controls' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Round results' })).toBeNull();
  });

  test('after a reveal the HUD keeps the player move count, not the replay step', () => {
    jest.useFakeTimers();
    try {
      mount();
      deliver(ROUND);
      press('y'); press('ArrowLeft');
      fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
      act(() => { jest.advanceTimersByTime(1300); });
      expect(screen.getByText(/move 2 of 2/)).toBeTruthy(); // the replay is underway
      expect(screen.getByTestId('move-count').textContent).toBe('1');
      act(() => { jest.advanceTimersByTime(4000); });
      expect(screen.getByTestId('move-count').textContent).toBe('1');
    } finally {
      jest.useRealTimers();
    }
  });

  test('Next puzzle during a Show-solution replay cancels it and keeps the round-end positions', () => {
    jest.useFakeTimers();
    try {
      mount();
      deliver(ROUND);
      const at = (n) => Number(screen.getByTestId(`robot-${n}`).getAttribute('data-cell'));
      press('y'); press('ArrowLeft'); press('r'); press('ArrowRight'); press('ArrowDown');
      act(() => { jest.advanceTimersByTime(2000); });
      fireEvent.click(screen.getByRole('button', { name: 'Show solution' }));
      act(() => { jest.advanceTimersByTime(500); });
      expect(at('red')).toBe(cellOf(0, 15)); // mid-replay
      fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }));
      expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
      expect(at('red')).toBe(cellOf(15, 15));
      expect(at('yellow')).toBe(cellOf(1, 0)); // the player's own end position
      deliver({ targetId: 1, length: 3, solution: [] });
      act(() => { jest.advanceTimersByTime(6000); }); // the cancelled replay must not touch anything
      expect(at('red')).toBe(cellOf(15, 15));
      expect(at('yellow')).toBe(cellOf(1, 0));
      expect(screen.getByTestId('hud-target').textContent).toMatch(/Red square/);
      expect(screen.getByRole('region', { name: 'Controls' })).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('an exhausted pile', () => {
  const seed = 500000001;
  beforeEach(() => { jest.spyOn(Math, 'random').mockReturnValue(0.5); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('needsNewBoard deals a fresh board and then a round on it', async () => {
    const fresh = new RicochetBoard({ seed });
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown');
    await results();
    fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }));
    const firstId = lastRequestId();
    deliver({ needsNewBoard: true });
    // a second request goes out on the new board, with no claimed targets
    expect(lastRequestId()).toBeGreaterThan(firstId);
    const sent = worker().postMessage.mock.calls.slice(-1)[0][0].data.boardState;
    expect(sent.seed).toBe(seed);
    expect(sent.claimed).toEqual([]);
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();

    deliver({ targetId: 3, length: 4, solution: [] });
    expect(screen.queryByText('Dealing a puzzle…')).toBeNull();
    const t = fresh.targets[3];
    expect(screen.getByTestId('hud-target').textContent.toLowerCase()).toContain(t.color ? `${t.color} ${t.shape}` : 'vortex');
    for (const name of ['red', 'green', 'blue', 'yellow']) {
      expect(Number(screen.getByTestId(`robot-${name}`).getAttribute('data-cell'))).toBe(fresh.robots[name]);
    }
    expect(history()).toHaveLength(1);
  });

  test('a second needsNewBoard in a row shows an error, and Try again deals again', async () => {
    mount();
    deliver({ needsNewBoard: true });
    deliver({ needsNewBoard: true });
    expect(screen.getByRole('alert').textContent).toMatch(/Could not find a puzzle/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    deliver({ targetId: 0, length: 3, solution: [] });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: 'Controls' })).toBeTruthy();
  });
});

describe('undo and reset', () => {
  const redCell = () => Number(screen.getByTestId('robot-red').getAttribute('data-cell'));
  test('undo is unavailable at the start of a round and never reaches into the previous one', async () => {
    mount();
    deliver(ROUND);
    expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(true);
    press('u');
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    expect(screen.getByTestId('hud-target').textContent).toMatch(/Red circle/);
    press('ArrowRight'); press('ArrowDown');
    await results();
    fireEvent.click(screen.getByRole('button', { name: 'Next puzzle' }));
    deliver({ targetId: 1, length: 3, solution: [] });
    expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(true);
    press('Backspace');
    expect(screen.getByTestId('hud-target').textContent).toMatch(/Red square/);
    expect(redCell()).toBe(cellOf(15, 15));
  });
  test('undo after reset restores the moves from before the reset', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight');
    press('Escape');
    expect(screen.getByTestId('move-count').textContent).toBe('0');
    expect(redCell()).toBe(cellOf(0, 0));
    expect(screen.getByRole('button', { name: 'Undo' }).disabled).toBe(false);
    press('u');
    expect(screen.getByTestId('move-count').textContent).toBe('1');
    expect(redCell()).toBe(cellOf(0, 15));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('move-count').textContent).toBe('1');
  });
});

describe('progress panel', () => {
  const revealed = (at) => ({
    at, optimal: 3, moves: 0, timeMs: 5000, revealed: true, quality: 0, pace: 1, score: 0, ratingBefore: 1200, ratingAfter: 1190,
  });
  test('shows a dash, not 0%, when no recent round was solved', () => {
    localStorage.setItem('ricochetHistory', JSON.stringify([revealed(1), revealed(2)]));
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    const dialog = screen.getByRole('dialog', { name: 'Progress' });
    expect(dialog.textContent).toMatch(/–Avg quality/);
    expect(dialog.textContent).toMatch(/–Sec per optimal move/);
    expect(dialog.textContent).not.toMatch(/0\.0/);
  });
  test('history is read when the panel opens, not on every clock tick', () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(Storage.prototype, 'getItem');
    try {
      mount();
      deliver(ROUND);
      fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
      const reads = () => spy.mock.calls.filter(([k]) => k === 'ricochetHistory').length;
      const before = reads();
      expect(before).toBeGreaterThan(0);
      act(() => { jest.advanceTimersByTime(2000); });
      expect(reads()).toBe(before);
    } finally {
      spy.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe('dealing that never finishes', () => {
  test('after 8 seconds the error state offers Try again', () => {
    jest.useFakeTimers();
    try {
      mount();
      act(() => { jest.advanceTimersByTime(7900); });
      expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(200); });
      expect(screen.getByRole('alert').textContent).toMatch(/taking too long/);
      expect(worker().terminate).toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
      deliver(ROUND);
      expect(screen.getByRole('region', { name: 'Controls' })).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
  test('a round dealt in time is not turned into an error later', () => {
    jest.useFakeTimers();
    try {
      mount();
      deliver(ROUND);
      act(() => { jest.advanceTimersByTime(20000); });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
