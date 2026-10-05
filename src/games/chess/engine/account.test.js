// account.test.js — encrypt/decrypt and session persistence. Style mirrors
// rating.test.js; fetch client isn't tested here (no fetch in jsdom, same as
// profileSync tests).
//
// jsdom (this project's jest test environment) doesn't implement
// SubtleCrypto, so we polyfill globalThis.crypto with Node's built-in
// webcrypto for this test file only — production code (browsers) already
// has a native Web Crypto API.

import { webcrypto, createHash } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import {
  ACCOUNT_STORAGE_KEY,
  encryptApiKey,
  decryptApiKey,
  loadSession,
  saveSession,
  clearSession,
  accountKey,
  discardUnreadableSession,
} from './account.js';
import { accountKeys } from '../../../accountKeys.js';

// A synthetic signed-in account as completeSignIn hands it to saveSession: the
// account name, its data id, and the server's base64 seal key.
const digest = label => createHash('sha256').update(label).digest();
const account = label => ({
  username: label,
  usernameId: digest(`id:${label}`).toString('hex'),
  aesKey: digest(`seal:${label}`).toString('base64'),
});

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

describe('encryptApiKey / decryptApiKey', () => {
  const { aesKey } = account('Alice');

  test('round-trips a realistic API key', async () => {
    const plaintext = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const enc = await encryptApiKey(aesKey, plaintext);
    expect(await decryptApiKey(aesKey, enc)).toBe(plaintext);
  });

  test('round-trips the empty string', async () => {
    const enc = await encryptApiKey(aesKey, '');
    expect(await decryptApiKey(aesKey, enc)).toBe('');
  });

  test('ciphertexts differ across calls (random IV) yet both decrypt correctly', async () => {
    const plaintext = 'sk-ant-same-key-twice';
    const encA = await encryptApiKey(aesKey, plaintext);
    const encB = await encryptApiKey(aesKey, plaintext);
    expect(encA.iv).not.toBe(encB.iv);
    expect(encA.ct).not.toBe(encB.ct);
    expect(await decryptApiKey(aesKey, encA)).toBe(plaintext);
    expect(await decryptApiKey(aesKey, encB)).toBe(plaintext);
  });

  test('decrypting with the wrong aesKey rejects', async () => {
    const { aesKey: wrongKey } = account('Bob');
    const enc = await encryptApiKey(aesKey, 'sk-ant-secret');
    await expect(decryptApiKey(wrongKey, enc)).rejects.toBeTruthy();
  });
});

describe('encryptApiKey / decryptApiKey — two independent secrets under one account', () => {
  // The account carries two BYO secrets (the Anthropic API key and the
  // Lichess explorer token) sealed under the same AES key. encryptApiKey/decryptApiKey are generic string encryptors, so this
  // just confirms they don't cross-contaminate when used twice per account.
  const { aesKey } = account('Alice');

  test('the same AES key independently encrypts/decrypts an API key and a Lichess token', async () => {
    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const lichessToken = 'lip_abcdefghijklmnopqrstuvwxyz012345';

    const encKey = await encryptApiKey(aesKey, apiKey);
    const encLichess = await encryptApiKey(aesKey, lichessToken);

    expect(await decryptApiKey(aesKey, encKey)).toBe(apiKey);
    expect(await decryptApiKey(aesKey, encLichess)).toBe(lichessToken);
  });

  test('wrong key still rejects for the Lichess token ciphertext', async () => {
    const { aesKey: wrongKey } = account('Bob');
    const encLichess = await encryptApiKey(aesKey, 'lip_some-lichess-token');
    await expect(decryptApiKey(wrongKey, encLichess)).rejects.toBeTruthy();
  });
});

