// Automatic sign-in from an existing ramia.us (Auth0) session, e.g. after signing in
// at home.ramia.us. /login and the catalogue make one top-level redirect with
// prompt=none: Auth0 either signs in without showing anything or sends the browser
// straight back, and the page shows its ordinary Sign in button. Top-level redirects,
// not iframes, so third-party cookie blocking does not matter.
//
// Markers keep it from ever looping or interrupting:
//   - after any attempt, no other attempt for TRY_AGAIN_MS on this browser;
//   - the catalogue tries at most once per browser session (a tab's sessionStorage);
//   - signing out of Games turns attempts off until the user next chooses Sign in,
//     since the ramia.us session outlives a Games sign-out and would sign straight back in;
//   - if the markers cannot be stored, there is no attempt at all.
// Only on play.ramia.us: Auth0 accepts no other callback.
export const ATTEMPT_KEY = 'play:silent-sign-in-at';
export const OFF_KEY = 'play:silent-sign-in-off';
export const HOME_KEY = 'play:silent-sign-in-home';
export const TRY_AGAIN_MS = 10 * 60000;
export const SILENT_HOST = 'play.ramia.us';

function read(storage, key) {
  try { return storage().getItem(key); } catch (_) { return null; }
}
function write(storage, key, value) {
  try { storage().setItem(key, value); return storage().getItem(key) === value; } catch (_) { return false; }
}
const local = () => window.localStorage;
const tab = () => window.sessionStorage;

// Claim the one attempt `from` ('login' or 'home') may make now. True means the
// markers are recorded and the caller should redirect.
export function claimSilentAttempt(from, { now = Date.now(), host = window.location.hostname } = {}) {
  if (host !== SILENT_HOST) return false;
  if (read(local, OFF_KEY)) return false;
  const last = Number(read(local, ATTEMPT_KEY));
  if (last && now - last < TRY_AGAIN_MS && now >= last) return false;
  if (from === 'home' && read(tab, HOME_KEY)) return false;
  if (!write(local, ATTEMPT_KEY, String(now))) return false;
  if (from === 'home' && !write(tab, HOME_KEY, '1')) return false;
  return true;
}

// Sign-out: no automatic sign-in until the user chooses Sign in again.
export function suppressSilentSignIn() {
  write(local, OFF_KEY, '1');
}

// The user chose to sign in: automatic sign-in may resume after a later sign-out.
export function allowSilentSignIn() {
  try { local().removeItem(OFF_KEY); } catch (_) { /* optional */ }
}
