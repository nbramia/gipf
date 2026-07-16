// playerHistory.js — two small localStorage-backed stores tracking
// cross-session opponent records and puzzle progress, mirroring
// coach/mistakeStore.js's style: pure object-in/object-out functions plus
// thin, malformed-JSON-safe persistence wrappers.
//
// chessOppHistory: win/loss/draw record per opponent, kept separate for
//   casual difficulty tiers and rated ladder rungs (they're scored on
//   different curves and shouldn't be mixed).
//   { v: 1, casual: { [tierKey]: {w,l,d} }, rated: { [rungKey]: {w,l,d} } }
//
// chessPuzzleProgress: lightweight per-puzzle attempt/solve counters.
//   { v: 1, puzzles: { [puzzleId]: { a, s, t } } }
//   a = attempts, s = solves, t = last-activity epoch ms

export const OPP_HISTORY_KEY = 'chessOppHistory';
export const PUZZLE_PROGRESS_KEY = 'chessPuzzleProgress';

function emptyOppHistory() {
  return { v: 1, casual: {}, rated: {} };
}

export function loadOppHistory() {
  try {
    const raw = localStorage.getItem(OPP_HISTORY_KEY);
    if (!raw) return emptyOppHistory();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.casual || !data.rated) return emptyOppHistory();
    return data;
  } catch (_) {
    return emptyOppHistory();
  }
}

export function saveOppHistory(h) {
  try {
    localStorage.setItem(OPP_HISTORY_KEY, JSON.stringify(h));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Fold one game result into the history. Returns a NEW history object (does
// not persist — caller decides when to save, same division of labour as
// mistakeStore's captureMistake/recordAttempt).
export function recordGameResult(h, { rated, opponentKey, result }) {
  const bucket = rated ? 'rated' : 'casual';
  const prior = (h[bucket] && h[bucket][opponentKey]) || { w: 0, l: 0, d: 0 };
  const key = result === 'win' ? 'w' : result === 'loss' ? 'l' : 'd';
  const record = { ...prior, [key]: prior[key] + 1 };
  return { ...h, [bucket]: { ...h[bucket], [opponentKey]: record } };
}

// 'NW-NL-ND' summary of an opponent's record, or null when there are no
// games against them yet.
export function formatRecord(h, rated, opponentKey) {
  const bucket = rated ? 'rated' : 'casual';
  const record = h[bucket] && h[bucket][opponentKey];
  if (!record) return null;
  return `${record.w}W-${record.l}L-${record.d}D`;
}

function emptyPuzzleProgress() {
  return { v: 1, puzzles: {} };
}

export function loadPuzzleProgress() {
  try {
    const raw = localStorage.getItem(PUZZLE_PROGRESS_KEY);
    if (!raw) return emptyPuzzleProgress();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.puzzles) return emptyPuzzleProgress();
    return data;
  } catch (_) {
    return emptyPuzzleProgress();
  }
}

export function savePuzzleProgress(p) {
  try {
    localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(p));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Record one puzzle attempt. Attempts always increments; solves increments
// only when solved. Returns a NEW progress object.
export function recordPuzzleAttempt(p, puzzleId, solved, now = Date.now()) {
  const prior = p.puzzles[puzzleId] || { a: 0, s: 0, t: 0 };
  const next = { a: prior.a + 1, s: prior.s + (solved ? 1 : 0), t: now };
  return { ...p, puzzles: { ...p.puzzles, [puzzleId]: next } };
}
