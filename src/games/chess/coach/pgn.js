// pgn.js — PGN import/export helpers.
//
// ChessBoard already produces/loads PGN via chess.js; this module adds the
// browser glue (trigger a download, read an uploaded file) plus a light
// validation wrapper. Kept separate from the Board so the Board stays pure and
// DOM-free, and so the file-reading parts can be stubbed in tests.

// PGN result token for the app's own game result ({winner:'white'|'black'|null})
// or null while the game is live.
export function resultToken(gameResult) {
  if (!gameResult) return '*';
  if (gameResult.winner === 'white') return '1-0';
  if (gameResult.winner === 'black') return '0-1';
  return '1/2-1/2';
}

const RESULT_RE = /(1-0|0-1|1\/2-1\/2|\*)/;
const OWN_TAGS = new Set(['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result']);

// Build one PGN with a single header set. `pgnBody` may already carry chess.js's
// own headers (placeholder Event/Site/... and Result "*"); those are replaced by
// ours, SetUp/FEN are kept, and the authoritative `result` (the app's game
// result, else the body's own) is written both as the Result tag and as the
// terminal movetext marker.
export function withHeaders(pgnBody, { white = 'Human', black = 'Stockfish', date, result } = {}) {
  const kept = [];
  const moveLines = [];
  let bodyResult = null;
  for (const line of String(pgnBody || '').trim().split('\n')) {
    const m = line.match(/^\[(\w+)\s+"([^"]*)"\]\s*$/);
    if (!m) {
      moveLines.push(line);
      continue;
    }
    if (m[1] === 'Result') bodyResult = m[2];
    if (!OWN_TAGS.has(m[1])) kept.push(line);
  }
  const res = result || (bodyResult && RESULT_RE.test(bodyResult) ? bodyResult : '*');
  const movetext = moveLines
    .join('\n')
    .trim()
    .replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '');
  const headers = [
    '[Event "Play Chess"]',
    '[Site "play.ramia.us/chess"]',
    date ? `[Date "${date}"]` : null,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${res}"]`,
    ...kept,
  ]
    .filter(Boolean)
    .join('\n');
  return `${headers}\n\n${`${movetext} ${res}`.trim()}\n`;
}

// The result an imported PGN declares: the [Result] tag, else a trailing
// movetext marker. Returns 'white' | 'black' | 'draw' | null (unfinished/unknown).
export function parseDeclaredResult(pgnText) {
  if (typeof pgnText !== 'string') return null;
  const tag = matchHeader(pgnText, 'Result');
  let token = tag && RESULT_RE.test(tag) ? tag.trim() : null;
  if (!token || token === '*') {
    const body = pgnText.replace(/^\s*(\[[^\n]*\]\s*\n)+/, '');
    const m = body.trim().match(/(1-0|0-1|1\/2-1\/2|\*)$/);
    token = m ? m[1] : token;
  }
  if (token === '1-0') return 'white';
  if (token === '0-1') return 'black';
  if (token === '1/2-1/2') return 'draw';
  return null;
}

// Trigger a .pgn download in the browser. No-op outside the DOM.
export function downloadPgn(pgnText, filename = 'game.pgn') {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  const blob = new Blob([pgnText], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

// Read an uploaded File (from an <input type=file>) as text. Returns a Promise.
export function readPgnFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader unavailable'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// Strip PGN headers/comments to a bare movetext heuristic check — used only to
// give a friendlier "doesn't look like PGN" message before handing to chess.js.
export function looksLikePgn(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  // Either has a [Tag "..."] header or a "1." move number.
  return /\[\s*\w+\s+"/.test(text) || /\b1\s*\./.test(text);
}

// Parse the [White] / [Black] headers out of a PGN string, so the UI can ask
// which side the human reviewed the game as instead of assuming White
// (issue 5.11). Returns { white, black } (each a header value or null if the
// tag is absent/unparseable) — parsing only, no assumption about the human.
export function parsePlayerHeaders(pgnText) {
  const white = matchHeader(pgnText, 'White');
  const black = matchHeader(pgnText, 'Black');
  return { white, black };
}

function matchHeader(pgnText, tag) {
  if (typeof pgnText !== 'string') return null;
  const m = pgnText.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
  return m ? m[1] : null;
}
