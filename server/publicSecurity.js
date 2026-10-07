// Shared public API boundary. Redis counters are atomic across cold starts.
import { createHash } from 'node:crypto';
import { readSessionToken, resolveSession, sameOriginRequest } from './session.js';
export const hex64 = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export const hash = (s) => createHash('sha256').update(s).digest('hex');
async function send(args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('store_unavailable');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error('store_unavailable');
  const data = await r.json();
  if (data.error) throw new Error('store_unavailable');
  return data.result;
}
// Keys moved from the legacy `gipf:` prefix to `play:`. Until every stored key has been
// renamed, a command that names a `play:` key first moves a still-legacy predecessor into
// place (RENAME keeps its TTL), so reads find old data and writes land only under `play:`.
// Rate-limit counters are left out: they are short-lived and safe to start again.
const LEGACY_PREFIX = 'gipf:';
const ADOPT = "for i=1,#KEYS,2 do if redis.call('EXISTS',KEYS[i])==0 and redis.call('EXISTS',KEYS[i+1])==1 then redis.call('RENAME',KEYS[i+1],KEYS[i]) end end return 0";
export function legacyKeyPairs(args) {
  if (String(args[0]).toUpperCase() === 'SCAN') return [];
  const keys = [...new Set(args.filter(a => typeof a === 'string' && /^play:[a-z-]+:/.test(a) && !a.startsWith('play:limit:')))];
  return keys.flatMap(k => [k, LEGACY_PREFIX + k.slice('play:'.length)]);
}
export async function command(...args) {
  const pairs = legacyKeyPairs(args);
  if (pairs.length) await send(['EVAL', ADOPT, pairs.length, ...pairs]);
  return send(args);
}
export async function read(key) {
  const value = await command('GET', key);
  return value == null ? null : JSON.parse(value);
}
const LIMIT_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
export async function limit(bucket, identity, maximum, seconds = 60) {
  const n = await command('EVAL', LIMIT_SCRIPT, 1, `play:limit:${bucket}:${hash(identity)}`, seconds);
  return Number.isFinite(Number(n)) && Number(n) <= maximum;
}
// One IPv6 subscriber controls a whole /64, so it is one network; IPv4 stays per address.
export function networkIdentity(ip) {
  const s = String(ip || 'unknown').trim().split('%')[0];
  if (!s.includes(':')) return s;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const [head, tail] = s.split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map(g => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}
export async function guardRequest(req, res, { bucket = 'public', limit: maximum = 60, maxBytes = 32768 } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  // JSON bodies only: a cross-site form or no-cors fetch can send text/plain, never JSON.
  if (req.method === 'POST' && !/^application\/json\s*(;|$)/i.test(String(req.headers?.['content-type'] || ''))) {
    res.status(415).json({ error: 'unsupported_media_type' }); return false;
  }
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw) > maxBytes) { res.status(413).json({ error: 'too_large' }); return false; }
    try { req.body = JSON.parse(raw); } catch (_) { res.status(400).json({ error: 'bad_request' }); return false; }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) { res.status(400).json({ error: 'bad_request' }); return false; }
    // Vercel overwrites x-vercel-forwarded-for. Never trust caller x-forwarded-for.
    const ip = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
    req.network = networkIdentity(ip);
    if (!(await limit(bucket, req.network, maximum))) {
      res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'rate_limited' }); return false;
    }
    return true;
  } catch (_) { res.status(503).json({ error: 'service_unavailable' }); return false; }
}
// The signed-in session for a request, or null after answering it. Only the session
// cookie authorizes: the request must pass the same-origin checks. A body that names an
// account `u` must name the session's own, so a tab still showing another account
// cannot write into this one. On success `body.u` is the session's data id.
export async function authenticate(body, res, req) {
  const token = readSessionToken(req);
  if (!token) { res.status(401).json({ error: 'signed_out' }); return null; }
  if (!sameOriginRequest(req)) { res.status(403).json({ error: 'forbidden' }); return null; }
  const session = await resolveSession(token);
  if (!session || (body.u !== undefined && body.u !== session.u)) { res.status(401).json({ error: 'bad_credentials' }); return null; }
  body.u = session.u;
  return session;
}
