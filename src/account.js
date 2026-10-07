import { captureFence, withAccountTransition } from './accountFence.js';
import { accountKeys, setAccountKeys } from './accountKeys.js';
import { renameKeyDatabase } from './storageRename.js';
// account.js — Games accounts, signed in with Auth0 (the ramia.us sign-in).
//
// The one implementation: /login signs in and out here, and each game reads the
// session through it (Chess via the re-export at src/games/chess/engine/account.js).
//
// Signing in is a redirect: /api/auth/login sends the browser to Auth0 and the
// callback sets the HttpOnly `__Host-games_session` cookie, which authorizes every
// later request. Back on /login, `completeSignIn` asks the server for the account's
// data id and its device seal key — the AES key that seals this device's recovery
// copies, kept as a non-extractable CryptoKey in IndexedDB — and switches the
// device to that account. The cached `playAccount` session (v3) holds no secret:
// the account name, its data id, and a random per-sign-in marker (`sid`) the
// identity fences compare.
//
// The Anthropic key and the Lichess token are held on the server, encrypted there,
// and never returned: /login sends a new key once over TLS, and the proxies add it
// to each request (src/accountKeys.js says which keys exist). Guests keep
// device-only keys in localStorage.

export const ACCOUNT_STORAGE_KEY = 'playAccount';

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

// ---- API key encryption ---------------------------------------------------
//
// encryptApiKey/decryptApiKey are generic string encryptors despite the name: they
// seal recovery copies and migration journals under the account's seal key.

// Encrypt a string under an AES key. Returns { iv, ct } as base64 strings.
// `aesKey` is either the server's base64 seal key or the stored CryptoKey from
// accountKey().
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

// Decrypt a { iv, ct } record back to the plaintext. Lets decrypt failures throw:
// a rejection means the wrong key or a corrupt record.
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
// Every request is JSON with the custom header the server's CSRF check requires,
// and the session cookie is the only authorization. Responses resolve to the parsed
// body on success, `{ error }` on an HTTP error, and throw only on network failure.

const ACCOUNT_ENDPOINT = '/api/chessAccount';
const SESSION_ENDPOINT = '/api/session';
const AUTH_ENDPOINT = '/api/auth';

export const REQUEST_HEADERS = { 'Content-Type': 'application/json', 'X-Games-Request': '1' };

