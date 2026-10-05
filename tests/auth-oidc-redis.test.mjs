// Auth0 sign-in, server key custody, account-key proxies and old-account linking,
// end to end against a synthetic OpenID provider and the disposable gipf-test-* Redis.
// No real provider, store or user is involved; every identity and key is synthetic.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { redis, redisAsync } from './redis-fixture.mjs';
import { useTestKeyCustody, TEST_KEK } from './session-fixture.mjs';
import auth from '../api/auth.js';
import session from '../api/session.js';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import catanRules from '../api/catanRules.js';
import splendorRules from '../api/splendorRules.js';
import diplomacyAgent from '../api/diplomacyAgent.js';
import chessCoach from '../api/chessCoach.js';
import { hash } from '../server/publicSecurity.js';
import { COOKIE, createSession, resolveSession } from '../server/session.js';
import { CALLBACK_URL, TRANSACTION_COOKIE, resetDiscovery, safeReturn } from '../server/auth0.js';
import { identityId, identityKey, readIdentity, rewrapIdentity, CREATE_PER_NETWORK } from '../server/identity.js';
import { seal, open, keyring } from '../server/keyCustody.js';

const ISSUER = 'https://synthetic-tenant.auth0.example';
const CLIENT_ID = 'synthetic-play-client';
const CLIENT_SECRET = 'synthetic-play-client-secret';
const providerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const foreignKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SAME = { 'x-games-request': '1', origin: 'https://play.ramia.us', host: 'play.ramia.us' };
const ANTHROPIC = 'sk-ant-synthetic-account-key-0000000000000000000000';
const LICHESS = 'lip_syntheticAccountToken000';

