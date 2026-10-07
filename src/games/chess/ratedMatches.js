// Rated-match bookkeeping that must work without a mounted game: the match
// boundary replaces a saved match (use the other tab's copy, restore a backup,
// start over) while the game is unmounted or about to be. A rated game that is
// past its abort window is booked as a loss at that moment, from the saved
// snapshot alone, and every scored match id is remembered so a retained
// snapshot of the same match can never be scored again.
//
// chessRatedScored: JSON array of the last 200 scored match ids (device-local).

import { decodeMatch } from './matchSnapshot.js';
import { RATING_LADDER } from './engine/difficulty.js';
import { DEFAULT_RATING, nearestRung, updateRating, scoreFor } from './engine/rating.js';
import { loadOppHistory, saveOppHistory, recordGameResult } from './engine/playerHistory.js';
import { loadGameLog, saveGameLog, recordGame } from './coach/gameHistory.js';
import { summarizeAccuracy } from './coach/accuracy.js';
import { detectOpening } from './coach/openings.js';

export const RATED_SCORED_KEY = 'chessRatedScored';
const CAP = 200;

const readScored = () => {
  try {
    const list = JSON.parse(localStorage.getItem(RATED_SCORED_KEY));
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch (_) {
    return [];
  }
};
export const isScored = (id) => !!id && readScored().includes(id);
export function markScored(id) {
  if (!id) return;
  try {
    const list = readScored().filter((x) => x !== id);
    list.push(id);
    localStorage.setItem(RATED_SCORED_KEY, JSON.stringify(list.slice(-CAP)));
  } catch (_) {
    /* storage unavailable: the per-snapshot flags still guard */
  }
}

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

// The decoded live rated game in `snapshot`, or null when it is not one that
// leaving would cost: not rated, already scored, finished, or still inside the
// abort window (fewer than two plies).
function liveRated(snapshot) {
  if (!snapshot || snapshot.unreadable !== undefined || snapshot.game !== 'chess') return null;
  const ui = snapshot.ui || {};
  if (!ui.rated || ui.ratedApplied || isScored(snapshot.id)) return null;
  if (ui.resigned || ui.flagged) return null;
  let board;
  try {
    board = decodeMatch(snapshot).board;
  } catch (_) {
    return null;
  }
  if (board.result()) return null;
  const plies = board.sanHistory().length;
  return plies >= 2 ? { board, plies, ui } : null;
}

// Book a loss for an abandoned rated match: rating, rated-game count, opponent
// history and game log, like Resign.
export function bookForfeit(snapshot) {
  const live = liveRated(snapshot);
  if (!live) return false;
  const { board, ui } = live;
  markScored(snapshot.id);
  const rating = readJson('chessRating', DEFAULT_RATING);
  const games = readJson('chessRatedGames', 0);
  const rung = nearestRung(rating, RATING_LADDER);
  const next = updateRating(rating, rung.rating, scoreFor('loss'), games);
  try {
    localStorage.setItem('chessRating', JSON.stringify(next.rating));
    localStorage.setItem('chessRatedGames', JSON.stringify(games + 1));
  } catch (_) {
    /* ignore storage failures */
  }
  const opponentKey = String(rung.rating);
  saveOppHistory(recordGameResult(loadOppHistory(), { rated: true, opponentKey, result: 'loss' }));
  const stats = Array.isArray(ui.moveStats) ? ui.moveStats : [];
  if (stats.length && !ui.gameLogged) {
    const humanColor = ui.humanColor || 'w';
    const summary = summarizeAccuracy(stats);
    const side = humanColor === 'w' ? summary.white : summary.black;
    const opening = detectOpening(board.sanHistory());
    saveGameLog(recordGame(loadGameLog(), {
      playedAt: Date.now(),
      result: 'loss',
      color: humanColor,
      rated: true,
      opponentKey,
      accuracy: side ? side.accuracy : null,
      counts: side ? side.counts : { blunder: 0, mistake: 0, inaccuracy: 0 },
      opening: opening.name || null,
      eco: opening.eco || null,
      leftBookAtPly: opening.leftBookAtPly,
      moves: board.sanHistory().length,
    }));
  }
  return true;
}

// MatchBoundary hook: called with the saved matches about to stop being the
// current one and the match replacing them (null for a fresh start). Returns a
// confirmation for the boundary to show, or null when nothing is lost.
// Restoring an earlier snapshot of the same match id is a rewind and counts as
// abandoning the further-along state.
export function beforeReplace({ dropped, next }) {
  const costly = [];
  const seen = new Set();
  for (const snap of dropped) {
    const live = liveRated(snap);
    if (!live || seen.has(snap.id)) continue;
    if (next && next.id === snap.id) {
      const nextLive = next.state && next.state.pgn !== undefined ? decodeSafe(next) : null;
      if (nextLive !== null && nextLive >= live.plies) continue; // not a rewind
    }
    seen.add(snap.id);
    costly.push(snap);
  }
  if (!costly.length) return null;
  return {
    title: 'Abandon this rated game?',
    body: 'Both sides have moved, so leaving counts as a resignation: a loss that lowers your rating.',
    confirmLabel: 'Forfeit and continue',
    commit: () => costly.forEach(bookForfeit),
  };
}

function decodeSafe(snapshot) {
  try {
    return decodeMatch(snapshot).board.sanHistory().length;
  } catch (_) {
    return null;
  }
}
