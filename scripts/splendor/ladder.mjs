#!/usr/bin/env node
// Splendor ELO ladder — a round-robin gauntlet across a set of engines, with
// Bradley-Terry (MM) maximum-likelihood ratings converted to Elo. This is the
// rig that turns "smarter" into a number: run it on {1-ply heuristic, champion,
// candidates, NN gens} and read off the Elo gaps.
//
//   node scripts/splendor/ladder.mjs --games 12 --players 2
//   node scripts/splendor/ladder.mjs --games 20 --add nn:public/models/splendor-value-v1.onnx@800
//
// Default engine set is heuristic configs at rising sims, which both anchors the
// ladder and verifies the engine gets stronger with more search.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const getInt = (n, d) => parseInt(getArg(n, String(d)), 10);
const getAll = (n) => args.reduce((acc, a, i) => (a === `--${n}` && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

const GAMES = getInt('games', 12);          // games per ordered pairing (split evenly per seat)
const PLAYERS = getInt('players', 2);
const ROLLOUT = getInt('rollout', 24);
const CHILDREN = getInt('children', 36);
const MAX_MOVES = getInt('max-moves', 800);
const SEED = getInt('seed', 9000);
const ANCHOR = getInt('anchor', 1500);      // mean Elo of the field

// Engine specs. Default: heuristic at four sim budgets (a strength-vs-search curve).
// Add more with --add "<label>:<spec>" where spec is "<sims>" (heuristic) or
// "nn:<modelPath>@<sims>".
const SIMS_SET = getArg('sims-set', '50,200,800,2000');
const DEFAULT_ENGINES = SIMS_SET.split(',').map(s => parseInt(s, 10)).filter(Boolean)
  .map(s => ({ label: `h-${s}`, mode: 'tree', sims: s }));

function parseAdd(spec) {
  // "label:1200"  or  "label:nn:path/to.onnx@800"
  const [label, ...rest] = spec.split(':');
  const body = rest.join(':');
  if (body.startsWith('nn:') || body.includes('.onnx')) {
    const nnBody = body.replace(/^nn:/, '');
    const [model, sims] = nnBody.split('@');
    return { label, mode: 'nn', model, sims: parseInt(sims || '800', 10) };
  }
  return { label, mode: 'tree', sims: parseInt(body, 10) };
}

async function main() {
  const { default: SplendorBoard } = await import(resolve(projectDir, 'src/games/splendor/SplendorBoard.js'));
  const { MCTS, NNEvaluator, applyMove } = await import(resolve(projectDir, 'src/games/splendor/engine/mcts.js'));

  const engines = [...DEFAULT_ENGINES, ...getAll('add').map(parseAdd)];

  async function makeEngine(eng) {
    if (eng.mode === 'nn') {
      const { default: Net } = await import(resolve(projectDir, 'src/games/splendor/engine/valueNetworkNode.js'));
      const net = await Net.load(resolve(projectDir, eng.model));
      return new MCTS({ maxChildren: CHILDREN, evaluator: new NNEvaluator(net) });
    }
    return new MCTS({ maxChildren: CHILDREN, rolloutSteps: ROLLOUT });
  }

  const n = engines.length;
  const wins = Array.from({ length: n }, () => Array(n).fill(0)); // wins[i][j] = score of i vs j
  const totalGames = Array.from({ length: n }, () => Array(n).fill(0));
  const record = engines.map(() => ({ w: 0, l: 0, d: 0, games: 0 }));

  console.log(`Splendor ELO ladder — ${engines.map(e => e.label).join(', ')}`);
  console.log(`  ${PLAYERS}p, ${GAMES} games/pair, rollout=${ROLLOUT}, anchor=${ANCHOR}`);
  const start = Date.now();
  let gameIx = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ei = await makeEngine(engines[i]);
      const ej = await makeEngine(engines[j]);
      for (let g = 0; g < GAMES; g++) {
        const iSeat = (g % 2) + 1;            // alternate which seat engine i takes
        const jSeat = iSeat === 1 ? 2 : 1;
        const board = new SplendorBoard({ seed: SEED + gameIx++, playerCount: PLAYERS, skipInitialHistory: true });
        board._skipHistory = true;
        const seatEngine = { [iSeat]: { e: ei, sims: engines[i].sims, idx: i }, [jSeat]: { e: ej, sims: engines[j].sims, idx: j } };
        // remaining seats (3-4p) get the lower-sim engine to fill, but ELO is only
        // scored between i and j on their head-to-head seats.
        let moves = 0;
        while (board.phase !== 'game-over' && moves < MAX_MOVES) {
          const seat = board.currentPlayer;
          const cfg = seatEngine[seat] || seatEngine[iSeat];
          const move = await cfg.e.getBestMove(board, cfg.sims);
          if (!move || !applyMove(board, move)) break;
          moves++;
        }
        const winnerIdx = board.winner ? seatEngine[board.winner]?.idx : null;
        totalGames[i][j]++; totalGames[j][i]++;
        record[i].games++; record[j].games++;
        if (winnerIdx === i) { wins[i][j] += 1; record[i].w++; record[j].l++; }
        else if (winnerIdx === j) { wins[j][i] += 1; record[j].w++; record[i].l++; }
        else { wins[i][j] += 0.5; wins[j][i] += 0.5; record[i].d++; record[j].d++; }
      }
      const wi = wins[i][j], wj = wins[j][i];
      console.log(`  ${engines[i].label} vs ${engines[j].label}: ${wi}-${wj}`);
    }
  }

  // Bradley-Terry strengths via MM iteration, then Elo = 400*log10(gamma).
  const gamma = Array(n).fill(1);
  for (let iter = 0; iter < 200; iter++) {
    const next = gamma.slice();
    for (let i = 0; i < n; i++) {
      let W = 0, denom = 0;
      for (let j = 0; j < n; j++) {
        if (j === i || totalGames[i][j] === 0) continue;
        W += wins[i][j];
        denom += totalGames[i][j] / (gamma[i] + gamma[j]);
      }
      if (denom > 0 && W > 0) next[i] = W / denom;
    }
    // normalize to geometric mean 1 to keep it stable
    const logMean = next.reduce((s, g) => s + Math.log(g), 0) / n;
    for (let i = 0; i < n; i++) next[i] = Math.exp(Math.log(next[i]) - logMean);
    gamma.splice(0, n, ...next);
  }
  const elo = gamma.map(g => 400 * Math.log10(g));
  const meanElo = elo.reduce((a, b) => a + b, 0) / n;
  const adj = elo.map(e => e - meanElo + ANCHOR);

  const rows = engines.map((e, i) => ({
    label: e.label, sims: e.sims, elo: Math.round(adj[i]),
    w: record[i].w, l: record[i].l, d: record[i].d,
    wr: record[i].games ? ((record[i].w + 0.5 * record[i].d) / record[i].games * 100).toFixed(1) : '—',
  })).sort((a, b) => b.elo - a.elo);

  console.log('---');
  console.log('rank  engine        sims    Elo    W-L-D     score%');
  rows.forEach((r, k) => {
    console.log(`  ${String(k + 1).padEnd(3)} ${r.label.padEnd(12)} ${String(r.sims).padEnd(6)} ${String(r.elo).padEnd(6)} ${`${r.w}-${r.l}-${r.d}`.padEnd(9)} ${r.wr}%`);
  });
  console.log(`time=${((Date.now() - start) / 1000).toFixed(0)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
