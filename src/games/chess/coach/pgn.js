// pgn.js — PGN import/export helpers (issue #16).
//
// ChessBoard already produces/loads PGN via chess.js; this module adds the
// browser glue (trigger a download, read an uploaded file) plus a light
// validation wrapper. Kept separate from the Board so the Board stays pure and
// DOM-free, and so the file-reading parts can be stubbed in tests.

// Build a PGN string with a couple of standard headers prepended. chess.js's
// own pgn() output is already valid; we just optionally add Event/Date headers.
export function withHeaders(pgnBody, { white = 'Human', black = 'Stockfish', date } = {}) {
  const headers = [
    '[Event "GIPF Chess"]',
    '[Site "gipf.vercel.app/chess"]',
    date ? `[Date "${date}"]` : null,
    `[White "${white}"]`,
    `[Black "${black}"]`,
  ]
    .filter(Boolean)
    .join('\n');
  return `${headers}\n\n${pgnBody}`.trim() + '\n';
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
