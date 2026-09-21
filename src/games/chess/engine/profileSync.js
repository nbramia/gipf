import { captureFence } from '../../../accountFence.js';
// profileSync.js — browser client for cross-device Chess "profile" sync.
//
// Reads and writes require the account's password-derived auth token. Legacy
// profile IDs are never sent in URLs; they are accepted only by bounded claim.
// The model key reaches the separate model proxy transiently, not this store.

import { mergeRating } from './rating.js';
import { ratingIdFromKey } from './ratingSync.js';
import { evictToCap } from '../coach/mistakeStore.js';

// Re-export rather than re-implement — the hash (and its namespace) must
// stay byte-for-byte identical to ratingSync's so existing synced ratings
// resolve to the same id.
export { ratingIdFromKey as profileIdFromKey };

// The deploy prefix is included because the app is also served from a subdirectory
// (ramia.us/gipf); a root-absolute path would resolve against that host's root,
// which is a different deployment. PUBLIC_URL is empty on a bare-root deploy.
const ENDPOINT = `${process.env.PUBLIC_URL || ''}/api/chessProfile`;

// Identity is captured by the caller, never recovered from the currently active
// session during a delayed write. An old component cannot write for a new user.
const revisions = new Map();
async function requestProfile(session, action, fields = {}) {
  if (!session?.usernameId || !session?.authToken) throw new Error('account_required');
  const check = captureFence();
  const active = JSON.parse(localStorage.getItem('gipfAccount') || 'null');
  if (active?.usernameId !== session.usernameId || active?.authToken !== session.authToken) throw new Error('account_changed');
  const r = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, u: session.usernameId, auth: session.authToken, ...fields }),
  });
  const data = await r.json();
  check();
  if (!r.ok) throw new Error(data.error === 'conflict' ? 'conflict' : 'sync_failed');
  const current = JSON.parse(localStorage.getItem('gipfAccount') || 'null');
  if (current?.usernameId !== session.usernameId || current?.authToken !== session.authToken) throw new Error('account_changed');
  return data;
}
export async function claimLegacyProfile(session, legacyId) {
  return requestProfile(session, 'claim', { legacyId });
}
export async function fetchRemoteProfile(session) {
  const data = await requestProfile(session, 'read');
  revisions.set(session.usernameId, data.revision);
  const profile = { ...data.profile };
  // Collision copies stay on the authenticated record. Monotonic merge rules
  // preserve old review/history data without adding counters a second time.
  for (const legacy of Object.values(data.legacyProfiles || {})) {
    profile.rating = mergeRating(profile.rating, legacy.rating);
    profile.history = mergeHistory(profile.history, legacy.history);
    profile.puzzles = mergePuzzles(profile.puzzles, legacy.puzzles);
    profile.mistakes = { v: 1, entries: mergeMistakes(profile.mistakes?.entries, legacy.mistakes?.entries) };
  }
  return profile;
}
export async function putRemoteProfile(session, domains) {
  if (!session?.usernameId) return false;
  const payload = { ...domains };
  if (payload.mistakes) payload.mistakes = { v: 1, entries: payload.mistakes };
  try {
    const revision = revisions.get(session.usernameId);
    if (revision === undefined) throw new Error('sync_not_loaded');
    const data = await requestProfile(session, 'write', { revision, domains: payload });
    revisions.set(session.usernameId, data.revision);
    return true;
  } catch (_) {
    window.dispatchEvent(new CustomEvent('gipf-sync-conflict'));
    return false;
  }
}

function emptyHistory() {
  return { v: 1, casual: {}, rated: {} };
}

function mergeHistoryBucket(local = {}, remote = {}) {
  const merged = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[k] || { w: 0, l: 0, d: 0 };
    const r = remote[k] || { w: 0, l: 0, d: 0 };
    merged[k] = { w: Math.max(l.w, r.w), l: Math.max(l.l, r.l), d: Math.max(l.d, r.d) };
  }
  return merged;
}

