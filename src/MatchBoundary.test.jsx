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
  await act(async () => { jest.advanceTimersByTime(10000); });
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

const advance = async ms => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const requests = action => global.fetch.mock.calls.map(c => JSON.parse(c[1].body)).filter(r => r.action === action);
test('both alternatives are durable before a cloud write and recovery does not duplicate them', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  let cloud = sample(2);
  global.fetch.mockImplementation((_url, init) => {
    const req = JSON.parse(init.body);
    if (req.action === 'write') {
      expect(JSON.parse(localStorage.getItem('yinshMatchRecovery:v1')).alternatives).toEqual(expect.arrayContaining([sample(1), sample(2)]));
      cloud = req.domains.match;
    }
    return ok({ revision: 3, profile: { match: cloud } });
  });
  mount(); await screen.findByText('Keep this match');
  fireEvent.click(screen.getByText('Keep this match'));
  await screen.findByText('Turn 1');
  expect(JSON.parse(localStorage.getItem('yinshMatchRecovery:v1')).alternatives).toHaveLength(2);
});

test.each([400, 413])('permanent %s stops unchanged retries and retries corrected local state', async status => {
  jest.useFakeTimers();
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  global.fetch.mockImplementation((_url, init) => JSON.parse(init.body).action === 'read'
    ? ok({ revision: 0, profile: {} })
    : Promise.resolve({ ok: false, status, json: async () => { throw new Error('HTML'); } }));
  mount(); await advance(0);
  expect(screen.getByText(/Automatic retries pause/)).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('yinshMatchRecovery:v1')).alternatives).toContainEqual(sample(1));
  await advance(120000);
  expect(requests('read')).toHaveLength(1);
  expect(requests('write')).toHaveLength(1);
  fireEvent.click(screen.getByText('Move'));
  global.fetch.mockImplementation((_url, init) => ok(JSON.parse(init.body).action === 'read' ? { revision: 0, profile: {} } : { revision: 1 }));
  await advance(1000);
  expect(requests('write')).toHaveLength(2);
  expect(requests('write')[1].domains.match.state.turn).toBe(9);
});

test('non-JSON 502 backs off, including edit/reconnect events, then recovers', async () => {
  jest.useFakeTimers();
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  global.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('HTML'); } });
  mount(); await advance(0);
  expect(screen.getByText(/retry automatically/)).toBeTruthy();
  fireEvent.click(screen.getByText('Move'));
  await advance(10000); // second request; next retry is 20s later
  act(() => window.dispatchEvent(new Event('online')));
  await advance(19000);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  global.fetch.mockImplementation((_url, init) => ok(JSON.parse(init.body).action === 'read' ? { revision: 0, profile: {} } : { revision: 1 }));
  await advance(1000);
  expect(requests('write')).toHaveLength(1);
  expect(screen.getByText('Saved to your account.')).toBeTruthy();
});

test('unsupported cloud is retained, pauses automatic reads, and requires explicit replacement', async () => {
  jest.useFakeTimers();
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  const cloud = { ...sample(2), v: 99 };
  const strict = snapshot => { if (snapshot.v !== 1) throw new Error('unsupported'); return decode(snapshot); };
  global.fetch.mockImplementation(() => ok({ revision: 1, profile: { match: cloud } }));
  render(<MatchBoundary game="yinsh" decode={strict}><Game /></MatchBoundary>);
  await advance(0);
  expect(screen.getByText(/cloud save is unsupported/)).toBeTruthy();
  expect(screen.getByText('Use cloud match').disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem('yinshMatchRecovery:v1')).alternatives).toEqual([sample(1), cloud]);
  await advance(120000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(requests('write')).toHaveLength(0);
});

test('idle reads are 30s apart; rapid local edits use at most one read/write pair per 10s', async () => {
  jest.useFakeTimers();
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  let cloud = sample(1);
  localStorage.setItem('yinshMatch:v1', JSON.stringify(cloud));
  global.fetch.mockImplementation((_url, init) => {
    const req = JSON.parse(init.body);
    if (req.action === 'write') cloud = req.domains.match;
    return ok({ revision: 1, profile: { match: cloud } });
  });
  let turn = 1;
  function ActiveGame() {
    const saved = useSavedMatch();
    return <button onClick={() => saved.persist({ turn: ++turn }, {})}>Next turn</button>;
  }
  render(<MatchBoundary game="yinsh" decode={decode}><ActiveGame /></MatchBoundary>); await advance(0);
  await advance(29000); expect(requests('read')).toHaveLength(1);
  await advance(1000); expect(requests('read')).toHaveLength(2);
  for (let i = 0; i < 30; i++) { fireEvent.click(screen.getByText('Next turn')); await advance(1000); }
  expect(requests('read').length).toBeLessThanOrEqual(5);
  expect(requests('write').length).toBeLessThanOrEqual(3);
  // A different device is still discovered by the next idle read.
  cloud = sample(8);
  await advance(30000);
  expect(screen.getByText('Use cloud match')).toBeTruthy();
});

