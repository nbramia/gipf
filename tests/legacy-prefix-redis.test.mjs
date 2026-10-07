// Legacy `gipf:` keys are found and moved under `play:` on first use. Disposable container only.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import { command, read, legacyKeyPairs, hash } from '../server/publicSecurity.js';
import { resolveSession } from '../server/session.js';

const u = 'a'.repeat(64);
const TOKEN = 'T'.repeat(43);

beforeEach(() => {
  redis('FLUSHDB');
  process.env.KV_REST_API_URL = 'https://synthetic.invalid'; process.env.KV_REST_API_TOKEN = 'synthetic';
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ result: await redisAsync(...JSON.parse(options.body)) }) });
});

test('only play: keys are paired with their legacy names, and SCAN patterns are left alone', () => {
  assert.deepEqual(legacyKeyPairs(['GET', `play:settings:v2:${u}`]), [`play:settings:v2:${u}`, `gipf:settings:v2:${u}`]);
  assert.deepEqual(legacyKeyPairs(['EVAL', 'script', 2, 'play:a:1', 'play:a:1', '{"play:x:1":1}']), ['play:a:1', 'gipf:a:1']);
  assert.deepEqual(legacyKeyPairs(['SCAN', '0', 'MATCH', 'play:identity:v1:*']), []);
  assert.deepEqual(legacyKeyPairs(['GET', 'chess:thing']), []);
  assert.deepEqual(legacyKeyPairs(['EVAL', 'script', 1, `play:limit:public:${u}`, 60]), []);
});

test('a read of a play: key finds the legacy value and moves it, keeping its TTL', async () => {
  redis('SET', `gipf:settings:v2:${u}`, JSON.stringify({ revision: 3 }), 'EX', 1000);
  assert.deepEqual(await read(`play:settings:v2:${u}`), { revision: 3 });
  assert.equal(redis('EXISTS', `gipf:settings:v2:${u}`), 0);
  const ttl = redis('TTL', `play:settings:v2:${u}`);
  assert.ok(ttl > 990 && ttl <= 1000, `ttl ${ttl}`);
});

test('an existing play: key wins over a stale legacy one', async () => {
  redis('SET', `play:profile:v2:${u}`, '"new"');
  redis('SET', `gipf:profile:v2:${u}`, '"old"');
  assert.equal(await command('GET', `play:profile:v2:${u}`), '"new"');
  assert.equal(redis('GET', `gipf:profile:v2:${u}`), '"old"');
});

test('writes land only under play:', async () => {
  await command('SET', `play:match:v1:${u}:chess`, '{}');
  assert.equal(redis('EXISTS', `play:match:v1:${u}:chess`), 1);
  assert.deepEqual(redis('KEYS', 'gipf:*'), []);
});

test('a session and its index stored under gipf: still resolve', async () => {
  const token = TOKEN, id = hash(token);
  const record = { i: 'c'.repeat(64), u, name: 'synthetic', created: Date.now(), seen: Date.now() };
  redis('SET', `gipf:session:v1:${id}`, JSON.stringify(record), 'PX', 60_000);
  redis('SADD', `gipf:sessions:v1:${record.i}`, id);
  const resolved = await resolveSession(token);
  assert.equal(resolved?.u, u);
  assert.equal(redis('EXISTS', `play:session:v1:${id}`), 1);
  assert.equal(redis('EXISTS', `gipf:session:v1:${id}`), 0);
});
