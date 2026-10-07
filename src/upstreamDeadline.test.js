/** @jest-environment node */

// Upstream timeout classification and whole-request deadline budget, shared by
// the model-proxy functions (server/upstreamDeadline.js).

import { isUpstreamTimeout, upstreamBudgetMs } from '../server/upstreamDeadline.js';
import diplomacy from '../api/diplomacyAgent.js';
import catan from '../api/catanRules.js';
import splendor from '../api/splendorRules.js';

const STORE_URL = 'https://synthetic.invalid';

function dom(name) {
  return Object.assign(new Error('timed out'), { name });
}
function coded(code) {
  return Object.assign(new Error('socket'), { code });
}
const wrapped = (cause) => new TypeError('fetch failed', { cause });

describe('isUpstreamTimeout', () => {
  test.each([
    ['direct TimeoutError', dom('TimeoutError')],
    ['direct AbortError', dom('AbortError')],
    ['TypeError caused by TimeoutError', wrapped(dom('TimeoutError'))],
    ['TypeError caused by AbortError', wrapped(dom('AbortError'))],
    ['undici connect timeout', wrapped(coded('UND_ERR_CONNECT_TIMEOUT'))],
    ['undici headers timeout', wrapped(coded('UND_ERR_HEADERS_TIMEOUT'))],
    ['undici body timeout', wrapped(coded('UND_ERR_BODY_TIMEOUT'))],
  ])('%s is a timeout', (_n, err) => expect(isUpstreamTimeout(err)).toBe(true));

  test.each([
    ['plain Error', new Error('boom')],
    ['bare TypeError', new TypeError('x is not a function')],
    ['TypeError with unrelated cause', wrapped(coded('ECONNREFUSED'))],
    ['non-TypeError with timeout code', coded('UND_ERR_CONNECT_TIMEOUT')],
    ['null', null],
  ])('%s is not a timeout', (_n, err) => expect(isUpstreamTimeout(err)).toBe(false));
});

describe('upstreamBudgetMs', () => {
  test('leaves the function margin after time already spent', () => {
    expect(upstreamBudgetMs({ startedAt: 0, now: 0 })).toBe(18500);
    expect(upstreamBudgetMs({ startedAt: 0, now: 2800 })).toBe(15700);
  });
  test('never drops below the floor', () => {
    expect(upstreamBudgetMs({ startedAt: 0, now: 19000 })).toBe(2000);
    expect(upstreamBudgetMs({ startedAt: 0, now: 25000, floorMs: 500 })).toBe(500);
  });
});

function makeRes() {
  return {
    statusCode: null, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
}
const req = (body) => ({ method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body });

describe.each([
  ['diplomacy', diplomacy, { apiKey: 'sk-secret', power: 'france' }],
  ['catan', catan, { apiKey: 'sk-secret', messages: [{ role: 'user', content: 'hi' }] }],
  ['splendor', splendor, { apiKey: 'sk-secret', messages: [{ role: 'user', content: 'hi' }] }],
])('%s proxy', (_name, handler, body) => {
  let upstream;
  let original;
  const env = {};
  beforeEach(() => {
    original = global.fetch;
    for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN']) env[k] = process.env[k];
    process.env.KV_REST_API_URL = STORE_URL;
    process.env.KV_REST_API_TOKEN = 'synthetic';
    upstream = jest.fn();
    let n = 0;
    global.fetch = jest.fn((url, opts) => {
      if (url === STORE_URL) return Promise.resolve({ ok: true, json: async () => ({ result: ++n }) });
      return upstream(url, opts);
    });
  });
  afterEach(() => {
    global.fetch = original;
    for (const k of Object.keys(env)) {
      if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    }
    jest.restoreAllMocks();
  });

  test.each([
    ['direct TimeoutError', () => dom('TimeoutError')],
    ['wrapped TimeoutError', () => wrapped(dom('TimeoutError'))],
    ['undici headers timeout', () => wrapped(coded('UND_ERR_HEADERS_TIMEOUT'))],
  ])('%s returns 504 without echoing the key', async (_n, make) => {
    upstream.mockRejectedValue(make());
    const res = makeRes();
    await handler(req({ ...body }), res);
    expect(res.statusCode).toBe(504);
    expect(res.body.error).toBe('upstream_timeout');
    expect(JSON.stringify(res.body)).not.toContain('sk-secret');
  });

  test('an unrelated TypeError stays a 500', async () => {
    upstream.mockRejectedValue(new TypeError('bad'));
    const res = makeRes();
    await handler(req({ ...body }), res);
    expect(res.statusCode).toBe(500);
  });

  test('the upstream deadline shrinks by time already spent in the request', async () => {
    upstream.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"message":"Hi."}' }] }) });
    const spy = jest.spyOn(AbortSignal, 'timeout');
    // Handler entry reads t=0; every later read says 5 s have passed.
    let first = true;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      if (first) { first = false; return 0; }
      return 5000;
    });
    await handler(req({ ...body }), makeRes());
    expect(spy.mock.calls.map((c) => c[0])).toContain(13500);
  });
});
