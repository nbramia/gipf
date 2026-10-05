import { createMatchStore, matchKey } from './matchStore.js';
const snapshot = (game = 'yinsh', turn = 1) => ({ v: 1, game, id: 'synthetic-match', updatedAt: 1, state: { currentPlayer: turn }, ui: {} });
beforeEach(() => { localStorage.clear(); });
test('guest snapshot round trips and never imports another game or version', () => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  expect(createMatchStore('yinsh').load()).toEqual(snapshot());
  expect(() => store.save(snapshot('zertz'))).toThrow();
  localStorage.setItem(matchKey('yinsh'), JSON.stringify({ ...snapshot(), v: 99 }));
  expect(() => createMatchStore('yinsh').load()).toThrow();
  expect(localStorage.getItem(matchKey('yinsh'))).toContain('99');
});
test('old tab cannot overwrite newer device state or write after identity changes', () => {
  const first = createMatchStore('yinsh');
  const stale = createMatchStore('yinsh');
  first.save(snapshot());
  expect(() => stale.save(snapshot('yinsh', 2))).toThrow('local_conflict');
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'B', authToken: 'B' }));
  expect(() => first.save(snapshot())).toThrow('account_changed');
});
test('transition marker blocks delayed local writes even before account changes', () => {
  const store = createMatchStore('yinsh');
  localStorage.setItem('gipf:account-transition', 'synthetic');
  expect(() => store.save(snapshot())).toThrow('account_changed');
});
test('quota failure preserves the prior snapshot and is visible to caller', () => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => store.save(snapshot('yinsh', 2))).toThrow('quota');
  spy.mockRestore();
  expect(store.load()).toEqual(snapshot());
});
test('explicit resolution retains both alternatives before replacing', () => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  store.resolve(snapshot('yinsh', 2));
  const recovered = JSON.parse(localStorage.getItem('yinshMatchRecovery:v1'));
  expect(recovered.alternatives).toEqual(expect.arrayContaining([snapshot(), snapshot('yinsh', 2)]));
});

test('a crashed transition requires a fresh writer after lease expiry', () => {
  const store = createMatchStore('yinsh');
  localStorage.setItem('gipf:account-transition', JSON.stringify({id:'crashed',until:Date.now()-1}));
  expect(() => store.save(snapshot())).toThrow('account_changed');
  expect(() => createMatchStore('yinsh').save(snapshot())).not.toThrow();
});

test('clearing writes an account-owned empty value while a new account can still import', () => {
  const store = createMatchStore('chess');
  store.resolve(null);
  expect(createMatchStore('chess').load()).toBeNull();
  expect(createMatchStore('chess').hasCurrent()).toBe(true);
  // Existing account cleanup removes the same key; no device-wide import marker.
  localStorage.removeItem('chessMatch:v1');
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'B' }));
  expect(createMatchStore('chess').hasCurrent()).toBe(false);
});

test('repeated staging and resolution retain eight distinct complete alternatives', () => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  for (let turn = 2; turn <= 8; turn++) {
    store.backup([snapshot('yinsh', turn - 1), snapshot('yinsh', turn)]);
    store.resolve(snapshot('yinsh', turn));
  }
  expect(store.recovery()).toHaveLength(8);
  expect(store.recovery()).toEqual(Array.from({ length: 8 }, (_, i) => snapshot('yinsh', i + 1)));
});

test.each(['{broken', '{}', 'null', '{"v":1,"alternatives":{}}', '{"v":2,"alternatives":[]}'])('malformed recovery is retained byte-for-byte: %s', raw => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  localStorage.setItem('yinshMatchRecovery:v1', raw);
  expect(store.recovery()).toEqual([{ unreadable: raw }]);
  store.resolve(snapshot('yinsh', 2));
  expect(store.recovery()).toEqual([{ unreadable: raw }, snapshot(), snapshot('yinsh', 2)]);
});

test('quota failure repairing recovery leaves both original keys untouched', () => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  localStorage.setItem('yinshMatchRecovery:v1', '{broken');
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => store.resolve(snapshot('yinsh', 2))).toThrow('quota');
  spy.mockRestore();
  expect(localStorage.getItem('yinshMatchRecovery:v1')).toBe('{broken');
  expect(store.load()).toEqual(snapshot());
});

test('restaging an old alternative in a full ring cannot evict either current choice', () => {
  const store = createMatchStore('yinsh');
  store.save(snapshot());
  store.backup(Array.from({ length: 8 }, (_, i) => snapshot('yinsh', i + 1)));
  store.backup([snapshot(), snapshot('yinsh', 9)]);
  expect(store.recovery()).toHaveLength(8);
  expect(store.recovery().slice(-2)).toEqual([snapshot(), snapshot('yinsh', 9)]);
});

test.each([[400, 'sync_rejected'], [413, 'sync_rejected'], [502, 'sync_unavailable'], [429, 'sync_unavailable'], [409, 'cloud_conflict']])('HTTP %s classified without parsing an HTML error page', async (status, error) => {
  localStorage.setItem('gipfAccount', JSON.stringify({ usernameId: 'A', authToken: 'synthetic' }));
  const json = jest.fn().mockRejectedValue(new Error('HTML'));
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status, json });
  await expect(createMatchStore('yinsh').request('write')).rejects.toThrow(error);
  expect(json).not.toHaveBeenCalled();
});
