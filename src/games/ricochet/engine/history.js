// history.js — localStorage persistence and summaries for Ricochet solo play.
// Every storage access is guarded; bad stored data is ignored, never thrown.

import { scoreRound } from './scoring';
import { DEFAULT_RATING, MIN_RATING, updateRating } from './rating';

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

export function loadRating() {
  const r = readJSON(RATING_KEY);
  if (
    r && typeof r === 'object' && isNum(r.rating) && r.rating >= MIN_RATING &&
    Number.isInteger(r.rounds) && r.rounds >= 0
  ) {
    return { rating: r.rating, rounds: r.rounds };
  }
  return { rating: DEFAULT_RATING, rounds: 0 };
}

export function validEntry(e) {
  return Boolean(
    e && typeof e === 'object' &&
    isNum(e.at) && isNum(e.optimal) && e.optimal > 0 &&
    isNum(e.moves) && e.moves >= 0 && isNum(e.timeMs) && e.timeMs >= 0 &&
    typeof e.revealed === 'boolean' &&
    isNum(e.quality) && e.quality >= 0 && e.quality <= 1 &&
    isNum(e.pace) && e.pace >= 0 && e.pace <= 1 &&
    isNum(e.score) && e.score >= 0 && e.score <= 1 &&
    isNum(e.ratingBefore) && isNum(e.ratingAfter)
  );
}

export function loadHistory() {
  const h = readJSON(HISTORY_KEY);
  if (!Array.isArray(h)) return [];
  return h.filter(validEntry).slice(-HISTORY_CAP);
}

// Scores the round, updates and persists rating + history, returns the entry.
export function recordRound({ optimal, moves, timeMs, revealed = false, gaveUp = false, at = Date.now() }) {
  const { rating, rounds } = loadRating();
  const { quality, pace, score } = scoreRound({ optimal, moves, timeMs, revealed, gaveUp });
  const { rating: ratingAfter } = updateRating(rating, optimal, score, rounds);
  const entry = {
    at, optimal, moves, timeMs,
    revealed: Boolean(revealed || gaveUp),
    quality, pace, score,
    ratingBefore: rating, ratingAfter,
  };
  const history = loadHistory();
  history.push(entry);
  writeJSON(HISTORY_KEY, history.slice(-HISTORY_CAP));
  writeJSON(RATING_KEY, { rating: ratingAfter, rounds: rounds + 1 });
  return entry;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(history, { window = DEFAULT_WINDOW } = {}) {
  const recent = history.slice(-window);
  return {
    ratingSeries: history.map((e) => e.ratingAfter),
    roundsPlayed: recent.length,
    avgQuality: mean(recent.map((e) => e.quality)),
    avgSecondsPerOptimalMove: mean(recent.map((e) => e.timeMs / 1000 / e.optimal)),
    optimalShare: recent.length
      ? recent.filter((e) => e.moves === e.optimal && !e.revealed).length / recent.length
      : 0,
    revealedCount: recent.filter((e) => e.revealed).length,
  };
}