// Reconcile local and remote opponent histories. Win/loss/draw counters are
// monotonic per device (a device only ever adds to them), so taking the
// per-counter max — the same "monotonic counter, no wall clocks" philosophy
// as rating.js's mergeRating — never regresses a count and never
// double-counts a game already recorded on both devices. Tolerates null on
// either side.
export function mergeHistory(local, remote) {
  const l = local || emptyHistory();
  const r = remote || emptyHistory();
  return {
    v: 1,
    casual: mergeHistoryBucket(l.casual, r.casual),
    rated: mergeHistoryBucket(l.rated, r.rated),
  };
}

// Reconcile local and remote puzzle-trainer progress (coach/puzzleProgress.js
// shape: { rating, attempts, puzzles: { [id]: {attempts, solves, streak,
// nextDueAt, lastResult} } }). Tolerates null on either side.
export function mergePuzzles(local, remote) {
  if (!remote) return local || { rating: 1000, attempts: 0, puzzles: {} };
  if (!local) return remote;

  // Top level (rating/attempts): the same "monotonic counter, no wall
  // clocks" philosophy as rating.js's mergeRating — attempts only grows per
  // device, so the side with more total attempts is the more authoritative
  // one; ties favour the higher rating.
  const top =
    remote.attempts > local.attempts
      ? remote
      : remote.attempts < local.attempts
        ? local
        : remote.rating >= local.rating
          ? remote
          : local;

  // Per-puzzle records: union by id. attempts/solves are monotonic per
  // device (max wins). The scheduling fields (streak/nextDueAt/lastResult)
  // move as a unit — they only make sense together — taken from whichever
  // side most recently rescheduled the puzzle (later nextDueAt wins; ties
  // favour the entry with more attempts).
  const l = local.puzzles || {};
  const r = remote.puzzles || {};
  const puzzles = {};
  for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const lp = l[id];
    const rp = r[id];
    if (!lp) { puzzles[id] = rp; continue; }
    if (!rp) { puzzles[id] = lp; continue; }
    const sched =
      rp.nextDueAt > lp.nextDueAt
        ? rp
        : rp.nextDueAt < lp.nextDueAt
          ? lp
          : rp.attempts >= lp.attempts
            ? rp
            : lp;
    puzzles[id] = {
      attempts: Math.max(lp.attempts, rp.attempts),
      solves: Math.max(lp.solves, rp.solves),
      streak: sched.streak,
      nextDueAt: sched.nextDueAt,
      lastResult: sched.lastResult,
    };
  }

  return { rating: top.rating, attempts: top.attempts, puzzles };
}

// Pick the more up-to-date of two conflicting entries for the same
// position: more attempts wins (more review history), then the one due
// further out (further progress through the spaced-repetition ladder), then
// the more recently created.
function preferMistake(a, b) {
  if (a.attempts !== b.attempts) return a.attempts > b.attempts ? a : b;
  if (a.nextDueAt !== b.nextDueAt) return a.nextDueAt > b.nextDueAt ? a : b;
  return a.createdAt >= b.createdAt ? a : b;
}

// Reconcile local and remote mistake libraries: union by fenBefore (the same
// dedupe key captureMistake uses), keeping the more up-to-date entry on
// conflict, then re-applying mistakeStore's cap so a merge can never grow
// the library past the limit.
export function mergeMistakes(localEntries, remoteEntries) {
  // Non-array originals remain on the server for recovery; never guess their entries.
  const byFen = new Map();
  for (const e of [...(Array.isArray(localEntries) ? localEntries : []), ...(Array.isArray(remoteEntries) ? remoteEntries : [])]) {
    const existing = byFen.get(e.fenBefore);
    byFen.set(e.fenBefore, existing ? preferMistake(existing, e) : e);
  }
  return evictToCap([...byFen.values()]);
}
