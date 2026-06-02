// rating.js — pure Elo math for Chess "Rated" mode.
//
// No DOM, no engine — just the arithmetic that turns a game result into a new
// rating, plus matchmaking (picking the ladder rung nearest the player). Kept
// pure so it's unit-testable without spawning Stockfish or React.

export const DEFAULT_RATING = 1000;

// K-factor schedule: large while the rating is provisional so it converges
// fast, then small once the player has a track record so it stays stable.
export function kFactor(gamesPlayed) {
  if (gamesPlayed < 20) return 40;
  if (gamesPlayed < 40) return 20;
  return 10;
}

// Whether a rating is still provisional (large K-factor, shown to the user).
export function isProvisional(gamesPlayed) {
  return gamesPlayed < 20;
}

// Logistic expected score for `rating` vs `oppRating` (standard 400-scale).
export function expectedScore(rating, oppRating) {
  return 1 / (1 + 10 ** ((oppRating - rating) / 400));
}

// Player result -> numeric score from the player's point of view.
export function scoreFor(result) {
  if (result === 'win') return 1;
  if (result === 'draw') return 0.5;
  return 0; // loss
}

// New rating after a game. `score` is 1 / 0.5 / 0 (player POV). Returns the
// rounded new rating (floored at 100) and the signed delta for display.
export function updateRating(rating, oppRating, score, gamesPlayed) {
  const k = kFactor(gamesPlayed);
  const delta = Math.round(k * (score - expectedScore(rating, oppRating)));
  return { rating: Math.max(100, rating + delta), delta };
}

// Reconcile a local and a remote {rating, ratedGames} record (cross-device
// sync). `ratedGames` is monotonic per identity, so the record with more games
// is the more authoritative one — no clocks, no skew. Ties favour the higher
// rating so a win recorded on two devices can't be lost. Either side may be
// null (nothing stored there yet).
export function mergeRating(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  if (remote.ratedGames > local.ratedGames) return remote;
  if (remote.ratedGames < local.ratedGames) return local;
  return remote.rating >= local.rating ? remote : local;
}

// Matchmaking: the ladder rung whose published rating is nearest the player's.
// `ladder` is an array of objects each carrying a numeric `rating`. Ties favour
// the stronger rung so a climbing player keeps facing resistance.
export function nearestRung(rating, ladder) {
  let best = ladder[0];
  let bestDist = Infinity;
  for (const rung of ladder) {
    const d = Math.abs(rung.rating - rating);
    if (d < bestDist || (d === bestDist && rung.rating > best.rating)) {
      best = rung;
      bestDist = d;
    }
  }
  return best;
}
