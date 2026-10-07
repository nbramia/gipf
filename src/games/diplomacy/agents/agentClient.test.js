// agentClient tests. fetch is mocked — no real key, no network. Covers the
// BYO-key gate (no key -> no fetch), the POST body shape, legacy-key migration,
// and memory wiring.

import {
  getApiKey,
  setApiKey,
  hasApiKey,
  sendMessage,
  askAgent,
  createMemory,
} from './agentClient.js';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  delete global.fetch;
});

// Collapse the retry backoff so tests don't wait on it.
function immediateTimers() {
  jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
}

const SCRATCHPAD = {
  self: 'germany',
  dispositions: { france: { trust: -0.1, stance: 'rival', intent: 'Contest Belgium.' } },
  priority: 'Hold the center.',
  confidence: 0.5,
};

function okFetch(payload) {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
}

describe('shared key storage', () => {
  test('set/get/has round-trip', () => {
    expect(hasApiKey()).toBe(false);
    setApiKey('sk-abc');
    expect(getApiKey()).toBe('sk-abc');
    expect(hasApiKey()).toBe(true);
  });

  test('clears legacy keys when cleared', () => {
    localStorage.setItem('chessApiKey', 'sk-legacy');
    setApiKey('');
    expect(localStorage.getItem('chessApiKey')).toBeNull();
  });

  test('migrates legacy chessApiKey into playApiKey on first read', () => {
    localStorage.setItem('chessApiKey', 'sk-from-chess');
    expect(getApiKey()).toBe('sk-from-chess');
    expect(localStorage.getItem('playApiKey')).toBe('sk-from-chess');
  });

  test('migrates legacy catanApiKey into playApiKey', () => {
    localStorage.setItem('catanApiKey', 'sk-from-catan');
    expect(getApiKey()).toBe('sk-from-catan');
    expect(localStorage.getItem('playApiKey')).toBe('sk-from-catan');
  });
});

describe('sendMessage', () => {
  test('with no key returns error and never calls fetch', async () => {
    global.fetch = jest.fn();
    const result = await sendMessage({ power: 'germany', history: [{ role: 'user', content: 'hi' }], context: {} });
    expect(result.error).toBe('no_key');
    expect(typeof result.message).toBe('string');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('with a key POSTs the expected body shape to /api/diplomacyAgent', async () => {
    setApiKey('sk-live');
    global.fetch = okFetch({ message: 'We watch Belgium too.', scratchpad: SCRATCHPAD });

    const history = [{ role: 'user', content: 'Belgium is mine.' }];
    const context = { phase: 'Spring 1901 orders' };
    const result = await sendMessage({ power: 'germany', history, context, addressee: 'France', model: 'claude-opus-4-8' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/diplomacyAgent');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.apiKey).toBe('sk-live');
    expect(body.power).toBe('germany');
    expect(body.persona).toMatchObject({ name: 'Germany' });
    expect(body.context).toEqual(context);
    expect(body.messages).toEqual(history);
    expect(body.addressee).toBe('France');
    expect(body.model).toBe('claude-opus-4-8');

    expect(result).toEqual({ message: 'We watch Belgium too.', scratchpad: SCRATCHPAD, summary: '', deal: null });
  });

  test('wires the reply and scratchpad through a provided memory store', async () => {
    setApiKey('sk-live');
    global.fetch = okFetch({ message: 'Agreed.', scratchpad: SCRATCHPAD });
    const store = createMemory(['germany']);

    await sendMessage({ power: 'germany', history: [{ role: 'user', content: 'Deal?' }], context: {}, store });

    expect(store.threads.germany.messages).toEqual([
      { role: 'assistant', content: 'Agreed.', turn: '' },
    ]);
    expect(store.threads.germany.scratchpad).toEqual(SCRATCHPAD);
  });

  test('a rejected key surfaces a friendly upstream error', async () => {
    setApiKey('sk-bad');
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const result = await sendMessage({ power: 'germany', history: [{ role: 'user', content: 'hi' }], context: {} });
    expect(result.error).toBe('upstream');
  });

  test('sendMessage retries once on a 504 and returns the second reply', async () => {
    immediateTimers();
    setApiKey('sk-live');
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'Fine.', scratchpad: SCRATCHPAD }) });
    const store = createMemory();
    const pending = sendMessage({ power: 'germany', history: [{ role: 'user', content: 'hi' }], context: {}, store });
    const result = await pending;
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.message).toBe('Fine.');
    expect(store.threads.germany.messages).toHaveLength(1);
  });

  test('sendMessage gives up after one retry and does not touch the thread', async () => {
    immediateTimers();
    setApiKey('sk-live');
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) });
    const store = createMemory();
    const pending = sendMessage({ power: 'germany', history: [{ role: 'user', content: 'hi' }], context: {}, store });
    const result = await pending;
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.error).toBe('upstream');
    expect(store.threads.germany).toBeUndefined();
  });

  test('askAgent retries once on 502 and a 500 is not retried', async () => {
    immediateTimers();
    setApiKey('sk-live');
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'Ok.' }) });
    let p = askAgent({ power: 'germany', messages: [] });
    expect((await p).reply.message).toBe('Ok.');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    p = askAgent({ power: 'germany', messages: [] });
    expect((await p).error).toBe('upstream');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a stalled fetch is aborted client-side instead of hanging', async () => {
    jest.useFakeTimers();
    setApiKey('sk-live');
    global.fetch = jest.fn((_url, { signal }) => new Promise((_res, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = sendMessage({ power: 'germany', history: [{ role: 'user', content: 'hi' }], context: {} });
    jest.advanceTimersByTime(30000);
    const result = await pending;
    jest.useRealTimers();
    expect(result.error).toBe('network');
  });

  test('an empty reply is reported as an error', async () => {
    setApiKey('sk-live');
    global.fetch = okFetch({ message: '', scratchpad: null });
    const result = await sendMessage({ power: 'germany', history: [{ role: 'user', content: 'hi' }], context: {} });
    expect(result.error).toBe('empty');
  });
});

describe('askAgent', () => {
  test('with no key returns error and never calls fetch', async () => {
    global.fetch = jest.fn();
    const result = await askAgent({ power: 'germany', counterparties: ['france'], messages: [{ role: 'user', content: 'hi' }] });
    expect(result.error).toBe('no_key');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('threads priorSummary/memory into the POST body and surfaces summary in the reply', async () => {
    setApiKey('sk-live');
    global.fetch = okFetch({ message: 'We hold the line.', scratchpad: SCRATCHPAD, summary: 'Tense over Belgium.' });

    const result = await askAgent({
      power: 'germany',
      counterparties: ['france'],
      channel: 'france~germany',
      messages: [{ role: 'user', content: 'Belgium?' }],
      priorSummary: 'Last phase we agreed to a DMZ.',
      memory: 'stance rival; trust -0.10',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.priorSummary).toBe('Last phase we agreed to a DMZ.');
    expect(body.memory).toBe('stance rival; trust -0.10');
    expect(body.counterparties).toEqual(['france']);

    expect(result.reply.message).toBe('We hold the line.');
    expect(result.reply.scratchpad).toEqual(SCRATCHPAD);
    expect(result.reply.summary).toBe('Tense over Belgium.');
  });

  test('summary defaults to empty string when the endpoint omits it', async () => {
    setApiKey('sk-live');
    global.fetch = okFetch({ message: 'Noted.', scratchpad: null });
    const result = await askAgent({ power: 'germany', counterparties: ['france'], messages: [{ role: 'user', content: 'hi' }] });
    expect(result.reply.summary).toBe('');
  });
});