async function post(url, body, timeout = 10000) {
  const r = await fetch(url, {
    method: 'POST', headers: REQUEST_HEADERS, credentials: 'same-origin',
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  return { error: data.error || 'error', status: r.status };
}

// Start Auth0 sign-in. `reauthenticate` asks Auth0 for credentials even when its own
// session (for example from home.ramia.us) would sign in silently. `silent` ('login'
// or 'home') asks Auth0 never to show its login page; see silentSignIn.js.
export function signInUrl(returnTo = '/', { reauthenticate = false, silent = null } = {}) {
  const mode = reauthenticate ? '&reauthenticate=1' : silent === 'login' ? '&silent=1' : silent === 'home' ? '&silent=home' : '';
  return `${AUTH_ENDPOINT}/login?return=${encodeURIComponent(returnTo)}${mode}`;
}

// Store the account's keys: a string sets, null clears, undefined keeps. The key
// goes to the server once and is never read back. Resolves the key status or { error }.
export async function saveAccountKeys(changes) {
  try {
    const res = await post(ACCOUNT_ENDPOINT, { action: 'setKeys', ...changes });
    if (res.keys) setAccountKeys(res.keys);
    return res;
  } catch (_) { return { error: 'network' }; }
}

// Revoke this device's session (or, with everywhere, every session of the account).
// Never throws: local sign-out proceeds even when the server is unreachable.
export async function endServerSession({ everywhere = false } = {}) {
  try { return await post(`${AUTH_ENDPOINT}/logout`, { everywhere }); }
  catch (_) { return { error: 'network' }; }
}

// The server's view of this browser's session: the status body when live,
// 'signed_out' when the cookie is rejected, or 'unknown' when unreachable.
export async function checkServerSession() {
  try {
    const r = await fetch(SESSION_ENDPOINT, { headers: { 'X-Games-Request': '1' }, credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
    if (r.ok) return await r.json();
    return r.status === 401 ? 'signed_out' : 'unknown';
  } catch (_) { return 'unknown'; }
}

// ---- account key storage -------------------------------------------------------
//
// The seal key lives in IndexedDB as a non-extractable CryptoKey, keyed by the
// account's data id: page script can use it to encrypt and decrypt, never read it out.

const KEY_DB = 'play-account';
const KEY_STORE = 'keys';
const keyCache = new Map();

// The legacy key database is moved once per page, before the first read or write.
let keyDbRenamed = null;
const renameKeyDb = () => (keyDbRenamed ||= renameKeyDatabase(KEY_DB, KEY_STORE).catch(() => false));

async function keyStore(mode, operation) {
  await renameKeyDb();
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

// Import and persist the account's seal key. Without IndexedDB it is kept for this
// page only; a later sign-out then cannot seal progress (see clearSession).
export async function storeAccountKey(usernameId, aesKeyB64) {
  const key = await globalThis.crypto.subtle.importKey('raw', base64ToBytes(aesKeyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyCache.set(usernameId, key);
  try { await keyStore('readwrite', store => store.put(key, usernameId)); } catch (_) { /* this page only */ }
}

// The key that seals this account's recovery copies and migration journals.
export async function accountKey(session) {
  if (!session?.usernameId) throw new Error('account_required');
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

// The identity marker fences compare.
const mark = s => s?.sid;
const randomMarker = () => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));

function isValidSession(s) {
  return !!s && s.v === 3 && typeof s.username === 'string' && typeof s.usernameId === 'string' && typeof s.sid === 'string';
}

// The cached session, or null when there is none or it is not a valid v3 record.
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

// The session record written after sign-in: no secret, only identity.
async function sessionRecord(account) {
  await storeAccountKey(account.usernameId, account.aesKey);
  return { v: 3, username: account.username, usernameId: account.usernameId, sid: randomMarker() };
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
const SECRET_KEYS = ['playApiKey', 'chessApiKey', 'catanApiKey', 'chessLichessToken'];
// Device keys and the account-key marker: neither belongs on a signed-in device's next identity.
export function clearDeviceSecrets() {
  SECRET_KEYS.forEach(k => localStorage.removeItem(k));
  setAccountKeys(null);
}
export async function retainProgress(session) {
  const check = captureFence({ allowTransition: true });
  const owner = loadSession();
  if (owner?.usernameId !== session?.usernameId || mark(owner) !== mark(session)) throw new Error('account_changed');
  const snapshot = () => JSON.stringify(Object.fromEntries(PROGRESS_KEYS.map(k => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null)));
  const progress = snapshot();
  if (progress === '{}') return;
  const key = session ? `play:recovery:${session.usernameId}` : 'play:guest:recovery';
  const previous = localStorage.getItem(key);
  const value = session ? JSON.stringify(await encryptApiKey(await accountKey(session), progress)) : progress;
  check();
  if (snapshot() !== progress || localStorage.getItem(key) !== previous) throw new Error('progress_changed');
  localStorage.setItem(key, value);
}
async function saveSessionProgress(s, { importGuest = false, keys = null } = {}) {
  const previous = loadSession();
  assertMatchTransition();
  const record = await sessionRecord(s);
  let committing = false;
  try {
    if (previous?.usernameId !== s.usernameId) {
      // Validate recovery and retain outgoing progress before any destructive step.
      await retainProgress(previous);
      const retained = JSON.stringify(PROGRESS_KEYS.map(k => localStorage.getItem(k)));
      const sealed = localStorage.getItem(`play:recovery:${s.usernameId}`);
      const restored = sealed ? JSON.parse(await decryptApiKey(s.aesKey, JSON.parse(sealed))) : {};
      const guest = importGuest && !previous ? JSON.parse(localStorage.getItem('play:guest:recovery') || '{}') : {};
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
    // Signed in, keys live on the account; none stay on the device.
    clearDeviceSecrets();
    setAccountKeys(keys);
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
// 'playApiKey' is a guest's one BYO Anthropic key, shared by Chess, Catan,
// Splendor and Diplomacy on this device (see AGENTS.md). /login is the only place
// it is written; each game reads it through its own storage helper (which also
// migrates legacy per-game keys, a step this module deliberately does not
// replicate). A signed-in device holds no key here.

export function getSharedApiKey() {
  try {
    return localStorage.getItem('playApiKey') || '';
  } catch (_) {
    return '';
  }
}

export function setSharedApiKey(key) {
  try {
    if (key) {
      localStorage.setItem('playApiKey', key);
    } else {
      ['playApiKey', 'chessApiKey', 'catanApiKey'].forEach(k => localStorage.removeItem(k));
    }
  } catch (_) {
    /* ignore storage failures */
  }
}

// ---- shared Lichess token slot ----------------------------------------------
//
// 'chessLichessToken' is a guest's BYO Lichess explorer token (chess's
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

export const SESSION_EXPIRED_KEY = 'play:session-expired';
function noteSessionEnded(reason) {
  try { sessionStorage.setItem(SESSION_EXPIRED_KEY, reason); } catch (_) { /* optional notice */ }
}

// Startup, before the app renders: a stored record that is not a valid session cannot
// sign in or out, and would make every identity fence refuse to run. Drop it; this
// device's progress stays in place as guest progress. Resolves true when it did.
export function discardUnreadableSession() {
  try {
    if (localStorage.getItem(ACCOUNT_STORAGE_KEY) === null || loadSession()) return false;
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    return true;
  } catch (_) { return false; }
}

// After render: a v3 session whose cookie the server rejects (idle or absolute
// expiry, or signed out everywhere) is signed out locally, like a normal sign-out.
// A live one refreshes which keys the account holds. Resolves true when the caller
// should reload.
export async function expireRejectedSession() {
  const s = loadSession();
  if (s?.v !== 3) return false;
  const status = await checkServerSession();
  if (status === 'unknown') return false;
  if (mark(loadSession()) !== mark(s)) return false;
  if (status !== 'signed_out') {
    // A live session for another account is a sign-in still finishing at /login.
    if (status.u !== s.usernameId) return false;
    const keys = accountKeys();
    if (keys.anthropic !== status.keys?.anthropic || keys.lichess !== status.keys?.lichess) setAccountKeys(status.keys);
    return false;
  }
  await clearSession({ server: false });
  noteSessionEnded('expired');
  return true;
}

// ---- Auth0 sign-in, finished on the device -------------------------------------

// The server session is set by the Auth0 callback; switch this device to it. Keys
// already on this device as a guest move to the account when it has none of its own,
// and leave the device either way. Resolves { keys, keysMoved } or throws.
export async function completeSignIn({ importGuest = false } = {}) {
  const res = await post(SESSION_ENDPOINT, { action: 'establish' });
  if (!res.signedIn) throw new Error(res.error || 'signed_out');
  const device = { anthropic: getSharedApiKey(), lichess: getSharedLichessToken() };
  const moving = Object.fromEntries(Object.entries(device).filter(([slot, value]) => value && !res.keys[slot]));
  let keys = res.keys, keysMoved = true;
  if (Object.keys(moving).length) {
    const saved = await post(ACCOUNT_ENDPOINT, { action: 'setKeys', ...moving }).catch(() => ({ error: 'network' }));
    if (saved.keys) keys = saved.keys; else keysMoved = false;
  }
  await saveSession({ username: res.name, usernameId: res.u, aesKey: res.sealKey }, { importGuest, keys });
  return { keys, keysMoved };
}
