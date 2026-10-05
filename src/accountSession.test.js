// Auth0 sessions on the device: the cached gipfAccount (v3) holds no secret, the seal
// key is a non-extractable CryptoKey in IndexedDB, and account keys stay on the server.
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import {
  ACCOUNT_STORAGE_KEY, SESSION_EXPIRED_KEY, encryptApiKey, decryptApiKey, loadSession, saveSession,
  clearSession, accountKey, expireRejectedSession, retainProgress,
  completeSignIn, saveAccountKeys, signInUrl,
} from './account.js';
import { accountKeys } from './accountKeys.js';

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


const SEAL = Buffer.alloc(32, 11).toString('base64');
const DATA_ID = 'f'.repeat(64);
let calls;
// The synthetic server: each route answers from `server`, which a test may change.
let server;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  globalThis.indexedDB = fakeIndexedDB();
  calls = [];
  server = {
    establish: { signedIn: true, u: DATA_ID, name: 'player@synthetic.example', keys: { anthropic: false, lichess: false }, sealKey: SEAL },
    status: { signedIn: true, u: DATA_ID, name: 'player@synthetic.example', keys: { anthropic: false, lichess: false } },
    account: body => reply(200, { saved: true, keys: { anthropic: 'anthropic' in body ? body.anthropic !== null : false, lichess: 'lichess' in body ? body.lichess !== null : false } }),
  };
  global.fetch = jest.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body });
    if (url.endsWith('/api/session')) return init.method === 'POST' ? reply(200, server.establish) : (typeof server.status === 'number' ? reply(server.status, {}) : reply(200, server.status));
    if (url.endsWith('/api/chessAccount')) return server.account(body);
    if (url.endsWith('/api/auth/logout')) return reply(200, { signedOut: true });
    return reply(200, { configured: true });
  });
  AbortSignal.timeout = () => new AbortController().signal;
});
afterEach(() => { delete globalThis.indexedDB; });
const account = (name = 'player@synthetic.example') => ({ username: name, usernameId: DATA_ID, aesKey: SEAL });

test('completing sign-in stores a secret-free v3 session and a non-extractable seal key', async () => {
  const result = await completeSignIn();
  expect(result).toEqual({ keys: { anthropic: false, lichess: false }, keysMoved: true });
  const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  expect(JSON.parse(raw)).toEqual({ v: 3, username: 'player@synthetic.example', usernameId: DATA_ID, sid: expect.stringMatching(/^[a-f0-9]{32}$/) });
  expect(raw).not.toContain(SEAL);
  const establish = calls.find(c => c.url.endsWith('/api/session'));
  expect(establish.method).toBe('POST');
  expect(establish.headers).toEqual({ 'Content-Type': 'application/json', 'X-Games-Request': '1' });
  expect(establish.body).toEqual({ action: 'establish' });
  const key = await accountKey(loadSession());
  expect(key.extractable).toBe(false);
  await expect(webcrypto.subtle.exportKey('raw', key)).rejects.toThrow();
  expect(await decryptApiKey(SEAL, await encryptApiKey(key, 'synthetic-value'))).toBe('synthetic-value');
  // Signing in makes no request beyond establishing the session.
  expect(calls.map(c => c.url)).toEqual(['/api/session']);
});

test('guest device keys move to an account that lacks them, then leave the device', async () => {
  localStorage.setItem('gipfApiKey', 'sk-ant-synthetic-guest');
  localStorage.setItem('chessLichessToken', 'lip_syntheticGuest');
  server.establish = { ...server.establish, keys: { anthropic: false, lichess: true } };
  server.account = () => reply(200, { saved: true, keys: { anthropic: true, lichess: true } });
  const result = await completeSignIn();
  const moved = calls.find(c => c.body?.action === 'setKeys');
  expect(moved.body).toEqual({ action: 'setKeys', anthropic: 'sk-ant-synthetic-guest' });
  expect(moved.headers['X-Games-Request']).toBe('1');
  expect(result.keysMoved).toBe(true);
  expect(localStorage.getItem('gipfApiKey')).toBeNull();
  expect(localStorage.getItem('chessLichessToken')).toBeNull();
  expect(accountKeys()).toEqual({ anthropic: true, lichess: true });
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/sk-ant-synthetic-guest|lip_syntheticGuest/);
});

test('a failed key move is reported and the device key still leaves', async () => {
  localStorage.setItem('gipfApiKey', 'sk-ant-synthetic-guest');
  server.account = () => reply(503, { error: 'store_unavailable' });
  const result = await completeSignIn();
  expect(result.keysMoved).toBe(false);
  expect(localStorage.getItem('gipfApiKey')).toBeNull();
  expect(accountKeys()).toEqual({ anthropic: false, lichess: false });
});

