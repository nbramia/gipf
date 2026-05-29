// templates.js — deterministic, engine-grounded commentary.
//
// The graceful fallback when the Claude coach is unavailable (no API key,
// network/error). Every sentence is built only from real engine output (SAN
// moves, evals, principal variations) so the fallback can never fabricate a
// line — it just reports what Stockfish actually found.

import { CATEGORIES, formatEval } from './classify.js';

function pvLine(pv, max = 5) {
  if (!pv || !pv.length) return '';
  const shown = pv.slice(0, max).join(' ');
  return pv.length > max ? `${shown}…` : shown;
}

// Commentary for a move the ENGINE just played (issue #8 fallback).
// analysis: { movePlayed:{san}, candidates:[{san,eval,pv}] }
export function describeAiMove(analysis) {
  const { movePlayed, candidates = [] } = analysis;
  const chosen = candidates.find((c) => c.san === (movePlayed && movePlayed.san)) || candidates[0];
  const parts = [];
  parts.push(`I played ${movePlayed ? movePlayed.san : (chosen && chosen.san) || '...'}.`);

  if (chosen) {
    parts.push(
      `It holds the evaluation at ${chosen.eval} (White's view)` +
        (chosen.pv && chosen.pv.length > 1 ? `, intending ${pvLine(chosen.pv)}.` : '.')
    );
  }
  const alts = candidates.filter((c) => !chosen || c.san !== chosen.san).slice(0, 2);
  if (alts.length) {
    parts.push(`I also considered ${alts.map((c) => `${c.san} (${c.eval})`).join(' and ')}.`);
    if (candidates[0] && chosen && candidates[0].san === chosen.san) {
      parts.push(`This was the strongest, so I chose it.`);
    }
  }
  return parts.join(' ');
}

// Commentary evaluating a move the PLAYER just made (issue #9 fallback).
// analysis: { classification, movePlayed:{san}, playedEval, bestMove:{san,eval,pv} }
export function describePlayerMove(analysis) {
  const { classification, movePlayed, bestMove, playedEval } = analysis;
  const cat = CATEGORIES[classification] || CATEGORIES.good;
  const san = movePlayed ? movePlayed.san : 'Your move';
  const parts = [`${san} — ${cat.label}.`];

  if (classification === 'best') {
    parts.push(`That is the engine's top choice. Well played.`);
    if (bestMove && bestMove.pv) parts.push(`The line continues ${pvLine(bestMove.pv)}.`);
    return parts.join(' ');
  }

  if (playedEval) parts.push(`After it, the evaluation is ${playedEval}.`);
  if (bestMove && bestMove.san && bestMove.san !== san) {
    parts.push(
      `Stronger was ${bestMove.san} (${bestMove.eval})` +
        (bestMove.pv && bestMove.pv.length > 1 ? `, e.g. ${pvLine(bestMove.pv)}.` : '.')
    );
    if (cat.tone === 'bad') {
      parts.push(`Check what ${san} left loose, or what ${bestMove.san} would have stopped.`);
    }
  }
  return parts.join(' ');
}

// Display-friendly eval string from a candidate's raw scoreCp/mateIn.
export function evalString(scoreCp, mateIn) {
  return formatEval(scoreCp, mateIn);
}