// --- synthetic provider -------------------------------------------------------
const provider = { claims: {}, signer: providerKeys.privateKey, authorize: null, tokenRequests: [], fail: false };
function jwt(claims, key = provider.signer) {
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'synthetic', typ: 'JWT' })}.${encode(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const upstream = { anthropic: [], lichess: [] };
async function syntheticFetch(input, init = {}) {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://synthetic.invalid/') return { ok: true, json: async () => ({ result: await redisAsync(...JSON.parse(init.body)) }) };
  if (url.startsWith(ISSUER)) {
    if (provider.fail) throw new Error('synthetic provider unavailable');
    if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: `${ISSUER}/`, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/oauth/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`, end_session_endpoint: `${ISSUER}/oidc/logout`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
    if (url.endsWith('/.well-known/jwks.json')) return json({ keys: [{ ...providerKeys.publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' }] });
    if (url.endsWith('/oauth/token')) {
      const form = new URLSearchParams(String(init.body));
      provider.tokenRequests.push(form);
      const challenge = createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (form.get('client_secret') !== CLIENT_SECRET || form.get('client_id') !== CLIENT_ID || form.get('redirect_uri') !== CALLBACK_URL ||
          form.get('code') !== 'synthetic-code' || challenge !== provider.authorize.searchParams.get('code_challenge')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      const now = Math.floor(Date.now() / 1000);
      return json({ token_type: 'Bearer', access_token: 'synthetic-unused', expires_in: 300, id_token: jwt({ iss: `${ISSUER}/`, aud: CLIENT_ID, sub: 'google-oauth2|synthetic-1', email: 'player-one@synthetic.example', email_verified: true, nonce: provider.authorize.searchParams.get('nonce'), iat: now, exp: now + 300, ...provider.claims }) });
    }
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    upstream.anthropic.push(init.headers['x-api-key']);
    return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"message":"synthetic reply","scratchpad":{}}' }] });
  }
  if (url.startsWith('https://explorer.lichess.ovh/masters')) {
    upstream.lichess.push(init.headers.Authorization);
    return json({ moves: [], white: 0, draws: 0, black: 0 });
  }
  throw new Error(`unexpected synthetic request ${url}`);
}

// --- request helpers ----------------------------------------------------------
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
async function call(handler, { method = 'POST', body, headers = SAME, cookies = {}, query, url, ip = '192.0.2.10' } = {}) {
  const res = response();
  const cookie = Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  const all = { ...headers, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) };
  await handler({ method, headers: all, socket: { remoteAddress: ip }, body, query, url }, res);
  return res;
}
const setCookies = res => [].concat(res.headers['set-cookie'] || []);
const cookieValue = (res, name) => setCookies(res).map(c => c.match(new RegExp(`^${name}=([^;]*)`))?.[1]).find(v => v !== undefined);

async function startLogin(query = { action: 'login', return: '/catan' }, cookies = {}) {
  const res = await call(auth, { method: 'GET', query, headers: { host: 'play.ramia.us' }, cookies });
  assert.equal(res.statusCode, 302);
  provider.authorize = new URL(res.headers.location);
  return { res, transaction: cookieValue(res, TRANSACTION_COOKIE) };
}
async function finishLogin(transaction, { cookies = {}, state = provider.authorize.searchParams.get('state') } = {}) {
  const search = `?code=synthetic-code&state=${encodeURIComponent(state)}`;
  return call(auth, { method: 'GET', query: { action: 'callback' }, url: `/api/auth/callback${search}`, headers: { host: 'play.ramia.us' }, cookies: { [TRANSACTION_COOKIE]: transaction, ...cookies } });
}
async function signIn(claims = {}) {
  provider.claims = claims;
  const { transaction } = await startLogin();
  const res = await finishLogin(transaction);
  assert.match(res.headers.location, /^\/login\?signedin=1/, JSON.stringify(res.headers));
  return cookieValue(res, COOKIE);
}
const identityKeys = () => redis('KEYS', 'gipf:identity:v1:*');

beforeEach(() => {
  redis('FLUSHDB');
  for (const name of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL']) delete process.env[name];
  Object.assign(process.env, { KV_REST_API_URL: 'https://synthetic.invalid/', KV_REST_API_TOKEN: 'synthetic', AUTH0_ISSUER_BASE_URL: ISSUER, AUTH0_CLIENT_ID: CLIENT_ID, AUTH0_CLIENT_SECRET: CLIENT_SECRET, GAMES_SESSION_SECRET: 'synthetic-session-secret-0123456789abcdef' });
  useTestKeyCustody();
  Object.assign(provider, { claims: {}, signer: providerKeys.privateKey, authorize: null, tokenRequests: [], fail: false });
  upstream.anthropic = []; upstream.lichess = [];
  globalThis.fetch = syntheticFetch;
  resetDiscovery();
});

// --- sign-in ------------------------------------------------------------------

test('login redirects to Auth0 with play\'s client, the exact callback, PKCE, state and nonce; no prompt unless asked', async () => {
  const { res, transaction } = await startLogin();
  const target = provider.authorize;
  assert.equal(target.origin + target.pathname, `${ISSUER}/authorize`);
  assert.equal(target.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(target.searchParams.get('redirect_uri'), 'https://play.ramia.us/api/auth/callback');
  assert.equal(target.searchParams.get('response_type'), 'code');
  assert.deepEqual(target.searchParams.get('scope').split(' ').sort(), ['email', 'openid', 'profile']);
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  for (const p of ['state', 'nonce', 'code_challenge']) assert.ok(target.searchParams.get(p)?.length >= 32, p);
  assert.equal(target.searchParams.get('prompt'), null, 'an existing Auth0 session signs in silently');
  const cookie = setCookies(res).find(c => c.startsWith(`${TRANSACTION_COOKIE}=`));
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  assert.ok(!/Domain=/i.test(cookie));
  // The sealed transaction reveals none of its contents.
  for (const p of ['state', 'nonce']) assert.ok(!transaction.includes(target.searchParams.get(p)));
  await startLogin({ action: 'login', reauthenticate: '1' });
  assert.equal(provider.authorize.searchParams.get('prompt'), 'login');
});

test('the return path is allowlisted to game routes on the server too', async () => {
  for (const [raw, expected] of [['/catan', '/catan'], ['/diplomacy', '/diplomacy'], ['https://evil.example', '/'], ['//evil.example', '/'], ['/catan/x', '/'], ['/login', '/'], ['/%2F%2Fevil.example', '/'], [undefined, '/']]) {
    assert.equal(safeReturn(raw), expected, String(raw));
    provider.claims = {};
    const { transaction } = await startLogin({ action: 'login', return: raw });
    const done = await finishLogin(transaction);
    assert.equal(done.headers.location, `/login?signedin=1&return=${encodeURIComponent(expected)}`);
  }
});

test('callback validates the code and ID token, creates the identity once, and sets a host-only session', async () => {
  const { transaction } = await startLogin();
  const res = await finishLogin(transaction);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/login?signedin=1&return=%2Fcatan');
  const issued = setCookies(res).find(c => c.startsWith(`${COOKIE}=`));
  assert.match(issued, new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000$`));
  assert.ok(!/Domain=/i.test(issued));
  assert.ok(setCookies(res).some(c => c.startsWith(`${TRANSACTION_COOKIE}=;`) && /Max-Age=0/.test(c)), 'transaction cookie cleared');
  const form = provider.tokenRequests[0];
  assert.equal(form.get('client_secret'), CLIENT_SECRET, 'client_secret_post');
  const id = identityId(ISSUER, 'google-oauth2|synthetic-1');
  assert.deepEqual(identityKeys(), [identityKey(id)]);
  // Redis holds neither the subject nor the email in any key, and the identity record holds no email.
  assert.ok(!redis('KEYS', '*').some(k => /synthetic-1|player-one/.test(k)));
  assert.ok(!redis('GET', identityKey(id)).includes('player-one'));
  const token = cookieValue(res, COOKIE);
  const established = await call(session, { body: { action: 'establish' }, cookies: { [COOKIE]: token } });
  assert.equal(established.statusCode, 200);
  assert.equal(established.body.u, id);
  assert.equal(established.body.name, 'player-one@synthetic.example');
  assert.deepEqual(established.body.keys, { anthropic: false, lichess: false });
  assert.match(established.body.sealKey, /^[A-Za-z0-9+/]{43}=$/);
  // A later sign-in reaches the same identity and the same seal key.
  const again = await signIn();
  assert.deepEqual(identityKeys(), [identityKey(id)]);
  const second = await call(session, { body: { action: 'establish' }, cookies: { [COOKIE]: again } });
  assert.deepEqual([second.body.u, second.body.sealKey], [id, established.body.sealKey]);
  const status = await call(session, { method: 'GET', headers: {}, cookies: { [COOKIE]: again } });
  assert.deepEqual(status.body, { signedIn: true, u: id, name: 'player-one@synthetic.example', keys: { anthropic: false, lichess: false } });
});

