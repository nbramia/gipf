#!/usr/bin/env node
// Splendor AlphaZero-style training flywheel (time-boxed, gated, resilient).
//
// Each generation: parallel 2-player self-play -> train (fine-tune from best
// checkpoint on a sliding replay window) -> export ONNX -> gate vs current best
// (or the heuristic rollout-leaf for gen 0) -> promote only on a SIGNIFICANT win.
// The best promoted model is copied to public/models/splendor-value-v1.onnx.
//
// The NN gates at more sims than the heuristic (--gate-a-sims > --gate-b-sims):
// an NN leaf is one forward pass vs a 28-step rollout, so this roughly equalises
// wall-clock per move rather than handicapping the NN at equal sims.
//
// Run DETACHED so a session crash can't kill it:
//   setsid nohup node scripts/splendor/train-loop.mjs --budget 10800 --run-id v1 \
//       > data/splendor/v1.out 2>&1 &
//   tail -f data/splendor/v1/train-loop.log

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, statSync, copyFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const getInt = (n, d) => parseInt(getArg(n, String(d)), 10);

const BUDGET = getInt('budget', 3 * 3600);
const WORKERS = getInt('workers', 24);
const PLAYERS = getInt('players', 2);
const GAMES_PER_GEN = getInt('games', 400);
const SIMS = getInt('sims', 200);
const ROLLOUT = getInt('rollout', 28);
const EPOCHS = getInt('epochs', 40);
const GATE_GAMES = getInt('gate-games', 80);
const GATE_A_SIMS = getInt('gate-a-sims', 400);   // NN (cheap leaf) gets more sims
const GATE_B_SIMS = getInt('gate-b-sims', 200);   // heuristic rollout-leaf
const DATA_GENS = getInt('data-gens', 6);
const MIN_GEN_SEC = getInt('min-gen', 600);
const PY = resolve(projectDir, 'training/.venv/bin/python');
const RUN_ID = getArg('run-id', `run-${Date.now()}`);
const SEED_MODEL = getArg('seed-model', null);
const RUN_DIR = resolve(projectDir, 'data/splendor', RUN_ID);
const LOG = resolve(RUN_DIR, 'train-loop.log');
mkdirSync(RUN_DIR, { recursive: true });

