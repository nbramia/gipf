// Local end-to-end Auth0 sign-in in a real browser, against a synthetic OpenID provider.
//
// Auth0 accepts only the exact production callback, so preview deployments cannot sign
// in. This drives the built app (PUBLIC_URL=/) as https://play.ramia.us in Chromium,
// with every request to that origin and to the synthetic issuer answered by this
// process: the real API handlers, a disposable gipf-test-* Redis, and a provider that
// signs ID tokens with a throwaway key. Nothing reaches Auth0, Anthropic, Lichess or a
// shared store. It covers: sign-in from the landing page, the first-sign-in link offer,
// linking a synthetic username/password account, host-only cookies, keys never in the
// page, a model request using the account key, sign-out, and the silent second sign-in.
//
//   docker run --rm -d --name gipf-test-auth-browser redis:7-alpine
//   PUBLIC_URL=/ npm run build
//   GIPF_TEST_REDIS_CONTAINER=gipf-test-auth-browser PLAYWRIGHT_MODULE=/path/to/playwright node tests/auth-browser.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import { useTestKeyCustody } from './session-fixture.mjs';
import auth from '../api/auth/[action].js';
import session from '../api/session.js';
import chessAccount from '../api/chessAccount.js';
import chessProfile from '../api/chessProfile.js';
import catanRules from '../api/catanRules.js';
import chessCoach from '../api/chessCoach.js';
import { hash } from '../server/publicSecurity.js';
import { identityKey } from '../server/identity.js';
import { open } from '../server/keyCustody.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ISSUER = 'https://synthetic-tenant.auth0.example';
const ORIGIN = 'https://play.ramia.us';
const CLIENT_ID = 'synthetic-play-client', CLIENT_SECRET = 'synthetic-play-client-secret';
const OLD_USER = 'Synthetic Old Player', OLD_PASSWORD = 'synthetic-old-password';
const OLD_KEY = 'sk-ant-synthetic-old-account-key-000000000000000000';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

redis('FLUSHDB');
useTestKeyCustody();
Object.assign(process.env, { KV_REST_API_URL: 'https://synthetic.invalid/', KV_REST_API_TOKEN: 'synthetic', AUTH0_ISSUER_BASE_URL: ISSUER, AUTH0_CLIENT_ID: CLIENT_ID, AUTH0_CLIENT_SECRET: CLIENT_SECRET, GAMES_SESSION_SECRET: 'synthetic-session-secret-0123456789abcdef' });

// --- a synthetic pre-Auth0 account, derived exactly as the original client did -----
const subtle = webcrypto.subtle, enc = new TextEncoder();
const NAMESPACE = 'gipf-chess-account:v1:';
const normalized = OLD_USER.trim().toLowerCase();
const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(NAMESPACE + normalized), iterations: 310000 }, await subtle.importKey('raw', enc.encode(OLD_PASSWORD), 'PBKDF2', false, ['deriveBits']), 768));
const oldU = Buffer.from(await subtle.digest('SHA-256', enc.encode(NAMESPACE + normalized))).toString('hex');
const authToken = Buffer.from(bits.slice(0, 32)).toString('hex');
const aesKey = await subtle.importKey('raw', bits.slice(32, 64), { name: 'AES-GCM' }, false, ['encrypt']);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const sealed = { iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(OLD_KEY))).toString('base64') };
redis('SET', `chess:account:${oldU}`, JSON.stringify({ authHash: hash(authToken), enc: sealed, encLichess: null, createdAt: 1 }));
redis('SET', `gipf:settings:v2:${oldU}`, JSON.stringify({ revision: 1, profile: { preferences: { catanDarkMode: 'true' } } }));

