// scoring.js — pure per-round scoring for Ricochet solo play.
//
// score = quality x pace, in [0, 1]. Quality rewards solving in few moves;
// pace rewards solving quickly relative to a target that scales with the
// optimal solution length. A revealed or abandoned round scores 0.

export const TARGET_MS_PER_OPTIMAL_MOVE = 20000;
// Full pace at or below this fraction of the target time.
export const FAST_FRACTION = 0.5;
// Floor pace at or beyond this multiple of the target time.
export const SLOW_MULTIPLE = 4;
export const MIN_PACE = 0.3;

export function targetMs(optimal) {
  return TARGET_MS_PER_OPTIMAL_MOVE * optimal;
}

// optimal / playerMoves, clamped to [0, 1].
export function qualityFor(optimal, moves) {
  if (!(optimal > 0) || !(moves > 0)) return 0;
  return Math.min(1, Math.max(0, optimal / moves));
}

// 1 at/below FAST_FRACTION x target, MIN_PACE at/above SLOW_MULTIPLE x target,
// log-linear in between.
export function paceFor(optimal, timeMs) {
  const fast = FAST_FRACTION * targetMs(optimal);
  if (!(timeMs > fast)) return 1;
  if (timeMs >= SLOW_MULTIPLE * targetMs(optimal)) return MIN_PACE;
  const span = Math.log(SLOW_MULTIPLE / FAST_FRACTION);
  return 1 - ((1 - MIN_PACE) * Math.log(timeMs / fast)) / span;
}

export function scoreRound({ optimal, moves, timeMs, revealed = false, gaveUp = false }) {
  const quality = qualityFor(optimal, moves);
  const pace = paceFor(optimal, timeMs);
  const score = revealed || gaveUp ? 0 : quality * pace;
  return { quality, pace, score };
}
