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
const pressTogether = (...keys) => act(() => { keys.forEach(key => fireEvent.keyDown(window, { key })); });
const history = () => JSON.parse(localStorage.getItem('ricochetHistory') || '[]');
const results = () => screen.findByRole('region', { name: 'Round results' });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ricochetInputMode', 'live'); // the older tests exercise live mode; plan mode has its own suite
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
  expect(PROGRESS_KEYS).toEqual(expect.arrayContaining(['ricochetDarkMode', 'ricochetInputMode', 'ricochetRating', 'ricochetHistory']));
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
  test('after 15 seconds the error state offers Try again', () => {
    jest.useFakeTimers();
    try {
      mount();
      act(() => { jest.advanceTimersByTime(14900); });
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

describe('plan mode (the default)', () => {
  const at = (name) => Number(screen.getByTestId(`robot-${name}`).getAttribute('data-cell'));
  const planText = () => (screen.queryByRole('list', { name: 'Planned moves' }) || { textContent: '' }).textContent;
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });

  beforeEach(() => {
    localStorage.removeItem('ricochetInputMode');
    jest.useFakeTimers();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('plan mode is the default and entering steps leaves the robots where they are', () => {
    mount();
    deliver(ROUND);
    expect(screen.getByRole('region', { name: 'Plan' })).toBeTruthy();
    press('ArrowRight'); press('ArrowDown'); press('g'); press('ArrowUp');
    expect(planText()).toBe('R→R↓G↑');
    expect(screen.getByTestId('plan-count').textContent).toMatch(/3 steps/);
    expect(screen.getByTestId('move-count').textContent).toBe('3');
    expect(at('red')).toBe(cellOf(0, 0));
    expect(at('green')).toBe(cellOf(15, 0));
    // the pad and a tap on the board append too, still without moving anything
    fireEvent.click(screen.getByRole('button', { name: 'Move west' }));
    expect(planText()).toBe('R→R↓G↑G←');
    expect(at('green')).toBe(cellOf(15, 0));
    expect(history()).toHaveLength(0);
  });

  test('tapping and swiping the board append steps without moving robots', () => {
    if (!window.PointerEvent) {
      window.PointerEvent = class extends MouseEvent {
        constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId; this.isPrimary = init.isPrimary ?? true; }
      };
    }
    mount();
    deliver(ROUND);
    const svg = screen.getByRole('img', { name: /Ricochet board/ });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 656, height: 656, right: 656, bottom: 656 });
    fireEvent.pointerDown(svg, { clientX: 508, clientY: 28 });
    fireEvent.pointerUp(svg, { clientX: 508, clientY: 28 });
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 380 });
    expect(planText()).toBe('R→R↓');
    expect(at('red')).toBe(cellOf(0, 0));
  });

  test('a robot key and a direction in the same tick use the new robot', () => {
    mount();
    deliver(ROUND);
    pressTogether('g', 'ArrowUp');
    expect(planText()).toBe('G↑');
  });

  test('no legality hints: no on-board arrows and every pad direction is enabled', () => {
    mount();
    deliver(ROUND);
    expect(screen.queryByTestId('arrow-E')).toBeNull();
    for (const d of ['north', 'east', 'south', 'west']) {
      expect(screen.getByRole('button', { name: `Move ${d}` }).disabled).toBe(false);
    }
    expect(screen.getByRole('button', { name: 'Select red robot' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('Backspace and U remove one step, Escape clears the plan', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown'); press('ArrowLeft');
    press('Backspace');
    expect(planText()).toBe('R→R↓');
    press('u');
    expect(planText()).toBe('R→');
    press('ArrowDown');
    press('Escape');
    expect(screen.queryByRole('list', { name: 'Planned moves' })).toBeNull();
    expect(screen.getByTestId('plan-count').textContent).toMatch(/0 steps/);
    expect(screen.getByRole('button', { name: 'Submit' }).disabled).toBe(true);
  });

  test('a submit that reaches the target solves the round and records one entry', async () => {
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown');
    submit();
    advance(300);
    expect(at('red')).toBe(cellOf(0, 15)); // replayed at about 0.3 s per step
    expect(history()).toHaveLength(1); // recorded at submission
    advance(300);
    expect(at('red')).toBe(cellOf(15, 15));
    advance(1000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ moves: 2, optimal: 2, revealed: false });
    expect(screen.getByTestId('res-moves').textContent).toBe('2');
  });

  test('replay runs at about 0.3 s per step and ignores input while it plays', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown');
    press('Enter');
    advance(299);
    expect(at('red')).toBe(cellOf(0, 0));
    advance(1);
    expect(at('red')).toBe(cellOf(0, 15));
    press('ArrowLeft'); press('Backspace');
    expect(screen.getByTestId('plan-count').textContent).toMatch(/2 steps/);
  });

  test('only the steps up to the solving step count, and the You line shows just those', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown'); press('ArrowLeft'); press('ArrowUp');
    submit();
    advance(3000);
    expect(history()).toHaveLength(1);
    expect(history()[0].moves).toBe(2);
    expect(screen.getByRole('list', { name: 'You moves' }).textContent).toBe('R→R↓');
  });

  test('blocked steps count as moves', () => {
    mount();
    deliver(ROUND);
    press('ArrowUp'); // red is against the top wall: blocked
    press('ArrowRight'); press('ArrowDown');
    submit();
    advance(300);
    expect(screen.getByTestId('robot-red').querySelector('[data-bump]').getAttribute('data-bump')).toBe('N');
    advance(3000);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ moves: 3, optimal: 2 });
    expect(screen.getByRole('list', { name: 'You moves' }).textContent).toBe('R↑R→R↓');
  });

  test('a failed submit records nothing, returns to the start, and keeps the plan', () => {
    mount();
    deliver(ROUND);
    advance(2000);
    press('ArrowRight');
    submit();
    advance(300);
    expect(at('red')).toBe(cellOf(0, 15));
    advance(500);
    expect(at('red')).toBe(cellOf(0, 15)); // final position is held for a moment
    advance(400);
    expect(at('red')).toBe(cellOf(0, 0)); // then snaps back
    expect(planText()).toBe('R→');
    expect(history()).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Round results' })).toBeNull();
    // the clock kept running and the plan can be edited and resubmitted
    expect(Number(screen.getByTestId('clock').textContent.split(':')[1])).toBeGreaterThanOrEqual(3);
    press('ArrowDown');
    submit();
    advance(4000);
    expect(history()).toHaveLength(1);
    expect(history()[0].moves).toBe(2);
    expect(history()[0].timeMs).toBeGreaterThan(3000); // the failed attempt's time is not discarded
  });

  test('a failed submit does not stop the clock or lose time', () => {
    mount();
    deliver(ROUND);
    advance(5000);
    press('ArrowRight');
    submit();
    advance(3000);
    expect(screen.getByTestId('clock').textContent).toBe('0:08');
  });

  test('reduced motion makes the replay near-instant', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    try {
      mount();
      deliver(ROUND);
      press('ArrowRight'); press('ArrowDown');
      submit();
      advance(150);
      expect(at('red')).toBe(cellOf(15, 15));
      advance(400);
      expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    } finally {
      delete window.matchMedia;
    }
  });

  test('Give up works from a plan and records the entered steps', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight');
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
    advance(5000);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ revealed: true, moves: 1 });
    expect(at('red')).toBe(cellOf(15, 15));
  });

  test('switching to live mode in Settings keeps the original behaviour', () => {
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(localStorage.getItem('ricochetInputMode')).toBe('live');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Plan' })).toBeNull();
    press('ArrowRight');
    expect(at('red')).toBe(cellOf(0, 15)); // moves immediately
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(screen.getByTestId('arrow-S')).toBeTruthy();
  });

  test('the stored choice is honoured, and switching back to plan resets the round', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    press('ArrowRight');
    expect(at('red')).toBe(cellOf(0, 15));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    expect(localStorage.getItem('ricochetInputMode')).toBe('plan');
    expect(at('red')).toBe(cellOf(0, 0));
  });
});

