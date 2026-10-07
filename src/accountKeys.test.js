// A signed-in account's keys stay on the server: games see only the marker, send no
// key in the body, and send the custom header that lets the server read the session.
// Guests keep sending their device-only key.
import { accountKeys, setAccountKeys, ACCOUNT_KEYS_STORAGE } from './accountKeys.js';
import * as catan from './games/catan/coach/rulesClient.js';
import * as splendor from './games/splendor/coach/rulesClient.js';
import * as chess from './games/chess/coach/coachClient.js';
import * as diplomacy from './games/diplomacy/agents/agentClient.js';
import { getLichessToken, hasLichessToken, fetchOpeningStatsDetailed, ACCOUNT_TOKEN } from './games/chess/coach/openingCoach.js';

const GUEST_KEY = 'sk-ant-synthetic-guest-key';
let calls;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ answer: 'synthetic', commentary: 'synthetic', message: 'synthetic', content: [{ type: 'text', text: '{"message":"synthetic","scratchpad":{}}' }], stop_reason: 'end_turn', moves: [] }) };
  });
});
afterEach(() => { delete global.fetch; });

describe('marker', () => {
  test('holds only two booleans and is empty by default', () => {
    expect(accountKeys()).toEqual({ anthropic: false, lichess: false });
    setAccountKeys({ anthropic: true, lichess: 'yes', key: 'sk-ant-should-not-store' });
    expect(JSON.parse(localStorage.getItem(ACCOUNT_KEYS_STORAGE))).toEqual({ anthropic: true, lichess: false });
    expect(accountKeys()).toEqual({ anthropic: true, lichess: false });
    setAccountKeys(null);
    expect(localStorage.getItem(ACCOUNT_KEYS_STORAGE)).toBeNull();
  });
  test('malformed storage reads as no keys', () => {
    localStorage.setItem(ACCOUNT_KEYS_STORAGE, '{nope');
    expect(accountKeys()).toEqual({ anthropic: false, lichess: false });
  });
  test('a change notifies same-tab listeners such as Diplomacy', () => {
    const seen = jest.fn();
    const stop = diplomacy.subscribeApiKey(seen);
    setAccountKeys({ anthropic: true, lichess: false });
    stop();
    expect(seen).toHaveBeenCalled();
  });
});

const requests = [
  ['catan', () => catan.askRules({ context: {}, messages: [{ role: 'user', content: 'q' }] }), '/api/catanRules', () => catan.hasApiKey()],
  ['splendor', () => splendor.askRules({ context: {}, messages: [{ role: 'user', content: 'q' }] }), '/api/splendorRules', () => splendor.hasApiKey()],
  ['chess commentary', () => chess.requestCommentary({ kind: 'player-move', fen: 'synthetic', movePlayed: { san: 'e4' }, candidates: [] }), '/api/chessCoach', () => chess.hasApiKey()],
  ['chess thread', () => chess.runThreadTurn({ context: {}, history: [], question: 'q', analyze: async () => ({ lines: [] }) }), '/api/chessCoach', () => chess.hasApiKey()],
  ['diplomacy', () => diplomacy.sendMessage({ power: 'FRA', history: [{ role: 'user', content: 'hi' }], context: {} }), '/api/diplomacyAgent', () => diplomacy.hasApiKey()],
];

describe.each(requests)('%s', (_name, send, endpoint, has) => {
  test('signed in with an account key: no key in the body, the custom header sent', async () => {
    setAccountKeys({ anthropic: true, lichess: false });
    expect(has()).toBe(true);
    await send();
    const call = calls.find(c => c.url.endsWith(endpoint));
    expect(call).toBeTruthy();
    expect(call.body).not.toHaveProperty('apiKey');
    expect(call.headers['X-Games-Request']).toBe('1');
  });
  test('a guest sends the device key in the body', async () => {
    localStorage.setItem('playApiKey', GUEST_KEY);
    expect(has()).toBe(true);
    await send();
    expect(calls.find(c => c.url.endsWith(endpoint)).body.apiKey).toBe(GUEST_KEY);
  });
  test('with no key anywhere nothing is sent', async () => {
    expect(has()).toBe(false);
    await send();
    expect(calls.filter(c => c.url.endsWith(endpoint))).toEqual([]);
  });
});

describe('Lichess explorer', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  test('an account token is a stand-in, and the server queries Lichess for it', async () => {
    setAccountKeys({ anthropic: false, lichess: true });
    expect(hasLichessToken()).toBe(true);
    expect(getLichessToken()).toBe(ACCOUNT_TOKEN);
    const result = await fetchOpeningStatsDetailed(fen);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/chessCoach');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ mode: 'explorer', fen });
    expect(calls[0].headers['X-Games-Request']).toBe('1');
    expect(JSON.stringify(calls[0])).not.toContain('Bearer');
  });
  test('a proxied upstream failure reports Lichess\'s status', async () => {
    setAccountKeys({ anthropic: false, lichess: true });
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream_error', status: 401 }) }));
    expect(await fetchOpeningStatsDetailed(fen)).toEqual({ ok: false, reason: 'http-error', status: 401, data: null });
  });
  test('a guest token goes straight to Lichess', async () => {
    localStorage.setItem('chessLichessToken', 'lip_syntheticGuest');
    expect(getLichessToken()).toBe('lip_syntheticGuest');
    await fetchOpeningStatsDetailed(fen);
    expect(calls[0].url).toMatch(/^https:\/\/explorer\.lichess\.ovh\/masters\?/);
    expect(calls[0].headers.Authorization).toBe('Bearer lip_syntheticGuest');
  });
  test('no token anywhere makes no request', async () => {
    expect(getLichessToken()).toBe('');
    expect((await fetchOpeningStatsDetailed(fen)).reason).toBe('no-token');
    expect(calls).toEqual([]);
  });
});
