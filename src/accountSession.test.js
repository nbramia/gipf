// Auth0 sessions on the device: the cached gipfAccount (v3) holds no secret, the seal
// key is a non-extractable CryptoKey in IndexedDB, account keys stay on the server,
// password-era sessions retire at startup, and an old account links once.
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import {
  ACCOUNT_STORAGE_KEY, SESSION_EXPIRED_KEY, deriveCredentials, encryptApiKey, decryptApiKey, loadSession, saveSession,
  clearSession, accountKey, storeAccountKey, retireLegacySession, expireRejectedSession, retainProgress,
  completeSignIn, linkOldAccount, saveAccountKeys, signInUrl,
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
let creds;
let calls;
// The synthetic server: each route answers from `server`, which a test may change.
let server;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
beforeAll(async () => { creds = await deriveCredentials('synthetic-session', 'synthetic-password-1'); });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  globalThis.indexedDB = fakeIndexedDB();
  calls = [];
  server = {
    establish: { signedIn: true, u: DATA_ID, name: 'player@synthetic.example', linked: false, keys: { anthropic: false, lichess: false }, sealKey: SEAL, offerLink: true },
    status: { signedIn: true, u: DATA_ID, name: 'player@synthetic.example', linked: false, keys: { anthropic: false, lichess: false } },
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
  expect(result).toEqual({ offerLink: true, keys: { anthropic: false, lichess: false }, keysMoved: true });
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
  // No password-era claim is made for an Auth0 account.
  expect(calls.some(c => c.body?.action === 'claim')).toBe(false);
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

describe('password-era sessions retire at startup', () => {
  test('a v1 session signs out, sealing progress under its password key, and flags the notice', async () => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ v: 1, ...creds }));
    localStorage.setItem('chessRating', '1400');
    localStorage.setItem('gipfApiKey', 'sk-ant-synthetic-old');
    expect(await retireLegacySession()).toBe(true);
    expect(loadSession()).toBeNull();
    expect(localStorage.getItem('chessRating')).toBeNull();
    expect(localStorage.getItem('gipfApiKey')).toBeNull();
    const sealed = JSON.parse(localStorage.getItem(`gipf:recovery:${creds.usernameId}`));
    expect(JSON.parse(await decryptApiKey(creds.aesKey, sealed)).chessRating).toBe('1400');
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBe('auth0');
    await new Promise(r => setTimeout(r, 0));
    expect(calls.some(c => c.url.endsWith('/api/auth/logout'))).toBe(true);
  });
  test('a v2 session signs out the same way, with its stored key', async () => {
    await storeAccountKey(creds.usernameId, creds.aesKey);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ v: 2, username: creds.username, usernameId: creds.usernameId, sid: 'a'.repeat(32) }));
    localStorage.setItem('yinshWins', '3');
    expect(await retireLegacySession()).toBe(true);
    expect(loadSession()).toBeNull();
    const sealed = JSON.parse(localStorage.getItem(`gipf:recovery:${creds.usernameId}`));
    expect(JSON.parse(await decryptApiKey(creds.aesKey, sealed)).yinshWins).toBe('3');
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBe('auth0');
  });
  test('a v3 session or a guest is left alone', async () => {
    expect(await retireLegacySession()).toBe(false);
    await saveSession(account());
    expect(await retireLegacySession()).toBe(false);
    expect(loadSession().v).toBe(3);
  });
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
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ v: 1, ...creds }));
    expect(await expireRejectedSession()).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('linking an old games account', () => {
  test('verifies, opens the old keys here, links with plaintext and the old key, then switches to the old progress', async () => {
    await saveSession(account());
    localStorage.setItem('chessRating', '1000');
    localStorage.setItem(`gipf:recovery:${creds.usernameId}`, JSON.stringify(await encryptApiKey(creds.aesKey, JSON.stringify({ chessRating: '1600' }))));
    const enc = await encryptApiKey(creds.aesKey, 'sk-ant-synthetic-old');
    const encLichess = await encryptApiKey(creds.aesKey, 'lip_syntheticOld');
    server.account = body => body.action === 'link-verify'
      ? reply(200, { verified: true, enc, encLichess })
      : reply(200, { linked: true, u: creds.usernameId, keys: { anthropic: true, lichess: true } });
    calls.length = 0;
    expect(await linkOldAccount('synthetic-session', 'synthetic-password-1')).toEqual({ linked: true });
    const [verify, link] = calls.filter(c => c.url.endsWith('/api/chessAccount')).map(c => c.body);
    expect(verify).toEqual({ action: 'link-verify', u: creds.usernameId, auth: creds.authToken });
    expect(link).toEqual({ action: 'link', u: creds.usernameId, auth: creds.authToken, sealKey: creds.aesKey, anthropic: 'sk-ant-synthetic-old', lichess: 'lip_syntheticOld' });
    expect(calls.every(c => c.headers['X-Games-Request'] === '1' || c.method === 'GET')).toBe(true);
    const session = loadSession();
    expect([session.v, session.usernameId, session.username]).toEqual([3, creds.usernameId, 'player@synthetic.example']);
    expect(localStorage.getItem('chessRating')).toBe('1600');
    expect(accountKeys()).toEqual({ anthropic: true, lichess: true });
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/sk-ant-synthetic-old|lip_syntheticOld/);
    // The Auth0 sign-in's own progress is sealed, not lost.
    expect(localStorage.getItem(`gipf:recovery:${DATA_ID}`)).toBeTruthy();
    // The linked account's password-derived profile is claimed.
    expect(calls.find(c => c.body?.action === 'claim').body.legacyId).toBe(creds.profileId);
  });
  test('a wrong password or a refused link changes nothing on the device', async () => {
    await saveSession(account());
    const before = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    server.account = () => reply(401, { error: 'bad_credentials' });
    expect(await linkOldAccount('synthetic-session', 'synthetic-password-1')).toEqual({ error: 'bad_credentials', status: 401 });
    expect(calls.filter(c => c.body?.action === 'link')).toEqual([]);
    server.account = body => body.action === 'link-verify' ? reply(200, { verified: true, enc: null, encLichess: null }) : reply(409, { error: 'account_linked' });
    expect((await linkOldAccount('synthetic-session', 'synthetic-password-1')).error).toBe('account_linked');
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(before);
  });
  test('needs a signed-in v3 session', async () => {
    expect(await linkOldAccount('synthetic-session', 'synthetic-password-1')).toEqual({ error: 'signed_out' });
    expect(calls).toEqual([]);
  });
});

test('retainProgress refuses a session that is no longer the active one', async () => {
  await saveSession(account());
  localStorage.setItem('chessRating', '1500');
  await expect(retainProgress({ ...loadSession(), sid: 'stale' })).rejects.toThrow('account_changed');
});