describe('session persistence', () => {
  afterEach(async () => {
    await clearSession();
  });

  const session = account('Alice');

  test('save/load writes a secret-free v3 session; without IndexedDB the key is held for this page', async () => {
    await saveSession(session);
    expect(loadSession()).toEqual({ v: 3, username: session.username, usernameId: session.usernameId, sid: expect.stringMatching(/^[a-f0-9]{32}$/) });
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    expect(raw).not.toContain(session.aesKey);
    expect((await accountKey(loadSession())).extractable).toBe(false);
  });

  test.each([
    ['v1', { v: 1, username: 'Alice', usernameId: 'a'.repeat(64), authToken: 'b'.repeat(64), aesKey: 'x', profileId: 'c'.repeat(64) }],
    ['v2', { v: 2, username: 'Alice', usernameId: 'a'.repeat(64), sid: 'b'.repeat(32) }],
  ])('a %s password-era record is not a session, and startup discards it but keeps progress', (_, record) => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(record));
    localStorage.setItem('chessRating', '1500');
    expect(loadSession()).toBeNull();
    expect(discardUnreadableSession()).toBe(true);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('chessRating')).toBe('1500');
    localStorage.clear();
  });

  test('discardUnreadableSession leaves a valid v3 session and an empty slot alone', async () => {
    expect(discardUnreadableSession()).toBe(false);
    await saveSession(session);
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    expect(discardUnreadableSession()).toBe(false);
    expect(localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe(raw);
  });

  test('loadSession returns null when nothing is stored', () => {
    expect(loadSession()).toBeNull();
  });

  test('loadSession returns null on malformed JSON', () => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, '{not valid json');
    expect(loadSession()).toBeNull();
  });

  test('loadSession returns null on a wrong-shape object', () => {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ v: 1, foo: 'bar' }));
    expect(loadSession()).toBeNull();

    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ username: 'Alice', usernameId: 'a'.repeat(64), sid: 'b'.repeat(32) })); // missing v:3
    expect(loadSession()).toBeNull();

    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(['not', 'an', 'object']));
    expect(loadSession()).toBeNull();
  });

  test('clearSession removes the stored session', async () => {
    await saveSession(session);
    expect(loadSession()).not.toBeNull();
    await clearSession();
    expect(loadSession()).toBeNull();
  });
});

test('logout clears both credentials and encrypts outgoing progress for that account', async () => {
  const a = account('synthetic-a');
  await saveSession(a);
  localStorage.setItem('gipfApiKey', 'synthetic-secret');
  localStorage.setItem('chessLichessToken', 'synthetic-token');
  localStorage.setItem('chessRating', '1234');
  await clearSession();
  expect(localStorage.getItem('gipfApiKey')).toBeNull();
  expect(localStorage.getItem('chessLichessToken')).toBeNull();
  expect(localStorage.getItem('chessRating')).toBeNull();
  const recovery = localStorage.getItem(`gipf:recovery:${a.usernameId}`);
  expect(recovery).not.toContain('1234');
  expect(recovery).not.toContain('synthetic-secret');
  await saveSession(a);
  expect(localStorage.getItem('chessRating')).toBe('1234');
});

test('account B sees neither A progress nor A keys and A can recover unsynced progress', async () => {
  localStorage.clear();
  const a = account('synthetic-account-a');
  const b = account('synthetic-account-b');
  localStorage.setItem('gipfApiKey', 'synthetic-guest-secret');
  await saveSession(a, { keys: { anthropic: true, lichess: true } });
  // Signed in, no key stays on the device; only the account marker says one exists.
  expect(localStorage.getItem('gipfApiKey')).toBeNull();
  expect(accountKeys()).toEqual({ anthropic: true, lichess: true });
  localStorage.setItem('chessRating', '1729');
  await saveSession(b);
  expect(accountKeys()).toEqual({ anthropic: false, lichess: false });
  expect(localStorage.getItem('chessRating')).toBeNull();
  expect(localStorage.getItem('gipfApiKey')).toBeNull();
  expect(localStorage.getItem('chessLichessToken')).toBeNull();
  expect(JSON.stringify(Object.values(localStorage))).not.toContain('1729');
  await clearSession();
  await saveSession(a);
  expect(localStorage.getItem('chessRating')).toBe('1729');
  await clearSession();
});

