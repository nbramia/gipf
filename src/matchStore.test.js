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

test('a crashed transition lease expires without changing the account identity', () => {
  const store = createMatchStore('yinsh');
  localStorage.setItem('gipf:account-transition', JSON.stringify({id:'crashed',until:Date.now()-1}));
  expect(() => store.save(snapshot())).not.toThrow();
});
