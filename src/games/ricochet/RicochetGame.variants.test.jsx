import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RicochetGame from './RicochetGame.jsx';
import RicochetBoard from './RicochetBoard.js';
import { emptyWalls, cellOf } from './engine/geometry.js';
import { buildBoard, FAR } from './testHelpers.js';
import { recordRound } from './engine/history.js';

const mockWorkers = [];
jest.mock('./hooks/createAIWorker', () => ({
  createAIWorker: () => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    mockWorkers.push(worker);
    return worker;
  },
}));

// The default 16x16 layout of RicochetGame.ui.test.jsx: red from the corner, optimal E then S.
const scripted = () => new RicochetBoard({
  walls: emptyWalls(),
  robots: { red: cellOf(0, 0), green: cellOf(15, 0), blue: cellOf(14, 1), yellow: cellOf(1, 1) },
  targets: [
    { id: 0, color: 'red', shape: 'circle', cell: cellOf(15, 15) },
    { id: 1, color: 'red', shape: 'square', cell: cellOf(8, 0) },
  ],
});
const ROUND = { targetId: 0, length: 2, solution: [{ robot: 'red', dir: 'E' }, { robot: 'red', dir: 'S' }] };

// A green '/' barrier turns a red robot sliding east at (10,6) north, to (0,6).
const barrierBoard = (targetAt) => () => buildBoard({
  robots: { red: [10, 2], ...FAR },
  barriers: [[10, 6, '/', 'green']],
  config: { size: 16, fifthRobot: false, diagonals: true },
  target: { at: targetAt, color: 'red' },
});
const BEND = [cellOf(10, 2), cellOf(10, 6), cellOf(0, 6)];
const BEND_ROUND = (length = 1) => ({ targetId: 0, length, solution: [{ robot: 'red', dir: 'E' }] });

// Five robots on the bare grid; black sits at (5,5).
const blackBoard = () => buildBoard({
  robots: { red: [0, 0], green: [15, 0], blue: [14, 1], yellow: [1, 1], black: [5, 5] },
  config: { size: 16, fifthRobot: true, diagonals: false },
  target: { at: [15, 15], color: 'red' },
});

const mount = (createBoard = scripted) => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <RicochetGame createBoard={createBoard} />
  </MemoryRouter>,
);
const worker = () => mockWorkers[mockWorkers.length - 1];
const lastRequest = () => worker().postMessage.mock.calls.slice(-1)[0][0];
const deliver = (round, requestId = lastRequest().requestId) => act(() => {
  worker().onmessage({ data: { type: 'result', requestId, data: { round } } });
});
const press = (key) => act(() => { fireEvent.keyDown(window, { key }); });
const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });
const stored = (k) => JSON.parse(localStorage.getItem(k));
const planText = () => (screen.queryByRole('list', { name: 'Planned moves' }) || { textContent: '' }).textContent;
const at = (name) => Number(screen.getByTestId(`robot-${name}`).getAttribute('data-cell'));
const centre = (cell, size = 16) => [8 + (cell % size) * 40 + 20, 8 + Math.floor(cell / size) * 40 + 20];
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
const setting = (group, label) => fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name: label }));
const closeDialog = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

