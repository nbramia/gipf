import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
import MCTS from '../src/games/yinsh/engine/mcts.js';
import { searchYinsh } from '../server/yinshSearch.js';

let moduleId = 0;
const copy = value => JSON.parse(JSON.stringify(value));
const goodMove = { move: [-3, 0], destination: [-2, 0], confidence: 0.9 };
beforeEach(t => {
  process.env.KV_REST_API_URL = 'https://synthetic.invalid';
  process.env.KV_REST_API_TOKEN = 'synthetic';
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://synthetic.invalid');
    return { ok: true, json: async () => ({ result: 1 }) };
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
});
async function freshHandler() {
  return (await import(`../api/aiMove.js?test=${++moduleId}`)).createHandler(searchYinsh);
}
function response() {
  return { code: 200, headers: {}, sent: [], ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.sent.push(value); this.body = value; return this; },
    end() { this.ended = true; return this; },
  };
}
async function request(handler, body, method = 'POST', origin = 'https://gipf.vercel.app') {
  const res = response();
  await handler({ method, headers: { origin }, body }, res);
  return res;
}
function playBoard() {
  const board = new YinshBoard({ initialPhase: 'play', player1RingsPlaced: 5, player2RingsPlaced: 5 });
  for (let i = 0; i < 5; i++) {
    board.boardState[`-3,${i}`] = { type: 'ring', player: 1 };
    board.boardState[`3,${-i}`] = { type: 'ring', player: 2 };
  }
  return board;
}
function rowBoard() {
  const board = playBoard();
  for (let q = -2; q <= 2; q++) {
    board.boardState[`${q},0`] = { type: 'marker', player: 1 };
    board.boardState[`${q},2`] = { type: 'marker', player: 2 };
  }
  board.scores = { 1: 2, 2: 1 };
  board.nextTurnPlayer = 2;
  board._startNextRowResolution();
  return board;
}
function ringBoard() {
  const board = rowBoard();
  assert.equal(board.removeRow(board.rows[0].markers), true);
  return board;
}
function minimal(board) {
  const { boardState, gamePhase, currentPlayer } = board.serializeState();
  return copy({ boardState, gamePhase, currentPlayer });
}

test('full canonical resolution snapshots round-trip into search without mutating the request', async t => {
  const handler = await freshHandler();
  const captured = [];
  t.mock.method(MCTS.prototype, 'runIteration', async board => {
    captured.push(copy(board.serializeState()));
    board.scores[1] = 0; // Search owns its clone, not the caller's object.
    return goodMove;
  });
  for (const board of [rowBoard(), ringBoard()]) {
    const body = copy(board.serializeState()), before = copy(body);
    const res = await request(handler, body);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, goodMove);
    assert.deepEqual(captured.at(-1), before);
    assert.deepEqual(body, before);
    assert.deepEqual(YinshBoard.fromSerializedState(before).serializeState(), before);
  }
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0].scores, { 1: 2, 2: 1 });
  assert.ok(captured[0].rowResolutionQueue.length > 0);
  assert.equal(captured[1].nextTurnPlayer, 2);
  assert.equal(captured[1].pendingRowsAfterRingRemoval, true);
});

test('cache distinguishes scores and next-turn player and ignores object key insertion order', async t => {
  const handler = await freshHandler();
  let iterations = 0;
  t.mock.method(MCTS.prototype, 'runIteration', async board => ({
    ...goodMove, identity: [++iterations, board.scores[1], board.nextTurnPlayer],
  }));
  const first = copy(ringBoard().serializeState());
  const scoreChanged = copy(first); scoreChanged.scores[1] = 1;
  const turnChanged = copy(first); turnChanged.nextTurnPlayer = 1;
  const a = await request(handler, first);
  const b = await request(handler, scoreChanged);
  const c = await request(handler, turnChanged);
  assert.equal(iterations, 3);
  assert.notDeepEqual(a.body, b.body);
  assert.notDeepEqual(a.body, c.body);
  const reordered = copy(first);
  reordered.boardState = Object.fromEntries(Object.entries(reordered.boardState).reverse());
  assert.deepEqual((await request(handler, reordered)).body, a.body);
  assert.equal(iterations, 3);
});

