// rating.js — pure Elo-style rating for Ricochet solo play.
// Each round is a "game" against the puzzle, whose difficulty grows with the
// optimal solution length; the round's score (0..1) is the result.

export const DEFAULT_RATING = 1200;
export const MIN_RATING = 100;
export const PROVISIONAL_ROUNDS = 20;
export const SETTLED_ROUNDS = 50;
export const K_PROVISIONAL = 40;
export const K_INTERMEDIATE = 24;
export const K_SETTLED = 16;
export const DIFFICULTY_BASE = 500;
export const DIFFICULTY_PER_MOVE = 150;
export const MIN_LENGTH = 2;
export const MAX_LENGTH = 12;

export function difficultyFor(optimal) {
  return DIFFICULTY_BASE + DIFFICULTY_PER_MOVE * optimal;
}

export function kFactor(roundsPlayed) {
  if (roundsPlayed < PROVISIONAL_ROUNDS) return K_PROVISIONAL;
  if (roundsPlayed < SETTLED_ROUNDS) return K_INTERMEDIATE;
  return K_SETTLED;
}

export function isProvisional(roundsPlayed) {
  return roundsPlayed < PROVISIONAL_ROUNDS;
}

export function expectedScore(rating, difficulty) {
  return 1 / (1 + 10 ** ((difficulty - rating) / 400));
}

export function updateRating(rating, optimal, score, roundsPlayed) {
  const delta = Math.round(
    kFactor(roundsPlayed) * (score - expectedScore(rating, difficultyFor(optimal)))
  );
  const next = Math.max(MIN_RATING, rating + delta);
  return { rating: next, delta: next - rating };
}

// Optimal solution length to ask the generator for, near the player's level.
export function desiredLength(rating) {
  const n = Math.round((rating - DIFFICULTY_BASE) / DIFFICULTY_PER_MOVE);
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, n));
}
