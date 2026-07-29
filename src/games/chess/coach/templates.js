// templates.js — deterministic, engine-grounded commentary.
//
// The graceful fallback when the Claude coach is unavailable (no API key,
// network/error). Every sentence is built only from real engine output (SAN
// moves, evals, principal variations) so the fallback can never fabricate a
// line — it just reports what Stockfish actually found.

import { CATEGORIES, formatEval } from './classify.js';
import { describeBookMove } from './openingCoach.js';
import { detectMotifs } from './motifs.js';

function pvLine(pv, max = 5) {
  if (!pv || !pv.length) return '';
  const shown = pv.slice(0, max).join(' ');
  return pv.length > max ? `${shown}…` : shown;
}

// A cheap, stable "which variant to use" seed so a long game doesn't read as
// one repeated form letter. The fullmove counter is the last field of a FEN,
// always present on the payload's `fen` (position BEFORE the move) — no need
// for the UI to thread a separate ply number through.
function variantSeed(analysis) {
  const fen = analysis && analysis.fen;
  if (!fen) return 0;
  const n = parseInt(fen.split(' ').pop(), 10);
  return Number.isFinite(n) ? n : 0;
}

function pick(list, seed) {
  return list[((seed % list.length) + list.length) % list.length];
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

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// Commentary evaluating a move the PLAYER just made (issue #9 fallback).
// analysis: { classification, movePlayed:{san}, playedEval, bestMove:{san,eval,pv},
//             fen (before the move), sideToMove, inOpening, weaknessProfile }
export function describePlayerMove(analysis) {
  const {
    classification,
    movePlayed,
    bestMove,
    playedEval,
    openingStats,
    opening,
    sideToMove,
    inOpening,
    weaknessProfile,
  } = analysis;
  const cat = CATEGORIES[classification] || CATEGORIES.good;
  const san = movePlayed ? movePlayed.san : 'Your move';
  const seed = variantSeed(analysis);

  // Cheap, synchronous position facts (hanging pieces, forks, pins, king
  // safety, development) — see motifs.js. Never fabricated: everything here
  // is verified directly off the board, not guessed from the classification.
  const motifs = detectMotifs({ fen: analysis.fen, san, moverColor: sideToMove, inOpening });
  const negativeMotif = motifs.find((m) => m.polarity === 'negative');
  const positiveMotif = motifs.find((m) => m.polarity === 'positive');

  // Opening: describe by master practice, not eval-loss vs. one "best" move.
  if (classification === 'book') {
    if (openingStats) return describeBookMove(san, opening, openingStats);
    // No master-game data (Lichess unreachable): still treat it as a sound
    // opening choice rather than judging it against a single "best" move.
    const namePart = opening ? ` (${opening})` : '';
    const bookTail = positiveMotif
      ? ` ${capitalize(positiveMotif.text)}.`
      : ' Focus on developing your pieces and king safety.';
    return (
      `${san}${namePart} — Book. A sound opening move; openings have several ` +
      `playable paths, so this is fine.${bookTail}`
    );
  }

  const parts = [`${san} — ${cat.label}.`];

  if (classification === 'best') {
    const bestSkeletons = [
      `That is the engine's top choice. Well played.`,
      `That's the strongest move on the board here.`,
      `Nothing beats that — the engine agrees.`,
    ];
    parts.push(pick(bestSkeletons, seed));
    if (positiveMotif) parts.push(`${capitalize(positiveMotif.text)}.`);
    if (bestMove && bestMove.pv) parts.push(`The line continues ${pvLine(bestMove.pv)}.`);
    return parts.join(' ');
  }

  if (playedEval) parts.push(`After it, the evaluation is ${playedEval}.`);

  if (cat.tone === 'good' && positiveMotif) {
    parts.push(`${capitalize(positiveMotif.text)}.`);
  }

  if (bestMove && bestMove.san && bestMove.san !== san) {
    const strongerSkeletons = [
      `Stronger was ${bestMove.san} (${bestMove.eval})`,
      `${bestMove.san} (${bestMove.eval}) kept more of the advantage`,
      `${bestMove.san} (${bestMove.eval}) was the sharper choice here`,
    ];
    parts.push(
      pick(strongerSkeletons, seed) +
        (bestMove.pv && bestMove.pv.length > 1 ? `, e.g. ${pvLine(bestMove.pv)}.` : '.')
    );
    if (cat.tone === 'bad') {
      // Name the concrete idea when we have one, verified off the actual
      // position — otherwise fall back to a still-active (not homework-y)
      // prompt rather than the old "go figure it out" line.
      if (negativeMotif) {
        parts.push(`${capitalize(negativeMotif.text)}.`);
      } else {
        const genericSkeletons = [
          `Compare the two lines and see what ${san} gives away.`,
          `Play through both moves a few plies to feel the difference.`,
          `Look at what ${bestMove.san} does that ${san} doesn't.`,
        ];
        parts.push(pick(genericSkeletons, seed));
      }
      // Recurring-pattern nudge: only for the classifications that build the
      // weakness profile in the first place, and only sometimes — this should
      // read as an occasional connection, not a running scoreboard.
      if (weaknessProfile && seed % 3 === 0) {
        parts.push(`This fits a pattern: ${weaknessProfile}`);
      }
    }
  }
  return parts.join(' ');
}

// Display-friendly eval string from a candidate's raw scoreCp/mateIn.
export function evalString(scoreCp, mateIn) {
  return formatEval(scoreCp, mateIn);
}
