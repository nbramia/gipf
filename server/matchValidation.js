import { decodeMatch as chess } from '../src/games/chess/matchSnapshot.js';
import { decodeMatch as yinsh } from '../src/games/yinsh/matchSnapshot.js';
import { decodeMatch as zertz } from '../src/games/zertz/matchSnapshot.js';
import { decodeMatch as catan } from '../src/games/catan/matchSnapshot.js';
import { decodeMatch as splendor } from '../src/games/splendor/matchSnapshot.js';
import { MIGRATION_LIMITS } from './migrationActivation.js';
const decoders = { chess, yinsh, zertz, catan, splendor };
// PGN replay is the costly decode, so the migration bound applies before it here too.
const boundedPgn = pgn => typeof pgn !== 'string' || (Buffer.byteLength(pgn) <= MIGRATION_LIMITS.pgnBytes &&
  (pgn.match(/[a-zA-Z0-9]+/g) || []).length <= MIGRATION_LIMITS.pgnTokens);
export function validMatch(game, value) {
  if (!Object.hasOwn(decoders, game)) return false;
  if (value === null) return true; // explicit cleared current match, still CAS protected
  if (game === 'chess' && !boundedPgn(value?.state?.pgn)) return false;
  try { decoders[game](value); return true; } catch (_) { return false; }
}
