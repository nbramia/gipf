// Games sign-in sessions. See server/session.js for storage and lifetimes.
//   GET                                -> {signedIn:true, u} for a live cookie, else 401
//   POST {action:'create', u, auth}    -> verifies the password-derived token once, sets the cookie,
//                                         returns the encrypted key envelopes
//   POST {action:'logout'}             -> revokes this session and clears the cookie
//   POST {action:'logout-all'}         -> revokes every session of the signed-in account
import { guardRequest, authenticate, limit } from '../server/publicSecurity.js';
import { createSession, resolveSession, revokeSession, revokeAllSessions, readSessionToken, sameOriginRequest, sessionCookie, clearedSessionCookie } from '../server/session.js';
export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!await guardRequest(req, res, { bucket: req.method === 'GET' ? 'sync' : 'account', limit: req.method === 'GET' ? 120 : 20, maxBytes: 4096 })) return;
  try {
    if (req.method === 'GET') {
      const session = await resolveSession(readSessionToken(req));
      if (!session) return res.status(401).json({ error: 'signed_out' });
      return res.status(200).json({ signedIn: true, u: session.u });
    }
    if (!sameOriginRequest(req)) return res.status(403).json({ error: 'forbidden' });
    const { action } = req.body;
    if (action === 'create') {
      if (req.body.auth === undefined) return res.status(400).json({ error: 'bad_request' });
      const record = await authenticate(req.body, res, req.network);
      if (!record) return;
      if (!await limit('account-user', req.body.u, 20)) return res.status(429).json({ error: 'rate_limited' });
      const previous = readSessionToken(req);
      if (previous) await revokeSession(previous);
      res.setHeader('Set-Cookie', sessionCookie(await createSession(req.body.u)));
      return res.status(200).json({ configured: true, signedIn: true, enc: record.enc || null, encLichess: record.encLichess || null });
    }
    if (action === 'logout') {
      await revokeSession(readSessionToken(req));
      res.setHeader('Set-Cookie', clearedSessionCookie());
      return res.status(200).json({ signedOut: true });
    }
    if (action === 'logout-all') {
      const session = await resolveSession(readSessionToken(req));
      if (!session) return res.status(401).json({ error: 'signed_out' });
      const revoked = await revokeAllSessions(session.u);
      res.setHeader('Set-Cookie', clearedSessionCookie());
      return res.status(200).json({ signedOut: true, revoked });
    }
    return res.status(400).json({ error: 'bad_request' });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}
