// Smoke test for ChessGame — guards against render-time crashes (e.g. the TDZ
// bug where the AI useEffect referenced coachOnMove before its declaration).
// Pure-logic suites can't catch that class of bug; only rendering the component
// does. react-chessboard is mocked (it needs browser-only APIs); useStockfish
// degrades to status 'error' when Worker is absent in jsdom.
//
// The core assertion is simply that mounting does not throw — a render-time
// ReferenceError (the bug this guards) would reject render() and fail the test.

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let boardProps = {};
jest.mock('react-chessboard', () => ({
  Chessboard: (props) => {
    boardProps = props;
    return <div data-testid="chessboard-stub" />;
  },
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

  test('has no sign-in or key inputs, links to /login, and leaves stored keys and progress in place', () => {
    localStorage.clear();
    localStorage.setItem('playApiKey', 'sk-ant-synthetic');
    localStorage.setItem('chessLichessToken', 'lip_synthetic');
    localStorage.setItem('chessRating', '1400');
    const { container, getAllByRole } = render(
      <MemoryRouter>
        <ChessGame />
      </MemoryRouter>
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Create account|Confirm password/);
    const links = getAllByRole('link').map(a => a.getAttribute('href'));
    expect(links).toContain('/login?return=/chess');
    expect(container.textContent).toContain('Anthropic key saved ✓');
    expect(container.textContent).toContain('Lichess token saved ✓');
    expect(localStorage.getItem('playApiKey')).toBe('sk-ant-synthetic');
    expect(localStorage.getItem('chessLichessToken')).toBe('lip_synthetic');
    expect(localStorage.getItem('chessRating')).toBe('1400');
  });
});

describe('ChessGame — PGN import and clock behavior', () => {
  const mount = () =>
    render(
      <MemoryRouter>
        <ChessGame />
      </MemoryRouter>
    );

  const importPgn = async (utils, text, side) => {
    const input = utils.container.querySelector('input[type="file"]');
    const file = new File([text], 'g.pgn', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const dialog = await utils.findByRole('dialog');
    return { dialog, choose: () => fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent.startsWith(side))) };
  };

  beforeEach(() => localStorage.clear());

  test('importing a completed game in rated mode never changes the rating', async () => {
    localStorage.setItem('chessRated', 'true');
    const utils = mount();
    const { choose } = await importPgn(utils, '1. f3 e5 2. g4 Qh4# 0-1', 'Black');
    await act(async () => { choose(); });
    expect(utils.container.textContent).toContain('Checkmate — Black wins');
    expect(JSON.parse(localStorage.getItem('chessRating') || '1000')).toBe(1000);
    expect(utils.container.textContent).not.toMatch(/\+20/);
  });

  test('an imported game keeps its declared result instead of continuing', async () => {
    const utils = mount();
    const { choose } = await importPgn(utils, '[Result "1-0"]\n\n1. e4 1-0', 'White');
    await act(async () => { choose(); });
    expect(utils.container.textContent).toContain('Imported result — White wins');
    expect(utils.container.textContent).not.toContain('Black to move');
  });

  test('cancelling the import dialog keeps the current game', async () => {
    const utils = mount();
    const { dialog } = await importPgn(utils, '1. e4 e5 2. Nf3 *', 'White');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Cancel'));
    expect(utils.queryByRole('dialog')).toBeNull();
    expect(utils.container.textContent).toContain('No moves yet.');
  });

  test('clicking a pawn onto the last rank asks for a promotion piece', async () => {
    const utils = mount();
    const { choose } = await importPgn(
      utils,
      '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/7p/4K3 w - - 0 1"]\n\n*',
      'White'
    );
    await act(async () => { choose(); });
    await act(async () => { boardProps.onSquareClick('a7'); });
    await act(async () => { boardProps.onSquareClick('a8'); });
    expect(boardProps.showPromotionDialog).toBe(true);
    expect(boardProps.promotionToSquare).toBe('a8');
    expect(utils.container.textContent).toContain('No moves yet.');
    await act(async () => { boardProps.onPromotionPieceSelect('wN', undefined, 'a8'); });
    await waitFor(() => expect(utils.container.textContent).toContain('a8=N'));
  });

  test('changing the clock preset does not alter the game in progress', () => {
    const utils = mount();
    const select = utils.container.querySelector('select option[value="3+2"]').parentElement;
    fireEvent.change(select, { target: { value: '3+2' } });
    expect(utils.queryByLabelText('White clock')).toBeNull();
    expect(localStorage.getItem('chessTimeControl')).toBe('3+2');
  });
});
