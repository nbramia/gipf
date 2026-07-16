// playerHistory.js — a small localStorage-backed store tracking cross-session
// opponent records, mirroring coach/mistakeStore.js's style: pure
// object-in/object-out functions plus thin, malformed-JSON-safe persistence
// wrappers.
//
// chessOppHistory: win/loss/draw record per opponent, kept separate for
//   casual difficulty tiers and rated ladder rungs (they're scored on
//   different curves and shouldn't be mixed).
//   { v: 1, casual: { [tierKey]: {w,l,d} }, rated: { [rungKey]: {w,l,d} } }

export const OPP_HISTORY_KEY = 'chessOppHistory';

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
