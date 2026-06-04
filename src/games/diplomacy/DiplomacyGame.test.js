// Smoke + integration tests for DiplomacyGame — guards against render-time
// crashes that the pure-logic DiplomacyBoard suite cannot catch (only mounting
// the component exercises the setup screen, SVG map, order panel, and effects).
// Agents are stubbed (no real key in CI); assertions are structural.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    expect(container.textContent).toContain('Supply Centers');
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
