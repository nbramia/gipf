// The signed-in account's keys, and the one-time link of a pre-Auth0 games account.
// Every action needs the session cookie and the same-origin checks.
//   {action:'setKeys', anthropic?, lichess?}  string sets, null clears, omitted keeps.
//        The plaintext arrives over TLS and is stored only as server-encrypted
//        ciphertext (server/keyCustody.js). Returns which keys are held, never a key.
//   {action:'link-verify', u, auth}  proves the old account's password-derived token and
//        returns its client-encrypted envelopes {enc, encLichess} for the browser to open.
//   {action:'link', u, auth, sealKey, anthropic?, lichess?}  proves the token again and
//        links that account to this identity: its progress is used in place, its keys
//        fill the slots this account has not set, and `sealKey` (the old password-derived
//        AES key) becomes the seal key for its device recovery copies. Every session of
//        the identity is revoked and this one is reissued on the linked data.
// Creating username/password accounts and signing in with them are retired (410).
import { guardRequest, authenticate, verifyLegacyAccount, command, hex64, limit } from '../server/publicSecurity.js';
import { readIdentity, updateKeys, linkLegacy, linkKey, keyStatus, validSecret } from '../server/identity.js';
import { createSession, revokeAllSessions, sessionCookie } from '../server/session.js';
export const config = { api: { bodyParser: { sizeLimit: '12kb' } } };
const SEAL_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

// A secret field: undefined (unchanged), null (clear) or a plausible secret string.
const secretField = value => value === undefined || value === null || validSecret(value);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!await guardRequest(req, res, { bucket: 'account', limit: 20, maxBytes: 12288 })) return;
  const { action, anthropic, lichess } = req.body;
  if (['create', 'login', 'setKey'].includes(action)) return res.status(410).json({ error: 'retired' });
  if (!['setKeys', 'link-verify', 'link'].includes(action) || !secretField(anthropic) || !secretField(lichess)) return res.status(400).json({ error: 'bad_request' });
  try {
    // Authorization is the cookie alone; `u` in a link names the old account.
    const legacy = { u: req.body.u, auth: req.body.auth };
    delete req.body.u;
    const session = await authenticate(req.body, res, req.network, req);
    if (!session) return;
    if (!await limit('account-user', session.i, 20)) return res.status(429).json({ error: 'rate_limited' });
    if (action === 'setKeys') {
      if (anthropic === undefined && lichess === undefined) return res.status(400).json({ error: 'bad_request' });
      const record = await updateKeys(session.i, { anthropic, lichess });
      if (!record) return res.status(401).json({ error: 'signed_out' });
      return res.status(200).json({ saved: true, keys: keyStatus(record) });
    }
    if (!hex64(legacy.u) || !hex64(legacy.auth)) return res.status(400).json({ error: 'bad_request' });
    if (action === 'link' && (!SEAL_KEY_RE.test(req.body.sealKey || '') || anthropic === null || lichess === null)) return res.status(400).json({ error: 'bad_request' });
    const identity = await readIdentity(session.i);
    if (!identity) return res.status(401).json({ error: 'signed_out' });
    if (identity.linked) return res.status(409).json({ error: 'identity_linked' });
    const account = await verifyLegacyAccount(legacy.u, legacy.auth, res, req.network);
    if (!account) return;
    if (await command('EXISTS', linkKey(legacy.u))) return res.status(409).json({ error: 'account_linked' });
    if (action === 'link-verify') return res.status(200).json({ verified: true, enc: account.enc || null, encLichess: account.encLichess || null });
    const linked = await linkLegacy(session.i, legacy.u, { anthropic, lichess, sealKey: req.body.sealKey });
    if (linked.error) return res.status(409).json({ error: linked.error });
    // The link changes which data this identity's sessions name: reissue them.
    await revokeAllSessions(session.i);
    res.setHeader('Set-Cookie', sessionCookie(await createSession({ i: session.i, u: legacy.u, name: session.name })));
    return res.status(200).json({ linked: true, u: legacy.u, keys: keyStatus(linked.record) });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}