// --- the synthetic provider and upstreams, reached by the handlers' fetch -----------
const provider = { authorize: null, sub: 'google-oauth2|synthetic-browser-1', authorizations: 0, prompts: [] };
const upstream = { anthropic: [] };
function jwt(claims) {
  const e = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${e({ alg: 'RS256', kid: 'synthetic', typ: 'JWT' })}.${e(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}`;
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://synthetic.invalid/') return { ok: true, json: async () => ({ result: await redisAsync(...JSON.parse(init.body)) }) };
  if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: `${ISSUER}/`, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/oauth/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
  if (url.endsWith('/.well-known/jwks.json')) return json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' }] });
  if (url === `${ISSUER}/oauth/token`) {
    const form = new URLSearchParams(String(init.body));
    assert.equal(form.get('client_secret'), CLIENT_SECRET);
    assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), provider.authorize.get('code_challenge'));
    const now = Math.floor(Date.now() / 1000);
    return json({ token_type: 'Bearer', access_token: 'synthetic-unused', expires_in: 300, id_token: jwt({ iss: `${ISSUER}/`, aud: CLIENT_ID, sub: provider.sub, email: 'browser-player@synthetic.example', email_verified: true, nonce: provider.authorize.get('nonce'), iat: now, exp: now + 300 }) });
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    upstream.anthropic.push(init.headers['x-api-key']);
    return json({ content: [{ type: 'text', text: 'Synthetic rules answer.' }] });
  }
  throw new Error(`unexpected request ${url}`);
};

// --- one local server for the app origin and the provider's browser endpoints ------
const handlers = { session, chessAccount, chessProfile, catanRules, chessCoach };
const root = resolve('build');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  res.status = n => { res.statusCode = n; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
  if (req.headers['x-target'] === 'provider') {
    // Auth0's /authorize: an open provider session (as after signing in to Home) answers at once.
    assert.equal(url.pathname, '/authorize');
    provider.authorize = url.searchParams;
    provider.authorizations++;
    provider.prompts.push(url.searchParams.get('prompt'));
    assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/callback`);
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    res.writeHead(302, { Location: `${ORIGIN}/api/auth/callback?code=synthetic-code&state=${encodeURIComponent(url.searchParams.get('state'))}` });
    return res.end();
  }
  const authAction = url.pathname.match(/^\/api\/auth\/(\w+)$/)?.[1];
  const name = authAction ? 'auth' : url.pathname.match(/^\/api\/(\w+)$/)?.[1];
  if (name) {
    const handler = name === 'auth' ? auth : handlers[name];
    if (!handler) { res.writeHead(404); return res.end(); }
    req.query = { ...Object.fromEntries(url.searchParams), ...(authAction ? { action: authAction } : {}) };
    let body = '';
    for await (const chunk of req) body += chunk;
    req.body = body || undefined;
    return handler(req, res);
  }
  let path = resolve(root, `.${url.pathname}`);
  if (!path.startsWith(`${root}/`) || url.pathname === '/') path = resolve(root, 'index.html');
  try {
    const data = await readFile(path);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch (_) { res.setHeader('Content-Type', 'text/html'); res.end(await readFile(resolve(root, 'index.html'))); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// Forward a browser request for the app origin or the issuer to the local server.
async function forward(route, target) {
  const request = route.request();
  const url = new URL(request.url());
  const headers = { ...(await request.allHeaders()), host: url.host, 'x-target': target };
  const answer = await new Promise((done, fail) => {
    const r = http.request({ host: '127.0.0.1', port, path: url.pathname + url.search, method: request.method(), headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', fail);
    const body = request.postDataBuffer();
    if (body) r.write(body);
    r.end();
  });
  const out = {};
  for (const [k, v] of Object.entries(answer.headers)) out[k] = Array.isArray(v) ? v.join('\n') : String(v);
  if (answer.status >= 300 && answer.status < 400 && request.isNavigationRequest()) {
    // Playwright does not route the hop after a fulfilled redirect, so the redirect is
    // replayed as an immediate navigation (cookies from this response still apply).
    const location = new URL(answer.headers.location, url).href;
    delete out.location; delete out['content-length'];
    out['content-type'] = 'text/html';
    await route.fulfill({ status: 200, headers: out, body: `<meta http-equiv="refresh" content="0;url=${location.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` });
    return;
  }
  await route.fulfill({ status: answer.status, headers: out, body: answer.body });
}

// Both hosts resolve locally so redirected navigations reach the route handlers too.
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP play.ramia.us 127.0.0.1, MAP synthetic-tenant.auth0.example 127.0.0.1'] });
const context = await browser.newContext();
const forwarding = target => route => forward(route, target).catch(error => { console.error('forward failed', route.request().url(), error.message); return route.abort(); });
await context.route(`${ORIGIN}/**`, forwarding('app'));
await context.route(`${ISSUER}/**`, forwarding('provider'));
await context.route(/^(?!https:\/\/(play\.ramia\.us|synthetic-tenant\.auth0\.example)\/)/, route => route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
if (process.env.DEBUG_AUTH_BROWSER) { page.on('requestfailed', r => console.error('FAILED', r.url().slice(0, 120), r.failure()?.errorText)); page.on('response', r => console.error('RESP', r.status(), r.url().slice(0, 120))); }
// The linked account's cloud preferences differ from this device's: when the account
// boundary asks, take the cloud's.
async function useCloudPreferences() {
  await page.getByText('Loading account preferences…').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const choice = page.getByRole('button', { name: 'Use cloud' });
  if (await choice.count()) await choice.click();
}
const pass = label => console.log(`PASS ${label}`);
const storage = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));

try {
  // Guest: the landing page links to /login; a guest key stays on the device.
  await page.goto(`${ORIGIN}/`);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.waitForURL(`${ORIGIN}/login`);
  await page.getByLabel('Anthropic API key').fill('sk-ant-synthetic-guest-device-key-00000000000000');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByText('Saved on this device.').waitFor();
  assert.equal((await storage()).gipfApiKey, 'sk-ant-synthetic-guest-device-key-00000000000000');
  pass('guest reaches /login from the landing page; guest key is device-only');

  // Sign in: Auth0 redirect, silent provider session, callback, link offer.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome' }).waitFor({ timeout: 15000 }).catch(async error => {
    console.error('DEBUG url', page.url(), (await page.locator('body').innerText()).slice(0, 600), errors);
    throw error;
  });
  assert.deepEqual(provider.prompts, [null]);
  const cookies = await context.cookies(ORIGIN);
  const sessionCookie = cookies.find(c => c.name === '__Host-games_session');
  assert.ok(sessionCookie && sessionCookie.httpOnly && sessionCookie.secure && sessionCookie.sameSite === 'Lax' && sessionCookie.domain === 'play.ramia.us' && sessionCookie.path === '/');
  assert.ok(!cookies.some(c => c.name === '__Host-games_auth'), 'transaction cookie cleared');
  let local = await storage();
  assert.equal(local.gipfApiKey, undefined, 'the guest key left the device');
  assert.deepEqual(JSON.parse(local.gipfAccountKeys), { anthropic: true, lichess: false }, 'and moved to the account');
  pass('sign-in completes without credentials; host-only HttpOnly Secure Lax cookie; guest key moved to the account');

  // Link the synthetic pre-Auth0 account.
  await page.getByLabel('Old username').fill(OLD_USER);
  await page.getByLabel('Old password').fill('wrong-synthetic-password');
  await page.getByRole('button', { name: 'Link account' }).click();
  await page.getByRole('alert').filter({ hasText: 'Wrong username or password.' }).waitFor();
  await page.getByLabel('Old password').fill(OLD_PASSWORD);
  await page.getByRole('button', { name: 'Link account' }).click();
  await page.waitForURL(`${ORIGIN}/`);
  await useCloudPreferences();
  local = await storage();
  const account = JSON.parse(local.gipfAccount);
  assert.deepEqual([account.v, account.usernameId, account.username], [3, oldU, 'browser-player@synthetic.example']);
  assert.ok(!Object.values(local).some(v => v.includes('sk-ant-')), 'no key anywhere in localStorage');
  const identity = JSON.parse(redis('GET', redis('KEYS', 'gipf:identity:v1:*')[0]));
  const id = redis('KEYS', 'gipf:identity:v1:*')[0].slice('gipf:identity:v1:'.length);
  assert.deepEqual([identity.data, identity.linked], [oldU, oldU]);
  assert.equal(open(id, 'anthropic', identity.keys.anthropic), 'sk-ant-synthetic-guest-device-key-00000000000000', 'the key set since sign-in is kept');
  assert.equal(redis('GET', `gipf:identity-link:v1:${oldU}`), id);
  pass('old account links once with its password; device switches to its data id; no key in localStorage');

  // The account page reads the linked settings in place and shows keys only as saved.
  await page.goto(`${ORIGIN}/login`);
  await useCloudPreferences();
  await page.getByText('Signed in as browser-player@synthetic.example').waitFor();
  await page.getByText('Saved ✓').first().waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Link your existing games account' }).count(), 0);
  const html = await page.content();
  assert.ok(!html.includes('sk-ant-'), 'the page never contains a key');
  pass('account page shows linked state and saved keys without the key');

  // Catan's rules assistant uses the account key server-side; settings load from the old account.
  await page.goto(`${ORIGIN}/catan`);
  await page.waitForLoadState('networkidle');
  const answer = await page.evaluate(async () => {
    const r = await fetch('/api/catanRules', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Games-Request': '1' }, body: JSON.stringify({ context: {}, messages: [{ role: 'user', content: 'How does the robber work?' }] }) });
    return { status: r.status, body: await r.text() };
  });
  assert.equal(answer.status, 200);
  assert.ok(!answer.body.includes('sk-ant-'));
  assert.deepEqual(upstream.anthropic, ['sk-ant-synthetic-guest-device-key-00000000000000']);
  const settings = await page.evaluate(async () => (await fetch('/api/chessProfile', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Games-Request': '1' }, body: JSON.stringify({ action: 'read', scope: 'settings' }) })).json());
  assert.equal(settings.profile.preferences.catanDarkMode, 'true');
  pass('Catan AI request uses the account key on the server; linked settings read in place');

  // Sign out: cookie cleared, server session revoked, device keys and marker gone.
  await page.goto(`${ORIGIN}/login`);
  await useCloudPreferences();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await page.getByText('Signed out of Games.').waitFor();
  assert.ok(!(await context.cookies(ORIGIN)).some(c => c.name === '__Host-games_session'));
  local = await storage();
  assert.equal(local.gipfAccount, undefined);
  assert.equal(local.gipfAccountKeys, undefined);
  assert.equal(redis('KEYS', 'gipf:session:v1:*').length, 0);
  pass('sign-out clears the cookie, the server session, the identity and the key marker');

  // Signing in again is silent (the provider session survives Games sign-out) and offers no link.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/`);
  assert.equal(JSON.parse((await storage()).gipfAccount).usernameId, oldU);
  // "Use a different account" asks the provider for credentials.
  await page.goto(`${ORIGIN}/login`);
  await useCloudPreferences();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await page.getByText('Signed out of Games.').waitFor();
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await page.waitForURL(`${ORIGIN}/`);
  assert.deepEqual(provider.prompts, [null, null, 'login']);
  pass('second sign-in is silent and lands on the linked data; "Use a different account" sends prompt=login');

  for (const path of ['/yinsh', '/zertz', '/chess', '/catan', '/splendor', '/diplomacy']) {
    await page.goto(`${ORIGIN}${path}`);
    await page.reload();
    await page.waitForLoadState('networkidle');
    assert.ok((await page.locator('#root').innerHTML()).length > 100, path);
  }
  pass('all six games load and survive a refresh');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
  redis('FLUSHDB');
}
console.log('PASS synthetic Auth0 browser flow; disposable Redis flushed');
