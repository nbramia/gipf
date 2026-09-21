import { decodeMatch as chess } from '../src/games/chess/matchSnapshot.js';
import { decodeMatch as yinsh } from '../src/games/yinsh/matchSnapshot.js';
import { decodeMatch as zertz } from '../src/games/zertz/matchSnapshot.js';
import { decodeMatch as catan } from '../src/games/catan/matchSnapshot.js';
const decoders = { chess, yinsh, zertz, catan };
export function validMatch(game, value) {
  if (!Object.hasOwn(decoders, game)) return false;
  if (value === null) return true; // explicit cleared current match, still CAS protected
  try { decoders[game](value); return true; } catch (_) { return false; }
}