test('a sign-in the server does not recognize throws and switches nothing', async () => {
  server.establish = { error: 'signed_out' };
  global.fetch.mockImplementationOnce(async () => reply(401, { error: 'signed_out' }));
  await expect(completeSignIn()).rejects.toThrow('signed_out');
  expect(loadSession()).toBeNull();
});

test('account keys are sent once and only their status is kept', async () => {
  await saveSession(account());
  calls.length = 0;
  server.account = () => reply(200, { saved: true, keys: { anthropic: true, lichess: false } });
  const res = await saveAccountKeys({ anthropic: 'sk-ant-synthetic-new' });
  expect(res.keys).toEqual({ anthropic: true, lichess: false });
  expect(calls[0].body).toEqual({ action: 'setKeys', anthropic: 'sk-ant-synthetic-new' });
  expect(calls[0].headers).toEqual({ 'Content-Type': 'application/json', 'X-Games-Request': '1' });
  expect(JSON.stringify({ ...localStorage })).not.toContain('sk-ant-synthetic-new');
  expect(accountKeys()).toEqual({ anthropic: true, lichess: false });
  global.fetch.mockImplementationOnce(async () => { throw new Error('offline'); });
  expect(await saveAccountKeys({ anthropic: null })).toEqual({ error: 'network' });
});

test('signInUrl carries the return path and the reauthenticate choice', () => {
  expect(signInUrl('/catan')).toBe('/api/auth/login?return=%2Fcatan');
  expect(signInUrl('/', { reauthenticate: true })).toBe('/api/auth/login?return=%2F&reauthenticate=1');
});

test('sign-out revokes the server session, forgets the key, and seals progress', async () => {
  await saveSession(account(), { keys: { anthropic: true, lichess: true } });
  localStorage.setItem('chessRating', '1500');
  calls.length = 0;
  await clearSession();
  expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
  expect(accountKeys()).toEqual({ anthropic: false, lichess: false });
  expect(globalThis.indexedDB.data.has(DATA_ID)).toBe(false);
  const logout = calls.find(c => c.url.endsWith('/api/auth/logout'));
  expect(logout.body).toEqual({ everywhere: false });
  expect(logout.headers['X-Games-Request']).toBe('1');
  expect(localStorage.getItem(`gipf:recovery:${DATA_ID}`)).not.toContain('1500');
  // The server hands back the same seal key at the next sign-in, which reopens it.
  await completeSignIn();
  expect(localStorage.getItem('chessRating')).toBe('1500');
});

test('sign out everywhere asks the server to revoke every session', async () => {
  await saveSession(account());
  calls.length = 0;
  await clearSession({ everywhere: true });
  expect(calls.find(c => c.url.endsWith('/api/auth/logout')).body).toEqual({ everywhere: true });
});

test('a lost stored key still signs out, without sealing progress', async () => {
  await saveSession(account());
  globalThis.indexedDB.data.clear();
  jest.resetModules();
  const fresh = await import('./account.js');
  localStorage.setItem('chessRating', '1500');
  await fresh.clearSession();
  expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem('chessRating')).toBe('1500');
  await expect(fresh.accountKey({ usernameId: DATA_ID, sid: 'x' })).rejects.toThrow('account_key_missing');
});

describe('server-rejected sessions', () => {
  test('a cookie the server rejects signs this device out and flags the notice', async () => {
    await saveSession(account());
    localStorage.setItem('chessRating', '1500');
    server.status = 401;
    expect(await expireRejectedSession()).toBe(true);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('chessRating')).toBeNull();
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBe('expired');
  });
  test('a live cookie refreshes the key marker; an unreachable server changes nothing', async () => {
    await saveSession(account());
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    server.status = { ...server.status, keys: { anthropic: true, lichess: false } };
    expect(await expireRejectedSession()).toBe(false);
    expect(accountKeys()).toEqual({ anthropic: true, lichess: false });
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await expireRejectedSession()).toBe(false);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(raw);
  });
  test('a live session for another account (a sign-in finishing at /login) changes nothing', async () => {
    await saveSession(account());
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    server.status = { ...server.status, u: 'e'.repeat(64) };
    expect(await expireRejectedSession()).toBe(false);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(raw);
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBeNull();
  });
  test('only v3 sessions are checked', async () => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ v: 2, username: 'player@synthetic.example', usernameId: DATA_ID, sid: 'a'.repeat(32) }));
    expect(await expireRejectedSession()).toBe(false);
    expect(calls).toEqual([]);
  });
});

test('retainProgress refuses a session that is no longer the active one', async () => {
  await saveSession(account());
  localStorage.setItem('chessRating', '1500');
  await expect(retainProgress({ ...loadSession(), sid: 'stale' })).rejects.toThrow('account_changed');
});
