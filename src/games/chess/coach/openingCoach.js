// openingCoach.js — realistic opening feedback grounded in real master games.
//
// The plain eval-loss classifier (classify.js) is correct in the middlegame but
// WRONG in the opening: it treats Stockfish's single top move as "the" move and
// flags everything else as an inaccuracy. But openings have many sound paths
// (1.e4, 1.d4, 1.Nf3, 1.c4 are all respected). So in the opening we instead ask
// the Lichess masters database "what do strong humans actually play here?" and:
//   - never call a recognized master move a mistake (label it "Book"),
//   - report how mainstream the move is + its master score,
//   - surface the other popular choices, reflecting that there isn't one path.
//
// The fetch is the only impure part; parsing/summarizing are pure + tested.
// Truthfulness is preserved: all numbers come straight from the masters DB.

const EXPLORER_URL = 'https://explorer.lichess.ovh/masters';

// A move is "book" if masters played it in at least this many games at the
// position. Low enough to include real sidelines, high enough to exclude noise.
const MIN_BOOK_GAMES = 5;

// Only consult the opening book this deep; after this we're out of theory.
export const OPENING_MAX_PLY = 24;

// The Lichess opening explorer now requires authentication (locked down after
// DDoS attacks). The token is BRING-YOUR-OWN, stored only in the browser — never
// hardcoded, since this is an open-source, public app. A free read-only token is
// created at lichess.org → Preferences → API access tokens.
const LICHESS_TOKEN_KEY = 'chessLichessToken';

export function getLichessToken() {
  try {
    return localStorage.getItem(LICHESS_TOKEN_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setLichessToken(token) {
  try {
    if (token) localStorage.setItem(LICHESS_TOKEN_KEY, token);
    else localStorage.removeItem(LICHESS_TOKEN_KEY);
  } catch (_) {
    /* ignore storage failures */
  }
}

export function hasLichessToken() {
  return !!getLichessToken();
}

// Fetch the masters explorer for a position (FEN before the move). Requires a
// Lichess token (the endpoint is auth-gated). Returns the parsed JSON, or null
// on any failure / missing token / non-opening position. Never throws.
export async function fetchOpeningStats(fen, token = getLichessToken()) {
  if (!token) return null;
  try {
    const url = `${EXPLORER_URL}?fen=${encodeURIComponent(fen)}&moves=12&topGames=0`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.moves)) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function gamesOf(entry) {
  return (entry.white || 0) + (entry.draws || 0) + (entry.black || 0);
}

// Master score for the side that just moved, as a percentage (win + ½·draw).
function scoreForMover(entry, moverColor) {
  const total = gamesOf(entry);
  if (!total) return null;
  const wins = moverColor === 'w' ? entry.white || 0 : entry.black || 0;
  return Math.round(((wins + (entry.draws || 0) / 2) / total) * 100);
}

// Summarize how a played move fits master practice at a position.
//   stats      — fetchOpeningStats result for the position BEFORE the move
//   playedSan  — SAN of the move played
//   moverColor — 'w' | 'b'
// Returns null if not a book move; otherwise:
//   { isBook:true, games, sharePct, scorePct, rank, totalGames,
//     alternatives: [{san, games, sharePct, scorePct}] }
export function summarizeBookMove(stats, playedSan, moverColor) {
  if (!stats || !Array.isArray(stats.moves) || stats.moves.length === 0) return null;
  const totalGames =
    (stats.white || 0) + (stats.draws || 0) + (stats.black || 0);
  if (!totalGames) return null;

  // Sort by total games descending ourselves — the Lichess explorer does NOT
  // reliably return moves in frequency order (verified: after 1.e4 it lists e5
  // before c5 even though c5 has more games), so trusting the array index for
  // "rank" would be wrong.
  const ranked = [...stats.moves].sort((a, b) => gamesOf(b) - gamesOf(a));

  const idx = ranked.findIndex((m) => m.san === playedSan);
  if (idx === -1) return null;
  const entry = ranked[idx];
  const games = gamesOf(entry);
  if (games < MIN_BOOK_GAMES) return null;

  const alternatives = ranked
    .filter((_, i) => i !== idx)
    .slice(0, 3)
    .map((m) => ({
      san: m.san,
      games: gamesOf(m),
      sharePct: Math.round((gamesOf(m) / totalGames) * 100),
      scorePct: scoreForMover(m, moverColor),
    }));

  return {
    isBook: true,
    games,
    sharePct: Math.round((games / totalGames) * 100),
    scorePct: scoreForMover(entry, moverColor),
    rank: idx + 1,
    totalGames,
    alternatives,
  };
}

// One-line, human-readable summary of a book move for the templated fallback.
export function describeBookMove(playedSan, openingName, book) {
  if (!book) return '';
  const where =
    book.rank === 1
      ? 'the most popular master choice'
      : `the ${ordinal(book.rank)}-most-common master move`;
  const namePart = openingName ? ` (${openingName})` : '';
  const altPart = book.alternatives.length
    ? ` Masters also play ${book.alternatives.map((a) => a.san).join(', ')} here.`
    : '';
  const scorePart =
    typeof book.scorePct === 'number' ? `, scoring ${book.scorePct}% for the side to move` : '';
  return (
    `${playedSan}${namePart} — Book. It's ${where} in this position ` +
    `(${book.sharePct}% of master games${scorePart}). A sound, established choice.${altPart}`
  );
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
