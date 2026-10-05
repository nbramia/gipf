// Session-cookie accounts: the cached gipfAccount holds no secret, the AES key is a
// non-extractable CryptoKey in IndexedDB, and v1 sessions upgrade silently.
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import {
  ACCOUNT_STORAGE_KEY, SESSION_EXPIRED_KEY, deriveCredentials, encryptApiKey, decryptApiKey, loadSession, saveSession,
  clearSession, accountKey, upgradeLegacySession, expireRejectedSession, pushEncryptedKey, retainProgress,
} from './account.js';

if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;
if (typeof globalThis.TextEncoder === 'undefined') { globalThis.TextEncoder = TextEncoder; globalThis.TextDecoder = TextDecoder; }

// Minimal IndexedDB: one database, one object store, async completion like the real thing.
function fakeIndexedDB() {
  const data = new Map();
  const later = fn => setTimeout(fn, 0);
  return {
    data,
    open() {
      const request = {};
      later(() => {
        request.result = {
          close() {},
          transaction() {
            const tx = {};
            const op = fn => { const r = {}; later(() => { r.result = fn(); later(() => tx.oncomplete && tx.oncomplete()); }); return r; };
            tx.objectStore = () => ({
              put: (value, key) => op(() => { data.set(key, value); }),
              get: key => op(() => data.get(key)),
              delete: key => op(() => { data.delete(key); }),
            });
            return tx;
          },
        };
        request.onsuccess && request.onsuccess();
      });
      return request;
    },
  };
}

let creds;
let calls;
beforeAll(async () => { creds = await deriveCredentials('synthetic-session', 'synthetic-password-1'); });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  globalThis.indexedDB = fakeIndexedDB();
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ configured: true, signedIn: true }) };
  });
  AbortSignal.timeout = () => new AbortController().signal;
});
afterEach(() => { delete globalThis.indexedDB; });

test('sign-in stores a secret-free v2 session and a non-extractable AES key', async () => {
  await saveSession(creds);
  const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  const stored = JSON.parse(raw);
  expect(stored).toEqual({ v: 2, username: creds.username, usernameId: creds.usernameId, sid: expect.stringMatching(/^[a-f0-9]{32}$/) });
  for (const secret of [creds.authToken, creds.aesKey, creds.profileId]) expect(raw).not.toContain(secret);
  const key = await accountKey(loadSession());
  expect(key.extractable).toBe(false);
  await expect(webcrypto.subtle.exportKey('raw', key)).rejects.toThrow();
  // Envelopes from the stored key and the password-derived key are interchangeable.
  expect(await decryptApiKey(creds.aesKey, await encryptApiKey(key, 'synthetic-value'))).toBe('synthetic-value');
  expect(await decryptApiKey(key, await encryptApiKey(creds.aesKey, 'synthetic-value'))).toBe('synthetic-value');
});

test('requests carry the CSRF header and, for a v2 session, no credential in the body', async () => {
  await saveSession(creds);
  const claim = calls.find(c => c.body?.action === 'claim');
  expect(claim.headers['X-Games-Request']).toBe('1');
  expect(claim.body.auth).toBeUndefined();
  calls.length = 0;
  const session = loadSession();
  await pushEncryptedKey({ usernameId: session.usernameId, authToken: session.authToken, enc: null });
  expect(calls[0].headers).toEqual({ 'Content-Type': 'application/json', 'X-Games-Request': '1' });
  expect(calls[0].body).toEqual({ action: 'setKey', u: session.usernameId, enc: null });
});

test('sign-out revokes the server session, forgets the key, and seals progress', async () => {
  await saveSession(creds);
  localStorage.setItem('chessRating', '1500');
  localStorage.setItem('gipfApiKey', 'synthetic-key');
  calls.length = 0;
  await clearSession();
  expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem('gipfApiKey')).toBeNull();
  expect(globalThis.indexedDB.data.has(creds.usernameId)).toBe(false);
  expect(calls.find(c => c.url.endsWith('/api/session')).body).toEqual({ action: 'logout' });
  expect(localStorage.getItem(`gipf:recovery:${creds.usernameId}`)).not.toContain('1500');
  await saveSession(creds);
  expect(localStorage.getItem('chessRating')).toBe('1500');
});

test('sign out everywhere asks the server to revoke every session', async () => {
  await saveSession(creds);
  calls.length = 0;
  await clearSession({ everywhere: true });
  expect(calls.find(c => c.url.endsWith('/api/session')).body).toEqual({ action: 'logout-all' });
});

test('a lost stored key still signs out, without sealing progress', async () => {
  await saveSession(creds);
  globalThis.indexedDB.data.clear();
  jest.resetModules();
  const fresh = await import('./account.js');
  localStorage.setItem('chessRating', '1500');
  await fresh.clearSession();
  expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem('chessRating')).toBe('1500');
  await expect(fresh.accountKey({ usernameId: creds.usernameId, sid: 'x' })).rejects.toThrow('account_key_missing');
});

describe('v1 upgrade', () => {
  const v1 = () => JSON.stringify({ v: 1, ...creds });
  test('a cached v1 session swaps its token for a cookie and drops every secret', async () => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, v1());
    expect(loadSession().sid).toBe(creds.authToken);
    expect(await upgradeLegacySession()).toBe(true);
    expect(calls[0].body).toEqual({ action: 'create', u: creds.usernameId, auth: creds.authToken });
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    expect(JSON.parse(raw).v).toBe(2);
    for (const secret of [creds.authToken, creds.aesKey, creds.profileId]) expect(raw).not.toContain(secret);
    expect((await accountKey(loadSession())).extractable).toBe(false);
  });
  test('network failure, rejection, or a late answer keep the v1 session', async () => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, v1());
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await upgradeLegacySession()).toBe(false);
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'bad_credentials' }) }));
    expect(await upgradeLegacySession()).toBe(false);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ signedIn: true }) }));
    expect(await upgradeLegacySession({ canCommit: () => false })).toBe(false);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(v1());
  });
  test('without IndexedDB the v1 shape is kept', async () => {
    delete globalThis.indexedDB;
    localStorage.setItem(ACCOUNT_STORAGE_KEY, v1());
    expect(await upgradeLegacySession()).toBe(false);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(v1());
  });
});

describe('server-rejected sessions', () => {
  test('a cookie the server rejects signs this device out and flags the notice', async () => {
    await saveSession(creds);
    localStorage.setItem('chessRating', '1500');
    global.fetch = jest.fn(async (url, init = {}) => ({ ok: false, status: init.method ? 200 : 401, json: async () => ({}) }));
    expect(await expireRejectedSession()).toBe(true);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('chessRating')).toBeNull();
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBe('1');
  });
  test('an unreachable server or a live cookie changes nothing', async () => {
    await saveSession(creds);
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await expireRejectedSession()).toBe(false);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ signedIn: true }) }));
    expect(await expireRejectedSession()).toBe(false);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(raw);
  });
});

test('retainProgress refuses a session that is no longer the active one', async () => {
  await saveSession(creds);
  localStorage.setItem('chessRating', '1500');
  await expect(retainProgress({ ...loadSession(), sid: 'stale' })).rejects.toThrow('account_changed');
});
