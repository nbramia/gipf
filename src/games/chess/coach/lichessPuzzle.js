// lichessPuzzle.js — the Lichess daily puzzle as fresh training content (#24).
//
// https://lichess.org/api/puzzle/daily is public (no auth) and CORS-open, and
// the puzzle database it draws from is CC0. The response carries a rated,
// themed puzzle whose solution is a validated "only move" UCI line, so
// checking is strict solution-matching (any checkmate also wins — the Lichess
// mate convention), handled by puzzles.js/evaluateSolutionMove.
//
// Everything network-y degrades to null: no daily puzzle is ever an error,
// the session just doesn't include one (same pattern as openingCoach.js).

import { Chess } from 'chess.js';

const DAILY_URL = 'https://lichess.org/api/puzzle/daily';

// Themes that describe outcome/length rather than the tactical idea — skipped
// when picking a display theme.
const GENERIC_THEMES = new Set([
  'short', 'long', 'veryLong', 'oneMove', 'crushing', 'advantage', 'equality',
  'master', 'masterVsMaster', 'superGM', 'mate',
]);

// "backRankMate" -> "Back rank mate", "mateIn2" -> "Mate in 2"
export function themeLabel(theme) {
  const spaced = theme
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)/g, ' $1')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function displayTheme(themes) {
  const main = (themes || []).find((t) => !GENERIC_THEMES.has(t)) || (themes || [])[0];
  return main ? themeLabel(main) : 'Tactic';
}

// Parse a /api/puzzle/daily (or /api/puzzle/{id}) response into the puzzle
// schema used by the trainer. Pure; returns null on anything malformed.
// The position comes from puzzle.fen when present, otherwise it's replayed
// from game.pgn: initialPly is the 0-based index of the last pre-puzzle ply,
// so initialPly + 1 SAN moves are applied. The solution is then replayed to
// prove every move is legal before the puzzle is accepted.
export function parsePuzzle(json) {
  try {
    const p = json && json.puzzle;
    if (!p || !p.id || !Array.isArray(p.solution) || p.solution.length === 0) return null;

    let fen = p.fen;
    if (!fen) {
      const pgn = json.game && json.game.pgn;
      if (!pgn || typeof p.initialPly !== 'number') return null;
      const game = new Chess();
      const sans = pgn.trim().split(/\s+/);
      const plies = p.initialPly + 1;
      if (sans.length < plies) return null;
      for (let i = 0; i < plies; i += 1) {
        if (!game.move(sans[i])) return null;
      }
      fen = game.fen();
    }

    // Prove the whole solution replays legally from the position.
    const check = new Chess(fen);
    for (const uci of p.solution) {
      const mv = check.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4].toLowerCase() : undefined,
      });
      if (!mv) return null;
    }

    const themes = Array.isArray(p.themes) ? p.themes : [];
    return {
      id: `lichess-${p.id}`,
      kind: 'solution',
      fen,
      solution: p.solution,
      rating: typeof p.rating === 'number' ? p.rating : 1500,
      themes,
      theme: displayTheme(themes),
      hint: `Theme: ${displayTheme(themes).toLowerCase()}.`,
      source: 'lichess-daily',
    };
  } catch (_) {
    return null;
  }
}

// Fetch today's puzzle; null on any failure (offline, API change, bad data).
export async function fetchDailyPuzzle() {
  try {
    const res = await fetch(DAILY_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parsePuzzle(await res.json());
  } catch (_) {
    return null;
  }
}
