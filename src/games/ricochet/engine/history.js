// history.js — localStorage persistence and summaries for Ricochet solo play.
// Every storage access is guarded; bad stored data is ignored, never thrown.

import { scoreRound } from './scoring.js';
import { DEFAULT_RATING, MIN_RATING, updateRating } from './rating.js';
import { VARIANT_RATINGS_KEY, isVariantKey } from './variants.js';

export const RATING_KEY = 'ricochetRating';
export const HISTORY_KEY = 'ricochetHistory';
export const HISTORY_CAP = 500;
export const DEFAULT_WINDOW = 20;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable or full: the game continues without persistence
  }
}

const validRating = (r) => Boolean(
  r && typeof r === 'object' && isNum(r.rating) && r.rating >= MIN_RATING &&
  Number.isInteger(r.rounds) && r.rounds >= 0
);

// Only well-formed setups survive; anything else in the stored map is ignored.
function loadVariantRatings() {
  const m = readJSON(VARIANT_RATINGS_KEY);
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const k of Object.keys(m)) {
    if (isVariantKey(k) && validRating(m[k])) out[k] = { rating: m[k].rating, rounds: m[k].rounds };
  }
  return out;
}

// The standard setup (`variant` null) lives in ricochetRating; every other setup has its
// own entry in ricochetVariantRatings.
export function loadRating(variant = null) {
  if (variant) return loadVariantRatings()[variant] || { rating: DEFAULT_RATING, rounds: 0 };
  const r = readJSON(RATING_KEY);
  return validRating(r) ? { rating: r.rating, rounds: r.rounds } : { rating: DEFAULT_RATING, rounds: 0 };
}

const TOLERANCE = 1e-9;
const isInt = (v) => Number.isInteger(v);

// Stored quality/pace/score must match what scoring.js computes from the inputs.
function consistent(e) {
  const r = scoreRound(e);
  return (
    Math.abs(r.quality - e.quality) <= TOLERANCE &&
    Math.abs(r.pace - e.pace) <= TOLERANCE &&
    Math.abs(r.score - e.score) <= TOLERANCE
  );
}

export function validEntry(e) {
  return Boolean(
    e && typeof e === 'object' &&
    isNum(e.at) && isInt(e.optimal) && e.optimal >= 1 &&
    isInt(e.moves) && e.moves >= 0 && isNum(e.timeMs) && e.timeMs >= 0 &&
    typeof e.revealed === 'boolean' &&
    isNum(e.quality) && e.quality >= 0 && e.quality <= 1 &&
    isNum(e.pace) && e.pace >= 0 && e.pace <= 1 &&
    isNum(e.score) && e.score >= 0 && e.score <= 1 &&
    isInt(e.ratingBefore) && e.ratingBefore >= MIN_RATING &&
    isInt(e.ratingAfter) && e.ratingAfter >= MIN_RATING &&
    (e.revealed || e.moves >= e.optimal) &&
    (e.variant === undefined || isVariantKey(e.variant)) &&
    consistent(e)
  );
}

export function loadHistory() {
  const h = readJSON(HISTORY_KEY);
  if (!Array.isArray(h)) return [];
  return h.filter(validEntry).slice(-HISTORY_CAP);
}

// The entries of one setup: `variant` null is the standard setup (entries with no field).
export const historyFor = (history, variant = null) => history.filter((e) => (e.variant || null) === variant);

// The setups that have history, the standard one first.
export function setupsWithHistory(history) {
  const keys = [...new Set(history.map((e) => e.variant || null))];
  return keys.sort((a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : 1));
}

// Scores the round, updates and persists the rating + history of the round's setup
// (`variant`: null for the standard one, else its key), returns the entry.
// Returns null (touching nothing) for impossible input.
export function recordRound(input) {
  if (!input || typeof input !== 'object') return null;
  const { optimal, moves, timeMs, revealed = false, gaveUp = false, at = Date.now(), variant = null } = input;
  const abandoned = Boolean(revealed || gaveUp);
  if (
    !isInt(optimal) || optimal < 1 || !isNum(timeMs) || timeMs < 0 || !isNum(at) ||
    !isInt(moves) || moves < 0 || (!abandoned && moves < optimal) ||
    (variant !== null && !isVariantKey(variant))
  ) {
    return null;
  }
  const { rating, rounds } = loadRating(variant);
  const { quality, pace, score } = scoreRound({ optimal, moves, timeMs, revealed, gaveUp });
  const { rating: ratingAfter } = updateRating(rating, optimal, score, rounds);
  const entry = {
    at, optimal, moves, timeMs,
    revealed: abandoned,
    quality, pace, score,
    ratingBefore: rating, ratingAfter,
  };
  if (variant) entry.variant = variant;
  const history = loadHistory();
  history.push(entry);
  writeJSON(HISTORY_KEY, history.slice(-HISTORY_CAP));
  const next = { rating: ratingAfter, rounds: rounds + 1 };
  if (variant) writeJSON(VARIANT_RATINGS_KEY, { ...loadVariantRatings(), [variant]: next });
  else writeJSON(RATING_KEY, next);
  return entry;
}

// null when there is nothing to average (for example every recent round was revealed).
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(history, { window = DEFAULT_WINDOW } = {}) {
  const recent = history.slice(-window);
  return {
    ratingSeries: history.map((e) => e.ratingAfter),
    roundsPlayed: recent.length,
    avgQuality: mean(recent.filter((e) => !e.revealed).map((e) => e.quality)),
    avgSecondsPerOptimalMove: mean(recent.filter((e) => !e.revealed).map((e) => e.timeMs / 1000 / e.optimal)),
    optimalShare: recent.length
      ? recent.filter((e) => e.moves === e.optimal && !e.revealed).length / recent.length
      : 0,
    revealedCount: recent.filter((e) => e.revealed).length,
  };
}
