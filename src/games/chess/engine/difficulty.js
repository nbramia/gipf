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

// Full-strength analysis budget for coaching (not tied to opponent tier).
export const ANALYSIS_MOVETIME_MS = 1000;
export const ANALYSIS_MULTIPV = 3;

export function getTier(key) {
  return DIFFICULTY_TIERS.find((t) => t.key === key) || DIFFICULTY_TIERS.find((t) => t.key === DEFAULT_TIER_KEY);
}
