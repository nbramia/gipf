// Existing PBKDF2/AES-GCM credentials are unchanged; only the verifier is stored.
import { guardRequest, authenticate, command, hash, hex64, limit } from '../server/publicSecurity.js';
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
export const config = { api: { bodyParser: { sizeLimit: '12kb' } } };
function isValidEncShape(enc) {
  if (!enc || typeof enc !== 'object') return false;
  const { iv, ct } = enc;
  if (typeof iv !== 'string' || iv.length === 0 || iv.length > 32 || !BASE64_RE.test(iv)) return false;
  if (typeof ct !== 'string' || ct.length === 0 || ct.length > 4096 || !BASE64_RE.test(ct)) return false;
  return Buffer.from(iv, 'base64').length === 12 && Buffer.from(ct, 'base64').length >= 16;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!await guardRequest(req, res, { bucket: 'account', limit: 20, maxBytes: 12288 })) return;
  const { action, u, auth, enc, encLichess } = req.body;
  if (!hex64(u) || !hex64(auth)) return res.status(400).json({ error: 'bad_request' });
  if (![enc, encLichess].every(v => v === undefined || v === null || isValidEncShape(v))) return res.status(400).json({ error: 'bad_request' });
  try {
    if (action === 'create') {
      if (enc === undefined) return res.status(400).json({ error: 'bad_request' });
      const result = await command('SET', `chess:account:${u}`, JSON.stringify({ authHash: hash(auth), enc: enc || null, encLichess: encLichess || null, createdAt: Date.now() }), 'NX');
      if (result !== 'OK') return res.status(409).json({ error: 'taken' });
      return res.status(200).json({ configured: true, created: true });
    }
    const record = await authenticate(req.body, res);
    if (!record) return;
    // Public usernames cannot spend an authenticated owner's budget.
    // The pre-auth network counter still bounds password guesses and store work.
    if (!await limit('account-user', u, 20)) return res.status(429).json({ error: 'rate_limited' });
    if (action === 'login') return res.status(200).json({ configured: true, enc: record.enc || null, encLichess: record.encLichess || null });
    if (action === 'setKey') {
      if (enc === undefined && encLichess === undefined) return res.status(400).json({ error: 'bad_request' });
      // Update only supplied envelopes atomically; concurrent devices cannot erase the other envelope.
      await command('EVAL', `local r=cjson.decode(redis.call('GET',KEYS[1])); local p=cjson.decode(ARGV[1]); for k,v in pairs(p) do r[k]=v end; redis.call('SET',KEYS[1],cjson.encode(r)); return 1`, 1, `chess:account:${u}`, JSON.stringify({ enc, encLichess }));
      return res.status(200).json({ configured: true, saved: true });
    }
    return res.status(400).json({ error: 'bad_request' });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}
