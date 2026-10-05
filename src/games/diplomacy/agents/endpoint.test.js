/** @jest-environment node */

// Smoke test for the Diplomacy agent serverless endpoint. The Anthropic upstream
// and Redis transport are mocked — no real key, no network in CI. Asserts
// CORS/preflight, the BYO-key security contract (missing key -> 401 with no upstream call, exactly one
// upstream call on success), and the { message, scratchpad } response schema.

import handler from '../../../../api/diplomacyAgent.js';

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

function makeReq({ method = 'POST', origin = 'http://localhost:3000', body = {} } = {}) {
  return { method, headers: { origin }, body };
}

const VALID_SCRATCHPAD = {
  self: 'france',
  dispositions: {
    england: { trust: 0.2, stance: 'rival', intent: 'Lure into NTH, stab in Fall.', note: 'Offered DMZ.' },
  },
  priority: 'Take Belgium; keep Italy calm.',
  confidence: 0.6,
};

function mockUpstreamText(text) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
  });
}

// Match the synthetic Redis transport used in tests/ai-security.test.mjs.
// Keep guardRequest real: only the external I/O is replaced, with a fresh
// counter per test. Provider assertions deliberately exclude Redis calls.
const STORE_URL = 'https://synthetic.invalid';
const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'NODE_ENV'];
let upstreamFetch;
let storeFetch;
let originalFetch;
let originalEnv;

