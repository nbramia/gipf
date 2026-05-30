// Smoke test for ChessGame — guards against render-time crashes (e.g. the TDZ
// bug where the AI useEffect referenced coachOnMove before its declaration).
// Pure-logic suites can't catch that class of bug; only rendering the component
// does. react-chessboard is mocked (it needs browser-only APIs); useStockfish
// degrades to status 'error' when Worker is absent in jsdom.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-chessboard', () => ({
  Chessboard: () => <div data-testid="chessboard-stub" />,
}));

import ChessGame from './ChessGame';

describe('ChessGame — render smoke', () => {
  test('mounts without throwing and shows the board + controls', () => {
    render(
      <MemoryRouter>
        <ChessGame />
      </MemoryRouter>
    );
    expect(screen.getByTestId('chessboard-stub')).toBeInTheDocument();
    expect(screen.getByText('CHESS')).toBeInTheDocument();
    expect(screen.getByText('New Game')).toBeInTheDocument();
    expect(screen.getByText('Coach')).toBeInTheDocument();
  });
});
