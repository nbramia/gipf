// The signed-in account's keys. Needs the session cookie and the same-origin checks.
//   {action:'setKeys', anthropic?, lichess?}  string sets, null clears, omitted keeps.
//        The plaintext arrives over TLS and is stored only as server-encrypted
//        ciphertext (server/keyCustody.js). Returns which keys are held, never a key.
import { guardRequest, authenticate, limit } from '../server/publicSecurity.js';
import { updateKeys, keyStatus, validSecret } from '../server/identity.js';
export const config = { api: { bodyParser: { sizeLimit: '12kb' } } };

// A secret field: undefined (unchanged), null (clear) or a plausible secret string.
const secretField = value => value === undefined || value === null || validSecret(value);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!await guardRequest(req, res, { bucket: 'account', limit: 20, maxBytes: 12288 })) return;
  const { action, anthropic, lichess } = req.body;
  if (action !== 'setKeys' || !secretField(anthropic) || !secretField(lichess)) return res.status(400).json({ error: 'bad_request' });
  if (anthropic === undefined && lichess === undefined) return res.status(400).json({ error: 'bad_request' });
  try {
    const session = await authenticate(req.body, res, req);
    if (!session) return;
    if (!await limit('account-user', session.i, 20)) return res.status(429).json({ error: 'rate_limited' });
    const record = await updateKeys(session.i, { anthropic, lichess });
    if (!record) return res.status(401).json({ error: 'signed_out' });
    return res.status(200).json({ saved: true, keys: keyStatus(record) });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}
