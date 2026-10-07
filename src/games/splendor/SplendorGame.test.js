import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SplendorBoard from './SplendorBoard.js';
import { encodeBoard } from './matchSnapshot.js';

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
    // A match with progress asks first; an untouched one (the AI is yet to open) does not.
    const confirm = screen.queryByRole('button', { name: 'Start new match' });
    if (confirm) fireEvent.click(confirm);
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
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

const SAVE_KEY = 'splendorMatch:v1';
const saveMatch = (board, ui = { difficulty: 'strong', showModal: false }) => localStorage.setItem(SAVE_KEY, JSON.stringify({
  v: 1, game: 'splendor', id: 'synthetic', updatedAt: 1, state: encodeBoard(board), ui,
}));
const savedState = () => JSON.parse(localStorage.getItem(SAVE_KEY)).state;
// Move tokens from the bank to a seat, keeping the token supply conserved.
const give = (board, seat, token, n) => { board.bank[token] -= n; board.players[seat].tokens[token] += n; };
// A 2-player position where seat 1 (the human) is to move and may take tokens.
function humanToMove() {
  const board = new SplendorBoard({ seed: 99, playerCount: 2 });
  board.firstPlayer = 1; board.currentPlayer = 1;
  board.applyMove({ type: 'take-three', colors: ['white', 'blue', 'green'] });
  board.applyMove(board.getLegalMoves().find(m => m.type === 'take-three'));
  return board;
}

describe('Splendor match persistence', () => {
  test('a reload resumes the saved match instead of dealing a new one', () => {
    const board = humanToMove();
    saveMatch(board);
    const { unmount } = renderGame();
    const market = () => document.querySelector('.spl-market').innerHTML;
    const resumed = market();
    expect(document.querySelectorAll('.spl-log li').length).toBe(board.log.length);
    unmount();
    renderGame();
    expect(market()).toBe(resumed);
    expect(savedState().decks).toEqual(encodeBoard(board).decks);
  });

  test('resuming on the AI turn requests exactly one AI move and saves it once', async () => {
    const board = new SplendorBoard({ seed: 5, playerCount: 2 });
    board.firstPlayer = 2; board.currentPlayer = 2;
    saveMatch(board);
    renderGame();
    await waitFor(() => expect(mockComputeMove).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [state, , onSuccess] = mockComputeMove.mock.calls[0];
    expect(state.decks).toEqual(board.decks);
    expect(state.currentPlayer).toBe(2);
    expect(savedState().currentPlayer).toBe(2);

    const move = SplendorBoard.fromSerializedState(state).getLegalMoves()[0];
    act(() => { onSuccess(move); });
    await waitFor(() => expect(savedState().currentPlayer).toBe(1));
    expect(savedState().log).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(mockComputeMove).toHaveBeenCalledTimes(1);
  });

  test('a saved match keeps its player count and difficulty over stored preferences', () => {
    localStorage.setItem('splendorPlayerCount', '4');
    localStorage.setItem('splendorDifficulty', 'brutal');
    saveMatch(humanToMove(), { difficulty: 'expert', showModal: false });
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: '2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expert' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('an unreadable save is kept and offers recovery instead of dealing over it', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, game: 'splendor', id: 'x', updatedAt: 1, state: { seed: 1 }, ui: {} }));
    renderGame();
    expect(screen.getByRole('alert').textContent).toMatch(/damaged|unsupported/);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)).state).toEqual({ seed: 1 });
  });
});

describe('Splendor new-game confirmation', () => {
  test('asks before replacing a match with progress, and Keep playing leaves it alone', () => {
    const board = humanToMove();
    saveMatch(board);
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
    const dialog = screen.getByRole('dialog', { name: 'Start a new match?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelectorAll('.spl-log li').length).toBe(board.log.length);
  });

  test('Escape dismisses the dialog', () => {
    saveMatch(humanToMove());
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('does not ask when nothing has been played', () => {
    const board = new SplendorBoard({ seed: 3, playerCount: 2 });
    board.firstPlayer = 1; board.currentPlayer = 1;
    saveMatch(board);
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('changing the player count is labelled and confirmed when the match has progress', () => {
    saveMatch(humanToMove());
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('(changing starts a new match)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByRole('dialog').textContent).toMatch('3-player match');
    fireEvent.click(screen.getByRole('button', { name: 'Start new match' }));
    expect(screen.getByRole('button', { name: '3' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Splendor payment chooser', () => {
  // The human reserved t1-08 (cost 4 green) and holds 4 green plus gold.
  function holdingGold(gold) {
    const board = humanToMove();
    board.players[1].tokens = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    board.bank = { white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 };
    board.players[2].tokens = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    board.players[1].reserved = [{ cardId: 't1-08', hidden: true }];
    for (const id of [1, 2]) for (const t of ['white', 'blue', 'green', 'red', 'black']) board.players[id].tokens[t] = 0;
    for (const deck of Object.values(board.decks)) { const i = deck.indexOf('t1-08'); if (i >= 0) deck.splice(i, 1); }
    for (const row of Object.values(board.visible)) { const i = row.indexOf('t1-08'); if (i >= 0) row[i] = null; }
    give(board, 1, 'green', 4);
    if (gold) give(board, 1, 'gold', gold);
    return board;
  }
  const buyButton = () => screen.getByRole('button', { name: /^Buy reserved/ });

  test('one click buys when gold could not replace a held gem', () => {
    saveMatch(holdingGold(0));
    renderGame();
    fireEvent.click(buyButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedState().players[1].cards).toContain('t1-08');
  });

  test('offers a chooser defaulting to the automatic payment, and pays what was chosen', () => {
    saveMatch(holdingGold(2));
    renderGame();
    fireEvent.click(buyButton());
    const dialog = screen.getByRole('dialog', { name: 'Choose payment' });
    expect(dialog.textContent).toMatch('You pay: 4 Emerald');
    fireEvent.click(screen.getByRole('button', { name: 'Pay one Emerald with gold instead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pay one Emerald with gold instead' }));
    expect(dialog.textContent).toMatch('You pay: 2 Emerald, 2 Gold');
    expect(screen.getByRole('button', { name: 'Pay one Emerald with gold instead' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    const me = savedState().players[1];
    expect(me.cards).toContain('t1-08');
    expect(me.tokens.green).toBe(2);
    expect(me.tokens.gold).toBe(0);
  });

  test('Cancel closes the chooser without buying', () => {
    saveMatch(holdingGold(2));
    renderGame();
    fireEvent.click(buyButton());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(savedState().players[1].cards).not.toContain('t1-08');
  });
});

describe('Splendor discard labels', () => {
  test.each([
    ['white', 'a Diamond'], ['blue', 'a Sapphire'], ['green', 'an Emerald'],
    ['red', 'a Ruby'], ['black', 'an Onyx'], ['gold', 'a Gold'],
  ])('uses the right article for %s', (token, phrase) => {
    const board = humanToMove();
    board.players[1].tokens = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    board.players[2].tokens = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    board.bank = { white: 4, blue: 4, green: 4, red: 4, black: 4, gold: 5 };
    for (const t of ['white', 'blue', 'green', 'red', 'black']) give(board, 1, t, 2);
    give(board, 1, 'gold', 2);
    board.phase = 'discard';
    saveMatch(board);
    renderGame();
    expect(screen.getByLabelText(new RegExp(`^Return ${phrase} \\(you have 2\\)$`))).toBeTruthy();
  });
});
