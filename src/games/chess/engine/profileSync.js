// profileSync.js — browser client for cross-device Chess "profile" sync.
//
// Supersedes the single-domain ratingSync.js with a unified sync of every
// locally-tracked chess artifact: rating, opponent history, puzzle progress,
// and the mistake library. Same security model as ratingSync.js: the profile
// is keyed by an OPAQUE id — the SHA-256 of the user's Anthropic key under
// the SAME namespace ratingSync uses ('gipf-chess-rating:v1:'), so ratings
// already synced under that id carry over unchanged. The raw key is NEVER
// sent to our server (it only ever goes to Anthropic, per the BYO-key
// model) — only this hash leaves the browser. If the server has no store
// provisioned it replies { configured: false } and every helper degrades to
// "local only" without throwing loudly.

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

// Fetch the stored profile for an id.
//   → { rating, history, puzzles, mistakes }  each domain possibly null
//   → { configured: false }                   when the server has no store provisioned
// Throws only on network/transport failure (caller treats as a transient
// error), matching fetchRemoteRating's semantics.
export async function fetchRemoteProfile(id) {
  if (!id) return { configured: false };
  const r = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`profile fetch ${r.status}`);
  const data = await r.json();
  if (data.configured === false) return { configured: false };
  const p = data.profile || {};
  return {
    rating: p.rating ?? null,
    history: p.history ?? null,
    puzzles: p.puzzles ?? null,
    mistakes: p.mistakes ?? null,
  };
}

// Persist a subset of profile domains for an id. `domains` may contain any
// subset of { rating, history, puzzles, mistakes } — callers push only what
// changed. `mistakes`, if present, is the raw entries array; it's wrapped in
// the { v: 1, entries } wire shape here. Resolves true/false, never throws
// (sync failures must not interrupt play), matching putRemoteRating.
export async function putRemoteProfile(id, domains) {
  if (!id) return false;
  try {
    const payload = { ...domains };
    if (payload.mistakes) payload.mistakes = { v: 1, entries: payload.mistakes };
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, domains: payload }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return data.configured !== false;
  } catch (_) {
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
  const byFen = new Map();
  for (const e of [...(localEntries || []), ...(remoteEntries || [])]) {
    const existing = byFen.get(e.fenBefore);
    byFen.set(e.fenBefore, existing ? preferMistake(existing, e) : e);
  }
  return evictToCap([...byFen.values()]);
}
