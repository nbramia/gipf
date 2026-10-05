// Rewrap every Games identity's server-encrypted keys under the current KEK.
//
// Rotation (docs/public-accounts.md, "Key custody"): add the new KEK as
// GAMES_KEY_ENCRYPTION_KEY with a higher GAMES_KEY_ENCRYPTION_KEY_VERSION, keep the
// old one readable as GAMES_KEY_ENCRYPTION_KEY_V<old>, deploy, run this with the same
// variables and the store's KV_REST_API_URL / KV_REST_API_TOKEN, then remove the old KEK.
// Prints counts only, never a key or an identity.
import { command } from '../server/publicSecurity.js';
import { rewrapIdentity } from '../server/identity.js';
import { keyring } from '../server/keyCustody.js';

const ring = keyring();
let cursor = '0', seen = 0, rewrapped = 0;
do {
  const [next, keys] = await command('SCAN', cursor, 'MATCH', 'gipf:identity:v1:*', 'COUNT', 200);
  cursor = String(next);
  for (const key of keys) {
    seen++;
    if (await rewrapIdentity(key.slice('gipf:identity:v1:'.length), ring)) rewrapped++;
  }
} while (cursor !== '0');
console.log(`identities: ${seen}, rewrapped to v${ring.current}: ${rewrapped}`);
