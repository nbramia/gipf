import { captureFence, withAccountTransition } from './accountFence.js';
// account.js — username+password accounts for every game.
//
// The one implementation: the /login page signs in and out here, and each game
// reads the session through it (Chess via the re-export at
// src/games/chess/engine/account.js). The namespace 'gipf-chess-account:v1:',
// the /api/chessAccount endpoint, the PBKDF2 derivation and the gipfAccount
// session shape are fixed so accounts created by any earlier client keep working.
//
// Signing in proves the password once: POST /api/session verifies the derived
// auth token and sets the HttpOnly `__Host-games_session` cookie, which
// authorizes every later request. The derived AES key is kept as a
// non-extractable CryptoKey in IndexedDB, so the cached `gipfAccount` session
// (v2) holds no secret: only the username, its id, and a random per-sign-in
// marker (`sid`) the identity fences compare. A device still holding a v1
// session (auth token and AES key in localStorage) is upgraded silently at
// startup by `prepareSession`; until that succeeds its requests carry the auth
// token in the body, which the server still accepts.
//
// No email, no recovery: a forgotten password means a new account. Every
// secret is derived client-side from the password via PBKDF2 — the server
// (api/chessAccount.js) never sees the password, and stores only a hash of
// an auth token plus AES-GCM ciphertexts of the user's two BYO secrets: the
// Anthropic API key (`enc`) and the Lichess explorer token (`encLichess`).
// The AES key that decrypts those ciphertexts never leaves the client. The
// profileId remains a legacy bearer capability used only for bounded claims.
// Normal persistence proves ownership with the session cookie.

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
//
// encryptApiKey/decryptApiKey are generic string encryptors despite the
// name — they serve both BYO secrets carried on the account (the Anthropic
// API key and the Lichess explorer token), each independently, under the
// same password-derived AES key.

