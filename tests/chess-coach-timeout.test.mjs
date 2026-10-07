import test from 'node:test';
import assert from 'node:assert/strict';
import chess, { isTimeoutError, upstreamTimeoutMs } from '../api/chessCoach.js';

const req = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '192.0.2.77' }, body });
const res = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
process.env.KV_REST_API_URL = 'https://synthetic.invalid';
process.env.KV_REST_API_TOKEN = 'synthetic';

const named = (name, extra = {}) => Object.assign(new Error(name), { name }, extra);

test('isTimeoutError recognises aborts, undici codes and wrapped causes', () => {
  assert.ok(isTimeoutError(named('TimeoutError')));
  assert.ok(isTimeoutError(named('AbortError')));
  assert.ok(isTimeoutError(new TypeError('fetch failed', { cause: named('TimeoutError') })));
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
    assert.ok(isTimeoutError(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code }) })));
  }
  assert.ok(!isTimeoutError(new Error('boom')));
  assert.ok(!isTimeoutError(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) })));
  assert.ok(!isTimeoutError(null));
});

test('upstream timeout is the remaining deadline with a floor', () => {
  const t0 = 1_000_000;
  assert.equal(upstreamTimeoutMs(t0, t0), 18500); // 20s function - 1.5s margin
  assert.equal(upstreamTimeoutMs(t0, t0 + 2000), 16500); // guard/key time is deducted
  assert.equal(upstreamTimeoutMs(t0, t0 + 17000), 1500); // never past the margin
  assert.ok(upstreamTimeoutMs(t0, t0 + 19000) <= 0); // exhausted: caller must 504
});

const withFetch = (upstream) => async (url, opts) => {
  if (url === 'https://synthetic.invalid') return { ok: true, json: async () => ({ result: 1 }) };
  return upstream(url, opts);
};

test('commentary upstream timeout returns 504 upstream_timeout without echoing the key', async () => {
  let signalMs;
  globalThis.fetch = withFetch(async (_u, opts) => {
    assert.ok(opts.signal);
    throw new TypeError('fetch failed', { cause: named('TimeoutError') });
  });
  const r = res();
  await chess(req({ apiKey: 'sk-synthetic-secret', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }), r);
  assert.equal(r.statusCode, 504);
  assert.equal(r.body.error, 'upstream_timeout');
  assert.ok(!JSON.stringify(r.body).includes('sk-synthetic-secret'));
  void signalMs;
});

test('thread upstream timeout returns 504; other failures stay 500', async () => {
  globalThis.fetch = withFetch(async () => { throw named('AbortError'); });
  const t = res();
  await chess(req({ apiKey: 'k', mode: 'thread', messages: [{ role: 'user', content: 'hi' }], context: {} }), t);
  assert.equal(t.statusCode, 504);
  assert.equal(t.body.error, 'upstream_timeout');

  globalThis.fetch = withFetch(async () => { throw new Error('boom'); });
  const o = res();
  await chess(req({ apiKey: 'k', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }), o);
  assert.equal(o.statusCode, 500);
  assert.equal(o.body.error, 'server_error');
});

// Handler-level: the deadline starts at handler entry, so time spent in the
// guard / key lookup is deducted from the upstream signal.
async function runWithClock(guardMs) {
  const realNow = Date.now;
  const realTimeout = AbortSignal.timeout;
  let clock = 5_000_000;
  const timeouts = [];
  Date.now = () => clock;
  AbortSignal.timeout = (ms) => { timeouts.push(ms); return realTimeout.call(AbortSignal, 60000); };
  let upstreamCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === 'https://synthetic.invalid') { clock += guardMs; return { ok: true, json: async () => ({ result: 1 }) }; }
    upstreamCalls += 1;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }] }) };
  };
  try {
    const r = res();
    await chess(req({ apiKey: 'k', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }), r);
    return { r, timeouts, upstreamCalls };
  } finally {
    Date.now = realNow;
    AbortSignal.timeout = realTimeout;
  }
}

test('upstream signal deducts guard time spent since handler entry', async () => {
  const { r, timeouts } = await runWithClock(5000);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(timeouts.slice(-1), [13500]); // 20000 - 1500 - 5000
});

test('exhausted budget returns 504 without calling the provider', async () => {
  const { r, upstreamCalls } = await runWithClock(19000);
  assert.equal(r.statusCode, 504);
  assert.equal(r.body.error, 'upstream_timeout');
  assert.equal(upstreamCalls, 0);
});
