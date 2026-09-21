#!/usr/bin/env node

/**
 * Parallel self-play data generation for Zertz.
 * Spawns multiple child processes for faster data generation.
 *
 * Usage:
 *   node scripts/zertz/parallel-selfplay.mjs --games 50 --sims 200 --workers 6
 *   node scripts/zertz/parallel-selfplay.mjs --games 50 --sims 200 --output data/zertz/v1_selfplay.ndjson
 *   node scripts/zertz/parallel-selfplay.mjs --games 50 --sims 200 --mode nn --model public/models/zertz-value-v1.onnx
 */

import { randomUUID } from 'node:crypto';
import { fork } from 'child_process';
import { writeFileSync, renameSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const TOTAL_GAMES = parseInt(getArg('games', '50'), 10);
const SIMS = parseInt(getArg('sims', '200'), 10);
const NUM_WORKERS = parseInt(getArg('workers', '6'), 10);
const OUTPUT_DIR = getArg('output-dir', 'data/zertz');
const OUTPUT = getArg('output', null);
const MODE = getArg('mode', 'heuristic');
const MODEL = getArg('model', null);
const RAMP_MOVES = getArg('ramp', null);
const TEMP_MOVES = getArg('temperature-moves', null);

if (![TOTAL_GAMES, SIMS, NUM_WORKERS].every(n => Number.isInteger(n) && n > 0)) throw new Error('games, sims and workers must be positive integers');

mkdirSync(OUTPUT_DIR, { recursive: true });

const timestamp = randomUUID();
const outputPath = OUTPUT || join(OUTPUT_DIR, `selfplay-${timestamp}.ndjson`);

console.log(`Zertz parallel self-play`);
console.log(`  Total games: ${TOTAL_GAMES}`);
console.log(`  Simulations/move: ${SIMS}`);
console.log(`  Workers: ${NUM_WORKERS}`);
console.log(`  Mode: ${MODE}`);
console.log(`  Output: ${outputPath}`);
console.log('');

const gamesPerWorker = Math.ceil(TOTAL_GAMES / NUM_WORKERS);
const workerScript = join(__dirname, 'generate-training-data.mjs');
const startTime = Date.now();

// Launch workers and collect promises
const workerFiles = [];
const workerPromises = [];

for (let w = 0; w < NUM_WORKERS; w++) {
  const workerGames = Math.min(gamesPerWorker, TOTAL_GAMES - w * gamesPerWorker);
  if (workerGames <= 0) break;

  const workerOutput = join(OUTPUT_DIR, `_worker-${w}-${timestamp}.ndjson`);
  workerFiles.push(workerOutput);

  // Build args, forwarding optional flags
  const childArgs = [
    '--games', String(workerGames),
    '--sims', String(SIMS),
    '--output', workerOutput,
    '--mode', MODE,
  ];
  if (MODEL) childArgs.push('--model', MODEL);
  if (RAMP_MOVES) childArgs.push('--ramp', RAMP_MOVES);
  if (TEMP_MOVES) childArgs.push('--temperature-moves', TEMP_MOVES);

  const promise = new Promise((resolve, reject) => {
    const child = fork(workerScript, childArgs, {
      stdio: 'inherit',
    });

    let done = null;
    let failure = null;
    child.on('message', msg => { if (msg.type === 'done') done = msg; });
    child.on('close', (code) => {
      if (code === 0 && !failure && done?.games === workerGames) resolve(done);
      else reject(new Error(`Worker ${w} exited with code ${code}`));
    });
    child.on('error', error => { failure = error; });
  });

  workerPromises.push(promise);
}

// Settle every child before deciding whether the dataset is complete.
const results = await Promise.allSettled(workerPromises);
const failures = results.filter(result => result.status === 'rejected');
if (failures.length) {
  for (const failure of failures) console.error(failure.reason);
  throw new Error('Generation failed; worker files preserved, output not published');
}
const chunks = workerFiles.map(wf => readFileSync(wf, 'utf8').trimEnd());
const lines = chunks.flatMap(chunk => chunk ? chunk.split('\n') : []);
for (const line of lines) JSON.parse(line);
if (!lines.length || lines.length !== results.reduce((n, result) => n + result.value.positions, 0)) {
  throw new Error('Incomplete worker output; worker files preserved');
}
mkdirSync(dirname(outputPath), { recursive: true });
const staging = `${outputPath}.${timestamp}.tmp`;
writeFileSync(staging, lines.join('\n') + '\n');
renameSync(staging, outputPath);
for (const wf of workerFiles) unlinkSync(wf);
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`Done! ${lines.length} positions from ${TOTAL_GAMES} games in ${elapsed}s`);
console.log(`Output: ${outputPath}`);
