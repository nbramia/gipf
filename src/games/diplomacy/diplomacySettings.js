// New-game setup settings for Diplomacy ([Negotiation Loop] PR2).
//
// Read/write the chosen power, difficulty, persona spice, and maxYears under the
// single `diplomacySettings` localStorage key. This is its OWN copy of the
// settings-helper style — no cross-game import (each game keeps its conventions
// independent). Pure of React; safe against storage failures and corrupt JSON.

const SETTINGS_KEY = 'diplomacySettings';

export const POWER_OPTIONS = [
  'austria',
  'england',
  'france',
  'germany',
  'italy',
  'russia',
  'turkey',
];

export const DIFFICULTY_OPTIONS = ['easy', 'normal', 'hard'];

// Difficulty -> sim budget passed to the AI order computation (threaded into the
// worker/hook `options`). The tactical engine reads `difficulty`; we also surface
// a numeric `sims` knob so a tier change is verifiable independently of the
// engine's internal budget table.
export const DIFFICULTY_BUDGET = {
  easy: { difficulty: 'easy', sims: 40 },
  normal: { difficulty: 'normal', sims: 120 },
  hard: { difficulty: 'hard', sims: 240 },
};

export function budgetForDifficulty(difficulty) {
  return DIFFICULTY_BUDGET[difficulty] || DIFFICULTY_BUDGET.normal;
}

export const DEFAULT_SETTINGS = {
  power: 'england',
  difficulty: 'normal',
  // personaSpice biases how flavourful the personas play (0 = plain, 1 = spicy).
  personaSpice: 0.5,
  maxYears: 1912,
};

function clampSpice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.personaSpice;
  return Math.max(0, Math.min(1, n));
}

function sanitize(raw) {
  const settings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    if (POWER_OPTIONS.includes(raw.power)) settings.power = raw.power;
    if (DIFFICULTY_OPTIONS.includes(raw.difficulty)) settings.difficulty = raw.difficulty;
    if (raw.personaSpice != null) settings.personaSpice = clampSpice(raw.personaSpice);
    const years = Number(raw.maxYears);
    if (Number.isInteger(years) && years >= 1901 && years <= 2000) settings.maxYears = years;
  }
  return settings;
}

// Read the persisted settings, falling back to defaults for any missing or
// invalid field. Never throws.
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

// Persist a (sanitized) settings object. Never throws.
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(settings)));
  } catch (_) {
    /* ignore storage failures */
  }
}

// Build the per-power controller config from the chosen human power: the chosen
// power is 'human', the other six are 'AI'.
export function buildControllers(humanPower) {
  const controllers = {};
  for (const power of POWER_OPTIONS) {
    controllers[power] = power === humanPower ? 'human' : 'AI';
  }
  return controllers;
}
