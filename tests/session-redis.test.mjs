// Server sessions against real Redis. Use only the disposable synthetic container.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import session from '../api/session.js';
import auth from '../api/auth.js';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
import { COOKIE, IDLE_MS, ABSOLUTE_MS, TOUCH_MS, createSession, resolveSession, revokeAllSessions } from '../server/session.js';
import { signInAs, identityFor } from './session-fixture.mjs';

const u = 'a'.repeat(64), other = 'c'.repeat(64);
const SAME = { 'x-games-request': '1', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3187', host: '127.0.0.1:3187' };
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, body, { method = 'POST', headers = SAME, cookie, ip = '192.0.2.1', contentType = 'application/json', query } = {}) {
  const res = response();
  const all = { ...headers, ...(contentType ? { 'content-type': contentType } : {}), ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) };
  await handler({ method, headers: all, socket: { remoteAddress: ip }, body, query }, res);
  return res;
}
const logout = (body, options = {}) => call(auth, body, { ...options, query: { action: 'logout' } });
const signIn = (label = 'owner', data = u) => signInAs(label, data);

beforeEach(() => {
  redis('FLUSHDB');
  delete process.env.VERCEL; delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL;
  process.env.KV_REST_API_URL = 'https://synthetic.invalid'; process.env.KV_REST_API_TOKEN = 'synthetic';
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ result: await redisAsync(...JSON.parse(options.body)) }) });
});

test('a session stores only its token hash, indexed by identity, and GET reports the signed-in account', async () => {
  const token = await signIn();
  assert.equal(redis('EXISTS', `gipf:session:v1:${token}`), 0);
  const stored = JSON.parse(redis('GET', `gipf:session:v1:${hash(token)}`));
  assert.deepEqual([stored.i, stored.u], [identityFor('owner'), u]);
  assert.deepEqual(redis('SMEMBERS', `gipf:sessions:v1:${identityFor('owner')}`), [hash(token)]);
  const ttl = redis('PTTL', `gipf:session:v1:${hash(token)}`);
  assert.ok(ttl > IDLE_MS - 60000 && ttl <= IDLE_MS);
  const status = await call(session, {}, { method: 'GET', cookie: token, contentType: null, headers: {} });
  assert.equal(status.statusCode, 200);
  assert.deepEqual({ ...status.body, name: undefined }, { signedIn: true, u, name: undefined, linked: true, keys: { anthropic: false, lichess: false } });
  assert.equal((await call(session, {}, { method: 'GET', contentType: null, headers: {} })).statusCode, 401);
});

test('a pre-Auth0 password session is refused and removed', async () => {
  const token = 'p'.repeat(43);
  redis('SET', `gipf:session:v1:${hash(token)}`, JSON.stringify({ u, created: Date.now(), seen: Date.now() }), 'PX', IDLE_MS);
  assert.equal((await call(profile, { action: 'read' }, { cookie: token })).statusCode, 401);
  assert.equal((await call(session, {}, { method: 'GET', cookie: token, contentType: null, headers: {} })).statusCode, 401);
  assert.equal(redis('EXISTS', `gipf:session:v1:${hash(token)}`), 0);
  assert.equal((await call(session, { action: 'create', u, auth: 'b'.repeat(64) })).statusCode, 400);
});

test('the cookie authorizes account and profile requests; a mismatched u is refused', async () => {
  const token = await signIn();
  assert.equal((await call(account, { action: 'setKeys', lichess: null }, { cookie: token })).statusCode, 200);
  const read = await call(profile, { action: 'read', u }, { cookie: token });
  assert.equal(read.statusCode, 200);
  const write = await call(profile, { action: 'write', scope: 'settings', revision: 0, domains: { preferences: { chessDarkMode: 'true' } } }, { cookie: token });
  assert.equal(write.statusCode, 200);
  assert.ok(redis('EXISTS', `gipf:settings:v2:${u}`));
  assert.equal((await call(profile, { action: 'read', u: other }, { cookie: token })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' }, { cookie: 'x'.repeat(43) })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read', u, auth: 'b'.repeat(64) }, { headers: {} })).statusCode, 401, 'body credentials no longer authorize');
});

