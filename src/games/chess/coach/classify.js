// classify.js — turn engine evaluations into human move-quality labels.
//
// Evaluations are centipawns from WHITE's perspective, with mate encoded as a
// large magnitude. Helpers convert to the moving side's perspective and derive a
// "centipawn loss" (how much the played move gave up vs. the engine's best),
// then bucket that loss into a category. Pure functions — unit-tested directly.

export const MATE_SCORE = 100000;

export const CATEGORIES = {
  best: { label: 'Best', tone: 'great' },
  excellent: { label: 'Excellent', tone: 'great' },
  good: { label: 'Good', tone: 'good' },
  inaccuracy: { label: 'Inaccuracy', tone: 'warn' },
  mistake: { label: 'Mistake', tone: 'bad' },
  blunder: { label: 'Blunder', tone: 'bad' },
};

// Convert a White-perspective score to the perspective of `color` ('w'|'b').
export function toPerspective(cpWhite, color) {
  return color === 'w' ? cpWhite : -cpWhite;
}

function clampForLoss(cp) {
  if (cp > MATE_SCORE - 1000) return MATE_SCORE;
  if (cp < -(MATE_SCORE - 1000)) return -MATE_SCORE;
  return cp;
}

// Classify a played move.
//   bestEvalWhite   — eval (White POV) BEFORE the move (best achievable).
//   playedEvalWhite — eval (White POV) AFTER the move.
//   moverColor      — 'w' | 'b'
//   wasTopMove      — true if the played move equals the engine's #1 choice.
export function classifyMove({ bestEvalWhite, playedEvalWhite, moverColor, wasTopMove }) {
  if (wasTopMove) return 'best';

  const best = clampForLoss(toPerspective(bestEvalWhite, moverColor));
  const played = clampForLoss(toPerspective(playedEvalWhite, moverColor));
  const loss = Math.max(0, best - played);

  // Throwing away a forced mate into a lost position is a blunder.
  if (best >= MATE_SCORE && played <= -2000) return 'blunder';

  if (loss <= 15) return 'excellent';
  if (loss <= 60) return 'good';
  if (loss <= 130) return 'inaccuracy';
  if (loss <= 300) return 'mistake';
  return 'blunder';
}

// Centipawn loss of a played move from the mover's perspective (>= 0).
export function centipawnLoss({ bestEvalWhite, playedEvalWhite, moverColor }) {
  const best = clampForLoss(toPerspective(bestEvalWhite, moverColor));
  const played = clampForLoss(toPerspective(playedEvalWhite, moverColor));
  return Math.max(0, best - played);
}

// Format a White-perspective eval for display: "+1.4", "-0.3", "M3", "-M2".
export function formatEval(cpWhite, mateIn) {
  if (typeof mateIn === 'number' && mateIn !== 0) {
    return mateIn > 0 ? `M${mateIn}` : `-M${Math.abs(mateIn)}`;
  }
  const pawns = (cpWhite || 0) / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}
