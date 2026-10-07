// Smoke + integration tests for DiplomacyGame — guards against render-time
// crashes that the pure-logic DiplomacyBoard suite cannot catch (only mounting
// the component exercises the setup screen, SVG map, order panel, and effects).
// Agents are stubbed (no real key in CI); assertions are structural.

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DiplomacyGame from './DiplomacyGame';
import DiplomacyBoard from './DiplomacyBoard.js';
import { saveGame, loadGame } from './diplomacyPersistence.js';
import { setApiKey } from './agents/agentClient.js';

// Stub the agent layer: no key, empty negotiation, deterministic.
jest.mock('./agents/negotiator.js', () => ({
  runNegotiationPhase: jest.fn(async ({ state }) => ({ state, transcripts: {} })),
}));

// The worker hook uses import.meta.url (ESM-only) which Jest can't parse; mock it
// to the unsupported branch so the game uses the main-thread fallback path.
jest.mock('./hooks/useAIWorker.js', () => ({
  __esModule: true,
  default: () => ({ computeOrders: jest.fn(), isSupported: false }),
}));

beforeEach(() => {
  // Each test starts with no saved game / settings so the setup gate shows.
  localStorage.clear();
  jest.clearAllMocks();
});

function startNewGame() {
  // The setup screen shows first; pick defaults and start.
  fireEvent.click(screen.getByText('Start Game'));
}

describe('DiplomacyGame — setup gate', () => {
  test('shows the setup screen on a fresh mount (no saved game)', () => {
    render(
      <MemoryRouter>
        <DiplomacyGame />
      </MemoryRouter>
    );
    expect(screen.getByText('Choose your power')).toBeTruthy();
    expect(screen.getByText('Start Game')).toBeTruthy();
  });

  test('starting a game renders the map + key state and order entry', () => {
    const { container } = render(
      <MemoryRouter>
        <DiplomacyGame />
      </MemoryRouter>
    );
    startNewGame();

    expect(container.querySelector('.dip-board-svg')).toBeTruthy();
    expect(container.textContent).toContain('Spring 1901 orders');
    // Supply-center standings render as the horizontal chip strip above the map.
    expect(container.querySelectorAll('.dip-score-chip').length).toBe(7);
    // Without a key there is nobody to negotiate with: orders open directly.
    expect(container.textContent).toContain('Submit Orders');
    expect(container.textContent).not.toContain('Proceed to orders');
  });

  test('with a key, the negotiation phase opens before order entry', async () => {
    setApiKey('sk-test');
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    await screen.findByText('Proceed to orders');
    expect(container.textContent).not.toContain('Submit Orders');
  });

  test('draws all province nodes and starting units once a game begins', () => {
    const { container } = render(
      <MemoryRouter>
        <DiplomacyGame />
      </MemoryRouter>
    );
    startNewGame();
    // The canonical 75-province standard map, each drawn from real jDip geometry.
    expect(container.querySelectorAll('.dip-province').length).toBe(75);
    expect(container.querySelectorAll('.dip-unit-group').length).toBe(22);
  });
});

describe('DiplomacyGame — negotiation -> orders flow', () => {
  test('proceeding to orders reveals the order-entry panel', async () => {
    setApiKey('sk-test');
    const { container } = render(
      <MemoryRouter>
        <DiplomacyGame />
      </MemoryRouter>
    );
    startNewGame();

    fireEvent.click(await screen.findByText('Proceed to orders'));
    await waitFor(() => {
      expect(container.textContent).toContain('Submit Orders');
    });
    // Order entry is scoped to the human power only ("Your Orders").
    expect(container.textContent).toContain('Your Orders');
  });
});