test('async iteration is awaited before confidence exit, response, and cache storage', async t => {
  const handler = await freshHandler();
  let resolveIteration;
  const pending = new Promise(resolve => { resolveIteration = resolve; });
  const iteration = t.mock.method(MCTS.prototype, 'runIteration', () => pending);
  const res = response();
  const body = copy(playBoard().serializeState());
  const running = handler({ method: 'POST', headers: {}, body }, res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.sent.length, 0);
  assert.equal(iteration.mock.callCount(), 1);
  resolveIteration(goodMove);
  await running;
  assert.deepEqual(res.body, goodMove);
  assert.equal(typeof res.body.then, 'undefined');
  assert.equal(iteration.mock.callCount(), 1);
  assert.deepEqual((await request(handler, body)).body, goodMove);
  assert.equal(iteration.mock.callCount(), 1);
});

test('resolved null iteration awaits fallback and can return null', async t => {
  const handler = await freshHandler();
  t.mock.method(MCTS.prototype, 'runIteration', async () => null);
  const fallback = t.mock.method(MCTS.prototype, 'getFallbackMove', async () => null);
  assert.equal((await request(handler, copy(playBoard().serializeState()))).body, null);
  assert.equal(fallback.mock.callCount(), 1);
});

test('iteration errors retain the server-error response contract', async t => {
  const handler = await freshHandler();
  t.mock.method(MCTS.prototype, 'runIteration', async () => { throw new Error('search failed'); });
  const res = await request(handler, copy(playBoard().serializeState()));
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: 'Unable to calculate move' });
});

test('all essential canonical fields are required for both resolution phases', async t => {
  const handler = await freshHandler();
  const iteration = t.mock.method(MCTS.prototype, 'runIteration', async () => goodMove);
  for (const board of [rowBoard(), ringBoard()]) {
    const body = copy(board.serializeState());
    for (const field of Object.keys(body)) {
      const incomplete = copy(body); delete incomplete[field];
      const res = await request(handler, incomplete);
      assert.equal(res.code, 400, `missing ${field} in ${body.gamePhase}`);
      assert.equal(res.body.error, 'Invalid board snapshot');
      assert.deepEqual(res.body, { error: 'Invalid board snapshot' });
    }
  }
  assert.equal(iteration.mock.callCount(), 0);
});

test('malformed snapshots fail before search or cache lookup', async t => {
  const handler = await freshHandler();
  const iteration = t.mock.method(MCTS.prototype, 'runIteration', async () => goodMove);
  const body = copy(ringBoard().serializeState());
  const invalid = [
    null, [], 'json', {}, { ...body, scores: null },
    { ...body, currentPlayer: 3 }, { ...body, gamePhase: 'unknown' },
    { ...body, scores: { 1: -1, 2: 0 } },
    { ...body, ringsPlaced: { 1: 2.5, 2: 5 } },
    { ...body, nextTurnPlayer: null }, { ...body, pendingRowsAfterRingRemoval: 'true' },
    { ...body, boardState: { '99,0': { type: 'ring', player: 1 } } },
    { ...body, selectedRing: [0.5, 0] }, { ...body, validMoves: [[99, 0]] },
    { ...body, rows: [{ player: 1, markers: [[0, 0]] }] },
    { ...body, rowResolutionQueue: [{ player: 1, rows: null }] },
    { ...body, winner: 1 }, { ...body, selectedSetupRing: { player: 1, index: 10 } },
  ];
  const staleRow = copy(rowBoard().serializeState());
  delete staleRow.boardState['0,0'];
  invalid.push(staleRow);
  for (const value of invalid) {
    const res = await request(handler, value);
    assert.equal(res.code, 400, JSON.stringify(value));
  }
  assert.equal(iteration.mock.callCount(), 0);
});

test('safe minimal setup/play requests receive documented canonical defaults', async t => {
  const handler = await freshHandler();
  const captured = [];
  t.mock.method(MCTS.prototype, 'runIteration', async board => {
    captured.push(copy(board.serializeState())); return goodMove;
  });
  const setup = new YinshBoard();
  setup.handleSetupRingClick(1, 0); setup.handleClick(0, 0);
  for (const board of [new YinshBoard(), setup, playBoard()]) {
    assert.equal((await request(handler, minimal(board))).code, 200);
    const restored = captured.at(-1);
    assert.deepEqual(restored.scores, { 1: 0, 2: 0 });
    assert.deepEqual(restored.ringsPlaced, board.ringsPlaced);
    for (const field of ['selectedRing', 'selectedSetupRing', 'winner', 'nextTurnPlayer']) {
      assert.equal(restored[field], null);
    }
    for (const field of ['validMoves', 'rows', 'rowResolutionQueue']) assert.deepEqual(restored[field], []);
    assert.equal(restored.pendingRowsAfterRingRemoval, false);
  }
});

