// repertoire.js — a lightweight opening repertoire (docs/chess-ux-review.md).
//
// Opening support elsewhere in the coach (openings.js) is purely reactive: it
// names whatever opening the game happens to reach, after the fact. Serious
// opening study is repertoire-centric instead — "what do I play against
// 1.e4?" — so this module lets a player pin a small set of named openings
// (drawn from OPENING_BOOK, see openings.js) per colour, self-populates that
// pin list from what they already play most (recordGame entries via
// gameHistory.js), and reports how often they actually stuck to it.
//
// Pure list/object transforms + thin localStorage wrappers, mirroring
// mistakeStore.js's / puzzleProgress.js's / gameHistory.js's style. No React,
// no engine calls.

export const REPERTOIRE_KEY = 'chessRepertoire';

const emptyRepertoire = () => ({ version: 1, white: [], black: [] });

export function loadRepertoire() {
  try {
    const raw = localStorage.getItem(REPERTOIRE_KEY);
    const rep = raw ? JSON.parse(raw) : null;
    if (rep && Array.isArray(rep.white) && Array.isArray(rep.black)) {
      return {
        version: 1,
        white: rep.white.filter((n) => typeof n === 'string'),
        black: rep.black.filter((n) => typeof n === 'string'),
      };
    }
    return emptyRepertoire();
  } catch (_) {
    return emptyRepertoire();
  }
}

export function saveRepertoire(rep) {
  try {
    localStorage.setItem(REPERTOIRE_KEY, JSON.stringify(rep));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Pin/unpin return a NEW repertoire (same division of labour as
// mistakeStore/gameHistory: callers decide when to persist). Both are
// idempotent — pinning twice, or unpinning something absent, is a no-op
// beyond returning a fresh object of the same shape.
export function pinOpening(rep, color, openingName) {
  const list = rep[color] || [];
  if (list.includes(openingName)) return { ...rep, [color]: list };
  return { ...rep, [color]: [...list, openingName] };
}

export function unpinOpening(rep, color, openingName) {
  const list = rep[color] || [];
  return { ...rep, [color]: list.filter((n) => n !== openingName) };
}

export function isInRepertoire(rep, color, openingName) {
  return !!openingName && (rep[color] || []).includes(openingName);
}

const COLOR_CODE = { white: 'w', black: 'b' };
const DEFAULT_MIN_GAMES = 3;

// Self-populates the repertoire: for each colour, the named openings (opening
// !== null) the player has actually reached most often in finished games,
// filtered to those played at least `minGames` times and sorted most-played
// first. Doesn't consult an existing repertoire or exclude already-pinned
// names — the caller (UI) can cross-check with isInRepertoire before
// offering these as pins. An empty or opening-less log yields { white: [],
// black: [] }, never a fabricated trend.
export function suggestRepertoire(gameLog, { minGames = DEFAULT_MIN_GAMES } = {}) {
  const result = { white: [], black: [] };
  const counts = { white: new Map(), black: new Map() };

  for (const g of gameLog || []) {
    if (!g.opening) continue;
    const colorKey = g.color === 'w' ? 'white' : g.color === 'b' ? 'black' : null;
    if (!colorKey) continue;
    const bucket = counts[colorKey];
    const row = bucket.get(g.opening) || { name: g.opening, eco: g.eco || null, games: 0 };
    row.games += 1;
    bucket.set(g.opening, row);
  }

  for (const colorKey of ['white', 'black']) {
    result[colorKey] = [...counts[colorKey].values()]
      .filter((row) => row.games >= minGames)
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  }

  return result;
}

function emptyAdherence() {
  return { pinned: [], totalGames: 0, onPlanGames: 0, offPlanGames: 0, overallAdherencePct: null };
}

// The payoff view: for each pinned opening, how often the player actually
// reached it (out of every game played as that colour), plus an overall
// per-colour adherence percentage. A game's opening is null when detection
// couldn't identify it; those games can never match a pinned name, so they
// always land in offPlanGames — but ONLY once a colour has at least one
// pinned choice (with no plan there is nothing to be "off" from, so an empty
// repertoire reports totalGames: 0 / overallAdherencePct: null rather than
// counting every unknown-opening game as a deviation).
export function repertoireAdherence(gameLog, rep) {
  const out = {};
  for (const colorKey of ['white', 'black']) {
    const pinnedNames = rep[colorKey] || [];
    if (pinnedNames.length === 0) {
      out[colorKey] = emptyAdherence();
      continue;
    }

    const code = COLOR_CODE[colorKey];
    const games = (gameLog || []).filter((g) => g.color === code);
    const totalGames = games.length;
    if (totalGames === 0) {
      out[colorKey] = {
        pinned: pinnedNames.map((name) => ({ name, gamesReached: 0, pctOfGames: null })),
        totalGames: 0,
        onPlanGames: 0,
        offPlanGames: 0,
        overallAdherencePct: null,
      };
      continue;
    }

    const pinnedSet = new Set(pinnedNames);
    let onPlanGames = 0;
    const reachedCounts = new Map(pinnedNames.map((name) => [name, 0]));
    for (const g of games) {
      // g.opening is null for unidentified openings, which is never a member
      // of pinnedSet, so those games fall straight through to off-plan.
      if (g.opening && pinnedSet.has(g.opening)) {
        onPlanGames += 1;
        reachedCounts.set(g.opening, reachedCounts.get(g.opening) + 1);
      }
    }

    out[colorKey] = {
      pinned: pinnedNames.map((name) => {
        const gamesReached = reachedCounts.get(name) || 0;
        return {
          name,
          gamesReached,
          pctOfGames: Math.round((gamesReached / totalGames) * 1000) / 10,
        };
      }),
      totalGames,
      onPlanGames,
      offPlanGames: totalGames - onPlanGames,
      overallAdherencePct: Math.round((onPlanGames / totalGames) * 1000) / 10,
    };
  }
  return out;
}

// A short, plain-English nudge that the live game has left the player's
// intended repertoire for `color` — or null when there is nothing honest to
// say: no repertoire pinned for this colour, the live opening isn't known
// yet (detected.name is null/undefined), or it IS one of the pinned choices.
// Never fabricates a deviation from an unknown or matching opening.
export function deviationHint(rep, color, detected) {
  const pinnedNames = rep[color] || [];
  if (pinnedNames.length === 0) return null;
  const name = detected && detected.name;
  if (!name) return null;
  if (pinnedNames.includes(name)) return null;

  const plan =
    pinnedNames.length === 1
      ? pinnedNames[0]
      : `${pinnedNames.slice(0, -1).join(', ')} or ${pinnedNames[pinnedNames.length - 1]}`;
  return `This looks like the ${name}, off your planned ${plan}.`;
}
