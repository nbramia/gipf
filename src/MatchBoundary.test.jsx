import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MatchBoundary, { useSavedMatch } from './MatchBoundary.jsx';
const sample = turn => ({ v: 1, game: 'yinsh', id: 'synthetic', updatedAt: 1, state: { turn }, ui: {} });
const decode = snapshot => ({ board: snapshot.state, ui: snapshot.ui });
const session = { usernameId: 'A', authToken: 'synthetic' };
function Game() {
  const saved = useSavedMatch();
  return <><span>Turn {saved.restored?.board.turn || 0}</span><button onClick={() => saved.persist({ turn: 9 }, {})}>Move</button></>;
}
const mount = () => render(<MatchBoundary game="yinsh" decode={decode}><Game /></MatchBoundary>);
beforeEach(() => { localStorage.clear(); global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); });
const ok = data => Promise.resolve({ ok: true, json: async () => data });
test('guest refresh restores the newest local match and metadata is not required', () => {
  const first = mount(); fireEvent.click(screen.getByText('Move')); first.unmount();
  mount(); expect(screen.getByText('Turn 9')).toBeTruthy();
});
test('cloud hydration is completed before mounting the game', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  global.fetch.mockImplementation(() => ok({ revision: 2, profile: { match: sample(3) } }));
  mount();
  expect(screen.queryByText('Move')).toBeNull();
  await screen.findByText('Turn 3');
});
test('different device/cloud matches block play and explicit CAS preserves both alternatives', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  global.fetch.mockImplementation((_url, init) => {
    const req = JSON.parse(init.body);
    return ok(req.action === 'read' ? { revision: 2, profile: { match: sample(2) } } : { revision: 3 });
  });
  mount(); await screen.findByText('Keep this match');
  expect(screen.queryByText('Move')).toBeNull();
  fireEvent.click(screen.getByText('Keep this match'));
  await screen.findByText('Turn 1');
  const write = global.fetch.mock.calls.map(c => JSON.parse(c[1].body)).find(r => r.action === 'write');
  expect(write.revision).toBe(2); expect(write.domains.match).toEqual(sample(1));
  expect(JSON.parse(localStorage.getItem('yinshMatchRecovery:v1')).alternatives).toEqual(expect.arrayContaining([sample(1),sample(2)]));
});
test('account change during read cannot hydrate or send a queued match for next account', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  let resolve;
  global.fetch.mockImplementation(() => new Promise(r => { resolve = r; }));
  mount();
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'B', authToken: 'other' }));
  await act(async () => resolve({ ok: true, json: async () => ({ revision: 1, profile: { match: sample(1) } }) }));
  expect(localStorage.getItem('yinshMatch:v1')).toBeNull();
  expect(screen.getByText(/Account changed/)).toBeTruthy();
});
test('storage conflict pauses the game and exposes the other tab choice', async () => {
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  mount();
  act(() => {
    localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(2)));
    window.dispatchEvent(new StorageEvent('storage', { key: 'yinshMatch:v1' }));
  });
  expect(screen.getByText('Use other tab match')).toBeTruthy();
  fireEvent.click(screen.getByText('Use other tab match'));
  await screen.findByText('Turn 2');
});
test('offline edits retry from persisted account baseline', async () => {
  jest.useFakeTimers();
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  localStorage.setItem('yinshMatchSync:v1', JSON.stringify({ v: 1, owner: 'A', revision: 2, baseline: sample(1) }));
  global.fetch.mockRejectedValue(new Error('offline'));
  mount(); await act(async () => {});
  fireEvent.click(screen.getByText('Move'));
  global.fetch.mockImplementation((_url, init) => ok(JSON.parse(init.body).action === 'read' ? { revision: 2, profile: { match: sample(1) } } : { revision: 3 }));
  await act(async () => { jest.advanceTimersByTime(3000); });
  const writes = global.fetch.mock.calls.map(c => JSON.parse(c[1].body)).filter(r => r.action === 'write');
  expect(writes).toHaveLength(1); expect(writes[0].domains.match.state.turn).toBe(9);
});

test('a second CAS conflict requires another explicit decision and retains alternatives', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  let reads = 0;
  global.fetch.mockImplementation((_url, init) => {
    const req = JSON.parse(init.body);
    if (req.action === 'read') return ok({ revision: ++reads, profile: { match: sample(reads + 1) } });
    return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'conflict' }) });
  });
  mount(); await screen.findByText('Keep this match');
  fireEvent.click(screen.getByText('Keep this match'));
  await screen.findByText('Cloud changed again. Review your choice before saving.');
  expect(screen.queryByText('Move')).toBeNull();
  expect(global.fetch.mock.calls.map(c=>JSON.parse(c[1].body)).filter(r=>r.action==='write')).toHaveLength(1);
});
test('unsupported save is preserved and can be backed up before a new game', () => {
  localStorage.setItem('yinshMatch:v1','{"v":99}');
  mount(); expect(screen.queryByText('Move')).toBeNull();
  expect(localStorage.getItem('yinshMatch:v1')).toBe('{"v":99}');
  fireEvent.click(screen.getByText('Keep backup and start new game'));
  expect(screen.getByText('Move')).toBeTruthy();
  expect(localStorage.getItem('yinshMatchRecovery:v1')).toContain('99');
});
test('quota error blocks a destructive conflict choice', async () => {
  localStorage.setItem('yinshMatch:v1',JSON.stringify(sample(1)));
  mount();
  act(() => { localStorage.setItem('yinshMatch:v1',JSON.stringify(sample(2))); window.dispatchEvent(new StorageEvent('storage',{key:'yinshMatch:v1'})); });
  const original=Storage.prototype.setItem;
  const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value) { if(key.includes('Recovery')) throw new Error('quota'); return original.call(this,key,value); });
  fireEvent.click(screen.getByText('Use other tab match'));
  await screen.findByText('Could not preserve or restore this match. No alternative was discarded.');
  expect(screen.queryByText('Move')).toBeNull();
  spy.mockRestore();
});

test('a captured callback from a replaced match cannot save after remount', async () => {
  localStorage.setItem('yinshMatch:v1',JSON.stringify(sample(1)));
  let prior;
  function Capture() { const save=useSavedMatch(); if(!prior) prior=save; return <Game/>; }
  render(<MatchBoundary game="yinsh" decode={decode}><Capture/></MatchBoundary>);
  act(()=> { localStorage.setItem('yinshMatch:v1',JSON.stringify(sample(2))); window.dispatchEvent(new StorageEvent('storage',{key:'yinshMatch:v1'})); });
  expect(prior.isCurrent()).toBe(false);
  fireEvent.click(screen.getByText('Use other tab match'));
  await screen.findByText('Turn 2');
  act(()=>prior.persist({turn:99},{}));
  expect(JSON.parse(localStorage.getItem('yinshMatch:v1')).state.turn).toBe(2);
});