const START = Date.now();
const elapsed = () => (Date.now() - START) / 1000;
const remaining = () => BUDGET - elapsed();
function log(msg) {
  const line = `[${new Date().toISOString()}] +${(elapsed() / 60).toFixed(1)}min  ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
}

function run(cmd, cmdArgs, logFile) {
  return new Promise(res => {
    const out = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
    const child = spawn(cmd, cmdArgs, { cwd: projectDir });
    let tail = '';
    const cap = d => { tail += d; if (tail.length > 6000) tail = tail.slice(-6000); if (out) out.write(d); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    child.on('exit', code => res({ code, tail }));
  });
}

function ndjsonShards(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.ndjson')).map(f => resolve(dir, f))
    .filter(p => { try { return statSync(p).size > 0; } catch { return false; } });
}

async function main() {
  log(`flywheel start  budget=${(BUDGET / 3600).toFixed(1)}h workers=${WORKERS} ${PLAYERS}p games/gen=${GAMES_PER_GEN} sims=${SIMS} epochs=${EPOCHS}`);
  if (!existsSync(PY)) { log(`FATAL: venv python not found at ${PY}`); process.exitCode = 1; return; }

  let bestModel = SEED_MODEL ? resolve(projectDir, SEED_MODEL) : null;
  let latestCheckpoint = null;
  const genShards = [];
  let gen = 0;
  let promoted = 0;

  while (remaining() > MIN_GEN_SEC) {
    const genTag = `gen${gen}`;
    const genDir = resolve(RUN_DIR, genTag);
    log(`--- ${genTag}  remaining ${(remaining() / 60).toFixed(0)}min ---`);

    // 1. parallel self-play
    const spArgs = ['scripts/splendor/selfplay-parallel.mjs',
      '--games', String(GAMES_PER_GEN), '--workers', String(WORKERS), '--players', String(PLAYERS),
      '--sims', String(SIMS), '--rollout', String(ROLLOUT),
      '--out-dir', `data/splendor/${RUN_ID}/${genTag}`, '--seed', String(1000 + gen * 7919)];
    if (bestModel) spArgs.push('--model', bestModel);
    log(`self-play: ${GAMES_PER_GEN} games via ${WORKERS} workers (${bestModel ? 'NN' : 'heuristic'})`);
    await run('node', spArgs, resolve(RUN_DIR, `${genTag}-selfplay.log`));
    const newShards = ndjsonShards(genDir);
    if (newShards.length === 0) { log('no self-play data produced; stopping'); break; }
    genShards.push(newShards);
    const dataShards = genShards.slice(-DATA_GENS).flat();
    log(`self-play ok: +${newShards.length} shards (training on last ${Math.min(genShards.length, DATA_GENS)} gens = ${dataShards.length} shards)`);

    // 2. train (fine-tune from best checkpoint)
    const ckpt = resolve(RUN_DIR, `${genTag}.pt`);
    const trainArgs = ['training/splendor/train.py', '--data', ...dataShards,
      '--epochs', String(EPOCHS), '--output', ckpt, '--lr', latestCheckpoint ? '3e-4' : '1e-3'];
    if (latestCheckpoint) trainArgs.push('--checkpoint', latestCheckpoint);
    log(`train: ${EPOCHS} epochs on ${dataShards.length} shards${latestCheckpoint ? ' (fine-tune)' : ' (fresh)'}`);
    const tr = await run(PY, trainArgs, resolve(RUN_DIR, `${genTag}-train.log`));
    if (tr.code !== 0 || !existsSync(ckpt)) { log(`train failed (code ${tr.code}); stopping`); break; }
    latestCheckpoint = ckpt;

    // 3. export ONNX
    const onnx = resolve(RUN_DIR, `splendor-value-${genTag}.onnx`);
    const ex = await run(PY, ['training/splendor/export_onnx.py', '--checkpoint', ckpt, '--output', onnx],
      resolve(RUN_DIR, `${genTag}-export.log`));
    if (ex.code !== 0 || !existsSync(onnx)) { log(`export failed (code ${ex.code}); stopping`); break; }

    // 4. gate: NN (A) vs best NN, or heuristic rollout-leaf for gen 0
    const gateArgs = ['scripts/splendor/tournament.mjs', '--games', String(GATE_GAMES), '--players', String(PLAYERS),
      '--a-mode', 'nn', '--a-model', onnx, '--a-sims', String(GATE_A_SIMS)];
    if (bestModel) gateArgs.push('--b-mode', 'nn', '--b-model', bestModel, '--b-sims', String(GATE_A_SIMS));
    else gateArgs.push('--b-mode', 'tree', '--rollout', String(ROLLOUT), '--b-sims', String(GATE_B_SIMS));
    log(`gate: ${genTag} (NN@${GATE_A_SIMS}) vs ${bestModel ? 'best NN' : `heuristic@${GATE_B_SIMS}`} over ${GATE_GAMES} games`);
    const gate = await run('node', gateArgs, resolve(RUN_DIR, `${genTag}-gate.log`));
    const winLine = (gate.tail.match(/A win rate \(decisive\)[^\n]*/) || gate.tail.match(/A win rate[^\n]*/) || ['(no win line)'])[0];

    if (gate.code === 0) {
      bestModel = onnx; promoted++;
      log(`PROMOTED ${genTag} -- ${winLine}`);
    } else {
      log(`${genTag} did not significantly beat baseline; discarded -- ${winLine}`);
    }
    gen++;
  }

  if (bestModel && promoted > 0) {
    const deployed = resolve(projectDir, 'public/models/splendor-value-v1.onnx');
    copyFileSync(bestModel, deployed);
    log(`FINAL: deployed best model -> public/models/splendor-value-v1.onnx (from ${bestModel})`);
  } else {
    log('FINAL: nothing significantly beat the heuristic baseline; no model deployed (heuristic stays)');
  }
  log(`flywheel done. gens=${gen} promoted=${promoted} elapsed=${(elapsed() / 60).toFixed(0)}min`);
}

main();