test('ambiguous legacy play, setup, partial canonical and resolution bodies are rejected', async t => {
  const handler = await freshHandler();
  const iteration = t.mock.method(MCTS.prototype, 'runIteration', async () => goodMove);
  const scored = playBoard(); delete scored.boardState['-3,0'];
  const rowsInPlay = rowBoard(); rowsInPlay.gamePhase = 'play';
  const misplacedSetup = new YinshBoard(); misplacedSetup.boardState['0,0'] = { type: 'ring', player: 2 };
  const invalid = [minimal(scored), minimal(rowsInPlay), minimal(misplacedSetup),
    minimal(ringBoard()), { ...minimal(playBoard()), scores: { 1: 0, 2: 0 } }];
  for (const body of invalid) assert.equal((await request(handler, body)).code, 400);
  assert.equal(iteration.mock.callCount(), 0);
});

test('terminal snapshot preserves winner and returns null', async t => {
  const handler = await freshHandler();
  const board = ringBoard(); board.handleClick(-3, 0);
  assert.equal(board.winner, 1);
  let captured;
  t.mock.method(MCTS.prototype, 'runIteration', async searched => {
    captured = copy(searched.serializeState()); return null;
  });
  const res = await request(handler, copy(board.serializeState()));
  assert.equal(res.code, 200);
  assert.equal(res.body, null);
  assert.deepEqual(captured, board.serializeState());
});

test('real iteration returns coordinate moves and full removal rows (bounded simulation)', async t => {
  const handler = await freshHandler();
  t.mock.method(MCTS.prototype, 'simulate', async () => 0);
  for (const board of [new YinshBoard(), playBoard(), rowBoard(), ringBoard()]) {
    const res = await request(handler, copy(board.serializeState()));
    assert.equal(res.code, 200);
    assert.ok(res.body && typeof res.body === 'object');
    assert.equal(typeof res.body.then, 'undefined');
    assert.ok(Number.isFinite(res.body.confidence));
    assert.ok(res.body.move === null || (Array.isArray(res.body.move) && res.body.move.length === 2));
    assert.ok(res.body.destination === null || (Array.isArray(res.body.destination) && res.body.destination.length === 2));
    if (board.gamePhase === 'remove-row') {
      assert.equal(res.body.type, 'remove-row');
      assert.equal(res.body.row.length, 5);
      const clone = board.clone();
      assert.equal(clone.removeRow(res.body.row), true);
    }
  }
});

test('OPTIONS, unsupported methods, and CORS allowlist remain unchanged', async () => {
  const handler = await freshHandler();
  const options = await request(handler, null, 'OPTIONS');
  assert.equal(options.code, 200); assert.equal(options.ended, true);
  assert.equal(options.headers['Access-Control-Allow-Origin'], 'https://gipf.vercel.app');
  assert.equal(options.headers['Access-Control-Allow-Credentials'], true);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const res = await request(handler, null, method, 'https://untrusted.example');
    assert.equal(res.code, 405);
    assert.equal(res.body.error, 'Method not allowed');
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  }
});

test('production handler carries scored resolution and terminal snapshots through the real worker', async () => {
  const handler = (await import('../api/aiMove.js?real-worker')).default;
  const row = rowBoard();
  const rowResult = await request(handler, copy(row.serializeState()));
  assert.equal(rowResult.code, 200);
  assert.equal(rowResult.body.type, 'remove-row');
  assert.equal(row.clone().removeRow(rowResult.body.row), true);
  const ring = ringBoard();
  const ringResult = await request(handler, copy(ring.serializeState()));
  assert.equal(ringResult.code, 200);
  assert.ok(Array.isArray(ringResult.body.move));
  const terminal = ring.clone();
  terminal.handleClick(...ringResult.body.move);
  assert.equal(terminal.winner, 1);
  const terminalResult = await request(handler, copy(terminal.serializeState()));
  assert.equal(terminalResult.code, 200);
  assert.equal(terminalResult.body, null);
});
