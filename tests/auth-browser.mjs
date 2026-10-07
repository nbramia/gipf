// Local end-to-end Auth0 sign-in in a real browser, against a synthetic OpenID provider.
//
// Auth0 accepts only the exact production callback, so preview deployments cannot sign
// in. This drives the built app as https://play.ramia.us in Chromium,
// with every request to that origin and to the synthetic issuer answered by this
// process: the real API handlers, a disposable play-test-* Redis, and a provider that
// signs ID tokens with a throwaway key. Nothing reaches Auth0, Anthropic, Lichess or a
// shared store. It covers: the catalogue's and /login's automatic prompt=none attempt
// failing quietly with no provider session (once, no loop), /login completing on its own
// once the provider has a session (as after signing in at home.ramia.us), host-only
// cookies, keys never in the page, a model request using the account key, sign-out
// suppressing the automatic attempt, the clicked silent sign-in, and prompt=login.
//
//   docker run --rm -d --name play-test-auth-browser redis:7-alpine
//   npm run build
//   PLAY_TEST_REDIS_CONTAINER=play-test-auth-browser PLAYWRIGHT_MODULE=/path/to/playwright node tests/auth-browser.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import { useTestKeyCustody } from './session-fixture.mjs';
import auth from '../api/auth.js';
import session from '../api/session.js';
import chessAccount from '../api/chessAccount.js';
import chessProfile from '../api/chessProfile.js';
import catanRules from '../api/catanRules.js';
import chessCoach from '../api/chessCoach.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ISSUER = 'https://synthetic-tenant.auth0.example';
const ORIGIN = 'https://play.ramia.us';
const CLIENT_ID = 'synthetic-play-client', CLIENT_SECRET = 'synthetic-play-client-secret';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

redis('FLUSHDB');
useTestKeyCustody();
Object.assign(process.env, { KV_REST_API_URL: 'https://synthetic.invalid/', KV_REST_API_TOKEN: 'synthetic', AUTH0_ISSUER_BASE_URL: ISSUER, AUTH0_CLIENT_ID: CLIENT_ID, AUTH0_CLIENT_SECRET: CLIENT_SECRET, GAMES_SESSION_SECRET: 'synthetic-session-secret-0123456789abcdef' });