describe('final hardening', () => {
  const at = (name) => Number(screen.getByTestId(`robot-${name}`).getAttribute('data-cell'));
  const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });

  describe('plan mode', () => {
    beforeEach(() => { localStorage.removeItem('ricochetInputMode'); jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    test('a mouse press on a game control does not take focus, so Enter still submits', () => {
      mount();
      deliver(ROUND);
      const controls = [
        screen.getByRole('button', { name: 'Select red robot' }),
        screen.getByRole('button', { name: 'Move east' }),
        screen.getByRole('button', { name: 'Move south' }),
      ];
      for (const b of controls) expect(fireEvent.mouseDown(b)).toBe(false); // default (focus) prevented
      fireEvent.click(controls[0]); fireEvent.click(controls[1]); fireEvent.click(controls[2]);
      expect(screen.getByRole('list', { name: 'Planned moves' }).textContent).toBe('R→R↓');
      for (const name of ['Undo', 'Clear', 'Submit']) {
        expect(fireEvent.mouseDown(screen.getByRole('button', { name }))).toBe(false);
      }
      press('Enter');
      advance(3000);
      expect(history()).toHaveLength(1);
      expect(history()[0].moves).toBe(2);
    });

    test('keyboard activation of a focused control is untouched by the Enter shortcut', () => {
      mount();
      deliver(ROUND);
      press('ArrowRight');
      const chip = screen.getByRole('button', { name: 'Select green robot' });
      act(() => { fireEvent.keyDown(chip, { key: 'Enter' }); }); // a focused button handles its own Enter
      expect(history()).toHaveLength(0);
      expect(screen.getByTestId('plan-count').textContent).toMatch(/1 step/);
    });

    test('two Enters in one tick record the solve once', () => {
      mount();
      deliver(ROUND);
      press('ArrowRight'); press('ArrowDown');
      pressTogether('Enter', 'Enter');
      advance(3000);
      expect(history()).toHaveLength(1);
    });

    test('the recorded time is the moment of submission, not the end of the replay', () => {
      mount();
      deliver(ROUND);
      advance(2000);
      press('ArrowRight'); press('ArrowDown');
      press('Enter');
      advance(5000); // replay and results
      expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
      expect(history()[0].timeMs).toBe(2000);
    });

    test('a failed submit shows a visible message until the plan is edited', () => {
      mount();
      deliver(ROUND);
      press('ArrowRight');
      press('Enter');
      advance(3000);
      expect(screen.getByTestId('plan-notice').textContent).toMatch(/Not solved/);
      press('ArrowDown');
      expect(screen.queryByTestId('plan-notice')).toBeNull();
    });

    test('the results panel sits directly in the side column, with no empty controls around it', () => {
      mount();
      deliver(ROUND);
      press('ArrowRight'); press('ArrowDown'); press('Enter');
      advance(3000);
      const panel = screen.getByRole('region', { name: 'Round results' });
      expect(panel.parentElement.classList.contains('ricochet-side')).toBe(true);
      expect(panel.parentElement.children).toHaveLength(1);
    });
  });

  test('Try again after a dealing timeout can still retry on a fresh board', () => {
    jest.useFakeTimers();
    try {
      mount();
      deliver({ needsNewBoard: true }); // the retry on a fresh board is now pending
      advance(15100);
      expect(screen.getByRole('alert').textContent).toMatch(/taking too long/);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      deliver({ needsNewBoard: true });
      expect(screen.queryByRole('alert')).toBeNull(); // a fresh board is tried, not an immediate error
      expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
      expect(worker().postMessage.mock.calls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('no spoilers and input hygiene in plan mode', () => {
  const planText = () => (screen.queryByRole('list', { name: 'Planned moves' }) || { textContent: '' }).textContent;
  const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });
  const statusText = () => document.querySelector('.ricochet-sr').textContent;
  beforeEach(() => { localStorage.removeItem('ricochetInputMode'); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a failed submit shows its message only after the replay and the hold', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight');
    press('Enter');
    expect(screen.queryByTestId('plan-notice')).toBeNull();
    expect(statusText()).not.toMatch(/Not solved/);
    advance(300); // the step plays
    expect(screen.queryByTestId('plan-notice')).toBeNull();
    advance(700); // still holding the final position
    expect(screen.queryByTestId('plan-notice')).toBeNull();
    expect(statusText()).not.toMatch(/Not solved/);
    advance(200); // hold over, the board snaps back
    expect(screen.getByTestId('plan-notice').textContent).toMatch(/Not solved/);
    expect(statusText()).toMatch(/Not solved/);
  });

  test('a solving submit does not move the clock, rating or status until the replay ends', () => {
    mount();
    deliver(ROUND);
    advance(2000);
    press('ArrowUp'); press('ArrowRight'); press('ArrowDown'); // a blocked step, then the solve at step 3
    press('Enter');
    advance(1000); // the clock keeps running during a solving replay exactly as during a failing one
    expect(screen.getByTestId('clock').textContent).toBe('0:03');
    expect(screen.getByTestId('hud-rating').textContent).toBe('1200');
    expect(statusText()).not.toMatch(/Solved/);
    advance(2000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(screen.getByTestId('hud-rating').textContent).not.toBe('1200');
    expect(statusText()).toMatch(/Solved in 3/);
    expect(history()[0].timeMs).toBe(2000);
    expect(screen.getByTestId('clock').textContent).toBe('0:02'); // frozen at the submission time
  });

  test('a step and Enter in the same tick submit the step', () => {
    mount();
    deliver(ROUND);
    pressTogether('ArrowRight', 'ArrowDown', 'Enter');
    advance(3000);
    expect(history()).toHaveLength(1);
    expect(history()[0].moves).toBe(2);
  });

  test('a held key (auto-repeat) neither appends steps nor submits', () => {
    mount();
    deliver(ROUND);
    act(() => { for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true }); });
    expect(planText()).toBe('');
    press('ArrowRight');
    act(() => { fireEvent.keyDown(window, { key: 'Enter', repeat: true }); });
    advance(2000);
    expect(planText()).toBe('R→');
    expect(screen.queryByTestId('plan-notice')).toBeNull();
  });

  test('nothing appends to the plan during or after a replay', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight');
    press('Enter');
    press('ArrowDown'); // during the replay
    fireEvent.click(screen.getByRole('button', { name: 'Move west' }));
    expect(planText()).toBe('R→');
    advance(3000);
    expect(planText()).toBe('R→'); // the replay did not re-use the append path
    expect(screen.getByTestId('plan-count').textContent).toMatch(/1 step\b/);
  });

  test('a press that began on the board but ended elsewhere does not pair with a later release', () => {
    if (!window.PointerEvent) {
      window.PointerEvent = class extends MouseEvent {
        constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId; this.isPrimary = init.isPrimary ?? true; }
      };
    }
    mount();
    deliver(ROUND);
    const svg = screen.getByRole('img', { name: /Ricochet board/ });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 656, height: 656, right: 656, bottom: 656 });
    fireEvent.pointerDown(svg, { clientX: 28, clientY: 28 });
    fireEvent.pointerUp(document.body, { clientX: 900, clientY: 28 }); // released off the board
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 300 }); // an unrelated release over the board
    expect(planText()).toBe('');
  });

  test('How to play names both input modes explicitly', () => {
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    const text = screen.getByRole('dialog', { name: 'How to play' }).textContent;
    expect(text).toMatch(/Plan \(default\): moves are hidden until you submit/);
    expect(text).toMatch(/Live: robots move as you enter moves/);
  });
});
