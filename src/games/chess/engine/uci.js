// uci.js — pure parsing/formatting helpers for the UCI protocol.
//
// No DOM, no Worker, no engine — just string <-> structured-data conversion so
// the engine integration can be unit-tested without spawning Stockfish.

// Parse a single `info ...` line into a structured object, or null if it isn't
// a useful analysis line (e.g. `info string ...`, `info depth N currmove ...`).
//
// Scores are normalised to WHITE's perspective using `sideToMove` ('w'|'b'),
// because UCI reports `score cp` relative to the side to move.
export function parseInfoLine(line, sideToMove = 'w') {
  if (typeof line !== 'string' || !line.startsWith('info ')) return null;
  const tokens = line.trim().split(/\s+/);

  const out = { depth: null, multipv: 1, scoreCp: null, mateIn: null, pv: [] };
  let sawScore = false;

  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === 'depth') {
      out.depth = parseInt(tokens[++i], 10);
    } else if (t === 'multipv') {
      out.multipv = parseInt(tokens[++i], 10);
    } else if (t === 'score') {
      const kind = tokens[++i];
      const val = parseInt(tokens[++i], 10);
      sawScore = true;
      const sign = sideToMove === 'w' ? 1 : -1;
      if (kind === 'cp') {
        out.scoreCp = sign * val;
      } else if (kind === 'mate') {
        out.mateIn = sign * val;
        // Encode mate as a large centipawn magnitude for ordering/threshold use.
        out.scoreCp = sign * (val === 0 ? 0 : 100000 - Math.abs(val));
        if ((sign * val) < 0) out.scoreCp = -Math.abs(out.scoreCp);
      }
    } else if (t === 'pv') {
      out.pv = tokens.slice(i + 1);
      break; // pv is always last
    }
  }

  // A line with no score and no pv carries nothing we use.
  if (!sawScore && out.pv.length === 0) return null;
  return out;
}

// Extract the move from a `bestmove e2e4 ponder e7e5` line, or null.
export function parseBestMove(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/^bestmove\s+(\S+)/);
  if (!m) return null;
  const move = m[1];
  if (move === '(none)') return null;
  return move;
}

// Split a UCI long-algebraic move (e.g. 'e7e8q') into {from,to,promotion}.
export function splitUciMove(uci) {
  if (typeof uci !== 'string' || uci.length < 4) return null;
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4].toLowerCase() : undefined,
  };
}

// Reduce a stream of parsed info objects to the latest line per multipv index,
// keeping only the deepest depth seen for each. Returns an array sorted by
// multipv (1..N). Used to turn streaming engine output into final candidates.
export function collectMultiPV(infos) {
  const byIdx = new Map();
  for (const info of infos) {
    if (!info) continue;
    const idx = info.multipv || 1;
    const prev = byIdx.get(idx);
    if (!prev || (info.depth || 0) >= (prev.depth || 0)) {
      byIdx.set(idx, info);
    }
  }
  return [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
