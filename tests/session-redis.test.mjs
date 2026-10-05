// Server sessions against real Redis. Use only the disposable synthetic container.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import session from '../api/session.js';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
import { COOKIE, IDLE_MS, ABSOLUTE_MS, TOUCH_MS, createSession, resolveSession, revokeAllSessions } from '../server/session.js';

const u = 'a'.repeat(64), auth = 'b'.repeat(64), other = 'c'.repeat(64), otherAuth = 'e'.repeat(64);
const enc = { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA==' };
const SAME = { 'x-games-request': '1', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3187', host: '127.0.0.1:3187' };
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
async function call(handler, body, { method = 'POST', headers = SAME, cookie, ip = '192.0.2.1', contentType = 'application/json' } = {}) {
  const res = response();
  const all = { ...headers, ...(contentType ? { 'content-type': contentType } : {}), ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) };
  await handler({ method, headers: all, socket: { remoteAddress: ip }, body }, res);
  return res;
}
const tokenFrom = res => res.headers['set-cookie']?.match(new RegExp(`^${COOKIE}=([^;]*)`))?.[1];
async function signIn(user = u, secret = auth) {
  const res = await call(session, { action: 'create', u: user, auth: secret });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return tokenFrom(res);
}

beforeEach(() => {
  redis('FLUSHDB');
  delete process.env.VERCEL; delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL;
  process.env.KV_REST_API_URL = 'https://synthetic.invalid'; process.env.KV_REST_API_TOKEN = 'synthetic';
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ result: await redisAsync(...JSON.parse(options.body)) }) });
  redis('SET', `chess:account:${u}`, JSON.stringify({ authHash: hash(auth), enc, encLichess: enc }));
  redis('SET', `chess:account:${other}`, JSON.stringify({ authHash: hash(otherAuth) }));
});

