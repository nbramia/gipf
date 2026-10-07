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

describe('setup only offers playable rulesets', () => {
  const rulesetButtons = () => screen.getAllByRole('button').filter(node => node.classList.contains('catan-ruleset-card'));

  test('the picker lists the base game and its 5-6 extension, labelled with the Special Building Phase', async () => {
    mount(); await settle();
    const names = rulesetButtons().map(node => node.textContent);
    expect(names).toHaveLength(2);
    expect(names.some(text => text.includes('Seafarers') || text.includes('Cities'))).toBe(false);
    expect(names.find(text => text.includes('Base Game Extension'))).toMatch(/Special Building Phase/);
  });

  test('a saved ruleset id that is no longer offered falls back to the base game', async () => {
    localStorage.setItem('catanRulesetId', 'seafarers');
    localStorage.setItem('catanPlayerCount', '6');
    localStorage.setItem('catanScenarioId', 'new-shores');
    mount(); await settle();
    expect(rulesetButtons().find(node => node.classList.contains('active')).textContent).toMatch(/Base Game/);
    expect(screen.getByRole('button', { name: /^Start Base Game$/ })).toBeTruthy();
  });

  test('a saved match setup naming an expansion is repaired', async () => {
    const board = new CatanBoard({ seed: 5 });
    seed(board, { gameConfig: { rulesetId: 'cities-knights', playerCount: 4, scenarioId: 'ck-classic' } });
    mount(); await settle();
    expect(current().ui.gameConfig).toEqual({ rulesetId: 'base-classic', playerCount: 4, scenarioId: 'random-island' });
  });

  test('expansions appear in the Rules panel only as a labelled reference section', async () => {
    mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    const reference = screen.getByLabelText('Expansion reference');
    expect(reference.textContent).toMatch(/Reference only/);
    expect(reference.textContent).toMatch(/Seafarers/);
    expect(reference.textContent).not.toMatch(/Base Game/);
  });
});

test('a human setup placement can be undone, and the control disappears afterwards', async () => {
  let board;
  for (let s = 1; s < 60 && !board; s++) {
    const candidate = new CatanBoard({ seed: s });
    if (candidate.currentPlayer === 1) board = candidate;
  }
  expect(board).toBeTruthy();
  seed(board);
  mount(); await settle();
  expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();

  const target = screen.getAllByRole('button', { name: /^Place a settlement/ })[0];
  fireEvent.click(target);
  await settle();
  expect(current().state.phase).toBe('setup-road');
  fireEvent.click(screen.getByRole('button', { name: /^Undo settlement/ }));
  await settle();
  expect(current().state.phase).toBe('setup-settlement');
  expect(current().state.players['1'].settlements).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
});