test('restored recovery alternative is queued and synced with the existing account baseline', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  localStorage.setItem('yinshMatchRecovery:v1', JSON.stringify({ v: 1, alternatives: [sample(2)] }));
  let cloud = sample(1);
  global.fetch.mockImplementation((_url, init) => {
    const req = JSON.parse(init.body);
    if (req.action === 'write') cloud = req.domains.match;
    return ok({ revision: 2, profile: { match: cloud } });
  });
  mount(); await screen.findByText('Turn 1');
  fireEvent.click(screen.getByText('Match recovery'));
  fireEvent.click(screen.getByText('Restore backup 1'));
  await screen.findByText('Saved to your account.');
  expect(requests('write')[0].domains.match).toEqual(sample(2));
});

test('corrupt recovery can be repaired by a conflict choice without losing its raw bytes', async () => {
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  localStorage.setItem('yinshMatchRecovery:v1', '{raw damaged');
  mount();
  act(() => { localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(2))); window.dispatchEvent(new StorageEvent('storage', { key: 'yinshMatch:v1' })); });
  fireEvent.click(screen.getByText('Use other tab match'));
  await screen.findByText('Turn 2');
  expect(JSON.parse(localStorage.getItem('yinshMatchRecovery:v1')).alternatives).toEqual([{ unreadable: '{raw damaged' }, sample(1), sample(2)]);
});

test('quota stops a cloud replacement before the request; account change stops a delayed choice locally', async () => {
  localStorage.setItem('gipfAccount', JSON.stringify(session));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(1)));
  let finish;
  global.fetch.mockImplementation((_url, init) => JSON.parse(init.body).action === 'read'
    ? ok({ revision: 2, profile: { match: sample(2) } })
    : new Promise(resolve => { finish = resolve; }));
  mount(); await screen.findByText('Keep this match');
  const original = Storage.prototype.setItem;
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.includes('Recovery')) throw new Error('quota');
    return original.call(this, key, value);
  });
  fireEvent.click(screen.getByText('Keep this match')); await act(async () => {});
  expect(requests('write')).toHaveLength(0);
  expect(localStorage.getItem('yinshMatch:v1')).toBe(JSON.stringify(sample(1)));
  spy.mockRestore();
  fireEvent.click(screen.getByText('Keep this match')); await act(async () => {});
  expect(requests('write')).toHaveLength(1);
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'B', authToken: 'other' }));
  localStorage.setItem('yinshMatch:v1', JSON.stringify(sample(7)));
  await act(async () => finish({ ok: true, json: async () => ({ revision: 3 }) }));
  expect(localStorage.getItem('yinshMatch:v1')).toBe(JSON.stringify(sample(7)));
  expect(localStorage.getItem('yinshMatchSync:v1')).toBeNull();
});

test('invalid local envelope message distinguishes format/size from quota', () => {
  function Oversize() {
    const saved = useSavedMatch();
    return <button onClick={() => saved.persist({ text: 'x'.repeat(240001) }, {})}>Oversize</button>;
  }
  render(<MatchBoundary game="yinsh" decode={decode}><Oversize /></MatchBoundary>);
  fireEvent.click(screen.getByText('Oversize'));
  expect(screen.getByText(/unsupported or too large to save/)).toBeTruthy();
  expect(localStorage.getItem('yinshMatch:v1')).toBeNull();
});

test.each(['chess', 'yinsh', 'zertz', 'catan'])('%s chrome follows stored and live theme, including damaged/conflict UI', game => {
  localStorage.setItem(`${game}DarkMode`, 'true');
  function Theme() { const saved = useSavedMatch(); return <button onClick={() => saved.setTheme(false)}>Light</button>; }
  const view = render(<MatchBoundary game={game} decode={decode}><Theme /></MatchBoundary>);
  expect(screen.getByRole('region', { name: 'Saved match' }).className).toBe('match-chrome dark');
  fireEvent.click(screen.getByText('Light'));
  expect(screen.getByRole('region', { name: 'Saved match' }).className).toBe('match-chrome');
  view.unmount();
  localStorage.setItem(`${game}Match:v1`, '{broken');
  render(<MatchBoundary game={game} decode={decode}><Theme /></MatchBoundary>);
  expect(screen.getByRole('alert').closest('.match-chrome.dark')).toBeTruthy();
});