test('create verifies the token once, sets a host-only HttpOnly Secure Lax cookie, and stores only its hash', async () => {
  const res = await call(session, { action: 'create', u, auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.enc, res.body.encLichess], [enc, enc]);
  const cookie = res.headers['set-cookie'];
  assert.match(cookie, new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ABSOLUTE_MS / 1000}$`));
  assert.ok(!/Domain=/i.test(cookie));
  const token = tokenFrom(res);
  assert.equal(redis('EXISTS', `gipf:session:v1:${token}`), 0);
  const stored = JSON.parse(redis('GET', `gipf:session:v1:${hash(token)}`));
  assert.equal(stored.u, u);
  assert.deepEqual(redis('SMEMBERS', `gipf:sessions:v1:${u}`), [hash(token)]);
  const ttl = redis('PTTL', `gipf:session:v1:${hash(token)}`);
  assert.ok(ttl > IDLE_MS - 60000 && ttl <= IDLE_MS);
  const status = await call(session, {}, { method: 'GET', cookie: token, contentType: null, headers: {} });
  assert.deepEqual([status.statusCode, status.body], [200, { signedIn: true, u }]);
});

test('a wrong token creates no session and spends the shared failure budget', async () => {
  const res = await call(session, { action: 'create', u, auth: 'f'.repeat(64) });
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.equal(redis('GET', `gipf:limit:auth-fail:${hash('192.0.2.1')}`), '1');
});

test('the cookie authorizes account and profile requests; a mismatched u is refused', async () => {
  const token = await signIn();
  const login = await call(account, { action: 'login' }, { cookie: token });
  assert.deepEqual([login.statusCode, login.body.enc], [200, enc]);
  assert.equal((await call(account, { action: 'setKey', enc: null }, { cookie: token })).statusCode, 200);
  assert.equal(JSON.parse(redis('GET', `chess:account:${u}`)).enc, null);
  const read = await call(profile, { action: 'read', u }, { cookie: token });
  assert.equal(read.statusCode, 200);
  const write = await call(profile, { action: 'write', scope: 'settings', revision: 0, domains: { preferences: { chessDarkMode: 'true' } } }, { cookie: token });
  assert.equal(write.statusCode, 200);
  assert.ok(redis('EXISTS', `gipf:settings:v2:${u}`));
  assert.equal((await call(profile, { action: 'read', u: other }, { cookie: token })).statusCode, 401);
  assert.equal((await call(account, { action: 'setKey', u: other, enc: null }, { cookie: token })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' }, { cookie: 'x'.repeat(43) })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' })).statusCode, 401);
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
  for (const [headers, label] of cases) {
    for (const [handler, body] of [[profile, { action: 'read' }], [account, { action: 'setKey', enc: null }], [session, { action: 'logout' }], [session, { action: 'logout-all' }]]) {
      const res = await call(handler, body, { headers, cookie: token });
      assert.equal(res.statusCode, 403, `${label}: ${JSON.stringify(res.body)}`);
    }
  }
  const plain = await call(profile, JSON.stringify({ action: 'read' }), { cookie: token, contentType: 'text/plain' });
  assert.equal(plain.statusCode, 415);
  const form = await call(session, 'action=logout', { cookie: token, contentType: 'application/x-www-form-urlencoded' });
  assert.equal(form.statusCode, 415);
  // A login form posted from another site cannot plant a session either.
  assert.equal((await call(session, { action: 'create', u, auth }, { headers: { ...SAME, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
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
  const start = Date.now();
  const idle = await createSession(u, start);
  assert.ok(await resolveSession(idle, start + IDLE_MS - 1));
  // The previous resolve refreshed the idle window.
  assert.ok(await resolveSession(idle, start + 2 * IDLE_MS - 2));
  assert.equal(await resolveSession(idle, start + 3 * IDLE_MS), null);
  assert.equal(redis('EXISTS', `gipf:session:v1:${hash(idle)}`), 0);
  assert.ok(!redis('SMEMBERS', `gipf:sessions:v1:${u}`).includes(hash(idle)));

  const busy = await createSession(u, start);
  for (let t = start; t < start + ABSOLUTE_MS; t += IDLE_MS / 2) assert.ok(await resolveSession(busy, t), 'active use stays signed in until the absolute limit');
  assert.equal(await resolveSession(busy, start + ABSOLUTE_MS), null);

  const quiet = await createSession(u, start);
  await resolveSession(quiet, start + TOUCH_MS - 1);
  assert.equal(JSON.parse(redis('GET', `gipf:session:v1:${hash(quiet)}`)).seen, start, 'reads inside the touch interval do not write');
});

test('logout revokes this session and clears the cookie; other sessions stay', async () => {
  const one = await signIn(), two = await signIn();
  const res = await call(session, { action: 'logout' }, { cookie: one });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], new RegExp(`^${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$`));
  assert.equal((await call(profile, { action: 'read' }, { cookie: one })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' }, { cookie: two })).statusCode, 200);
  assert.deepEqual(redis('SMEMBERS', `gipf:sessions:v1:${u}`), [hash(two)]);
  // Signing in again replaces the session this browser presented.
  const replaced = await call(session, { action: 'create', u, auth }, { cookie: two });
  assert.equal((await call(profile, { action: 'read' }, { cookie: two })).statusCode, 401);
  assert.equal((await call(profile, { action: 'read' }, { cookie: tokenFrom(replaced) })).statusCode, 200);
});

test('sign out everywhere revokes every session of that account only', async () => {
  const mine = [await signIn(), await signIn(), await signIn()];
  const theirs = await signIn(other, otherAuth);
  const res = await call(session, { action: 'logout-all' }, { cookie: mine[0] });
  assert.deepEqual([res.statusCode, res.body.revoked], [200, 3]);
  for (const token of mine) assert.equal((await call(profile, { action: 'read' }, { cookie: token })).statusCode, 401);
  assert.equal(redis('EXISTS', `gipf:sessions:v1:${u}`), 0);
  assert.equal((await call(profile, { action: 'read' }, { cookie: theirs })).statusCode, 200);
  assert.equal((await call(session, { action: 'logout-all' }, { cookie: mine[0] })).statusCode, 401);
  assert.equal(await revokeAllSessions(u), 0);
});

test('expired index entries are pruned when a new session starts', async () => {
  const old = await createSession(u, Date.now());
  redis('DEL', `gipf:session:v1:${hash(old)}`);
  const fresh = await signIn();
  assert.deepEqual(redis('SMEMBERS', `gipf:sessions:v1:${u}`), [hash(fresh)]);
});

test('legacy body credentials keep working during the transition', async () => {
  assert.equal((await call(profile, { action: 'read', u, auth }, { headers: {} })).statusCode, 200);
  assert.equal((await call(account, { action: 'login', u, auth }, { headers: {} })).statusCode, 200);
});
