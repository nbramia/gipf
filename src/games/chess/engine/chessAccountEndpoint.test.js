// Focused HTTP contract; tests/account-redis.test.mjs runs actual Lua in Redis.
import handler from '../../../../api/chessAccount.js';
import { hash } from '../../../../server/publicSecurity.js';
const u = 'a'.repeat(64), auth = 'b'.repeat(64);
const enc = { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA==' };
const res = () => ({ statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
const req = body => ({ method: 'POST', headers: {}, socket: { remoteAddress: '192.0.2.1' }, body });
let oldSignal;
beforeEach(() => {
  process.env.KV_REST_API_URL = 'https://synthetic.invalid';
  process.env.KV_REST_API_TOKEN = 'synthetic';
  oldSignal = global.AbortSignal;
  global.AbortSignal = { timeout: () => undefined };
});
afterEach(() => { delete global.fetch; global.AbortSignal = oldSignal; });
test('missing durable store fails closed', async () => {
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  const response = res(); await handler(req({ action: 'login', u, auth }), response);
  expect(response.statusCode).toBe(503);
});
test('legacy encrypted envelopes are returned unchanged after ownership proof', async () => {
  global.fetch = jest.fn(async (_url, options) => {
    const command = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: command[0] === 'GET' ? JSON.stringify({ authHash: hash(auth), enc, encLichess: enc }) : 1 }) };
  });
  const response = res(); await handler(req({ action: 'login', u, auth }), response);
  expect(response.statusCode).toBe(200); expect(response.body.enc).toEqual(enc); expect(response.body.encLichess).toEqual(enc);
  const denied = res(); await handler(req({ action: 'login', u, auth: 'c'.repeat(64) }), denied);
  expect(denied.statusCode).toBe(401);
});
test('account creation uses SET NX and cannot overwrite a taken username', async () => {
  global.fetch = jest.fn(async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'SET') expect(command[3]).toBe('NX');
    return { ok: true, json: async () => ({ result: command[0] === 'SET' ? null : 1 }) };
  });
  const response = res(); await handler(req({ action: 'create', u, auth, enc }), response);
  expect(response.statusCode).toBe(409);
});
test('malformed and oversized requests fail before storage', async () => {
  global.fetch = jest.fn();
  for (const [body, status] of [['{', 400], ['x'.repeat(13000), 413]]) {
    const response = res(); await handler(req(body), response); expect(response.statusCode).toBe(status);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});
