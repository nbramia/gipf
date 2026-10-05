// Focused HTTP contract; tests/auth-oidc-redis.test.mjs runs the account actions in Redis.
import handler from '../../../../api/chessAccount.js';
const u = 'a'.repeat(64), auth = 'b'.repeat(64);
const res = () => ({ statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
const req = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '192.0.2.1' }, body });
let oldSignal;
beforeEach(() => {
  process.env.KV_REST_API_URL = 'https://synthetic.invalid';
  process.env.KV_REST_API_TOKEN = 'synthetic';
  oldSignal = global.AbortSignal;
  global.AbortSignal = { timeout: () => undefined };
});
afterEach(() => { delete global.fetch; global.AbortSignal = oldSignal; });
// Rate-limit counters answer 1; nothing else is stored.
const store = () => jest.fn(async () => ({ ok: true, json: async () => ({ result: 1 }) }));

test('missing durable store fails closed', async () => {
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  const response = res(); await handler(req({ action: 'setKeys', anthropic: null }), response);
  expect(response.statusCode).toBe(503);
});
test.each(['create', 'login', 'setKey'])('the retired password action %s returns 410', async action => {
  global.fetch = store();
  const response = res(); await handler(req({ action, u, auth, enc: null }), response);
  expect(response.statusCode).toBe(410);
  expect(response.body).toEqual({ error: 'retired' });
});
test.each([{ action: 'setKeys', anthropic: 'sk-ant-synthetic' }, { action: 'link-verify', u, auth }])('%p without a session cookie is 401', async body => {
  global.fetch = store();
  const response = res(); await handler(req(body), response);
  expect(response.statusCode).toBe(401);
});
test('unknown actions and malformed keys are refused', async () => {
  global.fetch = store();
  for (const body of [{ action: 'other' }, { action: 'setKeys', anthropic: 7 }, { action: 'setKeys', lichess: 'has space' }]) {
    const response = res(); await handler(req(body), response); expect(response.statusCode).toBe(400);
  }
});
test('malformed and oversized requests fail before storage', async () => {
  global.fetch = jest.fn();
  for (const [body, status] of [['{', 400], ['x'.repeat(13000), 413]]) {
    const response = res(); await handler(req(body), response); expect(response.statusCode).toBe(status);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});
