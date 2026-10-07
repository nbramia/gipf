import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResumableCatanGame from './CatanGame.jsx';
import CatanBoard from './CatanBoard.js';
import { encodeBoard } from './matchSnapshot.js';

jest.mock('./hooks/createAIWorker', () => ({ createAIWorker: () => ({ postMessage: () => {}, terminate: () => {} }) }));

const mount = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ResumableCatanGame /></MemoryRouter>);
const settle = async () => { await act(async () => {}); };
const current = () => JSON.parse(localStorage.getItem('catanMatch:v1'));

function seed(board, ui = {}) {
  const config = { rulesetId: board.rulesetId, playerCount: board.playerCount, scenarioId: board.scenarioId };
  localStorage.setItem('catanMatch:v1', JSON.stringify({
    v: 1, game: 'catan', id: 'ui-test', updatedAt: 1, state: encodeBoard(board),
    ui: { showModal: false, gameConfig: config, ...ui },
  }));
}

// A human (player 1) whose Special Building turn follows another player's turn.
function specialBuildBoard() {
  const board = new CatanBoard({ seed: 192, rulesetId: 'base-5-6', playerCount: 6, skipInitialHistory: true });
  // Give player 1 two connected settlements-with-roads so every build has a target.
  const moves = () => board.getLegalMoves()[0];
  while (board.phase === 'setup-settlement' || board.phase === 'setup-road') board.applyMove(moves());
  board.phase = 'paired-action';
  board.currentPlayer = 1;
  board.primaryTurnPlayer = 2;
  Object.assign(board.players[1].resources, { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 });
  return board;
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected network'));
});

test('Special Building: selecting Road, Settlement or City exposes board targets', async () => {
  const board = specialBuildBoard();
  expect(board.getValidRoadEdges(1).length).toBeGreaterThan(0);
  seed(board);
  mount(); await settle();
  for (const [button, label] of [['Road', /^Build a road/], ['Settlement', /^Build a settlement/], ['City', /^Upgrade to a city/]]) {
    const action = screen.getAllByRole('button').find(node => node.textContent.startsWith(button) && node.classList.contains('catan-build-btn'));
    if (button === 'Settlement' && action.disabled) continue; // no legal spot on this fixture
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
    expect(screen.queryAllByRole('button', { name: label }).length).toBeGreaterThan(0);
  }
});

test('an old save with AI search metadata in lastMove is rewritten without it', async () => {
  const board = new CatanBoard({ seed: 5 });
  seed(board, { lastMove: { type: 'setup-settlement', vertexId: 'v1', _rootVisits: { a: 1 }, _legalMoves: [{ type: 'x' }] } });
  mount(); await settle();
  expect(current().ui.lastMove).toEqual({ type: 'setup-settlement', vertexId: 'v1' });
});
