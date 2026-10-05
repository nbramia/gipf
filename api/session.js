// Games sign-in sessions. See server/session.js for storage and lifetimes, and
// api/auth/[action].js for sign-in and sign-out.
//   GET                       -> {signedIn:true, u, name, linked, keys} for a live cookie, else 401
//   POST {action:'establish'} -> the same plus `sealKey`, the account's device seal key, and
//                                `offerLink` on the sign-in that created the identity
// `keys` says only whether the Anthropic key and Lichess token are held on the account;
// neither ever leaves the server.
import { guardRequest } from '../server/publicSecurity.js';
import { resolveSession, readSessionToken, sameOriginRequest } from '../server/session.js';
import { readIdentity, keyStatus, openSlot } from '../server/identity.js';
export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!await guardRequest(req, res, { bucket: req.method === 'GET' ? 'sync' : 'account', limit: req.method === 'GET' ? 120 : 20, maxBytes: 4096 })) return;
  if (req.method === 'POST' && !sameOriginRequest(req)) return res.status(403).json({ error: 'forbidden' });
  if (req.method === 'POST' && req.body.action !== 'establish') return res.status(400).json({ error: 'bad_request' });
  try {
    const session = await resolveSession(readSessionToken(req));
    const record = session && await readIdentity(session.i);
    if (!record) return res.status(401).json({ error: 'signed_out' });
    const status = { signedIn: true, u: session.u, name: session.name, linked: !!record.linked, keys: keyStatus(record) };
    if (req.method === 'GET') return res.status(200).json(status);
    return res.status(200).json({ ...status, sealKey: openSlot(session.i, record, 'seal'), offerLink: session.fresh && !record.linked });
  } catch (_) { return res.status(503).json({ error: 'store_unavailable' }); }
}
