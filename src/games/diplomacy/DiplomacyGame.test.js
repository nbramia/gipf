// Smoke + integration tests for DiplomacyGame — guards against render-time
// crashes that the pure-logic DiplomacyBoard suite cannot catch (only mounting
// the component exercises the setup screen, SVG map, order panel, and effects).
// Agents are stubbed (no real key in CI); assertions are structural.

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DiplomacyGame from './DiplomacyGame';

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
    // The negotiation phase opens before order entry.
    expect(container.textContent).toContain('Proceed to orders');
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
    const { container } = render(
      <MemoryRouter>
        <DiplomacyGame />
      </MemoryRouter>
    );
    startNewGame();

    fireEvent.click(screen.getByText('Proceed to orders'));
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