test('guest progress is preserved separately and imported only by explicit choice', async () => {
  localStorage.clear();
  const a = account('synthetic-guest-test');
  localStorage.setItem('chessRating', '1357');
  await saveSession(a);
  expect(localStorage.getItem('chessRating')).toBeNull();
  expect(JSON.parse(localStorage.getItem('gipf:guest:recovery')).chessRating).toBe('1357');
  await clearSession();
  await saveSession(a, { importGuest: true });
  expect(localStorage.getItem('chessRating')).toBe('1357');
  await clearSession();
});

test('recovery quota failure aborts logout before deleting the only copy', async () => {
  localStorage.clear();
  const a = account('synthetic-quota');
  await saveSession(a, { keys: { anthropic: true, lichess: false } });
  localStorage.setItem('chessRating', '1492');
  const original = Storage.prototype.setItem;
  const mock = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith('gipf:recovery:')) throw new Error('synthetic quota');
    return original.call(this, key, value);
  });
  await expect(clearSession()).rejects.toThrow('synthetic quota');
  expect(loadSession().usernameId).toBe(a.usernameId);
  expect(localStorage.getItem('chessRating')).toBe('1492');
  expect(accountKeys().anthropic).toBe(true);
  mock.mockRestore();
  await clearSession();
});

test('existing Chess and Diplomacy local saves stay with the outgoing account', async () => {
  localStorage.clear();
  const a = account('synthetic-local-saves');
  await saveSession(a);
  localStorage.setItem('chessGameState', '{"synthetic":"chess-a"}');
  localStorage.setItem('diplomacyGameState', '{"synthetic":"diplomacy-a"}');
  await clearSession();
  expect(localStorage.getItem('chessGameState')).toBeNull();
  expect(localStorage.getItem('diplomacyGameState')).toBeNull();
  await saveSession(a);
  expect(localStorage.getItem('chessGameState')).toBe('{"synthetic":"chess-a"}');
  expect(localStorage.getItem('diplomacyGameState')).toBe('{"synthetic":"diplomacy-a"}');
  await clearSession();
});

test('four-game pending saves and alternatives stay encrypted with their original account', async () => {
  localStorage.clear();
  const a = account('synthetic-four-saves-a');
  const b = account('synthetic-four-saves-b');
  await saveSession(a);
  for (const game of ['chess','yinsh','zertz','catan']) {
    localStorage.setItem(`${game}Match:v1`, JSON.stringify({ synthetic: 'unsynced-A' }));
    localStorage.setItem(`${game}MatchSync:v1`, JSON.stringify({ owner: a.usernameId, revision: 4 }));
    localStorage.setItem(`${game}MatchRecovery:v1`, JSON.stringify({ alternatives: ['A-only'] }));
  }
  await saveSession(b);
  for (const game of ['chess','yinsh','zertz','catan']) {
    expect(localStorage.getItem(`${game}Match:v1`)).toBeNull();
    expect(localStorage.getItem(`${game}MatchSync:v1`)).toBeNull();
    expect(localStorage.getItem(`${game}MatchRecovery:v1`)).toBeNull();
  }
  expect(localStorage.getItem(`gipf:recovery:${a.usernameId}`)).not.toContain('unsynced-A');
  await saveSession(a);
  expect(localStorage.getItem('catanMatch:v1')).toContain('unsynced-A');
  expect(JSON.parse(localStorage.getItem('catanMatchSync:v1')).owner).toBe(a.usernameId);
  await clearSession();
});
test('four-game guest import remains explicit and repeat import does not replace account edits', async () => {
  localStorage.clear();
  const a = account('synthetic-four-guest');
  localStorage.setItem('yinshMatch:v1','{"id":"guest-only"}');
  await saveSession(a);
  expect(localStorage.getItem('yinshMatch:v1')).toBeNull();
  await clearSession(); await saveSession(a,{importGuest:true});
  expect(localStorage.getItem('yinshMatch:v1')).toBe('{"id":"guest-only"}');
  localStorage.setItem('yinshMatch:v1','{"id":"account-edit"}');
  await clearSession(); await saveSession(a,{importGuest:true});
  expect(localStorage.getItem('yinshMatch:v1')).toBe('{"id":"account-edit"}');
  await clearSession();
});