beforeEach(() => {
  originalFetch = global.fetch;
  originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  process.env.KV_REST_API_URL = STORE_URL;
  process.env.KV_REST_API_TOKEN = 'synthetic';
  const counts = new Map();
  upstreamFetch = jest.fn();
  storeFetch = jest.fn(async (_url, options) => {
    const [command, script, keyCount, key, seconds] = JSON.parse(options.body);
    expect(command).toBe('EVAL');
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('EXPIRE'");
    expect(keyCount).toBe(1);
    expect(key).toMatch(/^gipf:limit:ai:[a-f0-9]{64}$/);
    expect(seconds).toBe(60);
    counts.set(key, (counts.get(key) || 0) + 1);
    return { ok: true, json: async () => ({ result: counts.get(key) }) };
  });
  global.fetch = jest.fn((url, options) => {
    if (url === STORE_URL) return storeFetch(url, options);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    return upstreamFetch(url, options);
  });
});

afterEach(() => {
  if (originalFetch === undefined) delete global.fetch;
  else global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  jest.restoreAllMocks();
});

describe('diplomacyAgent endpoint', () => {
  test('production without any configured store fails closed before provider fetch', async () => {
    process.env.NODE_ENV = 'production';
    for (const key of ENV_KEYS.filter(key => key !== 'NODE_ENV')) delete process.env[key];
    const res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france' } }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'service_unavailable' });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the real guard enforces the AI limit before any provider call', async () => {
    for (let i = 0; i < 30; i++) {
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(401);
    }
    const res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france' } }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(res.headers['Retry-After']).toBe('60');
    expect(storeFetch).toHaveBeenCalledTimes(31);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', '{', 400],
    ['array', [], 400],
    ['oversized object', { context: 'x'.repeat(33000) }, 413],
  ])('%s is rejected before storage or provider I/O', async (_label, body, status) => {
    const res = makeRes();
    await handler(makeReq({ body }), res);
    expect(res.statusCode).toBe(status);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('OPTIONS preflight from an allowed origin returns 204 with CORS headers', async () => {
    upstreamFetch = jest.fn();
    const req = makeReq({ method: 'OPTIONS', origin: 'http://localhost:3000' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(res.headers['Vary']).toBe('Origin');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a non-allowlisted origin gets no Access-Control-Allow-Origin header', async () => {
    upstreamFetch = jest.fn();
    const req = makeReq({ method: 'OPTIONS', origin: 'https://evil.example.com' });
    const res = makeRes();
    await handler(req, res);

    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(res.headers['Vary']).toBe('Origin');
  });

  test('non-POST method returns 405', async () => {
    upstreamFetch = jest.fn();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  test('missing API key returns 401 missing_api_key with NO upstream fetch', async () => {
    upstreamFetch = jest.fn();
    const res = makeRes();
    await handler(makeReq({ body: { power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'missing_api_key', message: expect.any(String) });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  test('empty messages are synthesized into one priming turn (no 400)', async () => {
    // The first AI<->AI proposal in a channel opens with no transcript; the
    // endpoint must synthesize a priming turn, not reject it.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Greetings.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france' } }), res);
    expect(res.statusCode).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(upstreamFetch.mock.calls[0][1].body);
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].role).toBe('user');
  });

  test('valid request returns 200 { message, scratchpad } and calls upstream exactly once', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Brest is ours. Stay out of the Channel.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({
        body: {
          apiKey: 'sk-test',
          power: 'france',
          persona: { name: 'France' },
          context: { phase: 'Spring 1901 orders' },
          messages: [{ role: 'user', content: 'Can we agree on a DMZ in the Channel?' }],
        },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body.scratchpad).toEqual(VALID_SCRATCHPAD);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  test('upstream gets the BYO key, anthropic-version, and a cached system array', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Understood.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-secret', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );

    const [url, opts] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-secret');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const payload = JSON.parse(opts.body);
    expect(payload.model).toBe('claude-sonnet-4-6');
    expect(Array.isArray(payload.system)).toBe(true);
    expect(payload.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('body.model overrides the default model', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'ok', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-test', model: 'claude-opus-4-8', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    const payload = JSON.parse(upstreamFetch.mock.calls[0][1].body);
    expect(payload.model).toBe('claude-opus-4-8');
  });

  test('visible message contains no markdown headers or bold', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'No markdown here, just prose about Belgium.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    expect(res.body.message).not.toMatch(/^#+\s/m);
    expect(res.body.message).not.toMatch(/\*\*/);
  });

  test('malformed scratchpad becomes null without throwing, message still returned', async () => {
    upstreamFetch = mockUpstreamText(
      JSON.stringify({ message: 'We can talk.', scratchpad: { self: 'france', dispositions: { england: { trust: 5, stance: 'bogus' } } } })
    );
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('We can talk.');
    expect(res.body.scratchpad).toBeNull();
  });

  test('non-JSON model output still yields a plain-text message and null scratchpad', async () => {
    upstreamFetch = mockUpstreamText('Just a bare sentence, no JSON at all.');
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Just a bare sentence, no JSON at all.');
    expect(res.body.scratchpad).toBeNull();
  });

  test('upstream 401 maps to 401; other upstream errors map to 502', async () => {
    upstreamFetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-bad', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.statusCode).toBe(401);

    upstreamFetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.statusCode).toBe(502);
  });

  test('an emitted summary (<=200 chars) is returned; oversized/absent become empty', async () => {
    // Valid summary surfaces.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Aligned.', scratchpad: VALID_SCRATCHPAD, summary: 'DMZ in the Channel holds.' }));
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.summary).toBe('DMZ in the Channel holds.');

    // Oversized summary is dropped to ''.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Aligned.', scratchpad: VALID_SCRATCHPAD, summary: 'x'.repeat(201) }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.summary).toBe('');

    // Absent summary is ''.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Aligned.', scratchpad: VALID_SCRATCHPAD }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.summary).toBe('');
  });

  test('prior memory (priorSummary/memory) is injected into the system prompt', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Understood.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({
        body: {
          apiKey: 'sk-test',
          power: 'france',
          messages: [{ role: 'user', content: 'hi' }],
          priorSummary: 'We agreed to a Channel DMZ last phase.',
          memory: 'stance rival; intent: lure into NTH',
        },
      }),
      res
    );
    const payload = JSON.parse(upstreamFetch.mock.calls[0][1].body);
    const systemText = payload.system[0].text;
    expect(systemText).toContain('We agreed to a Channel DMZ last phase.');
    expect(systemText).toContain('Previously with this rival:');
    expect(systemText).toContain('lure into NTH');
  });

  test('a well-formed deal is returned; a malformed one becomes null', async () => {
    // Valid support deal surfaces.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Agreed — I cover Belgium.', scratchpad: VALID_SCRATCHPAD, deal: { type: 'support', to: 'BEL' } }));
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.deal).toEqual({ type: 'support', to: 'BEL' });

    // Malformed deal (support with no province) drops to null.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Sure.', scratchpad: VALID_SCRATCHPAD, deal: { type: 'support' } }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.deal).toBeNull();

    // Absent deal is null.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Maybe later.', scratchpad: VALID_SCRATCHPAD }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.deal).toBeNull();
  });

  test('a support deal with a mover province (from) validates; a bad from drops the deal', async () => {
    // New schema: from = province of the supported mover, optional.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'I back your Picardy army into Belgium.', scratchpad: VALID_SCRATCHPAD, deal: { type: 'support', from: 'pic', to: 'bel' } }));
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.deal).toEqual({ type: 'support', from: 'pic', to: 'bel' });

    // Malformed from (not a province id) invalidates the deal.
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Sure.', scratchpad: VALID_SCRATCHPAD, deal: { type: 'support', from: 'not-a-province', to: 'bel' } }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.deal).toBeNull();
  });

  test('a proposedDeal is rendered into the system prompt with the accept requirement', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Agreed.', scratchpad: VALID_SCRATCHPAD, accept: true }));
    const res = makeRes();
    await handler(
      makeReq({
        body: {
          apiKey: 'sk-test',
          power: 'germany',
          counterparties: ['france'],
          messages: [{ role: 'user', content: 'A DMZ in Burgundy?' }],
          proposedDeal: { type: 'dmz', provinces: ['bur'] },
        },
      }),
      res
    );
    const systemText = JSON.parse(upstreamFetch.mock.calls[0][1].body).system[0].text;
    expect(systemText).toContain('PENDING PROPOSAL');
    expect(systemText).toContain('"provinces":["bur"]');
    expect(systemText).toContain('"accept": true or false');
    expect(res.body.accept).toBe(true);
  });

  test('accept is a strict boolean in the response: false passes, junk becomes null', async () => {
    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Never.', scratchpad: VALID_SCRATCHPAD, accept: false }));
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.accept).toBe(false);

    upstreamFetch = mockUpstreamText(JSON.stringify({ message: 'Hm.', scratchpad: VALID_SCRATCHPAD, accept: 'yes' }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.accept).toBeNull();

    // No PENDING PROPOSAL section when no proposedDeal was sent.
    const systemText = JSON.parse(upstreamFetch.mock.calls[0][1].body).system[0].text;
    expect(systemText).not.toContain('has formally proposed this deal');
  });

  test('a thrown error returns a generic 500 that never echoes the request body', async () => {
    upstreamFetch = jest.fn().mockRejectedValue(new Error('network down'));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-supersecret', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('sk-supersecret');
  });
});
