// difficulty.js — named opponent strength tiers (issue #5).
//
// Each tier maps to Stockfish's UCI_Elo (used with UCI_LimitStrength) plus a
// per-move search budget. Stockfish's Elo is calibrated roughly to CCRL; the
// lower bound it accepts is ~1320, so "Beginner" sits at the floor and we also
// shorten its thinking time so weak tiers feel fast as well as weak.
//
// `analysisMovetimeMs` is the time used for COACHING analysis (always full
// strength, independent of the opponent tier) so move evaluation stays honest.

export const DIFFICULTY_TIERS = [
  { key: 'beginner', label: 'Beginner', elo: 1320, moveTimeMs: 200 },
  { key: 'casual', label: 'Casual', elo: 1500, moveTimeMs: 350 },
  { key: 'intermediate', label: 'Intermediate', elo: 1750, moveTimeMs: 500 },
  { key: 'advanced', label: 'Advanced', elo: 2100, moveTimeMs: 800 },
  { key: 'master', label: 'Master', elo: 2850, moveTimeMs: 1200 },
];

export const DEFAULT_TIER_KEY = 'casual';

// Rated-mode opponent ladder. Each rung has a published `rating` (used by the
// Elo matchmaker in rating.js) and an engine `spec`:
//   - { elo }  → Stockfish UCI_LimitStrength at that Elo. The limiter's floor
//                is ~1320, so every rung at or above it uses this directly.
//   - { weak } → full-strength search (honest evals), but the move is SAMPLED
//                from the MultiPV lines within `windowCp` centipawns of best.
//                Capping the window means the bot plays "inaccuracies", never
//                a piece-hanging blunder; `pOff` is how often it leaves best.
//                This is the only way to reach sub-1320 strength believably.
// `windowCp`/`pOff` are tuned so the felt strength roughly matches the label;
// verify with splendor-style A/B play before trusting the exact numbers.
export const RATING_LADDER = [
  { rating: 800, spec: { weak: { windowCp: 90, pOff: 0.45, multipv: 5 }, moveTimeMs: 300 } },
  { rating: 1000, spec: { weak: { windowCp: 60, pOff: 0.35, multipv: 5 }, moveTimeMs: 300 } },
  { rating: 1200, spec: { weak: { windowCp: 40, pOff: 0.25, multipv: 5 }, moveTimeMs: 350 } },
  { rating: 1320, spec: { elo: 1320, moveTimeMs: 300 } },
  { rating: 1500, spec: { elo: 1500, moveTimeMs: 400 } },
  { rating: 1750, spec: { elo: 1750, moveTimeMs: 500 } },
  { rating: 2100, spec: { elo: 2100, moveTimeMs: 800 } },
  { rating: 2500, spec: { elo: 2500, moveTimeMs: 1000 } },
  { rating: 3000, spec: { elo: undefined, moveTimeMs: 1200 } }, // unlimited strength
];

// Full-strength analysis budget for coaching (not tied to opponent tier).
export const ANALYSIS_MOVETIME_MS = 1000;
export const ANALYSIS_MULTIPV = 3;

export function getTier(key) {
  return DIFFICULTY_TIERS.find((t) => t.key === key) || DIFFICULTY_TIERS.find((t) => t.key === DEFAULT_TIER_KEY);
}