// --- the synthetic provider and upstreams, reached by the handlers' fetch -----------
// `session`: whether the provider has its own sign-in open (as after signing in at Home).
const provider = { authorize: null, sub: 'google-oauth2|synthetic-browser-1', authorizations: 0, prompts: [], session: false };
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
    // Auth0's /authorize: an open provider session answers at once; without one,
    // prompt=none is refused with login_required, and anything else stands in for the
    // user entering credentials (which opens the provider session).
    assert.equal(url.pathname, '/authorize');
    provider.authorize = url.searchParams;
    provider.authorizations++;
    const prompt = url.searchParams.get('prompt');
    provider.prompts.push(prompt);
    assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/callback`);
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    const state = encodeURIComponent(url.searchParams.get('state'));
    if (prompt === 'none' && !provider.session) {
      res.writeHead(302, { Location: `${ORIGIN}/api/auth/callback?error=login_required&error_description=Login%20required&state=${state}` });
      return res.end();
    }
    provider.session = true;
    res.writeHead(302, { Location: `${ORIGIN}/api/auth/callback?code=synthetic-code&state=${state}` });
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

const GUEST_KEY = 'sk-ant-synthetic-guest-device-key-00000000000000';
const settle = () => page.waitForLoadState('networkidle');

try {
  // No provider session: the catalogue's one automatic attempt is refused and comes
  // straight back; a reload in the same browser session does not try again.
  await page.goto(`${ORIGIN}/`);
  await page.getByRole('link', { name: 'Sign in' }).waitFor();
  await settle();
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(provider.prompts, ['none']);
  await page.reload();
  await settle();
  assert.deepEqual(provider.prompts, ['none']);
  assert.ok(!(await context.cookies(ORIGIN)).some(c => c.name === '__Host-games_session'));
  pass('catalogue tries prompt=none once, falls back quietly, and does not retry on reload');

  // /login within ten minutes of that attempt shows the button without redirecting.
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.waitForURL(`${ORIGIN}/login`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.deepEqual(provider.prompts, ['none']);
  await page.getByLabel('Anthropic API key').fill(GUEST_KEY);
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByText('Saved on this device.').waitFor();
  assert.equal((await storage()).playApiKey, GUEST_KEY);
  pass('guest reaches /login with no second attempt; guest key is device-only');

  // A fresh /login with no provider session: one prompt=none redirect, back to /login
  // with the Sign in button, and no loop.
  await page.evaluate(() => localStorage.removeItem('play:silent-sign-in-at'));
  await page.goto(`${ORIGIN}/login?return=/chess`);
  await page.waitForURL(`${ORIGIN}/login?silent=failed&return=%2Fchess`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await settle();
  assert.deepEqual(provider.prompts, ['none', 'none']);
  assert.equal(await page.getByRole('alert').count(), 0);
  pass('/login without a provider session: exactly one prompt=none redirect, back to the Sign in button');

  // Signed in at Home (the provider session is open): /login completes on its own.
  provider.session = true;
  await page.evaluate(() => localStorage.setItem('play:silent-sign-in-at', String(Date.now() - 11 * 60000)));
  await page.goto(`${ORIGIN}/login?return=/catan`);
  await page.waitForURL(`${ORIGIN}/catan`, { timeout: 15000 }).catch(async error => {
    console.error('DEBUG url', page.url(), (await page.locator('body').innerText()).slice(0, 600), errors);
    throw error;
  });
  await useCloudPreferences();
  assert.deepEqual(provider.prompts, ['none', 'none', 'none']);
  const cookies = await context.cookies(ORIGIN);
  const sessionCookie = cookies.find(c => c.name === '__Host-games_session');
  assert.ok(sessionCookie && sessionCookie.httpOnly && sessionCookie.secure && sessionCookie.sameSite === 'Lax' && sessionCookie.domain === 'play.ramia.us' && sessionCookie.path === '/');
  assert.ok(!cookies.some(c => c.name === '__Host-games_auth'), 'transaction cookie cleared');
  let local = await storage();
  assert.equal(local.playApiKey, undefined, 'the guest key left the device');
  assert.deepEqual(JSON.parse(local.playAccountKeys), { anthropic: true, lichess: false }, 'and moved to the account');
  assert.equal(JSON.parse(local.playAccount).username, 'browser-player@synthetic.example');
  assert.ok(!Object.values(local).some(v => v.includes('sk-ant-')), 'no key anywhere in localStorage');
  pass('already signed in at the provider: /login auto-completes with no click and lands on the game; host-only cookie; key moved');

  // The account page shows saved keys without the key, and offers no account linking.
  await page.goto(`${ORIGIN}/login`);
  await useCloudPreferences();
  await page.getByText('Signed in as browser-player@synthetic.example').waitFor();
  await page.getByText('Saved ✓').first().waitFor();
  assert.equal(await page.getByRole('heading', { name: /Link your existing/ }).count(), 0);
  assert.ok(!(await page.content()).includes('sk-ant-'), 'the page never contains a key');
  pass('account page shows saved keys without the key and no link form');

  // Catan's rules assistant uses the account key server-side.
  await page.goto(`${ORIGIN}/catan`);
  await settle();
  const answer = await page.evaluate(async () => {
    const r = await fetch('/api/catanRules', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Games-Request': '1' }, body: JSON.stringify({ context: {}, messages: [{ role: 'user', content: 'How does the robber work?' }] }) });
    return { status: r.status, body: await r.text() };
  });
  assert.equal(answer.status, 200);
  assert.ok(!answer.body.includes('sk-ant-'));
  assert.deepEqual(upstream.anthropic, [GUEST_KEY]);
  pass('Catan AI request uses the account key on the server');

  // Sign out: cookie cleared, server session revoked, and no automatic sign-in back in
  // even though the provider session is still open — on /login or the catalogue.
  await page.goto(`${ORIGIN}/login`);
  await useCloudPreferences();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await page.getByText('Signed out of Games.').waitFor();
  assert.ok(!(await context.cookies(ORIGIN)).some(c => c.name === '__Host-games_session'));
  local = await storage();
  assert.equal(local.playAccount, undefined);
  assert.equal(local.playAccountKeys, undefined);
  assert.equal(redis('KEYS', 'play:session:v1:*').length, 0);
  await page.evaluate(() => { localStorage.removeItem('play:silent-sign-in-at'); sessionStorage.clear(); });
  await page.goto(`${ORIGIN}/login`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await page.goto(`${ORIGIN}/`);
  await page.getByRole('link', { name: 'Sign in' }).waitFor();
  await settle();
  assert.deepEqual(provider.prompts, ['none', 'none', 'none'], 'no attempt after sign-out');
  pass('sign-out clears the session and suppresses the automatic sign-in on /login and the catalogue');

  // Choosing Sign in is silent with the provider session open; "Use a different account" sends prompt=login.
  await page.goto(`${ORIGIN}/login`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${ORIGIN}/`);
  await useCloudPreferences();
  assert.equal(JSON.parse((await storage()).playAccount).username, 'browser-player@synthetic.example');
  assert.equal(await page.evaluate(() => localStorage.getItem('play:silent-sign-in-off')), null, 'Sign in re-enables automatic sign-in');
  await page.goto(`${ORIGIN}/login`);
  await useCloudPreferences();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await page.getByText('Signed out of Games.').waitFor();
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await page.waitForURL(`${ORIGIN}/`);
  assert.deepEqual(provider.prompts, ['none', 'none', 'none', null, 'login']);
  pass('clicked sign-in is silent; "Use a different account" sends prompt=login');

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
