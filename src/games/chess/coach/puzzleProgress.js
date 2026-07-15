// puzzleProgress.js — per-puzzle training progress + a player puzzle rating.
//
// The puzzle overhaul's memory (#24): every puzzle attempt updates (a) a
// per-puzzle record driving spaced repetition (same 1d/3d/7d ladder as the
// mistake library — solved puzzles come back before they fade), and (b) a
// single player puzzle Elo, treated as a rated game against the puzzle's
// rating (the Lichess model, simplified to Elo via engine/rating.js). The
// rating orders fresh puzzles so sessions stay near the edge of ability.
//
// Pure list/object transforms + thin localStorage wrappers, like mistakeStore.

import { DEFAULT_RATING, updateRating } from '../engine/rating.js';
import { REVIEW_INTERVALS_MS } from './mistakeStore.js';

export const PUZZLE_PROGRESS_KEY = 'chessPuzzleProgress';
export const SESSION_SIZE = 10;

const EMPTY = () => ({ rating: DEFAULT_RATING, attempts: 0, puzzles: {} });

export function loadProgress() {
  try {
    const raw = localStorage.getItem(PUZZLE_PROGRESS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p.rating === 'number' && p.puzzles && typeof p.puzzles === 'object') {
      return { attempts: 0, ...p };
    }
    return EMPTY();
  } catch (_) {
    return EMPTY();
  }
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(progress));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Record one puzzle outcome (the UI records the FIRST result per visit, like
// drills). Updates the player rating vs the puzzle's rating and the puzzle's
// own spaced-repetition record: a solve walks the 1d/3d/7d ladder, a miss
// resets the streak and keeps the puzzle due.
export function recordPuzzleResult(progress, puzzle, solved, now = Date.now()) {
  const { rating } = updateRating(
    progress.rating,
    typeof puzzle.rating === 'number' ? puzzle.rating : DEFAULT_RATING,
    solved ? 1 : 0,
    progress.attempts
  );
  const prev = progress.puzzles[puzzle.id] || { attempts: 0, solves: 0, streak: 0 };
  const streak = solved ? (prev.streak || 0) + 1 : 0;
  const nextDueAt = solved
    ? now + REVIEW_INTERVALS_MS[Math.min(streak - 1, REVIEW_INTERVALS_MS.length - 1)]
    : now;
  return {
    rating,
    attempts: progress.attempts + 1,
    puzzles: {
      ...progress.puzzles,
      [puzzle.id]: {
        attempts: prev.attempts + 1,
        solves: prev.solves + (solved ? 1 : 0),
        streak,
        nextDueAt,
        lastResult: solved ? 'solved' : 'failed',
      },
    },
  };
}

// Build a training session from the bank: due reviews first (longest overdue
// leading — the spaced-repetition promise), then fresh puzzles nearest the
// player's rating. Puzzles seen but not yet due are skipped.
export function selectSession(progress, bank, now = Date.now(), limit = SESSION_SIZE) {
  const due = [];
  const fresh = [];
  for (const p of bank) {
    const rec = progress.puzzles[p.id];
    if (!rec) fresh.push(p);
    else if ((rec.nextDueAt || 0) <= now) due.push(p);
  }
  due.sort(
    (a, b) => (progress.puzzles[a.id].nextDueAt || 0) - (progress.puzzles[b.id].nextDueAt || 0)
  );
  const target = progress.rating;
  fresh.sort((a, b) => {
    const da = Math.abs((a.rating || DEFAULT_RATING) - target);
    const db = Math.abs((b.rating || DEFAULT_RATING) - target);
    return da - db || (a.rating || 0) - (b.rating || 0);
  });
  return [...due, ...fresh].slice(0, limit);
}

// How many bank puzzles are due for review right now.
export function dueCount(progress, bank, now = Date.now()) {
  return bank.filter((p) => {
    const rec = progress.puzzles[p.id];
    return rec && (rec.nextDueAt || 0) <= now;
  }).length;
}