test('a sign-in replaces the session the browser presented', async () => {
  const first = await signIn();
  provider.claims = {};
  const { transaction } = await startLogin();
  const res = await finishLogin(transaction, { cookies: { [COOKIE]: first } });
  assert.equal(await resolveSession(first), null);
  assert.ok(await resolveSession(cookieValue(res, COOKIE)));
});

test('callback fails closed on state, nonce, issuer, audience, expiry, signature and transaction errors', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ['nonce', { nonce: 'wrong-nonce' }], ['issuer', { iss: 'https://evil.example/' }], ['audience', { aud: 'other-client' }],
    ['expired', { exp: now - 600, iat: now - 900 }],
  ];
  for (const [label, claims] of cases) {
    provider.claims = claims;
    const { transaction } = await startLogin();
    const res = await finishLogin(transaction);
    assert.equal(res.headers.location, '/login?error=signin&return=%2Fcatan', label);
    assert.equal(cookieValue(res, COOKIE), undefined, label);
  }
  provider.claims = {};
  provider.signer = foreignKeys.privateKey;
  let { transaction } = await startLogin();
  assert.equal((await finishLogin(transaction)).headers.location, '/login?error=signin&return=%2Fcatan', 'foreign signature');
  provider.signer = providerKeys.privateKey;
  ({ transaction } = await startLogin());
  assert.equal((await finishLogin(transaction, { state: 'forged-state' })).headers.location, '/login?error=signin&return=%2Fcatan', 'state');
  // Another login's transaction cannot complete this one.
  const first = await startLogin();
  const firstAuthorize = provider.authorize;
  const second = await startLogin();
  provider.authorize = firstAuthorize;
  assert.equal((await finishLogin(second.transaction, { state: firstAuthorize.searchParams.get('state') })).headers.location, '/login?error=signin&return=%2Fcatan');
  assert.equal((await finishLogin(undefined)).headers.location, '/login?error=signin', 'no transaction cookie');
  assert.equal((await finishLogin(`${first.transaction.slice(0, -2)}AA`)).headers.location, '/login?error=signin', 'tampered transaction');
  assert.deepEqual(identityKeys(), []);
  assert.deepEqual(redis('KEYS', 'gipf:session:v1:*'), []);
});

