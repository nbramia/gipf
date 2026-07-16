// Smoke test for the chess account serverless endpoint. Vercel KV (Upstash
// REST) is mocked via global.fetch — no real store, no network in CI.
// Covers: { configured: false } with no KV env, create/login/setKey
// contracts, and — the point of this suite — that adding the optional
// encLichess sibling never breaks or wipes an existing enc (or vice versa)
// for legacy clients that only ever send one of the two fields.

// The handler reads KV_REST_API_URL/KV_REST_API_TOKEN into module-level
// consts at import time, so each test resets the module registry and
// re-imports *after* setting/unsetting env vars for that test.
async function loadHandler() {
  jest.resetModules();
  const mod = await import('../../../../api/chessAccount.js');
  return mod.default;
}

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

const U = 'a'.repeat(64);
const AUTH = 'b'.repeat(64);
const VALID_ENC = { iv: 'aXY=', ct: 'Y3Q=' };
const VALID_ENC_LICHESS = { iv: 'bGl2', ct: 'bGlj' };

let origKvUrl;
let origKvToken;

function setKvEnv() {
  process.env.KV_REST_API_URL = 'https://example-kv.upstash.io';
  process.env.KV_REST_API_TOKEN = 'test-token';
}

function unsetKvEnv() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
}

// Mocks the Upstash REST get/set surface. `records` maps accountKey -> record
// (or undefined for "no record"). Captures every `set` call body so tests can
// assert exactly what got written.
function mockKv(records) {
  const setCalls = [];
  const fetchMock = jest.fn(async (url, opts) => {
    if (url.includes('/get/')) {
      const key = decodeURIComponent(url.split('/get/')[1]);
      const record = records[key];
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: record ? JSON.stringify(record) : null }),
      };
    }
    if (url.includes('/set/')) {
      const key = decodeURIComponent(url.split('/set/')[1]);
      const value = JSON.parse(opts.body);
      records[key] = value;
      setCalls.push({ key, value });
      return { ok: true, status: 200, json: async () => ({ result: 'OK' }) };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
  global.fetch = fetchMock;
  return { fetchMock, setCalls, records };
}

beforeEach(() => {
  origKvUrl = process.env.KV_REST_API_URL;
  origKvToken = process.env.KV_REST_API_TOKEN;
});