describe('DiplomacyGame — layout and dialogs', () => {
  const fs = require('fs');
  const path = require('path');

  test('the status header (Games link, phase, power) precedes the map in the DOM', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    const header = container.querySelector('.dip-status-header');
    const map = container.querySelector('.dip-board-svg');
    expect(header.textContent).toContain('Games');
    expect(header.textContent).toContain('You are');
    expect(header.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('New Game confirmation is a dialog and its wrapper is not forced to position: relative', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    fireEvent.click(screen.getByLabelText('Start a new game'));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.parentElement.classList.contains('dip-overlay')).toBe(true);
    const css = fs.readFileSync(path.join(__dirname, 'diplomacy.css'), 'utf8');
    expect(css).toMatch(/\.game-diplomacy > \*:not\(\.dip-overlay\)\s*\{\s*position: relative/);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  test('the expanded Results Log is a dialog that holds focus', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    fireEvent.click(screen.getByLabelText('Expand results log'));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Results Log');
    expect(dialog.contains(document.activeElement)).toBe(true);
    const items = [...dialog.querySelectorAll('button:not(:disabled), a[href], textarea, input')];
    items[items.length - 1].focus();
    expect(fireEvent.keyDown(items[items.length - 1], { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(items[0]);
    // The Games link and the rest of the page are inert while the dialog is open.
    const link = container.querySelector('.dip-home-link');
    expect(link.closest('[inert]')).toBeTruthy();
    expect(link.closest('[aria-hidden="true"]')).toBeTruthy();
    // Programmatic focus on the background is pulled back in.
    act(() => { container.querySelector('.dip-chat-expand').focus(); });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(container.querySelector('[inert]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #154 decisions
// ---------------------------------------------------------------------------

const AI_ONLY_CONTROLLERS = { austria: 'AI', england: 'human', france: 'AI', germany: 'AI', italy: 'AI', russia: 'AI', turkey: 'AI' };

describe('DiplomacyGame — no-key notice (Q3)', () => {
  test('can be collapsed and expanded, keeping the link only while open', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    const toggle = screen.getByRole('button', { name: 'Collapse' });
    expect(container.textContent).toContain('Playing without an Anthropic API key');
    fireEvent.click(toggle);
    expect(container.textContent).not.toContain('Playing without an Anthropic API key');
    expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(container.textContent).toContain('Playing without an Anthropic API key');
  });

  test('stays collapsed when the game is mounted again without a reload', () => {
    const first = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    first.unmount();
    localStorage.clear();
    const second = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    expect(second.container.textContent).not.toContain('Playing without an Anthropic API key');
    // restore for later tests
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  });
});

describe('DiplomacyGame — turn-limit result (Q4)', () => {
  test('the game-over panel says the turn limit was reached, not that someone won', () => {
    const board = new DiplomacyBoard({ maxYears: 1901 });
    board.season = 'fall';
    board.phase = 'fall-orders';
    board.processOrders({});
    expect(board.phase).toBe('game-over');
    saveGame({ board, uiPhase: 'game-over', controllers: AI_ONLY_CONTROLLERS });
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    const banner = container.querySelector('.dip-gameover-banner');
    expect(banner.textContent).toBe('Turn limit reached \u2014 Russia leads with 4 supply centers');
    expect(container.textContent).not.toContain('Russia wins');
  });

  test('a legacy finished save (no endReason) gets the new wording and its center count', () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    board.supplyCenters = { ...board.supplyCenters, BEL: 'germany', WAR: null };
    board.phase = 'game-over';
    board.winner = 'germany';
    board.winningCenters = 4;
    board.lastAction = 'Germany leads after 5 years.';
    const state = board.serializeState();
    delete state.endReason;
    board.serializeState = () => state;
    saveGame({ board, uiPhase: 'game-over', controllers: AI_ONLY_CONTROLLERS });
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    expect(container.querySelector('.dip-gameover-banner').textContent).toBe('Turn limit reached \u2014 Germany leads with 4 supply centers');
  });

  test('an 18-center game still reads as a win', () => {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    board.supplyCenters = { ...board.supplyCenters };
    DiplomacyBoard.SUPPLY_CENTERS.slice(0, 18).forEach((c) => { board.supplyCenters[c] = 'france'; });
    board.season = 'fall';
    board.phase = 'fall-orders';
    board.units = { PAR: { power: 'france', type: 'army' } };
    board.processOrders({});
    expect(board.endReason).toBe('victory');
    saveGame({ board, uiPhase: 'game-over', controllers: AI_ONLY_CONTROLLERS });
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    expect(container.querySelector('.dip-gameover-banner').textContent).toBe('France wins');
  });
});

describe('DiplomacyGame — retreats with nothing to decide (Q2)', () => {
  function retreatBoard(power) {
    const board = new DiplomacyBoard({ maxYears: 1905 });
    const unit = board.units.BUD || board.units.LON;
    const loc = power === 'austria' ? 'BUD' : 'LON';
    delete board.units[loc];
    board.season = 'fall';
    board.phase = 'fall-retreats';
    // Real options: a legal retreat to an empty neighbouring province.
    board.pendingRetreats = [{ unitLoc: loc, unit: { power, type: 'army' }, options: [power === 'austria' ? 'GAL' : 'WAL'] }];
    return board;
  }

  test('retreats resolve themselves when only AI units must retreat', async () => {
    saveGame({ board: retreatBoard('austria'), uiPhase: 'retreats', controllers: AI_ONLY_CONTROLLERS });
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    await waitFor(() => {
      expect(container.textContent).not.toContain('Fall 1901 retreats');
    });
    expect(container.textContent).not.toContain('Submit Retreats');
    // The AI unit retreated to its option rather than being disbanded.
    const saved = loadGame().board;
    expect(saved.units.GAL).toEqual({ power: 'austria', type: 'army' });
  });

  test('a human unit that must retreat still waits for the player', async () => {
    saveGame({ board: retreatBoard('england'), uiPhase: 'retreats', controllers: AI_ONLY_CONTROLLERS });
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.textContent).toContain('Fall 1901 retreats');
    expect(container.textContent).toContain('Submit Retreats');
  });
});

describe('DiplomacyGame — map zoom and pan (U1)', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  const RealPointerEvent = window.PointerEvent;
  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function rect() {
      return { left: 0, top: 0, width: 1000, height: 740, right: 1000, bottom: 740, x: 0, y: 0 };
    };
    window.PointerEvent = class extends MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    };
  });
  afterAll(() => {
    Element.prototype.getBoundingClientRect = realRect;
    window.PointerEvent = RealPointerEvent;
  });

  const viewBoxOf = (container) => container.querySelector('.dip-board-svg').getAttribute('viewBox').split(' ').map(Number);

  test('zoom in / out / fit buttons change and restore the viewBox', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    const [, , w0] = viewBoxOf(container);
    const fit = screen.getByLabelText('Reset map to fit');
    expect(fit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    const [, , w1] = viewBoxOf(container);
    expect(w1).toBeLessThan(w0);
    expect(fit.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(viewBoxOf(container)[2]).toBeCloseTo(w0, 1);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(fit);
    expect(viewBoxOf(container).slice(0, 3)).toEqual([0, 0, w0]);
  });

  test('the wheel zooms in on desktop', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    const [, , w0] = viewBoxOf(container);
    fireEvent.wheel(container.querySelector('.dip-board-svg'), { deltaY: -200, clientX: 500, clientY: 370 });
    expect(viewBoxOf(container)[2]).toBeLessThan(w0);
  });

  test('dragging the map pans it and does not select a province', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    fireEvent.click(screen.getByLabelText('Zoom in'));
    const svg = container.querySelector('.dip-board-svg');
    const before = viewBoxOf(container);
    const london = screen.getByLabelText('Select unit at London');
    fireEvent.pointerDown(london, { clientX: 500, clientY: 300, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(svg, { clientX: 440, clientY: 300, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(svg, { clientX: 440, clientY: 300, pointerId: 1, pointerType: 'touch' });
    fireEvent.click(london);
    expect(viewBoxOf(container)[0]).not.toBe(before[0]);
    expect(container.querySelector('.dip-map-caption')).toBeNull();
    expect(container.querySelector('.dip-province.is-selected')).toBeNull();
  });

  test('a tap still selects, and the selected province keeps its full name on screen', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    const london = screen.getByLabelText('Select unit at London');
    fireEvent.pointerDown(london, { clientX: 500, clientY: 300, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(container.querySelector('.dip-board-svg'), { clientX: 500, clientY: 300, pointerId: 1, pointerType: 'touch' });
    fireEvent.click(london);
    expect(container.querySelector('.dip-province.is-selected')).toBeTruthy();
    expect(container.querySelector('.dip-map-caption').textContent).toContain('London (LON)');
  });

  test('a two-finger pinch zooms', () => {
    const { container } = render(<MemoryRouter><DiplomacyGame /></MemoryRouter>);
    startNewGame();
    const svg = container.querySelector('.dip-board-svg');
    const [, , w0] = viewBoxOf(container);
    fireEvent.pointerDown(svg, { clientX: 450, clientY: 370, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerDown(svg, { clientX: 550, clientY: 370, pointerId: 2, pointerType: 'touch' });
    fireEvent.pointerMove(svg, { clientX: 350, clientY: 370, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(svg, { clientX: 650, clientY: 370, pointerId: 2, pointerType: 'touch' });
    expect(viewBoxOf(container)[2]).toBeLessThan(w0);
  });
});
