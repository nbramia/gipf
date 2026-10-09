// config.js
// Board variants. The default (16x16, four robots, no diagonal barriers) is the
// classic board; every other combination is opt-in.

export const DEFAULT_CONFIG = Object.freeze({ size: 16, fifthRobot: false, diagonals: false });

export const SIZES = [16, 12];

// All eight combinations, default first.
export const CONFIGS = [16, 12].flatMap(size =>
  [false, true].flatMap(fifthRobot =>
    [false, true].map(diagonals => Object.freeze({ size, fifthRobot, diagonals }))));

// Fills in missing fields with the default; throws on an unsupported size.
export function normalizeConfig(config) {
  const c = config || {};
  const size = c.size == null ? DEFAULT_CONFIG.size : c.size;
  if (!SIZES.includes(size)) throw new Error(`Unsupported board size ${size}`);
  return { size, fifthRobot: !!c.fifthRobot, diagonals: !!c.diagonals };
}

export const configKey = c => {
  const n = normalizeConfig(c);
  return `${n.size}${n.fifthRobot ? '+5' : ''}${n.diagonals ? '+diag' : ''}`;
};
