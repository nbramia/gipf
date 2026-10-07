// Synthetic signed-in sessions for Redis contract tests. Seeds an identity (as an
// Auth0 callback would) whose progress lives under `data`, and returns a session
// cookie token for it. Use only against the disposable play-test-* container.
import { randomBytes } from 'node:crypto';
import { hash } from '../server/publicSecurity.js';
import { ensureIdentity, identityKey } from '../server/identity.js';
import { createSession } from '../server/session.js';
import { redis } from './redis-fixture.mjs';

// A fixed synthetic KEK for tests; never a production value.
export const TEST_KEK = Buffer.alloc(32, 7).toString('base64');
export function useTestKeyCustody() {
  process.env.GAMES_KEY_ENCRYPTION_KEY = TEST_KEK;
  delete process.env.GAMES_KEY_ENCRYPTION_KEY_VERSION;
  for (const name of Object.keys(process.env)) if (/^GAMES_KEY_ENCRYPTION_KEY_V\d+$/.test(name)) delete process.env[name];
}

// The synthetic identity id for a label (stable across calls).
export const identityFor = label => hash(`synthetic-identity:${label}`);

// Sign in identity `label`, whose data id is `data` (its own id when omitted).
export async function signInAs(label, data, { name = `${label}@synthetic.example`, now } = {}) {
  useTestKeyCustody();
  const i = identityFor(label);
  const { record } = await ensureIdentity(i);
  if (data && record.data !== data) redis('SET', identityKey(i), JSON.stringify({ ...record, data }));
  return createSession({ i, u: data || record.data, name }, now);
}

export const randomData = () => randomBytes(32).toString('hex');

// Headers of a same-origin request from the Games page, carrying `token` when given.
export const SAME_ORIGIN = { 'x-games-request': '1', 'sec-fetch-site': 'same-origin' };
export const cookieHeaders = token => token ? { ...SAME_ORIGIN, cookie: `__Host-games_session=${token}` } : { ...SAME_ORIGIN };

// Seed a signed-in session (data id `data`, or the identity's own) with direct Redis writes only, for scripts whose global fetch
// talks to a running fixture server rather than to Redis. Returns the cookie token.
export async function seedSession(label, data) {
  useTestKeyCustody();
  const { seal } = await import('../server/keyCustody.js');
  const { IDLE_MS } = await import('../server/session.js');
  const i = identityFor(label), now = Date.now();
  // An identity is created once, like a first Auth0 sign-in; later sessions reuse it and its seal key.
  redis('SET', identityKey(i), JSON.stringify({ v: 1, data: data || i, created: now, keys: { seal: seal(i, 'seal', randomBytes(32).toString('base64')) } }), 'NX');
  const token = randomBytes(32).toString('base64url');
  redis('SET', `play:session:v1:${hash(token)}`, JSON.stringify({ i, u: data || i, name: `${label}@synthetic.example`, created: now, seen: now }), 'PX', IDLE_MS);
  redis('SADD', `play:sessions:v1:${i}`, hash(token));
  return token;
}
