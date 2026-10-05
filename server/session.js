// Server sessions for Games accounts.
//
// A successful Auth0 sign-in (api/auth/[action].js) ends with an opaque random token
// in the `__Host-games_session` cookie. Only the token's SHA-256 is stored, at
// `gipf:session:v1:<sha256>` → {i, u, name, fresh, created, seen}: the identity
// (server/identity.js), the data id its progress is stored under, the verified email
// shown as the account name, and whether this sign-in created the identity. Sessions
// last 30 days idle and 90 days absolute. `gipf:sessions:v1:<identityId>` indexes an
// identity's sessions so they can all be revoked at once ("sign out everywhere").
// A record without an identity predates Auth0 and is refused and removed on sight.
import { randomBytes } from 'node:crypto';
import { command, hash } from './publicSecurity.js';

export const COOKIE = '__Host-games_session';
export const IDLE_MS = 30 * 86400000;
export const ABSOLUTE_MS = 90 * 86400000;
// Idle expiry is refreshed at most this often, so authenticated traffic is not a write per request.
export const TOUCH_MS = 3600000;
export const PRODUCTION_ORIGIN = 'https://play.ramia.us';
export const REQUEST_HEADER = 'x-games-request';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const sessionKey = id => `gipf:session:v1:${id}`;
const indexKey = i => `gipf:sessions:v1:${i}`;

// Scripts touch only declared KEYS, so they stay valid on any Redis deployment.
const CREATE = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('SADD', KEYS[2], ARGV[3])
if redis.call('PTTL', KEYS[2]) < tonumber(ARGV[4]) then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
return 1`;
// KEYS[1] is the index; KEYS[2..] the sessions it listed. Members added meanwhile survive.
const REVOKE = `
local n = 0
for i = 2, #KEYS do n = n + redis.call('DEL', KEYS[i]); redis.call('SREM', KEYS[1], ARGV[i - 1]) end
if redis.call('SCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return n`;

export function readSessionToken(req) {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const value = part.slice(i + 1).trim();
      return TOKEN_RE.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ABSOLUTE_MS / 1000}`;
}
export function clearedSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// CSRF boundary for every cookie-authenticated or session-changing request: JSON only
// (guardRequest), the custom header no cross-site form can set, and a same-origin
// request — Origin exactly play.ramia.us or this preview deployment, or a browser
// reporting Sec-Fetch-Site: same-origin without a conflicting Origin.
export function sameOriginRequest(req) {
  const headers = req.headers || {};
  if (headers[REQUEST_HEADER] !== '1') return false;
  const origin = headers.origin;
  const allowed = [PRODUCTION_ORIGIN];
  if (process.env.VERCEL_ENV === 'preview') {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) if (host) allowed.push(`https://${host}`);
  }
  if (origin && allowed.includes(origin)) return true;
  if (headers['sec-fetch-site'] !== 'same-origin') return false;
  return !origin || origin === `${process.env.VERCEL ? 'https' : 'http'}://${headers.host}`;
}

const HEX64 = /^[a-f0-9]{64}$/;

// A new session for identity `i`, whose progress lives under data id `u`.
export async function createSession({ i, u, name = '', fresh = false }, now = Date.now()) {
  if (!HEX64.test(i) || !HEX64.test(u)) throw new TypeError('bad_session');
  // Forget index entries whose sessions have already expired.
  const ids = await command('SMEMBERS', indexKey(i)) || [];
  if (ids.length) {
    const live = await command('MGET', ...ids.map(sessionKey));
    const dead = ids.filter((_, n) => live[n] == null);
    if (dead.length) await command('SREM', indexKey(i), ...dead);
  }
  const token = randomBytes(32).toString('base64url');
  const id = hash(token);
  const record = { i, u, name: String(name).slice(0, 254), fresh: !!fresh, created: now, seen: now };
  await command('EVAL', CREATE, 2, sessionKey(id), indexKey(i), JSON.stringify(record), IDLE_MS, id, ABSOLUTE_MS);
  return token;
}

// The live session for a cookie token, or null when it is missing, idle too long,
// or past its absolute lifetime. Expired records are removed as they are found.
export async function resolveSession(token, now = Date.now()) {
  if (!token || !TOKEN_RE.test(token)) return null;
  const id = hash(token);
  const raw = await command('GET', sessionKey(id));
  if (raw == null) return null;
  let record;
  try { record = JSON.parse(raw); } catch (_) { return null; }
  if (!HEX64.test(record?.i || '') || !HEX64.test(record.u || '')) {
    // A pre-Auth0 password session: never honoured, removed as it is found.
    await command('DEL', sessionKey(id));
    return null;
  }
  if (!Number.isFinite(record.created) || !Number.isFinite(record.seen)) return null;
  const remaining = record.created + ABSOLUTE_MS - now;
  if (remaining <= 0 || now - record.seen >= IDLE_MS) {
    await command('DEL', sessionKey(id));
    await command('SREM', indexKey(record.i), id);
    return null;
  }
  if (now - record.seen >= TOUCH_MS) {
    await command('SET', sessionKey(id), JSON.stringify({ ...record, seen: now }), 'PX', Math.min(IDLE_MS, remaining), 'XX');
  }
  return { i: record.i, u: record.u, name: typeof record.name === 'string' ? record.name : '', fresh: record.fresh === true, id };
}

export async function revokeSession(token) {
  if (!token || !TOKEN_RE.test(token)) return;
  const id = hash(token);
  const raw = await command('GET', sessionKey(id));
  await command('DEL', sessionKey(id));
  try { const i = JSON.parse(raw)?.i; if (HEX64.test(i || '')) await command('SREM', indexKey(i), id); } catch (_) { /* already gone */ }
}

// Revoke every session of identity `i`.
export async function revokeAllSessions(i) {
  const ids = await command('SMEMBERS', indexKey(i)) || [];
  if (!ids.length) return 0;
  return Number(await command('EVAL', REVOKE, 1 + ids.length, indexKey(i), ...ids.map(sessionKey), ...ids));
}
