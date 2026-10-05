import { captureFence } from './accountFence.js';
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
  let checkFence;
  try { checkFence = captureFence(); } catch (_) { checkFence = () => { throw new Error('account_changed'); }; }
  const owner = identity();
  let known = localStorage.getItem(matchKey(game));
  const assertOwner = () => {
    checkFence();
    if (identity() !== owner || transitioning()) throw new Error('account_changed');
  };
  const parse = raw => {
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value === null) return null; // Explicit clear; never re-adopt a legacy save.
    if (!validateMatch(value, game)) throw new Error('invalid_snapshot');
    return value;
  };
  const store = {
    owner,
    assertOwner,
    hasCurrent() { assertOwner(); return known !== null; },
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
    recovery() {
      assertOwner();
      const raw = localStorage.getItem(`${game}MatchRecovery:v1`);
      if (!raw) return [];
      try {
        const value = JSON.parse(raw);
        if (value?.v === 1 && Array.isArray(value.alternatives)) return value.alternatives;
      } catch (_) { /* Keep the complete malformed container, including non-JSON bytes. */ }
      return [{ unreadable: raw }];
    },
    backup(extra = []) {
      assertOwner();
      const raw = localStorage.getItem(matchKey(game));
      const key = `${game}MatchRecovery:v1`;
      const old = store.recovery();
      let previous;
      try { previous = raw ? JSON.parse(raw) : null; } catch (_) { previous = { unreadable: raw }; }
      const distinct = new Map();
      for (const value of [...old, previous, ...extra].filter(Boolean)) {
        const key = JSON.stringify(value);
        distinct.delete(key); // Restaged choices are newest, even when the ring is full.
        distinct.set(key, value);
      }
      const alternatives = [...distinct.values()];
      assertOwner();
      localStorage.setItem(key, JSON.stringify({ v: 1, alternatives: alternatives.slice(-8) }));
    },
    resolve(value, extra = []) {
      assertOwner();
      if (value && !validateMatch(value, game)) throw new Error('invalid_snapshot');
      store.backup([...extra, value]);
      assertOwner();
      if (value) localStorage.setItem(matchKey(game), JSON.stringify(value));
      else localStorage.setItem(matchKey(game), 'null');
      known = JSON.stringify(value);
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
        assertOwner();
        if (!response.ok) throw new Error(response.status === 409 ? 'cloud_conflict'
          : response.status === 400 || response.status === 413 ? 'sync_rejected' : 'sync_unavailable');
        const data = await response.json();
        assertOwner();
        return data;
      } finally { clearTimeout(timer); }
    },
  };
  return store;
}
