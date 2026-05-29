// analyzeMove.js — convert a just-played move + engine analysis into a coaching
// payload. Pure logic (no React, no network) so it can be unit-tested; the UI
// supplies engine results and the SAN of the move that was played.
//
// Key correctness property (issue #22 truthfulness): every candidate, eval, and
// "best move" we surface comes straight from the engine's analysis of the
// position BEFORE the move. We never invent lines. The played move's resulting
// eval comes from the engine's analysis of the position AFTER the move.

import { Chess } from 'chess.js';
import { classifyMove, formatEval } from './classify.js';

// Convert a UCI pv (array of long-algebraic moves) to SAN, replaying from `fen`.
// Stops at the first illegal/unexpected move so a malformed pv can't crash us.
export function pvToSan(fen, pv, max = 6) {
  const out = [];
  const game = new Chess(fen);
  for (const uci of (pv || []).slice(0, max)) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4].toLowerCase() : undefined;
    let mv;
    try {
      mv = game.move({ from, to, promotion });
    } catch (_) {
      break;
    }
    if (!mv) break;
    out.push(mv.san);
  }
  return out;
}

// Map a single engine MultiPV line {multipv,scoreCp,mateIn,pv} (White POV) into a
// display candidate {san, uci, eval, evalWhite, mateIn, pv} using `fenBefore`.
export function lineToCandidate(fenBefore, line) {
  const pvSan = pvToSan(fenBefore, line.pv);
  return {
    uci: line.pv && line.pv[0],
    san: pvSan[0] || (line.pv && line.pv[0]) || '?',
    eval: formatEval(line.scoreCp, line.mateIn),
    evalWhite: line.scoreCp,
    mateIn: line.mateIn,
    pv: pvSan,
  };
}

// Build the payload for a move that was just played.
//   fenBefore     — FEN before the move (engine analyzed this → analysisBefore)
//   fenAfter      — FEN after the move (engine analyzed this → analysisAfter)
//   movePlayedSan — SAN of the move actually played
//   moverColor    — 'w' | 'b' (who played the move)
//   analysisBefore/After — { lines: [MultiPV...] } from useStockfish.analyze
//   kind          — 'ai-move' | 'player-move'
//   learningGoal  — optional free-text focus
//
// Returns a payload consumable by coachClient.requestCommentary (and its
// template fallback), including a classification for player moves.
export function buildMovePayload({
  fenBefore,
  fenAfter,
  movePlayedSan,
  moverColor,
  analysisBefore,
  analysisAfter,
  kind,
  learningGoal,
}) {
  const candidates = (analysisBefore && analysisBefore.lines ? analysisBefore.lines : []).map((l) =>
    lineToCandidate(fenBefore, l)
  );
  const bestLine = candidates[0] || null;

  // Eval after the move: the top line from the post-move analysis (White POV).
  const afterTop = analysisAfter && analysisAfter.lines && analysisAfter.lines[0];
  const playedEvalWhite = afterTop ? afterTop.scoreCp : (bestLine ? bestLine.evalWhite : 0);
  const playedMateIn = afterTop ? afterTop.mateIn : null;

  const wasTopMove = !!(bestLine && bestLine.san === movePlayedSan);
  const classification = classifyMove({
    bestEvalWhite: bestLine ? bestLine.evalWhite : 0,
    playedEvalWhite,
    moverColor,
    wasTopMove,
  });

  return {
    kind,
    fen: fenBefore,
    sideToMove: moverColor,
    movePlayed: { san: movePlayedSan },
    candidates,
    bestMove: bestLine
      ? { san: bestLine.san, eval: bestLine.eval, evalWhite: bestLine.evalWhite, pv: bestLine.pv }
      : null,
    evalBefore: bestLine ? bestLine.eval : undefined,
    evalAfter: formatEval(playedEvalWhite, playedMateIn),
    playedEval: formatEval(playedEvalWhite, playedMateIn),
    classification,
    learningGoal: learningGoal || undefined,
  };
}
