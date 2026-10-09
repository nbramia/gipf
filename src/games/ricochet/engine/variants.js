// variants.js — the player's chosen board variant and the key that names a rating setup.
// A setup is the board variant plus the input mode: the standard setup (16 by 16, four
// robots, no barriers, Plan mode) keeps the original rating and history keys; every other
// combination gets a stable key such as "16-r4-d0-live" with a rating of its own.

import { DEFAULT_CONFIG, SIZES } from './config.js';

export const VARIANT_KEY = 'ricochetVariant';
export const VARIANT_RATINGS_KEY = 'ricochetVariantRatings';

// <size>-r<robots>-d<diagonals>-<mode>; the standard setup (16-r4-d0-plan) has no key.
const KEY_RE = /^(16|12)-r(4|5)-d(0|1)-(plan|live)$/;
const STANDARD = '16-r4-d0-plan';

export const isVariantKey = k => typeof k === 'string' && KEY_RE.test(k) && k !== STANDARD;

// Strict: only the three known fields with the right types, else the default.
export function parseVariant(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      SIZES.includes(v.size) && typeof v.fifthRobot === 'boolean' && typeof v.diagonals === 'boolean'
    ) {
      return { size: v.size, fifthRobot: v.fifthRobot, diagonals: v.diagonals };
    }
  } catch {
    // fall through to the default
  }
  return { ...DEFAULT_CONFIG };
}

export function readVariant() {
  try { return parseVariant(localStorage.getItem(VARIANT_KEY)); } catch { return { ...DEFAULT_CONFIG }; }
}

export function writeVariant(config) {
  try { localStorage.setItem(VARIANT_KEY, JSON.stringify(parseVariant(config))); } catch { /* unavailable */ }
}

export const sameVariant = (a, b) => a.size === b.size && a.fifthRobot === b.fifthRobot && a.diagonals === b.diagonals;

// null for the standard setup (the original rating and history keys), else the setup key.
export function setupKey(config, mode) {
  const c = parseVariant(config);
  const key = `${c.size}-r${c.fifthRobot ? 5 : 4}-d${c.diagonals ? 1 : 0}-${mode === 'live' ? 'live' : 'plan'}`;
  return key === STANDARD ? null : key;
}

// Compact name for the HUD, for example "12×12 · Black · Barriers · Live"; '' for the standard setup.
export function setupShortLabel(key) {
  const m = key ? KEY_RE.exec(key) : null;
  if (!m) return '';
  const parts = [];
  if (m[1] === '12') parts.push('12×12');
  if (m[2] === '5') parts.push('Black');
  if (m[3] === '1') parts.push('Barriers');
  if (m[4] === 'live') parts.push('Live');
  return parts.join(' · ') || 'Plan';
}

// Human name of a setup: null is the standard one.
export function setupLabel(key) {
  const m = key ? KEY_RE.exec(key) : null;
  if (!m) return 'Standard';
  const parts = [`${m[1]}×${m[1]}`];
  if (m[2] === '5') parts.push('black robot');
  if (m[3] === '1') parts.push('barriers');
  parts.push(m[4] === 'live' ? 'Live' : 'Plan');
  return parts.join(', ');
}