test('sign-in requires a verified email', async () => {
  for (const claims of [{ email_verified: false }, { email_verified: 'true' }, { email: undefined }]) {
    provider.claims = claims;
    const { transaction } = await startLogin();
    const res = await finishLogin(transaction);
    assert.equal(res.headers.location, '/login?error=unverified&return=%2Fcatan');
    assert.equal(cookieValue(res, COOKIE), undefined);
  }
  assert.deepEqual(identityKeys(), []);
});

test('sign-in fails closed without configuration, off the production host, or with the provider down', async () => {
  delete process.env.AUTH0_CLIENT_SECRET;
  let res = await call(auth, { method: 'GET', query: { action: 'login', return: '/chess' }, headers: { host: 'play.ramia.us' } });
  assert.deepEqual([res.statusCode, res.headers.location], [302, '/login?error=unavailable&return=%2Fchess']);
  process.env.AUTH0_CLIENT_SECRET = CLIENT_SECRET;
  process.env.GAMES_SESSION_SECRET = 'too-short';
  res = await call(auth, { method: 'GET', query: { action: 'login' }, headers: { host: 'play.ramia.us' } });
  assert.equal(res.headers.location, '/login?error=unavailable&return=%2F');
  process.env.GAMES_SESSION_SECRET = 'synthetic-session-secret-0123456789abcdef';
  process.env.VERCEL = '1';
  res = await call(auth, { method: 'GET', query: { action: 'login' }, headers: { host: 'play-git-branch-example-team.vercel.app' } });
  assert.equal(res.headers.location, '/login?error=unavailable&return=%2F');
  delete process.env.VERCEL;
  provider.fail = true;
  res = await call(auth, { method: 'GET', query: { action: 'login' }, headers: { host: 'play.ramia.us' } });
  assert.equal(res.headers.location, '/login?error=unavailable&return=%2F');
  assert.ok(!JSON.stringify(res.headers).includes('synthetic provider unavailable'));
});

// --- automatic (silent) sign-in --------------------------------------------------

async function silentCallback(transaction, query) {
  return call(auth, { method: 'GET', query: { action: 'callback' }, url: `/api/auth/callback?${query}`, headers: { host: 'play.ramia.us' }, cookies: { [TRANSACTION_COOKIE]: transaction } });
}

test('silent login sends prompt=none; reauthenticate wins over it', async () => {
  await startLogin({ action: 'login', return: '/chess', silent: '1' });
  assert.equal(provider.authorize.searchParams.get('prompt'), 'none');
  await startLogin({ action: 'login', silent: 'home' });
  assert.equal(provider.authorize.searchParams.get('prompt'), 'none');
  await startLogin({ action: 'login', silent: '1', reauthenticate: '1' });
  assert.equal(provider.authorize.searchParams.get('prompt'), 'login');
  await startLogin({ action: 'login', silent: 'anything-else' });
  assert.equal(provider.authorize.searchParams.get('prompt'), null);
});

