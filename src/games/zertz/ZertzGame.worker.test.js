import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Game from './ZertzGame';
import { createAIWorker } from './hooks/createAIWorker';
import { applyAIMove } from './engine/aiPlayer';
import { MCTS } from './engine/mcts';
jest.mock('./engine/mcts', () => ({ ...jest.requireActual('./engine/mcts'), MCTS: jest.fn() }));
jest.mock('./hooks/createAIWorker', () => ({ createAIWorker: jest.fn() }));
jest.mock('./engine/aiPlayer', () => ({ ...jest.requireActual('./engine/aiPlayer'),
  applyAIMove: jest.fn((...args) => jest.requireActual('./engine/aiPlayer').applyAIMove(...args)) }));
let workers;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('zertzTwoPlayer', 'true');
  localStorage.setItem('zertzRandomSetup', 'false');
  localStorage.setItem('zertzDifficulty', 'expert');
  workers = [];
  applyAIMove.mockImplementation((...args) => jest.requireActual('./engine/aiPlayer').applyAIMove(...args));
  createAIWorker.mockImplementation(() => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    workers.push(worker); return worker;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
function mount() {
  const view = render(<MemoryRouter><Game /></MemoryRouter>);
  fireEvent.click(screen.getAllByRole('button', { name: 'New Game' })[0]);
  return view;
}
function request() {
  fireEvent.click(screen.getByRole('button', { name: 'AI Move' }));
  const worker = workers[workers.length - 1];
  return { worker, requestId: worker.postMessage.mock.calls.slice(-1)[0][0].requestId };
}
function reply(request, type = 'result', mode = 'nn') {
  act(() => request.worker.onmessage({ data: {
    requestId: request.requestId, type, data: { move: { type: 'place-marble', color: 'white', q: 0, r: 0 } },
    error: 'delayed error', stats: { simulations: 1, evaluationMode: mode },
  } }));
}
function expectThinking() { expect(screen.getByText('AI Thinking...')).toBeTruthy(); }
function expectSettled() { expect(screen.queryByText('AI Thinking...')).toBeNull(); }
test('reset rejects old move and error without clearing a new request thinking state', () => {
  mount();
  const old = request();
  fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'New Game' })[0]);
  expectSettled();
  const current = request();
  reply(old); reply(old, 'error');
  expectThinking(); expect(applyAIMove).not.toHaveBeenCalled();
  reply(current); reply(current);
  expectSettled(); expect(applyAIMove).toHaveBeenCalledTimes(1);
});
test.each(['toolbar', 'keyboard'])('%s undo and redo invalidate pending work and preserve the restored board', method => {
  mount();
  reply(request()); // Establish real undo history by applying a legal move.
  expect(applyAIMove).toHaveBeenCalledTimes(1);
  const beforeUndo = request();
  const undo = () => method === 'toolbar'
    ? fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'))
    : fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  const redo = () => method === 'toolbar'
    ? fireEvent.click(screen.getByTitle('Redo (Ctrl+Shift+Z)'))
    : fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
  undo(); expectSettled();
  const beforeRedo = request();
  const undone = beforeRedo.worker.postMessage.mock.calls.slice(-1)[0][0].data.boardState;
  reply(beforeUndo); reply(beforeUndo, 'error'); expectThinking();
  redo(); expectSettled();
  const current = request();
  const redone = current.worker.postMessage.mock.calls.slice(-1)[0][0].data.boardState;
  expect(redone).not.toEqual(undone);
  reply(beforeRedo); reply(beforeRedo, 'error'); expectThinking();
  expect(applyAIMove).toHaveBeenCalledTimes(1);
  reply(current, 'error'); expectSettled();
});
test('unmount discards delayed success and error', () => {
  const view = mount(); const old = request(); view.unmount();
  reply(old); reply(old, 'error');
  expect(applyAIMove).not.toHaveBeenCalled();
  expect(old.worker.terminate).toHaveBeenCalledTimes(1);
});
test('fallback is visible and successful NN clears it without changing difficulty preference', () => {
  mount();
  reply(request(), 'result', 'heuristic');
  expect(screen.getByRole('status').textContent).toContain('using heuristic AI');
  expect(localStorage.getItem('zertzDifficulty')).toBe('expert');
  reply(request());
  expect(screen.queryByRole('status')).toBeNull();
});

test.each(['result', 'error'])('main-thread fallback ignores a delayed %s after reset while a new request runs', async outcome => {
  createAIWorker.mockImplementation(() => { throw new Error('Workers unavailable'); });
  const searches = [];
  MCTS.mockImplementation(() => ({ getBestMove: jest.fn(() => new Promise((resolve, reject) => {
    searches.push({ resolve, reject });
  })) }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'AI Move' }));
  await waitFor(() => expect(searches).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'New Game' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'AI Move' }));
  await waitFor(() => expect(searches).toHaveLength(2));
  const move = { type: 'place-marble', color: 'white', q: 0, r: 0 };
  await act(async () => {
    if (outcome === 'error') searches[0].reject(new Error('late failure'));
    else searches[0].resolve(move);
  });
  expectThinking();
  expect(applyAIMove).not.toHaveBeenCalled();
  await act(async () => searches[1].resolve(move));
  expectSettled();
  expect(applyAIMove).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('using heuristic AI');
});
