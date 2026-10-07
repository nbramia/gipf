// Which keys the signed-in account holds on the server. The keys themselves never
// reach the browser: the model proxies and the Lichess explorer read them from the
// account (server/accountKeys.js). This marker holds only two booleans so each game
// can tell, synchronously, that a key is available without one on the device.
//
// Games read it here; /login and src/account.js write it on sign-in, on a key change,
// and when the server reports the account's keys. Sign-out clears it.
const MARKER = 'playAccountKeys';
// The same-tab event the games already listen to for key changes.
const KEY_EVENT = 'play-apikey-change';

export const ACCOUNT_KEYS_STORAGE = MARKER;

export function accountKeys() {
  try {
    const value = JSON.parse(localStorage.getItem(MARKER) || 'null');
    return { anthropic: value?.anthropic === true, lichess: value?.lichess === true };
  } catch (_) {
    return { anthropic: false, lichess: false };
  }
}

export function setAccountKeys(keys) {
  try {
    if (keys) localStorage.setItem(MARKER, JSON.stringify({ anthropic: keys.anthropic === true, lichess: keys.lichess === true }));
    else localStorage.removeItem(MARKER);
  } catch (_) { /* ignore storage failures */ }
  try { window.dispatchEvent(new Event(KEY_EVENT)); } catch (_) { /* no window */ }
}

// Headers for a proxy request that may use the account's key: the server only
// reads the session cookie for a request carrying the custom header.
export const ACCOUNT_REQUEST_HEADERS = { 'Content-Type': 'application/json', 'X-Games-Request': '1' };