test('silent success: an open provider session signs in and returns to the page', async () => {
  const { transaction } = await startLogin({ action: 'login', return: '/catan', silent: '1' });
  const done = await finishLogin(transaction);
  assert.equal(done.headers.location, '/login?signedin=1&return=%2Fcatan');
  assert.ok(await resolveSession(cookieValue(done, COOKIE)), 'a session was created');
  assert.equal(identityKeys().length, 1);
});

for (const error of ['login_required', 'consent_required', 'interaction_required']) {
  test(`silent ${error}: back to /login?silent=failed quietly, no session, no token request, transaction cleared`, async () => {
    const { transaction } = await startLogin({ action: 'login', return: '/chess', silent: '1' });
    const state = provider.authorize.searchParams.get('state');
    const res = await silentCallback(transaction, `error=${error}&error_description=synthetic&state=${encodeURIComponent(state)}`);
    assert.deepEqual([res.statusCode, res.headers.location], [302, '/login?silent=failed&return=%2Fchess']);
    assert.equal(cookieValue(res, COOKIE), undefined);
    assert.equal(cookieValue(res, TRANSACTION_COOKIE), '');
    assert.equal(provider.tokenRequests.length, 0);
    assert.equal(identityKeys().length, 0);
  });
}

test('a silent attempt from the catalogue fails back to the catalogue with no flag', async () => {
  const { transaction } = await startLogin({ action: 'login', silent: 'home' });
  const res = await silentCallback(transaction, `error=login_required&state=${encodeURIComponent(provider.authorize.searchParams.get('state'))}`);
  assert.equal(res.headers.location, '/');
});

test('silent fallback keeps the return allowlist: an unsafe return becomes the catalogue', async () => {
  for (const raw of ['https://evil.example', '//evil.example', '/catan/x']) {
    const { transaction } = await startLogin({ action: 'login', return: raw, silent: '1' });
    const res = await silentCallback(transaction, 'error=login_required');
    assert.equal(res.headers.location, '/login?silent=failed&return=%2F', raw);
  }
});

test('a provider refusal on an interactive sign-in is still an error, not a quiet fallback', async () => {
  const { transaction } = await startLogin({ action: 'login', return: '/chess' });
  const res = await silentCallback(transaction, `error=login_required&state=${encodeURIComponent(provider.authorize.searchParams.get('state'))}`);
  assert.equal(res.headers.location, '/login?error=signin&return=%2Fchess');
});

test('silent sign-in that cannot start (unconfigured, off-host, provider down) falls back quietly too', async () => {
  delete process.env.AUTH0_CLIENT_SECRET;
  let res = await call(auth, { method: 'GET', query: { action: 'login', return: '/chess', silent: '1' }, headers: { host: 'play.ramia.us' } });
  assert.equal(res.headers.location, '/login?silent=failed&return=%2Fchess');
  process.env.AUTH0_CLIENT_SECRET = CLIENT_SECRET;
  process.env.VERCEL = '1';
  res = await call(auth, { method: 'GET', query: { action: 'login', silent: 'home' }, headers: { host: 'play-git-branch-example-team.vercel.app' } });
  assert.equal(res.headers.location, '/');
  delete process.env.VERCEL;
  provider.fail = true;
  res = await call(auth, { method: 'GET', query: { action: 'login', silent: '1' }, headers: { host: 'play.ramia.us' } });
  assert.equal(res.headers.location, '/login?silent=failed&return=%2F');
});

test('first sign-ins spend the identity creation budget; returning identities do not', async () => {
  await signIn();
  for (let n = 2; n <= CREATE_PER_NETWORK; n++) await signIn({ sub: `google-oauth2|synthetic-${n}` });
  provider.claims = { sub: 'google-oauth2|synthetic-over' };
  const { transaction } = await startLogin();
  assert.equal((await finishLogin(transaction)).headers.location, '/login?error=busy&return=%2Fcatan');
  assert.ok(await signIn(), 'an existing identity still signs in');
});

// --- sessions, logout and CSRF --------------------------------------------------

