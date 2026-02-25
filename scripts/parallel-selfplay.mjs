#!/usr/bin/env node
// parallel-selfplay.mjs — Coordinator for parallel self-play data generation.
// Forks N worker processes, each generating a portion of the games.
//
// Usage: node scripts/parallel-selfplay.mjs --games 50 --sims 200 --model public/models/yinsh-value-v1.onnx --output data/v68_selfplay.ndjson
//        node scripts/parallel-selfplay.mjs --games 50 --sims 200 --model public/models/yinsh-value-v1.onnx --output data/v68_selfplay.ndjson --workers 6

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectDir = resolve(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const NUM_GAMES = parseInt(getArg('games', '50'), 10);
const SIMS = parseInt(getArg('sims', '200'), 10);
const OUTPUT = getArg('output', 'data/selfplay.ndjson');
const MODE = getArg('mode', 'nn');
const MODEL = getArg('model', 'public/models/yinsh-value-v1.onnx');
const RAMP = getArg('ramp', '10');
const TEMP_MOVES = getArg('temperature-moves', '15');
const NUM_WORKERS = parseInt(getArg('workers', String(Math.min(os.cpus().length - 2, 8))), 10);

async function main() {
  const gamesPerWorker = Math.floor(NUM_GAMES / NUM_WORKERS);
  const extraGames = NUM_GAMES - gamesPerWorker * NUM_WORKERS;

  console.log(`\nParallel Self-Play Data Generation`);
  console.log(`Games: ${NUM_GAMES} | Sims: ${SIMS} | Workers: ${NUM_WORKERS} | Mode: ${MODE}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Output: ${OUTPUT}`);
  console.log('═'.repeat(60));

  const workerOutputFiles = [];
  const workers = [];
  const startTime = performance.now();

  for (let i = 0; i < NUM_WORKERS; i++) {
    const workerGames = gamesPerWorker + (i < extraGames ? 1 : 0);
    if (workerGames === 0) continue;

    const workerOutput = `data/w${i}_${Date.now()}.ndjson`;
    workerOutputFiles.push(resolve(projectDir, workerOutput));

    const env = {
      ...process.env,
      WORKER_ID: String(i),
      GAMES: String(workerGames),
      SIMS: String(SIMS),
      MODE: MODE,
      MODEL: MODEL,
      OUTPUT: workerOutput,
      RAMP: RAMP,
      TEMP_MOVES: TEMP_MOVES,
    };

    const child = fork(resolve(__dirname, 'worker-selfplay.mjs'), [], { env, stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });

    const workerPromise = new Promise((resolve, reject) => {
      let positions = 0;
      let gamesComplete = 0;

      child.on('message', (msg) => {
        if (msg.type === 'game_complete') {
          gamesComplete++;
          positions += msg.positions || 0;
          const progress = `[W${i}] Game ${msg.game}/${workerGames}` +
            (msg.winner ? ` P${msg.winner} wins (${msg.positions} pos)` : ' draw');
          console.log(`  ${progress}`);
        } else if (msg.type === 'done') {
          positions = msg.positions;
        } else if (msg.type === 'error') {
          console.error(`  [W${i}] Error: ${msg.error}`);
        }
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve({ workerId: i, positions, gamesComplete });
        } else {
          reject(new Error(`Worker ${i} exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Worker ${i} error: ${err.message}`));
      });
    });

    workers.push(workerPromise);
  }

  // Wait for all workers
  console.log(`\nWaiting for ${workers.length} workers...`);
  const results = await Promise.allSettled(workers);

  let totalPositions = 0;
  let failedWorkers = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      totalPositions += result.value.positions;
    } else {
      failedWorkers++;
      console.error(`Worker failed: ${result.reason.message}`);
    }
  }

  // Concatenate worker outputs
  console.log(`\nConcatenating ${workerOutputFiles.length} output files...`);
  const outputPath = resolve(projectDir, OUTPUT);
  let combinedLines = 0;

  const chunks = [];
  for (const file of workerOutputFiles) {
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8');
      if (content.trim()) {
        chunks.push(content.trimEnd());
        combinedLines += content.trim().split('\n').length;
      }
      unlinkSync(file); // Clean up worker files
    }
  }
  writeFileSync(outputPath, chunks.join('\n') + (chunks.length > 0 ? '\n' : ''));

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

  console.log('═'.repeat(60));
  console.log(`Total positions: ${combinedLines}`);
  console.log(`Total time: ${elapsed}s (${(elapsed / NUM_GAMES * 60).toFixed(0)}s per game avg)`);
  console.log(`Failed workers: ${failedWorkers}`);
  console.log(`Output: ${outputPath}`);
}

main().catch(err => {
  console.error('Coordinator error:', err);
  process.exit(1);
});
