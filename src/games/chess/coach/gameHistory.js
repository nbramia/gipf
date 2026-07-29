// gameHistory.js — the per-game history log that feeds a progress panel.
//
// Every finished game computes rich data (accuracy from accuracy.js's
// summarizeAccuracy, the opening from openings.js's detectOpening, the
// result) and then, today, throws it away. This store keeps a rolling log of
// finished games and the pure aggregations a "are you improving" panel needs
// (accuracy trend, per-opening report card, overall stats). Pure
// list-transforming functions plus thin localStorage wrappers, mirroring
// mistakeStore.js's / puzzleProgress.js's style.
//
// Entry shape (see recordGame):
//   { playedAt, result: 'win'|'loss'|'draw', color: 'w'|'b', rated,
//     opponentKey, accuracy: number|null, counts: {blunder,mistake,inaccuracy},
//     opening: string|null, eco: string|null, leftBookAtPly: number|null,
//     moves }

export const GAME_LOG_KEY = 'chessGameLog';

// Cap the log so localStorage can't grow without bound — a rich per-game
// entry is small, but an unbounded log across years of play still isn't
// something we want to keep around forever. 200 games is generous for a
// trend/report-card view (which only ever look at a recent window anyway)
// while bounding storage.
export const GAME_LOG_CAP = 200;

export function loadGameLog() {
  try {
    const raw = localStorage.getItem(GAME_LOG_KEY);
    const log = raw ? JSON.parse(raw) : [];
    return Array.isArray(log) ? log : [];
  } catch (_) {
    return [];
  }
}

export function saveGameLog(log) {
  try {
    localStorage.setItem(GAME_LOG_KEY, JSON.stringify(log));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Append a finished game, oldest-evicted-first once past the cap. Returns a
// NEW log (does not persist — caller decides when to save, same division of
// labour as mistakeStore/playerHistory).
export function recordGame(log, entry) {
  const next = [...(log || []), entry];
  return next.length > GAME_LOG_CAP ? next.slice(next.length - GAME_LOG_CAP) : next;
}

const RESULT_KEY = { win: 'w', loss: 'l', draw: 'd' };

const MIN_TREND_GAMES = 6;
// Below this relative gap between recent and earlier mean accuracy, call it
// steady rather than reading noise as a trend.
const TREND_EPSILON = 2; // accuracy percentage points

// Accuracy trend over the last N games (default: whole log). Splits the
// window in half and compares means; needs at least MIN_TREND_GAMES games
// with a non-null accuracy or it honestly reports "not enough data" instead
// of guessing from noise.
export function accuracyTrend(log, { limit } = {}) {
  const games = (log || []).filter((g) => typeof g.accuracy === 'number');
  const windowed = limit ? games.slice(-limit) : games;

  if (windowed.length < MIN_TREND_GAMES) {
    return { games: windowed.map((g) => g.accuracy), direction: null, recentMean: null, earlierMean: null };
  }

  const mid = Math.floor(windowed.length / 2);
  const earlier = windowed.slice(0, mid);
  const recent = windowed.slice(mid);
  const mean = (arr) => arr.reduce((s, g) => s + g.accuracy, 0) / arr.length;
  const earlierMean = mean(earlier);
  const recentMean = mean(recent);
  const diff = recentMean - earlierMean;

  const direction =
    diff > TREND_EPSILON ? 'improving' : diff < -TREND_EPSILON ? 'declining' : 'steady';

  return {
    games: windowed.map((g) => g.accuracy),
    direction,
    recentMean: Math.round(recentMean * 10) / 10,
    earlierMean: Math.round(earlierMean * 10) / 10,
  };
}

function emptyOpeningRow(name, eco) {
  return {
    name,
    eco,
    games: 0,
    w: 0,
    l: 0,
    d: 0,
    accuracySum: 0,
    accuracyCount: 0,
    leftBookSum: 0,
    leftBookCount: 0,
    byColor: {
      w: { games: 0, w: 0, l: 0, d: 0 },
      b: { games: 0, w: 0, l: 0, d: 0 },
    },
  };
}

// Per-opening aggregation, sorted most-played first: games, W/L/D, average
// accuracy (null-accuracy games excluded, not zeroed), average ply at which
// the player left book, split by colour played.
export function openingReportCard(log) {
  const rows = new Map();

  for (const g of log || []) {
    const key = g.opening || 'Unknown';
    if (!rows.has(key)) rows.set(key, emptyOpeningRow(g.opening || null, g.eco || null));
    const row = rows.get(key);

    row.games += 1;
    row[RESULT_KEY[g.result]] += 1;
    if (typeof g.accuracy === 'number') {
      row.accuracySum += g.accuracy;
      row.accuracyCount += 1;
    }
    if (typeof g.leftBookAtPly === 'number') {
      row.leftBookSum += g.leftBookAtPly;
      row.leftBookCount += 1;
    }
    const colorRow = row.byColor[g.color];
    if (colorRow) {
      colorRow.games += 1;
      colorRow[RESULT_KEY[g.result]] += 1;
    }
  }

  return [...rows.values()]
    .map((row) => ({
      name: row.name,
      eco: row.eco,
      games: row.games,
      w: row.w,
      l: row.l,
      d: row.d,
      avgAccuracy: row.accuracyCount ? Math.round((row.accuracySum / row.accuracyCount) * 10) / 10 : null,
      avgLeftBookAtPly: row.leftBookCount ? Math.round(row.leftBookSum / row.leftBookCount) : null,
      byColor: row.byColor,
    }))
    .sort((a, b) => b.games - a.games);
}

// Overall totals: record, mean accuracy, blunders/game, and how the first
// half of the log compares to the second half (a coarse "are you trending
// better" signal alongside accuracyTrend's finer-grained one).
export function overallStats(log) {
  const games = log || [];
  if (games.length === 0) {
    return {
      games: 0,
      record: { w: 0, l: 0, d: 0 },
      avgAccuracy: null,
      blundersPerGame: null,
      halves: null,
    };
  }

  const record = { w: 0, l: 0, d: 0 };
  let accuracySum = 0;
  let accuracyCount = 0;
  let blunderSum = 0;
  for (const g of games) {
    record[RESULT_KEY[g.result]] += 1;
    if (typeof g.accuracy === 'number') {
      accuracySum += g.accuracy;
      accuracyCount += 1;
    }
    blunderSum += (g.counts && g.counts.blunder) || 0;
  }

  // Always splittable (even a single game: 0 in the first half, 1 in the
  // second) so a brand-new player still sees a well-formed shape.
  const half = Math.floor(games.length / 2);
  const summarizeHalf = (slice) => {
    const withAcc = slice.filter((g) => typeof g.accuracy === 'number');
    const blunders = slice.reduce((s, g) => s + ((g.counts && g.counts.blunder) || 0), 0);
    return {
      games: slice.length,
      avgAccuracy: withAcc.length
        ? Math.round((withAcc.reduce((s, g) => s + g.accuracy, 0) / withAcc.length) * 10) / 10
        : null,
      blundersPerGame: slice.length ? Math.round((blunders / slice.length) * 100) / 100 : null,
    };
  };
  const halves = {
    firstHalf: summarizeHalf(games.slice(0, half)),
    secondHalf: summarizeHalf(games.slice(half)),
  };

  return {
    games: games.length,
    record,
    avgAccuracy: accuracyCount ? Math.round((accuracySum / accuracyCount) * 10) / 10 : null,
    blundersPerGame: Math.round((blunderSum / games.length) * 100) / 100,
    halves,
  };
}
