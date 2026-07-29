// puzzleCoach.js — coaching wired into puzzles (#24): staged hints on request
// and an explanation after a failed attempt.
//
// Truthfulness + no-spoiler rules:
//   - Hints escalate: stage 1 names only the theme, stage 2 names the piece
//     (and its square) that makes the key move — never the move itself. The
//     Claude path is only ever GIVEN those facts, so it cannot leak more.
//   - Fail coaching explains why the attempt fails using the engine's actual
//     refutation line (post-move analysis), and never names the key move.
// Both degrade to the deterministic text here when no API key is set.

import { Chess } from 'chess.js';
import { pvToSan } from './analyzeMove.js';

const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const MAX_HINT_STAGE = 2;

// Deterministic hint text for a puzzle at a hint stage.
//   puzzle — bank entry ({theme, hint, solution?, fen})
//   stage  — 1 (theme) or 2 (piece + square)
//   fen    — the position the player currently faces
// Stage 2 uses the stored solution's first move, which is only meaningful at
// the puzzle's start position; mid-line (after an accepted alternate move in a
// mate puzzle) it stays at the theme so it can never mislead.
export function hintFor(puzzle, stage, fen) {
  const themeHint = puzzle.hint || `Theme: ${puzzle.theme || 'tactic'}.`;
  if (stage <= 1) return themeHint;
  const uci = puzzle.solution && puzzle.solution[0];
  if (!uci) return themeHint;
  // The player reached a different position than the puzzle's start — that
  // only happens by playing a different-but-sound move (a wrong move fails
  // the puzzle immediately, it doesn't advance the board). The stored
  // solution's first square no longer applies to this position, so say why
  // the hint had to back off instead of silently going vague.
  if (fen !== puzzle.fen) {
    return `You played a different, sound try, so the piece-and-square hint no longer applies here — ${puzzle.theme || 'the idea'} is still on.`;
  }
  try {
    const piece = new Chess(fen).get(uci.slice(0, 2));
    if (!piece) return themeHint;
    return `Look at your ${PIECE_NAMES[piece.type] || 'piece'} on ${uci.slice(0, 2)}.`;
  } catch (_) {
    return themeHint;
  }
}

// Build the payload for a Claude-phrased hint. Deliberately sparse: the model
// receives only what the stage allows it to say.
export function buildHintPayload(puzzle, stage, fen) {
  const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return {
    kind: 'puzzle-hint',
    fen,
    sideToMove,
    stage,
    theme: puzzle.theme || 'tactic',
    hint: hintFor(puzzle, stage, fen),
  };
}

// Deterministic fail explanation: the engine's refutation of the attempt,
// never the solution. `refutationPv` is SAN from the position AFTER the move.
export function describePuzzleFail({ movePlayed, refutationPv, theme }) {
  const san = movePlayed && movePlayed.san ? movePlayed.san : 'That move';
  const line = (refutationPv || []).slice(0, 3).join(' ');
  const punish = line ? ` — after ${line} the chance is gone` : '';
  const themePart = theme ? ` The ${theme.toLowerCase()} idea is still there; look again.` : ' Look again.';
  return `${san} doesn't work${punish}.${themePart}`;
}

// Build the payload for coaching a failed attempt. Requires the post-move
// analysis (one MultiPV-1 search of fenAfter) so the refutation is real.
export function buildFailPayload({ puzzle, fen, fenAfter, playedSan, analysisAfter }) {
  const top = analysisAfter && analysisAfter.lines && analysisAfter.lines[0];
  const refutationPv = top ? pvToSan(fenAfter, top.pv, 4) : [];
  const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return {
    kind: 'puzzle-fail',
    fen,
    sideToMove,
    movePlayed: { san: playedSan },
    refutationPv,
    theme: puzzle.theme || 'tactic',
  };
}
