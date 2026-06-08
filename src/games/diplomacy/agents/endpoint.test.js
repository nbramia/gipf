// Smoke test for the Diplomacy agent serverless endpoint. The Anthropic upstream
// is mocked — no real key, no network in CI. Asserts CORS/preflight, the BYO-key
// security contract (missing key -> 401 with no upstream call, exactly one
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

afterEach(() => {
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('diplomacyAgent endpoint', () => {
  test('OPTIONS preflight from an allowed origin returns 204 with CORS headers', async () => {
    global.fetch = jest.fn();
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
    global.fetch = jest.fn();
    const req = makeReq({ method: 'OPTIONS', origin: 'https://evil.example.com' });
    const res = makeRes();
    await handler(req, res);

    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(res.headers['Vary']).toBe('Origin');
  });

  test('non-POST method returns 405', async () => {
    global.fetch = jest.fn();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  test('missing API key returns 401 missing_api_key with NO upstream fetch', async () => {
    global.fetch = jest.fn();
    const res = makeRes();
    await handler(makeReq({ body: { power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'missing_api_key', message: expect.any(String) });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('empty messages are synthesized into one priming turn (no 400)', async () => {
    // The first AI<->AI proposal in a channel opens with no transcript; the
    // endpoint must synthesize a priming turn, not reject it.
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Greetings.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france' } }), res);
    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].role).toBe('user');
  });

  test('valid request returns 200 { message, scratchpad } and calls upstream exactly once', async () => {
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Brest is ours. Stay out of the Channel.', scratchpad: VALID_SCRATCHPAD }));
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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('upstream gets the BYO key, anthropic-version, and a cached system array', async () => {
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Understood.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-secret', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-secret');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const payload = JSON.parse(opts.body);
    expect(payload.model).toBe('claude-sonnet-4-6');
    expect(Array.isArray(payload.system)).toBe(true);
    expect(payload.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('body.model overrides the default model', async () => {
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'ok', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-test', model: 'claude-opus-4-8', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.model).toBe('claude-opus-4-8');
  });

  test('visible message contains no markdown headers or bold', async () => {
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'No markdown here, just prose about Belgium.', scratchpad: VALID_SCRATCHPAD }));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    expect(res.body.message).not.toMatch(/^#+\s/m);
    expect(res.body.message).not.toMatch(/\*\*/);
  });

  test('malformed scratchpad becomes null without throwing, message still returned', async () => {
    global.fetch = mockUpstreamText(
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
    global.fetch = mockUpstreamText('Just a bare sentence, no JSON at all.');
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
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-bad', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.statusCode).toBe(401);

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.statusCode).toBe(502);
  });

  test('an emitted summary (<=200 chars) is returned; oversized/absent become empty', async () => {
    // Valid summary surfaces.
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Aligned.', scratchpad: VALID_SCRATCHPAD, summary: 'DMZ in the Channel holds.' }));
    let res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.summary).toBe('DMZ in the Channel holds.');

    // Oversized summary is dropped to ''.
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Aligned.', scratchpad: VALID_SCRATCHPAD, summary: 'x'.repeat(201) }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.summary).toBe('');

    // Absent summary is ''.
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Aligned.', scratchpad: VALID_SCRATCHPAD }));
    res = makeRes();
    await handler(makeReq({ body: { apiKey: 'sk-test', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }), res);
    expect(res.body.summary).toBe('');
  });

  test('prior memory (priorSummary/memory) is injected into the system prompt', async () => {
    global.fetch = mockUpstreamText(JSON.stringify({ message: 'Understood.', scratchpad: VALID_SCRATCHPAD }));
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
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    const systemText = payload.system[0].text;
    expect(systemText).toContain('We agreed to a Channel DMZ last phase.');
    expect(systemText).toContain('Previously with this rival:');
    expect(systemText).toContain('lure into NTH');
  });

  test('a thrown error returns a generic 500 that never echoes the request body', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const res = makeRes();
    await handler(
      makeReq({ body: { apiKey: 'sk-supersecret', power: 'france', messages: [{ role: 'user', content: 'hi' }] } }),
      res
    );
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('sk-supersecret');
  });
});
