// The key a model or Lichess proxy uses for one request.
//
// A guest's device-only key arrives in the request body and is used as is. A
// signed-in player's key never reaches the browser: with no key in the body, the
// session cookie (with the same-origin checks) selects the account, and the key is
// decrypted here for this one upstream call. Keys are never logged or returned.
import { readSessionToken, resolveSession, sameOriginRequest } from './session.js';
import { readIdentity, openSlot } from './identity.js';

// The key for `slot` ('anthropic' or 'lichess'), or null after answering the request:
// 401 missing_api_key with neither a body key nor a key on the account, 403 for a
// cross-site cookie request, 503 when the store or key custody is unavailable.
export async function requestKey(req, res, body, slot, bodyField) {
  const supplied = body[bodyField];
  if (typeof supplied === 'string' && supplied) return supplied;
  const token = readSessionToken(req);
  if (token) {
    if (!sameOriginRequest(req)) { res.status(403).json({ error: 'forbidden' }); return null; }
    try {
      const session = await resolveSession(token);
      const record = session && await readIdentity(session.i);
      const key = record ? openSlot(session.i, record, slot) : '';
      if (key) return key;
    } catch (_) {
      res.status(503).json({ error: 'key_unavailable', message: 'Your saved key is unavailable right now. Try again.' });
      return null;
    }
  }
  res.status(401).json({ error: 'missing_api_key', message: 'No API key provided.' });
  return null;
}
