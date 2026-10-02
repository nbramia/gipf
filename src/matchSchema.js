// Shared wire envelope only; engines stay isolated in their own game directories.
export const MATCH_GAMES = ['chess', 'yinsh', 'zertz', 'catan'];
export const MAX_MATCH_BYTES = 240000;
export function validateMatch(value, game) {
  if (!MATCH_GAMES.includes(game) || !value || value.v !== 1 || value.game !== game ||
      typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) ||
      !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 ||
      !value.state || typeof value.state !== 'object' || Array.isArray(value.state) ||
      !value.ui || typeof value.ui !== 'object' || Array.isArray(value.ui)) return false;
  if (Object.keys(value).some(k => !['v', 'game', 'id', 'updatedAt', 'state', 'ui'].includes(k))) return false;
  const serialized = JSON.stringify(value);
  if (encodeURIComponent(serialized).replace(/%[A-F0-9]{2}/g, 'x').length > MAX_MATCH_BYTES) return false;
  // Secrets are never a match field, including inside nested imported objects.
  const forbidden = /^(?:authToken|aesKey|profileId|apiKey|encLichess|enc|password|gipfAccount|lichessToken|__proto__|constructor|prototype)$/i;
  const walk = (v, depth = 0) => {
    if (depth > 24) return false;
    if (!v || typeof v !== 'object') return typeof v !== 'number' || Number.isFinite(v);
    return Object.entries(v).every(([k, child]) => !forbidden.test(k) && walk(child, depth + 1));
  };
  return walk(value);
}
