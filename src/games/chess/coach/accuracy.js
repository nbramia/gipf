// accuracy.js — post-game accuracy summary (issue #17).
//
// Converts per-move centipawn loss into an accuracy percentage and aggregates a
// game into a per-side report. The move-accuracy curve is the widely-used
// Lichess formula: accuracy% = 103.1668 * exp(-0.04354 * winDrop) - 3.1669,
// where winDrop is the drop in "win percentage" caused by the move. We derive
// win% from centipawns with the standard logistic and feed in the per-move
// centipawn loss. Pure functions — fully unit-tested.

// Centipawns (mover POV) -> win probability percentage [0,100].
export function winPercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// A single move's accuracy from how much win% it dropped (>= 0).
export function moveAccuracy(winDrop) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winDrop)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

// Accuracy for one move given the centipawn loss it conceded (mover POV).
// We approximate winDrop from cpLoss around an even position, which is the
// standard simplification for a per-move accuracy readout.
export function accuracyFromCpLoss(cpLoss) {
  const drop = winPercent(0) - winPercent(-Math.max(0, cpLoss));
  return moveAccuracy(drop);
}

// Aggregate a list of moves into a per-side report.
//   moves: [{ moverColor: 'w'|'b', cpLoss: number, classification: string }]
// Returns { white, black } where each side is
//   { accuracy, moves, counts:{best,excellent,good,inaccuracy,mistake,blunder} }
export function summarizeAccuracy(moves) {
  const blank = () => ({
    accuracySum: 0,
    moves: 0,
    counts: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
  });
  const acc = { w: blank(), b: blank() };

  for (const m of moves || []) {
    const side = acc[m.moverColor];
    if (!side) continue;
    side.moves += 1;
    side.accuracySum += accuracyFromCpLoss(m.cpLoss || 0);
    if (side.counts[m.classification] !== undefined) side.counts[m.classification] += 1;
  }

  const finalize = (s) => ({
    accuracy: s.moves ? Math.round((s.accuracySum / s.moves) * 10) / 10 : null,
    moves: s.moves,
    counts: s.counts,
  });

  return { white: finalize(acc.w), black: finalize(acc.b) };
}
