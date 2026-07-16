// account.js — app-level username+password accounts.
//
// This repo's convention is to duplicate shared behavior per consumer rather
// than import across game directories (see CLAUDE.md: "no imports between
// game directories"). This module is an INTENTIONAL identical copy of
// src/games/chess/engine/account.js — that file is the sibling copy. Both
// must stay behavior-identical (same namespace 'gipf-chess-account:v1:',
// same /api/chessAccount endpoint, same PBKDF2 derivation, same gipfAccount
// session shape) so existing production chess accounts keep working when
// signed in from the app-level widget on the landing page.
//
// No email, no recovery: a forgotten password means a new account. Every
// secret is derived client-side from the password via PBKDF2 — the server
// (api/chessAccount.js) never sees the password, and stores only a hash of
// an auth token plus an AES-GCM ciphertext of the user's Anthropic API key.
// The AES key that decrypts that ciphertext never leaves the client. The
// profileId is one of the password-derived secrets, so it's unguessable
// without the password — that's what lets account profiles reuse the
// existing /api/chessProfile endpoint unchanged: the profileId doubles as
// the "opaque id" that endpoint already expects.

const NAMESPACE = 'gipf-chess-account:v1:';
const PBKDF2_ITERATIONS = 310_000;

export const ACCOUNT_STORAGE_KEY = 'gipfAccount';

// ---- byte/string helpers -------------------------------------------------

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- credential derivation ------------------------------------------------

// Derive every account secret from a username+password pair. Deterministic:
// the same username+password always reproduces the same triple, so nothing
// needs to be stored server-side to "look up" an account beyond the auth
// token hash. Returns null if either input is empty, or if Web Crypto is
// unavailable (mirrors ratingIdFromKey's guard).
export async function deriveCredentials(username, password) {
  const normalized = String(username).trim().toLowerCase();
  if (!normalized || typeof password !== 'string' || !password) return null;
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;

  const enc = new TextEncoder();
  const salt = enc.encode(NAMESPACE + normalized);

  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    768,
  );
  const bytes = new Uint8Array(bits);

  const authToken = bytesToHex(bytes.slice(0, 32));
  const aesKey = bytesToBase64(bytes.slice(32, 64));
  const profileId = bytesToHex(bytes.slice(64, 96));

  const usernameIdDigest = await subtle.digest('SHA-256', enc.encode(NAMESPACE + normalized));
  const usernameId = bytesToHex(new Uint8Array(usernameIdDigest));

  return { username: String(username).trim(), usernameId, authToken, aesKey, profileId };
}

// ---- API key encryption ---------------------------------------------------

// Encrypt the user's Anthropic API key under the password-derived AES key.
// `aesKeyB64` is the `aesKey` field from deriveCredentials. Returns
// { iv, ct } as base64 strings — both are safe to send to the server, since
// only the client holds the AES key.
export async function encryptApiKey(aesKeyB64, apiKey) {
  const subtle = globalThis.crypto.subtle;
  const rawKey = base64ToBytes(aesKeyB64);
  const key = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey));
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

// Decrypt a { iv, ct } record back to the plaintext API key. Lets decrypt
// failures throw — the caller treats a rejection as bad credentials (wrong
// password → wrong AES key) or a corrupt record.
export async function decryptApiKey(aesKeyB64, enc) {
  const subtle = globalThis.crypto.subtle;
  const rawKey = base64ToBytes(aesKeyB64);
  const key = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = base64ToBytes(enc.iv);
  const ctBytes = base64ToBytes(enc.ct);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ctBytes);
  return new TextDecoder().decode(pt);
}

// ---- server client ---------------------------------------------------------
//
// api/chessAccount.js speaks one endpoint, three actions. Response contract
// (mirrors fetchRemoteProfile/putRemoteProfile's style):
//   → { configured: false }        when the server has no store provisioned
//   → parsed body                  on HTTP success (e.g. {created:true}, {enc})
//   → { error, message }           on HTTP error status — NOT thrown
// Throws only on network/transport failure (fetch rejection propagates),
// matching fetchRemoteProfile's semantics.

const ENDPOINT = '/api/chessAccount';

async function postAccount(payload) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (data.configured === false) return { configured: false };
  if (r.ok) return data;
  return { error: data.error || 'error', message: data.message };
}

// Register a brand-new account. `enc` (optional, from encryptApiKey) is the
// initial encrypted API key, or null to create the account without one yet.
export async function createAccount({ usernameId, authToken, enc }) {
  return postAccount({ action: 'create', u: usernameId, auth: authToken, enc: enc || null });
}

// Authenticate an existing account. On success the response carries the
// stored `enc` record (if any) for the caller to decrypt with the
// password-derived AES key.
export async function loginAccount({ usernameId, authToken }) {
  return postAccount({ action: 'login', u: usernameId, auth: authToken });
}

// Push a (re-)encrypted API key to an already-authenticated account. Never
// throws — sync failures must not interrupt play — resolves true/false,
// matching putRemoteProfile's style.
export async function pushEncryptedKey({ usernameId, authToken, enc }) {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setKey', u: usernameId, auth: authToken, enc }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return data.configured !== false;
  } catch (_) {
    return false;
  }
}

// ---- session persistence ---------------------------------------------------
//
// The full derived credential set, cached locally so the user isn't
// re-running 310k rounds of PBKDF2 on every page load. Malformed-safe,
// mirroring mistakeStore.js's load/save style.

function isValidSession(s) {
  return (
    s &&
    s.v === 1 &&
    typeof s.username === 'string' &&
    typeof s.usernameId === 'string' &&
    typeof s.authToken === 'string' &&
    typeof s.aesKey === 'string' &&
    typeof s.profileId === 'string'
  );
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return isValidSession(s) ? s : null;
  } catch (_) {
    return null;
  }
}

export function saveSession(s) {
  try {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ v: 1, ...s }));
  } catch (_) {
    /* ignore storage failures */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  } catch (_) {
    /* ignore storage failures */
  }
}

// ---- shared API key slot ----------------------------------------------------
//
// 'gipfApiKey' is the one BYO Anthropic key shared by chess, Catan, and
// Splendor (see CLAUDE.md). These two helpers let the landing page's account
// widget read/write it after sign-in/out without pulling in any game's
// per-game storage helper (each game keeps its own identical copy, including
// legacy-key migration, which this module deliberately does not replicate).

export function getSharedApiKey() {
  try {
    return localStorage.getItem('gipfApiKey') || '';
  } catch (_) {
    return '';
  }
}

export function setSharedApiKey(key) {
  try {
    if (key) {
      localStorage.setItem('gipfApiKey', key);
    } else {
      localStorage.removeItem('gipfApiKey');
    }
  } catch (_) {
    /* ignore storage failures */
  }
}
