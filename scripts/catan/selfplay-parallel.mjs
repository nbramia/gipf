#!/usr/bin/env node
// Parallel Catan self-play: fan out N worker processes (one per core slice),
// each running generate-training-data.mjs on a distinct seed range into its own
// NDJSON shard. Reuses the tested single-process generator for the actual play.
//
// Usage:
//   node scripts/catan/selfplay-parallel.mjs --games 600 --workers 24 --sims 100 \
//        --rollout 30 --out-dir data/catan/gen0
//   node scripts/catan/selfplay-parallel.mjs --games 600 --model public/models/catan-value-v1.onnx --out-dir data/catan/gen1

import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const getInt = (name, def) => parseInt(getArg(name, String(def)), 10);

const TOTAL_GAMES = getInt('games', 200);
const WORKERS = getInt('workers', Math.max(1, Math.min(os.cpus().length - 2, 24)));
const SIMS = getInt('sims', 100);
const ROLLOUT = getInt('rollout', 30);
const MAX_MOVES = getInt('max-moves', 1200);
const MODEL = getArg('model', null);
const SEED_BASE = getInt('seed', Math.floor(Date.now() % 1e9));
const OUT_DIR = resolve(projectDir, getArg('out-dir', `data/catan/run-${Date.now()}`));

mkdirSync(OUT_DIR, { recursive: true });
const logDir = resolve(OUT_DIR, 'logs');
mkdirSync(logDir, { recursive: true });

const perWorker = Math.ceil(TOTAL_GAMES / WORKERS);
console.log(`Catan parallel self-play: ${WORKERS} workers x ${perWorker} games = ${WORKERS * perWorker} games`);
console.log(`  sims=${SIMS} rollout=${ROLLOUT} model=${MODEL || 'heuristic'} out=${OUT_DIR}`);

const start = Date.now();
const shards = [];

function launch(i) {
  const shard = resolve(OUT_DIR, `shard-${i}.ndjson`);
  shards.push(shard);
  const cargs = [
    'scripts/catan/generate-training-data.mjs',
    '--games', String(perWorker),
    '--sims', String(SIMS),
    '--rollout', String(ROLLOUT),
    '--max-moves', String(MAX_MOVES),
    '--seed', String(SEED_BASE + i * 1000003),
    '--output', shard,
  ];
  if (MODEL) cargs.push('--model', resolve(projectDir, MODEL));
  const log = createWriteStream(resolve(logDir, `worker-${i}.log`));
  const child = spawn('node', cargs, { cwd: projectDir });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return new Promise(res => child.on('exit', code => {
    console.log(`  worker ${i} exit=${code} (${((Date.now() - start) / 1000).toFixed(0)}s)`);
    res({ i, code });
  }));
}

const results = await Promise.all(Array.from({ length: WORKERS }, (_, i) => launch(i)));
const failed = results.filter(r => r.code !== 0);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Self-play done in ${elapsed}s. shards=${shards.length} failed=${failed.length}`);
// Machine-readable last line for the flywheel orchestrator.
console.log(`SELFPLAY_RESULT dir=${OUT_DIR} shards=${shards.length} failed=${failed.length}`);
process.exitCode = failed.length === 0 ? 0 : 1;
