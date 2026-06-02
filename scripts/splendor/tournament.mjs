#!/usr/bin/env node
// Splendor strength tournament: an A engine vs a B baseline, seat-balanced.
// Use it to gate a candidate NN evaluator (A) against the heuristic tree (B), or
// to A/B two heuristic configs. For challenger-vs-frozen-champion gating of
// engine code changes, use compare-evals.mjs instead.
//
//   node scripts/splendor/tournament.mjs --games 20 --a-mode nn --a-model public/models/splendor.onnx
//   node scripts/splendor/tournament.mjs --games 20 --a-sims 2000 --b-sims 800

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const getInt = (n, d) => parseInt(getArg(n, String(d)), 10);

const GAMES = getInt('games', 20);
const PLAYERS = getInt('players', 2);
const A_MODE = getArg('a-mode', 'tree');     // 'tree' | 'nn'
const B_MODE = getArg('b-mode', 'tree');
const A_MODEL = getArg('a-model', null);
const B_MODEL = getArg('b-model', null);
const A_SIMS = getInt('a-sims', 800);
const B_SIMS = getInt('b-sims', 800);
const ROLLOUT = getInt('rollout', 24);
const CHILDREN = getInt('children', 44);
const SEED = getInt('seed', 7000);
const MAX_MOVES = getInt('max-moves', 800);

async function main() {
  const { default: SplendorBoard } = await import(resolve(projectDir, 'src/games/splendor/SplendorBoard.js'));
  const { MCTS, NNEvaluator, applyMove } = await import(resolve(projectDir, 'src/games/splendor/engine/mcts.js'));

  async function makeEngine(mode, model) {
    if (mode === 'nn') {
      if (!model) throw new Error('nn mode needs --a-model/--b-model');
      const { default: Net } = await import(resolve(projectDir, 'src/games/splendor/engine/valueNetworkNode.js'));
      return new MCTS({ maxChildren: CHILDREN, evaluator: new NNEvaluator(await Net.load(resolve(projectDir, model))) });
    }
    return new MCTS({ maxChildren: CHILDREN, rolloutSteps: ROLLOUT });
  }

  const wins = { A: 0, B: 0, none: 0 };
  const start = Date.now();
  console.log(`Splendor tournament: A(${A_MODE},sims=${A_SIMS}) vs B(${B_MODE},sims=${B_SIMS}), ${GAMES} games ${PLAYERS}p`);

  for (let i = 0; i < GAMES; i++) {
    const offset = i % 2;
    const assign = {};
    for (let s = 1; s <= PLAYERS; s++) assign[s] = (s - 1 + offset) % 2 === 0 ? 'A' : 'B';
    const board = new SplendorBoard({ seed: SEED + i, playerCount: PLAYERS, skipInitialHistory: true });
    board._skipHistory = true;
    const engines = {};
    for (let s = 1; s <= PLAYERS; s++) {
      engines[s] = assign[s] === 'A' ? await makeEngine(A_MODE, A_MODEL) : await makeEngine(B_MODE, B_MODEL);
    }
    let moves = 0;
    while (board.phase !== 'game-over' && moves < MAX_MOVES) {
      const seat = board.currentPlayer;
      const sims = assign[seat] === 'A' ? A_SIMS : B_SIMS;
      const move = await engines[seat].getBestMove(board, sims);
      if (!move || !applyMove(board, move)) break;
      moves++;
    }
    const side = board.winner ? assign[board.winner] : 'none';
    wins[side]++;
    console.log(`  Game ${i + 1}: winner=P${board.winner || '-'} (${side}) moves=${moves}`);
  }

  const decisive = wins.A + wins.B;
  const rate = decisive ? (wins.A / decisive * 100).toFixed(1) : 'n/a';
  const [lo, hi] = wilson95(wins.A, decisive);
  const significant = lo > 0.5;
  console.log('---');
  console.log(`A=${wins.A}  B=${wins.B}  none=${wins.none}  A win rate=${rate}%  95% CI [${(lo * 100).toFixed(1)}%, ${(hi * 100).toFixed(1)}%]  time=${((Date.now() - start) / 1000).toFixed(0)}s`);
  console.log(`A win rate (decisive): ${rate}%  ${significant ? 'SIGNIFICANT' : 'not significant'}`);
  // Exit 0 only when A is significantly better than B — the flywheel promotes on
  // proven gains, not noise.
  process.exitCode = significant ? 0 : 1;
}

function wilson95(wins, n) {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const phat = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

main().catch(e => { console.error(e); process.exit(1); });