test('logout clears only this session; everywhere revokes every session of the identity only', async () => {
  const one = await signIn(), two = await signIn(), three = await signIn();
  const other = await signIn({ sub: 'google-oauth2|synthetic-2', email: 'player-two@synthetic.example' });
  const out = await call(auth, { query: { action: 'logout' }, body: {}, cookies: { [COOKIE]: one } });
  assert.equal(out.statusCode, 200);
  assert.match(setCookies(out)[0], new RegExp(`^${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$`));
  assert.equal(await resolveSession(one), null);
  assert.ok(await resolveSession(two));
  const all = await call(auth, { query: { action: 'logout' }, body: { everywhere: true }, cookies: { [COOKIE]: two } });
  assert.deepEqual([all.statusCode, all.body.revoked], [200, 2]);
  assert.equal(await resolveSession(three), null);
  assert.ok(await resolveSession(other));
  assert.equal(provider.tokenRequests.length, 4, 'logout never calls the provider');
});

test('CSRF: establish, keys, logout and profile need JSON, the custom header and an exact same origin', async () => {
  const token = await signIn();
  const cases = [
    { ...SAME, 'x-games-request': undefined },
    { ...SAME, origin: 'https://evil.example' },
    { ...SAME, origin: 'https://home.ramia.us' },
    { 'x-games-request': '1', host: 'play.ramia.us', 'sec-fetch-site': 'cross-site' },
    { 'x-games-request': '1', origin: 'https://play.ramia.us.evil.example', host: 'play.ramia.us' },
  ];
  for (const headers of cases) {
    for (const [handler, body, query] of [[session, { action: 'establish' }], [account, { action: 'setKeys', anthropic: ANTHROPIC }], [auth, {}, { action: 'logout' }], [profile, { action: 'read' }]]) {
      const res = await call(handler, { body, headers, query, cookies: { [COOKIE]: token } });
      assert.equal(res.statusCode, 403, `${JSON.stringify(headers)} ${JSON.stringify(body)}`);
    }
  }
  const res = response();
  await account({ method: 'POST', headers: { ...SAME, 'content-type': 'text/plain', cookie: `${COOKIE}=${token}` }, socket: { remoteAddress: '192.0.2.10' }, body: JSON.stringify({ action: 'setKeys', anthropic: ANTHROPIC }) }, res);
  assert.equal(res.statusCode, 415);
  assert.ok(await resolveSession(token));
  assert.ok(!(await readIdentity(identityId(ISSUER, 'google-oauth2|synthetic-1'))).keys.anthropic);
});

test('a malformed session record is refused and removed; retired account actions are refused', async () => {
  const malformed = 'L'.repeat(43);
  redis('SET', `gipf:session:v1:${hash(malformed)}`, JSON.stringify({ u: 'a'.repeat(64), created: Date.now(), seen: Date.now() }));
  assert.equal((await call(profile, { body: { action: 'read' }, cookies: { [COOKIE]: malformed } })).statusCode, 401);
  assert.equal(redis('EXISTS', `gipf:session:v1:${hash(malformed)}`), 0);
  const token = await signIn();
  for (const action of ['create', 'login', 'setKey', 'link', 'link-verify']) {
    const res = await call(account, { body: { action, u: 'a'.repeat(64), auth: 'b'.repeat(64) }, cookies: { [COOKIE]: token } });
    assert.deepEqual([res.statusCode, res.body], [400, { error: 'bad_request' }]);
  }
  // Body fields never authorize: without the cookie, a named account is a signed-out request.
  assert.equal((await call(profile, { body: { action: 'read', u: 'a'.repeat(64), auth: 'b'.repeat(64) }, headers: {} })).statusCode, 401);
});

// --- key custody ----------------------------------------------------------------

