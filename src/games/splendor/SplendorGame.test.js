import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SplendorBoard from './SplendorBoard.js';

// The real hook spins up a module Worker; replace it with a controllable stub.
const mockComputeMove = jest.fn();
const mockCancel = jest.fn();
jest.mock('./hooks/useAIWorker.js', () => ({
  __esModule: true,
  default: () => ({ computeMove: mockComputeMove, cancel: mockCancel, isSupported: true }),
}));

// eslint-disable-next-line import/first
import SplendorGame from './SplendorGame.jsx';

function renderGame() {
  return render(<MemoryRouter><SplendorGame /></MemoryRouter>);
}

// Get the AI to have an outstanding request: if it is the human's turn, take tokens first.
async function reachPendingAIRequest() {
  const status = () => document.querySelector('.spl-status-text').textContent;
  if (status() === 'Your turn.') {
    for (const gem of ['Diamond', 'Sapphire', 'Emerald']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${gem}: `) }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  }
  await waitFor(() => expect(mockComputeMove).toHaveBeenCalled(), { timeout: 3000 });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('splendorPlayerCount', '2');
  mockComputeMove.mockClear();
  mockCancel.mockClear();
});

describe('Splendor game shell', () => {
  test('an AI reply for a previous match is discarded after New Game', async () => {
    renderGame();
    await reachPendingAIRequest();
    const [state, , onSuccess] = mockComputeMove.mock.calls[0];
    const staleMove = SplendorBoard.fromSerializedState(state).getLegalMoves()[0];

    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
    expect(mockCancel).toHaveBeenCalled();
    expect(document.querySelectorAll('.spl-log li')).toHaveLength(0);

    act(() => { onSuccess(staleMove); });

    expect(document.querySelectorAll('.spl-log li')).toHaveLength(0);
  });

  test('clicking the already-selected player count keeps the match', async () => {
    renderGame();
    await reachPendingAIRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const market = () => document.querySelector('.spl-market').innerHTML;
    const before = market();

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    expect(market()).toBe(before);
  });
});