beforeEach(() => {
  localStorage.clear();
  mockWorkers.length = 0;
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

describe('ratings per setup in the UI', () => {
  test('a standard Plan round records into ricochetRating and ricochetHistory with no variant field', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown'); press('Enter');
    advance(3000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(stored('ricochetRating').rounds).toBe(1);
    expect(stored('ricochetHistory')).toHaveLength(1);
    expect('variant' in stored('ricochetHistory')[0]).toBe(false);
    expect(localStorage.getItem('ricochetVariantRatings')).toBeNull();
    expect(screen.queryByTestId('hud-setup')).toBeNull();
  });

  test('a Live round records only into its own setup and leaves the standard rating alone', () => {
    localStorage.setItem('ricochetRating', JSON.stringify({ rating: 1500, rounds: 30 }));
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    expect(screen.getByTestId('hud-rating').textContent).toBe('1200'); // the Live setup starts fresh
    expect(screen.getByTestId('hud-setup')).toBeTruthy();
    press('ArrowRight'); press('ArrowDown');
    advance(1000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(stored('ricochetRating')).toEqual({ rating: 1500, rounds: 30 });
    expect(Object.keys(stored('ricochetVariantRatings'))).toEqual(['16-r4-d0-live']);
    const h = stored('ricochetHistory');
    expect(h).toHaveLength(1);
    expect(h[0].variant).toBe('16-r4-d0-live');
    expect(h[0].ratingBefore).toBe(1200);
    expect(screen.getByTestId('hud-rating').textContent).toBe(String(h[0].ratingAfter));
    expect(screen.getByTestId('res-rating').textContent).toMatch(/16×16, Live rating 1200/);
  });

  test('a round on a variant board records under that variant, and dealing uses its rating', () => {
    localStorage.setItem('ricochetRating', JSON.stringify({ rating: 1800, rounds: 60 }));
    localStorage.setItem('ricochetVariantRatings', JSON.stringify({ '12-r4-d0-plan': { rating: 800, rounds: 25 } }));
    mount();
    deliver(ROUND);
    expect(lastRequest().data.desiredLength).toBe(9); // from the standard 1800
    openSettings();
    setting('Board size', '12×12');
    closeDialog();
    expect(lastRequest().data.desiredLength).toBe(2); // from the 12x12 rating of 800
    expect(screen.getByTestId('hud-rating').textContent).toBe('800');
    const state = lastRequest().data.boardState;
    deliver({ targetId: state.targets[0].id, length: 2, solution: [] });
    expect(screen.getByTestId('hud-rating').textContent).toBe('800');
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
    expect(stored('ricochetRating')).toEqual({ rating: 1800, rounds: 60 });
    expect(stored('ricochetHistory')[0].variant).toBe('12-r4-d0-plan');
    expect(stored('ricochetVariantRatings')['12-r4-d0-plan'].rounds).toBe(26);
  });

  test('switching Plan and Live switches the rating shown', () => {
    localStorage.setItem('ricochetRating', JSON.stringify({ rating: 1500, rounds: 30 }));
    mount();
    deliver(ROUND);
    expect(screen.getByTestId('hud-rating').textContent).toBe('1500');
    openSettings();
    setting('Input mode', 'Live');
    expect(screen.getByTestId('hud-rating').textContent).toBe('1200');
    setting('Input mode', 'Plan');
    expect(screen.getByTestId('hud-rating').textContent).toBe('1500');
  });

  test('the progress panel is labelled with the setup and can show others that have history', () => {
    recordRound({ optimal: 3, moves: 3, timeMs: 30000 });
    recordRound({ optimal: 3, moves: 3, timeMs: 30000, variant: '16-r5-d0-live' });
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    expect(screen.getByTestId('progress-setup').textContent).toMatch(/Setup:\s*16×16, Live/);
    const select = screen.getByRole('combobox', { name: 'View setup' });
    expect([...select.options].map(o => o.textContent)).toEqual(['Standard', '16×16, Live', '16×16, black robot, Live']);
    expect(screen.getByTestId('progress-rating').textContent).toBe('1200');
    fireEvent.change(select, { target: { value: 'standard' } });
    expect(screen.getByTestId('progress-setup').textContent).toMatch(/Setup:\s*Standard/);
    expect(screen.getByTestId('progress-rating').textContent).not.toBe('1200');
  });

  test('with only the standard setup there is no selector', () => {
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    expect(screen.getByTestId('progress-setup').textContent).toMatch(/Setup:\s*Standard/);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('variant settings', () => {
  test('the defaults are the standard board and nothing is stored', () => {
    mount();
    deliver(ROUND);
    openSettings();
    expect(within(screen.getByRole('group', { name: 'Board size' })).getByRole('button', { name: '16×16' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Fifth robot' })).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Diagonal barriers' })).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ricochetVariant')).toBeNull();
  });

  test.each([
    ['12×12', 'Board size', '12×12', { size: 12, fifthRobot: false, diagonals: false }],
    ['a black robot', 'Fifth robot', 'Black', { size: 16, fifthRobot: true, diagonals: false }],
    ['barriers', 'Diagonal barriers', 'Diagonals', { size: 16, fifthRobot: false, diagonals: true }],
  ])('turning on %s deals a new board of that shape right away', (_, group, label, config) => {
    mount();
    deliver(ROUND);
    const firstId = lastRequest().requestId;
    openSettings();
    setting(group, label);
    expect(stored('ricochetVariant')).toEqual(config);
    expect(lastRequest().requestId).toBeGreaterThan(firstId);
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    const state = lastRequest().data.boardState;
    expect(state.config).toEqual(config);
    expect(state.walls).toHaveLength(config.size * config.size);
    expect(Object.keys(state.robots)).toEqual(config.fifthRobot ? ['red', 'green', 'blue', 'yellow', 'black'] : ['red', 'green', 'blue', 'yellow']);
    expect(state.barriers.length > 0).toBe(config.diagonals);
    // a late reply for the abandoned round is dropped
    deliver(ROUND, firstId);
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    deliver({ targetId: state.targets[0].id, length: 3, solution: [] });
    closeDialog();
    const svg = screen.getByRole('img', { name: /Ricochet board/ });
    expect(svg.getAttribute('aria-label')).toBe(`Ricochet board, ${config.size} by ${config.size} grid`);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${config.size * 40 + 16} ${config.size * 40 + 16}`);
    expect(screen.queryByTestId('robot-black') !== null).toBe(config.fifthRobot);
    expect(screen.queryAllByTestId('barrier')).toHaveLength(state.barriers.length);
    expect(screen.queryAllByRole('button', { name: /^Select .* robot$/ })).toHaveLength(config.fifthRobot ? 5 : 4);
  });

  test('12×12 has 144 cells, 9 targets and the walled 2x2 centre', () => {
    mount();
    deliver(ROUND);
    openSettings();
    setting('Board size', '12×12');
    const state = lastRequest().data.boardState;
    expect(state.walls).toHaveLength(144);
    expect(state.targets).toHaveLength(9);
    deliver({ targetId: state.targets[0].id, length: 3, solution: [] });
    closeDialog();
    const svg = screen.getByRole('img', { name: /12 by 12/ });
    const checkers = [...svg.querySelectorAll('rect')].filter(r => r.getAttribute('fill') === 'var(--rc-cell-alt)');
    expect(checkers).toHaveLength(72);
    const centreRect = svg.querySelector('[data-center]');
    expect(Number(centreRect.getAttribute('x'))).toBe(8 + 5 * 40);
    expect(Number(centreRect.getAttribute('width'))).toBe(80);
  });

  test('a change never rewrites the current round and is stored for the next visit', () => {
    mount();
    deliver(ROUND);
    press('ArrowRight');
    const before = stored('ricochetHistory');
    openSettings();
    setting('Fifth robot', 'Black');
    expect(stored('ricochetHistory')).toBe(before); // nothing recorded for the dropped round
    expect(stored('ricochetVariant').fifthRobot).toBe(true);
    // a fresh visit reads the stored variant for the board it builds
    const state = lastRequest().data.boardState;
    expect(state.robots.black).toBeDefined();
  });

  test('the default createBoard uses the stored variant; corrupt storage falls back to the default board', () => {
    localStorage.setItem('ricochetVariant', JSON.stringify({ size: 12, fifthRobot: true, diagonals: true }));
    const first = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RicochetGame /></MemoryRouter>,
    );
    expect(lastRequest().data.boardState.config).toEqual({ size: 12, fifthRobot: true, diagonals: true });
    first.unmount();
    localStorage.setItem('ricochetVariant', '{"size":99,"fifthRobot":"yes"}');
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RicochetGame /></MemoryRouter>,
    );
    expect(lastRequest().data.boardState.config).toEqual({ size: 16, fifthRobot: false, diagonals: false });
    expect(lastRequest().data.boardState.walls).toHaveLength(256);
  });

  test('How to play shows the barrier and black robot notes only when those options are on', () => {
    mount();
    deliver(ROUND);
    const help = () => { fireEvent.click(screen.getByRole('button', { name: 'How to play' })); const t = screen.getByRole('dialog').textContent; closeDialog(); return t; };
    const plain = help();
    expect(plain).toMatch(/Four robots sit on a 16 by 16 board/);
    expect(plain).not.toMatch(/black robot/i);
    expect(plain).not.toMatch(/diagonal barrier/i);
    expect(plain).toMatch(/own rating/);
    openSettings();
    setting('Fifth robot', 'Black');
    setting('Diagonal barriers', 'Diagonals');
    setting('Board size', '12×12');
    closeDialog();
    const full = help();
    expect(full).toMatch(/Five robots sit on a 12 by 12 board/);
    expect(full).toMatch(/black robot \(key K\)/i);
    expect(full).toMatch(/diagonal barrier turns any robot of another colour/i);
  });
});

describe('the black robot', () => {
  const pointer = () => {
    if (!window.PointerEvent) {
      window.PointerEvent = class extends MouseEvent {
        constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId; this.isPrimary = init.isPrimary ?? true; }
      };
    }
  };

  test('has a chip, a K label and is in the move chips', () => {
    mount(blackBoard);
    deliver({ targetId: 0, length: 2, solution: [] });
    const chip = screen.getByRole('button', { name: 'Select black robot' });
    expect(chip.textContent).toBe('K');
    expect(screen.getByTestId('robot-black').textContent).toBe('K');
    press('k'); press('ArrowRight');
    expect(document.querySelector('.ricochet-step-black').textContent).toBe('K');
  });

  test.each(['plan', 'live'])('is selected by K, by its chip and by tapping it, and moves in %s mode', (mode) => {
    pointer();
    localStorage.setItem('ricochetInputMode', mode);
    mount(blackBoard);
    deliver({ targetId: 0, length: 2, solution: [] });
    const chip = () => screen.getByRole('button', { name: 'Select black robot' }).getAttribute('aria-pressed');
    expect(chip()).toBe('false');
    press('k');
    expect(chip()).toBe('true');
    press('r');
    expect(chip()).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Select black robot' }));
    expect(chip()).toBe('true');
    press('g');
    const svg = screen.getByRole('img', { name: /Ricochet board/ });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 656, height: 656, right: 656, bottom: 656 });
    const [bx, by] = centre(5 * 16 + 5);
    fireEvent.pointerDown(svg, { clientX: bx, clientY: by });
    fireEvent.pointerUp(svg, { clientX: bx, clientY: by });
    expect(chip()).toBe('true');
    // K then a direction
    press('g'); press('k'); press('ArrowRight');
    if (mode === 'plan') {
      expect(planText()).toBe('K→');
      expect(at('black')).toBe(cellOf(5, 5));
    } else {
      expect(at('black')).toBe(cellOf(5, 15));
    }
  });

  test('K does nothing without the fifth robot', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    press('k');
    expect(screen.getByRole('button', { name: 'Select red robot' }).getAttribute('aria-pressed')).toBe('true');
    press('ArrowRight');
    expect(at('red')).toBe(cellOf(0, 15));
    expect(screen.queryByRole('button', { name: 'Select black robot' })).toBeNull();
  });

  test('moves count, block others and cannot claim a colour target', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount(blackBoard);
    deliver({ targetId: 0, length: 2, solution: [] });
    press('k'); press('ArrowDown'); press('ArrowRight');
    expect(screen.getByTestId('move-count').textContent).toBe('2');
    expect(at('black')).toBe(cellOf(15, 15)); // on the red target, no solve
    expect(screen.queryByRole('region', { name: 'Round results' })).toBeNull();
  });
});

describe('plan mode leaks no legality with barriers and the black robot', () => {
  test('no arrows, no disabled pad, and blocked or bending steps look the same in the plan', () => {
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    expect(document.querySelector('.ricochet-arrow')).toBeNull();
    for (const d of ['north', 'east', 'south', 'west']) {
      expect(screen.getByRole('button', { name: `Move ${d}` }).disabled).toBe(false);
    }
    press('ArrowRight'); // bends at the barrier
    press('ArrowUp'); // red is not at a wall here: legal
    press('g'); press('ArrowDown'); // green is on the south wall: a blocked step
    expect(planText()).toBe('R→R↑G↓');
    expect(at('red')).toBe(cellOf(10, 2));
    expect(document.querySelector('.ricochet-arrow')).toBeNull();
    expect(screen.getByRole('button', { name: 'Move south' }).disabled).toBe(false);
  });

  test('the black robot gives nothing away either', () => {
    mount(blackBoard);
    deliver({ targetId: 0, length: 2, solution: [] });
    press('k');
    expect(document.querySelector('.ricochet-arrow')).toBeNull();
    for (const d of ['north', 'east', 'south', 'west']) {
      expect(screen.getByRole('button', { name: `Move ${d}` }).disabled).toBe(false);
    }
    press('ArrowRight'); press('ArrowUp'); press('ArrowLeft');
    expect(planText()).toBe('K→K↑K←');
  });

  test('nothing about a bending step shows before the plan is submitted', () => {
    localStorage.setItem('ricochetPathTraces', 'on');
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    press('ArrowRight');
    expect(document.querySelector('[data-testid="path-trace"]')).toBeNull();
    expect(at('red')).toBe(cellOf(10, 2));
  });
});

describe('slides follow deflections', () => {
  let animate;
  beforeEach(() => {
    animate = jest.fn();
    Element.prototype.animate = animate;
  });
  afterEach(() => { delete Element.prototype.animate; });

  const expectBend = (call) => {
    const [frames, options] = call;
    expect(frames.map(f => f.transform)).toEqual(BEND.map(c => `translate(${centre(c)[0]}px, ${centre(c)[1]}px)`));
    expect(frames[0].offset).toBe(0);
    expect(frames[2].offset).toBe(1);
    // the corner sits where its share of the route is: 4 cells of 14 along
    expect(frames[1].offset).toBeCloseTo(160 / (160 + 400));
    expect(options.duration).toBeGreaterThan(0);
  };

  test('a live move animates through the barrier corner and ends on the stop cell', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    press('ArrowRight');
    expect(animate).toHaveBeenCalledTimes(1);
    expectBend(animate.mock.calls[0]);
    expect(at('red')).toBe(cellOf(0, 6));
    expect(screen.getByTestId('robot-red').style.transitionDuration).toBe('0ms');
  });

  test('a straight move uses the plain transition and no keyframes', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    press('ArrowUp');
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId('robot-red').style.transitionDuration).not.toBe('0ms');
  });

  test('a plan replay and the Show solution replay follow the deflection too', () => {
    mount(barrierBoard([0, 6]));
    deliver(BEND_ROUND(1));
    press('ArrowRight');
    submit();
    advance(300);
    expect(animate).toHaveBeenCalledTimes(1);
    expectBend(animate.mock.calls[0]);
    advance(3000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show solution' }));
    advance(450);
    expect(animate).toHaveBeenCalledTimes(2);
    expectBend(animate.mock.calls[1]);
  });

  test('without the Web Animations API the robot still reaches the stop cell', () => {
    delete Element.prototype.animate;
    localStorage.setItem('ricochetInputMode', 'live');
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    press('ArrowRight');
    expect(at('red')).toBe(cellOf(0, 6));
    expect(screen.getByTestId('robot-red').style.transitionDuration).not.toBe('0ms');
  });

  test('path traces bend at the barrier in live mode, plan replay and the solution views', () => {
    localStorage.setItem('ricochetPathTraces', 'on');
    localStorage.setItem('ricochetInputMode', 'live');
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    press('ArrowRight');
    const line = () => document.querySelector('[data-testid="path-trace"] .ricochet-trace-line');
    const pts = () => line().getAttribute('points').split(' ').map(p => p.split(',').map(Number));
    expect(pts()).toHaveLength(3);
    expect(pts()[0]).toEqual(centre(BEND[0]));
    expect(pts()[1]).toEqual(centre(BEND[1]));
    expect(document.querySelector('[data-testid="path-trace"]').getAttribute('data-to')).toBe(String(BEND[2]));
  });

  test('plan traces and the optimal trace of a solved round bend too', () => {
    localStorage.setItem('ricochetPathTraces', 'on');
    mount(barrierBoard([0, 6]));
    deliver(BEND_ROUND(1));
    press('ArrowRight');
    submit();
    advance(300);
    const bent = () => [...document.querySelectorAll('[data-testid="path-trace"] .ricochet-trace-line')]
      .map(l => l.getAttribute('points').split(' ').length);
    expect(bent()).toEqual([3]);
    advance(3000);
    expect(bent()).toEqual([3]); // "You"
    fireEvent.click(screen.getByRole('button', { name: 'Show Optimal path trace' }));
    expect(document.querySelectorAll('.ricochet-trace.is-optimal .ricochet-trace-line')).toHaveLength(1);
    expect(bent()).toEqual([3, 3]);
  });
});

describe('barriers on the board', () => {
  test('each barrier shows its orientation, colour and a letter', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount(barrierBoard([3, 3]));
    deliver(BEND_ROUND(2));
    const b = screen.getByTestId('barrier');
    expect(b.getAttribute('data-cell')).toBe(String(cellOf(10, 6)));
    expect(b.getAttribute('data-orient')).toBe('/');
    expect(b.getAttribute('data-color')).toBe('green');
    expect(b.querySelector('.ricochet-barrier-bar').getAttribute('stroke')).toBe('var(--rc-green)');
    expect(b.querySelector('.ricochet-barrier-letter').textContent).toBe('G');
    const bar = b.querySelector('.ricochet-barrier-bar');
    // '/' runs from the lower left to the upper right of its cell
    expect(Number(bar.getAttribute('x1'))).toBeLessThan(Number(bar.getAttribute('x2')));
    expect(Number(bar.getAttribute('y1'))).toBeGreaterThan(Number(bar.getAttribute('y2')));
  });
});

describe('a setup change mid-round deals a fresh puzzle and never records the old round', () => {
  test('Live to Plan after peeking: the old round is dropped, a stale reply is ignored, and the new deal uses the standard rating', () => {
    localStorage.setItem('ricochetRating', JSON.stringify({ rating: 1800, rounds: 60 }));
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    const liveRequest = lastRequest();
    expect(liveRequest.data.desiredLength).toBe(5); // the Live setup starts at 1200
    press('ArrowRight'); // peek
    openSettings();
    setting('Input mode', 'Plan');
    closeDialog();
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    expect(lastRequest().requestId).toBeGreaterThan(liveRequest.requestId);
    expect(lastRequest().data.desiredLength).toBe(9); // from the standard 1800
    expect(at('red')).toBe(cellOf(0, 0)); // the peek was undone
    // the reply for the dropped Live round arrives late
    deliver(ROUND, liveRequest.requestId);
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    press('ArrowRight'); press('ArrowDown'); press('Enter');
    expect(planText()).toBe('');
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown'); press('Enter');
    advance(3000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(stored('ricochetHistory')).toHaveLength(1);
    expect('variant' in stored('ricochetHistory')[0]).toBe(false);
    expect(stored('ricochetRating').rounds).toBe(61);
    expect(localStorage.getItem('ricochetVariantRatings')).toBeNull();
  });

  test('Plan to Live records the next solve under Live only', () => {
    mount();
    deliver(ROUND);
    openSettings();
    setting('Input mode', 'Live');
    closeDialog();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown');
    advance(1000);
    expect(localStorage.getItem('ricochetRating')).toBeNull();
    expect(stored('ricochetHistory')[0].variant).toBe('16-r4-d0-live');
  });

  test('a change while a deal is in flight supersedes it: the stale reply is ignored and the new deal uses the new setup', () => {
    localStorage.setItem('ricochetVariantRatings', JSON.stringify({ '12-r4-d0-plan': { rating: 800, rounds: 25 } }));
    mount();
    const first = lastRequest();
    expect(first.data.desiredLength).toBe(5);
    openSettings();
    setting('Board size', '12×12');
    expect(lastRequest().requestId).toBeGreaterThan(first.requestId);
    expect(lastRequest().data.desiredLength).toBe(2);
    deliver(ROUND, first.requestId);
    expect(screen.getByText('Dealing a puzzle…')).toBeTruthy();
    const state = lastRequest().data.boardState;
    deliver({ targetId: state.targets[0].id, length: 3, solution: [] });
    closeDialog();
    expect(screen.getByRole('img', { name: /12 by 12/ })).toBeTruthy();
  });

  test('a round is recorded under the setup it was dealt for', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal solution' }));
    expect(stored('ricochetHistory')[0].variant).toBe('16-r4-d0-live');
    expect(localStorage.getItem('ricochetRating')).toBeNull();
  });
});

describe('settings are locked while a solve is being shown', () => {
  test('a Live solve that is settling keeps its results; a setting change does nothing then', () => {
    localStorage.setItem('ricochetInputMode', 'live');
    mount();
    deliver(ROUND);
    press('ArrowRight'); press('ArrowDown');
    expect(screen.queryByRole('region', { name: 'Round results' })).toBeNull(); // settling
    const requests = worker().postMessage.mock.calls.length;
    openSettings();
    const board = within(screen.getByRole('group', { name: 'Board size' })).getByRole('button', { name: '12×12' });
    const mode = within(screen.getByRole('group', { name: 'Input mode' })).getByRole('button', { name: 'Plan' });
    expect(board.disabled).toBe(true);
    expect(mode.disabled).toBe(true);
    fireEvent.click(board);
    fireEvent.click(mode);
    expect(localStorage.getItem('ricochetVariant')).toBeNull();
    expect(localStorage.getItem('ricochetInputMode')).toBe('live');
    expect(worker().postMessage.mock.calls.length).toBe(requests);
    closeDialog();
    advance(1000);
    expect(screen.getByRole('region', { name: 'Round results' })).toBeTruthy();
    expect(screen.getByTestId('res-moves').textContent).toBe('2');
    expect(stored('ricochetHistory')).toHaveLength(1);
  });
});

describe('the HUD names a non-standard setup', () => {
  test.each([
    [{ size: 16, fifthRobot: false, diagonals: false }, 'live', 'Live'],
    [{ size: 12, fifthRobot: false, diagonals: false }, 'plan', '12×12'],
    [{ size: 16, fifthRobot: true, diagonals: false }, 'plan', 'Black'],
    [{ size: 16, fifthRobot: false, diagonals: true }, 'plan', 'Barriers'],
    [{ size: 12, fifthRobot: true, diagonals: true }, 'live', '12×12 · Black · Barriers · Live'],
  ])('%j in %s mode', (config, mode, text) => {
    localStorage.setItem('ricochetVariant', JSON.stringify(config));
    localStorage.setItem('ricochetInputMode', mode);
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RicochetGame /></MemoryRouter>);
    const state = lastRequest().data.boardState;
    deliver({ targetId: state.targets[0].id, length: 3, solution: [] });
    expect(screen.getByTestId('hud-setup').textContent).toBe(text);
  });

  test('the standard setup shows no tag', () => {
    mount();
    deliver(ROUND);
    expect(screen.queryByTestId('hud-setup')).toBeNull();
  });
});

describe('barriers are not robots', () => {
  test('no disc or badge, square ends, and each colour has its own bar pattern', () => {
    const board = buildBoard({
      robots: { red: [10, 2], ...FAR },
      barriers: [[3, 3, '/', 'red'], [3, 9, '\\', 'green'], [12, 3, '/', 'blue'], [12, 9, '\\', 'yellow']],
      config: { size: 16, fifthRobot: false, diagonals: true },
      target: { at: [0, 6], color: 'red' },
    });
    localStorage.setItem('ricochetInputMode', 'live');
    mount(() => board);
    deliver(BEND_ROUND(1));
    const bars = screen.getAllByTestId('barrier');
    expect(bars).toHaveLength(4);
    const dashes = new Set();
    for (const b of bars) {
      expect(b.querySelector('circle')).toBeNull();
      expect(b.querySelector('.ricochet-barrier-badge')).toBeNull();
      expect(b.querySelector('.ricochet-barrier-letter').textContent).toBe(b.getAttribute('data-color')[0].toUpperCase());
      dashes.add(b.querySelector('.ricochet-barrier-bar').getAttribute('stroke-dasharray'));
    }
    expect(dashes.size).toBe(4);
  });
});
