// sprint.js — pure logic for Sprint mode: solve as many puzzles as possible in five minutes of
// active time. Ramp, per-puzzle points, session summary and the personal leaderboard
// (`ricochetSprintBoard`). Nothing here touches the Classic rating or history.

import RicochetBoard from '../RicochetBoard.js';
import { scoreRound } from './scoring.js';
import { isVariantKey, parseVariant, setupKey } from './variants.js';

export const GAME_MODE_KEY = 'ricochetGameMode';
export const BOARD_KEY = 'ricochetSprintBoard';
export const SPRINT_MS = 5 * 60 * 1000;
export const WARNING_MS = 30 * 1000;
export const START_LENGTH = 3;
export const MAX_LENGTH = 9;
export const SOLVES_PER_STEP = 2;
export const BOARD_CAP = 10;
// The standard setup has no key in Classic storage; the leaderboard names every setup.
export const STANDARD_SETUP = '16-r4-d0-plan';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isCount = v => Number.isInteger(v) && v >= 0;

export function readGameMode() {
  try { return localStorage.getItem(GAME_MODE_KEY) === 'sprint' ? 'sprint' : 'classic'; } catch { return 'classic'; }
}
export function writeGameMode(mode) {
  try { localStorage.setItem(GAME_MODE_KEY, mode === 'sprint' ? 'sprint' : 'classic'); } catch { /* unavailable */ }
}

// ---- difficulty ramp ---------------------------------------------------------

// Optimal length to deal after `solved` solved puzzles: 3, +1 per two solves, capped at 9.
export const sprintLength = solved =>
  Math.min(MAX_LENGTH, START_LENGTH + Math.floor(Math.max(0, solved) / SOLVES_PER_STEP));

// ---- points and session ------------------------------------------------------

export function puzzlePoints({ optimal, moves, timeMs }) {
  const { quality, pace, score } = scoreRound({ optimal, moves, timeMs });
  return { points: Math.round(100 * score), quality, pace };
}

export const newSession = () => ({ solves: [], skipped: 0 });

export function withSolve(session, { optimal, moves, timeMs }) {
  const r = puzzlePoints({ optimal, moves, timeMs });
  return { solves: [...session.solves, { optimal, moves, timeMs, ...r }], skipped: session.skipped };
}

export const withSkip = session => ({ solves: session.solves, skipped: session.skipped + 1 });

export function summarize(session) {
  const { solves } = session;
  const points = solves.reduce((a, s) => a + s.points, 0);
  let best = null;
  for (const s of solves) if (!best || s.points > best.points) best = s;
  return {
    solved: solves.length,
    skipped: session.skipped,
    points,
    avgQuality: solves.length ? solves.reduce((a, s) => a + s.quality, 0) / solves.length : 0,
    best,
    optimalCount: solves.filter(s => s.moves === s.optimal).length,
  };
}

// ---- leaderboard -------------------------------------------------------------

// The key naming a Sprint setup (board variant plus input mode); the standard setup has one too.
export const sprintKey = (config, mode) => setupKey(parseVariant(config), mode) || STANDARD_SETUP;
// The Classic setup key (null for standard) behind a leaderboard key, for labels.
export const classicKey = key => (key === STANDARD_SETUP ? null : key);

const validKey = k => k === STANDARD_SETUP || isVariantKey(k);

export function validRecord(r) {
  return Boolean(
    r && typeof r === 'object' && !Array.isArray(r) &&
    isNum(r.at) && isCount(r.points) && isCount(r.solved) && isCount(r.skipped) &&
    isNum(r.avgQuality) && r.avgQuality >= 0 && r.avgQuality <= 1,
  );
}

// Points descending, then more solved, then the earlier date.
export const compareRecords = (a, b) => b.points - a.points || b.solved - a.solved || a.at - b.at;

const clean = r => ({ at: r.at, points: r.points, solved: r.solved, skipped: r.skipped, avgQuality: r.avgQuality });
const top = records => records.filter(validRecord).map(clean).sort(compareRecords).slice(0, BOARD_CAP);

// Only well-formed setups and records survive; corrupt storage reads as empty.
export function loadBoard() {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_KEY));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const key of Object.keys(raw)) {
      if (!validKey(key) || !Array.isArray(raw[key])) continue;
      const records = top(raw[key]);
      if (records.length) out[key] = records;
    }
  } catch {
    // unreadable: start empty
  }
  return out;
}

export const bestFor = (board, key) => (board[key] && board[key][0]) || null;

// Adds a finished session to the setup's top 10. Returns { board, rank (0-based index of the new
// record in the top 10, or -1 if it did not make it), newBest, record }. A session with no
// solved puzzle is not recorded.
export function addResult(key, summary, at = Date.now()) {
  const before = loadBoard();
  if (!validKey(key) || !(summary.solved > 0)) return { board: before, rank: -1, newBest: false, record: null };
  const record = clean({ at, points: summary.points, solved: summary.solved, skipped: summary.skipped, avgQuality: summary.avgQuality });
  const list = top([...(before[key] || []), record]);
  const board = { ...before, [key]: list };
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch { /* unavailable or full */ }
  const rank = list.findIndex(r => r.at === record.at && r.points === record.points && r.solved === record.solved && r.skipped === record.skipped);
  return { board, rank, newBest: rank === 0 && record.points > 0, record };
}

// ---- prefetch ---------------------------------------------------------------

// The state the next puzzle is dealt from while the current one is still being solved:
// the robots at the end of the current optimal line, with the target claimed.
export function prefetchState(board, solution) {
  const copy = RicochetBoard.fromSerializedState({ ...board.serializeState(), stateHistory: [], historyIndex: -1 });
  copy.resetRound();
  for (const m of solution) copy.applyMove(m);
  return { ...copy.serializeState(), stateHistory: [], historyIndex: -1 };
}
