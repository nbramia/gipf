// analysisTools.js — the Stockfish tool that the coaching LLM can call during a
// move-thread conversation (issue: threaded Q&A grounded in live engine data).
//
// The LLM never receives a raw FEN it could fabricate. It analyzes RELATIVE to
// the move under discussion: it may pick the position the mover faced ('before')
// or the resulting position ('after'), and optionally play a short line of moves
// from there to explore a "what if". The executor validates every move with
// chess.js and runs the real engine, so any eval the model cites came from an
// actual Stockfish search — it cannot invent one (#22 truthfulness, extended to
// the conversational layer).
//
// Split into a PURE schema constant (imported by the serverless endpoint to tell
// Claude what it can call) and a client-side executor (runs in the browser where
// Stockfish lives, via an injected `analyze` function so it stays unit-testable).

import { Chess } from 'chess.js';
import { lineToCandidate } from './analyzeMove.js';

// Tool schema sent to Claude. Pure data — safe to import server-side.
export const ANALYZE_POSITION_TOOL = {
  name: 'analyze_position',
  description:
    'Run the Stockfish chess engine to get an objective evaluation and the best ' +
    'lines for a position related to the move being discussed. Use this whenever ' +
    'you need an evaluation, a best move, or a principal variation — including to ' +
    'check a "what if" idea. NEVER state an evaluation or concrete line you did ' +
    'not get from this tool.',
  input_schema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        enum: ['before', 'after'],
        description:
          "Which position to start from: 'before' = the position the player faced " +
          "for this move; 'after' = the position resulting from the move played. " +
          "Defaults to 'before'.",
      },
      moves: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional sequence of moves to play from the chosen position before ' +
          'analyzing, in SAN (e.g. ["Nf3","d5"]) or long algebraic (e.g. ["g1f3"]). ' +
          'Use this to explore a specific alternative line. Omit to analyze the ' +
          'position as-is.',
      },
      multipv: {
        type: 'number',
        description: 'How many candidate lines to return (1–4). Defaults to 3.',
      },
    },
  },
};

// Apply a single move given in SAN or long-algebraic (UCI) form. Returns the
// chess.js verbose move or null if illegal/unparseable.
function applyMove(game, move) {
  if (typeof move !== 'string' || !move) return null;
  // Try SAN first (covers "Nf3", "exd5", "O-O", "e8=Q").
  try {
    const san = game.move(move, { sloppy: true });
    if (san) return san;
  } catch (_) {
    /* fall through to UCI */
  }
  // Try UCI long-algebraic ("g1f3", "e7e8q").
  const m = move.replace(/[^a-h1-8qrbnQRBN]/g, '');
  if (m.length >= 4) {
    try {
      const mv = game.move({
        from: m.slice(0, 2),
        to: m.slice(2, 4),
        promotion: m.length > 4 ? m[4].toLowerCase() : undefined,
      });
      if (mv) return mv;
    } catch (_) {
      /* illegal */
    }
  }
  return null;
}

// Execute an analyze_position tool call.
//   ctx.fenBefore / ctx.fenAfter — the two anchor positions for the move.
//   input — the tool input from Claude { from, moves, multipv }.
//   analyze — async (fen, {multipv}) => { lines: [...] }  (the engine).
// Returns a plain object suitable for a tool_result (or { error } on bad input).
export async function runAnalyzePosition({ ctx, input, analyze }) {
  const from = input && input.from === 'after' ? 'after' : 'before';
  const base = from === 'after' ? ctx.fenAfter : ctx.fenBefore;
  if (!base) return { error: `No '${from}' position is available for this move.` };

  const game = new Chess(base);
  const played = [];
  const moves = Array.isArray(input && input.moves) ? input.moves : [];
  for (const mv of moves) {
    const applied = applyMove(game, mv);
    if (!applied) {
      return {
        error: `Move "${mv}" is not legal in this position` +
          (played.length ? ` (after ${played.join(' ')})` : '') + '.',
        legalSoFar: played,
      };
    }
    played.push(applied.san);
  }

  const fen = game.fen();
  const multipv = Math.max(1, Math.min(4, Math.round((input && input.multipv) || 3)));
  let result;
  try {
    result = await analyze(fen, { multipv });
  } catch (e) {
    return { error: `Engine analysis failed: ${(e && e.message) || e}` };
  }

  const lines = (result && result.lines ? result.lines : []).map((l) => {
    const c = lineToCandidate(fen, l);
    return { move: c.san, eval: c.eval, line: c.pv };
  });

  return {
    from,
    movesPlayed: played,
    sideToMove: game.turn() === 'w' ? 'White' : 'Black',
    lines,
  };
}

// Dispatch a tool call by name. Currently only analyze_position.
export async function runTool(name, input, { ctx, analyze }) {
  if (name === 'analyze_position') return runAnalyzePosition({ ctx, input, analyze });
  return { error: `Unknown tool: ${name}` };
}
