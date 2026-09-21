import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResumableChessGame from './ChessGame.jsx';
import ChessBoard from './ChessBoard.js';
import { encodeBoard, decodeMatch } from './matchSnapshot.js';

jest.mock('react-chessboard', () => ({ Chessboard: ({ position, onPieceDrop }) => <div>
  <span data-testid="position">{position}</span><button onClick={() => onPieceDrop('g1', 'f3')}>Play Nf3</button>
</div> }));
jest.mock('./hooks/useStockfish.js', () => {
  const engine = { status: 'loading', getMove: async () => null, analyze: async () => null, retry: () => {} };
  return { __esModule: true, default: () => engine };
});
jest.mock('./engine/profileSync.js', () => ({
  claimLegacyProfile: async () => null, fetchRemoteProfile: async () => null,
  putRemoteProfile: () => {}, mergeHistory: () => {}, mergePuzzles: () => {}, mergeMistakes: () => {},
}));
jest.mock('./coach/openingCoach.js', () => ({
  fetchOpeningStats: async () => null, getLichessToken: () => '', hasLichessToken: () => false,
  OPENING_MAX_PLY: 20,
}));

const mount = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ResumableChessGame /></MemoryRouter>);
const settle = async () => { await act(async () => {}); };
const advance = async ms => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const current = () => JSON.parse(localStorage.getItem('chessMatch:v1'));
const seed = (ui = {}) => {
  const board = new ChessBoard(); board.loadPgn('1. e4 e5');
  const value = { v: 1, game: 'chess', id: 'timed', updatedAt: 1, state: encodeBoard(board),
    ui: { humanColor: 'w', timeControl: '5+0', clock: { w: 300000, b: 300000 }, ...ui } };
  localStorage.setItem('chessMatch:v1', JSON.stringify(value));
  return value;
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('chessIntroSeen', 'true');
  global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected network'));
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('real Chess adopts legacy once, explicit damaged clear/remount never resurrects or uploads it', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'A', authToken: 'synthetic' }));
  const raw = JSON.stringify({ v: 1, pgn: '1. d4 d5', humanColor: 'w' });
  localStorage.setItem('chessGameState', raw);
  let cloud = null;
  global.fetch.mockImplementation(async (_url, init) => {
    const req = JSON.parse(init.body);
    if (req.action === 'write') cloud = req.domains.match;
    return { ok: true, json: async () => ({ revision: 1, profile: { match: cloud } }) };
  });
  let view = mount(); await settle();
  expect(decodeMatch(current()).board.sanHistory()).toEqual(['d4', 'd5']);
  view.unmount();
  global.fetch.mockClear();
  localStorage.setItem('chessMatch:v1', '{damaged');
  view = mount();
  fireEvent.click(screen.getByText('Keep backup and start new game')); await settle();
  expect(decodeMatch(current()).board.sanHistory()).toEqual([]);
  view.unmount();
  mount(); await settle();
  expect(decodeMatch(current()).board.sanHistory()).toEqual([]);
  expect(localStorage.getItem('chessGameState')).toBe(raw);
  expect(JSON.parse(localStorage.getItem('chessMatchRecovery:v1')).alternatives).toContainEqual({ unreadable: '{damaged' });
  const writes = global.fetch.mock.calls.map(c => JSON.parse(c[1].body)).filter(r => r.action === 'write');
  expect(writes.length).toBeGreaterThan(0);
  writes.forEach(r => expect(decodeMatch(r.domains.match).board.sanHistory()).toEqual([]));
  expect(decodeMatch(cloud).board.sanHistory()).toEqual([]);
});

test('200ms clock ticks produce no snapshot writes; pagehide and unmount save remaining time for reload', async () => {
  jest.useFakeTimers(); seed();
  const spy = jest.spyOn(Storage.prototype, 'setItem');
  let view = mount(); await settle(); spy.mockClear();
  for (let i = 0; i < 25; i++) await advance(200);
  expect(spy.mock.calls.filter(([key]) => key === 'chessMatch:v1')).toHaveLength(0);
  fireEvent(window, new Event('pagehide')); await settle();
  expect(current().ui.clock.w).toBe(295000);
  expect(spy.mock.calls.filter(([key]) => key === 'chessMatch:v1')).toHaveLength(1);
  await advance(1000);
  view.unmount();
  expect(current().ui.clock.w).toBe(294000);
  view = mount(); await settle();
  expect(current().ui.clock.w).toBe(294000);
  expect(screen.getByLabelText('White clock').textContent).toContain('4:54');
  view.unmount();
});

test('a completed move persists its clock increment, and timeout flags survive reload without double statistics', async () => {
  jest.useFakeTimers(); seed({ timeControl: '3+2', clock: { w: 10000, b: 200 } });
  let view = mount(); await settle();
  await advance(1000);
  fireEvent.click(screen.getByText('Play Nf3')); await settle();
  expect(decodeMatch(current()).board.sanHistory()).toEqual(['e4', 'e5', 'Nf3']);
  expect(current().ui.clock.w).toBe(11000);
  await advance(200);
  expect(current().ui.clock.b).toBe(0);
  expect(current().ui.flagged).toBe('b');
  expect(current().ui.historyApplied).toBe(true);
  const history = localStorage.getItem('chessOppHistory');
  view.unmount(); view = mount(); await settle();
  expect(current().ui.flagged).toBe('b');
  expect(localStorage.getItem('chessOppHistory')).toBe(history);
  view.unmount();
});

test('real theme toggle updates saved-match chrome', async () => {
  mount(); await settle();
  fireEvent.click(screen.getByRole('switch', { name: 'Dark mode' }));
  expect(screen.getByRole('region', { name: 'Saved match' }).className).toBe('match-chrome dark');
});

test('account sync status cannot turn clock ticks into writes; visibility flush stops at account change', async () => {
  jest.useFakeTimers();
  let cloud = seed();
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'A', authToken: 'synthetic' }));
  global.fetch.mockImplementation(async (_url, init) => {
    const req = JSON.parse(init.body);
    if (req.action === 'write') cloud = req.domains.match;
    return { ok: true, json: async () => ({ revision: 1, profile: { match: cloud } }) };
  });
  const view = mount(); await settle();
  await advance(10000); // acknowledge the initial fully populated UI snapshot
  global.fetch.mockClear();
  const spy = jest.spyOn(Storage.prototype, 'setItem');
  for (let i = 0; i < 150; i++) await advance(200);
  expect(spy.mock.calls.filter(([key]) => key === 'chessMatch:v1')).toHaveLength(0);
  expect(global.fetch.mock.calls.map(c => JSON.parse(c[1].body)).filter(r => r.action === 'write')).toHaveLength(0);
  expect(global.fetch.mock.calls.map(c => JSON.parse(c[1].body)).filter(r => r.action === 'read')).toHaveLength(1);
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange')); await settle();
  expect(current().ui.clock.w).toBe(260000);
  const retained = localStorage.getItem('chessMatch:v1');
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'B', authToken: 'other' }));
  await advance(200);
  view.unmount();
  expect(localStorage.getItem('chessMatch:v1')).toBe(retained);
});
