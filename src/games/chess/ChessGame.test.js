// Smoke test for ChessGame — guards against render-time crashes (e.g. the TDZ
// bug where the AI useEffect referenced coachOnMove before its declaration).
// Pure-logic suites can't catch that class of bug; only rendering the component
// does. react-chessboard is mocked (it needs browser-only APIs); useStockfish
// degrades to status 'error' when Worker is absent in jsdom.
//
// The core assertion is simply that mounting does not throw — a render-time
// ReferenceError (the bug this guards) would reject render() and fail the test.

import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-chessboard', () => ({
  Chessboard: () => <div data-testid="chessboard-stub" />,
}));

import ChessGame from './ChessGame';

describe('ChessGame — render smoke', () => {
  test('mounts without throwing and renders the board + key controls', () => {
    let container;
    expect(() => {
      ({ container } = render(
        <MemoryRouter>
          <ChessGame />
        </MemoryRouter>
      ));
    }).not.toThrow();

    // Board stub is present, and the panel rendered its controls.
    expect(container.querySelector('[data-testid="chessboard-stub"]')).toBeTruthy();
    expect(container.textContent).toContain('New Game');
    expect(container.textContent).toContain('Coach');
  });
});