test('CSRF: cookie requests need the custom header, a same-origin request, and a JSON body', async () => {
  const token = await signIn();
  const cases = [
    [{ ...SAME, 'x-games-request': undefined }, 'missing custom header'],
    [{ ...SAME, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, 'cross-site origin'],
    [{ ...SAME, origin: 'https://evil.example' }, 'foreign origin claiming same-origin'],
    [{ 'x-games-request': '1', 'sec-fetch-site': 'cross-site', host: SAME.host }, 'cross-site without origin'],
    [{ 'x-games-request': '1', host: SAME.host }, 'no origin and no fetch metadata'],
    [{ 'x-games-request': '1', origin: 'https://play.ramia.us.evil.example', host: SAME.host }, 'lookalike origin'],
  ];
  for (const [n, [headers, label]] of cases.entries()) {
    for (const [handler, body, query] of [[profile, { action: 'read' }], [account, { action: 'setKeys', lichess: null }], [session, { action: 'establish' }], [auth, {}, { action: 'logout' }], [auth, { everywhere: true }, { action: 'logout' }]]) {
      const res = await call(handler, body, { headers, cookie: token, query, ip: `198.51.100.${n + 1}` });
      assert.equal(res.statusCode, 403, `${label}: ${JSON.stringify(res.body)}`);
    }
  }
  const plain = await call(profile, JSON.stringify({ action: 'read' }), { cookie: token, contentType: 'text/plain' });
  assert.equal(plain.statusCode, 415);
  const form = await logout('everywhere=true', { cookie: token, contentType: 'application/x-www-form-urlencoded' });
  assert.equal(form.statusCode, 415);
  assert.equal((await call(profile, { action: 'read' }, { cookie: token })).statusCode, 200);
});

test('production and preview origins are accepted exactly', async () => {
  const token = await signIn();
  const prod = { 'x-games-request': '1', origin: 'https://play.ramia.us', host: 'play.ramia.us' };
  assert.equal((await call(profile, { action: 'read' }, { headers: prod, cookie: token })).statusCode, 200);
  const preview = { 'x-games-request': '1', origin: 'https://play-abc123-nathan-ramias-projects.vercel.app', host: 'play-abc123-nathan-ramias-projects.vercel.app' };
  assert.equal((await call(profile, { action: 'read' }, { headers: preview, cookie: token })).statusCode, 403);
  process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_URL = 'play-abc123-nathan-ramias-projects.vercel.app';
  assert.equal((await call(profile, { action: 'read' }, { headers: preview, cookie: token })).statusCode, 200);
  process.env.VERCEL_ENV = 'production';
  assert.equal((await call(profile, { action: 'read' }, { headers: preview, cookie: token })).statusCode, 403);
});

test('idle and absolute expiry', async () => {
  const i = identityFor('owner');
  const start = Date.now();
  const idle = await createSession({ i, u }, start);
  assert.ok(await resolveSession(idle, start + IDLE_MS - 1));
  // The previous resolve refreshed the idle window.
  assert.ok(await resolveSession(idle, start + 2 * IDLE_MS - 2));
  assert.equal(await resolveSession(idle, start + 3 * IDLE_MS), null);
  assert.equal(redis('EXISTS', `gipf:session:v1:${hash(idle)}`), 0);
  assert.ok(!redis('SMEMBERS', `gipf:sessions:v1:${i}`).includes(hash(idle)));

  const busy = await createSession({ i, u }, start);
  for (let t = start; t < start + ABSOLUTE_MS; t += IDLE_MS / 2) assert.ok(await resolveSession(busy, t), 'active use stays signed in until the absolute limit');
  assert.equal(await resolveSession(busy, start + ABSOLUTE_MS), null);

  const quiet = await createSession({ i, u }, start);
  await resolveSession(quiet, start + TOUCH_MS - 1);
  assert.equal(JSON.parse(redis('GET', `gipf:session:v1:${hash(quiet)}`)).seen, start, 'reads inside the touch interval do not write');
});

test('logout revokes this session and clears the cookie; other sessions stay', async () => {
  const one = await signIn(), two = await signIn();
  const res = await logout({}, { cookie: one });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], new RegExp(`^${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$`));
  assert.equal((await call(profile, { action: 'read' }, { cookie: one })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' }, { cookie: two })).statusCode, 200);
  assert.deepEqual(redis('SMEMBERS', `gipf:sessions:v1:${identityFor('owner')}`), [hash(two)]);
});

test('sign out everywhere revokes every session of that identity only', async () => {
  const mine = [await signIn(), await signIn(), await signIn()];
  const theirs = await signIn('other', other);
  const res = await logout({ everywhere: true }, { cookie: mine[0] });
  assert.deepEqual([res.statusCode, res.body.revoked], [200, 3]);
  for (const token of mine) assert.equal((await call(profile, { action: 'read' }, { cookie: token })).statusCode, 401);
  assert.equal(redis('EXISTS', `gipf:sessions:v1:${identityFor('owner')}`), 0);
  assert.equal((await call(profile, { action: 'read' }, { cookie: theirs })).statusCode, 200);
  assert.equal((await logout({ everywhere: true }, { cookie: mine[0] })).statusCode, 401);
  assert.equal(await revokeAllSessions(identityFor('owner')), 0);
});

test('expired index entries are pruned when a new session starts', async () => {
  const old = await signIn();
  redis('DEL', `gipf:session:v1:${hash(old)}`);
  const fresh = await signIn();
  assert.deepEqual(redis('SMEMBERS', `gipf:sessions:v1:${identityFor('owner')}`), [hash(fresh)]);
});
