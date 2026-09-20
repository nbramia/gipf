// Shared public API boundary. Redis counters are atomic across cold starts.
import { createHash, timingSafeEqual } from 'node:crypto';
export const hex64 = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export const hash = (s) => createHash('sha256').update(s).digest('hex');
export async function command(...args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('store_unavailable');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error('store_unavailable');
  const data = await r.json();
  if (data.error) throw new Error('store_unavailable');
  return data.result;
}
export async function read(key) {
  const value = await command('GET', key);
  return value == null ? null : JSON.parse(value);
}
const LIMIT_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
export async function limit(bucket, identity, maximum, seconds = 60) {
  const n = await command('EVAL', LIMIT_SCRIPT, 1, `gipf:limit:${bucket}:${hash(identity)}`, seconds);
  return Number.isFinite(Number(n)) && Number(n) <= maximum;
}
export async function guardRequest(req, res, { bucket = 'public', limit: maximum = 60, maxBytes = 32768 } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw) > maxBytes) { res.status(413).json({ error: 'too_large' }); return false; }
    try { req.body = JSON.parse(raw); } catch (_) { res.status(400).json({ error: 'bad_request' }); return false; }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) { res.status(400).json({ error: 'bad_request' }); return false; }
    // Vercel overwrites x-vercel-forwarded-for. Never trust caller x-forwarded-for.
    const ip = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
    if (!(await limit(bucket, String(ip || 'unknown'), maximum))) {
      res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'rate_limited' }); return false;
    }
    return true;
  } catch (_) { res.status(503).json({ error: 'service_unavailable' }); return false; }
}
export async function authenticate(body, res) {
  if (!hex64(body.u) || !hex64(body.auth)) { res.status(401).json({ error: 'bad_credentials' }); return null; }
  const record = await read(`chess:account:${body.u}`);
  if (!hex64(record?.authHash) || !timingSafeEqual(Buffer.from(hash(body.auth), 'hex'), Buffer.from(record.authHash, 'hex'))) {
    res.status(401).json({ error: 'bad_credentials' }); return null;
  }
  return record;
}
