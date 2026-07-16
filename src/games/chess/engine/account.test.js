// account.test.js — deriveCredentials, encrypt/decrypt, and session
// persistence. Style mirrors rating.test.js; fetch client isn't tested here
// (no fetch in jsdom, same as profileSync/ratingSync tests).
//
// jsdom (this project's jest test environment) doesn't implement
// SubtleCrypto, so we polyfill globalThis.crypto with Node's built-in
// webcrypto for this test file only — production code (browsers) already
// has a native Web Crypto API.
//
// deriveCredentials runs 310k rounds of PBKDF2 per call, so this suite
// computes each distinct input combination exactly once in beforeAll and
// reuses the results across assertions to stay fast.

import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import {
  ACCOUNT_STORAGE_KEY,
  deriveCredentials,
  encryptApiKey,
  decryptApiKey,
  loadSession,
  saveSession,
  clearSession,
} from './account.js';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

describe('deriveCredentials', () => {
  let base, baseRepeat, caseVariant, diffPassword, diffUsername;

  beforeAll(async () => {
    base = await deriveCredentials('Alice', 'correct horse battery staple');
    baseRepeat = await deriveCredentials('Alice', 'correct horse battery staple');
    caseVariant = await deriveCredentials('  ALICE  ', 'correct horse battery staple');
    diffPassword = await deriveCredentials('Alice', 'a totally different password');
    diffUsername = await deriveCredentials('Bob', 'correct horse battery staple');
  }, 30000);

  test('is deterministic: same inputs -> identical triple', () => {
    expect(baseRepeat.usernameId).toBe(base.usernameId);
    expect(baseRepeat.authToken).toBe(base.authToken);
    expect(baseRepeat.aesKey).toBe(base.aesKey);
    expect(baseRepeat.profileId).toBe(base.profileId);
  });

  test('username is case/whitespace-insensitive for derivation, but display username is preserved trimmed', () => {
    expect(caseVariant.usernameId).toBe(base.usernameId);
    expect(caseVariant.authToken).toBe(base.authToken);
    expect(caseVariant.aesKey).toBe(base.aesKey);
    expect(caseVariant.profileId).toBe(base.profileId);
    expect(caseVariant.username).toBe('ALICE');
    expect(base.username).toBe('Alice');
  });

  test('a different password changes every derived secret', () => {
    expect(diffPassword.usernameId).toBe(base.usernameId); // username-only hash is unaffected
    expect(diffPassword.authToken).not.toBe(base.authToken);
    expect(diffPassword.aesKey).not.toBe(base.aesKey);
    expect(diffPassword.profileId).not.toBe(base.profileId);
  });

  test('a different username changes every derived secret', () => {
    expect(diffUsername.usernameId).not.toBe(base.usernameId);
    expect(diffUsername.authToken).not.toBe(base.authToken);
    expect(diffUsername.aesKey).not.toBe(base.aesKey);
    expect(diffUsername.profileId).not.toBe(base.profileId);
  });

  test('authToken and profileId are 64-char lowercase hex, and differ from each other', () => {
    expect(base.authToken).toMatch(/^[0-9a-f]{64}$/);
    expect(base.profileId).toMatch(/^[0-9a-f]{64}$/);
    expect(base.authToken).not.toBe(base.profileId);
  });

  test('returns null for an empty username or empty password', async () => {
    expect(await deriveCredentials('', 'somepassword')).toBeNull();
    expect(await deriveCredentials('   ', 'somepassword')).toBeNull();
    expect(await deriveCredentials('alice', '')).toBeNull();
    expect(await deriveCredentials('alice', null)).toBeNull();
    expect(await deriveCredentials('alice', undefined)).toBeNull();
  });
});

describe('encryptApiKey / decryptApiKey', () => {
  let aesKey;

  beforeAll(async () => {
    ({ aesKey } = await deriveCredentials('Alice', 'correct horse battery staple'));
  }, 30000);

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
    const { aesKey: wrongKey } = await deriveCredentials('Bob', 'a different password entirely');
    const enc = await encryptApiKey(aesKey, 'sk-ant-secret');
    await expect(decryptApiKey(wrongKey, enc)).rejects.toBeTruthy();
  });
});

describe('encryptApiKey / decryptApiKey — two independent secrets under one account', () => {
  // The account carries two BYO secrets (the Anthropic API key and the
  // Lichess explorer token) encrypted under the same password-derived AES
  // key. encryptApiKey/decryptApiKey are generic string encryptors, so this
  // just confirms they don't cross-contaminate when used twice per account.
  let aesKey;

  beforeAll(async () => {
    ({ aesKey } = await deriveCredentials('Alice', 'correct horse battery staple'));
  }, 30000);

  test('the same AES key independently encrypts/decrypts an API key and a Lichess token', async () => {
    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const lichessToken = 'lip_abcdefghijklmnopqrstuvwxyz012345';

    const encKey = await encryptApiKey(aesKey, apiKey);
    const encLichess = await encryptApiKey(aesKey, lichessToken);

    expect(await decryptApiKey(aesKey, encKey)).toBe(apiKey);
    expect(await decryptApiKey(aesKey, encLichess)).toBe(lichessToken);
  });

  test('wrong key still rejects for the Lichess token ciphertext', async () => {
    const { aesKey: wrongKey } = await deriveCredentials('Bob', 'a different password entirely');
    const encLichess = await encryptApiKey(aesKey, 'lip_some-lichess-token');
    await expect(decryptApiKey(wrongKey, encLichess)).rejects.toBeTruthy();
  });
});

describe('session persistence', () => {
  afterEach(() => {
    clearSession();
  });

  const session = {
    username: 'Alice',
    usernameId: 'a'.repeat(64),
    authToken: 'b'.repeat(64),
    aesKey: 'base64keydata==',
    profileId: 'c'.repeat(64),
  };

  test('save/load round-trips via real localStorage', () => {
    saveSession(session);
    expect(loadSession()).toEqual({ v: 1, ...session });
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

    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ ...session })); // missing v:1
    expect(loadSession()).toBeNull();

    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(['not', 'an', 'object']));
    expect(loadSession()).toBeNull();
  });

  test('clearSession removes the stored session', () => {
    saveSession(session);
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