test('keys are stored only as ciphertext bound to the identity, slot and key version', async () => {
  const token = await signIn();
  const id = identityId(ISSUER, 'google-oauth2|synthetic-1');
  const saved = await call(account, { body: { action: 'setKeys', anthropic: ANTHROPIC, lichess: LICHESS }, cookies: { [COOKIE]: token } });
  assert.deepEqual([saved.statusCode, saved.body], [200, { saved: true, keys: { anthropic: true, lichess: true } }]);
  const all = JSON.stringify(redis('KEYS', '*').map(k => [k, redis('TYPE', k) === 'string' ? redis('GET', k) : redis('SMEMBERS', k)]));
  assert.ok(!all.includes(ANTHROPIC) && !all.includes(LICHESS) && !all.includes(TEST_KEK), 'no plaintext key or KEK at rest');
  assert.ok(!all.includes(Buffer.from(ANTHROPIC).toString('base64')));
  const record = await readIdentity(id);
  assert.equal(record.keys.anthropic.kv, 1);
  assert.equal(open(id, 'anthropic', record.keys.anthropic), ANTHROPIC);
  const other = hash('another identity');
  assert.throws(() => open(other, 'anthropic', record.keys.anthropic), 'bound to the identity');
  assert.throws(() => open(id, 'lichess', record.keys.anthropic), 'bound to the slot');
  assert.throws(() => open(id, 'anthropic', { ...record.keys.anthropic, kv: 2 }), 'bound to the key version');
  // No response ever carries the key back.
  for (const res of [saved, await call(session, { body: { action: 'establish' }, cookies: { [COOKIE]: token } }), await call(session, { method: 'GET', headers: {}, cookies: { [COOKIE]: token } })]) {
    assert.ok(!JSON.stringify(res.body).includes(ANTHROPIC) && !JSON.stringify(res.body).includes(LICHESS));
  }
  // Clearing removes the envelope; omitted slots are kept; nonsense is refused.
  await call(account, { body: { action: 'setKeys', anthropic: null }, cookies: { [COOKIE]: token } });
  const cleared = await readIdentity(id);
  assert.deepEqual([!!cleared.keys.anthropic, !!cleared.keys.lichess], [false, true]);
  for (const bad of [{ anthropic: '' }, { anthropic: 'x'.repeat(513) }, { anthropic: 'has space' }, { anthropic: 7 }, {}]) {
    assert.equal((await call(account, { body: { action: 'setKeys', ...bad }, cookies: { [COOKIE]: token } })).statusCode, 400, JSON.stringify(bad));
  }
});

test('key rotation: old envelopes stay readable with the previous KEK and rewrap to the new version', async () => {
  const token = await signIn();
  const id = identityId(ISSUER, 'google-oauth2|synthetic-1');
  await call(account, { body: { action: 'setKeys', anthropic: ANTHROPIC, lichess: LICHESS }, cookies: { [COOKIE]: token } });
  const v2 = Buffer.alloc(32, 9).toString('base64');
  Object.assign(process.env, { GAMES_KEY_ENCRYPTION_KEY: v2, GAMES_KEY_ENCRYPTION_KEY_VERSION: '2', GAMES_KEY_ENCRYPTION_KEY_V1: TEST_KEK });
  assert.equal(keyring().current, 2);
  // During rotation the proxies still read version-1 keys.
  await call(catanRules, { body: { messages: [{ role: 'user', content: 'q' }], context: {} }, cookies: { [COOKIE]: token } });
  assert.deepEqual(upstream.anthropic, [ANTHROPIC]);
  assert.equal(await rewrapIdentity(id), true);
  const record = await readIdentity(id);
  assert.deepEqual(Object.values(record.keys).map(e => e.kv), [2, 2, 2]);
  assert.equal(await rewrapIdentity(id), false, 'idempotent');
  delete process.env.GAMES_KEY_ENCRYPTION_KEY_V1;
  assert.equal(open(id, 'anthropic', record.keys.anthropic), ANTHROPIC);
  assert.equal(seal(id, 'lichess', LICHESS).kv, 2);
  // An envelope whose KEK was removed before rewrapping is unavailable, not readable.
  redis('SET', identityKey(id), JSON.stringify({ ...record, keys: { ...record.keys, anthropic: { ...record.keys.anthropic, kv: 1 } } }));
  const res = await call(catanRules, { body: { messages: [{ role: 'user', content: 'q' }], context: {} }, cookies: { [COOKIE]: token } });
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res.body).includes(ANTHROPIC));
});

