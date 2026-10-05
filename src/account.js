import { captureFence, withAccountTransition } from './accountFence.js';
import { accountKeys, setAccountKeys } from './accountKeys.js';
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
// device to that account. The cached `gipfAccount` session (v3) holds no secret:
// the account name, its data id, and a random per-sign-in marker (`sid`) the
// identity fences compare.
//
// The Anthropic key and the Lichess token are held on the server, encrypted there,
// and never returned: /login sends a new key once over TLS, and the proxies add it
// to each request (src/accountKeys.js says which keys exist). Guests keep
// device-only keys in localStorage.
//
// Username/password accounts no longer sign in. Their PBKDF2 derivation is kept
// for one purpose: `linkOldAccount` proves the old password once, opens the old
// client-encrypted keys here, and links the old account's progress to the signed-in
// identity. A device still holding a password-era session (v1 or v2) is signed out
// at startup by `retireLegacySession`, sealing its progress under the old key,
// which linking makes the new account's seal key.

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
// encryptApiKey/decryptApiKey are generic string encryptors despite the name: they
// seal recovery copies and migration journals under the account's seal key, and
// open a pre-Auth0 account's keys under its password-derived AES key when linking.

// Encrypt a string under an AES key. Returns { iv, ct } as base64 strings.
// `aesKey` is either a base64 key (from deriveCredentials or the server's seal
// key) or the stored CryptoKey from accountKey().
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
// Every request is JSON with the custom header the server's CSRF check requires,
// and the session cookie is the only authorization. Responses resolve to the parsed
// body on success, `{ error }` on an HTTP error, and throw only on network failure.

const ACCOUNT_ENDPOINT = `${process.env.PUBLIC_URL || ''}/api/chessAccount`;
const SESSION_ENDPOINT = `${process.env.PUBLIC_URL || ''}/api/session`;
const AUTH_ENDPOINT = `${process.env.PUBLIC_URL || ''}/api/auth`;

export const REQUEST_HEADERS = { 'Content-Type': 'application/json', 'X-Games-Request': '1' };
// Body credentials authorize nothing: the session cookie alone does.
export function credentialFields() {
  return {};
}

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
// session (for example from home.ramia.us) would sign in silently.
export function signInUrl(returnTo = '/', { reauthenticate = false } = {}) {
  return `${AUTH_ENDPOINT}/login?return=${encodeURIComponent(returnTo)}${reauthenticate ? '&reauthenticate=1' : ''}`;
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

// Import and persist the account's seal key. Without IndexedDB it is kept for this
// page only; a later sign-out then cannot seal progress (see clearSession).
export async function storeAccountKey(usernameId, aesKeyB64) {
  const key = await globalThis.crypto.subtle.importKey('raw', base64ToBytes(aesKeyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyCache.set(usernameId, key);
  try { await keyStore('readwrite', store => store.put(key, usernameId)); } catch (_) { /* this page only */ }
}

// The key that seals this account's recovery copies and migration journals. A
// retired v1 session still carries its password-derived key inline.
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

// The identity marker fences compare: sid, or the auth token of a retired v1 session.
const mark = s => s?.sid || s?.authToken;
const randomMarker = () => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));

function isValidSession(s) {
  if (!s || typeof s.username !== 'string' || typeof s.usernameId !== 'string') return false;
  if (s.v === 3 || s.v === 2) return typeof s.sid === 'string';
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
async function sessionRecord(account) {
  await storeAccountKey(account.usernameId, account.aesKey);
  return { v: 3, username: account.username, usernameId: account.usernameId, sid: randomMarker() };
}
// A session from the username/password era, which no longer signs in.
const passwordEra = s => s?.v === 1 || s?.v === 2;

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
  const key = session ? `gipf:recovery:${session.usernameId}` : 'gipf:guest:recovery';
  const previous = localStorage.getItem(key);
  const value = session ? JSON.stringify(await encryptApiKey(await accountKey(session), progress)) : progress;
  check();
  if (snapshot() !== progress || localStorage.getItem(key) !== previous) throw new Error('progress_changed');
  localStorage.setItem(key, value);
}
async function saveSessionProgress(s, { importGuest = false, keys = null } = {}) {
  const previous = loadSession();
  // TODO(2026-11-04): retire the API-key-hash claim — 30 days after the unified login
  // shipped on 2026-10-05. Remove this guest-key claim and the doc note in
  // docs/public-accounts.md ("Bounded legacy claims"); the password-derived claim stays.
  const guestLegacyKey = !previous && importGuest ? getSharedApiKey() : '';
  // A linked account's password-derived profile id is its bounded legacy claim.
  const ids = s.profileId ? [s.profileId] : [];
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
// 'gipfApiKey' is a guest's one BYO Anthropic key, shared by Chess, Catan,
// Splendor and Diplomacy on this device (see CLAUDE.md). /login is the only place
// it is written; each game reads it through its own storage helper (which also
// migrates legacy per-game keys, a step this module deliberately does not
// replicate). A signed-in device holds no key here.

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

export const SESSION_EXPIRED_KEY = 'gipf:session-expired';
function noteSessionEnded(reason) {
  try { sessionStorage.setItem(SESSION_EXPIRED_KEY, reason); } catch (_) { /* optional notice */ }
}

// Startup, before the app renders. A password-era session (v1 or v2) no longer
// signs in: sign it out like any sign-out, sealing its progress under the old key
// for linking to recover, then revoke its server session without waiting on the
// network (the server refuses that session regardless). Resolves true when it did.
export async function retireLegacySession() {
  if (!passwordEra(loadSession())) return false;
  await clearSession({ server: false });
  noteSessionEnded('auth0');
  endServerSession();
  return true;
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
// and leave the device either way. Resolves { offerLink, keys, keysMoved } or throws.
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
  return { offerLink: res.offerLink, keys, keysMoved };
}

// Link a pre-Auth0 username/password account to the signed-in identity, once. The
// password is checked by the server against the old verifier; the old keys are
// opened here and sent once over TLS to be stored server-encrypted; the device then
// switches to the old account's progress. Resolves { linked:true } or { error }.
export async function linkOldAccount(username, password) {
  const current = loadSession();
  if (current?.v !== 3) return { error: 'signed_out' };
  const creds = await deriveCredentials(username, password);
  if (!creds) return { error: 'crypto_unavailable' };
  const proof = { u: creds.usernameId, auth: creds.authToken };
  let verified;
  try { verified = await post(ACCOUNT_ENDPOINT, { action: 'link-verify', ...proof }); } catch (_) { return { error: 'network' }; }
  if (verified.error) return verified;
  const keys = {};
  try {
    if (verified.enc) keys.anthropic = await decryptApiKey(creds.aesKey, verified.enc);
    if (verified.encLichess) keys.lichess = await decryptApiKey(creds.aesKey, verified.encLichess);
  } catch (_) { return { error: 'bad_credentials' }; }
  let linked;
  try { linked = await post(ACCOUNT_ENDPOINT, { action: 'link', ...proof, sealKey: creds.aesKey, ...keys }); } catch (_) { return { error: 'network' }; }
  if (!linked.linked) return linked;
  await saveSession({ username: current.username, usernameId: linked.u, aesKey: creds.aesKey, profileId: creds.profileId }, { keys: linked.keys });
  return { linked: true };
}
