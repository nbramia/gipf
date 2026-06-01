#!/usr/bin/env node
// Catan AlphaZero-style training flywheel (time-boxed, gated, resilient).
//
// Each generation: parallel self-play -> train (fine-tune from best gated
// checkpoint, on ALL accumulated data) -> export ONNX -> gate vs current best
// (or the heuristic tree for gen 0) -> promote only on win. At the end the best
// promoted model is copied to public/models/catan-value-v1.onnx.
//
// Run DETACHED so a terminal/desktop-session crash can't kill it:
//   setsid nohup training/.venv/bin/true 2>/dev/null   # (venv must exist)
//   setsid nohup node scripts/catan/train-loop.mjs --budget 28800 --workers 24 \
//       > data/catan/train-loop.out 2>&1 &
// Watch:  tail -f data/catan/<run-id>/train-loop.log

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, statSync, copyFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const getInt = (n, d) => parseInt(getArg(n, String(d)), 10);

const BUDGET = getInt('budget', 8 * 3600);     // seconds
const WORKERS = getInt('workers', 24);
const GAMES_PER_GEN = getInt('games', 600);
const SIMS = getInt('sims', 100);
const ROLLOUT = getInt('rollout', 30);
const EPOCHS = getInt('epochs', 30);
const GATE_GAMES = getInt('gate-games', 12);
const GATE_SIMS = getInt('gate-sims', 80);
const MIN_GEN_SEC = getInt('min-gen', 900);    // need ~15min headroom to start a gen
const PY = resolve(projectDir, 'training/.venv/bin/python');
const RUN_ID = getArg('run-id', `run-${Date.now()}`);
const RUN_DIR = resolve(projectDir, 'data/catan', RUN_ID);
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
  return readdirSync(dir)
    .filter(f => f.endsWith('.ndjson'))
    .map(f => resolve(dir, f))
    .filter(p => { try { return statSync(p).size > 0; } catch { return false; } });
}

async function main() {
  log(`flywheel start  budget=${(BUDGET / 3600).toFixed(1)}h workers=${WORKERS} games/gen=${GAMES_PER_GEN} sims=${SIMS} epochs=${EPOCHS}`);
  if (!existsSync(PY)) { log(`FATAL: venv python not found at ${PY}`); process.exitCode = 1; return; }

  let bestModel = null;        // onnx of best gated gen (null => heuristic baseline); deployed at end
  let latestCheckpoint = null; // .pt to continually fine-tune from (always advances)
  const dataShards = [];
  let gen = 0;
  let promoted = 0;

  while (remaining() > MIN_GEN_SEC) {
    const genTag = `gen${gen}`;
    const genDir = resolve(RUN_DIR, genTag);
    log(`--- ${genTag}  remaining ${(remaining() / 60).toFixed(0)}min ---`);

    // 1. self-play (parallel)
    const spArgs = [
      'scripts/catan/selfplay-parallel.mjs',
      '--games', String(GAMES_PER_GEN), '--workers', String(WORKERS),
      '--sims', String(SIMS), '--rollout', String(ROLLOUT),
      '--out-dir', `data/catan/${RUN_ID}/${genTag}`, '--seed', String(1000 + gen * 7919),
    ];
    if (bestModel) spArgs.push('--model', bestModel);
    log(`self-play: ${GAMES_PER_GEN} games via ${WORKERS} workers (${bestModel ? 'NN' : 'heuristic'})`);
    await run('node', spArgs, resolve(RUN_DIR, `${genTag}-selfplay.log`));
    const newShards = ndjsonShards(genDir);
    if (newShards.length === 0) { log(`no self-play data produced; stopping`); break; }
    dataShards.push(...newShards);
    log(`self-play ok: +${newShards.length} shards (total ${dataShards.length})`);

    // 2. train (fine-tune from best gated checkpoint, on all accumulated data)
    const ckpt = resolve(RUN_DIR, `${genTag}.pt`);
    const trainArgs = ['training/catan/train.py', '--data', ...dataShards,
      '--epochs', String(EPOCHS), '--output', ckpt, '--lr', latestCheckpoint ? '3e-4' : '1e-3'];
    if (latestCheckpoint) trainArgs.push('--checkpoint', latestCheckpoint);
    log(`train: ${EPOCHS} epochs on ${dataShards.length} shards${latestCheckpoint ? ' (fine-tune from latest)' : ' (fresh)'}`);
    const tr = await run(PY, trainArgs, resolve(RUN_DIR, `${genTag}-train.log`));
    if (tr.code !== 0 || !existsSync(ckpt)) { log(`train failed (code ${tr.code}); stopping`); break; }
    latestCheckpoint = ckpt; // continually advance so the net keeps improving even before it clears the gate

    // 3. export ONNX
    const onnx = resolve(RUN_DIR, `catan-value-${genTag}.onnx`);
    const ex = await run(PY, ['training/catan/export_onnx.py', '--checkpoint', ckpt, '--output', onnx],
      resolve(RUN_DIR, `${genTag}-export.log`));
    if (ex.code !== 0 || !existsSync(onnx)) { log(`export failed (code ${ex.code}); stopping`); break; }

    // 4. gate: new (A) vs best (B = prev model, or heuristic tree for gen 0)
    const gateArgs = ['scripts/catan/tournament.mjs', '--games', String(GATE_GAMES), '--max-moves', '1200',
      '--a-model', onnx, '--a-sims', String(GATE_SIMS), '--a-children', '24', '--a-label', genTag];
    if (bestModel) gateArgs.push('--b-model', bestModel, '--b-sims', String(GATE_SIMS), '--b-children', '24', '--b-label', 'best');
    else gateArgs.push('--b-mode', 'tree', '--b-rollout', String(ROLLOUT), '--b-sims', String(GATE_SIMS), '--b-children', '24', '--b-label', 'heuristic');
    log(`gate: ${genTag} vs ${bestModel ? 'best' : 'heuristic'} (${GATE_GAMES} games)`);
    const gate = await run('node', gateArgs, resolve(RUN_DIR, `${genTag}-gate.log`));
    const winLine = (gate.tail.match(/A win rate[^\n]*/) || ['(no win line)'])[0];

    if (gate.code === 0) {
      bestModel = onnx;
      promoted++;
      log(`PROMOTED ${genTag} as new best -- ${winLine}`);
    } else {
      log(`${genTag} did not beat best; discarded -- ${winLine}`);
    }
    gen++;
  }

  if (bestModel) {
    const deployed = resolve(projectDir, 'public/models/catan-value-v1.onnx');
    copyFileSync(bestModel, deployed);
    log(`FINAL: deployed best model -> public/models/catan-value-v1.onnx (from ${bestModel})`);
  } else {
    log(`FINAL: nothing beat the heuristic baseline; no model deployed`);
  }
  log(`flywheel done. gens=${gen} promoted=${promoted} elapsed=${(elapsed() / 60).toFixed(0)}min`);
}

main();
