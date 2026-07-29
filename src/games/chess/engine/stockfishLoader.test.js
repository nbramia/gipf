import {
  STOCKFISH_CDN_URL,
  ENGINE_LOAD_ERROR_PREFIX,
  isEngineSupported,
  classifyEngineError,
  describeEngineError,
  createEngine,
} from './stockfishLoader';

describe('stockfishLoader — isEngineSupported', () => {
  test('reflects whether Worker/Blob/URL are all defined', () => {
    // jest's jsdom environment doesn't implement Worker, so this is false here
    // — the real assertion is that the check tracks the global, not a fixed value.
    const expected = typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
    expect(isEngineSupported()).toBe(expected);
  });

  test('false when Worker is missing', () => {
    const realWorker = global.Worker;
    delete global.Worker;
    expect(isEngineSupported()).toBe(false);
    if (realWorker) global.Worker = realWorker;
  });
});

describe('stockfishLoader — classifyEngineError', () => {
  test('an engine-load-error line is classified as cdn-blocked', () => {
    expect(classifyEngineError(`${ENGINE_LOAD_ERROR_PREFIX}: NetworkError`)).toBe('cdn-blocked');
  });

  test('network-shaped messages are classified as cdn-blocked', () => {
    expect(classifyEngineError('Failed to fetch')).toBe('cdn-blocked');
    expect(classifyEngineError('net::ERR_BLOCKED_BY_CLIENT')).toBe('cdn-blocked');
  });

  test('other messages are not classified as cdn-blocked', () => {
    expect(classifyEngineError('engine-error: worker crashed')).toBe('other');
    expect(classifyEngineError('')).toBe('other');
  });
});

describe('stockfishLoader — describeEngineError', () => {
  test('a CDN block mentions the host and an ad-blocker/proxy as the likely cause', () => {
    const text = describeEngineError(`${ENGINE_LOAD_ERROR_PREFIX}: blocked`);
    expect(text).toMatch(/cdn\.jsdelivr\.net/);
    expect(text).toMatch(/ad-blocker/i);
    expect(text).toMatch(/retry/i);
    // Must not tell the user to start a new game — that can't recover a CDN block.
    expect(text).not.toMatch(/start a new game/i);
  });

  test('a non-CDN failure gets a generic retry message', () => {
    const text = describeEngineError('engine-error: worker crashed');
    expect(text).toMatch(/retry/i);
    expect(text).toContain('worker crashed');
  });
});

// jsdom (jest's default test environment here) doesn't implement Worker, so a
// minimal stand-in is needed to exercise createEngine's plumbing — real
// browsers are covered by manual testing per CLAUDE.md.
class MockWorker {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    MockWorker.instances.push(this);
  }
  postMessage(msg) {
    this.lastPosted = msg;
  }
  terminate() {
    this.terminated = true;
  }
}
MockWorker.instances = [];

describe('stockfishLoader — createEngine supports retry without reload', () => {
  let realWorker;
  let realCreateObjectURL;
  let realRevokeObjectURL;
  beforeEach(() => {
    realWorker = global.Worker;
    global.Worker = MockWorker;
    MockWorker.instances = [];
    // jsdom doesn't implement these; createEngine only needs a stable string.
    realCreateObjectURL = URL.createObjectURL;
    realRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = jest.fn();
  });
  afterEach(() => {
    global.Worker = realWorker;
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
  });

  test('is a stateless factory — calling it twice returns two independent handles', () => {
    const a = createEngine(STOCKFISH_CDN_URL);
    const b = createEngine(STOCKFISH_CDN_URL);
    expect(a).not.toBe(b);
    a.terminate();
    b.terminate();
  });

  test('a second createEngine() call after a failed one still works (no leftover state blocks retry)', () => {
    const first = createEngine(STOCKFISH_CDN_URL);
    first.terminate(); // simulate giving up on a failed load

    const second = createEngine(STOCKFISH_CDN_URL);
    const lines = [];
    second.onLine((line) => lines.push(line));

    // Drive the fresh handle's underlying worker as the browser runtime would.
    const secondWorker = MockWorker.instances[MockWorker.instances.length - 1];
    secondWorker.onmessage({ data: 'readyok' });
    expect(lines).toEqual(['readyok']);

    second.terminate();
  });

  test('throws a clear error when Workers are unsupported', () => {
    delete global.Worker;
    expect(() => createEngine()).toThrow();
  });
});
