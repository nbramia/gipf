import { validateMatch } from './matchSchema.js';
export const matchKey = game => `${game}Match:v1`;
export const syncKey = game => `${game}MatchSync:v1`;
export const identity = () => localStorage.getItem('gipfAccount');
function transitioning() {
  const raw = localStorage.getItem('gipf:account-transition');
  if (!raw) return false;
  try { return JSON.parse(raw).until > Date.now(); } catch (_) { return true; }
}

// A store belongs to the account and local snapshot seen when its UI mounted.
// Never recapture credentials when draining a delayed/offline write.
export function createMatchStore(game) {
  const owner = identity();
  let known = localStorage.getItem(matchKey(game));
  const assertOwner = () => {
    if (identity() !== owner || transitioning()) throw new Error('account_changed');
  };
  const parse = raw => {
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!validateMatch(value, game)) throw new Error('invalid_snapshot');
    return value;
  };
  const store = {
    owner,
    assertOwner,
    load() { assertOwner(); return parse(known); },
    current() { assertOwner(); return parse(localStorage.getItem(matchKey(game))); },
    save(value) {
      assertOwner();
      if (!validateMatch(value, game)) throw new Error('invalid_snapshot');
      if (localStorage.getItem(matchKey(game)) !== known) throw new Error('local_conflict');
      const raw = JSON.stringify(value);
      localStorage.setItem(matchKey(game), raw);
      known = raw;
      window.dispatchEvent(new CustomEvent('gipf-match-saved', { detail: game }));
    },
    backup(extra = []) {
      assertOwner();
      const raw = localStorage.getItem(matchKey(game));
      const key = `${game}MatchRecovery:v1`;
      const old = JSON.parse(localStorage.getItem(key) || '{"alternatives":[]}');
      let previous;
      try { previous = raw ? JSON.parse(raw) : null; } catch (_) { previous = { unreadable: raw }; }
      const alternatives = [...old.alternatives, previous, ...extra].filter(Boolean);
      localStorage.setItem(key, JSON.stringify({ v: 1, alternatives: alternatives.slice(-8) }));
    },
    resolve(value, extra = []) {
      assertOwner();
      if (value && !validateMatch(value, game)) throw new Error('invalid_snapshot');
      store.backup([...extra, value]);
      assertOwner();
      if (value) localStorage.setItem(matchKey(game), JSON.stringify(value));
      else localStorage.removeItem(matchKey(game));
      known = value ? JSON.stringify(value) : null;
    },
    metadata() {
      assertOwner();
      const value = JSON.parse(localStorage.getItem(syncKey(game)) || 'null');
      return value?.owner === JSON.parse(owner || 'null')?.usernameId ? value : null;
    },
    acknowledge(revision, baseline) {
      assertOwner();
      localStorage.setItem(syncKey(game), JSON.stringify({ v: 1, owner: JSON.parse(owner || 'null')?.usernameId || null, revision, baseline }));
    },
    async request(action, extra = {}) {
      assertOwner();
      const session = JSON.parse(owner || 'null');
      if (!session?.usernameId || !session?.authToken) throw new Error('account_required');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${process.env.PUBLIC_URL || ''}/api/chessProfile`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ u: session.usernameId, auth: session.authToken, scope: 'match', game, action, ...extra }),
          signal: controller.signal,
        });
        const data = await response.json();
        assertOwner();
        if (!response.ok) throw new Error(response.status === 409 ? 'cloud_conflict' : 'sync_unavailable');
        return data;
      } finally { clearTimeout(timer); }
    },
  };
  return store;
}
