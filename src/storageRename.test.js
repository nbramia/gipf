import { renamedKey, renameStorageArea, renameLegacyStorage, renameKeyDatabase, LEGACY_KEY_DB } from './storageRename.js';

// Several named databases, each with object stores, plus databases() and deleteDatabase().
function fakeIndexedDB() {
  const dbs = new Map();
  const later = fn => setTimeout(fn, 0);
  const req = (fn, extra = {}) => { const r = { ...extra }; later(() => { try { r.result = fn(r); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  const connection = name => {
    const stores = dbs.get(name);
    return {
      objectStoreNames: { contains: s => stores.has(s) },
      createObjectStore: s => { stores.set(s, new Map()); },
      close() {},
      transaction(s) {
        const tx = {};
        let pending = 0;
        const op = fn => { pending++; return req(() => { const v = fn(); pending--; later(() => { if (!pending && !tx.done) { tx.done = true; tx.oncomplete && tx.oncomplete(); } }); return v; }); };
        tx.objectStore = () => {
          const m = stores.get(s);
          return {
            get: k => op(() => m.get(k)),
            put: (v, k) => op(() => { m.set(k, v); }),
            getAll: () => op(() => [...m.values()]),
            getAllKeys: () => op(() => [...m.keys()]),
          };
        };
        return tx;
      },
    };
  };
  return {
    dbs,
    databases: async () => [...dbs.keys()].map(name => ({ name, version: 1 })),
    deleteDatabase: name => req(() => { dbs.delete(name); }),
    open(name) {
      const r = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        r.result = connection(name);
        if (fresh && r.onupgradeneeded) r.onupgradeneeded();
        later(() => r.onsuccess && r.onsuccess());
      });
      return r;
    },
  };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

test('only the legacy app names are renamed', () => {
  expect(renamedKey('gipfAccount')).toBe('playAccount');
  expect(renamedKey('gipfApiKey')).toBe('playApiKey');
  expect(renamedKey('gipfAccountKeys')).toBe('playAccountKeys');
  expect(renamedKey('gipf:recovery:abc')).toBe('play:recovery:abc');
  expect(renamedKey('gipf:silent-sign-in-at')).toBe('play:silent-sign-in-at');
  for (const key of ['chessRating', 'playAccount', 'gipfy', 'gipf', 'yinshMatch:v1', null]) expect(renamedKey(key)).toBeNull();
});

test('legacy localStorage and sessionStorage keys move to their play names', () => {
  localStorage.setItem('gipfAccount', '{"v":3}');
  localStorage.setItem('gipfApiKey', 'sk-ant-synthetic');
  localStorage.setItem('gipf:recovery:abc', 'sealed');
  localStorage.setItem('chessRating', '1500');
  sessionStorage.setItem('gipf:silent-sign-in-at', '123');
  sessionStorage.setItem('gipf:session-expired', 'expired');
  renameLegacyStorage();
  expect(localStorage.getItem('playAccount')).toBe('{"v":3}');
  expect(localStorage.getItem('playApiKey')).toBe('sk-ant-synthetic');
  expect(localStorage.getItem('play:recovery:abc')).toBe('sealed');
  expect(localStorage.getItem('chessRating')).toBe('1500');
  expect(sessionStorage.getItem('play:silent-sign-in-at')).toBe('123');
  expect(sessionStorage.getItem('play:session-expired')).toBe('expired');
  for (const area of [localStorage, sessionStorage]) {
    expect(Object.keys(area).filter(k => k.startsWith('gipf'))).toEqual([]);
  }
});

test('a value already under the new name wins, and the legacy copy is still removed', () => {
  localStorage.setItem('playAccount', 'new');
  localStorage.setItem('gipfAccount', 'old');
  expect(renameStorageArea(localStorage)).toBe(1);
  expect(localStorage.getItem('playAccount')).toBe('new');
  expect(localStorage.getItem('gipfAccount')).toBeNull();
});

test('running twice is a no-op the second time', () => {
  localStorage.setItem('gipf:account-epoch', 'e1');
  expect(renameStorageArea(localStorage)).toBe(1);
  expect(renameStorageArea(localStorage)).toBe(0);
  expect(localStorage.getItem('play:account-epoch')).toBe('e1');
});

test('unavailable storage does not throw at startup', () => {
  expect(renameStorageArea(null)).toBe(0);
  const spy = jest.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new Error('SecurityError'); });
  localStorage.setItem('gipfAccount', 'x');
  expect(() => renameLegacyStorage()).not.toThrow();
  spy.mockRestore();
});

describe('the key database', () => {
  test('entries move from gipf-account to play-account and the legacy database is deleted', async () => {
    const idb = fakeIndexedDB();
    idb.dbs.set(LEGACY_KEY_DB, new Map([['keys', new Map([['id-1', 'key-1'], ['id-2', 'key-2']])]]));
    expect(await renameKeyDatabase('play-account', 'keys', idb)).toBe(true);
    await new Promise(r => setTimeout(r, 5));
    expect([...idb.dbs.get('play-account').get('keys')]).toEqual([['id-1', 'key-1'], ['id-2', 'key-2']]);
    expect(idb.dbs.has(LEGACY_KEY_DB)).toBe(false);
  });

  test('an entry already in play-account is kept', async () => {
    const idb = fakeIndexedDB();
    idb.dbs.set(LEGACY_KEY_DB, new Map([['keys', new Map([['id-1', 'old'], ['id-2', 'key-2']])]]));
    idb.dbs.set('play-account', new Map([['keys', new Map([['id-1', 'new']])]]));
    await renameKeyDatabase('play-account', 'keys', idb);
    expect(idb.dbs.get('play-account').get('keys').get('id-1')).toBe('new');
    expect(idb.dbs.get('play-account').get('keys').get('id-2')).toBe('key-2');
  });

  test('nothing happens without a legacy database, or without databases()', async () => {
    const idb = fakeIndexedDB();
    expect(await renameKeyDatabase('play-account', 'keys', idb)).toBe(false);
    expect(idb.dbs.size).toBe(0);
    const old = fakeIndexedDB();
    delete old.databases;
    old.dbs.set(LEGACY_KEY_DB, new Map([['keys', new Map([['id-1', 'k']])]]));
    expect(await renameKeyDatabase('play-account', 'keys', old)).toBe(false);
    expect(old.dbs.has(LEGACY_KEY_DB)).toBe(true);
    expect(await renameKeyDatabase('play-account', 'keys', undefined)).toBe(false);
  });

  test('a second run finds nothing to move', async () => {
    const idb = fakeIndexedDB();
    idb.dbs.set(LEGACY_KEY_DB, new Map([['keys', new Map([['id-1', 'k']])]]));
    await renameKeyDatabase('play-account', 'keys', idb);
    await new Promise(r => setTimeout(r, 5));
    expect(await renameKeyDatabase('play-account', 'keys', idb)).toBe(false);
    expect(idb.dbs.get('play-account').get('keys').get('id-1')).toBe('k');
  });
});