afterEach(() => {
  if (origKvUrl === undefined) delete process.env.KV_REST_API_URL;
  else process.env.KV_REST_API_URL = origKvUrl;
  if (origKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = origKvToken;
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('chessAccount endpoint', () => {
  test('{ configured: false } when KV env is unset (no fetch call)', async () => {
    unsetKvEnv();
    const handler = await loadHandler();
    global.fetch = jest.fn();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'create', u: U, auth: AUTH } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ configured: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('bad id/auth hex returns 400', async () => {
    setKvEnv();
    const handler = await loadHandler();
    mockKv({});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'create', u: 'not-hex', auth: AUTH, enc: VALID_ENC } }), res);
    expect(res.statusCode).toBe(400);

    const res2 = makeRes();
    await handler(makeReq({ body: { action: 'create', u: U, auth: 'short', enc: VALID_ENC } }), res2);
    expect(res2.statusCode).toBe(400);
  });

  describe('create', () => {
    test('valid create with both ciphertexts stores authHash, enc, and encLichess', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const { setCalls } = mockKv({});
      const res = makeRes();
      await handler(
        makeReq({ body: { action: 'create', u: U, auth: AUTH, enc: VALID_ENC, encLichess: VALID_ENC_LICHESS } }),
        res
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ configured: true, created: true });
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0].value.enc).toEqual(VALID_ENC);
      expect(setCalls[0].value.encLichess).toEqual(VALID_ENC_LICHESS);
      expect(setCalls[0].value.authHash).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof setCalls[0].value.createdAt).toBe('number');
    });

    test('invalid encLichess shape returns 400 and never writes', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const { setCalls } = mockKv({});
      const res = makeRes();
      await handler(
        makeReq({ body: { action: 'create', u: U, auth: AUTH, enc: VALID_ENC, encLichess: { iv: 'x' } } }),
        res
      );
      expect(res.statusCode).toBe(400);
      expect(setCalls).toHaveLength(0);
    });

    test('encLichess omitted is stored as null', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const { setCalls } = mockKv({});
      const res = makeRes();
      await handler(makeReq({ body: { action: 'create', u: U, auth: AUTH, enc: VALID_ENC } }), res);
      expect(res.statusCode).toBe(200);
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0].value.encLichess).toBeNull();
      expect(setCalls[0].value.enc).toEqual(VALID_ENC);
    });
  });

  describe('login', () => {
    test('returns both enc and encLichess for a full record', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const key = `chess:account:${U}`;
      const authHash = require('crypto').createHash('sha256').update(AUTH).digest('hex');
      mockKv({ [key]: { authHash, enc: VALID_ENC, encLichess: VALID_ENC_LICHESS, createdAt: 123 } });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'login', u: U, auth: AUTH } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ configured: true, enc: VALID_ENC, encLichess: VALID_ENC_LICHESS });
    });

    test('legacy record without encLichess -> encLichess is null', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const key = `chess:account:${U}`;
      const authHash = require('crypto').createHash('sha256').update(AUTH).digest('hex');
      mockKv({ [key]: { authHash, enc: VALID_ENC, createdAt: 123 } }); // no encLichess field at all
      const res = makeRes();
      await handler(makeReq({ body: { action: 'login', u: U, auth: AUTH } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ configured: true, enc: VALID_ENC, encLichess: null });
    });
  });

  describe('setKey', () => {
    function existingRecord({ enc = VALID_ENC, encLichess = null } = {}) {
      const authHash = require('crypto').createHash('sha256').update(AUTH).digest('hex');
      return { authHash, enc, encLichess, createdAt: 555 };
    }

    test('setKey with only enc preserves existing encLichess', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const key = `chess:account:${U}`;
      const { setCalls } = mockKv({ [key]: existingRecord({ enc: VALID_ENC, encLichess: VALID_ENC_LICHESS }) });
      const newEnc = { iv: 'bmV3', ct: 'bmV3Y3Q=' };
      const res = makeRes();
      await handler(makeReq({ body: { action: 'setKey', u: U, auth: AUTH, enc: newEnc } }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ configured: true, saved: true });
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0].value.enc).toEqual(newEnc);
      expect(setCalls[0].value.encLichess).toEqual(VALID_ENC_LICHESS);
      expect(setCalls[0].value.authHash).toBe(existingRecord().authHash);
      expect(setCalls[0].value.createdAt).toBe(555);
    });

    test('setKey with only encLichess preserves existing enc', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const key = `chess:account:${U}`;
      const { setCalls } = mockKv({ [key]: existingRecord({ enc: VALID_ENC, encLichess: null }) });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'setKey', u: U, auth: AUTH, encLichess: VALID_ENC_LICHESS } }), res);
      expect(res.statusCode).toBe(200);
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0].value.enc).toEqual(VALID_ENC);
      expect(setCalls[0].value.encLichess).toEqual(VALID_ENC_LICHESS);
    });

    test('setKey with neither enc nor encLichess returns 400', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const key = `chess:account:${U}`;
      const { setCalls } = mockKv({ [key]: existingRecord() });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'setKey', u: U, auth: AUTH } }), res);
      expect(res.statusCode).toBe(400);
      expect(setCalls).toHaveLength(0);
    });

    test('setKey with explicit null enc returns 400', async () => {
      setKvEnv();
      const handler = await loadHandler();
      const key = `chess:account:${U}`;
      mockKv({ [key]: existingRecord() });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'setKey', u: U, auth: AUTH, enc: null } }), res);
      expect(res.statusCode).toBe(400);
    });
  });
});