// Encrypt a secret string (the Anthropic API key or the Lichess token) under
// the password-derived AES key. Returns { iv, ct } as base64 strings — both are safe to
// send to the server, since only the client holds the AES key.
// `aesKey` is either the base64 key from deriveCredentials or the stored
// CryptoKey from accountKey().
async function aesKeyFor(aesKey, usage) {
  if (typeof aesKey !== 'string') return aesKey;
  return globalThis.crypto.subtle.importKey('raw', base64ToBytes(aesKey), { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptApiKey(aesKey, apiKey) {
  const subtle = globalThis.crypto.subtle;
  const key = await aesKeyFor(aesKey, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey));
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

// Decrypt a { iv, ct } record back to the plaintext API key. Lets decrypt
// failures throw — the caller treats a rejection as bad credentials (wrong
// password → wrong AES key) or a corrupt record.
export async function decryptApiKey(aesKey, enc) {
  const subtle = globalThis.crypto.subtle;
  const key = await aesKeyFor(aesKey, 'decrypt');
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

// The deploy prefix is included because the app is also served from a subdirectory
// (ramia.us/gipf); a root-absolute path would resolve against that host's root,
// which is a different deployment. PUBLIC_URL is empty on a bare-root deploy.
const ENDPOINT = `${process.env.PUBLIC_URL || ''}/api/chessAccount`;
const SESSION_ENDPOINT = `${process.env.PUBLIC_URL || ''}/api/session`;

// Every account request is JSON with the custom header the server's CSRF check requires.
export const REQUEST_HEADERS = { 'Content-Type': 'application/json', 'X-Games-Request': '1' };
// A v1 session not yet upgraded still proves itself in the body; a v2 session uses the cookie.
export function credentialFields(session) {
  return session?.authToken ? { auth: session.authToken } : {};
}

async function postAccount(payload) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: REQUEST_HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json();
  if (data.configured === false) return { configured: false };
  if (r.ok) return data;
  return { error: data.error || 'error', message: data.message };
}

// Register a brand-new account. `enc` (optional, from encryptApiKey) is the
// initial encrypted API key, and `encLichess` (optional, same shape) is the
// initial encrypted Lichess token — either or both may be null to create the
// account without that secret yet.
export async function createAccount({ usernameId, authToken, enc, encLichess }) {
  return postAccount({
    action: 'create',
    u: usernameId,
    auth: authToken,
    enc: enc || null,
    encLichess: encLichess || null,
  });
}

// Authenticate an existing account. On success the response carries the
// stored `enc` and `encLichess` records (if any) for the caller to decrypt
// with the password-derived AES key.
export async function loginAccount({ usernameId, authToken }) {
  return postAccount({ action: 'login', u: usernameId, auth: authToken });
}

// Push a (re-)encrypted secret to an already-authenticated account — `enc`
// (API key) and/or `encLichess` (Lichess token), whichever the caller has a
// fresh ciphertext for. Only the provided field(s) are updated server-side;
// the other secret is preserved untouched. Never throws — sync failures must
// not interrupt play — resolves true/false, matching putRemoteProfile's
// style.
export async function pushEncryptedKey({ usernameId, authToken, enc, encLichess }) {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ action: 'setKey', u: usernameId, ...credentialFields({ authToken }), enc, encLichess }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return data.configured !== false;
  } catch (_) {
    return false;
  }
}

// ---- server session ----------------------------------------------------------

async function postSession(body) {
  const r = await fetch(SESSION_ENDPOINT, {
    method: 'POST', headers: REQUEST_HEADERS, credentials: 'same-origin',
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (data.configured === false) return { configured: false };
  if (r.ok) return data;
  return { error: data.error || 'error', message: data.message };
}

// Verify the password-derived token once and receive the session cookie plus
// the account's encrypted key envelopes. Throws only on network failure.
export async function startServerSession({ usernameId, authToken }) {
  return postSession({ action: 'create', u: usernameId, auth: authToken });
}

// Revoke this device's session (or, with everywhere, every session of the account).
// Never throws: local sign-out proceeds even when the server is unreachable.
export async function endServerSession({ everywhere = false } = {}) {
  try { return await postSession({ action: everywhere ? 'logout-all' : 'logout' }); }
  catch (_) { return { error: 'network' }; }
}

// 'live', 'signed_out' (the server rejected the cookie), or 'unknown' (unreachable).
export async function checkServerSession() {
  try {
    const r = await fetch(SESSION_ENDPOINT, { headers: { 'X-Games-Request': '1' }, credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
    if (r.ok) return 'live';
    return r.status === 401 ? 'signed_out' : 'unknown';
  } catch (_) { return 'unknown'; }
}

// ---- account key storage -------------------------------------------------------
//
// The AES key lives in IndexedDB as a non-extractable CryptoKey, keyed by
// usernameId: page script can use it to encrypt and decrypt, never read it out.

const KEY_DB = 'gipf-account';
const KEY_STORE = 'keys';
const keyCache = new Map();

function keyStore(mode, operation) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('indexeddb_unavailable')); return; }
    const open = globalThis.indexedDB.open(KEY_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEY_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(KEY_STORE, mode);
      const request = operation(tx.objectStore(KEY_STORE));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

// Import and persist the account key. Resolves false when IndexedDB is unavailable.
export async function storeAccountKey(usernameId, aesKeyB64) {
  if (!globalThis.indexedDB) return false;
  const key = await globalThis.crypto.subtle.importKey('raw', base64ToBytes(aesKeyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  try {
    await keyStore('readwrite', store => store.put(key, usernameId));
    keyCache.set(usernameId, key);
    return true;
  } catch (_) { return false; }
}

// The key that encrypts this account's keys and recovery copies.
export async function accountKey(session) {
  if (!session?.usernameId) throw new Error('account_required');
  if (session.aesKey) return session.aesKey;
  if (keyCache.has(session.usernameId)) return keyCache.get(session.usernameId);
  const key = await keyStore('readonly', store => store.get(session.usernameId)).catch(() => null);
  if (!key) throw new Error('account_key_missing');
  keyCache.set(session.usernameId, key);
  return key;
}

async function forgetAccountKey(usernameId) {
  keyCache.delete(usernameId);
  try { await keyStore('readwrite', store => store.delete(usernameId)); } catch (_) { /* nothing stored */ }
}

// ---- session persistence ---------------------------------------------------

// The identity marker fences compare: sid for v2, the auth token for a v1 session.
const mark = s => s?.sid || s?.authToken;
const randomMarker = () => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));

function isValidSession(s) {
  if (!s || typeof s.username !== 'string' || typeof s.usernameId !== 'string') return false;
  if (s.v === 2) return typeof s.sid === 'string';
  return s.v === 1 && typeof s.authToken === 'string' && typeof s.aesKey === 'string' && typeof s.profileId === 'string';
}

// The cached session. A v1 session's auth token doubles as its identity marker.
export function loadSession() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!isValidSession(s)) return null;
    return s.v === 1 ? { ...s, sid: s.authToken } : s;
  } catch (_) {
    return null;
  }
}

// The session record written after sign-in: no secret, only identity.
async function sessionRecord(creds) {
  if (!await storeAccountKey(creds.usernameId, creds.aesKey)) {
    // Without IndexedDB the key cannot be held non-extractably; keep the v1 shape.
    return { v: 1, username: creds.username, usernameId: creds.usernameId, authToken: creds.authToken, aesKey: creds.aesKey, profileId: creds.profileId };
  }
  return { v: 2, username: creds.username, usernameId: creds.usernameId, sid: randomMarker() };
}

// Allowlist of progress only: raw credentials and unrelated apps never enter recovery.
export const PROGRESS_KEYS = [
  'chessStatsRecovery:v1',
  'chessMatch:v1', 'chessMatchSync:v1', 'chessMatchRecovery:v1', 'yinshMatch:v1', 'yinshMatchSync:v1', 'yinshMatchRecovery:v1', 'zertzMatch:v1', 'zertzMatchSync:v1', 'zertzMatchRecovery:v1', 'catanMatch:v1', 'catanMatchSync:v1', 'catanMatchRecovery:v1',
  'chessDarkMode', 'chessShowMoves', 'chessDifficulty', 'chessLearningGoal',
  'chessShowEvalBar', 'chessSound', 'chessRated', 'chessRating', 'chessRatedGames',
  'chessGameState', 'chessIntroSeen', 'chessKeyNudgeDismissed', 'chessPuzzleShowTheme', 'chessTimeControl',
  'chessMistakes', 'chessOppHistory', 'chessPuzzleProgress', 'chessGameLog', 'chessRepertoire',
  'yinshDarkMode', 'yinshShowMoves', 'yinshRandomSetup', 'yinshKeepScore', 'yinshWins',
  'yinshDifficulty', 'yinshTwoPlayer', 'zertzDifficulty', 'zertzTwoPlayer', 'yinshShowMoveHistory', 'yinshEvaluationMode', 'zertzDarkMode', 'zertzShowMoves',
  'catanDarkMode', 'catanShowMoves', 'catanDifficulty', 'catanRulesetId', 'catanPlayerCount', 'catanScenarioId',
  'splendorDarkMode', 'splendorDifficulty', 'splendorPlayerCount',
  'diplomacyDarkMode', 'diplomacyShowOrders', 'diplomacyShowLastMoves', 'diplomacySettings', 'diplomacyGameState',
];
const SECRET_KEYS = ['gipfApiKey', 'chessApiKey', 'catanApiKey', 'chessLichessToken'];
export function clearDeviceSecrets() {
  SECRET_KEYS.forEach(k => localStorage.removeItem(k));
}
export async function retainProgress(session) {
  const check = captureFence({ allowTransition: true });
  const owner = loadSession();
  if (owner?.usernameId !== session?.usernameId || mark(owner) !== mark(session)) throw new Error('account_changed');
  const snapshot = () => JSON.stringify(Object.fromEntries(PROGRESS_KEYS.map(k => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null)));
  const progress = snapshot();
  if (progress === '{}') return;
  const key = session ? `gipf:recovery:${session.usernameId}` : 'gipf:guest:recovery';
  const previous = localStorage.getItem(key);
  const value = session ? JSON.stringify(await encryptApiKey(await accountKey(session), progress)) : progress;
  check();
  if (snapshot() !== progress || localStorage.getItem(key) !== previous) throw new Error('progress_changed');
  localStorage.setItem(key, value);
}
async function saveSessionProgress(s, { importGuest = false, apiKey = '', lichessToken = '' } = {}) {
  const previous = loadSession();
  const guestLegacyKey = !previous && importGuest ? getSharedApiKey() : '';
  const ids = [s.profileId];
  if (guestLegacyKey) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gipf-chess-rating:v1:' + guestLegacyKey));
    ids.push(bytesToHex(new Uint8Array(bytes)));
  }
  for (const legacyId of ids) {
    try {
      // The session cookie set at sign-in authorizes the claim.
      await fetch(`${process.env.PUBLIC_URL || ''}/api/chessProfile`, {
        method: 'POST', headers: REQUEST_HEADERS,
        body: JSON.stringify({ action: 'claim', u: s.usernameId, legacyId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (_) { /* Cloud unavailable: encrypted recovery remains on this device. */ }
  }
  if (mark(loadSession()) !== mark(previous)) throw new Error('account_changed');
  assertMatchTransition();
  const record = await sessionRecord(s);
  let committing = false;
  try {
    if (previous?.usernameId !== s.usernameId) {
      // Validate recovery and retain outgoing progress before any destructive step.
      await retainProgress(previous);
      const retained = JSON.stringify(PROGRESS_KEYS.map(k => localStorage.getItem(k)));
      const sealed = localStorage.getItem(`gipf:recovery:${s.usernameId}`);
      const restored = sealed ? JSON.parse(await decryptApiKey(s.aesKey, JSON.parse(sealed))) : {};
      const guest = importGuest && !previous ? JSON.parse(localStorage.getItem('gipf:guest:recovery') || '{}') : {};
      if (mark(loadSession()) !== mark(previous)) throw new Error('account_changed');
      assertMatchTransition();
      if (JSON.stringify(PROGRESS_KEYS.map(k => localStorage.getItem(k))) !== retained) throw new Error('progress_changed');
      committing = true;
      PROGRESS_KEYS.forEach(k => localStorage.removeItem(k));
      clearDeviceSecrets();
      for (const k of PROGRESS_KEYS) {
        const value = restored[k] ?? guest[k];
        if (typeof value === 'string') localStorage.setItem(k, value);
      }
    }
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(record));
    setSharedApiKey(apiKey);
    setSharedLichessToken(lichessToken);
  } catch (error) {
    if (committing) {
      // A partial localStorage restore must never leave the old identity on
      // the new account's data. Both recovery copies were staged beforehand.
      PROGRESS_KEYS.forEach(k => localStorage.removeItem(k));
      clearDeviceSecrets();
      localStorage.removeItem(ACCOUNT_STORAGE_KEY);
      window.location.reload();
    }
    throw error;
  }
}
async function clearSessionProgress({ everywhere = false, server = true } = {}) {
  const previous = loadSession();
  const before = JSON.stringify(PROGRESS_KEYS.map(k => localStorage.getItem(k)));
  await retainProgress(previous);
  if (mark(loadSession()) !== mark(previous)) throw new Error('account_changed');
  assertMatchTransition();
  if (JSON.stringify(PROGRESS_KEYS.map(k => localStorage.getItem(k))) !== before) throw new Error('progress_changed');
  PROGRESS_KEYS.forEach(k => localStorage.removeItem(k));
  clearDeviceSecrets();
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  if (previous) await forgetAccountKey(previous.usernameId);
  if (server) await endServerSession({ everywhere });
}

// ---- shared API key slot ----------------------------------------------------
//
// 'gipfApiKey' is the one BYO Anthropic key shared by Chess, Catan, Splendor
// and Diplomacy (see CLAUDE.md). /login is the only place it is written; each
// game reads it through its own storage helper (which also migrates legacy
// per-game keys, a step this module deliberately does not replicate).

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
      ['gipfApiKey', 'chessApiKey', 'catanApiKey'].forEach(k => localStorage.removeItem(k));
    }
  } catch (_) {
    /* ignore storage failures */
  }
}

// ---- shared Lichess token slot ----------------------------------------------
//
// 'chessLichessToken' is chess's BYO Lichess explorer token (see
// coach/openingCoach.js reads it). /login writes it through these helpers,
// mirroring getSharedApiKey/setSharedApiKey above, without importing chess's module.

export function getSharedLichessToken() {
  try {
    return localStorage.getItem('chessLichessToken') || '';
  } catch (_) {
    return '';
  }
}

export function setSharedLichessToken(token) {
  try {
    if (token) {
      localStorage.setItem('chessLichessToken', token);
    } else {
      localStorage.removeItem('chessLichessToken');
    }
  } catch (_) {
    /* ignore storage failures */
  }
}

// Freeze mounted match writers before any asynchronous account recovery/claim.
// Other tabs check the shared marker directly, without waiting for storage events.
let transitionCheck = null;
function assertMatchTransition() { if (!transitionCheck) throw new Error('account_changed'); transitionCheck(); }
async function withMatchTransition(operation) {
  return withAccountTransition(async check => {
    transitionCheck = check;
    try { return await operation(); } finally { transitionCheck = null; }
  });
}
export async function saveSession(session, options) { return withMatchTransition(() => saveSessionProgress(session, options)); }
// Sign out: retain encrypted progress, clear this device's credentials and keys (every
// tab reloads on the change), and revoke the server session — or all of them.
export async function clearSession(options = {}) {
  try {
    return await withMatchTransition(() => clearSessionProgress(options));
  } catch (error) {
    if (error.message !== 'account_key_missing') throw error;
    // The stored key is gone (site data cleared), so progress cannot be sealed:
    // drop only credentials and keys, and still end the server session.
    const previous = loadSession();
    clearDeviceSecrets();
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    if (previous) await forgetAccountKey(previous.usernameId);
    if (options.server !== false) await endServerSession({ everywhere: options.everywhere });
  }
}

// Startup, before the app renders. A v1 session swaps its auth token for a session
// cookie and its AES key for a stored CryptoKey, then drops both from localStorage.
// Network failure leaves it as is for the next load.
export async function upgradeLegacySession({ canCommit = () => true } = {}) {
  const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  const s = loadSession();
  if (s?.v !== 1) return false;
  const res = await startServerSession(s).catch(() => null);
  if (!res?.signedIn) return false;
  const record = await sessionRecord(s);
  if (record.v !== 2 || !canCommit() || localStorage.getItem(ACCOUNT_STORAGE_KEY) !== raw) return false;
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(record));
  return true;
}

export const SESSION_EXPIRED_KEY = 'gipf:session-expired';
// After render: a v2 session whose cookie the server rejects (idle or absolute
// expiry, or signed out everywhere) is signed out locally, like a normal sign-out.
// Resolves true when the caller should reload.
export async function expireRejectedSession() {
  const s = loadSession();
  if (s?.v !== 2 || await checkServerSession() !== 'signed_out') return false;
  if (mark(loadSession()) !== mark(s)) return false;
  await clearSession({ server: false });
  try { sessionStorage.setItem(SESSION_EXPIRED_KEY, '1'); } catch (_) { /* optional notice */ }
  return true;
}