test('custody fails closed without a valid KEK', async () => {
  const token = await signIn();
  for (const value of [undefined, 'short', Buffer.alloc(16).toString('base64')]) {
    if (value === undefined) delete process.env.GAMES_KEY_ENCRYPTION_KEY; else process.env.GAMES_KEY_ENCRYPTION_KEY = value;
    const res = await call(account, { body: { action: 'setKeys', anthropic: ANTHROPIC }, cookies: { [COOKIE]: token } });
    assert.equal(res.statusCode, 503);
  }
  useTestKeyCustody();
  assert.ok(!(await readIdentity(identityId(ISSUER, 'google-oauth2|synthetic-1'))).keys.anthropic);
});

// --- proxies --------------------------------------------------------------------

test('every model proxy and the Lichess explorer use the account key server-side; guests keep body keys', async () => {
  const token = await signIn();
  await call(account, { body: { action: 'setKeys', anthropic: ANTHROPIC, lichess: LICHESS }, cookies: { [COOKIE]: token } });
  const bodies = [
    [catanRules, { messages: [{ role: 'user', content: 'q' }], context: {} }],
    [splendorRules, { messages: [{ role: 'user', content: 'q' }], context: {} }],
    [diplomacyAgent, { power: 'FRA', persona: {}, context: {}, messages: [{ role: 'user', content: 'hi' }] }],
    [chessCoach, { mode: 'thread', context: {}, messages: [{ role: 'user', content: 'q' }] }],
    [chessCoach, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', kind: 'player-move' }],
  ];
  for (const [handler, body] of bodies) {
    const res = await call(handler, { body, cookies: { [COOKIE]: token } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(!JSON.stringify(res.body).includes(ANTHROPIC));
  }
  assert.deepEqual(upstream.anthropic, Array(bodies.length).fill(ANTHROPIC));
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const explorer = await call(chessCoach, { body: { mode: 'explorer', fen }, cookies: { [COOKIE]: token } });
  assert.equal(explorer.statusCode, 200);
  assert.deepEqual(upstream.lichess, [`Bearer ${LICHESS}`]);
  assert.ok(!JSON.stringify(explorer.body).includes(LICHESS));
  // Guests: a device-only body key still works, with no session at all.
  upstream.anthropic = [];
  const guest = await call(catanRules, { body: { apiKey: 'sk-ant-synthetic-guest', messages: [{ role: 'user', content: 'q' }] }, headers: { 'content-type': 'application/json' } });
  assert.equal(guest.statusCode, 200);
  assert.deepEqual(upstream.anthropic, ['sk-ant-synthetic-guest']);
  // No key anywhere, a cross-site cookie request, or an account without a key.
  assert.equal((await call(catanRules, { body: { messages: [{ role: 'user', content: 'q' }] }, headers: {} })).statusCode, 401);
  assert.equal((await call(chessCoach, { body: { mode: 'explorer', fen }, headers: {} })).statusCode, 401);
  assert.equal((await call(catanRules, { body: { messages: [{ role: 'user', content: 'q' }] }, headers: { ...SAME, origin: 'https://evil.example' }, cookies: { [COOKIE]: token } })).statusCode, 403);
  const bare = await signIn({ sub: 'google-oauth2|synthetic-keyless', email: 'keyless@synthetic.example' });
  assert.equal((await call(splendorRules, { body: { messages: [{ role: 'user', content: 'q' }] }, cookies: { [COOKIE]: bare } })).statusCode, 401);
  assert.equal((await call(chessCoach, { body: { mode: 'explorer', fen: 'not a fen!' }, cookies: { [COOKIE]: token } })).statusCode, 400);
});

test('createSession refuses records without an identity', async () => {
  await assert.rejects(createSession({ i: 'nope', u: 'a'.repeat(64) }));
});
